// =============================================================================
// offer-sign · the offer page's server (SLICE 1b, Samantha approved 2026-10-08: development and testing only)
// =============================================================================
// The caregiver's private offer link (applicant-link kind 'offer', an HMAC the Hub made) is the only key to this door.
//   { action: 'view',   o, e, t }                                   -> both documents rendered from the approved texts
//                                                                      for this offer, and where the signing stands
//   { action: 'sign',   o, e, t, doc: 'offer' | 'pd', typed_name, consent: true }
//                                                                   -> records ONE signature for that document (a second is
//                                                                      refused), writes its event rows, builds the PDF,
//                                                                      stores it in the private bucket, never overwrites
//   { action: 'copies', o, e, t }                                   -> short-lived links to the caregiver's own signed PDFs
//   { action: 'open', offer_id, doc }  (signed-in office staff)     -> a short-lived link to a stored PDF, logged
// HER RULES BUILT IN: the offer letter is signed before the position description; each document has its own consent,
// typed name, time, version and fingerprint; a signed document is never changed (the PDF is written once; the signature
// columns are set only while still empty, so a race cannot sign twice); withdrawn, declined or expired offers answer
// like a dead link; the link dies with the offer (offer_expires_at is required and checked on every call). TEST GATE
// for Slice 1b: only offers on the NEW onboarding path are served, and no real offer is on it until the switch date,
// so the real hiring process cannot be touched. Nothing here sends a text or an email; Step 1 is Slice 1d.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkLink } from '../_shared/applicant-links.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { offerLetter, positionDescription, canonical, fingerprint, longDate, longDateTime, OFFER_DOC_VERSION, PD_DOC_VERSION, CLASSIFICATIONS, type Fields } from '../_shared/offer-documents.ts'
import { makePdf, type PdfBlock } from '../_shared/simple-pdf.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const S = (v: unknown, n = 120) => String(v ?? '').trim().slice(0, n)
const NOPE = { ok: false, error: 'This link is not valid or has run out. Please ask the office for a new one: (417) 234-8494.' }
export const BUCKET = 'onboarding-documents'
const COLS = 'id,first_name,last_name,position,pay_rate,hours_type,classification,onboarding_path,offer_status,offer_version,pd_version,offer_sent_at,offer_sent_by,offer_expires_at,offer_viewed_at,offer_signed_at,offer_signer_name,pd_signed_at,offer_declined_at,offer_withdrawn_at,offer_pdf_path,pd_pdf_path,offered_by,created_at'

function trn() {
  const url = Deno.env.get('OFFERS_PROJECT_URL') ?? '', key = Deno.env.get('OFFERS_SERVICE_ROLE_KEY') ?? ''
  if (!url || !key) throw new Error('the job offers connection is not set up')
  const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  return {
    // deno-lint-ignore no-explicit-any
    async get(id: string): Promise<any | null> {
      const r = await fetch(`${url}/rest/v1/job_offers?id=eq.${encodeURIComponent(id)}&select=${COLS}`, { headers: H })
      if (!r.ok) throw new Error('the Training Platform answered ' + r.status)
      const rows = await r.json(); return Array.isArray(rows) && rows.length === 1 ? rows[0] : null
    },
    /** PATCH with a guard: only rows where `guard` still holds are changed; answers how many rows changed. */
    async patch(id: string, body: Record<string, unknown>, guard = ''): Promise<number> {
      const r = await fetch(`${url}/rest/v1/job_offers?id=eq.${encodeURIComponent(id)}${guard}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error('could not save to the offer record (' + r.status + ')')
      const rows = await r.json(); return Array.isArray(rows) ? rows.length : 0
    },
    async event(row: Record<string, unknown>): Promise<void> {
      const r = await fetch(`${url}/rest/v1/offer_events`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row) })
      if (!r.ok) throw new Error('could not write the offer event (' + r.status + ')')
    },
  }
}
const ipOf = (req: Request) => S(req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0], 64)
const agentOf = (req: Request) => S(req.headers.get('user-agent'), 200)
// deno-lint-ignore no-explicit-any
function fieldsOf(o: any): Fields {
  const cls = S(o.classification, 40) || (o.hours_type === 'PRN' ? 'prn' : o.hours_type === 'PART_TIME' ? 'part_time' : o.hours_type === 'FULL_TIME' ? 'full_time' : '')
  return { first: S(o.first_name, 60), last: S(o.last_name, 60), position: S(o.position, 80) || 'Caregiver', pay_rate: Number(o.pay_rate) || 0, classification: cls,
    date: longDate(o.offer_sent_at || o.created_at), expires: o.offer_expires_at ? longDate(o.offer_expires_at) : '', issued_by: S(o.offer_sent_by || o.offered_by, 120) || 'the office', issued_at: longDateTime(o.offer_sent_at || o.created_at) }
}
// deno-lint-ignore no-explicit-any
function dead(o: any): Response | null {
  if (o.onboarding_path !== 'new') return json({ ...NOPE, why: 'not on the new path' }, 404)   // the Slice 1b test gate
  if (o.offer_withdrawn_at || o.offer_declined_at || o.offer_status === 'withdrawn' || o.offer_status === 'declined' || o.offer_status === 'expired') return json(NOPE, 410)
  if (!o.offer_expires_at) return json({ ok: false, error: 'This offer has no expiry on record, so it cannot be signed. Please ask the office: (417) 234-8494.' }, 409)
  if (Date.parse(o.offer_expires_at) < Date.now()) return json({ ...NOPE, expired: true }, 410)
  if (!CLASSIFICATIONS[fieldsOf(o).classification]) return json({ ok: false, error: 'This offer\'s terms have not been approved for this position yet. Please ask the office: (417) 234-8494.' }, 409)
  return null
}
// deno-lint-ignore no-explicit-any
async function render(o: any) {
  const f = fieldsOf(o)
  const offer = offerLetter(f), pd = positionDescription(f)
  return { fields: f, offer, pd, offer_fp: await fingerprint(canonical(offer)), pd_fp: await fingerprint(canonical(pd)) }
}
// deno-lint-ignore no-explicit-any
const state = (o: any) => ({ status: o.offer_status, offer_signed_at: o.offer_signed_at, offer_signer_name: o.offer_signer_name, pd_signed_at: o.pd_signed_at, expires_at: o.offer_expires_at, viewed_at: o.offer_viewed_at })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const secret = Deno.env.get('HUB_JOB_SECRET') ?? ''
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  // deno-lint-ignore no-explicit-any
  const b: Record<string, any> = await req.json().catch(() => ({}))
  const action = S(b.action, 20)
  try {
    if (action === 'open') {
      /* office staff: a short-lived link to a stored PDF, every open logged */
      const staff = await requireStaff(db, req, OFFICE_ROLES)
      if (!staff.ok) return json({ ok: false, error: staff.error }, staff.status)
      const id = S(b.offer_id, 64), doc = b.doc === 'pd' ? 'pd' : 'offer'
      const o = await trn().get(id); if (!o) return json({ ok: false, error: 'That offer is not on file.' }, 404)
      const path = doc === 'pd' ? o.pd_pdf_path : o.offer_pdf_path
      if (!path) return json({ ok: false, error: 'That document has not been signed yet.' }, 404)
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 300)
      if (error || !data?.signedUrl) return json({ ok: false, error: 'Could not open the document.' }, 500)
      await db.from('document_access_log').insert({ offer_id: id, doc, path, by_person: staff.person_id, by_email: staff.email, by_name: staff.name, ip: ipOf(req) })
      return json({ ok: true, url: data.signedUrl, expires_in: 300 })
    }
    // everything else needs the caregiver's own link
    const id = S(b.o, 64)
    if (!(await checkLink(secret, 'offer', id, b.e, b.t))) return json(NOPE, 401)
    const T = trn()
    const o = await T.get(id); if (!o) return json(NOPE, 404)
    const gone = dead(o); if (gone) return gone
    if (action === 'view') {
      const r = await render(o)
      if (!o.offer_viewed_at) {
        const n = await T.patch(id, { offer_viewed_at: new Date().toISOString(), ...(o.offer_status === 'sent' ? { offer_status: 'viewed' } : {}) }, '&offer_viewed_at=is.null')
        if (n) await T.event({ offer_id: id, kind: 'viewed', by_who: 'caregiver', channel: 'page', doc_version: OFFER_DOC_VERSION, fingerprint: r.offer_fp, detail: { ip: ipOf(req), agent: agentOf(req) } })
      }
      return json({ ok: true, first: r.fields.first, state: state(o), versions: { offer: OFFER_DOC_VERSION, pd: PD_DOC_VERSION }, fingerprints: { offer: r.offer_fp, pd: r.pd_fp }, offer: r.offer, pd: r.pd })
    }
    if (action === 'copies') {
      const out: Record<string, string> = {}
      for (const [k, p] of [['offer', o.offer_pdf_path], ['pd', o.pd_pdf_path]] as [string, string | null][]) {
        if (!p) continue
        const { data } = await db.storage.from(BUCKET).createSignedUrl(p, 600); if (data?.signedUrl) out[k] = data.signedUrl
      }
      return json({ ok: true, copies: out, expires_in: 600 })
    }
    if (action === 'sign') {
      const doc = b.doc === 'pd' ? 'pd' : b.doc === 'offer' ? 'offer' : ''
      if (!doc) return json({ ok: false, error: 'Which document?' }, 400)
      if (b.consent !== true) return json({ ok: false, error: 'Please tick "I agree to sign this document electronically" first.' }, 400)
      const name = S(b.typed_name, 80)
      if (!/^\S+(\s+\S+)+$/.test(name) || name.length < 4) return json({ ok: false, error: 'Please type your full name, first and last, exactly as you want it on the document.' }, 400)
      if (doc === 'pd' && !o.offer_signed_at) return json({ ok: false, error: 'Please sign your offer letter first.' }, 409)
      if ((doc === 'offer' && o.offer_signed_at) || (doc === 'pd' && o.pd_signed_at)) return json({ ok: false, error: 'This document is already signed. A signed document is never changed; if something is wrong, call the office at (417) 234-8494.', already: true }, 409)
      const r = await render(o); const now = new Date().toISOString(); const ip = ipOf(req), agent = agentOf(req)
      const version = doc === 'offer' ? OFFER_DOC_VERSION : PD_DOC_VERSION, fp = doc === 'offer' ? r.offer_fp : r.pd_fp
      // 1. the signature, only while still unsigned (a race cannot sign twice)
      const cols = doc === 'offer'
        ? { offer_signed_at: now, offer_signer_name: name, offer_signer_ip: ip, offer_signer_agent: agent, offer_version: version }
        : { pd_signed_at: now, pd_version: version }
      const n = await T.patch(id, cols, doc === 'offer' ? '&offer_signed_at=is.null' : '&pd_signed_at=is.null')
      if (!n) return json({ ok: false, error: 'This document was just signed. A signed document is never changed.', already: true }, 409)
      await T.event({ offer_id: id, kind: doc === 'offer' ? 'signed' : 'pd_signed', by_who: 'caregiver', channel: 'page', doc_version: version, fingerprint: fp, detail: { typed_name: name, ip, agent, consent: true, signed_at: now } })
      // 2. the PDF: the exact text as rendered, plus its signature page; written once, never overwritten
      const blocks: PdfBlock[] = [{ k: 'title', t: doc === 'offer' ? 'Offer of employment' : 'Caregiver position description' }, ...(doc === 'offer' ? r.offer : r.pd), { k: 'gap', t: '' }, { k: 'h', t: 'ELECTRONIC SIGNATURE' },
        { k: 'p', t: `Signed electronically by ${name}` }, { k: 'p', t: `On ${longDateTime(now)} (${now} UTC)` }, { k: 'p', t: 'Consent to sign electronically: given on this page before signing.' },
        { k: 'small', t: `Device address ${ip || 'not recorded'} · Browser ${agent || 'not recorded'}` }, { k: 'small', t: `Document: ${doc === 'offer' ? 'Offer of employment' : 'Caregiver position description'}, version ${version}, fingerprint ${fp}` }, { k: 'small', t: `Offer record ${id}` }]
      const bytes = makePdf(blocks, { title: `${doc === 'offer' ? 'Offer of employment' : 'Position description'} - ${r.fields.first} ${r.fields.last}` })
      const path = `offers/${id}/${doc}-v${version}-${now.replace(/[:.]/g, '-')}.pdf`
      const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false })
      if (up.error) { await T.event({ offer_id: id, kind: doc === 'offer' ? 'signed' : 'pd_signed', by_who: 'system', channel: 'page', doc_version: version, fingerprint: fp, result: 'pdf_failed', detail: { error: String(up.error.message || up.error) } }); return json({ ok: false, error: 'Your signature was recorded, but the copy could not be stored. The office will fix this; nothing more is needed from you.' }, 500) }
      await T.patch(id, doc === 'offer' ? { offer_pdf_path: path } : { pd_pdf_path: path }, doc === 'offer' ? '&offer_pdf_path=is.null' : '&pd_pdf_path=is.null')
      // 3. both signed = accepted (Step 1 is Slice 1d and reads this)
      const both = doc === 'pd' || !!o.pd_signed_at
      if (both) await T.patch(id, { offer_status: 'accepted' }, '&offer_status=not.in.(withdrawn,declined,expired)')
      const { data: cp } = await db.storage.from(BUCKET).createSignedUrl(path, 600)
      return json({ ok: true, doc, signed_at: now, version, fingerprint: fp, accepted: both, copy_url: cp?.signedUrl ?? null })
    }
    return json({ ok: false, error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ ok: false, error: 'Something went wrong: ' + ((e as Error).message || 'error') + '. Nothing was changed.' }, 500)
  }
})
