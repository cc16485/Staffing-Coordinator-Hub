// J2 · the 7 scheduled jobs that only update the Hub answer only their schedule (the S3 vault secret) or the owner's
// server key; their Hub buttons (client status answers, launch-evidence ticks) need verified active office staff.
// Real functions against a fake database; nothing real is reached. node j2_job_locks_test.mjs
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
const J2 = ['coverage-watch', 'client-status-observe', 'client-status-review', 'launch-evidence', 'client-start-run', 'promise-run', 'caregiver-census-observe']
const BODY = { 'client-status-review': { action: 'run' }, 'launch-evidence': { action: 'run' } }
for (const fn of J2) {
  reset(); const h = await load(fn); const u = `https://x/functions/v1/${fn}?auth_check=1`
  const out = {}; for (const k of Object.keys(H)) out[k] = await call(h, u, H[k], BODY[fn] ?? {})
  ck(`J2 · ${fn}: no key, the public key, a wrong schedule secret and a forged server token are all refused`,
     ['none', 'anon', 'wrong', 'forged'].every((k) => out[k].s === 401 && out[k].j?.error === 'not allowed'), out)
  ck(`J2 · ${fn}: a staff sign-in cannot start the scheduled run`, out.staff.s === 401 && out.norole.s === 401, [out.staff, out.norole])
  ck(`J2 · ${fn}: its schedule's secret is accepted as the schedule`, out.cron.s === 200 && out.cron.j?.caller === 'cron', out.cron)
  ck(`J2 · ${fn}: the owner's server key is accepted`, out.owner.s === 200 && out.owner.j?.caller === 'owner', out.owner)
  let touched = 0; const realFrom = globalThis.__db.from; globalThis.__db.from = (t) => { touched++; return realFrom(t) }
  const r2 = await call(h, `https://x/functions/v1/${fn}?max=9999&days=99999`, H.anon, BODY[fn] ?? {})
  globalThis.__db.from = realFrom
  ck(`J2 · ${fn}: a refused call reads and writes nothing`, r2.s === 401 && touched === 0, { r2, touched })
}

/* ── 2 · the census: its schedule used to be turned away (it demanded a server-role token) ── */
{ const src = fs.readFileSync(`${FN}/caregiver-census-observe/index.ts`, 'utf8')
  ck('J2 · caregiver-census-observe: no longer demands a server-role token (its schedule never had one)', !/service role required/.test(src) && !/function callerRole/.test(src)) }

/* ── 3 · client status answers: verified office staff + the Journey seat ── */
const SEAT_USERS = { 'jwt-angie': { id: 'u-angie', email: 'seat.norole@mo-care.com', app_metadata: {} } }
Object.assign(USERS, SEAT_USERS)
const RID = '11111111-2222-3333-4444-555555555555'
reset()
T.journey_seat_member = [{ email: 'owner@mo-care.com', seat: 'client_intake' }, { email: 'owner@mo-care.com', seat: 'owner_decision' }, { email: 'seat.norole@mo-care.com', seat: 'client_intake' }]
T.auth_identities.push({ auth_user_id: 'u-angie', person_id: 'p-angie', project_ref: 'zngsgedlsxinbygwmxwn' })
T.persons.push({ person_id: 'p-angie', active: true, full_name: 'Seat Holder' }); T.entity_memberships.push({ person_id: 'p-angie', entity: 'cc_ihs', active: true, ended_at: null })
{ const h = await load('client-status-review'); const u = 'https://x/functions/v1/client-status-review'
  const dec = { action: 'decide', review_id: RID, decision: 'no_change', note: 'checked with the family' }
  const forgedSeat = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ role: 'authenticated', email: 'owner@mo-care.com' }) + '.' + 'x'.repeat(43)
  let r = await call(h, u, H.anon, dec); ck('J2 · client status answer: the public key is refused', r.s === 401, r)
  r = await call(h, u, { Authorization: 'Bearer ' + forgedSeat }, dec)
  ck('J2 · client status answer: a forged token claiming a seat holder\'s email is refused (it was trusted before)', r.s === 401, r)
  r = await call(h, u, { Authorization: 'Bearer jwt-angie' }, dec)
  ck('J2 · client status answer: a seat holder with no office role is refused (the approved office-staff rule)', r.s === 403, r)
  r = await call(h, u, H.norole, dec); ck('J2 · client status answer: office-role-less and seat-less: refused', r.s === 403, r)
  T.journey_seat_member = T.journey_seat_member.filter((x) => x.email !== 'owner@mo-care.com')
  r = await call(h, u, H.staff, dec); ck('J2 · client status answer: office staff without the needed seat still get "no seat" (unchanged)', r.s === 403 && r.j?.outcome === 'no_seat', r)
  T.journey_seat_member.push({ email: 'owner@mo-care.com', seat: 'client_intake' })
  r = await call(h, u, H.staff, dec); ck('J2 · client status answer: office staff holding the seat are recorded as before', r.s === 200, r)
  r = await call(h, u, H.staff, { action: 'run' }); ck('J2 · client status: a staff sign-in cannot start the scheduled run', r.s === 401, r) }

/* ── 4 · launch evidence: ticking a step by hand needs verified office staff ── */
reset()
{ const h = await load('launch-evidence'); const u = 'https://x/functions/v1/launch-evidence'
  const rec = { action: 'record', launch_id: RID, fact: 'schedule', reason: 'confirmed by phone' }
  let r = await call(h, u, H.anon, rec); ck('J2 · launch evidence (record): the public key is refused', r.s === 401, r)
  r = await call(h, u, H.forged, rec); ck('J2 · launch evidence (record): a forged token is refused', r.s === 401, r)
  r = await call(h, u, H.norole, rec); ck('J2 · launch evidence (record): a signed-in account that is not office staff is refused (it used to be enough)', r.s === 403, r)
  r = await call(h, u, H.norole, { action: 'refresh', launch_id: RID }); ck('J2 · launch evidence (refresh): not office staff, refused', r.s === 403, r)
  r = await call(h, u, H.staff, rec); ck('J2 · launch evidence (record): office staff get through (the rules file then decides, as before)', ![401, 403].includes(r.s), r)
  r = await call(h, u, H.owner, rec); ck('J2 · launch evidence (record): the server key is not a person, so it cannot tick a step by hand', r.s === 401, r) }

/* ── 5 · Client Start and Promise run: ?max / ?days / names only for the owner ── */
for (const fn of ['client-start-run', 'promise-run']) {
  const src = fs.readFileSync(`${FN}/${fn}/index.ts`, 'utf8')
  ck(`J2 · ${fn}: names in the reply only for the owner's key, not from the token's own claim`, /const full = caller === 'owner'/.test(src) && !/const full = jwtRole/.test(src))
  const serve = src.slice(src.indexOf('Deno.serve(')); ck(`J2 · ${fn}: the lock comes before ?max and ?days are read`, serve.search(/jobCaller\(req\)/) < serve.search(/searchParams\.get\('(max|days)'\)|positiveOr\(/))
}

/* ── 6 · every J2 job checks the lock before its first read ── */
for (const fn of J2) {
  const src = fs.readFileSync(`${FN}/${fn}/index.ts`, 'utf8'); const serve = src.slice(src.indexOf('Deno.serve('))
  const lock = Math.min(...[serve.search(/jobCaller\(req\)/), serve.search(/requireStaff\(sb, req/)].filter((x) => x > 0))
  const firstRead = serve.search(/\.from\(|\.rpc\(|fetch\(|axisCreds\(/)
  ck(`J2 · ${fn}: the lock comes before the first read or AxisCare call`, lock > 0 && (firstRead < 0 || lock < firstRead), { lock, firstRead })
}

for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
