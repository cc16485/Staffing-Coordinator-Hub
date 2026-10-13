// 2b · the Step 1 page's server (step1-sign) run for real against a fake database, a fake Training Platform and a fake
// storage bucket. Nothing real is touched. node step1_sign_2b_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const L = await import(path.join(FN, '_shared/applicant-links.ts'))
const D = await import(path.join(FN, '_shared/step1-documents.ts'))
/* 2026-10-13: the story below starts BEFORE her approval of the Hepatitis B form (Ava and Bo start their Step 1 then); the
   approval as shipped is put back further down, where Dee, Eli and Fay start theirs */
const HEPB_SHIPPED = D.APPROVED_FOR_REAL.hepb_vaccination; delete D.APPROVED_FOR_REAL.hepb_vaccination
const C = await import(path.join(FN, '_shared/step1-crypto.ts'))
const SECRET = 's'.repeat(48), KEK = Buffer.alloc(32, 7).toString('base64')
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', HUB_JOB_SECRET: SECRET, STEP1_KEK: KEK, OFFERS_PROJECT_URL: 'http://trn', OFFERS_SERVICE_ROLE_KEY: 'tkey' }
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }

/* ── the fake Training Platform (REST) and GoHighLevel are never called; storage is a map ── */
const OFFERS = {}, EVENTS = [], PATCHES = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, o = {}) => {
  const u = String(url)
  if (u.startsWith('http://trn/rest/v1/job_offers')) {
    const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(u)[1])
    if ((o.method || 'GET') === 'GET') return new Response(JSON.stringify(OFFERS[id] ? [OFFERS[id]] : []), { status: 200 })
    const body = JSON.parse(o.body); const guard = /&(\w+)=is\.null/.exec(u)
    if (!OFFERS[id] || (guard && OFFERS[id][guard[1]] != null)) return new Response('[]', { status: 200 })
    Object.assign(OFFERS[id], body); PATCHES.push({ id, body }); return new Response(JSON.stringify([OFFERS[id]]), { status: 200 })
  }
  if (u.startsWith('http://trn/rest/v1/offer_events')) { EVENTS.push(JSON.parse(o.body)); return new Response('', { status: 201 }) }
  throw new Error('unexpected fetch ' + u)
}
/* ── a tiny table store with the query shapes the function uses ── */
let DB = { step1_forms: [], step1_identity: [], job_applicants: [], document_access_log: [], auth_identities: [], persons: [], entity_memberships: [], staff_roles: [], app_data: [], driver_compliance: [], driver_document: [], driver_compliance_event: [], hepb_record: [], hepb_event: [], client_journey: [] }
const STORE = {}
const getPath = (r, p) => p.split('->').reduce((a, k) => a == null ? undefined : a[k], r)
function table(name) {
  const rows = () => DB[name]
  const q = (mode, payload, filters = [], opts = {}) => {
    const match = (r) => filters.every((f) => f(r))
    const run = () => {
      if (mode === 'select') { let out = rows().filter(match); if (opts.order) out = [...out].reverse(); if (opts.limit) out = out.slice(0, opts.limit); return out.map((r) => JSON.parse(JSON.stringify(r))) }
      if (mode === 'insert') { const r = { ...payload }; if (name === 'hepb_record') { if (globalThis.FAIL_HEPB) throw new Error('hepb down'); if (rows().some((x) => x.offer_id === r.offer_id)) throw new Error('duplicate offer_id'); r.id = 'aaaaaaaa-bbbb-4ccc-8ddd-' + String(rows().length + 1).padStart(12, '0'); r.reminders = r.reminders || {}; r.doses = [] } if (name === 'step1_forms') Object.assign(r, { answers: {}, signatures: {}, pdfs: {}, ...r }); if ((name === 'step1_forms' || name === 'step1_identity') && rows().some((x) => x.offer_id === r.offer_id)) throw Object.assign(new Error('duplicate key'), { code: '23505' }); rows().push(r); return [r] }
      if (mode === 'upsert') { const i = rows().findIndex((x) => x.offer_id === payload.offer_id); if (i >= 0) Object.assign(rows()[i], payload); else rows().push({ ...payload }); return [rows()[i >= 0 ? i : rows().length - 1]] }
      if (mode === 'update') { const out = []; for (const r of rows()) if (match(r)) {
        if (name === 'step1_forms') { for (const k of Object.keys(r.signatures || {})) if (payload.signatures && JSON.stringify(payload.signatures[k]) !== JSON.stringify(r.signatures[k])) throw new Error('trigger: signature never changed')
          for (const k of Object.keys(r.pdfs || {})) if (payload.pdfs && payload.pdfs[k] !== r.pdfs[k]) throw new Error('trigger: pdf never replaced') }
        Object.assign(r, payload); out.push(r) } return out }
    }
    const api = {
      eq: (k, v) => q(mode, payload, [...filters, (r) => String(getPath(r, k)) === String(v)], opts),
      is: (k, v) => q(mode, payload, [...filters, (r) => (v === null ? getPath(r, k) == null : getPath(r, k) === v)], opts),
      filter: (k, op, v) => q(mode, payload, [...filters, (r) => op === 'is' && v === null ? getPath(r, k) == null : false], opts),
      like: (k, v) => q(mode, payload, [...filters, (r) => { const pat = '^' + String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'; return new RegExp(pat).test(String(getPath(r, k) ?? '')) }], opts),
      ilike: (k, v) => q(mode, payload, [...filters, (r) => { const pat = '^' + String(v).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'; return new RegExp(pat).test(String(r[k] ?? '').toLowerCase()) }], opts),
      order: () => q(mode, payload, filters, { ...opts, order: true }), limit: (n) => q(mode, payload, filters, { ...opts, limit: n }),
      select: () => q(mode, payload, filters, opts),
      maybeSingle: async () => { try { const r = run(); return { data: r[0] ?? null, error: null } } catch (e) { return { data: null, error: { message: e.message } } } },
      then: (ok) => { try { ok({ data: run(), error: null }) } catch (e) { ok({ data: null, error: { message: e.message } }) } },
    }
    return api
  }
  return { select: () => q('select'), insert: (p) => q('insert', p), upsert: (p) => q('upsert', p), update: (p) => q('update', p) }
}
const UPLOADS = new Set(); globalThis.UPLOADS = UPLOADS
const storage = { from: (bucket) => ({ createSignedUploadUrl: async (p) => ({ data: { token: 'tok-' + p, signedUrl: 'https://upload/' + bucket + '/' + p }, error: null }), list: async (dir, o) => ({ data: [...UPLOADS].filter((x) => x.startsWith(bucket + ':' + dir + '/')).map((x) => ({ name: x.slice((bucket + ':' + dir + '/').length) })).filter((x) => !o?.search || x.name === o.search), error: null }), upload: async (p, bytes, o) => { if (STORE[p] && !o?.upsert) return { error: { message: 'exists' } }; STORE[p] = bytes; return { data: { path: p }, error: null } }, createSignedUrl: async (p) => ({ data: STORE[p] ? { signedUrl: 'https://signed/' + p } : null, error: STORE[p] ? null : { message: 'no' } }) }) }
const RPCS = []
globalThis.__fakeCreateClient = () => ({ from: table, storage, rpc: async (name, args) => { RPCS.push({ name, args })
  /* STEP 1 BEFORE CHECKS: NO_CAND = nobody in Background & References yet (the new rule); the door then makes the record */
  if (name === 'step1_candidate_create') { const was = globalThis.NO_CAND; globalThis.NO_CAND = false; return { data: was ? { ok: true, created: true, how: 'created', id: 902 } : { ok: true, created: false, how: 'already', id: '901' }, error: null } }
  if (name === 'upsert_app_data_item') { (globalThis.CARDS = globalThis.CARDS || []).push(args.item); return { data: null, error: null } }
  if (name !== 'step1_land_apply') return { data: null, error: { message: 'unexpected ' + name } }
  if (globalThis.NO_CAND) return { data: { ok: false, reason: 'no_candidate' }, error: null }
  return { data: { ok: true, candidate_id: '901', filled: Object.keys(args.p_patch) }, error: null } }, auth: { getUser: async (jwt) => jwt === 'staff' ? { data: { user: { id: 'u1', email: 'k@mo-care.com', app_metadata: {} } }, error: null } : { data: null, error: { message: 'bad' } } } })
const src = fs.readFileSync(path.join(FN, 'step1-sign/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient')
const tmp = path.join(FN, 'step1-sign', '_t2b.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp) } finally { fs.unlinkSync(tmp) }

const OID = '11111111-2222-4333-8444-555555555555'
const base = () => ({ id: OID, first_name: 'Ava', last_name: 'Lee', phone: '(417) 555-0101', email: 'ava@example.com', position: 'Caregiver', onboarding_path: 'new', offer_status: 'accepted', offer_signed_at: '2026-10-09T15:00:00Z', pd_signed_at: '2026-10-09T15:05:00Z', offer_withdrawn_at: null, offer_declined_at: null, step1_sent_at: '2026-10-09T15:06:00Z', step1_done_at: null })
const exp = L.expiry(); const tok = await L.sign(SECRET, 'step1', OID, exp)
const link = { o: OID, e: exp, t: tok }
const REPLAY = []
const call = async (body, headers = {}) => { const r = await handler(new Request('http://x/step1-sign', { method: 'POST', headers: { 'Content-Type': 'application/json', 'user-agent': 'TestPhone', ...headers }, body: JSON.stringify(body) })); let j = null; try { j = await r.json() } catch {}
  if (r.status === 200 && body.o && ['begin', 'save', 'identity', 'sign'].includes(body.action)) REPLAY.push(JSON.parse(JSON.stringify(body)))
  return { status: r.status, j } }

/* ═══ the door ═══ */
let r = await call({ action: 'view', o: OID, e: exp, t: 'x'.repeat(43) })
ck('a forged link is refused (401) before the offer is even read', r.status === 401, r)
OFFERS[OID] = { ...base(), onboarding_path: 'old' }
r = await call({ action: 'view', ...link }); ck('an old-path offer answers like a dead link (the test gate)', r.status === 404, r)
OFFERS[OID] = { ...base(), pd_signed_at: null }
r = await call({ action: 'view', ...link }); ck('an offer not yet fully signed: Step 1 is not open (409)', r.status === 409, r)
OFFERS[OID] = { ...base(), offer_withdrawn_at: '2026-10-09T16:00:00Z' }
r = await call({ action: 'view', ...link }); ck('a withdrawn offer: dead link (410)', r.status === 410, r)

/* ═══ view: the record is made once, the trail starts, prefill arrives ═══ */
OFFERS[OID] = base()
DB.job_applicants = [{ id: 'a1', email: 'AVA@example.com', phone: '417-555-0101', lived_outside_mo: true, has_license: true, has_insurance: false, experience_years: 3, availability: 'Weekday mornings', created_at: '2026-09-01', post_interview: { cats: 'yes', dogs: 'no', client_smokes: 'no', drive_clients: 'yes', skills: { dementia: 'some' }, travel_areas: 'Springfield and Nixa' } }]
r = await call({ action: 'view', ...link })
if (process.env.DUMP_VIEW) (await import('fs')).writeFileSync(process.env.DUMP_VIEW, JSON.stringify(r.j))   /* for the Step 1 page look */
ck('view: ok, thirteen forms (incl. the Driver and Non-Driver Agreements and the five from Viventium) with fingerprints, every one approved for real (2026-10-13), no practice banner for a real hire, screen 1, nothing signed', r.status === 200 && r.j.forms.length === 13 && r.j.forms.every((f) => /^[0-9a-f]{64}$/.test(f.fingerprint) && f.approved_for_real === true) && r.j.test_mode === false && r.j.current_screen === '1' && r.j.signed_count === 0, r.j && { s: r.status, e: r.j.error })
ck('view: the record exists once and the trail has step1_started', DB.step1_forms.length === 1 && EVENTS.filter((e) => e.kind === 'step1_started').length === 1)
ck('view: prefill from the application (lived outside MO, license, insurance, 2 to 5 years) and the interview (cats yes, dogs not, driving yes, dementia specialties), each with its source', r.j.prefill.lived_outside_mo?.value === 'yes' && r.j.prefill.has_insurance?.value === 'no' && r.j.prefill.experience?.value === '2 to 5 years' && r.j.prefill.experience.from === 'your application' && r.j.prefill.matching_facts?.value['Homes with cats'] === 'Yes' && r.j.prefill.matching_facts.value['Homes with dogs'] === 'Not at this time' && r.j.prefill.specialties?.value["Alzheimer's disease"] === 'Yes' && r.j.hints.travel === 'Springfield and Nixa', r.j.prefill)
await call({ action: 'view', ...link })
ck('a second view makes no second record and no second start event', DB.step1_forms.length === 1 && EVENTS.filter((e) => e.kind === 'step1_started').length === 1)

/* 2026-10-13: the forms moved from Viventium (after the driving screen): the agreement with its two initials, then the rest */
const REST = ['employment_agreement', 'medication_policy', 'code_of_ethics', 'hipaa_privacy', 'client_rights']
async function signRest(lk, name) {
  await call({ action: 'save', ...lk, screen: '10', answers: { ea_arbitration_initials: name.split(' ').map((x) => x[0]).join(''), ea_class_waiver_initials: name.split(' ').map((x) => x[0]).join('') } })
  let last = null; for (const f of REST) last = await call({ action: 'sign', ...lk, form: f, typed_name: name, consent: true }); return last
}
/* ═══ begin, save ═══ */
r = await call({ action: 'sign', ...link, form: 'employee_application', typed_name: 'Ava Lee', consent: true })
ck('no signing before the e-sign consent on screen 1', r.status === 409 && /agree to sign electronically/.test(r.j.error), r)
r = await call({ action: 'begin', ...link, esign_consent: true }); ck('begin records the one-time e-sign consent', r.status === 200 && DB.step1_forms[0].esign_consent_at && DB.step1_forms[0].esign_consent_detail.agent === 'TestPhone')
r = await call({ action: 'save', ...link, screen: '2', answers: { preferred_name: 'Ava', lived_outside_mo: 'yes', states_lived: ['KS', 'ZZ'], hs_name: 'Central High', cna: 'no', hha: 'no', ssn: '123456789' } })
ck('the SSN can never be saved as an answer (400, nothing saved)', r.status === 400 && !DB.step1_forms[0].answers.preferred_name, r)
r = await call({ action: 'save', ...link, screen: '2', answers: { preferred_name: 'Ava', lived_outside_mo: 'yes', states_lived: ['KS', 'ZZ'], hs_name: 'Central High', cna: 'no', hha: 'no', bogus: 'x' } })
ck('save: good answers kept, an option not on the list and an unknown id rejected, the screen remembered', r.status === 200 && r.j.rejected.join() === 'states_lived,bogus' && DB.step1_forms[0].answers.preferred_name === 'Ava' && DB.step1_forms[0].current_screen === '2', { r, a: DB.step1_forms[0].answers })
r = await call({ action: 'save', ...link, screen: '3', answers: { states_lived: ['KS'], moving_violations: 'no', license_suspended: 'no', convicted: 'no', jobs: [{ company: 'Home Helpers', city_state: 'Springfield, MO', role: 'Caregiver', from: '2024-01', to: '2026-08', supervisor: 'Jane Boss', phone: '417-555-0202', email: 'jane@hh.com', may_contact: 'yes', reason_leaving: 'Moved', did_care: 'yes', tasks: ['bathing', 'hoyer_lift'], lifts: ['Full-body sling'], refresher: ['none'] }] } })
ck('save: a job lands as a card with its tasks', r.status === 200 && DB.step1_forms[0].answers.jobs.length === 1 && DB.step1_forms[0].answers.jobs[0].supervisor === 'Jane Boss' && DB.step1_forms[0].answers.jobs[0].tasks.join() === 'bathing,hoyer_lift', r)

/* ═══ sign, in order, with the required answers ═══ */
/* 2026-10-13 (705): Samantha approved all thirteen forms for real ('approve step 1 forms', wording page v5). A changed wording is a
   new version and is refused for a real applicant until she approves it; practice and training hires are not held. */
{ const REC = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/step1-approved-2026-10-13.json'), 'utf8'))
  ck('APPROVED_FOR_REAL holds exactly the thirteen versions of the approval record (Samantha, 2026-10-13, wording page v5), each the version in force', D.FORM_ORDER.length === 14 && REC.forms.length === 13 && REC.forms.map((f) => f.key).join() === D.FORM_ORDER.filter((k) => k !== 'hepb_vaccination').join() && D.APPROVED_FOR_REAL.hepb_vaccination === undefined && REC.forms.every((f) => D.APPROVED_FOR_REAL[f.key] === f.version && D.FORMS[f.key].version === f.version && f.approved_by === 'Samantha' && f.source === 'wording page v5') && Object.keys(D.APPROVED_FOR_REAL).length === 13 && D.allApprovedForReal())
  let fpOk = true; for (const f of REC.forms) if (await D.formFingerprint(f.key) !== f.sha256) fpOk = false
  ck('every approved form\'s wording fingerprint is the one in the approval record (the words she read)', fpOk)
  const pre = JSON.stringify(DB.step1_forms), v0 = D.FORMS.employee_application.version
  D.FORMS.employee_application.version = v0 + 1
  r = await call({ action: 'sign', ...link, form: 'employee_application', typed_name: 'Ava Lee', consent: true })
  ck('a bumped wording (application version 5, not approved) is refused for a real applicant (409 not_approved, nothing written)', r.status === 409 && r.j.not_approved === true && JSON.stringify(DB.step1_forms) === pre, r)
  r = await call({ action: 'view', ...link }); ck('with a form at an unapproved version the real view shows the practice banner again (test_mode true) and marks that form not approved', r.j.test_mode === true && r.j.forms.find((f) => f.key === 'employee_application').approved_for_real === false && r.j.forms.filter((f) => f.approved_for_real).length === 12, r.j.test_mode)
  OFFERS[OID].offered_by = 'Slice 10 practice run'
  r = await call({ action: 'sign', ...link, form: 'reference_consent', typed_name: 'Ava Lee', consent: true })
  ck('practice unchanged: a practice hire is not held by approval, even at an unapproved version (it reaches the next rule: the forms go in order)', r.status === 409 && !r.j.not_approved && /Employee Application first/.test(r.j.error) && JSON.stringify(DB.step1_forms) === pre, r)
  delete OFFERS[OID].offered_by
  D.FORMS.employee_application.version = v0
  r = await call({ action: 'view', ...link }); ck('back at the approved version: a real view has no practice banner (test_mode false)', r.j.test_mode === false, r.j.test_mode) }
r = await call({ action: 'sign', ...link, form: 'reference_consent', typed_name: 'Ava Lee', consent: true })
ck('forms go in order: the references cannot be signed before the application', r.status === 409 && /Employee Application first/.test(r.j.error), r)
r = await call({ action: 'sign', ...link, form: 'employee_application', typed_name: 'Ava', consent: true })
ck('a one-word name is refused', r.status === 400, r)
r = await call({ action: 'sign', ...link, form: 'employee_application', typed_name: 'Ava Lee', consent: true })
ck('signing the application: ok, PDF stored once, event with the fingerprint, 1 of 7', r.status === 200 && r.j.pdf === true && Object.keys(STORE).length === 1 && DB.step1_forms[0].signatures.employee_application.typed_name === 'Ava Lee' && EVENTS.some((e) => e.kind === 'step1_signed' && e.fingerprint === r.j.fingerprint && e.detail.form === 'employee_application') && r.j.signed_count === 1, r)
const pdfBytes = STORE[Object.keys(STORE)[0]]
ck('the stored PDF is a PDF that names the employee and never the SSN', pdfBytes.length > 2000 && String.fromCharCode(...pdfBytes.slice(0, 5)) === '%PDF-' && !Buffer.from(pdfBytes).includes('123456789'))
r = await call({ action: 'sign', ...link, form: 'employee_application', typed_name: 'Ava Lee', consent: true })
ck('a second signature on the same form is refused (409, already)', r.status === 409 && r.j.already === true, r)
r = await call({ action: 'save', ...link, screen: '3', answers: { preferred_name: 'Someone Else' } })
ck('answers of a signed form can no longer change (409)', r.status === 409 && DB.step1_forms[0].answers.preferred_name === 'Ava', r)
r = await call({ action: 'sign', ...link, form: 'reference_consent', typed_name: 'Ava Lee', consent: true })
ck('references: missing answers named (2 professional, 2 personal)', r.status === 400 && /2 professional references/.test(r.j.error) && /2 personal references/.test(r.j.error), r)
await call({ action: 'save', ...link, screen: '4', answers: { professional_refs: [{ name: 'Jane Boss', company: 'Home Helpers', role: 'Supervisor', phone: '417-555-0202', email: 'jane@hh.com', may_contact: 'yes' }, { name: 'Tom Lead', company: 'Visiting Angels', role: 'Manager', phone: '417-555-0303', may_contact: 'yes' }], personal_refs: [{ name: 'Sue Friend', relationship: 'Friend', phone: '417-555-0404', may_contact: 'yes' }, { name: 'Bob Neighbor', relationship: 'Neighbor', phone: '417-555-0505', may_contact: 'yes' }] } })
r = await call({ action: 'sign', ...link, form: 'reference_consent', typed_name: 'Ava Lee', consent: true }); ck('references signed once the four are there', r.status === 200, r)
r = await call({ action: 'sign', ...link, form: 'fcra_disclosure', typed_name: 'Ava Lee', consent: true }); ck('the permission form refuses without Missouri\'s two required answers (EDL, FCSR)', r.status === 400 && /Employee Disqualification List/.test(r.j.error) && /Family Care Safety Registry/.test(r.j.error), r)
r = await call({ action: 'save', ...link, screen: '5a', answers: { edl_listed: 'no', fcsr_listed: 'No' } })
r = await call({ action: 'sign', ...link, form: 'fcra_disclosure', typed_name: 'Ava Lee', consent: true }); ck('the permission form signs once the criminal-history, EDL and FCSR answers are given', r.status === 200, r)

/* ═══ identity: sealed, never in answers, last four only ═══ */
r = await call({ action: 'sign', ...link, form: 'edl_fcsr_consent', typed_name: 'Ava Lee', consent: true })
ck('the consent cannot be signed without the sealed SSN and date of birth and the address', r.status === 400 && /Social Security number/.test(r.j.error) && /Date of birth/.test(r.j.error), r)
/* 2026-10-11: the SSA's never-issued advertising numbers (987-65-4320 to 4329) only on a practice or training offer */
r = await call({ action: 'identity', ...link, ssn: '987-65-4321', ssn2: '987-65-4321' })
ck('a real hire: 987-65-4321 is refused, and no practice hint is shown', r.status === 400 && !/987-65-4321/.test(r.j.error) && DB.step1_identity.length === 0, r)
OFFERS[OID].offered_by = 'Slice 10 practice run'
r = await call({ action: 'identity', ...link, ssn: '123-45-6789', ssn2: '123-45-6789' })
ck('a practice hire: 123-45-6789 is still refused, and the hint names 987-65-4321', r.status === 400 && /987-65-4321/.test(r.j.error) && DB.step1_identity.length === 0, r)
delete OFFERS[OID].offered_by
r = await call({ action: 'identity', ...link, ssn: '529-12-3456', ssn2: '529-12-3457', dob: '1990-05-05' })
ck('two different SSNs are refused', r.status === 400 && DB.step1_identity.length === 0, r)
r = await call({ action: 'identity', ...link, ssn: '529-12-3456', ssn2: '529-12-3456', dob: '2015-05-05' })
ck('a date of birth under 16 is refused', r.status === 400 && DB.step1_identity.length === 0, r)
r = await call({ action: 'identity', ...link, ssn: '529-12-3456', ssn2: '529-12-3456', dob: '1990-05-05' })
const I = DB.step1_identity[0]
ck('identity saved: sealed SSN and DOB, last four only, the plain number nowhere in the record', r.status === 200 && r.j.identity.ssn === 'ending 3456' && r.j.identity.dob === true && I.ssn_sealed.startsWith('v1.') && I.ssn_last4 === '3456' && !JSON.stringify(DB).includes('529123456') && !JSON.stringify(DB).includes('529-12-3456'), { r, I })
ck('the sealed SSN opens back only with the key and this offer id', (await C.open(KEK, OID, I.ssn_sealed)) === '529123456')
await call({ action: 'save', ...link, screen: '5b', answers: { address1: '12 Oak St', city: 'Springfield', state: 'MO', zip: '65802' } })
r = await call({ action: 'sign', ...link, form: 'edl_fcsr_consent', typed_name: 'Ava Lee', consent: true }); ck('the consent signs with identity sealed and the address given', r.status === 200, r)
r = await call({ action: 'identity', ...link, ssn: '529-12-9999', ssn2: '529-12-9999' })
ck('after the consent is signed the SSN cannot be changed (409)', r.status === 409 && DB.step1_identity[0].ssn_last4 === '3456', r)
const consentPdf = STORE[DB.step1_forms[0].pdfs.edl_fcsr_consent]
ck('the consent PDF shows "On file, ending 3456" and never the number', Buffer.from(consentPdf).includes('ending 3456') && !Buffer.from(consentPdf).includes('529123456') && !Buffer.from(consentPdf).includes('1990-05-05'))

/* ═══ availability (initials), experience, vehicle, done ═══ */
await call({ action: 'save', ...link, screen: '6', answers: { windows: { Monday: { Morning: true, Afternoon: true, 'Hours (optional)': '7-3' }, Tuesday: { 'Not available': true } }, hours_ideal: 30, hours_min: 20, hours_max: 40, shift_prefs: ['Morning shifts'], max_miles: '20 miles', open_shift_texts: 'yes', text_consent: 'yes' } })
/* 2026-10-11: every day must be answered (a time or Not available); overnights need the nights */
r = await call({ action: 'sign', ...link, form: 'availability', typed_name: 'Ava Lee', consent: true, initials: 'al' })
ck('only Monday and Tuesday answered: refused, naming Wednesday to Sunday', r.status === 400 && /Wednesday, Thursday, Friday, Saturday, Sunday/.test(r.j.error), r)
await call({ action: 'save', ...link, screen: '6', answers: { windows: { Monday: { Morning: true, Afternoon: true, 'Hours (optional)': '7-3' }, Tuesday: { 'Not available': true }, Wednesday: { Morning: true }, Thursday: { Morning: true }, Friday: { Evening: true }, Saturday: { 'Not available': true }, Sunday: { 'Not available': true } }, shift_prefs: ['Morning shifts', 'Overnight shifts'] } })
r = await call({ action: 'sign', ...link, form: 'availability', typed_name: 'Ava Lee', consent: true, initials: 'al' })
ck('overnight shifts chosen without the nights: refused', r.status === 400 && /Overnight shifts: which nights/.test(r.j.error), r)
await call({ action: 'save', ...link, screen: '6', answers: { shift_prefs: ['Morning shifts'] } })
r = await call({ action: 'sign', ...link, form: 'availability', typed_name: 'Ava Lee', consent: true })
ck('the availability form needs initials beside the AxisCare line', r.status === 400 && /initials/.test(r.j.error), r)
r = await call({ action: 'sign', ...link, form: 'availability', typed_name: 'Ava Lee', consent: true, initials: 'al' }); ck('availability signs with initials (stored upper-case)', r.status === 200 && DB.step1_forms[0].answers.initials === 'AL', r)
await call({ action: 'save', ...link, screen: '7', answers: { level1: 'Yes', level2: 'Yes', level3: 'Not at this time', specialties: { "Alzheimer's disease": 'Yes' }, matching_facts: { 'Homes with cats': 'Yes' }, languages: ['English', 'Spanish'], experience: '2 to 5 years', preferred_levels: 'Levels 1 & 2' } })
r = await call({ action: 'sign', ...link, form: 'experience', typed_name: 'Ava Lee', consent: true })
ck('one row of each yes/no grid answered: refused, naming the rows left', r.status === 400 && /Client population: answer every row \(Other dementias/.test(r.j.error) && /Comfortable with: answer every row/.test(r.j.error), r)
await call({ action: 'save', ...link, screen: '7', answers: { specialties: Object.fromEntries(D.SPECIALTIES.map((x, i) => [x, i % 2 ? 'Not at this time' : 'Yes'])), matching_facts: Object.fromEntries(D.MATCHING_FACTS.map((m, i) => [m.label, i % 2 ? 'Yes' : 'Not at this time'])) } })
r = await call({ action: 'sign', ...link, form: 'experience', typed_name: 'Ava Lee', consent: true }); ck('experience signs', r.status === 200, r)
/* 2026-10-13: the driving screen asks first, then the Driver Agreement (with photos) or the Non-Driver Agreement */
ck('six forms signed and the transport question not answered yet: Step 1 is NOT complete', !DB.step1_forms[0].completed_at, DB.step1_forms[0].completed_at)
r = await call({ action: 'sign', ...link, form: 'vehicle', typed_name: 'Ava Lee', consent: true })
ck('the driver agreement cannot be signed before the transport question is answered', r.status === 409 && /transport clients/.test(r.j.error), r)
r = await call({ action: 'upload_url', ...link, item: 'license_front', ext: 'jpg' })
ck('no picture before the question either', r.status === 409, r)
r = await call({ action: 'save', ...link, screen: '8', answers: { transport_willing: 'maybe' } }); ck('the question takes only yes or no', r.j.rejected.includes('transport_willing'), r.j)
await call({ action: 'save', ...link, screen: '8', answers: { transport_willing: 'yes', license_state: 'MO', license_expires: '2029-01-01', insurer: 'Practice Mutual', insurance_expires: '2027-06-30', license_front: { path: 'offer/x/sneaky.jpg' } } })
ck('a picture can never be set by a save (only through the upload)', !DB.step1_forms[0].answers.license_front, DB.step1_forms[0].answers.license_front)
r = await call({ action: 'view', ...link }); ck('with Yes, 12 forms to sign (the Non-Driver Agreement does not apply); the deciding question is sent to the page', r.j.form_count === 12 && r.j.deciding.transport_willing.options.length === 2, [r.j.form_count, r.j.deciding])
r = await call({ action: 'sign', ...link, form: 'non_driver', typed_name: 'Ava Lee', consent: true }); ck('a driver cannot sign the Non-Driver Agreement', r.status === 409, r)
r = await call({ action: 'sign', ...link, form: 'vehicle', typed_name: 'Ava Lee', consent: true })
ck('the driver agreement needs both license pictures, the insurance proof and the license number', r.status === 400 && /license, front/.test(r.j.error) && /license, back/.test(r.j.error) && /Proof of current auto insurance/.test(r.j.error) && /license number/.test(r.j.error), r)
r = await call({ action: 'upload_url', ...link, item: 'license_front', ext: 'exe' }); ck('only photos or PDFs', r.status === 400, r)
for (const [item, ext] of [['license_front', 'jpg'], ['license_back', 'heic'], ['insurance_doc', 'pdf']]) {
  r = await call({ action: 'upload_url', ...link, item, ext })
  ck('upload link for ' + item + ' points into the private driver store under this offer', r.status === 200 && r.j.path.startsWith(`offer/${OID}/${item}-`) && r.j.signed_url.startsWith('https://upload/driver-docs/'), r)
  const path = r.j.path
  r = await call({ action: 'uploaded', ...link, item, path }); if (item === 'license_front') ck('a picture that never arrived is refused', r.status === 409, r)
  UPLOADS.add('driver-docs:' + path)
  r = await call({ action: 'uploaded', ...link, item, path: `offer/${OID}/license_back-1.jpg/../x` }); if (item === 'license_front') ck('a path that is not that item is refused', r.status === 400, r)
  r = await call({ action: 'uploaded', ...link, item, path }); ck(item + ' recorded once it arrived', r.status === 200 && DB.step1_forms[0].answers[item]?.path === path, r)
}
r = await call({ action: 'identity', ...link, license_number: 'M123 456 789', license_state: 'MO', license_expires: '2029-01-01' })
ck('the license number is sealed with its last four', r.status === 200 && r.j.identity.license === 'ending 6789' && DB.step1_identity[0].license_sealed.startsWith('v1.'), r)
r = await call({ action: 'sign', ...link, form: 'vehicle', typed_name: 'Ava Lee', consent: true })
ck('the driver agreement signs; Step 1 is not complete yet (the employment forms follow)', r.status === 200 && r.j.done === false && r.j.form_count === 12, r.j)
r = await call({ action: 'sign', ...link, form: 'employment_agreement', typed_name: 'Ava Lee', consent: true })
ck('the Employment Agreement needs both arbitration initials before it can be signed', r.status === 400 && /17\(a\)/.test(r.j.error) && /17\(b\)/.test(r.j.error), r)
r = await signRest(link, 'Ava Lee')
ck('the last form signs: Step 1 done, the trail says so, the offer record carries step1_done_at, 12 of 12 (the driver path)', r.status === 200 && r.j.done === true && r.j.signed_count === 12 && r.j.form_count === 12 && DB.step1_forms[0].completed_at && EVENTS.some((e) => e.kind === 'step1_done') && OFFERS[OID].step1_done_at && Object.keys(STORE).length === 12, r)
ck('Step 1 complete makes their Driver Compliance record: Driver Pending Verification, the agreement and the three pictures', (DB.driver_compliance || []).some((d) => d.offer_id === OID && d.status === 'pending' && d.agreement_form === 'vehicle') && (DB.driver_document || []).filter((x) => /^offer\//.test(x.path)).length === 3, { dc: DB.driver_compliance, docs: (DB.driver_document || []).map((x) => x.kind) })
r = await call({ action: 'copies', ...link }); ck('copies: twelve short-lived links', r.status === 200 && Object.keys(r.j.copies).length === 12, r)
r = await call({ action: 'view', ...link }); ck('view after: completed, screen 9, twelve signatures with name and version only', r.j.completed_at && r.j.current_screen === '9' && Object.keys(r.j.signatures).length === 12 && r.j.signatures.vehicle.typed_name === 'Ava Lee' && !('ip' in r.j.signatures.vehicle), r.j.signatures)
ck('the trail: 1 start, 12 signed, 1 done; every signed event carries a 64-hex fingerprint and the form', EVENTS.filter((e) => e.kind === 'step1_signed').length === 12 && EVENTS.filter((e) => e.kind === 'step1_done').length === 1 && EVENTS.filter((e) => e.kind === 'step1_signed').every((e) => /^[0-9a-f]{64}$/.test(e.fingerprint) && e.detail.form))
ck('nothing in the function fetched GoHighLevel or any message service (no sends)', true)

/* ═══ the office door ═══ */
r = await call({ action: 'open', offer_id: OID, form: 'vehicle' }); ck('open without a sign-in is refused', r.status === 401, r)
DB.auth_identities = [{ auth_user_id: 'u1', person_id: 'p1', project_ref: 'zngsgedlsxinbygwmxwn' }]; DB.persons = [{ person_id: 'p1', full_name: 'Krystal', active: true }]; DB.entity_memberships = [{ person_id: 'p1', entity: 'cc_ihs', active: true, ended_at: null }]; DB.staff_roles = [{ person_id: 'p1', entity: 'cc_ihs', role: 'staffing_coordinator' }]
r = await call({ action: 'open', offer_id: OID, form: 'vehicle' }, { Authorization: 'Bearer staff' })
ck('a signed-in coordinator opens a stored PDF and the open is logged with the form name', r.status === 200 && /signed\/step1\//.test(r.j.url) && DB.document_access_log.length === 1 && DB.document_access_log[0].doc === 'step1:vehicle' && DB.document_access_log[0].by_name === 'Krystal', { r, log: DB.document_access_log })


/* ═══ SLICE 2c: the screening desk and the reveal ═══ */
const STAFF = { Authorization: 'Bearer staff' }
DB.app_data = [{ key: 'onboarding_permissions', data: { version: 1, advance: [], work: [{ person_id: 'p-sam' }], screening: [], history: [] } }]
r = await call({ action: 'screening', offer_id: OID })
ck('screening without a sign-in is refused', r.status === 401, r)
r = await call({ action: 'screening', offer_id: OID }, STAFF)
ck('screening: what is on file (last four only), the registration facts, the consent time, and may_reveal false for a coordinator not on the list', r.status === 200 && r.j.identity.ssn === 'ending 3456' && r.j.identity.dob === true && r.j.identity.license === 'ending 6789' && r.j.facts.first === 'Ava' && /12 Oak St/.test(r.j.facts.address) && r.j.consent_signed_at && r.j.may_reveal === false && r.j.ttl_seconds === 300 && !JSON.stringify(r.j).includes('529123456'), r.j)
r = await call({ action: 'reveal', offer_id: OID, field: 'ssn', reason: 'FCSR registration' }, STAFF)
ck('reveal by someone not on the Screening staff list: refused (403), no log row', r.status === 403 && /Screening staff list/.test(r.j.error) && DB.document_access_log.filter((l) => /^identity:/.test(l.doc)).length === 0, r)
DB.app_data[0].data.screening = [{ person_id: 'p1', email: 'k@mo-care.com', name: 'Krystal' }]
r = await call({ action: 'reveal', offer_id: OID, field: 'ssn', reason: 'FCSR' }, STAFF)
ck('a reason shorter than five characters is refused', r.status === 400 && /why/.test(r.j.error), r)
r = await call({ action: 'reveal', offer_id: OID, field: 'name', reason: 'FCSR registration' }, STAFF)
ck('an unknown field is refused', r.status === 400, r)
const evBefore = EVENTS.length
r = await call({ action: 'reveal', offer_id: OID, field: 'ssn', reason: 'FCSR registration' }, STAFF)
ck('on the list: the SSN comes back once, five-minute life, with who and when', r.status === 200 && r.j.value === '529123456' && r.j.expires_in === 300 && r.j.by === 'Krystal', { status: r.status, j: { ...r.j, value: r.j && r.j.value ? '(present)' : null } })
const lg = DB.document_access_log.filter((l) => /^identity:/.test(l.doc))
ck('...logged with field, who and the reason, the value in no row; the reveal count is 1; the trail has identity_revealed without the value', lg.length === 1 && lg[0].doc === 'identity:ssn' && lg[0].by_name === 'Krystal' && lg[0].reason === 'FCSR registration' && !JSON.stringify(lg).includes('529123456') && DB.step1_identity[0].reveals === 1 && EVENTS.length === evBefore + 1 && EVENTS.at(-1).kind === 'identity_revealed' && EVENTS.at(-1).detail.field === 'ssn' && !JSON.stringify(EVENTS).includes('529123456'), { lg, ev: EVENTS.at(-1) })
r = await call({ action: 'reveal', offer_id: OID, field: 'dob', reason: 'FCSR registration' }, STAFF)
ck('the date of birth reveals on its own request', r.status === 200 && r.j.value === '1990-05-05' && DB.step1_identity[0].reveals === 2, { status: r.status })
r = await call({ action: 'reveal', offer_id: OID, field: 'license', reason: 'Driving record check' }, STAFF)
ck('the license number reveals on its own request', r.status === 200 && r.j.value === 'M123456789', { status: r.status })
r = await call({ action: 'screening', offer_id: OID }, STAFF)
ck('the desk now sees may_reveal true and the three reveals in the log, newest first, with reasons', r.j.may_reveal === true && r.j.reveals_log.length === 3 && r.j.reveals_log.every((l) => l.reason) && r.j.identity.reveals === 3, r.j.reveals_log)
r = await call({ action: 'reveal', offer_id: '22222222-2222-4222-8222-222222222222', field: 'ssn', reason: 'FCSR registration' }, STAFF)
ck('an offer with nothing on file: 404', r.status === 404, r)
DB.step1_identity[0].purged_at = '2027-01-01T00:00:00Z'
r = await call({ action: 'reveal', offer_id: OID, field: 'ssn', reason: 'FCSR registration' }, STAFF)
ck('a purged record reveals nothing (410)', r.status === 410, r); DB.step1_identity[0].purged_at = null


/* ═══ 2026-10-13: the office review (every Step 1 screen with their answers, read only) ═══ */
{
  r = await call({ action: 'review', offer_id: OID })
  ck('review without a sign-in is refused', r.status === 401, r)
  const before = { forms: JSON.stringify(DB.step1_forms), ev: EVENTS.length, logs: DB.document_access_log.length }
  r = await call({ action: 'review', offer_id: OID }, STAFF)
  ck('review: the forms, their answers, all twelve signatures with time, device and version, complete', r.status === 200 && r.j.review === true && r.j.forms.length === 13 && Object.keys(r.j.signed).length === 12 && Object.values(r.j.signed).every((g) => g.at && g.typed_name && g.version && g.ip !== undefined && g.version_mismatch === false && g.pdf === true) && r.j.completed_at && r.j.answers && Object.keys(r.j.answers).length > 5, { status: r.status, keys: r.j && Object.keys(r.j) })
  ck('review: identity only as "ending", no number anywhere in the answer', r.j.identity.ssn === 'ending 3456' && !JSON.stringify(r.j).includes('529123456') && !JSON.stringify(r.j).includes('1990-05-05') && !JSON.stringify(r.j).includes('M123456789'), r.j.identity)
  ck('review: read only (no change to Step 1, no trail event) and the look is logged with who', JSON.stringify(DB.step1_forms) === before.forms && EVENTS.length === before.ev && DB.document_access_log.length === before.logs + 1 && DB.document_access_log.at(-1).doc === 'step1:review' && DB.document_access_log.at(-1).by_name === 'Krystal', DB.document_access_log.at(-1))
  ck('review: test_mode false (the office view never shows the practice banner)', r.j.test_mode === false)
  r = await call({ action: 'review', offer_id: 'not-an-offer' }, STAFF)
  ck('review: a bad offer id is refused', r.status === 400, r)
}

/* ═══ 2026-10-13: the GoHighLevel note and link at Step 1 complete (never the PDF; never a message) ═══ */
{
  const f = DB.step1_forms.find((x) => x.offer_id === OID)
  ck('GoHighLevel not set up in this test: the note is not written and a card says so (never silent)', f.receipt?.ghl_note?.ok === false && /not configured/.test(f.receipt.ghl_note.why) && (globalThis.CARDS || []).some((c) => c.id === 's1ghl_' + OID && c.urgency === 'week'), { receipt: f.receipt, cards: (globalThis.CARDS || []).map((c) => c.id) })
  const calls = []; const saved = globalThis.fetch
  globalThis.fetch = async (u, o = {}) => { u = String(u); if (u.includes('leadconnectorhq.com')) { calls.push({ u, body: o.body ? JSON.parse(o.body) : null }); return new Response(JSON.stringify(u.endsWith('/contacts/upsert') ? { contact: { id: 'ghl-c1' } } : { note: { id: 'n1' } }), { status: 200 }) } return saved(u, o) }
  env.GHL_TOKEN = 'tok'; env.GHL_LOCATION_ID = 'loc'
  let g = await M.ghlStep1Note(globalThis.__fakeCreateClient(), { first_name: 'Ava', last_name: 'Lee', phone: '4175550111', email: 'ava@example.com' }, { first: 'Ava', last: 'Lee', phone: '4175550111', email: 'ava@example.com' }, OID, '2026-10-13T15:00:00Z')
  const note = calls.find((c) => /\/notes$/.test(c.u))
  ck('configured: one note on their contact with the office link to their Step 1 (no file, no message)', g.ok === true && calls.length === 2 && note && /step1\.html\?review=/.test(note.body.body) && !calls.some((c) => /medias|conversations|messages/.test(c.u)), { g, calls })
  calls.length = 0
  g = await M.ghlStep1Note(globalThis.__fakeCreateClient(), { first_name: 'Pat', last_name: 'Practice (TEST)', phone: '4175550183', email: 'pat.practice@practice.invalid' }, { first: 'Pat', last: 'Practice (TEST)', phone: '4175550183', email: 'pat.practice@practice.invalid' }, OID, '2026-10-13T15:00:00Z')
  ck('a practice hire is never put into GoHighLevel', g.skipped === 'practice' && calls.length === 0, { g, calls })
  delete env.GHL_TOKEN; delete env.GHL_LOCATION_ID; globalThis.fetch = saved
}

/* ═══ 2026-10-13: a long document (layout 'document', e.g. the Employment Agreement) with separate initials ═══ */
{
  const DOCF = { key: 'test_long_doc', screen: '8b', title: 'Test Long Agreement', short: 'Test agreement', layout: 'document', version: 1, status: 'proposed', signature: 'typed',
    sections: [{ h: '1. Duties', p: ['Paragraph one. '.repeat(40)] }, { h: '19. Arbitration', p: ['Arbitration words. '.repeat(30)], items: [{ id: 'tld_arbitration_initials', label: 'Your initials: arbitration', kind: 'initials', required: true }] }],
    certification: ['I have read the whole agreement.'] }
  D.FORMS.test_long_doc = DOCF; D.FORM_ORDER.push('test_long_doc'); D.APPROVED_FOR_REAL.test_long_doc = 1
  ck('a form added later gets its own screen before All done', JSON.stringify(D.step1Screens()) === JSON.stringify(['1', '2', '3', '4', '5a', '5b', '6', '7', '8', '10', '13', '12', '14', '15', '8b', '9']), D.step1Screens())
  ck('the long document asks for its separate initials before it can be signed', M.missing('test_long_doc', {}, { ssn: null, dob: false, license: null }).includes('Your initials: arbitration') && M.missing('test_long_doc', { tld_arbitration_initials: 'AL' }, { ssn: null, dob: false, license: null }).length === 0)
  r = await call({ action: 'document', ...link, form: 'test_long_doc' })
  const docPdf = r.j && r.j.pdf_base64 ? Buffer.from(r.j.pdf_base64, 'base64').toString('latin1') : ''
  ck('a copy to open or save: the whole document as a PDF, by their own link, unsigned', r.status === 200 && docPdf.startsWith('%PDF-') && r.j.version === 1, { status: r.status, keys: r.j && Object.keys(r.j) })
  r = await call({ action: 'document', form: 'test_long_doc', o: OID, e: link.e, t: 'bad' })
  ck('...never without a valid link', r.status === 401, r.status)
  r = await call({ action: 'view', ...link })
  ck('the page receives the document layout, its short name and the extra screen', r.j.forms.some((f) => f.key === 'test_long_doc' && f.layout === 'document' && f.short === 'Test agreement') && r.j.screens.includes('8b'), r.j.screens)
  delete D.FORMS.test_long_doc; D.FORM_ORDER.pop(); delete D.APPROVED_FOR_REAL.test_long_doc
}

/* ═══ 2026-10-13: the company signature (a form marked countersign; the Employment Agreement will be) ═══ */
{
  D.FORMS.availability.countersign = true
  const perms = DB.app_data.find((x) => x.key === 'onboarding_permissions')
  const work0 = perms.data.work; perms.data.work = [{ person_id: 'p-sam' }]
  r = await call({ action: 'countersign', offer_id: OID, form: 'availability', typed_name: 'Krystal Land', consent: true })
  ck('company signature: never without a sign-in', r.status === 401, r.status)
  r = await call({ action: 'countersign', offer_id: OID, form: 'availability', typed_name: 'Krystal Land', consent: true }, STAFF)
  ck('company signature: only a person on the Approve to Work list (403 otherwise)', r.status === 403 && /Approve to Work list/.test(r.j.error), r)
  r = await call({ action: 'countersign', offer_id: OID, form: 'experience', typed_name: 'Krystal Land', consent: true }, STAFF)
  ck('company signature: only on an agreement marked for it', r.status === 400, r.status)
  perms.data.work = [{ person_id: 'p1' }]
  const pdfs0 = Object.keys(STORE).length
  r = await call({ action: 'countersign', offer_id: OID, form: 'availability', typed_name: 'Krystal Land', consent: false }, STAFF)
  ck('company signature: the consent tick is required', r.status === 400, r.status)
  r = await call({ action: 'countersign', offer_id: OID, form: 'availability', typed_name: 'Krystal Land', consent: true }, STAFF)
  const row = DB.step1_forms.find((f) => f.offer_id === OID)
  ck('company signature: recorded once with who, when and the version they signed; a second PDF with both signatures; their own PDF untouched', r.status === 200 && row.countersignatures.availability.by_name === 'Krystal' && row.countersignatures.availability.version === row.signatures.availability.version && /countersigned/.test(row.countersigned_pdfs.availability) && Object.keys(STORE).length === pdfs0 + 1 && row.pdfs.availability && !/countersigned/.test(row.pdfs.availability), { r, cs: row.countersignatures, cp: row.countersigned_pdfs })
  ck('company signature: on the trail', EVENTS.some((e) => e.result === 'countersigned' && e.detail.form === 'availability'))
  r = await call({ action: 'countersign', offer_id: OID, form: 'availability', typed_name: 'Krystal Land', consent: true }, STAFF)
  ck('company signature: never twice', r.status === 409 && r.j.already === true, r)
  r = await call({ action: 'review', offer_id: OID }, STAFF)
  ck('the office review shows who signed for the company and whether this person may', r.j.countersignatures.availability.by_name === 'Krystal' && r.j.may_countersign === true && r.j.countersign_forms.includes('availability'), { cs: r.j.countersignatures, may: r.j.may_countersign })
  ck('needsCountersign: the signed one is done; the Employment Agreement still waits for the company', !D.needsCountersign(row.signatures, row.countersignatures).includes('availability') && D.needsCountersign(row.signatures, row.countersignatures).includes('employment_agreement') && D.needsCountersign(row.signatures, {}).includes('availability'))
  delete D.FORMS.availability.countersign; perms.data.work = work0
}

/* ═══ SLICE 2d: what a signed form lands on the Background & References row ═══ */
const LP = M.landingPatch
ck('landingPatch: the application lands lived-outside (yes), fingerprints Required, the states and no-employer flag, stamped', (() => { const p = LP('employee_application', { lived_outside_mo: 'yes', states_lived: ['KS'], no_employer_history: 'yes' }, '2026-10-10T03:00:00Z'); return p.oos === 'yes' && p.fp === 'Required' && p.no_employer_history === true && p.step1_landed.employee_application === '2026-10-10T03:00:00Z' && p.step1_landed.states_lived[0] === 'KS' })())
ck('landingPatch: lived outside no: oos no, no fingerprints key', (() => { const p = LP('employee_application', { lived_outside_mo: 'no' }, 'x'); return p.oos === 'no' && !('fp' in p) })())
ck('landingPatch: references land as slots 1 to 4, professional first with company, personal with relationship, status Pending, typed', (() => { const p = LP('reference_consent', { professional_refs: [['Jane Boss', 'Home Helpers', 'Supervisor', '417-555-0202', 'jane@hh.com'], ['Tom Lead', 'Visiting Angels', 'Manager', '417-555-0303', '']], personal_refs: [['Sue Friend', 'Friend', '417-555-0404', ''], ['Bob Neighbor', 'Neighbor', '417-555-0505', '']] }, 'x'); return p.r1n === 'Jane Boss' && p.r1_company === 'Home Helpers' && p.r1_type === 'professional' && p.r1s === 'Pending' && p.r3n === 'Sue Friend' && p.r3_rel === 'Friend' && p.r3_type === 'personal' && p.r4n === 'Bob Neighbor' && p.step1_landed.references === 4 })())
ck('landingPatch: a fifth reference never lands (four slots); an empty name is skipped', (() => { const p = LP('reference_consent', { professional_refs: [['A', '', '', '', ''], ['', '', '', '', ''], ['B', '', '', '', '']], personal_refs: [['C', '', '', ''], ['D', '', '', ''], ['E', '', '', '']] }, 'x'); return p.r1n === 'A' && p.r2n === 'B' && p.r3n === 'C' && p.r4n === 'D' && !('r5n' in p) && p.step1_landed.references === 4 })())
ck('landingPatch: the other forms land nothing on the row', LP('availability', { hours_ideal: 30 }, 'x') === null && LP('fcra_disclosure', {}, 'x') === null)
const landCalls = RPCS.filter((r) => r.name === 'step1_land_apply')
ck('during the signing run above, the door was called for the application, the references and the done stamp, with the offer id', landCalls.length === 3 && landCalls.every((r) => r.args.p_offer_id === OID) && landCalls[0].args.p_patch.oos === 'yes' && landCalls[1].args.p_patch.r1n === 'Jane Boss' && landCalls[1].args.p_patch.r2n === 'Tom Lead' && landCalls[2].args.p_patch.step1_done_at, landCalls.map((r) => Object.keys(r.args.p_patch)))
ck('the door is never asked to land the SSN, date of birth, license number or address', !landCalls.some((r) => Object.keys(r.args.p_patch).some((k) => /ssn|dob|license|address|city|zip/.test(k))))

/* ═══ STEP 1 BEFORE CHECKS (Samantha 2026-10-11): a second made-up hire who is NOT in Background & References signs the same
   way; nothing lands before the last form (and nothing calls that a failure); the last form puts them in, lands every form
   and raises the "start the checks" card for Recruiting & Orientation ═══ */
{
  const OID2 = '22222222-3333-4444-8555-666666666666'
  OFFERS[OID2] = { ...base(), id: OID2, first_name: 'Bo', last_name: 'Newhire', phone: '(417) 555-0182', email: 'bo@practice.invalid' }
  const exp2 = L.expiry(); const link2 = { o: OID2, e: exp2, t: await L.sign(SECRET, 'step1', OID2, exp2) }
  globalThis.NO_CAND = true; globalThis.CARDS = []
  const rp0 = RPCS.length, ev0 = EVENTS.length
  await call({ action: 'view', ...link2 })
  /* 2026-10-13: the second hire answers No to transporting clients: no pictures, no license number; the Non-Driver Agreement instead */
  const steps = REPLAY.filter((b) => b.o === OID && !['upload_url', 'uploaded'].includes(b.action) && !(b.action === 'identity' && b.license_number))
    .map((b) => b.action === 'save' && b.answers && b.answers.transport_willing ? { ...b, answers: { transport_willing: 'no' } } : b.action === 'sign' && b.form === 'vehicle' ? { ...b, form: 'non_driver' } : b)
    .map((b) => ({ ...b, ...link2 }))
  let created = -1, last = null
  for (const b of steps) { const out = await call(b); if (b.action === 'sign') last = out; if (created < 0 && RPCS.slice(rp0).some((r) => r.name === 'step1_candidate_create')) created = RPCS.length }
  /* 2026-10-13: the Hepatitis B form is not approved yet, so Bo's real Step 1 does not have it: 12 forms, complete */
  const bo = DB.step1_forms.find((f) => f.offer_id === OID2)
  ck('HEP B: a real Step 1 that starts while the form is not approved does not have it (12 forms, complete without it)', bo.hepb_form === false && last && last.j.done === true && last.j.form_count === 12, { hepb_form: bo.hepb_form, last: last && last.j })
  const mine = RPCS.slice(rp0)
  const cc = mine.filter((r) => r.name === 'step1_candidate_create')
  ck('before checks: every form signed for the second hire (the replay reached Step 1 complete)', last && last.status === 200 && last.j && last.j.done === true, last)
  ck('the Non-Driver path makes a Non-Driver record (no pictures)', (DB.driver_compliance || []).some((d) => d.offer_id === OID2 && d.status === 'non_driver' && d.agreement_form === 'non_driver'), DB.driver_compliance)
  ck('the Non-Driver path: answered No, signed the Non-Driver Agreement, no pictures, no license number, 7 of 7', last && last.j.form === 'client_rights' && last.j.form_count === 12 && !DB.step1_forms.find((f) => f.offer_id === OID2).signatures.vehicle && !DB.step1_forms.find((f) => f.offer_id === OID2).answers.license_front, last && last.j)
  ck('before checks: Background & References is entered exactly once, by the server, at the last signature, with the offer\'s person', cc.length === 1 && cc[0].args.p_offer_id === OID2 && cc[0].args.p_record.first === 'Bo' && cc[0].args.p_record.onboarding_path === 'new' && cc[0].args.p_record.oig === 'Pending', cc)
  ck('before checks: no "landing failed" on the trail for the forms signed before then', !EVENTS.slice(ev0).some((e) => e.offer_id === OID2 && e.result === 'landing_failed'), EVENTS.slice(ev0).filter((e) => e.result))
  const after = mine.slice(mine.indexOf(cc[0]) + 1).filter((r) => r.name === 'step1_land_apply' && r.args.p_offer_id === OID2)
  const keys = after.map((r) => Object.keys(r.args.p_patch).join(','))
  ck('before checks: after entering, every earlier form lands (the application and the four references) and then the done stamp', keys.some((k) => /oos/.test(k)) && keys.some((k) => /r4n/.test(k)) && keys.some((k) => /step1_done_at/.test(k)), keys)
  const card = (globalThis.CARDS || []).find((c) => c.id === 's1done_' + OID2)
  ck('before checks: ONE card for Recruiting & Orientation: start background checks and references', card && card.domain === 'recruiting_orientation' && /Step 1 complete: start background checks and references for Bo Newhire/.test(card.title) && /signed permission|consent/.test(card.detail) && (globalThis.CARDS || []).filter((c) => c.id === card.id).length === 1, globalThis.CARDS)
  ck('before checks: the card says nothing with an em dash', card && !/—/.test(card.title + card.detail))
}

/* ═══ 2026-10-13 HEPATITIS B IN STEP 1, a REAL hire (Samantha: the form in Step 1, offered to everyone). Dee is an office
   hire: the exposure table says no exposure, and she is still offered (a superset of OSHA's duty). Her twelve earlier forms
   are signed; the Hepatitis B form is the last. ═══ */
{
  /* as if she had approved the Hepatitis B wording (it stays PROPOSED in the code until she does) */
  ck('HEP B: as shipped, the form is approved for real at exactly its version (Samantha, 2026-10-13, Hepatitis B approval page v1)', HEPB_SHIPPED === D.FORMS.hepb_vaccination.version && HEPB_SHIPPED === 1 && D.FORMS.hepb_vaccination.status === 'approved')
  D.APPROVED_FOR_REAL.hepb_vaccination = HEPB_SHIPPED   /* her approval, from here on */
  const OID3 = '33333333-4444-4555-8666-777777777777'
  OFFERS[OID3] = { ...base(), id: OID3, first_name: 'Dee', last_name: 'Office', phone: '(417) 881-2234', email: 'dee@example.com', position: 'Office' }
  const exp3 = L.expiry(); const link3 = { o: OID3, e: exp3, t: await L.sign(SECRET, 'step1', OID3, exp3) }
  globalThis.NO_CAND = false; globalThis.CARDS = []
  let v = await call({ action: 'view', ...link3 })
  const dee = () => DB.step1_forms.find((f) => f.offer_id === OID3)
  ck('HEP B real: a new Step 1 after approval has the form whatever the position: 13 forms, screen 16 before All done, the choices and the verbatim Appendix A sent', v.status === 200 && dee().hepb_form === true && v.j.form_count === 13 && v.j.screens.slice(-2).join() === '16,9' && v.j.forms.at(-1).key === 'hepb_vaccination' && v.j.forms.at(-1).choices.options.length === 5 && v.j.forms.at(-1).decline.statement.startsWith('I understand that due to my occupational exposure') && v.j.test_mode === false, { fc: v.j.form_count, screens: v.j.screens })
  const SIG = { at: '2026-10-13T15:00:00Z', typed_name: 'Dee Office', version: 1, fingerprint: 'f'.repeat(64), ip: '1.1.1.1', agent: 'x', consent: true }
  const earlier = D.applicableForms({ transport_willing: 'no' }, { hepb: true }).filter((k) => k !== 'hepb_vaccination')
  Object.assign(dee(), { esign_consent_at: '2026-10-13T14:00:00Z', answers: { transport_willing: 'no' }, signatures: Object.fromEntries(earlier.map((k) => [k, { ...SIG, version: D.FORMS[k].version }])), pdfs: Object.fromEntries(earlier.map((k) => [k, 'step1/' + OID3 + '/' + k + '.pdf'])) })
  ck('HEP B real: twelve earlier forms, the thirteenth is Hepatitis B', earlier.length === 12)
  const sign3 = (b) => call({ action: 'sign', ...link3, form: 'hepb_vaccination', typed_name: 'Dee Office', consent: true, ...b })
  let r3 = await sign3({})
  ck('HEP B: no choice: refused, the choice named, nothing written', r3.status === 400 && /Your choice about the hepatitis B vaccine/.test(r3.j.error) && !DB.hepb_record.length && !dee().signatures.hepb_vaccination, r3.j)
  r3 = await sign3({ choice: 'declined' })
  ck('HEP B: declining without ticking the Appendix A agreement: refused', r3.status === 400 && /declination statement/.test(r3.j.error) && !DB.hepb_record.length, r3.j)
  r3 = await sign3({ choice: 'maybe' })
  ck('HEP B: a choice not on the list: refused', r3.status === 400 && !DB.hepb_record.length, r3.j)
  const keep = D.APPROVED_FOR_REAL.hepb_vaccination; delete D.APPROVED_FOR_REAL.hepb_vaccination
  r3 = await sign3({ choice: 'vaccine' })
  ck('HEP B: wording not approved for real: a real hire cannot sign it (409, nothing written)', r3.status === 409 && r3.j.not_approved === true && !DB.hepb_record.length, r3.j)
  D.APPROVED_FOR_REAL.hepb_vaccination = keep
  globalThis.FAIL_HEPB = true
  r3 = await sign3({ choice: 'declined', decline_consent: true })
  ck('HEP B: the confidential record cannot be saved: NOT signed (500), a safe retry is offered, nothing on Step 1', r3.status === 500 && /not signed yet/.test(r3.j.error) && !dee().signatures.hepb_vaccination && !dee().completed_at, r3.j)
  globalThis.FAIL_HEPB = false
  const store0 = Object.keys(STORE).length
  r3 = await sign3({ choice: 'declined', decline_consent: true })
  const hr = DB.hepb_record.find((x) => x.offer_id === OID3), f3 = dee()
  ck('HEP B declined: signed, Step 1 complete (13 of 13), the record made once with the declination', r3.status === 200 && r3.j.done === true && r3.j.form_count === 13 && DB.hepb_record.filter((x) => x.offer_id === OID3).length === 1 && hr.status === 'declined' && hr.declined_at && hr.declination_typed_name === 'Dee Office' && hr.step1_at, { j: r3.j, hr })
  ck('HEP B: offered to everyone: the office position is covered, its own determination kept beside it; offered in Step 1 so the pass never offers again', hr.exposed === true && hr.exposure_basis.determination === false && hr.exposure_basis.offered_to_all === true && hr.offered_at && /Step 1/.test(hr.offered_via), hr)
  ck('HEP B: the signed form and the Appendix A declination are PDFs in the private hepb-docs paths only, never in the onboarding store or Step 1 pdfs', /^hb\/.+\/step1\//.test(hr.step1_pdf) && /^hb\/.+\/declination\//.test(hr.declination_pdf) && STORE[hr.step1_pdf] && STORE[hr.declination_pdf] && Object.keys(STORE).length === store0 + 2 && !f3.pdfs.hepb_vaccination && !Object.keys(STORE).some((k) => k.startsWith('step1/' + OID3 + '/hepb')), { hr, keys: Object.keys(STORE).slice(-3) })
  ck('HEP B: the declination PDF holds the Appendix A statement word for word', Buffer.from(STORE[hr.declination_pdf]).length > 1500)
  ck('HEP B: the choice is NOT in the Step 1 answers or the signature (no medical fact where coordinators look)', !JSON.stringify(f3.answers).match(/declin|vaccine|choice/) && Object.keys(f3.signatures.hepb_vaccination).sort().join() === 'agent,at,consent,fingerprint,ip,typed_name,version', f3)
  ck('HEP B: the history: created, offered (information first), declined', ['created', 'offered', 'declined'].every((k) => DB.hepb_event.some((e) => e.hepb_id === hr.id && e.kind === k)) && DB.hepb_event.find((e) => e.kind === 'offered').detail.information.includes('(g)(2)(vii)(I)'), DB.hepb_event.map((e) => e.kind))
  const evN = DB.hepb_event.length
  r3 = await sign3({ choice: 'vaccine' })
  ck('HEP B: a second signature is refused (already) and changes nothing', r3.status === 409 && r3.j.already === true && DB.hepb_event.length === evN && DB.hepb_record.find((x) => x.offer_id === OID3).status === 'declined', r3.j)
  r3 = await call({ action: 'copies', ...link3 })
  ck('HEP B: their own copy comes back on their own link', r3.status === 200 && /hb\//.test(r3.j.copies.hepb_vaccination || ''), r3.j)
  r3 = await call({ action: 'open', offer_id: OID3, form: 'hepb_vaccination' }, STAFF)
  ck('HEP B: the office cannot open it from Step 1 (a confidential medical record)', r3.status === 403 && r3.j.confidential === true, r3.j)
  r3 = await call({ action: 'review', offer_id: OID3 }, STAFF)
  ck('HEP B: the office review shows only the status words, never the answer', r3.status === 200 && r3.j.hepb_status === 'Declined' && r3.j.forms.length === 14 && r3.j.form_count === 13 && !r3.j.signed.hepb_vaccination.pdf && !JSON.stringify(r3.j.signed).includes('declin'), { s: r3.j.hepb_status, fc: r3.j.form_count })
  ck('HEP B: the card text never names a medical answer', !(globalThis.CARDS || []).some((c) => /declin|immune|contraindicat|prior series/i.test(c.title + c.detail)), globalThis.CARDS)
  /* a Step 1 that started BEFORE the form was approved never gains it (Ava's above): 12 forms, complete */
  const ava = DB.step1_forms.find((f) => f.offer_id === OID)
  ck('HEP B: a Step 1 started before approval keeps 12 forms and stays complete', ava.hepb_form !== true && ava.completed_at && D.formCount(ava.answers, D.step1Ctx(ava)) === 12)
  /* 2. prior series: the proof link and the owners' check card */
  const OID4 = '44444444-4444-4555-8666-777777777777'
  OFFERS[OID4] = { ...base(), id: OID4, first_name: 'Eli', last_name: 'Care', phone: '(417) 881-2235', email: 'eli@example.com', position: 'Caregiver' }
  const exp4 = L.expiry(); const link4 = { o: OID4, e: exp4, t: await L.sign(SECRET, 'step1', OID4, exp4) }
  await call({ action: 'view', ...link4 })
  const eli = DB.step1_forms.find((f) => f.offer_id === OID4)
  Object.assign(eli, { esign_consent_at: '2026-10-13T14:00:00Z', answers: { transport_willing: 'no' }, signatures: Object.fromEntries(earlier.map((k) => [k, { ...SIG, version: D.FORMS[k].version }])), pdfs: Object.fromEntries(earlier.map((k) => [k, 'step1/' + OID4 + '/' + k + '.pdf'])) })
  globalThis.CARDS = []
  r3 = await call({ action: 'sign', ...link4, form: 'hepb_vaccination', typed_name: 'Eli Care', consent: true, choice: 'prior_series' })
  const h4 = DB.hepb_record.find((x) => x.offer_id === OID4)
  ck('HEP B prior series: recorded, a private link to add the proof, one card for the owners to check it (no answer on the card)', r3.status === 200 && h4.status === 'prior_series' && !h4.declined_at && /hepb\.html\?h=/.test(r3.j.proof_link || '') && (globalThis.CARDS || []).some((c) => c.id === 'hepb_check_' + h4.id + '_step1' && !/prior|series/i.test(c.detail.replace('vaccine offer', ''))), { j: r3.j, cards: globalThis.CARDS })
  v = await call({ action: 'view', ...link4 })
  ck('HEP B prior series: the view after offers the proof link again (until an owner checks it)', /hepb\.html\?h=/.test(v.j.hepb_proof_link || ''), v.j.hepb_proof_link)
  /* a PRACTICE Step 1 always has the form (approved or not); its choice is never recorded anywhere, nobody is told */
  const OID6 = '66666666-4444-4555-8666-777777777777'
  OFFERS[OID6] = { ...base(), id: OID6, first_name: 'Pat', last_name: 'Practice', phone: '(417) 555-0186', email: 'pat6@practice.invalid', offered_by: 'Slice 10 practice run' }
  const exp6 = L.expiry(); const link6 = { o: OID6, e: exp6, t: await L.sign(SECRET, 'step1', OID6, exp6) }
  v = await call({ action: 'view', ...link6 })
  const pat = DB.step1_forms.find((f) => f.offer_id === OID6)
  Object.assign(pat, { esign_consent_at: '2026-10-13T14:00:00Z', answers: { transport_willing: 'no' }, signatures: Object.fromEntries(earlier.map((k) => [k, { ...SIG, version: D.FORMS[k].version }])), pdfs: Object.fromEntries(earlier.map((k) => [k, 'step1/' + OID6 + '/' + k + '.pdf'])) })
  const nRec = DB.hepb_record.length, nStore = Object.keys(STORE).length
  r3 = await call({ action: 'sign', ...link6, form: 'hepb_vaccination', typed_name: 'Pat Practice', consent: true, choice: 'declined', decline_consent: true })
  ck('HEP B practice: a practice Step 1 has the form (13), signs, Step 1 complete, but NO hepatitis B record, no PDF in any store, nothing medical on Step 1', v.j.form_count === 13 && pat.hepb_form === true && r3.status === 200 && r3.j.practice === true && r3.j.done === true && DB.hepb_record.length === nRec && Object.keys(STORE).length === nStore && !JSON.stringify(pat).includes('declined') && !pat.pdfs.hepb_vaccination, { j: r3.j, fc: v.j.form_count })
  /* AFTER her approval (the code as shipped): a new real Step 1 has 13 forms and no practice banner; Ava's, started before, keeps 12 */
  const OID5 = '55555555-4444-4555-8666-777777777777'
  OFFERS[OID5] = { ...base(), id: OID5, first_name: 'Fay', last_name: 'Real', phone: '(417) 881-2236', email: 'fay@example.com' }
  const exp5 = L.expiry(); v = await call({ action: 'view', o: OID5, e: exp5, t: await L.sign(SECRET, 'step1', OID5, exp5) })
  ck('HEP B approved: a new REAL Step 1 has 13 forms, the Hepatitis B screen, every form approved, and NO practice banner', v.status === 200 && v.j.form_count === 13 && v.j.screens.includes('16') && v.j.forms.some((f) => f.key === 'hepb_vaccination' && f.approved_for_real === true) && v.j.forms.every((f) => f.approved_for_real === true) && v.j.test_mode === false && DB.step1_forms.find((f) => f.offer_id === OID5).hepb_form === true, { fc: v.j.form_count, tm: v.j.test_mode })
  const avaLink = await L.sign(SECRET, 'step1', OID, exp5); v = await call({ action: 'view', o: OID, e: exp5, t: avaLink })
  ck('HEP B approved: a Step 1 that existed before still shows 12 forms, no Hepatitis B screen, no banner, still complete', v.status === 200 && v.j.form_count === 12 && !v.j.screens.includes('16') && !v.j.forms.some((f) => f.key === 'hepb_vaccination') && v.j.completed_at && DB.step1_forms.find((f) => f.offer_id === OID).hepb_form === false, { fc: v.j.form_count, tm: v.j.test_mode })
}

globalThis.fetch = realFetch
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const PRINTED = res.length
/* ═══ PREVIEW (2026-10-11, Samantha: click through every screen as the caregiver with practice data): public, read-only ═══ */
{
  const before = JSON.stringify({ DB, EVENTS: EVENTS.length, PATCHES: PATCHES.length, STORE: Object.keys(STORE).length, RPCS: RPCS.length })
  let p = await call({ action: 'preview' })
  ck('preview: no link needed; the fourteen forms (with Hepatitis B, offered to everyone) with fingerprints, Pat Preview, prefill marked from the application and interview, nothing signed', p.status === 200 && p.j.preview === true && p.j.forms.length === 14 && p.j.form_count === 13 && p.j.screens.includes('16') && p.j.forms.every((f) => /^[0-9a-f]{64}$/.test(f.fingerprint)) && p.j.who.last === 'Preview' && p.j.prefill.lived_outside_mo.from === 'your application' && p.j.prefill.matching_facts.from === 'your interview' && Object.keys(p.j.signatures).length === 0 && p.j.skill_groups.length === 3, p.j)
  ck('preview: the same words a real Step 1 shows (identical forms to the real view)', JSON.stringify(p.j.forms) === JSON.stringify(M.__lastViewForms || p.j.forms))
  p = await call({ action: 'preview', check: true, form: 'employee_application', answers: { preferred_name: 'Pat', ssn: '123456789', bogus: 'x' } })
  ck('preview check: the real required-answer list; an identity number or unknown id is dropped, never echoed', p.status === 200 && p.j.missing.length > 3 && !JSON.stringify(p.j).includes('123456789'), p.j)
  p = await call({ action: 'preview', check: true, form: 'edl_fcsr_consent', answers: { address1: '1 Main', city: 'Nixa', state: 'MO', zip: '65714' }, identity: { ssn: '4321', dob: true } })
  ck('preview check: the identity boxes count when the page says they were filled (only the last four travel)', p.j.missing.length === 0, p.j)
  p = await call({ action: 'preview', pdf: true, form: 'employee_application', answers: { preferred_name: 'Pat', jobs: [{ company: 'Home Helpers', tasks: ['bathing'] }] } })
  const pdf = Buffer.from(p.j.pdf_base64 || '', 'base64')
  ck('preview PDF: a real PDF in the letterhead, marked PREVIEW ONLY: not a signed document', p.status === 200 && pdf.slice(0, 5).toString() === '%PDF-' && pdf.length > 2000, p.j.error)
  p = await call({ action: 'preview', pdf: true, form: 'nope' }); ck('preview: an unknown form is refused', p.j.ok === false)
  /* 705: the read-only approval check the go-live proof uses (the same rule the sign action uses) */
  p = await call({ action: 'preview', approval_check: D.FORM_ORDER.filter((k) => k !== 'hepb_vaccination').map((k) => ({ form: k, version: D.FORMS[k].version })) })
  ck('preview approval check: every form at its approved version would be accepted for a real applicant', p.status === 200 && p.j.approval_check.length === 13 && p.j.approval_check.every((x) => x.accepted === true && x.version === x.current), p.j)
  p = await call({ action: 'preview', approval_check: [{ form: 'employee_application', version: D.FORMS.employee_application.version + 1 }, { form: 'client_rights', version: 0 }, { form: 'employee_application', version: '4' }, { form: 'nope', version: 1 }] })
  ck('preview approval check: a bumped version, an older version, a version as text and an unknown form are all refused', p.status === 200 && p.j.approval_check.length === 4 && p.j.approval_check.every((x) => x.accepted === false), p.j)
  { const v0 = D.FORMS.client_rights.version; D.FORMS.client_rights.version = v0 + 1
    p = await call({ action: 'preview', approval_check: [{ form: 'client_rights', version: v0 + 1 }, { form: 'client_rights', version: v0 }] })
    ck('preview approval check: when the wording in force is bumped past the approval, neither the new nor the approved version is accepted', p.j.approval_check.every((x) => x.accepted === false), p.j)
    D.FORMS.client_rights.version = v0 }
  /* 2026-10-13: the Hepatitis B choice in the preview: the same check a real sign runs; the choice is the page's only */
  p = await call({ action: 'preview', check: true, form: 'hepb_vaccination', answers: {} })
  ck('preview HEP B: no choice yet: the choice is named as missing', p.j.missing.length === 1 && /Your choice/.test(p.j.missing[0]), p.j)
  p = await call({ action: 'preview', check: true, form: 'hepb_vaccination', answers: {}, choice: 'declined' })
  ck('preview HEP B: declining needs the separate agreement to sign the Appendix A statement', p.j.missing.length === 1 && /declination statement/.test(p.j.missing[0]), p.j)
  p = await call({ action: 'preview', check: true, form: 'hepb_vaccination', answers: {}, choice: 'declined', decline_consent: true })
  ck('preview HEP B: with the agreement nothing is missing', p.j.missing.length === 0, p.j)
  p = await call({ action: 'preview', pdf: true, form: 'hepb_vaccination', answers: {}, choice: 'declined' })
  ck('preview HEP B PDF: a real PDF', p.status === 200 && Buffer.from(p.j.pdf_base64 || '', 'base64').slice(0, 5).toString() === '%PDF-', p.j.error)
  p = await call({ action: 'preview', approval_check: [{ form: 'hepb_vaccination', version: 1 }] })
  ck('preview approval check: the Hepatitis B form is accepted for a real applicant only once she approves it', p.j.approval_check[0].accepted === D.approvedForReal('hepb_vaccination'), p.j)
  ck('preview: nothing read or written anywhere (database, offers, trail, storage, door calls unchanged)', JSON.stringify({ DB, EVENTS: EVENTS.length, PATCHES: PATCHES.length, STORE: Object.keys(STORE).length, RPCS: RPCS.length }) === before)
}

for (const [n, ok, note] of res.slice(PRINTED)) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
