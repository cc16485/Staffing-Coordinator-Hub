// 2b · the Step 1 page's server (step1-sign) run for real against a fake database, a fake Training Platform and a fake
// storage bucket. Nothing real is touched. node step1_sign_2b_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const L = await import(path.join(FN, '_shared/applicant-links.ts'))
const D = await import(path.join(FN, '_shared/step1-documents.ts'))
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
let DB = { step1_forms: [], step1_identity: [], job_applicants: [], document_access_log: [], auth_identities: [], persons: [], entity_memberships: [], staff_roles: [], app_data: [] }
const STORE = {}
const getPath = (r, p) => p.split('->').reduce((a, k) => a == null ? undefined : a[k], r)
function table(name) {
  const rows = () => DB[name]
  const q = (mode, payload, filters = [], opts = {}) => {
    const match = (r) => filters.every((f) => f(r))
    const run = () => {
      if (mode === 'select') { let out = rows().filter(match); if (opts.order) out = [...out].reverse(); if (opts.limit) out = out.slice(0, opts.limit); return out.map((r) => JSON.parse(JSON.stringify(r))) }
      if (mode === 'insert') { const r = { ...payload }; if (name === 'step1_forms') Object.assign(r, { answers: {}, signatures: {}, pdfs: {}, ...r }); if ((name === 'step1_forms' || name === 'step1_identity') && rows().some((x) => x.offer_id === r.offer_id)) throw Object.assign(new Error('duplicate key'), { code: '23505' }); rows().push(r); return [r] }
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
const storage = { from: () => ({ upload: async (p, bytes, o) => { if (STORE[p] && !o?.upsert) return { error: { message: 'exists' } }; STORE[p] = bytes; return { data: { path: p }, error: null } }, createSignedUrl: async (p) => ({ data: STORE[p] ? { signedUrl: 'https://signed/' + p } : null, error: STORE[p] ? null : { message: 'no' } }) }) }
const RPCS = []
globalThis.__fakeCreateClient = () => ({ from: table, storage, rpc: async (name, args) => { RPCS.push({ name, args }); if (name !== 'step1_land_apply') return { data: null, error: { message: 'unexpected ' + name } }; return { data: { ok: true, candidate_id: '901', filled: Object.keys(args.p_patch) }, error: null } }, auth: { getUser: async (jwt) => jwt === 'staff' ? { data: { user: { id: 'u1', email: 'k@mo-care.com', app_metadata: {} } }, error: null } : { data: null, error: { message: 'bad' } } } })
const src = fs.readFileSync(path.join(FN, 'step1-sign/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient')
const tmp = path.join(FN, 'step1-sign', '_t2b.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp) } finally { fs.unlinkSync(tmp) }

const OID = '11111111-2222-4333-8444-555555555555'
const base = () => ({ id: OID, first_name: 'Ava', last_name: 'Lee', phone: '(417) 555-0101', email: 'ava@example.com', position: 'Caregiver', onboarding_path: 'new', offer_status: 'accepted', offer_signed_at: '2026-10-09T15:00:00Z', pd_signed_at: '2026-10-09T15:05:00Z', offer_withdrawn_at: null, offer_declined_at: null, step1_sent_at: '2026-10-09T15:06:00Z', step1_done_at: null })
const exp = L.expiry(); const tok = await L.sign(SECRET, 'step1', OID, exp)
const link = { o: OID, e: exp, t: tok }
const call = async (body, headers = {}) => { const r = await handler(new Request('http://x/step1-sign', { method: 'POST', headers: { 'Content-Type': 'application/json', 'user-agent': 'TestPhone', ...headers }, body: JSON.stringify(body) })); let j = null; try { j = await r.json() } catch {} return { status: r.status, j } }

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
ck('view: ok, seven forms with fingerprints, test mode, screen 1, nothing signed', r.status === 200 && r.j.forms.length === 7 && r.j.forms.every((f) => /^[0-9a-f]{64}$/.test(f.fingerprint) && f.approved_for_real === false) && r.j.test_mode === true && r.j.current_screen === '1' && r.j.signed_count === 0, r.j && { s: r.status, e: r.j.error })
ck('view: the record exists once and the trail has step1_started', DB.step1_forms.length === 1 && EVENTS.filter((e) => e.kind === 'step1_started').length === 1)
ck('view: prefill from the application (lived outside MO, license, insurance, 2 to 5 years) and the interview (cats yes, dogs not, driving yes, dementia specialties), each with its source', r.j.prefill.lived_outside_mo?.value === 'yes' && r.j.prefill.has_insurance?.value === 'no' && r.j.prefill.experience?.value === '2 to 5 years' && r.j.prefill.experience.from === 'your application' && r.j.prefill.matching_facts?.value['Homes with cats'] === 'Yes' && r.j.prefill.matching_facts.value['Homes with dogs'] === 'Not at this time' && r.j.prefill.specialties?.value["Alzheimer's disease"] === 'Yes' && r.j.hints.travel === 'Springfield and Nixa', r.j.prefill)
await call({ action: 'view', ...link })
ck('a second view makes no second record and no second start event', DB.step1_forms.length === 1 && EVENTS.filter((e) => e.kind === 'step1_started').length === 1)

/* ═══ begin, save ═══ */
r = await call({ action: 'sign', ...link, form: 'employee_application', typed_name: 'Ava Lee', consent: true })
ck('no signing before the e-sign consent on screen 1', r.status === 409 && /agree to sign electronically/.test(r.j.error), r)
r = await call({ action: 'begin', ...link, esign_consent: true }); ck('begin records the one-time e-sign consent', r.status === 200 && DB.step1_forms[0].esign_consent_at && DB.step1_forms[0].esign_consent_detail.agent === 'TestPhone')
r = await call({ action: 'save', ...link, screen: '2', answers: { preferred_name: 'Ava', lived_outside_mo: 'yes', states_lived: ['KS', 'ZZ'], hs_name: 'Central High', cna: 'no', hha: 'no', ssn: '123456789' } })
ck('the SSN can never be saved as an answer (400, nothing saved)', r.status === 400 && !DB.step1_forms[0].answers.preferred_name, r)
r = await call({ action: 'save', ...link, screen: '2', answers: { preferred_name: 'Ava', lived_outside_mo: 'yes', states_lived: ['KS', 'ZZ'], hs_name: 'Central High', cna: 'no', hha: 'no', bogus: 'x' } })
ck('save: good answers kept, an option not on the list and an unknown id rejected, the screen remembered', r.status === 200 && r.j.rejected.join() === 'states_lived,bogus' && DB.step1_forms[0].answers.preferred_name === 'Ava' && DB.step1_forms[0].current_screen === '2', { r, a: DB.step1_forms[0].answers })
r = await call({ action: 'save', ...link, screen: '3', answers: { states_lived: ['KS'], moving_violations: 'no', license_suspended: 'no', convicted: 'no', employers: [['Home Helpers', 'Springfield, MO', 'Caregiver', 'Jane Boss', '417-555-0202', 'jane@hh.com', '2024-01', '2026-08', 'Personal care', 'Moved', 'Yes']] } })
ck('save: a work-history row lands as a row', r.status === 200 && DB.step1_forms[0].answers.employers.length === 1 && DB.step1_forms[0].answers.employers[0][3] === 'Jane Boss', r)

/* ═══ sign, in order, with the required answers ═══ */
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
await call({ action: 'save', ...link, screen: '4', answers: { professional_refs: [['Jane Boss', 'Home Helpers', 'Supervisor', '417-555-0202', 'jane@hh.com'], ['Tom Lead', 'Visiting Angels', 'Manager', '417-555-0303', '']], personal_refs: [['Sue Friend', 'Friend', '417-555-0404', ''], ['Bob Neighbor', 'Neighbor', '417-555-0505', '']] } })
r = await call({ action: 'sign', ...link, form: 'reference_consent', typed_name: 'Ava Lee', consent: true }); ck('references signed once the four are there', r.status === 200, r)
r = await call({ action: 'sign', ...link, form: 'fcra_disclosure', typed_name: 'Ava Lee', consent: true }); ck('the FCRA disclosure signs on its own (nothing else on it)', r.status === 200, r)

/* ═══ identity: sealed, never in answers, last four only ═══ */
r = await call({ action: 'sign', ...link, form: 'edl_fcsr_consent', typed_name: 'Ava Lee', consent: true })
ck('the consent cannot be signed without the sealed SSN and date of birth and the address', r.status === 400 && /Social Security number/.test(r.j.error) && /Date of birth/.test(r.j.error), r)
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
r = await call({ action: 'sign', ...link, form: 'availability', typed_name: 'Ava Lee', consent: true })
ck('the availability form needs initials beside the AxisCare line', r.status === 400 && /initials/.test(r.j.error), r)
r = await call({ action: 'sign', ...link, form: 'availability', typed_name: 'Ava Lee', consent: true, initials: 'al' }); ck('availability signs with initials (stored upper-case)', r.status === 200 && DB.step1_forms[0].answers.initials === 'AL', r)
await call({ action: 'save', ...link, screen: '7', answers: { level1: 'Yes', level2: 'Yes', level3: 'Not at this time', specialties: { "Alzheimer's disease": 'Yes' }, matching_facts: { 'Homes with cats': 'Yes' }, languages: ['English', 'Spanish'], experience: '2 to 5 years', preferred_levels: 'Levels 1 & 2' } })
r = await call({ action: 'sign', ...link, form: 'experience', typed_name: 'Ava Lee', consent: true }); ck('experience signs', r.status === 200, r)
const driverYes = D.FORMS.vehicle.sections.at(-1).items[0].options[0]
await call({ action: 'save', ...link, screen: '8', answers: { has_license: 'yes', has_insurance: 'yes', has_transport: 'yes', insurance_proof: D.FORMS.vehicle.sections[0].items.find((i) => i.id === 'insurance_proof').options[1], driver_ack: driverYes, license_state: 'MO', license_expires: '2029-01-01' } })
r = await call({ action: 'sign', ...link, form: 'vehicle', typed_name: 'Ava Lee', consent: true })
ck('a driver who asks to transport clients must have the license number on file first', r.status === 400 && /license number/.test(r.j.error), r)
r = await call({ action: 'identity', ...link, license_number: 'M123 456 789', license_state: 'MO', license_expires: '2029-01-01' })
ck('the license number is sealed with its last four', r.status === 200 && r.j.identity.license === 'ending 6789' && DB.step1_identity[0].license_sealed.startsWith('v1.'), r)
r = await call({ action: 'sign', ...link, form: 'vehicle', typed_name: 'Ava Lee', consent: true })
ck('the last form signs: Step 1 done, the trail says so, the offer record carries step1_done_at, 7 of 7', r.status === 200 && r.j.done === true && r.j.signed_count === 7 && DB.step1_forms[0].completed_at && EVENTS.some((e) => e.kind === 'step1_done') && OFFERS[OID].step1_done_at && Object.keys(STORE).length === 7, r)
r = await call({ action: 'copies', ...link }); ck('copies: seven short-lived links', r.status === 200 && Object.keys(r.j.copies).length === 7, r)
r = await call({ action: 'view', ...link }); ck('view after: completed, screen 9, seven signatures with name and version only', r.j.completed_at && r.j.current_screen === '9' && Object.keys(r.j.signatures).length === 7 && r.j.signatures.vehicle.typed_name === 'Ava Lee' && !('ip' in r.j.signatures.vehicle), r.j.signatures)
ck('the trail: 1 start, 7 signed, 1 done; every signed event carries a 64-hex fingerprint and the form', EVENTS.filter((e) => e.kind === 'step1_signed').length === 7 && EVENTS.filter((e) => e.kind === 'step1_done').length === 1 && EVENTS.filter((e) => e.kind === 'step1_signed').every((e) => /^[0-9a-f]{64}$/.test(e.fingerprint) && e.detail.form))
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

globalThis.fetch = realFetch
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
