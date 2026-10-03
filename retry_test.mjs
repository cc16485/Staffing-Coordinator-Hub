// RETRY (2026-10-01, Samantha "yes make them retry"): four senders no longer mark a failed send done. node retry_test.mjs
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
  if (url.includes('/conversations/messages')) { if (globalThis.__ghlDown) return new Response('{"message":"down"}', { status: 503 }); SENT.push({ to: body.contactId, type: body.type }); return new Response('{}', { status: 200 }) }
  if (url.includes('api.resend.com')) { RESEND.push(body.to?.[0]); return new Response('{"id":"x"}', { status: 200 }) }
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HT_ORDER_TOKEN: 'H', HT_SUPPORT_TOKEN: 'H', RESEND_API_KEY: 'r', RELAY_SECRET: 's'.repeat(40) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); } return handler; };
const post = async (h, url, body, headers = {}) => { const r = await h(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) })); let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }

const read = (f) => fs.readFileSync(`${FN}/${f}/index.ts`, 'utf8')
/* ── the Corner reply email: really run ── */
let cc = await load('cc-corner'); let r
const post1 = () => post(cc, 'https://x/functions/v1/cc-corner?token=H', { action: 'notify', post_id: 'p1', reply_id: 'r1' }, { Authorization: 'Bearer jwt-owner' })
const rep = () => APP.corner_posts[0].replies[0]
reset(); APP.corner_posts = [{ id: 'p1', email: CLEAN_E, name: 'Pat', status: 'approved', replies: [{ id: 'r1', status: 'approved', body: 'hi' }] }]
globalThis.__ghlDown = true; r = await post1()
ck('Corner · GoHighLevel refuses: NOT marked notified, a try is counted, and the Hub is told it will retry', !rep().notified && rep().notify_tries === 1 && rep().notify_failed_at && r.j?.will_retry === true, [r, rep()])
globalThis.__ghlDown = false; r = await post1()
ck('Corner · the next try goes through: marked notified, sent once', rep().notified === true && !rep().notify_failed_at && SENT.length === 1 && r.j?.notified === true, [r, rep(), SENT])
r = await post1(); ck('Corner · once notified it is never sent again', SENT.length === 1, SENT)
reset(); APP.corner_posts = [{ id: 'p1', email: CLEAN_E, status: 'approved', replies: [{ id: 'r1', status: 'approved', body: 'hi', notify_tries: 3, notify_failed_at: 'x' }] }]
r = await post1(); ck('Corner · after 3 failed tries it stops (the card stays)', SENT.length === 0 && !rep().notified, [r, rep()])
reset(); APP.corner_posts = [{ id: 'p1', email: OPT_E, status: 'approved', replies: [{ id: 'r1', status: 'approved', body: 'hi' }] }]
r = await post1(); ck('Corner · an opted-out poster: final (marked, never retried)', rep().notified === true && SENT.length === 0 && r.j?.will_retry === false, [r, rep()])
globalThis.__ghlDown = false

/* ── the three scheduled ones: the stamp now depends on someone being reached ── */
const tk = read('timekeeper-watch'), cr = read('coverage-run'), lf = read('lead-followup')
/* 429 (2026-10-03): the morning EVV chase is retired (it reached caregivers after they had left the client). Its
   replacement, the next-visit signature text, keeps the same rule: a failed text is not stamped as sent and is tried
   again (at most 3 tries, then a Needs Attention item); an opt-out refusal is final and not retried. */
ck('EVV next-visit text (replaces the morning chase) · a failed text is not stamped: tried again, at most 3 tries, then an item; an opt-out refusal is final',
  !/EVV correction form and have the client sign it/.test(tk) && /next_visit_tries/.test(tk) && /tries >= MAX_TRIES/.test(tk)
  && /if \(ok\) \{[\s\S]{0,400}next_visit_texted_at: nowIso/.test(tk) && /if \(!contact\) \{[\s\S]{0,200}next_visit_refused_at/.test(tk))
ck('call-in alert · stamped only when an admin was reached (email or text); else retried, 3 tries, 10+ min apart',
  /if \(reachedA > 0\) freshA\.admin_alerted = nowIso\(\)/.test(cr) && /admin_alert_tries\) \|\| 0\) < 3/.test(cr) && /if \(wentA\) \{ alerted\+\+; reachedA\+\+ \}/.test(cr) && /\)\) reachedA\+\+/.test(cr) && /!c\.admin_alerted && alertRetryOk/.test(cr))
ck('overdue-lead alert · stamped only when someone was reached; else retried, 3 tries, 10+ min apart',
  /if \(reached\) \{ l\.overdue_alerted_at = new Date\(\)\.toISOString\(\); out\.office_alerted\+\+ \}/.test(lf) && /overdue_alert_tries\) \|\| 0\) < 3/.test(lf) && /!l\.overdue_alerted_at && overdueRetryOk/.test(lf))
let all = true; console.log('\nRETRY · TEST\n' + '='.repeat(50)); for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
