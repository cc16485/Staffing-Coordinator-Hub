// =============================================================================
// step1-sign · the Step 1 page's server (SLICE 2b, Samantha "start slice 2b", 2026-10-10: fictional testing only)
// =============================================================================
// The caregiver's private Step 1 link (applicant-link kind 'step1', an HMAC the Hub made) is the only key to this door.
//   { action: 'view',     o, e, t }                         -> the seven forms (versioned words + fingerprints), what is
//                                                              already answered and signed, the prefill from the offer, the
//                                                              application and the interview, where they left off
//   { action: 'begin',    o, e, t, esign_consent: true }    -> the one-time consent to sign electronically (RSMo 432.230)
//   { action: 'save',     o, e, t, screen, answers }        -> answers merged in (never for a form already signed; never the
//                                                              three locked identity values), and where they are
//   { action: 'identity', o, e, t, ssn, ssn2, dob, license_number, license_state, license_expires }
//                                                           -> sealed with STEP1_KEK into step1_identity; the record keeps
//                                                              only "on file, ending 1234"; refused once the form is signed
//   { action: 'sign',     o, e, t, form, typed_name, consent: true, initials? }
//                                                           -> ONE signature per form, in order, only when every required
//                                                              answer is there; the PDF written once; the trail rows written
//   { action: 'copies',   o, e, t }                         -> short-lived links to the caregiver's own signed PDFs
//   { action: 'open', offer_id, form }  (signed-in staff)   -> a short-lived link to a stored PDF, logged
//   { action: 'screening', offer_id }   (signed-in staff)   -> SLICE 2c: what is on file, the registration facts, may this caller reveal
//   { action: 'reveal', offer_id, field, reason } (screening staff only) -> SLICE 2c: one sealed value, once, for five minutes, logged
// HER RULES BUILT IN: nothing here sends a text or an email; a signed form is never changed (the database trigger and the
// write guard both refuse); the SSN, date of birth and license number never land in answers, logs or the PDF; the test
// gate of Slice 1b holds (only offers on the NEW onboarding path, none real until the switch date); no form is approved
// for real signing yet (APPROVED_FOR_REAL is empty), and the page says so.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkLink } from '../_shared/applicant-links.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { FORMS, FORM_ORDER, formFingerprint, REFERENCES_REQUIRED, APPROVED_FOR_REAL, MATCHING_FACTS, type FormKey, type Item, type Form } from '../_shared/step1-documents.ts'
import { seal, open as unseal, last4, ssnLooksValid, REVEAL_TTL_MS, REVEAL_FIELDS, REVEAL_PERMISSION, type RevealField } from '../_shared/step1-crypto.ts'
import { PERM_KEY, normalizePerms, mayApprove } from '../_shared/onboarding-permissions.ts'
import { step1FormPdf, type IdentityState } from '../_shared/step1-pdf.ts'
import { longDateTime } from '../_shared/offer-documents.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const S = (v: unknown, n = 120) => String(v ?? '').trim().slice(0, n)
const NOPE = { ok: false, error: 'This link is not valid or has run out. Please ask the office for a new one: (417) 234-8494.' }
export const BUCKET = 'onboarding-documents'
export const SCREENS = ['1', '2', '3', '4', '5a', '5b', '6', '7', '8', '9']
export const IDENTITY_IDS = ['ssn', 'dob', 'license_number']
const MAP_TABLES = new Set(['windows', 'specialties', 'matching_facts'])
const COLS = 'id,first_name,last_name,phone,email,position,onboarding_path,offer_status,offer_signed_at,pd_signed_at,offer_withdrawn_at,offer_declined_at,step1_sent_at,step1_done_at'

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
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '')

/** The door: the offer must be on the new path, both documents signed, and still open. */
// deno-lint-ignore no-explicit-any
export function dead(o: any): { status: number; body: Record<string, unknown> } | null {
  if (o.onboarding_path !== 'new') return { status: 404, body: { ...NOPE, why: 'not on the new path' } }
  if (o.offer_withdrawn_at || o.offer_declined_at || ['withdrawn', 'declined'].includes(String(o.offer_status))) return { status: 410, body: NOPE }
  if (!o.offer_signed_at || !o.pd_signed_at) return { status: 409, body: { ok: false, error: 'Please sign your offer letter and position description first; Step 1 opens right after.' } }
  return null
}
const itemsOf = (f: Form): Item[] => f.sections.flatMap((s) => s.items || [])
const formOf = (id: string): FormKey | null => { for (const k of FORM_ORDER) if (itemsOf(FORMS[k]).some((i) => i.id === id)) return k; return null }
const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length)

/** One answer, cleaned to its kind; undefined = not acceptable. */
export function clean(item: Item, v: unknown): unknown {
  const opts = item.options || []
  switch (item.kind) {
    case 'text': return typeof v === 'string' ? v.trim().slice(0, 1000) : undefined
    case 'number': { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 200 ? n : undefined }
    case 'date': return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined
    case 'yesno': return v === true || v === 'yes' ? 'yes' : v === false || v === 'no' ? 'no' : undefined
    case 'choice': return typeof v === 'string' && opts.includes(v) ? v : undefined
    case 'initials': return typeof v === 'string' && /^[A-Za-z]{2,4}$/.test(v.trim()) ? v.trim().toUpperCase() : undefined
    case 'multi': return Array.isArray(v) && v.every((x) => typeof x === 'string' && opts.includes(x)) ? [...new Set(v)] : undefined
    case 'table': {
      if (MAP_TABLES.has(item.id)) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
        const out: Record<string, unknown> = {}
        for (const [k, c] of Object.entries(v as Record<string, unknown>)) {
          if (item.id === 'windows') { if (!/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(k) || !c || typeof c !== 'object') return undefined
            const row: Record<string, unknown> = {}; for (const [kk, x] of Object.entries(c as Record<string, unknown>)) { if (!opts.includes(kk)) return undefined; row[kk] = kk === 'Hours (optional)' ? S(x, 80) : x === true } out[k] = row }
          else { if (!opts.includes(k) || !['Yes', 'Not at this time', 'Some experience', 'Lots of experience'].includes(String(c))) return undefined; out[k] = String(c) }
        }
        return out
      }
      if (!Array.isArray(v) || v.length > 20) return undefined
      const rows: string[][] = []
      for (const r of v) { if (!Array.isArray(r) || r.length > opts.length) return undefined; const row = r.map((c) => S(c, 300)); if (row.some(Boolean)) rows.push(row) }
      return rows
    }
    default: return undefined   // statement, photo: nothing to store in 2b
  }
}
const yes = (a: Record<string, unknown>, id: string) => a[id] === 'yes'
/** Which required answers are still missing on a form, after the conditional rules. */
export function missing(form: FormKey, a: Record<string, unknown>, ident: IdentityState): string[] {
  const f = FORMS[form], out: string[] = []
  const need = (id: string, ok: boolean, label?: string) => { if (!ok) out.push(label || itemsOf(f).find((i) => i.id === id)?.label || id) }
  for (const it of itemsOf(f)) {
    if (!it.required || it.locked || it.kind === 'statement' || it.kind === 'photo') continue
    if (form === 'employee_application' && it.id === 'states_lived') continue
    if (form === 'employee_application' && it.id === 'employers') continue
    if (form === 'reference_consent' && (it.id === 'professional_refs' || it.id === 'personal_refs')) continue
    if (form === 'vehicle' && it.id === 'insurance_proof' && !yes(a, 'has_insurance')) continue   // no insurance: the proof question does not apply; the driver acknowledgment carries the choice
    if (form === 'edl_fcsr_consent' && ['ssn', 'dob'].includes(it.id)) continue
    need(it.id, !empty(a[it.id]))
  }
  if (form === 'employee_application') {
    if (yes(a, 'lived_outside_mo')) need('states_lived', !empty(a.states_lived))
    if (yes(a, 'moving_violations')) need('moving_violations_detail', !empty(a.moving_violations_detail))
    if (yes(a, 'convicted')) need('convictions', !empty(a.convictions))
    if (!yes(a, 'no_employer_history')) need('employers', Array.isArray(a.employers) && a.employers.length > 0, 'Your work history (or tick "I have no previous employer to list")')
  }
  if (form === 'reference_consent') {
    const pro = Array.isArray(a.professional_refs) ? a.professional_refs.length : 0, per = Array.isArray(a.personal_refs) ? a.personal_refs.length : 0
    if (!yes(a, 'no_employer_history')) need('professional_refs', pro >= REFERENCES_REQUIRED.professional, `${REFERENCES_REQUIRED.professional} professional references`)
    need('personal_refs', per >= REFERENCES_REQUIRED.personal, `${REFERENCES_REQUIRED.personal} personal references`)
  }
  if (form === 'edl_fcsr_consent') { need('ssn', !!ident.ssn, 'Social Security number'); need('dob', ident.dob, 'Date of birth') }
  if (form === 'availability') { const w = a.windows; need('windows', !!w && typeof w === 'object' && Object.values(w as Record<string, Record<string, unknown>>).some((d) => d && Object.values(d).some((x) => x === true)), 'At least one day of availability') }
  if (form === 'vehicle' && typeof a.driver_ack === 'string' && a.driver_ack === (FORMS.vehicle.sections.at(-1)?.items?.[0]?.options?.[0] ?? '')) {
    need('license_number', !!ident.license, "Driver's license number"); need('license_state', !empty(a.license_state)); need('license_expires', !empty(a.license_expires))
  }
  return out
}
// deno-lint-ignore no-explicit-any
const identState = (i: any): IdentityState => ({ ssn: i?.ssn_last4 ? `ending ${i.ssn_last4}` : null, dob: !!i?.dob_sealed, license: i?.license_last4 ? `ending ${i.license_last4}` : null })
// deno-lint-ignore no-explicit-any
function publicSignatures(sigs: any) { const out: Record<string, { at: string; typed_name: string; version: number }> = {}; for (const [k, v] of Object.entries(sigs || {})) { const s = v as Record<string, unknown>; out[k] = { at: String(s.at), typed_name: String(s.typed_name), version: Number(s.version) } } return out }

/** Never ask twice: what the offer, the application and the interview already told us, each marked with its source. */
// deno-lint-ignore no-explicit-any
export function prefillFrom(app: any, interview: any): Record<string, { value: unknown; from: string }> {
  const out: Record<string, { value: unknown; from: string }> = {}
  const yn = (v: unknown) => v === true || v === 'yes' || v === 'Yes' ? 'yes' : v === false || v === 'no' || v === 'No' ? 'no' : null
  if (app) {
    for (const [id, col] of [['lived_outside_mo', 'lived_outside_mo'], ['has_license', 'has_license'], ['has_insurance', 'has_insurance'], ['has_transport', 'has_transport']] as const) { const v = yn(app[col]); if (v) out[id] = { value: v, from: 'your application' } }
    const yrs = Number(app.experience_years); const opts = FORMS.experience.sections.find((s) => s.h === 'Experience')?.items?.[0]?.options || []
    if (Number.isFinite(yrs) && opts.length >= 5) out.experience = { value: opts[yrs <= 0 ? 0 : yrs < 0.5 ? 1 : yrs < 2 ? 2 : yrs < 5 ? 3 : 4], from: 'your application' }
  }
  if (interview) {
    const I = interview, facts: Record<string, string> = {}
    const fact = (id: string, v: unknown) => { const t = v === 'yes' || v === 'outside' ? 'Yes' : v === 'no' ? 'Not at this time' : null; if (t) facts[MATCHING_FACTS.find((m) => m.id === id)?.label || id] = t }
    fact('cats', I.cats); fact('dogs', I.dogs); fact('smoking', I.client_smokes); fact('transportation', I.drive_clients)
    if (Object.keys(facts).length) out.matching_facts = { value: facts, from: 'your interview' }
    const sk = I.skills || {}; const sp: Record<string, string> = {}
    if (sk.dementia && sk.dementia !== 'none') { sp["Alzheimer's disease"] = 'Yes'; sp['Other dementias'] = 'Yes' }
    if (Object.keys(sp).length) out.specialties = { value: sp, from: 'your interview' }
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const secret = Deno.env.get('HUB_JOB_SECRET') ?? '', kek = Deno.env.get('STEP1_KEK') ?? ''
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  // deno-lint-ignore no-explicit-any
  const b: Record<string, any> = await req.json().catch(() => ({}))
  const action = S(b.action, 20)
  try {
    if (action === 'open') {
      const staff = await requireStaff(db, req, OFFICE_ROLES)
      if (!staff.ok) return json({ ok: false, error: staff.error }, staff.status)
      const id = S(b.offer_id, 64), form = S(b.form, 40)
      const { data: row } = await db.from('step1_forms').select('pdfs').eq('offer_id', id).maybeSingle()
      const path = row?.pdfs?.[form]
      if (!path) return json({ ok: false, error: 'That form has not been signed yet.' }, 404)
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 300)
      if (error || !data?.signedUrl) return json({ ok: false, error: 'Could not open the document.' }, 500)
      await db.from('document_access_log').insert({ offer_id: id, doc: 'step1:' + form, path, by_person: staff.person_id, by_email: staff.email, by_name: staff.name, ip: ipOf(req) })
      return json({ ok: true, url: data.signedUrl, expires_in: 300 })
    }
    /* ───── SLICE 2c (Samantha "start slice 2c", 2026-10-10): the screening desk and the identity reveal ─────
       Office staff by their own sign-in. `screening` tells the desk what is on file and whether this caller may reveal;
       `reveal` opens ONE sealed field for a person on the Admin page's Screening staff list (decision 6), with a reason,
       for REVEAL_TTL_MS; the log row, the reveal count and the trail row are written, the value is in none of them. */
    if (action === 'screening' || action === 'reveal') {
      const staff = await requireStaff(db, req, OFFICE_ROLES)
      if (!staff.ok) return json({ ok: false, error: staff.error }, staff.status)
      const oid = S(b.offer_id, 64)
      if (!/^[0-9a-f-]{8,64}$/i.test(oid)) return json({ ok: false, error: 'Which offer?' }, 400)
      const { data: permRow } = await db.from('app_data').select('data').eq('key', PERM_KEY).maybeSingle()
      const perms = normalizePerms(permRow?.data)
      const mayReveal = mayApprove(perms, REVEAL_PERMISSION, { person_id: staff.person_id, roles: staff.roles, email: staff.email })
      const { data: idr } = await db.from('step1_identity').select('ssn_last4,dob_sealed,ssn_sealed,license_sealed,license_last4,license_state,license_expires,address1,address2,city,state,zip,captured_at,purge_after,purged_at,reveals').eq('offer_id', oid).maybeSingle()
      if (action === 'screening') {
        const o = await trn().get(oid)
        const { data: fr } = await db.from('step1_forms').select('answers,signatures,completed_at').eq('offer_id', oid).maybeSingle()
        const { data: log } = await db.from('document_access_log').select('at,doc,by_name,by_email,reason').eq('offer_id', oid).like('doc', 'identity:%').order('at', { ascending: false }).limit(10)
        const a = (fr?.answers || {}) as Record<string, unknown>
        return json({ ok: true, may_reveal: mayReveal, ttl_seconds: REVEAL_TTL_MS / 1000, fields: REVEAL_FIELDS,
          identity: idr ? { ...identState(idr), license_state: idr.license_state, license_expires: idr.license_expires, captured_at: idr.captured_at, reveals: idr.reveals, purged_at: idr.purged_at, purge_after: idr.purge_after } : null,
          facts: { first: S(o?.first_name, 60), last: S(o?.last_name, 60), phone: S(o?.phone, 30), email: S(o?.email, 160), preferred_name: S(a.preferred_name, 80), other_names: S(a.other_names, 200),
            lived_outside_mo: a.lived_outside_mo ?? null, states_lived: Array.isArray(a.states_lived) ? a.states_lived : [], address: [a.address1, a.address2, [a.city, a.state, a.zip].filter(Boolean).join(' ')].map((x) => S(x, 120)).filter(Boolean).join(', ') },
          consent_signed_at: (fr?.signatures as Record<string, { at?: string }> | undefined)?.edl_fcsr_consent?.at ?? null, step1_completed_at: fr?.completed_at ?? null, reveals_log: log ?? [] })
      }
      // reveal
      if (!mayReveal) return json({ ok: false, error: 'Only a person named on the Admin page\'s Screening staff list may reveal identity details. Ask an owner to add you there.' }, 403)
      const field = S(b.field, 10) as RevealField
      if (!REVEAL_FIELDS.includes(field)) return json({ ok: false, error: 'Which field: ssn, dob or license?' }, 400)
      const reason = S(b.reason, 200)
      if (reason.length < 5) return json({ ok: false, error: 'Please say why (at least five characters): for example "FCSR registration" or "EDL check".' }, 400)
      if (!idr) return json({ ok: false, error: 'Nothing is on file for this offer yet.' }, 404)
      if (idr.purged_at) return json({ ok: false, error: 'These details were purged on ' + String(idr.purged_at).slice(0, 10) + '.' }, 410)
      const sealed = field === 'ssn' ? idr.ssn_sealed : field === 'dob' ? idr.dob_sealed : idr.license_sealed
      if (!sealed) return json({ ok: false, error: 'That detail is not on file yet.' }, 404)
      if (kek.length < 40) return json({ ok: false, error: 'The lock is not set up on the server.' }, 500)
      let value = ''
      try { value = await unseal(kek, oid, sealed) } catch { return json({ ok: false, error: 'The sealed value could not be opened. Tell Claude.' }, 500) }
      const at = new Date().toISOString()
      const { error: lErr } = await db.from('document_access_log').insert({ offer_id: oid, doc: 'identity:' + field, path: '(sealed; revealed for ' + (REVEAL_TTL_MS / 60000) + ' minutes)', by_person: staff.person_id, by_email: staff.email, by_name: staff.name, ip: ipOf(req), reason })
      if (lErr) return json({ ok: false, error: 'The reveal could not be logged, so nothing is shown.' }, 500)
      await db.from('step1_identity').update({ reveals: Number(idr.reveals || 0) + 1, updated_at: at }).eq('offer_id', oid)
      try { await trn().event({ offer_id: oid, kind: 'identity_revealed', by_who: 'staff', channel: 'hub', detail: { field, by_name: staff.name, by_email: staff.email, reason } }) } catch { /* the log row is the record; the trail is a courtesy */ }
      return json({ ok: true, field, value, revealed_at: at, expires_in: REVEAL_TTL_MS / 1000, by: staff.name })
    }
    const id = S(b.o, 64)
    if (!(await checkLink(secret, 'step1', id, b.e, b.t))) return json(NOPE, 401)
    const T = trn()
    const o = await T.get(id); if (!o) return json(NOPE, 404)
    const gone = dead(o); if (gone) return json(gone.body, gone.status)
    const who = { first: S(o.first_name, 60), last: S(o.last_name, 60), phone: S(o.phone, 30), email: S(o.email, 160), position: S(o.position, 80) || 'Caregiver' }
    let { data: row } = await db.from('step1_forms').select('*').eq('offer_id', id).maybeSingle()
    const { data: ident } = await db.from('step1_identity').select('ssn_last4,dob_sealed,license_last4,license_state,license_expires,ssn_sealed').eq('offer_id', id).maybeSingle()
    const IS = identState(ident)
    const sigs = (row?.signatures || {}) as Record<string, Record<string, unknown>>
    const now = () => new Date().toISOString()

    if (action === 'view') {
      if (!row) {
        const { data: made, error } = await db.from('step1_forms').insert({ offer_id: id, started_at: now(), current_screen: '1' }).select('*').maybeSingle()
        if (error) { const again = await db.from('step1_forms').select('*').eq('offer_id', id).maybeSingle(); row = again.data } else row = made
        if (row) await T.event({ offer_id: id, kind: 'step1_started', by_who: 'caregiver', channel: 'page', detail: { ip: ipOf(req), agent: agentOf(req) } })
      }
      // never ask twice: the application (by email, then by phone) and its interview answers
      // deno-lint-ignore no-explicit-any
      let app: any = null
      try {
        if (who.email) { const r = await db.from('job_applicants').select('*').ilike('email', who.email).order('created_at', { ascending: false }).limit(1); app = r.data?.[0] ?? null }
        if (!app && digits(who.phone).length >= 10) { const r = await db.from('job_applicants').select('*').ilike('phone', '%' + digits(who.phone).slice(-4)).order('created_at', { ascending: false }).limit(20); app = (r.data ?? []).find((x: { phone?: string }) => digits(x.phone).slice(-10) === digits(who.phone).slice(-10)) ?? null }
      } catch { app = null }
      const forms = [] as Record<string, unknown>[]
      for (let i = 0; i < FORM_ORDER.length; i++) { const f = FORMS[FORM_ORDER[i]]; forms.push({ key: f.key, screen: f.screen, title: f.title, version: f.version, status: f.status, intro: f.intro || [], sections: f.sections, certification: f.certification, signature: f.signature, fingerprint: await formFingerprint(f.key), approved_for_real: APPROVED_FOR_REAL[f.key] === f.version }) }
      return json({ ok: true, who, forms, order: FORM_ORDER, screens: SCREENS, answers: row?.answers || {}, signatures: publicSignatures(sigs), identity: { ...IS, license_state: ident?.license_state ?? null, license_expires: ident?.license_expires ?? null },
        prefill: prefillFrom(app, app?.post_interview || null), hints: { availability: S(app?.availability, 300) || null, travel: S(app?.post_interview?.travel_areas, 200) || null },
        current_screen: row?.current_screen || '1', started_at: row?.started_at || null, completed_at: row?.completed_at || null, esign_consent_at: row?.esign_consent_at || null,
        test_mode: true, references_required: REFERENCES_REQUIRED, signed_count: Object.keys(sigs).length, form_count: FORM_ORDER.length })
    }
    if (!row) return json({ ok: false, error: 'Please open your Step 1 link first.' }, 409)
    if (action === 'begin') {
      if (b.esign_consent !== true) return json({ ok: false, error: 'Please tick "I agree to complete and sign my Step 1 paperwork electronically" first.' }, 400)
      if (!row.esign_consent_at) await db.from('step1_forms').update({ esign_consent_at: now(), esign_consent_detail: { ip: ipOf(req), agent: agentOf(req) }, current_screen: '2' }).eq('offer_id', id).is('esign_consent_at', null)
      return json({ ok: true })
    }
    if (action === 'save') {
      const screen = S(b.screen, 4); if (screen && !SCREENS.includes(screen)) return json({ ok: false, error: 'Which screen?' }, 400)
      const incoming = (b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers)) ? b.answers as Record<string, unknown> : {}
      const merged = { ...(row.answers || {}) } as Record<string, unknown>; const rejected: string[] = []
      for (const [k, v] of Object.entries(incoming)) {
        if (IDENTITY_IDS.includes(k)) return json({ ok: false, error: 'The Social Security number, date of birth and license number go through the locked door, never here.' }, 400)
        if (k === 'initials') { const c = clean({ id: 'initials', label: '', kind: 'initials' }, v); if (c === undefined) rejected.push(k); else merged.initials = c; continue }
        const fk = formOf(k); if (!fk) { rejected.push(k); continue }
        if (sigs[fk]) return json({ ok: false, error: `${FORMS[fk].title} is already signed, so its answers cannot change. If something is wrong, call the office: (417) 234-8494.` }, 409)
        const item = itemsOf(FORMS[fk]).find((i) => i.id === k)!
        if (v == null || v === '') { delete merged[k]; continue }
        const c = clean(item, v); if (c === undefined) { rejected.push(k); continue }
        merged[k] = c
      }
      const upd: Record<string, unknown> = { answers: merged }; if (screen) upd.current_screen = screen
      const { error } = await db.from('step1_forms').update(upd).eq('offer_id', id)
      if (error) return json({ ok: false, error: 'Could not save: ' + error.message }, 500)
      return json({ ok: true, saved: Object.keys(incoming).length - rejected.length, rejected })
    }
    if (action === 'identity') {
      if (kek.length < 40) return json({ ok: false, error: 'The lock is not set up on the server. Nothing was saved.' }, 500)
      const upd: Record<string, unknown> = { updated_at: now() }; const did: string[] = []
      if (b.ssn != null) {
        if (sigs.edl_fcsr_consent) return json({ ok: false, error: 'The consent form is already signed, so the Social Security number and date of birth cannot change here. Call the office: (417) 234-8494.' }, 409)
        const ssn = digits(b.ssn), ssn2 = digits(b.ssn2)
        if (ssn !== ssn2) return json({ ok: false, error: 'The two Social Security numbers do not match. Please type it twice, digits only.' }, 400)
        if (!ssnLooksValid(ssn)) return json({ ok: false, error: 'That does not look like a Social Security number. Please check it.' }, 400)
        upd.ssn_sealed = await seal(kek, id, ssn); upd.ssn_last4 = last4(ssn); did.push('ssn')
      }
      if (b.dob != null) {
        if (sigs.edl_fcsr_consent) return json({ ok: false, error: 'The consent form is already signed. Call the office: (417) 234-8494.' }, 409)
        const dob = S(b.dob, 10); const t = Date.parse(dob)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !Number.isFinite(t) || t > Date.now() - 16 * 365.25 * 86400000 || t < Date.parse('1900-01-01')) return json({ ok: false, error: 'Please enter your date of birth as a full date (you must be at least 16).' }, 400)
        upd.dob_sealed = await seal(kek, id, dob); did.push('dob')
      }
      if (b.license_number != null) {
        if (sigs.vehicle) return json({ ok: false, error: 'The vehicle form is already signed. Call the office: (417) 234-8494.' }, 409)
        const ln = S(b.license_number, 30).replace(/\s+/g, '').toUpperCase()
        if (!/^[A-Z0-9-]{4,20}$/.test(ln)) return json({ ok: false, error: 'Please enter the license number as it appears on the card (letters and numbers).' }, 400)
        upd.license_sealed = await seal(kek, id, ln); upd.license_last4 = last4(ln); did.push('license')
        if (b.license_state != null) upd.license_state = S(b.license_state, 2).toUpperCase() || null
        if (b.license_expires != null) upd.license_expires = /^\d{4}-\d{2}-\d{2}$/.test(S(b.license_expires, 10)) ? S(b.license_expires, 10) : null
      }
      if (!did.length) return json({ ok: false, error: 'Nothing to save.' }, 400)
      const { error } = await db.from('step1_identity').upsert({ offer_id: id, ...upd }, { onConflict: 'offer_id' })
      if (error) return json({ ok: false, error: 'Could not save: ' + error.message }, 500)
      const after = await db.from('step1_identity').select('ssn_last4,dob_sealed,license_last4,license_state,license_expires').eq('offer_id', id).maybeSingle()
      return json({ ok: true, saved: did, identity: { ...identState(after.data), license_state: after.data?.license_state ?? null, license_expires: after.data?.license_expires ?? null } })
    }
    if (action === 'copies') {
      const out: Record<string, string> = {}
      for (const [k, p] of Object.entries((row.pdfs || {}) as Record<string, string>)) { const { data } = await db.storage.from(BUCKET).createSignedUrl(p, 600); if (data?.signedUrl) out[k] = data.signedUrl }
      return json({ ok: true, copies: out, expires_in: 600 })
    }
    if (action === 'sign') {
      const form = S(b.form, 40) as FormKey
      if (!FORM_ORDER.includes(form)) return json({ ok: false, error: 'Which form?' }, 400)
      if (!row.esign_consent_at) return json({ ok: false, error: 'Please agree to sign electronically on the first screen before signing a form.' }, 409)
      if (b.consent !== true) return json({ ok: false, error: 'Please tick "I agree to sign this form electronically" first.' }, 400)
      const name = S(b.typed_name, 80)
      if (!/^\S+(\s+\S+)+$/.test(name) || name.length < 4) return json({ ok: false, error: 'Please type your full name, first and last, exactly as you want it on the form.' }, 400)
      if (sigs[form]) return json({ ok: false, error: 'This form is already signed. A signed form is never changed; if something is wrong, call the office: (417) 234-8494.', already: true }, 409)
      const before = FORM_ORDER.slice(0, FORM_ORDER.indexOf(form)).filter((k) => !sigs[k])
      if (before.length) return json({ ok: false, error: `Please sign ${FORMS[before[0]].title} first; the forms go in order.` }, 409)
      const answers = { ...(row.answers || {}) } as Record<string, unknown>
      if (FORMS[form].signature === 'typed+initials') { const ini = clean({ id: 'initials', label: '', kind: 'initials' }, b.initials ?? answers.initials); if (ini === undefined) return json({ ok: false, error: 'Please add your initials beside the AxisCare scheduling line.' }, 400); answers.initials = ini }
      const miss = missing(form, answers, IS)
      if (miss.length) return json({ ok: false, error: 'Please answer these first: ' + miss.join('; ') + '.', missing: miss }, 400)
      const at = now(), ip = ipOf(req), agent = agentOf(req), version = FORMS[form].version, fp = await formFingerprint(form)
      const sig = { at, typed_name: name, ip, agent, version, fingerprint: fp, consent: true }
      // 1. the signature, only while still unsigned (a race cannot sign twice; the trigger refuses a change anyway)
      const { data: wrote, error: wErr } = await db.from('step1_forms').update({ signatures: { ...sigs, [form]: sig }, answers }).eq('offer_id', id).filter('signatures->' + form, 'is', null).select('offer_id')
      if (wErr || !wrote?.length) return json({ ok: false, error: 'This form was just signed. A signed form is never changed.', already: true }, 409)
      await T.event({ offer_id: id, kind: 'step1_signed', by_who: 'caregiver', channel: 'page', doc_version: version, fingerprint: fp, detail: { form, typed_name: name, ip, agent, consent: true, signed_at: at } })
      // 2. the PDF: the same words as the screen with the answers, written once, never overwritten
      const bytes = step1FormPdf(FORMS[form], answers, who, IS, { typedName: name, signedAtCentral: longDateTime(at), signedAtUtc: at, ip, agent, version, fingerprint: fp, offerId: id, docName: FORMS[form].title }, FORM_ORDER.indexOf(form) + 1, FORM_ORDER.length)
      const path = `step1/${id}/${form}-v${version}-${at.replace(/[:.]/g, '-')}.pdf`
      const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false })
      let pdfOk = true
      if (up.error) { pdfOk = false; await T.event({ offer_id: id, kind: 'step1_signed', by_who: 'system', channel: 'page', doc_version: version, fingerprint: fp, result: 'pdf_failed', detail: { form, error: String(up.error.message || up.error).slice(0, 200) } }) }
      else await db.from('step1_forms').update({ pdfs: { ...(row.pdfs || {}), [form]: path } }).eq('offer_id', id).filter('pdfs->' + form, 'is', null)
      // 3. the last signature completes Step 1: the record, the trail, and the offer record the office reads
      const allSigned = FORM_ORDER.every((k) => k === form || sigs[k])
      let done = false
      if (allSigned) {
        const { data: fin } = await db.from('step1_forms').update({ completed_at: at, current_screen: '9', receipt: { completed_at: at, forms: FORM_ORDER.length } }).eq('offer_id', id).is('completed_at', null).select('offer_id')
        done = !!fin?.length
        if (done) { await T.event({ offer_id: id, kind: 'step1_done', by_who: 'caregiver', channel: 'page', detail: { forms: FORM_ORDER.length, ip, agent } }); await T.patch(id, { step1_done_at: at }, '&step1_done_at=is.null') }
      }
      const cp = pdfOk ? await db.storage.from(BUCKET).createSignedUrl(path, 600) : { data: null }
      return json({ ok: true, form, signed_at: at, version, fingerprint: fp, pdf: pdfOk, copy_url: cp.data?.signedUrl ?? null, done, signed_count: Object.keys(sigs).length + 1, form_count: FORM_ORDER.length })
    }
    return json({ ok: false, error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ ok: false, error: 'Something went wrong: ' + ((e as Error).message || 'error') + '. Nothing was changed.' }, 500)
  }
})
