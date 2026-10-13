// drug-test (Samantha's ruling 2026-10-13): the drug test record management keeps by hand, against a fake database and storage.
// Owners record; the reason is their own words (required, no list); results are read only by owners and the person who
// requested; others see only that a record exists; every line is permanent (corrections are new lines); a proof opens by a
// five-minute link and every open is logged; nothing is automatic anywhere. Fakes only.   node drug_test_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc' }
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
globalThis.fetch = async (u) => { throw new Error('unexpected fetch ' + u) }   // this function never calls out
const PEOPLE = { sam: ['p-sam', 'Samantha', 'samantha@mo-care.com', 'owner_admin'], zac: ['p-zac', 'Zachary', 'zachary@mo-care.com', 'owner_admin'], kry: ['p-kry', 'Krystal', 'krystal@mo-care.com', 'staffing_coordinator'], cc: ['p-cc', 'Casey', 'casey@mo-care.com', 'care_coordinator'] }
const DB = { drug_test_entry: [], document_access_log: [], auth_identities: [], persons: [], entity_memberships: [], staff_roles: [] }
for (const [tok, [pid, name, , role]] of Object.entries(PEOPLE)) { DB.auth_identities.push({ auth_user_id: 'u-' + tok, person_id: pid, project_ref: 'zngsgedlsxinbygwmxwn' }); DB.persons.push({ person_id: pid, full_name: name, active: true }); DB.entity_memberships.push({ person_id: pid, entity: 'cc_ihs', active: true, ended_at: null }); DB.staff_roles.push({ person_id: pid, entity: 'cc_ihs', role }) }
let FAIL_LOG = false, seq = 0, clock = 0
const WRITES = []
function table(name) {
  const rows = () => DB[name] || []
  const q = (mode, payload, filters = []) => {
    const run = () => {
      if (mode === 'insert') { WRITES.push(name)
        if (name === 'document_access_log' && FAIL_LOG) throw new Error('log down')
        const p = { ...payload }; if (name === 'drug_test_entry') { p.id = p.id || '00000000-0000-4000-8000-' + String(++seq).padStart(12, '0'); p.at = new Date(Date.UTC(2026, 9, 13, 15, 0, clock++)).toISOString()
          /* the table's own shape checks (drug-tests.sql) */
          if (p.kind === 'request' && !(p.date_requested && String(p.reason || '').trim() && p.requested_by_email && !p.test_id)) throw new Error('drug_test_request_shape')
          if (p.kind === 'result' && !(p.test_id && p.result && !p.corrects)) throw new Error('drug_test_result_shape')
          if (p.kind === 'correction' && !(p.test_id && p.corrects && String(p.correction_reason || '').trim())) throw new Error('drug_test_correction_shape') }
        DB[name].push(p); return [p] }
      return JSON.parse(JSON.stringify(rows().filter((r) => filters.every((f) => f(r))))) }
    const api = { eq: (k, v) => q(mode, payload, [...filters, (r) => String(r[k]) === String(v)]), in: (k, vs) => q(mode, payload, [...filters, (r) => vs.map(String).includes(String(r[k]))]),
      select: () => q(mode, payload, filters), order: () => api, limit: () => api,
      maybeSingle: async () => { try { return { data: run()[0] ?? null, error: null } } catch (e) { return { data: null, error: { message: e.message } } } },
      then: (ok) => { try { ok({ data: run(), error: null }) } catch (e) { ok({ data: null, error: { message: e.message } }) } } }
    return api }
  return { select: () => q('select'), insert: (p) => q('insert', p), update: () => { WRITES.push('UPDATE ' + name); throw new Error('no update') }, delete: () => { WRITES.push('DELETE ' + name); throw new Error('no delete') } }
}
const STORE = {}
const storage = { from: (bucket) => ({
  createSignedUploadUrl: async (p) => ({ data: { token: 'tok', signedUrl: 'https://up/' + bucket + '/' + p, path: p }, error: null }),
  list: async (prefix, o) => ({ data: Object.keys(STORE).filter((k) => k.startsWith(bucket + ':' + prefix + '/') && k.endsWith('/' + o.search)).map((k) => ({ name: k.split('/').pop() })), error: null }),
  createSignedUrl: async (p, s) => ({ data: STORE[bucket + ':' + p] ? { signedUrl: 'https://signed/' + bucket + '/' + p + '?s=' + s } : null, error: STORE[bucket + ':' + p] ? null : { message: 'no' } }) }) }
globalThis.__fakeCreateClient = () => ({ from: table, storage, rpc: async () => ({ data: null, error: null }), auth: { getUser: async (jwt) => PEOPLE[jwt] ? { data: { user: { id: 'u-' + jwt, email: PEOPLE[jwt][2], app_metadata: {} } }, error: null } : { data: null, error: { message: 'bad' } } } })
const TMP = path.join(ROOT, '.dt_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(FN, TMP, { recursive: true })
for (const p of fs.readdirSync(TMP, { recursive: true })) { const f = path.join(TMP, String(p)); if (!f.endsWith('.ts')) continue; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient').replace(/^import .* from ['"]https:[^'"]*['"];?$/mg, '')) }
try { await import(path.join(TMP, 'drug-test', 'index.ts')) } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const call = async (b, tok) => { const r = await handler(new Request('http://x/drug-test', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b) })); let j = null; try { j = await r.json() } catch {} return { status: r.status, j } }
const OID = '11111111-2222-4333-8444-555555555555', P = { offer_id: OID, applicant_id: 'app-1' }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })

let r = await call({ action: 'get', ...P })
ck('no sign-in: refused', r.status === 401)
r = await call({ action: 'get', ...P }, 'kry')
ck('nothing on file: an empty list; a coordinator may not record', r.status === 200 && r.j.tests.length === 0 && r.j.may_record === false, r.j)
r = await call({ action: 'request', ...P, date_requested: '2026-10-12', reason: 'Policy calls for it after an incident.' }, 'kry')
ck('a staffing coordinator cannot start a record (owners only), nothing saved', r.status === 403 && /Only an owner/.test(r.j.error) && !DB.drug_test_entry.length, r)
r = await call({ action: 'request', ...P, date_requested: '2026-10-12', reason: 'Policy calls for it after an incident.' }, 'cc')
ck('a care coordinator cannot either', r.status === 403 && !DB.drug_test_entry.length)
r = await call({ action: 'request', ...P, date_requested: '2026-10-12', reason: '  ' }, 'sam')
ck('the reason is required, in management\'s own words', r.status === 400 && /reason in your own words/.test(r.j.error) && !DB.drug_test_entry.length, r)
r = await call({ action: 'request', ...P, date_requested: '2099-01-01', reason: 'Policy calls for it after an incident.' }, 'sam')
ck('the date requested cannot be in the future', r.status === 400 && !DB.drug_test_entry.length, r)
r = await call({ action: 'request', reason: 'Policy calls for it after an incident.', date_requested: '2026-10-12' }, 'sam')
ck('a record needs a person', r.status === 400 && !DB.drug_test_entry.length)
r = await call({ action: 'request', ...P, name: 'Pat Practice', date_requested: '2026-10-12', reason: 'Our policy calls for a test here; details in the HR file.', test_type: '10-panel urine', notes: 'Scheduled at the clinic' }, 'sam')
const T1 = r.j?.test_id, L1 = DB.drug_test_entry[0] || {}
ck('an owner starts a record: requested by them (from their sign-in), the date, their reason as typed, the test type, notes', r.status === 200 && L1.id === T1 && L1.kind === 'request' && L1.requested_by_name === 'Samantha' && L1.requested_by_email === 'samantha@mo-care.com' && L1.requested_by_person === 'p-sam' && L1.date_requested === '2026-10-12' && L1.reason === 'Our policy calls for a test here; details in the HR file.' && L1.test_type === '10-panel urine' && L1.offer_id === OID && L1.applicant_id === 'app-1', L1)
r = await call({ action: 'get', ...P }, 'sam')
let t = r.j?.tests?.[0] || {}
ck('owner sees it: pending until a result is recorded, who requested, the reason, the type', r.status === 200 && r.j.may_record === true && t.result === 'pending' && t.requested_by.name === 'Samantha' && t.reason === L1.reason && t.test_type === '10-panel urine' && t.history.length === 1, t)
r = await call({ action: 'get', ...P }, 'kry')
ck('other office staff see ONLY that a record exists (no reason, type, result, dates or who)', r.status === 200 && r.j.tests.length === 1 && JSON.stringify(r.j.tests[0]) === JSON.stringify({ id: T1, restricted: true }), r.j)
r = await call({ action: 'get', applicant_id: 'app-1' }, 'sam')
ck('found by any of the person\'s keys (the applicant id alone)', r.j.tests.length === 1)
/* the result with its proof */
r = await call({ action: 'upload_url', test_id: T1, content_type: 'text/html' }, 'sam')
ck('upload: only photos or PDF', r.status === 400)
r = await call({ action: 'upload_url', test_id: T1, content_type: 'application/pdf' }, 'kry')
ck('upload: owners only', r.status === 403)
r = await call({ action: 'upload_url', test_id: T1, content_type: 'application/pdf' }, 'sam')
const PATH = r.j?.path
ck('upload: a signed slot in the PRIVATE bucket drug-test-docs, under this test', r.status === 200 && new RegExp('^dt/' + T1 + '/\\d+-[0-9a-f]{8}\\.pdf$').test(PATH) && /^https:\/\/up\/drug-test-docs\//.test(r.j.url), r.j)
r = await call({ action: 'result', test_id: T1, result: 'negative', result_date: '2026-10-13', proof_path: PATH, proof_content_type: 'application/pdf' }, 'sam')
ck('a proof that never arrived is refused', r.status === 400 && /did not arrive/.test(r.j.error), r)
STORE['drug-test-docs:' + PATH] = 1
r = await call({ action: 'result', test_id: T1, result: 'unclear', result_date: '2026-10-13' }, 'sam')
ck('only her five results: pending, negative, positive, refused, cancelled', r.status === 400 && /pending, negative, positive, refused or cancelled/.test(r.j.error))
r = await call({ action: 'result', test_id: T1, result: 'negative' }, 'sam')
ck('a negative, positive or refused result needs its date', r.status === 400 && /result date/.test(r.j.error))
r = await call({ action: 'result', test_id: T1, result: 'negative', result_date: '2026-10-13', proof_path: 'dt/someone-else/x.pdf', proof_content_type: 'application/pdf' }, 'sam')
ck('another test\'s file cannot be attached', r.status === 400 && /not this test/.test(r.j.error))
r = await call({ action: 'result', test_id: T1, result: 'negative', result_date: '2026-10-13' }, 'kry')
ck('a coordinator cannot record a result', r.status === 403)
r = await call({ action: 'result', test_id: T1, result: 'negative', result_date: '2026-10-13', proof_path: PATH, proof_content_type: 'application/pdf', notes: 'MRO report attached' }, 'sam')
const R1 = r.j?.entry_id
r = await call({ action: 'get', ...P }, 'sam'); t = r.j.tests[0]
ck('the result as recorded by management, its date, the proof, notes; history keeps both lines', R1 && t.result === 'negative' && t.result_date === '2026-10-13' && t.has_proof && t.proof_entry_id === R1 && t.result_notes === 'MRO report attached' && t.history.map((h) => h.kind).join() === 'request,result', t)
r = await call({ action: 'get', ...P }, 'kry')
ck('still nothing but "a record exists" for other staff after the result', JSON.stringify(r.j.tests[0]) === JSON.stringify({ id: T1, restricted: true }))
/* opening the proof */
r = await call({ action: 'open', entry_id: R1 }, 'kry')
ck('a coordinator cannot open the proof', r.status === 403 && !DB.document_access_log.length)
FAIL_LOG = true; r = await call({ action: 'open', entry_id: R1 }, 'sam'); FAIL_LOG = false
ck('when the open cannot be logged, no link is given', r.status === 500 && !r.j.url && /could not be logged/.test(r.j.error), r)
r = await call({ action: 'open', entry_id: R1 }, 'sam')
const lg = DB.document_access_log.at(-1) || {}
ck('owner opens it: a five-minute link, the open logged with her name', r.status === 200 && /^https:\/\/signed\/drug-test-docs\/dt\//.test(r.j.url) && r.j.expires_in === 300 && lg.offer_id === 'drugtest:' + T1 && lg.by_name === 'Samantha' && lg.path === PATH, [r.j, lg])
/* corrections never overwrite */
const before = JSON.stringify(DB.drug_test_entry)
r = await call({ action: 'correct', entry_id: R1, result: 'cancelled' }, 'sam')
ck('a correction needs its reason', r.status === 400 && /what is being corrected and why/.test(r.j.error) && JSON.stringify(DB.drug_test_entry) === before)
r = await call({ action: 'correct', entry_id: R1, result: 'cancelled', result_date: '2026-10-13', correction_reason: 'Wrong person picked; the clinic cancelled.' }, 'kry')
ck('a coordinator cannot correct', r.status === 403)
r = await call({ action: 'correct', entry_id: R1, result: 'cancelled', correction_reason: 'Wrong person picked; the clinic cancelled.' }, 'sam')
const C1 = DB.drug_test_entry.at(-1)
ck('correction: a NEW line naming the line it corrects; every earlier line exactly as it was', r.status === 200 && C1.kind === 'correction' && C1.corrects === R1 && C1.test_id === T1 && C1.result === 'cancelled' && C1.proof_path === PATH && C1.correction_reason === 'Wrong person picked; the clinic cancelled.' && JSON.stringify(DB.drug_test_entry.slice(0, -1)) === before, C1)
r = await call({ action: 'get', ...P }, 'sam'); t = r.j.tests[0]
ck('the record now reads the corrected result; the history shows all three lines', t.result === 'cancelled' && t.corrected === true && t.history.map((h) => h.kind).join() === 'request,result,correction' && t.history[2].corrects === R1 && t.history[1].result === 'negative', t)
r = await call({ action: 'correct', entry_id: T1, reason: 'Our written policy calls for this test; see the HR file.', correction_reason: 'Reason reworded' }, 'sam')
r = await call({ action: 'get', ...P }, 'sam'); t = r.j.tests[0]
ck('correcting the request: the reason changes by a new line; who requested never changes', t.reason === 'Our written policy calls for this test; see the HR file.' && t.requested_by.name === 'Samantha' && t.date_requested === '2026-10-12' && DB.drug_test_entry.filter((x) => x.kind === 'correction').length === 2, t)
r = await call({ action: 'correct', entry_id: T1, reason: 'no', correction_reason: 'shorter' }, 'sam')
ck('a correction cannot empty the reason', r.status === 400)
/* the person who requested keeps access even without the owner role; others never see the details */
r = await call({ action: 'request', ...P, date_requested: today, reason: 'Requested under our policy by Zachary.' }, 'zac')
const T2 = r.j?.test_id
DB.staff_roles.find((x) => x.person_id === 'p-zac').role = 'care_coordinator'
r = await call({ action: 'get', ...P }, 'zac')
const byId = Object.fromEntries((r.j?.tests || []).map((x) => [x.id, x]))
ck('the person who requested sees their own test in full, but only "a record exists" for the other', byId[T2] && byId[T2].reason === 'Requested under our policy by Zachary.' && JSON.stringify(byId[T1]) === JSON.stringify({ id: T1, restricted: true }) && r.j.may_record === false, r.j)
r = await call({ action: 'result', test_id: T2, result: 'pending' }, 'zac')
ck('without the owner role they can no longer record', r.status === 403)
/* nothing is ever changed or removed; nothing is automatic */
ck('the function only ever inserts (never an update or delete) and writes only its own lines and the open log', !WRITES.some((w) => /^(UPDATE|DELETE)/.test(w)) && WRITES.every((w) => ['drug_test_entry', 'document_access_log'].includes(w)), [...new Set(WRITES)])
const src = fs.readFileSync(path.join(FN, 'drug-test/index.ts'), 'utf8'), code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
ck('no automation: no sends, no cards, no readiness rows, no schedule door, no settings', !/ghl|sendChecked|raiseCard|upsert_app_data_item|client_journey|jobCaller|serverSecretOk|x-cron-secret|ops_settings|app_data/i.test(code))
ck('no preset grounds anywhere in the server (the reason is free text)', !/reasonable suspicion|post-accident|post accident|random (test|testing|selection|pool)|pre-employment|return to duty|follow-up testing/i.test(src))
const others = []
for (const p of fs.readdirSync(FN, { recursive: true })) { const f = path.join(FN, String(p)); if (!f.endsWith('.ts') || f.includes(path.sep + 'drug-test' + path.sep) || f.endsWith(path.sep + 'step1-documents.ts')) continue; if (/drug_test|drug-test|drug test/i.test(fs.readFileSync(f, 'utf8'))) others.push(p) }
ck('no other function reads, triggers or reminds about drug tests', !others.length, others)
const docs = fs.readFileSync(path.join(FN, '_shared/step1-documents.ts'), 'utf8')
ck('the conditional drug-testing language stays in the Employment Agreement (her ruling), and Step 1 asks for no drug test', /if Employer requires one under its screening policy/.test(docs) && !/drug_test|drug-test/i.test(docs))
const sq = fs.readFileSync(path.join(ROOT, 'supabase/drug-tests.sql'), 'utf8')
ck('no em dash and no "plain language" in the function or the SQL; CORS from day one', !/—/.test(src + sq) && !/plain (language|english)/i.test(src + sq) && /OPTIONS/.test(src) && /Access-Control-Allow-Origin/.test(src))
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
