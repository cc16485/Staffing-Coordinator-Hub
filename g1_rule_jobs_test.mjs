// G1 · the obligations runner and the eligibility sweep (both download and run a rules file from cc.mo-care.com, neither
// has a schedule) answer only the owner's server key, checked before anything is read, fetched or run.
// Real functions against a fake database and a counted fetch; nothing real is reached. node g1_rule_jobs_test.mjs
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

let FETCHES = 0; const realFetch = globalThis.fetch; globalThis.fetch = async (u, o) => { FETCHES++; return realFetch(u, o) }
ENV.ELIGIBILITY_SWEEP_TOKEN = 'old-gate-' + 'g'.repeat(40)
const G1 = ['obligations-run', 'eligibility-sweep']
for (const fn of G1) {
  reset(); const h = await load(fn); const u = `https://x/functions/v1/${fn}?auth_check=1`
  const out = {}; for (const k of Object.keys(H)) out[k] = await call(h, u, H[k], {})
  ck(`G1 · ${fn}: no key, the public key, a wrong secret and a forged server token are all refused`,
     ['none', 'anon', 'wrong', 'forged'].every((k) => out[k].s === 401 && out[k].j?.error === 'not allowed'), out)
  ck(`G1 · ${fn}: the schedules' own secret is refused too (it has no schedule)`, out.cron.s === 401, out.cron)
  ck(`G1 · ${fn}: a staff sign-in cannot start it`, out.staff.s === 401 && out.norole.s === 401, [out.staff, out.norole])
  ck(`G1 · ${fn}: the owner's server key is accepted`, out.owner.s === 200 && out.owner.j?.caller === 'owner', out.owner)
  let touched = 0; const realFrom = globalThis.__db.from; globalThis.__db.from = (t) => { touched++; return realFrom(t) }; FETCHES = 0
  const r2 = await call(h, `https://x/functions/v1/${fn}?max=9999&days=99999`, H.anon, { token: ENV.ELIGIBILITY_SWEEP_TOKEN, live: true })
  globalThis.__db.from = realFrom
  ck(`G1 · ${fn}: a refused call reads nothing and downloads nothing (no rules file is fetched or run)`, r2.s === 401 && touched === 0 && FETCHES === 0, { r2, touched, FETCHES })
}
{ reset(); const h = await load('eligibility-sweep')
  const r = await call(h, 'https://x/functions/v1/eligibility-sweep', {}, { token: ENV.ELIGIBILITY_SWEEP_TOKEN })
  ck('G1 · eligibility-sweep: the old body password alone no longer gets in (your server key does)', r.s === 401, r)
  const src = fs.readFileSync(`${FN}/eligibility-sweep/index.ts`, 'utf8')
  ck('G1 · eligibility-sweep: the lock is checked before the rules file is fetched', src.indexOf('jobCaller(req, false)') < src.indexOf('fetch(RULES_URL') && !/body\.token !== gate/.test(src)) }
{ const src = fs.readFileSync(`${FN}/obligations-run/index.ts`, 'utf8')
  ck('G1 · obligations-run: the lock is checked before ?max/?days are read and before the rules are fetched', src.indexOf('jobCaller(req, false)') < src.indexOf("searchParams.get('max')") && src.indexOf('jobCaller(req, false)') < src.indexOf('fetch(OBLIG_URL')) }

for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
