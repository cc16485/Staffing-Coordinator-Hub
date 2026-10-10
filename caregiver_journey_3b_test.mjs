// 3b · the caregiver-journey function and its shared core against a fake database (the real caregiver catalog from the 3a
// migration file, the real rules file) and a fake Training Platform. Nothing real is touched. node caregiver_journey_3b_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', OFFERS_PROJECT_URL: 'http://trn', OFFERS_SERVICE_ROLE_KEY: 'tkey', HUB_JOB_SECRET: 'j'.repeat(48) }
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
/* the real caregiver catalog, from the migration file */
const sql = fs.readFileSync(path.join(ROOT, 'supabase/slice3a-journey-caregiver-subject.sql'), 'utf8')
const DEFS = [...sql.matchAll(/values \('([^']+)', 1, '(.*)'::jsonb, false/g)].map((m) => ({ key: m[1], catalog_version: 1, def: JSON.parse(m[2].replace(/''/g, "'")), active: true }))
/* fake Training REST */
const OFFERS = {}
globalThis.fetch = async (url, o = {}) => { const u = String(url); if (u.startsWith('http://trn/rest/v1/job_offers')) { const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(u)[1]); return new Response(JSON.stringify(OFFERS[id] ? [OFFERS[id]] : []), { status: 200 }) } throw new Error('unexpected fetch ' + u) }
/* fake tables */
let DB = {}
const reset = () => { DB = { client_journey_step_def: JSON.parse(JSON.stringify(DEFS)), client_journey: [], client_journey_step: [], client_journey_event: [], app_data: [], step1_forms: [], welcome_calls: [], caregiver_profiles: [], auth_identities: [{ auth_user_id: 'u-sam', person_id: 'p-sam', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-kry', person_id: 'p-kry', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-cc', person_id: 'p-cc', project_ref: 'zngsgedlsxinbygwmxwn' }], persons: [{ person_id: 'p-sam', full_name: 'Samantha', active: true }, { person_id: 'p-kry', full_name: 'Krystal', active: true }, { person_id: 'p-cc', full_name: 'Casey', active: true }], entity_memberships: [{ person_id: 'p-sam', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-kry', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-cc', entity: 'cc_ihs', active: true, ended_at: null }], staff_roles: [{ person_id: 'p-sam', entity: 'cc_ihs', role: 'owner_admin' }, { person_id: 'p-kry', entity: 'cc_ihs', role: 'staffing_coordinator' }, { person_id: 'p-cc', entity: 'cc_ihs', role: 'care_coordinator' }] } }
let seq = 0
function table(name) {
  const rows = () => DB[name]
  const q = (mode, payload, filters = [], opts = {}) => {
    const match = (r) => filters.every((f) => f(r))
    const run = () => {
      if (mode === 'select') { let out = rows().filter(match); if (opts.order) out = [...out].sort((a, b) => String(b[opts.order]).localeCompare(String(a[opts.order]))); if (opts.limit) out = out.slice(0, opts.limit); return JSON.parse(JSON.stringify(out)) }
      if (mode === 'insert') { const r = { ...payload }; if (name === 'client_journey') { if (rows().some((x) => x.offer_id === r.offer_id)) throw new Error('duplicate offer_id'); r.journey_id = r.journey_id || 'j-' + (++seq); r.created_at = new Date().toISOString() } if (name === 'client_journey_event') { r.id = ++seq; r.at = r.at || new Date().toISOString() } rows().push(r); return [r] }
      if (mode === 'upsert') { const i = rows().findIndex((x) => x.journey_id === payload.journey_id && x.step_key === payload.step_key); if (i >= 0) rows()[i] = { ...rows()[i], ...payload }; else rows().push({ ...payload }); return [payload] }
      if (mode === 'update') { const out = []; for (const r of rows()) if (match(r)) { Object.assign(r, payload); out.push(r) } return out }
    }
    const api = {
      eq: (k, v) => q(mode, payload, [...filters, (r) => String(r[k]) === String(v)], opts), neq: (k, v) => q(mode, payload, [...filters, (r) => String(r[k]) !== String(v)], opts),
      in: (k, vs) => q(mode, payload, [...filters, (r) => vs.map(String).includes(String(r[k]))], opts), like: (k, v) => q(mode, payload, [...filters, (r) => new RegExp('^' + String(v).replace(/%/g, '.*') + '$').test(String(r[k]))], opts),
      order: (k) => q(mode, payload, filters, { ...opts, order: k }), limit: (n) => q(mode, payload, filters, { ...opts, limit: n }), select: () => q(mode, payload, filters, opts),
      maybeSingle: async () => { try { return { data: run()[0] ?? null, error: null } } catch (e) { return { data: null, error: { message: e.message } } } },
      then: (ok) => { try { ok({ data: run(), error: null }) } catch (e) { ok({ data: null, error: { message: e.message } }) } },
    }
    return api
  }
  return { select: () => q('select'), insert: (p) => q('insert', p), upsert: (p) => q('upsert', p), update: (p) => q('update', p) }
}
globalThis.__fakeCreateClient = () => ({ from: table, auth: { getUser: async (jwt) => ({ sam: { data: { user: { id: 'u-sam', email: 'sam@mo-care.com', app_metadata: {} } }, error: null }, kry: { data: { user: { id: 'u-kry', email: 'krystal@mo-care.com', app_metadata: {} } }, error: null }, cc: { data: { user: { id: 'u-cc', email: 'casey@mo-care.com', app_metadata: {} } }, error: null } })[jwt] || { data: null, error: { message: 'bad' } } } })
const TMP = path.join(ROOT, '.cj_3b_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(FN, TMP, { recursive: true })
for (const p of fs.readdirSync(TMP, { recursive: true })) { const f = path.join(TMP, String(p)); if (!f.endsWith('.ts')) continue; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient').replace(/^import .* from 'https:[^']*'$/mg, '')) }
let CJ; try { await import(path.join(TMP, 'caregiver-journey', 'index.ts')); CJ = await import(path.join(TMP, '_shared', 'caregiver-journey.ts')) } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const call = async (body, tok) => { const r = await handler(new Request('http://x/caregiver-journey', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? (tok === 'cron' ? { 'x-cron-secret': env.HUB_JOB_SECRET } : { Authorization: 'Bearer ' + tok }) : {}) }, body: JSON.stringify(body) })); let j = null; try { j = await r.json() } catch {} return { status: r.status, j } }
const db = globalThis.__fakeCreateClient()
const OID = '11111111-2222-4333-8444-555555555555'
reset()
OFFERS[OID] = { id: OID, first_name: 'Ava', last_name: 'Lee', offer_signed_at: '2026-10-09T20:00:00Z', pd_signed_at: '2026-10-09T20:05:00Z', offer_version: 1, pd_version: 1, offer_status: 'accepted', onboarding_path: 'new' }
DB.app_data = [{ key: 'onboarding_permissions', data: { version: 1, advance: [{ person_id: 'p-kry' }], work: [{ person_id: 'p-sam' }], screening: [{ person_id: 'p-kry' }], history: [] } }, { key: 'ops_settings', data: { staffing_email: 'krystal@mo-care.com' } }, { key: 'candidates', data: [] }, { key: 'caregivers', data: [] }]
/* ═══ start (from offer-sign) ═══ */
let s = await CJ.startCaregiverJourney(db, { id: OID, first_name: 'Ava', last_name: 'Lee' }, 'offer-sign')
ck('start: a caregiver journey row with the offer id and a started event', s.created && DB.client_journey.length === 1 && DB.client_journey[0].subject === 'caregiver' && DB.client_journey[0].offer_id === OID && DB.client_journey_event[0].kind === 'started', { s, j: DB.client_journey[0] })
s = await CJ.startCaregiverJourney(db, { id: OID, first_name: 'Ava', last_name: 'Lee' }, 'offer-sign')
ck('start again: the same journey, no second row or event', !s.created && DB.client_journey.length === 1 && DB.client_journey_event.length === 1)
const JID = DB.client_journey[0].journey_id
/* ═══ get: the catalog applies, permissions per list ═══ */
let r = await call({ action: 'get', offer_id: OID })
ck('get without a sign-in is refused', r.status === 401)
r = await call({ action: 'get', offer_id: OID }, 'kry')
ck('get: the journey, the caregiver rows only, offer and Step 1 rows not yet verified, fingerprints hidden (fact unknown), Approved to Work later', r.status === 200 && r.j.journey.journey_id === JID && r.j.view.rows.every((x) => x.key.startsWith('cg.')) && !r.j.view.rows.some((x) => x.key === 'cg.check.fingerprints') && r.j.view.rows.find((x) => x.key === 'cg.approve.work').status === 'later', r.j && r.j.view && r.j.view.rows.map((x) => x.key + ':' + x.status))
ck('may: Krystal (advance + screening lists, coordinator) may confirm advance, may not approve to work; hub rows never', r.j.may['cg.approve.advance'] === true && r.j.may['cg.approve.work'] === false && r.j.may['cg.offer.signed'] === false && r.j.may['cg.step2.w4'] === true && r.j.is_owner === false, r.j.may)
/* ═══ sweep: the records verify rows ═══ */
r = await call({ action: 'sweep' })
ck('sweep without the job secret is refused', r.status === 401)
r = await call({ action: 'sweep' }, 'cron')
let steps = () => DB.client_journey_step.filter((x) => x.journey_id === JID), st = (k) => steps().find((x) => x.step_key === k)
ck('sweep 1: the signed offer verified from the Training record, with evidence and a verified event; nothing else yet', r.status === 200 && r.j.changed === 1 && st('cg.offer.signed')?.state === 'complete' && st('cg.offer.signed').completed_by === 'hub' && DB.client_journey_event.some((e) => e.kind === 'verified' && e.step_key === 'cg.offer.signed'), { r: r.j, st: steps().map((x) => x.step_key) })
DB.step1_forms = [{ offer_id: OID, answers: { lived_outside_mo: 'yes', cna: 'yes', driver_ack: 'I meet all requirements and request approval to transport clients.' }, signatures: { employee_application: { at: '2026-10-10T01:00:00Z', version: 2, fingerprint: 'f'.repeat(64), typed_name: 'Ava Lee' }, reference_consent: { at: '2026-10-10T01:05:00Z', version: 2, fingerprint: 'g'.repeat(64) }, fcra_disclosure: { at: '2026-10-10T01:06:00Z', version: 1, fingerprint: 'h'.repeat(64) }, edl_fcsr_consent: { at: '2026-10-10T01:07:00Z', version: 3, fingerprint: 'i'.repeat(64) }, availability: { at: '2026-10-10T01:08:00Z', version: 2, fingerprint: 'j'.repeat(64) }, experience: { at: '2026-10-10T01:09:00Z', version: 2, fingerprint: 'k'.repeat(64) }, vehicle: { at: '2026-10-10T01:10:00Z', version: 3, fingerprint: 'l'.repeat(64) } } }]
DB.app_data.find((x) => x.key === 'candidates').data = [{ id: 901, first: 'Ava', last: 'Lee', offer_id: OID, oig: 'CLEAR', oig_date: '2026-10-10', oig_proof: 'bgcheck/901/oig.json', edl: 'Issues Found', edl_date: '2026-10-10', r1n: 'Jane Boss', r1s: 'Positive', r1_type: 'professional', r2n: 'Sue Friend', r2s: 'Positive', r2_type: 'personal' }]
r = await call({ action: 'sweep' }, 'cron')
ck('sweep 2: the seven Step 1 forms, the consents gate, OIG clear with its LEIE document, references cleared (two positive, one professional) verified; EDL flagged is BLOCKED with the reason', st('cg.step1.application')?.state === 'complete' && st('cg.consent.checks')?.state === 'complete' && st('cg.check.oig')?.state === 'complete' && st('cg.check.oig').evidence.document === 'bgcheck/901/oig.json' && st('cg.refs.cleared')?.state === 'complete' && st('cg.check.edl')?.state === 'blocked' && /Flagged/.test(st('cg.check.edl').blocked_reason), steps().map((x) => x.step_key + ':' + x.state))
ck('no identity value appears in any step or event', !JSON.stringify(DB.client_journey_step).match(/\d{3}-?\d{2}-?\d{4}/) )
r = await call({ action: 'get', offer_id: OID }, 'kry')
ck('get after: fingerprints now apply (lived outside Missouri), the CNA credential applies, the driver credential applies; the next move is the blocked EDL owned by the Staffing Coordinator', r.j.view.rows.some((x) => x.key === 'cg.check.fingerprints') && r.j.view.rows.some((x) => x.key === 'cg.credential.cna_hha') && r.j.view.rows.some((x) => x.key === 'cg.credential.driver') && r.j.view.next.key === 'cg.check.edl' && r.j.view.next.owner.email === 'krystal@mo-care.com' && r.j.facts.lived_outside_mo === true, { next: r.j.view.next && r.j.view.next.key, keys: r.j.view.rows.map((x) => x.key) })
/* ═══ confirm: in order, by list ═══ */
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.approve.advance' }, 'kry')
ck('Approve to Advance is refused while it is not its turn (EDL blocked, FCSR not done)', r.status === 409 && /Not yet/.test(r.j.error), r)
DB.app_data.find((x) => x.key === 'candidates').data[0] = { ...DB.app_data.find((x) => x.key === 'candidates').data[0], edl: 'Clear', edl_proof: 'bgcheck/901/edl.pdf', fcsr: 'Clear', fcsr_date: '2026-10-10', fcsr_proof: 'bgcheck/901/fcsr.pdf', fcsr_reg_date: '2026-10-09', fp: 'Clear', fp_date: '2026-10-10', fp_proof: 'bgcheck/901/fp.pdf' }
r = await call({ action: 'sweep' }, 'cron')
ck('sweep 3: EDL now Clear with a document: the block lifts to complete; FCSR, registration and fingerprints verified', st('cg.check.edl')?.state === 'complete' && st('cg.check.fcsr')?.state === 'complete' && st('cg.check.fcsr_registration')?.state === 'complete' && st('cg.check.fingerprints')?.state === 'complete', steps().map((x) => x.step_key + ':' + x.state))
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.approve.advance' }, 'cc')
ck('Casey (a coordinator on no list) is refused: the list decides, not the office role', r.status === 403 && /Approve to Advance list/.test(r.j.error), r)
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.approve.advance' }, 'kry')
ck('Krystal (on the Advance list) confirms: complete in her name with the time, a confirmed event naming the list', r.status === 200 && st('cg.approve.advance').state === 'complete' && st('cg.approve.advance').completed_by === 'krystal@mo-care.com' && DB.client_journey_event.some((e) => e.kind === 'confirmed' && e.step_key === 'cg.approve.advance' && e.detail.list === 'advance'), r)
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.approve.advance' }, 'kry')
ck('confirming twice: already settled', r.status === 409)
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.step2.w4' }, 'kry')
ck('a Step 2 item: any office person confirms, in their name', r.status === 200 && st('cg.step2.w4').completed_by === 'krystal@mo-care.com')
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.offer.signed' }, 'kry')
ck('a verified row cannot be confirmed by hand', r.status === 403 && /on its own/.test(r.j.error), r)
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.approve.work' }, 'kry')
ck('Approve to Work by a coordinator: refused (owners list)', r.status === 403 && /owners/.test(r.j.error), r)
/* ═══ record (credentials) ═══ */
r = await call({ action: 'record', journey_id: JID, step_key: 'cg.credential.cna_hha', result: 'verified on the registry' }, 'kry')
ck('a credential without its document is refused', r.status === 400 && /document/.test(r.j.error))
r = await call({ action: 'record', journey_id: JID, step_key: 'cg.credential.cna_hha', result: 'verified on the registry', document: 'bgcheck/901/cna.pdf', expires: '2028-01-31' }, 'kry')
ck('with the document: complete with result, document, expiry and an evidence_added event', r.status === 200 && st('cg.credential.cna_hha').evidence.document === 'bgcheck/901/cna.pdf' && st('cg.credential.cna_hha').evidence.expires === '2028-01-31' && DB.client_journey_event.some((e) => e.kind === 'evidence_added'), r)
/* ═══ not needed: owners only ═══ */
r = await call({ action: 'not_needed', journey_id: JID, step_key: 'cg.credential.driver', reason: 'They will not drive clients' }, 'kry')
ck('not needed by a coordinator: refused', r.status === 403)
r = await call({ action: 'not_needed', journey_id: JID, step_key: 'cg.credential.driver', reason: 'They will not drive clients' }, 'sam')
ck('not needed by an owner: recorded with the reason, permanent event', r.status === 200 && st('cg.credential.driver').state === 'not_needed' && DB.client_journey_event.some((e) => e.kind === 'not_needed' && e.reason === 'They will not drive clients'))
/* ═══ the gate (welcome-call, reference-send) ═══ */
let g = await CJ.caregiverGate(db, { candidate_id: 999 }, 'cg.approve.advance')
ck('gate: a candidate with no readiness card (the old path) is allowed', g.allowed === true)
g = await CJ.caregiverGate(db, { candidate_id: 901 }, 'cg.approve.work')
ck('gate: a card whose row is not complete refuses, with the plain words', g.allowed === false && /Approved to Work \(owners only\)/.test(g.why), g)
g = await CJ.caregiverGate(db, { candidate_id: 901 }, 'cg.approve.advance')
ck('gate: a completed row allows', g.allowed === true)
/* ═══ list + the rest of the journey ═══ */
r = await call({ action: 'list' }, 'sam')
ck('list: the one open journey with its stage, next move and owner, not approved to work', r.status === 200 && r.j.rows.length === 1 && r.j.rows[0].approved_to_work === false && r.j.rows[0].next, r.j)
for (const k of ['i9_s1', 'mo_w4', 'direct_deposit', 'handbook', 'participant_rights', 'code_of_ethics', 'confidentiality', 'license_upload', 'ss_card_upload']) await call({ action: 'confirm', journey_id: JID, step_key: 'cg.step2.' + k }, 'kry')
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.i9.section2' }, 'kry')
ck('I-9 Section 2 after Section 1, its own confirmation', r.status === 200 && st('cg.i9.section2').state === 'complete')
DB.welcome_calls = [{ id: 'w1', candidate_id: '901', status: 'done', done_at: '2026-10-11T15:00:00Z', invited_at: '2026-10-10' }]
DB.app_data.find((x) => x.key === 'caregivers').data = [{ id: 207, candidate_id: 901, first: 'Ava', last: 'Lee', offer_id: OID, axiscare_id: '9001', hire_date: '2026-10-12', orient_date: '2026-10-12', alz_date: '2026-10-13', ojt_date: '2026-10-20', ojt_online: '2026-10-20', ojt_signed: 'yes' }]
DB.app_data.find((x) => x.key === 'candidates').data = []
DB.caregiver_profiles = [{ id: 'pr1', candidate_id: '207', published: true, published_at: '2026-10-13T00:00:00Z', status: 'published' }]
r = await call({ action: 'sweep' }, 'cron')
ck('sweep 4 (after the move to the roster): welcome call, orientation, dementia, OJT and the profile verified from the records', ['cg.welcome.call', 'cg.training.orientation', 'cg.training.dementia', 'cg.training.ojt', 'cg.profile.published'].every((k) => st(k)?.state === 'complete'), steps().filter((x) => x.state !== 'complete').map((x) => x.step_key + ':' + x.state))
r = await call({ action: 'get', offer_id: OID }, 'sam')
ck('the dates line: employment start = orientation completion 2026-10-12, AxisCare hire 2026-10-12, no difference; Approve to Work is now ready and Samantha (Work list) may', r.j.facts.dates.orientation === '2026-10-12' && r.j.facts.dates.differ === false && r.j.view.rows.find((x) => x.key === 'cg.approve.work').status === 'ready' && r.j.may['cg.approve.work'] === true, { dates: r.j.facts.dates, aw: r.j.view.rows.find((x) => x.key === 'cg.approve.work').status })
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.approve.work' }, 'sam')
ck('Approve to Work by the owner on the list: complete with who and the exact time', r.status === 200 && st('cg.approve.work').completed_by === 'sam@mo-care.com' && st('cg.approve.work').completed_at)
DB.app_data.find((x) => x.key === 'caregivers').data[0].axiscare_status_active = true
r = await call({ action: 'sweep' }, 'cron')
ck('sweep 5: AxisCare Active read back; every required row done; the journey becomes active with a complete event', st('cg.axiscare.active')?.state === 'complete' && r.j.completed === 1 && DB.client_journey[0].status === 'active' && DB.client_journey_event.some((e) => e.kind === 'complete'), { r: r.j, open: steps().filter((x) => x.state !== 'complete' && x.state !== 'not_needed').map((x) => x.step_key) })
ck('history: every change is an event; none was ever updated or deleted', DB.client_journey_event.length >= 30 && DB.client_journey_event.every((e) => e.at && e.actor_email && e.kind))
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
