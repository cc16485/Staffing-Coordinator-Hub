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


/* ── S4: HomeTogether Local sign-up confirmations: "Hi there", nothing typed in repeated, once a day per address,
       and no typed first name written onto a GoHighLevel contact ── */
const UPS = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, o) => { if (String(url).includes('/contacts/upsert')) UPS.push(JSON.parse(o.body)); return realFetch(url, o) }
const HTML = []
const f2 = globalThis.fetch
globalThis.fetch = async (url, o) => { if (String(url).includes('/conversations/messages')) { const b = JSON.parse(o.body); HTML.push({ to: b.contactId, html: b.html || '' }) } return f2(url, o) }
let hl = await load('ht-local')
const signup = (b) => post(hl, 'https://x/functions/v1/ht-local?token=H', b)
reset(); UPS.length = 0; HTML.length = 0
let r = await signup({ kind: 'family', name: 'Mallory Evil', email: CLEAN_E, zip: 'Click http://bad.example to claim your prize', phone: '' })
const toFam = HTML.filter((m) => m.to === 'C:' + CLEAN_E)
ck('S4 · family sign-up: one confirmation, greeting "Hi there", the typed name and zip not repeated', r.status === 200 && toFam.length === 1 && /Hi there,/.test(toFam[0].html) && !/Mallory/.test(toFam[0].html) && !/bad\.example/.test(toFam[0].html), toFam)
ck('S4 · no typed first name is written onto the GoHighLevel contact', !UPS.some((u) => u.email === CLEAN_E && 'firstName' in u), UPS)
r = await signup({ kind: 'family', name: 'Mallory Evil', email: CLEAN_E.toUpperCase(), zip: '65802' })
ck('S4 · the same address again within a day: stored, but no second email', r.status === 200 && HTML.filter((m) => m.to === 'C:' + CLEAN_E).length === 1 && (APP.local_families || []).length === 2, HTML)
reset(); UPS.length = 0; HTML.length = 0
r = await signup({ kind: 'caregiver', name: 'Trudy Typed', email: CLEAN_E, phone: '' })
const toCg = HTML.filter((m) => m.to === 'C:' + CLEAN_E)
ck('S4 · caregiver sign-up: one confirmation, "Hi there", the typed name not repeated', r.status === 200 && toCg.length === 1 && /Hi there,/.test(toCg[0].html) && !/Trudy/.test(toCg[0].html), toCg)
await signup({ kind: 'caregiver', name: 'Trudy Typed', email: CLEAN_E })
ck('S4 · caregiver again within a day: no second email', HTML.filter((m) => m.to === 'C:' + CLEAN_E).length === 1)
reset(); HTML.length = 0; APP.local_families = [{ id: 'old', email: CLEAN_E, at: new Date(Date.now() - 30 * 3600_000).toISOString() }]
await signup({ kind: 'family', name: 'Returning', email: CLEAN_E, zip: '65802' })
ck('S4 · the same address after more than a day: confirmed again', HTML.filter((m) => m.to === 'C:' + CLEAN_E).length === 1)
reset(); HTML.length = 0
await signup({ kind: 'family', name: 'Opted Out', email: OPT_E, zip: '65802' })
ck('S4 · an address that opted out still gets nothing (the opt-out door still applies)', HTML.filter((m) => m.to === 'C:' + OPT_E).length === 0)
for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
