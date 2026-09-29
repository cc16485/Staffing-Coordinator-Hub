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
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HT_ORDER_TOKEN: 'H', HT_SUPPORT_TOKEN: 'H', RESEND_API_KEY: 'r', RELAY_SECRET: 's'.repeat(40) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); } return handler; };
const post = async (h, url, body, headers = {}) => { const r = await h(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) })); let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
const to = (x) => SENT.filter((m) => m.to === 'C:' + x || m.to === x).length


/* ── S5: staff actions need a sign-in; the caregiver's own pay-now still works; typing an email never shows the link ── */
const STRIPE = []
const f0 = globalThis.fetch
globalThis.fetch = async (url, o) => { if (String(url).includes('api.stripe.com')) { STRIPE.push(1); return new Response(JSON.stringify({ url: 'https://checkout.stripe.test/s1' }), { status: 200 }) } return f0(url, o) }
ENV.STRIPE_SECRET_KEY = 'sk'
const cg = (id, extra) => ({ id, name: 'Casey Care', email: CLEAN_E, status: 'applied', ...extra })
let hl = await load('ht-local')
const pl = (b, auth) => post(hl, 'https://x/functions/v1/ht-local?token=H', { kind: 'paylink', ...b }, auth ? { Authorization: 'Bearer ' + auth } : {})
const setCg = (arr) => { APP.local_caregivers = arr }
reset(); setCg([cg('c1')]); let r = await pl({ caregiver_id: 'c1' })
ck('S5 · emailing a pay link with only the page token: refused, nothing created or sent', r.status === 401 && STRIPE.length === 0 && SENT.length === 0 && APP.local_caregivers[0].status === 'applied', r)
reset(); setCg([cg('c1')]); STRIPE.length = 0; r = await pl({ caregiver_id: 'c1', direct: true, family_interested: true })
ck('S5 · the "a family wants you" wording with only the page token: refused', r.status === 401 && STRIPE.length === 0 && SENT.length === 0, r)
reset(); setCg([cg('c1')]); STRIPE.length = 0; r = await pl({ caregiver_id: 'c1', family_interested: true }, 'jwt-owner')
ck('S5 · signed-in office staff: the link is created and emailed, status moves from applied', r.status === 200 && STRIPE.length === 1 && SENT.filter((m) => m.type === 'Email').length === 1 && APP.local_caregivers[0].status === 'background check', [r, SENT])
reset(); setCg([cg('c1')]); STRIPE.length = 0; r = await pl({ caregiver_id: 'c1', direct: true })
ck('S5 · the caregiver\'s own "Pay now" (their id): checkout opens as before, no email', r.status === 200 && r.j.link && SENT.length === 0, r)
reset(); setCg([cg('c1', { status: 'declined' })]); STRIPE.length = 0; await pl({ caregiver_id: 'c1', direct: true })
ck('S5 · a status other than "applied" is left alone', APP.local_caregivers[0].status === 'declined')
reset(); setCg([cg('c1')]); STRIPE.length = 0; r = await pl({ email: CLEAN_E.toUpperCase(), direct: true })
ck('S5 · typing a known email: no link shown; the link is emailed to the address on file', r.status === 200 && r.j.emailed === true && !r.j.link && SENT.filter((m) => m.type === 'Email').length === 1, [r, SENT])
const again = await pl({ email: CLEAN_E, direct: true })
ck('S5 · typing it again within 15 minutes: same answer, nothing new sent', again.j.emailed === true && SENT.filter((m) => m.type === 'Email').length === 1 && STRIPE.length === 1)
reset(); setCg([cg('c1')]); STRIPE.length = 0; r = await pl({ email: 'nobody@example.test', direct: true })
ck('S5 · typing an unknown email: the same answer (it no longer tells anyone whether an address applied), nothing sent', r.status === 200 && r.j.emailed === true && SENT.length === 0 && STRIPE.length === 0, r)
reset(); setCg([cg('c1')]); r = await post(hl, 'https://x/functions/v1/ht-local?token=H', { kind: 'oig', caregiver_id: 'c1' })
ck('S5 · the background screen with only the page token: refused', r.status === 401, r)
r = await post(hl, 'https://x/functions/v1/ht-local?token=H', { kind: 'oig', caregiver_id: 'c1' }, { Authorization: 'Bearer jwt-owner' })
ck('S5 · the background screen for signed-in office staff: runs', r.status === 200, r)
let cc = await load('cc-corner')
reset(); APP.corner_posts = [{ id: 'p1', email: CLEAN_E, status: 'approved', replies: [{ id: 'r1', status: 'approved', body: 'hi', notified: false }] }]
r = await post(cc, 'https://x/functions/v1/cc-corner?token=H', { action: 'notify', post_id: 'p1', reply_id: 'r1' })
ck('S5 · Corner notify with only the page token: refused, nothing sent', r.status === 401 && SENT.length === 0, r)
r = await post(cc, 'https://x/functions/v1/cc-corner?token=H', { action: 'notify', post_id: 'p1', reply_id: 'r1' }, { Authorization: 'Bearer jwt-owner' })
ck('S5 · Corner notify for signed-in office staff: goes through', r.status === 200, r)
for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
