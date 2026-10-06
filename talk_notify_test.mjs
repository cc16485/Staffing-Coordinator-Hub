// To talk about: tags, a thread, an email (Desktop 473). The real talk-notify function against a fake database and a
// fake GoHighLevel (harness from n2_flag_test.mjs). node talk_notify_test.mjs
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




const now = Date.now(), ago = (m) => new Date(now - m * 60e3).toISOString()
const staffSetup = () => {
  T.persons.push({ person_id: 'p-kry', active: true, full_name: 'Krystal Land', primary_email: 'krystal@mo-care.com' }, { person_id: 'p-zach', active: true, full_name: 'Zach Troutman', primary_email: 'zach@mo-care.com' },
    { person_id: 'p-ang', active: true, full_name: 'Angiel Falig', primary_email: 'angiel@mo-care.com' }, { person_id: 'p-gone', active: false, full_name: 'Gone Person', primary_email: 'gone@mo-care.com' })
  T.persons.find((p) => p.person_id === 'p-owner').primary_email = 'owner@mo-care.com'
  T.staff_roles.push({ person_id: 'p-kry', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p-zach', entity: 'cc_ihs', role: 'owner_admin' }, { person_id: 'p-gone', entity: 'cc_ihs', role: 'care_coordinator' })
}
const ITEM = () => ({ id: 'su_1', summary: 'Uncovered shift: Pat', source: 'work', ops_id: 'ops_pat', assigned_to_email: 'owner@mo-care.com', status: 'open', tagged: ['krystal@mo-care.com', 'angiel@mo-care.com', 'gone@mo-care.com'],
  updates: [{ id: 'u1', at: ago(5), by: 'Olive Owner', by_email: 'owner@mo-care.com', text: "Pat's family called: someone they know wants to apply. @Krystal can you send her the application?", tags: ['krystal@mo-care.com'] }] })
let tn
const call = (body, headers) => post(tn, 'https://x/functions/v1/talk-notify', body, headers)
const STAFF = { Authorization: 'Bearer jwt-owner' }, CRON = { Authorization: 'Bearer ' + 'eyJ' + 'a'.repeat(120), 'x-cron-secret': JOBSEC }
ENV.GHL_TOKEN = 'g'; ENV.GHL_LOCATION_ID = 'loc'
tn = await load('talk-notify')
const emails = () => SENT.filter((m) => m.type === 'Email')

reset(); staffSetup(); APP.standup_notes = [ITEM()]; APP.ops_items = [{ id: 'ops_pat', title: 'Uncovered shift: Pat', about: 'Pat', detail: 'New Client! Respite care in Mount Vernon. Flexible times, two days per week.', owner_name: 'Olive Owner' }]
APP.ops_settings = {}
let r = await call({ item_id: 'su_1' }, {})
ck('no sign-in: refused', r.status === 401)
r = await call({ item_id: 'su_1' }, STAFF)
ck('switch off: sends nothing, only says who WOULD get it (office staff only)', r.j.live === false && JSON.stringify(r.j.would_email) === '["Krystal"]' && !emails().length && r.j.not_staff.includes('angiel') && r.j.not_staff.includes('gone'), r.j)

APP.ops_settings = { talk_email_live: true }
r = await call({ item_id: 'su_1' }, STAFF)
ck('switch on: Krystal (tagged) gets one email; the writer does not; someone with no office role or an inactive record never does', r.j.live && JSON.stringify(r.j.emailed) === '["Krystal"]' && emails().length === 1, [r.j, SENT])
r = await call({ item_id: 'su_1', to: 'someone@evil.example', text: 'pay me' }, STAFF)
ck('...addresses or words in the request are ignored (it only ever reads the saved item)', !SENT.some((m) => /evil/.test(JSON.stringify(m))))
ck('...a second note within 10 minutes: not emailed again now, marked to get the latest', r.j.later.includes('Krystal') && emails().length === 1 && (APP.talk_notify_state || [])[0].pending['krystal@mo-care.com'], [r.j, APP.talk_notify_state])
r = await post(tn, 'https://x/functions/v1/talk-notify?flush=1', {}, CRON)
ck('the 5-minute pass: still inside 10 minutes, so nothing yet', r.j.emailed === 0 && emails().length === 1, r.j)
APP.talk_notify_state[0].sent['krystal@mo-care.com'] = ago(11)
r = await post(tn, 'https://x/functions/v1/talk-notify?flush=1', {}, CRON)
ck('...after 10 minutes the 5-minute pass sends Krystal the latest, once', r.j.emailed === 1 && emails().length === 2 && !APP.talk_notify_state[0].pending['krystal@mo-care.com'], [r.j, APP.talk_notify_state])
r = await post(tn, 'https://x/functions/v1/talk-notify?flush=1', {}, { Authorization: 'Bearer jwt-owner' })
ck('...the 5-minute pass answers only its schedule or the owner\'s key, not a staff sign-in', r.status === 401)
// a reply from Krystal: the owner (wrote it, it sits with them) gets it, Krystal does not
APP.standup_notes[0].updates.push({ id: 'u2', at: ago(0), by: 'Krystal Land', by_email: 'krystal@mo-care.com', text: "Sent it. She's booked Thursday at 2." })
T.auth_identities.push({ auth_user_id: 'u-kry', person_id: 'p-kry', project_ref: 'zngsgedlsxinbygwmxwn' }); T.entity_memberships.push({ person_id: 'p-kry', entity: 'cc_ihs', active: true, ended_at: null })
const ga = globalThis.__db.auth.getUser; globalThis.__db.auth.getUser = async (jwt) => jwt === 'jwt-kry' ? { data: { user: { id: 'u-kry', email: 'krystal@mo-care.com', app_metadata: {} } }, error: null } : ga(jwt)
SENT.length = 0
r = await call({ item_id: 'su_1' }, { Authorization: 'Bearer jwt-kry' })
ck('a reply: everyone on the thread but the writer gets it (here the person who wrote first)', JSON.stringify(r.j.emailed) === '["Olive"]' && emails().length === 1, r.j)
// the email itself
{ const src = fs.readFileSync(`${FN}/talk-notify/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'../_shared/job-auth.ts'", "'../_shared/_job-auth_t.ts'")
  const tmp = path.join(process.cwd(), FN, 'talk-notify', '_e.ts'); fs.writeFileSync(tmp, src); let E; try { E = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
  const staff = new Map([['krystal@mo-care.com', 'Krystal Land'], ['owner@mo-care.com', 'Olive Owner']])
  const it = ITEM(); const e = E.emailFor(it, APP.ops_items[0], staff, 'krystal@mo-care.com')
  ck('the email: "Olive tagged you: Uncovered shift: Pat"', e.subject === 'Olive tagged you: Uncovered shift: Pat', e.subject)
  ck('...it has the card (client, details from My Work), the thread with the tag, and the Open it in the Hub button', /Mount Vernon/.test(e.html) && /Pat&#39;s family called/.test(e.html) && /@Krystal/.test(e.html) && /href="https:\/\/cc\.mo-care\.com\/#standup"/.test(e.html) && /Reply in the Hub/.test(e.html))
  ck('...typed HTML in a note stays text', !/<img/.test(E.emailFor(Object.assign(ITEM(), { updates: [{ by: 'X', text: '<img src=x onerror=alert(1)>' }] }), null, staff, 'krystal@mo-care.com').html))
  ck('...no em dashes in what it writes', !/—/.test(e.html + e.subject)) }

for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
process.exitCode = res.every((x) => x[1]) ? 0 : 1
