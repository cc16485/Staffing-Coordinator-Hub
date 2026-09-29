// J1 · the 11 scheduled jobs that contact people or delete things answer only their schedule (the S3 vault secret),
// the owner's server key, or (the coverage picker, the morning-brief test) signed-in active office staff.
// Real functions against a fake database and fake GoHighLevel; nothing real is reached. node j1_job_locks_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions';
/* The clock the functions see: outreach hours read hour + weekday; the morning brief reads a Chicago date-time. */
const CLOCK = { hour: '10', wd: 'Tue', sv: '2026-10-06 07:30:00' }
const realTLS = Date.prototype.toLocaleString;
Date.prototype.toLocaleString = function (loc, o) {
  if (o && o.hour === '2-digit' && !o.minute) return CLOCK.hour; if (o && o.weekday === 'short' && !o.hour) return CLOCK.wd
  if (loc === 'sv-SE' && o && o.timeZone && Object.keys(o).length === 1) return CLOCK.sv
  return realTLS.call(this, loc, o); };
let T, APP, SENT
const reset = () => {
  APP = {}; SENT = []
  T = { contact_optout_current: [], circle_contacts: [], phone_index: [], applicant_alerts: [], nurse_staff: [], coordinator_staff: [],
    auth_identities: [{ auth_user_id: 'u-owner', person_id: 'p-owner', project_ref: 'zngsgedlsxinbygwmxwn' },
                      { auth_user_id: 'u-norole', person_id: 'p-norole', project_ref: 'zngsgedlsxinbygwmxwn' }],
    persons: [{ person_id: 'p-owner', active: true, full_name: 'Olive Owner' }, { person_id: 'p-norole', active: true, full_name: 'Nora Norole' }],
    entity_memberships: [{ person_id: 'p-owner', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-norole', entity: 'cc_ihs', active: true, ended_at: null }],
    staff_roles: [{ person_id: 'p-owner', entity: 'cc_ihs', role: 'owner_admin' }] }
}
const q = (t) => { const st = { f: [], nn: null, inF: null }; const b = {
  select() { return b; }, order() { return b; }, limit() { return b; }, contains() { return b; }, range() { return b; }, or() { return b; }, is() { return b; },
  gte() { return b; }, ilike() { return b; }, lte() { return b; }, lt() { return b; }, gt() { return b; }, neq() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; }, in(c, v) { st.inF = [c, v]; return b; }, not(c) { st.nn = c; return b; },
  update() { return { eq: () => Promise.resolve({ data: null, error: null }) }; },
  upsert(row) { return Promise.resolve({ data: row, error: null }); },
  insert(row) { (T[t] ||= []).push(row); return Promise.resolve({ data: row, error: null }); },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })); },
  single() { return b.maybeSingle(); },
  then(ok) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok); }
    let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v)
    if (st.inF) rows = rows.filter((r) => st.inF[1].includes(r[st.inF[0]])); if (st.nn) rows = rows.filter((r) => r[st.nn] != null)
    return Promise.resolve({ data: rows, error: null }).then(ok);
  } }; return b; };
const USERS = { 'jwt-owner': { id: 'u-owner', email: 'owner@mo-care.com', app_metadata: {} }, 'jwt-norole': { id: 'u-norole', email: 'norole@mo-care.com', app_metadata: {} } }
globalThis.__db = { from: q,
  rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) } return { data: [], error: null } },
  storage: { from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }) },
  auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: USERS[jwt] }, error: null } : { data: { user: null }, error: { message: 'bad' } } } };
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, type: body.type }); return new Response('{}', { status: 200 }) }
  if (url.includes('api.resend.com')) { SENT.push({ to: body.to?.[0], type: 'resend' }); return new Response('{"id":"x"}', { status: 200 }) }
  if (url.includes('axiscare')) return new Response(JSON.stringify({ results: [], nextPage: null }), { status: 200 })
  return new Response('{}', { status: 200 })
}
const SVC = 'svc_' + 'k'.repeat(60), JOBSEC = 'j'.repeat(64)
const ENV = { HUB_JOB_SECRET: JOBSEC, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc',
  AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', RESEND_API_KEY: 'r' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
globalThis.__dbFor = (key) => ({ from: (t) => { const b = { select() { return b; }, limit() { return Promise.resolve(t === 'identity_door_audit' && key !== SVC ? { data: null, error: { message: 'permission denied' } } : { data: [], error: null }); } }; return b; } })
{ const ja = fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)')
  fs.writeFileSync(`${FN}/_shared/_job-auth_t.ts`, ja) }
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_t.ts`) } catch { /* */ } })
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_t.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); } return handler; };
const call = async (h, url, headers = {}, body = {}, method = 'POST') => {
  const r = await h(new Request(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }))
  let j = null; try { j = await r.json() } catch { /* */ } return { s: r.status, j } }
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const ANON = 'eyJ' + 'a'.repeat(120)
const FORGED = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ role: 'service_role', iss: 'supabase' }) + '.' + 'x'.repeat(43)
const H = { none: {}, anon: { Authorization: 'Bearer ' + ANON, apikey: ANON }, wrong: { Authorization: 'Bearer ' + ANON, 'x-cron-secret': 'x'.repeat(64) },
  forged: { Authorization: 'Bearer ' + FORGED, apikey: ANON }, staff: { Authorization: 'Bearer jwt-owner' }, norole: { Authorization: 'Bearer jwt-norole' },
  cron: { Authorization: 'Bearer ' + ANON, 'x-cron-secret': JOBSEC }, owner: { Authorization: 'Bearer ' + SVC } }

/* ── 1 · every job: the lock ── */
const J1 = ['lead-nurture', 'lead-followup', 'ghe-reminders', 'carematch-watch', 'interview-messages', 'coverage-run', 'timekeeper-watch',
            'lead-digest', 'automation-watchdog', 'purge-recordings', 'lead-docs-retention']
for (const fn of J1) {
  reset(); const h = await load(fn); const u = `https://x/functions/v1/${fn}${fn === 'coverage-run' ? '?commit=1&' : '?'}auth_check=1`
  const out = {}; for (const k of Object.keys(H)) out[k] = await call(h, u, H[k])
  ck(`J1 · ${fn}: no key, the public key, a wrong schedule secret and a forged server token are all refused`,
     ['none', 'anon', 'wrong', 'forged'].every((k) => out[k].s === 401 && out[k].j?.error === 'not allowed'), out)
  ck(`J1 · ${fn}: a staff sign-in and a sign-in with no role cannot start the scheduled run`, out.staff.s === 401 && out.norole.s === 401, [out.staff, out.norole])
  ck(`J1 · ${fn}: its schedule's secret is accepted as the schedule`, out.cron.s === 200 && out.cron.j?.caller === 'cron', out.cron)
  ck(`J1 · ${fn}: the owner's server key is accepted`, out.owner.s === 200 && out.owner.j?.caller === 'owner', out.owner)
  ck(`J1 · ${fn}: nothing sent while checking`, SENT.length === 0, SENT)
  /* a refused call must not read anything either: the database is never touched before the lock */
  let touched = 0; const realFrom = globalThis.__db.from; globalThis.__db.from = (t) => { touched++; return realFrom(t) }
  const r2 = await call(h, `https://x/functions/v1/${fn}?dry=1&force=0`, H.anon, {})
  globalThis.__db.from = realFrom
  ck(`J1 · ${fn}: a refused call reads nothing (not even the settings)`, r2.s === 401 && touched === 0, { r2, touched })
}

/* ── 2 · lead-docs-retention ran for a bare web request with no key ── */
reset(); { const h = await load('lead-docs-retention'); const g = await call(h, 'https://x/functions/v1/lead-docs-retention', {}, {}, 'GET')
  ck('J1 · lead-docs-retention: a bare GET with no key is refused (it used to delete due files)', g.s === 401, g) }

/* ── 3 · the practice-run hours gap (_shared/outreach.ts) ── */
reset(); CLOCK.hour = '02'; CLOCK.wd = 'Sun'
{ const h = await load('lead-nurture')
  const a = await call(h, 'https://x/functions/v1/lead-nurture?dry=1', H.cron)
  const b = await call(h, 'https://x/functions/v1/lead-nurture', H.cron)
  ck('J1 · lead-nurture: "dry=1" at 2am Sunday no longer skips the hours (it never did a practice run, so it sent for real)', a.s === 200 && /outside outreach hours/.test(a.j?.skipped || ''), a)
  ck('J1 · lead-nurture: the schedule at 2am Sunday is held by the hours as before', b.s === 200 && /outside outreach hours/.test(b.j?.skipped || ''), b)
  ck('J1 · lead-nurture: nothing sent at night', SENT.length === 0, SENT) }
{ const h = await load('ghe-reminders')
  const a = await call(h, 'https://x/functions/v1/ghe-reminders?dry=1&force=1', H.owner)
  const b = await call(h, 'https://x/functions/v1/ghe-reminders?force=1', H.owner)
  ck('J1 · ghe-reminders: its real practice run (dry=1) may still look at any hour', a.s === 200 && !/outside outreach hours/.test(JSON.stringify(a.j)), a)
  ck('J1 · ghe-reminders: a real run at 2am is held by the hours', b.s === 200 && /outside outreach hours/.test(b.j?.skipped || ''), b)
  ck('J1 · ghe-reminders: the practice run sent nothing', SENT.length === 0, SENT) }
CLOCK.hour = '10'; CLOCK.wd = 'Tue'
{ const src = fs.readFileSync(`${FN}/_shared/outreach.ts`, 'utf8')
  ck('J1 · outreach.ts: only a sender that says practiceRun skips the hours on dry=1', /if \(dry && opts\.practiceRun === true\) return null/.test(src) && !/if \(dry\) return null/.test(src))
  const users = fs.readdirSync(FN).filter((d) => fs.existsSync(`${FN}/${d}/index.ts`) && /outreachGate\(req/.test(fs.readFileSync(`${FN}/${d}/index.ts`, 'utf8')))
  const practice = users.filter((d) => /outreachGate\([^)]*practiceRun: true/.test(fs.readFileSync(`${FN}/${d}/index.ts`, 'utf8')))
  ck('J1 · outreach.ts: ghe-reminders is the only sender that claims a practice run (reference-chase keeps its hours for dry runs on its next deploy)', practice.join() === 'ghe-reminders', { users, practice }) }

/* ── 4 · the morning brief ── */
reset()
{ const h = await load('lead-digest')
  let r = await call(h, 'https://x/functions/v1/lead-digest?force=1', H.anon)
  ck('J1 · lead-digest: a forced brief with the public key is refused', r.s === 401, r)
  r = await call(h, 'https://x/functions/v1/lead-digest?force=1&to=owner%40mo-care.com', H.norole)
  ck('J1 · lead-digest: a test brief from a sign-in with no office role is refused', r.s === 403, r)
  r = await call(h, 'https://x/functions/v1/lead-digest?to=someone%40else.com', H.staff)
  ck('J1 · lead-digest: a staff test brief can only go to their own email (unchanged)', r.s === 403, r)
  CLOCK.sv = '2026-10-03 07:30:00'
  r = await call(h, 'https://x/functions/v1/lead-digest', H.cron)
  ck('J1 · lead-digest: the schedule on a Saturday sends nothing (weekdays only)', r.s === 200 && /weekend/.test(r.j?.status || '') && SENT.length === 0, r)
  CLOCK.sv = '2026-10-05 07:30:00'; APP.morning_brief_state = [{ id: 'sent_2026-10-05' }]
  r = await call(h, 'https://x/functions/v1/lead-digest', H.cron)
  ck('J1 · lead-digest: on a Monday the schedule goes on as before (here: already sent today)', r.s === 200 && r.j?.status === 'already sent today', r)
  CLOCK.sv = '2026-10-06 07:30:00'
  const src = fs.readFileSync(`${FN}/lead-digest/index.ts`, 'utf8')
  ck('J1 · lead-digest: the scheduled reply drops staff emails; a staff test keeps its own', /const briefs = testTo \? summaries : summaries\.map\(\(\{ to: _to, \.\.\.rest \}/.test(src) && /briefs \}\)$/m.test(src)) }

/* ── 5 · the coverage picker ── */
reset()
{ const h = await load('coverage-run'); const u = 'https://x/functions/v1/coverage-run'
  APP.coverage_cases = [{ id: 'cc-open', status: 'open', client: 'Test Client', asked: [] }, { id: 'cc-done', status: 'resolved', client: 'Test Client', asked: [] }]
  APP.ops_settings = { coverage_send_live: true }
  const pick = (hd, id, action = 'send_selected') => call(h, u, hd, { action, case_id: id, recipients: ['Someone'] })
  let r = await pick(H.anon, 'cc-open'); ck('J1 · coverage picker: the public key is refused', r.s === 401, r)
  r = await pick(H.forged, 'cc-open'); ck('J1 · coverage picker: a forged token is refused', r.s === 401, r)
  r = await pick(H.norole, 'cc-open'); ck('J1 · coverage picker: a signed-in account that is not office staff is refused (it used to be enough)', r.s === 403, r)
  r = await pick(H.norole, 'cc-open', 'candidates'); ck('J1 · coverage picker: the list itself also needs office staff', r.s === 403, r)
  r = await pick(H.staff, 'cc-done'); ck('J1 · coverage picker: office staff cannot ask from a case that is no longer open', r.s === 409 && /no longer open/.test(r.j?.error || ''), r)
  r = await pick(H.staff, 'cc-done', 'candidates'); ck('J1 · coverage picker: nor build a list for one', r.s === 409, r)
  r = await pick(H.staff, 'nope'); ck('J1 · coverage picker: an unknown case is still "no such case"', r.s === 404, r)
  r = await pick(H.staff, 'cc-open'); ck('J1 · coverage picker: office staff on an open case get through the lock (the send itself decides eligibility as before)', ![401, 403, 409].includes(r.s), r)
  r = await pick(H.owner, 'cc-open', 'candidates'); ck('J1 · coverage picker: the owner\'s server key gets through', ![401, 403, 409].includes(r.s), r)
  r = await call(h, u + '?commit=1', H.anon, {}); ck('J1 · coverage run: the plain run with the public key is refused', r.s === 401, r)
  ck('J1 · coverage run: nothing sent by any of this', SENT.length === 0, SENT) }

/* ── 6 · the clock-in watcher no longer reads "who" from the token itself ── */
{ const src = fs.readFileSync(`${FN}/timekeeper-watch/index.ts`, 'utf8')
  ck('J1 · timekeeper-watch: full would-text lists only for the owner\'s key; the token is no longer decoded', /const role = caller === 'owner' \? 'service_role' : 'schedule'/.test(src) && !/function callerRole/.test(src) && !/atob\(/.test(src)) }
{ const src = fs.readFileSync(`${FN}/coverage-run/index.ts`, 'utf8')
  ck('J1 · coverage-run: the picker no longer decodes the token to decide who is signed in', !/atob\(tok/.test(src) && /requireStaff\(sb, req, OFFICE_ROLES\)/.test(src)) }

/* ── 7 · every J1 job imports the shared lock and checks it before anything else ── */
for (const fn of J1) {
  const src = fs.readFileSync(`${FN}/${fn}/index.ts`, 'utf8'); const serve = src.slice(src.indexOf('Deno.serve('))
  const lock = serve.search(/jobCaller\(req\)/), firstRead = serve.search(/\.from\(|\.rpc\(|fetch\(|outreachGate\(/)
  ck(`J1 · ${fn}: the lock comes before the first read, send or hours check`, lock > 0 && (firstRead < 0 || lock < firstRead || fn === 'coverage-run' || fn === 'lead-digest'), { lock, firstRead })
}

for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
