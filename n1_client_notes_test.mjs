// Step 0 · 0b-3 · caregiver, applicant and HomeTogether senders go through the universal opt-out check.
// Real functions against a fake database and fake GoHighLevel/Resend where they can run outside production; the new
// saved-contact door tested directly; and a source scan of the heavy scheduled senders so no send can skip the door.
// node optout_0b3_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions';
const realTLS = Date.prototype.toLocaleString;
Date.prototype.toLocaleString = function (loc, o) {
  if (o && o.hour === '2-digit' && !o.minute) return '10'; if (o && o.weekday === 'short' && !o.hour) return 'Tue'; return realTLS.call(this, loc, o); };
const CLEAN_P = '4175550101', OPT_P = '4175550202', DND_P = '4175550303'
const CLEAN_E = 'clean@example.test', OPT_E = 'optout@example.test'
const E164 = (p) => '+1' + p
let T, APP, SENT, RESEND, REFUSED, DND
const reset = () => {
  APP = {}; SENT = []; RESEND = []; REFUSED = []; DND = new Set([E164(DND_P)])
  T = { contact_optout_current: [{ address: E164(OPT_P), channel: 'sms', opted_out: true, source: 'stop_text' }, { address: OPT_E, channel: 'email', opted_out: true, source: 'staff' }],
    circle_contacts: [], phone_index: [], interview_bookings: [], scheduling_settings: [{ id: 1, phone: '(417) 234-8494' }],
    job_applicants: [],
    auth_identities: [{ auth_user_id: 'u-owner', person_id: 'p-owner', project_ref: 'zngsgedlsxinbygwmxwn' }],
    persons: [{ person_id: 'p-owner', active: true, full_name: 'Olive Owner' }],
    entity_memberships: [{ person_id: 'p-owner', entity: 'cc_ihs', active: true, ended_at: null }],
    staff_roles: [{ person_id: 'p-owner', entity: 'cc_ihs', role: 'owner_admin' }] }
}
const q = (t) => { const st = { f: [], nn: null, inF: null }; const b = {
  select() { return b; }, order() { return b; }, limit() { return b; }, contains() { return b; }, range() { return b; }, or() { return b; }, is() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; }, in(c, v) { st.inF = [c, v]; return b; }, not(c) { st.nn = c; return b; },
  update() { return { eq: () => Promise.resolve({ data: null, error: null }) }; },
  insert(row) { (T[t] ||= []).push(row); return Promise.resolve({ data: row, error: null }); },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })); },
  single() { return b.maybeSingle(); },
  then(ok) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok); }
    let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v)
    if (st.inF) rows = rows.filter((r) => st.inF[1].includes(r[st.inF[0]])); if (st.nn && t !== 'job_applicants') rows = rows.filter((r) => r[st.nn] != null)
    return Promise.resolve({ data: rows, error: null }).then(ok);
  } }; return b; };
globalThis.__db = { from: q,
  rpc: async (fn, a) => { if (fn === 'contact_send_refusal_log') REFUSED.push({ sender: a.p_sender, reasons: a.p_reasons }); if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) } return { data: null, error: null } },
  auth: { getUser: async (jwt) => jwt === 'jwt-owner' ? { data: { user: { id: 'u-owner', email: 'owner@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } };
const STORED = { 'cg-clean': { id: 'cg-clean', phone: E164(CLEAN_P), dnd: false }, 'cg-opt': { id: 'cg-opt', phone: E164(OPT_P), dnd: false },
                 'cg-dnd': { id: 'cg-dnd', phone: E164(DND_P), dnd: true }, 'cg-nophone': { id: 'cg-nophone', dnd: false } }
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) { const key = body.phone || body.email; return new Response(JSON.stringify({ contact: { id: 'C:' + key, dnd: DND.has(key) } }), { status: 200 }) }
  const gm = url.match(/\/contacts\/([^/?]+)$/)
  if (gm && (!o || !o.method || o.method === 'GET')) { const c = STORED[decodeURIComponent(gm[1])]; return new Response(JSON.stringify(c ? { contact: c } : {}), { status: c ? 200 : 404 }) }
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, type: body.type }); return new Response('{}', { status: 200 }) }
  if (url.includes('api.resend.com')) { RESEND.push(body.to?.[0]); return new Response('{"id":"x"}', { status: 200 }) }
  return new Response('{}', { status: 200 })
}
const SVC = 'svc_' + 'k'.repeat(60), JOBSEC = 'j'.repeat(64)
const ENV = { HUB_JOB_SECRET: JOBSEC, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HT_ORDER_TOKEN: 'H', HT_SUPPORT_TOKEN: 'H', RESEND_API_KEY: 'r', RELAY_SECRET: 's'.repeat(40) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
globalThis.__dbFor = (key) => ({ from: (t) => { const b = { select() { return b; }, limit() { return Promise.resolve(t === 'identity_door_audit' && key !== SVC ? { data: null, error: { message: 'permission denied' } } : { data: [], error: null }); } }; return b; } })
{ const ja = fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)')
  fs.writeFileSync(`${FN}/_shared/_job-auth_t.ts`, ja) }
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_t.ts`) } catch { /* */ } })
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'../_shared/job-auth.ts'", "'../_shared/_job-auth_t.ts'");
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); } return handler; };
const post = async (h, url, body, headers = {}) => { const r = await h(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) })); let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
const to = (x) => SENT.filter((m) => m.to === 'C:' + x || m.to === x).length



/* ── N1: one client's shift notes, for signed-in office staff; read live, nothing stored or sent ── */
const past = (h) => new Date(Date.now() - h * 3600e3).toISOString()
const VV = {
  'a': { id: 'a', client: { id: 501 }, caregiver: { id: 9, firstName: 'Cara', lastName: 'Giver' }, startDate: past(3), endDate: past(1), careNote: 'Ruth had a small fall in the bathroom, helped up, says she is fine.', adls: [{ name: 'Bathing', status: 0, completed: false, note: 'Refused shower' }, { name: 'Meals', status: 1, completed: true, note: 'Ate half' }, { name: 'Laundry', status: 1, completed: true, note: '' }] },
  'b': { id: 'b', client: { id: 501 }, caregiver: { id: 9, firstName: 'Cara', lastName: 'Giver' }, startDate: past(6), endDate: past(4), careNote: 'Ruth had a small fall in the bathroom, helped up, says she is fine.', adls: [] },
  'c': { id: 'c', client: { id: 501 }, caregiver: { id: 8, firstName: 'Ben', lastName: 'Helper' }, startDate: past(50), endDate: past(48), careNote: null, adls: [{ name: 'Meals', status: 1, completed: true, note: '' }] },
  'f': { id: 'f', client: { id: 501 }, caregiver: { id: 8, firstName: 'Ben', lastName: 'Helper' }, startDate: new Date(Date.now() + 5 * 3600e3).toISOString(), careNote: null, adls: [] },
  'x': { id: 'x', client: { id: 777 }, caregiver: { id: 1 }, startDate: past(2), careNote: 'someone else', adls: [] } }
const AXCALLS = []
const f0 = globalThis.fetch
globalThis.fetch = async (url, o) => { url = String(url)
  if (url.includes('axiscare.com')) { AXCALLS.push([url, (o && o.method) || 'GET'])
    if (url.includes('/api/visits?')) { const cid = (url.match(/clientIds=(\d+)/) || [])[1]; return new Response(JSON.stringify({ results: { visits: Object.values(VV).filter((v) => String(v.client.id) === cid).map(({ careNote, adls, ...r }) => r) } }), { status: 200 }) }
    const m = url.match(/\/api\/visits\/([^/?]+)$/); if (m && VV[m[1]]) return new Response(JSON.stringify({ results: VV[m[1]] }), { status: 200 })
    return new Response('{}', { status: 404 }) }
  return f0(url, o) }
ENV.AXISCARE_TOKEN = 'axc_x'; ENV.AXISCARE_SITE = '16485'
let cn = await load('care-notes')
const ask = (b, auth) => post(cn, 'https://x/functions/v1/care-notes', b, auth ? { Authorization: 'Bearer ' + auth } : {})
reset(); let r = await ask({ axiscare_client_id: '501' })
ck('N1 · no sign-in: refused, AxisCare never asked', r.status === 401 && AXCALLS.length === 0, r)
r = await ask({ axiscare_client_id: '501' }, 'jwt-nobody'); ck('N1 · a sign-in that is not office staff: refused', (r.status === 401 || r.status === 403) && AXCALLS.length === 0, r)
r = await ask({ axiscare_client_id: '501; drop' }, 'jwt-owner'); ck('N1 · a client number that isn\'t a number: refused', r.status === 400, r)
r = await ask({ axiscare_client_id: '501' }, 'jwt-owner'); const sh = r.j && r.j.shifts
ck('N1 · office staff: the client\'s started shifts, newest first (not the future one, not another client\'s)', r.status === 200 && sh.length === 3 && sh.map((x) => x.visit_id).join() === 'a,b,c', r.j)
ck('N1 · the care note shows once per caregiver per day (the second visit that day says so instead)', /small fall/.test(sh[0].care_note) && sh[1].care_note === '' && sh[1].same_note_as_earlier_visit === true, sh)
ck('N1 · tasks not done, with the caregiver\'s note; other task notes kept separately; tasks with nothing to say left out', sh[0].tasks_not_done.length === 1 && sh[0].tasks_not_done[0].note === 'Refused shower' && sh[0].task_notes.length === 1 && sh[0].task_notes[0].name === 'Meals' && sh[0].tasks_total === 3, sh[0])
ck('N1 · the caregiver\'s name comes with each shift', sh[0].caregiver === 'Cara Giver' && sh[2].caregiver === 'Ben Helper')
ck('N1 · only reads: every AxisCare call is a GET', AXCALLS.every(([u, m]) => m === 'GET'), AXCALLS)
ck('N1 · nothing stored or sent', SENT.length === 0 && !Object.keys(APP).length, [SENT, APP])
for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
