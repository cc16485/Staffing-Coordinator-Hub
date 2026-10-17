// =============================================================================
// client-agreement · the Client Care Agreement signed on a tablet, Stage 1 (Samantha 2026-10-16: "Yes, start building
// stage 1: the tablet form, finger signature and signed PDF saved in the Hub").
// The office opens the client in the Hub, sets the level and rate, and hands the tablet over. The family fills in the
// client, POA and Contacts & Permissions, picks their choices, taps the six initials, then signs with a finger and their
// typed name. The office countersigns on the same tablet, and the signed PDF (the real agreement pages with everything
// written in, plus an electronic signature record page) is saved in the private bucket client-agreements.
// Stage 1 changes nothing in AxisCare and sends nothing to anyone; every action needs a signed-in office user.
// Actions: start · get · list · save · sign · countersign · open · void
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { logOpen, clientSubject } from '../_shared/doc-log.ts'
import { FIELDS, VERSION, DOC, PDF_SHA256, BUCKET, ESIGN_WORDS, INITIALS, OFFICE_KEYS, cleanAnswers, readyToSign, initialsOf, signatureOk, initialsComplete, centralDate, stampPlan, type Answers } from '../_shared/client-agreement.ts'
import { MASTER_PATH } from '../_shared/client-agreement-map.ts'
import { signedAgreementPdf } from '../_shared/agreement-pdf.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cc-via, x-cc-employee',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const S = (v: unknown, n: number) => String(v ?? '').slice(0, n)
const ipOf = (req: Request) => S(req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0], 64).trim()
const agentOf = (req: Request) => S(req.headers.get('user-agent'), 200)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const AX = /^[0-9]{1,12}$/
const ADDENDA = ['va', 'guide']
const pngBytes = (dataUrl: string) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))
const stampOf = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

/** What the tablet page needs to draw the form: the field keys and kinds, the six initials, the consent words. */
export const FORM_INFO = {
  doc: DOC, version: VERSION, esign_words: ESIGN_WORDS, initials: INITIALS,
  fields: Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, f.type])),
  office_keys: [...OFFICE_KEYS],
}

/** The row as the Hub may see it: no signature images, no file paths beyond whether a PDF exists. */
function view(r: Any) {
  return {
    id: r.id, client_ax: r.axiscare_client_id, status: r.status, version: r.version, office: r.office, answers: r.answers,
    signer: r.client_sign ? { name: r.client_sign.typed_name, role: r.client_sign.role, at: r.client_sign.at } : null,
    office_signer: r.office_sign ? { name: r.office_sign.typed_name, at: r.office_sign.at } : null,
    has_pdf: !!r.signed_pdf_path, created_at: r.created_at, signed_at: r.signed_at, countersigned_at: r.countersigned_at, void_reason: r.void_reason,
  }
}

if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405)
  let b: Any = {}
  try { b = await req.json() } catch { return json({ error: 'Bad request.' }, 400) }
  const action = String(b?.action ?? '')
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  try {
    const who = await requireStaff(db, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    const row = async (id: unknown) => {
      if (!UUID.test(String(id || ''))) return null
      const { data, error } = await db.from('client_agreements').select('*').eq('id', String(id)).limit(1)
      if (error) throw error
      return data?.[0] || null
    }

    if (action === 'form') return json({ ok: true, form: FORM_INFO })

    if (action === 'list') {
      const ax = S(b.client_ax, 12)
      if (!AX.test(ax)) return json({ error: 'Which client?' }, 400)
      const { data, error } = await db.from('client_agreements').select('*').eq('axiscare_client_id', ax).order('created_at', { ascending: false }).limit(20)
      if (error) throw error
      return json({ ok: true, agreements: (data || []).map(view) })
    }

    if (action === 'start') {
      const ax = S(b.client_ax, 12)
      if (!AX.test(ax)) return json({ error: 'Which client?' }, 400)
      const { answers, problems } = cleanAnswers(b.office || {}, 'office')
      if (problems.length) return json({ error: 'Some office answers are not right.', problems }, 422)
      const addenda = (Array.isArray(b.addenda) ? b.addenda : []).map(String).filter((x: string) => ADDENDA.includes(x))
      const start_date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.start_date || '')) ? String(b.start_date) : null
      const { data, error } = await db.from('client_agreements').insert({
        axiscare_client_id: ax, doc: DOC, version: VERSION, pdf_sha256: PDF_SHA256, status: 'draft',
        office: { answers, addenda, start_date, by: who.name }, answers: {}, created_by: who.email,
      }).select('*')
      if (error) throw error
      return json({ ok: true, outcome: 'saved', agreement: view(data[0]), form: FORM_INFO })
    }

    if (action === 'get') {
      const r = await row(b.id)
      if (!r) return json({ error: 'Agreement not found.' }, 404)
      return json({ ok: true, agreement: view(r), form: FORM_INFO })
    }

    if (action === 'save' || action === 'office') {
      const r = await row(b.id)
      if (!r) return json({ error: 'Agreement not found.' }, 404)
      if (r.status !== 'draft') return json({ error: 'This agreement is already signed. Start a new one to change it.', outcome: 'stale' }, 409)
      if (action === 'office') {
        const { answers, problems } = cleanAnswers(b.office || {}, 'office')
        if (problems.length) return json({ error: 'Some office answers are not right.', problems }, 422)
        const office = { ...r.office, answers, by: who.name }
        const { error } = await db.from('client_agreements').update({ office, updated_at: new Date().toISOString() }).eq('id', r.id).eq('status', 'draft')
        if (error) throw error
        return json({ ok: true, outcome: 'saved' })
      }
      const { answers, problems } = cleanAnswers(b.answers || {}, 'family')
      if (problems.length) return json({ error: 'Some answers are not right.', problems }, 422)
      const { error } = await db.from('client_agreements').update({ answers, updated_at: new Date().toISOString() }).eq('id', r.id).eq('status', 'draft')
      if (error) throw error
      return json({ ok: true, outcome: 'saved' })
    }

    if (action === 'sign') {
      const r = await row(b.id)
      if (!r) return json({ error: 'Agreement not found.' }, 404)
      if (r.status !== 'draft') return json({ error: 'This agreement is already signed.', outcome: 'stale' }, 409)
      if (b.consent !== true) return json({ error: 'Please tick the box to agree to sign electronically.', field: 'consent' }, 400)
      const fam = cleanAnswers(b.answers || {}, 'family')
      if (fam.problems.length) return json({ error: 'Some answers are not right.', problems: fam.problems }, 422)
      const all: Answers = { ...(r.office?.answers || {}), ...fam.answers }
      const signer = { name: S(b.signer?.name, 80).trim().replace(/\s+/g, ' '), role: S(b.signer?.role, 20), relationship: S(b.signer?.relationship, 40).trim() }
      const problems = [...readyToSign(all, signer), ...initialsComplete(b.initials, signer.role === 'representative')]
      if (!signatureOk(b.signature)) problems.push({ field: 'signature', error: 'Please sign with your finger in the box.' })
      if (problems.length) return json({ error: 'A few things are still needed before signing.', problems }, 422)
      const at = new Date().toISOString()
      const path = `sig/${r.axiscare_client_id}/${r.id}-client-${stampOf(at)}.png`
      const up = await db.storage.from(BUCKET).upload(path, pngBytes(b.signature), { contentType: 'image/png', upsert: false })
      if (up.error) throw up.error
      const taps = Object.fromEntries(Object.entries(b.initials || {}).filter(([k]) => k in INITIALS || k === 'poa').map(([k, v]) => [k, S(v, 40)]))
      const client_sign = { typed_name: signer.name, role: signer.role, relationship: signer.relationship || null, initials_text: initialsOf(signer.name), initials_taps: taps,
        at, ip: ipOf(req), agent: agentOf(req), consent: true, consent_words: ESIGN_WORDS, signature_path: path, version: VERSION, pdf_sha256: PDF_SHA256,
        on_staff_session: { name: who.name, email: who.email, person_id: who.person_id } }
      const { data: did, error } = await db.from('client_agreements').update({ answers: fam.answers, client_sign, status: 'signed', signed_at: at, updated_at: at })
        .eq('id', r.id).eq('status', 'draft').select('id')
      if (error) throw error
      if (!did?.length) return json({ error: 'This agreement changed while you were signing. Open it again.', outcome: 'stale' }, 409)
      return json({ ok: true, outcome: 'signed', at })
    }

    if (action === 'countersign') {
      const r = await row(b.id)
      if (!r) return json({ error: 'Agreement not found.' }, 404)
      if (r.status !== 'signed') return json({ error: r.status === 'countersigned' ? 'Already countersigned.' : 'The client signs first.', outcome: 'stale' }, 409)
      if (!signatureOk(b.signature)) return json({ error: 'Please sign in the box.', field: 'signature' }, 400)
      const at = new Date().toISOString()
      const sigPath = `sig/${r.axiscare_client_id}/${r.id}-office-${stampOf(at)}.png`
      const up = await db.storage.from(BUCKET).upload(sigPath, pngBytes(b.signature), { contentType: 'image/png', upsert: false })
      if (up.error) throw up.error
      const office_sign = { typed_name: who.name, email: who.email, person_id: who.person_id, at, ip: ipOf(req), agent: agentOf(req), signature_path: sigPath }

      const [master, csig] = await Promise.all([db.storage.from(BUCKET).download(MASTER_PATH), db.storage.from(BUCKET).download(r.client_sign.signature_path)])
      if (master.error || csig.error) throw (master.error || csig.error)
      const cs = r.client_sign, all: Answers = { ...(r.office?.answers || {}), ...(r.answers || {}) }
      const plan = stampPlan(all, { initials: cs.initials_text, signedAt: cs.at, signerName: cs.typed_name, representative: cs.role === 'representative', officeName: who.name, officeAt: at })
      const tapLine = Object.entries(cs.initials_taps || {}).map(([k, v]) => `${k === 'poa' ? 'POA' : k + ' of 6'}: ${centralDate(String(v)).long}`).join('\n')
      const record = [
        ['Agreement', `Client Care Agreement, ${VERSION}`], ['Agreement id', r.id], ['AxisCare client', r.axiscare_client_id],
        ['Master document SHA-256', PDF_SHA256],
        ['Signed by', `${cs.typed_name}${cs.role === 'representative' ? ` (on behalf of the client${cs.relationship ? ', ' + cs.relationship : ''})` : ' (the client)'}`],
        ['Signed at', `${centralDate(cs.at).long} (${cs.at} UTC)`], ['Signer device', `${cs.ip || 'not recorded'} · ${cs.agent || 'not recorded'}`],
        ['Electronic signature consent', `"${cs.consent_words}"`], ['Initials taps', tapLine || 'none'],
        ['Signed on the tablet of', `${cs.on_staff_session?.name || ''} (${cs.on_staff_session?.email || ''})`],
        ['Countersigned by', `${who.name} (${who.email}), Caring Companions`], ['Countersigned at', `${centralDate(at).long} (${at} UTC)`],
        ['Countersigner device', `${office_sign.ip || 'not recorded'} · ${office_sign.agent || 'not recorded'}`],
      ]
      let bytes: Uint8Array
      try {
        bytes = await signedAgreementPdf({ master: new Uint8Array(await master.data.arrayBuffer()), plan, clientSigPng: new Uint8Array(await csig.data.arrayBuffer()), officeSigPng: pngBytes(b.signature), record, at })
      } catch (e) {
        console.error('client-agreement pdf', e)
        return json({ error: 'The signed PDF could not be made. Nothing was lost: try Countersign again, and tell Samantha if it keeps happening.' }, 500)
      }
      const pdfPath = `signed/${r.axiscare_client_id}/${r.id}-${stampOf(at)}.pdf`
      const upd = await db.storage.from(BUCKET).upload(pdfPath, bytes, { contentType: 'application/pdf', upsert: false })
      if (upd.error) throw upd.error
      const { data: did, error } = await db.from('client_agreements').update({ office_sign, signed_pdf_path: pdfPath, status: 'countersigned', countersigned_at: at, updated_at: at })
        .eq('id', r.id).eq('status', 'signed').is('signed_pdf_path', null).select('id')
      if (error) throw error
      if (!did?.length) return json({ error: 'Someone else countersigned this a moment ago. Open it again.', outcome: 'stale' }, 409)
      return json({ ok: true, outcome: 'countersigned', at })
    }

    if (action === 'open') {
      const r = await row(b.id)
      if (!r?.signed_pdf_path) return json({ error: 'No signed PDF yet.' }, 404)
      const logged = await logOpen(db, { subject: clientSubject(r.axiscare_client_id, null), doc: 'client_agreement', path: r.signed_pdf_path, who, ip: ipOf(req) })
      if (!logged) return json({ error: 'Could not record who opened it, so it was not opened. Try again.' }, 500)
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(r.signed_pdf_path, 300)
      if (error || !data?.signedUrl) throw error || new Error('no url')
      return json({ ok: true, url: data.signedUrl, expires_in: 300 })
    }

    if (action === 'void') {
      const r = await row(b.id)
      if (!r) return json({ error: 'Agreement not found.' }, 404)
      if (r.status === 'countersigned' || r.status === 'void') return json({ error: r.status === 'void' ? 'Already set aside.' : 'A countersigned agreement is kept as signed. Start a new one if something changed.' }, 409)
      const why = S(b.reason, 300).trim()
      if (why.length < 5) return json({ error: 'Say why (a few words).', field: 'reason' }, 400)
      const { error } = await db.from('client_agreements').update({ status: 'void', void_reason: `${why} (${who.name})`, updated_at: new Date().toISOString() }).eq('id', r.id).in('status', ['draft', 'signed'])
      if (error) throw error
      return json({ ok: true, outcome: 'saved' })
    }

    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    console.error('client-agreement', action, e)
    return json({ error: 'Something went wrong. Try again, and tell Samantha if it keeps happening.' }, 500)
  }
})
