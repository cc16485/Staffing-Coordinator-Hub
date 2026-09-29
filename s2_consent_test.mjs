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


/* ── S2: reference-chase texts the applicant only with their yes to texts on file ── */
const sent5 = new Date(Date.now() - 6 * 86400_000).toISOString()
const ref = (id, extra) => ({ id, candidate_id: 'c-' + id, candidate_name: 'Ann Applicant', ref_name: 'Rita Ref', ref_email: 'rita@example.test', sent_at: sent5, reminded_at: sent5, responded_at: null, applicant_nudged_at: null, ...extra })
const rcSetup = () => { reset()
  T.job_applicants = [
    { id: 'j-yes', phone: '(417) 555-0101', sms_consent: true },
    { id: 'j-no', phone: '417-555-0404', sms_consent: false },
    { id: 'j-twiceA', phone: '4175550505', sms_consent: true }, { id: 'j-twiceB', phone: '+1 417 555 0505', sms_consent: false } ]
  T.reference_requests = [
    ref('r-yes', { candidate_phone: '4175550101', candidate_email: 'yes@example.test' }),
    ref('r-no', { candidate_phone: '4175550404', candidate_email: 'no@example.test' }),
    ref('r-unmatched', { candidate_phone: '4175550606', candidate_email: 'un@example.test' }),
    ref('r-mixed', { candidate_phone: '4175550505', candidate_email: 'mix@example.test' }),
    ref('r-byid', { candidate_phone: '4175550707', candidate_email: 'byid@example.test', applicant_id: 'j-yes' }),
    ref('r-noemail', { candidate_phone: '4175550404', candidate_email: null }) ]
  // the harness's is('responded_at', null) filter is a no-op; every row above is unanswered
}
let rc = await load('reference-chase')
rcSetup(); let d = await post(rc, 'https://x/functions/v1/reference-chase?dry=1', {})
ck('S2 · practice run: says who would be texted and who emailed only (1 by text: said yes; 1 by their own record)', d.j && d.j.applicant_by_text === 2 && d.j.applicant_email_only === 4
   && d.j.would_ask_applicant.filter((x) => /text and email/.test(x)).length === 2, d.j)
rcSetup(); let r = await post(rc, 'https://x/functions/v1/reference-chase', {})
const sms = SENT.filter((m) => m.type === 'SMS').map((m) => m.to), mail = SENT.filter((m) => m.type === 'Email').map((m) => m.to)
ck('S2 · said yes on the form: texted and emailed', sms.includes('C:+14175550101') && mail.includes('C:yes@example.test'), SENT)
ck('S2 · said no: email only, no text', !sms.includes('C:+14175550404') && mail.includes('C:no@example.test'), SENT)
ck('S2 · no application with that number: email only', !sms.includes('C:+14175550606') && mail.includes('C:un@example.test'), SENT)
ck('S2 · the same number applied twice, once without a yes: email only (never a guess)', !sms.includes('C:+14175550505') && mail.includes('C:mix@example.test'), SENT)
ck('S2 · the row carries the applicant\'s own record: that record decides (yes → texted)', mail.includes('C:byid@example.test') && sms.includes('C:+14175550707'), SENT)
ck('S2 · no yes and no email: nothing sent (the office picks it up at day 9)', SENT.length === 7, SENT)
const src2 = fs.readFileSync(`${FN}/reference-chase/index.ts`, 'utf8')
ck('S2 · the text now says "Reply STOP to opt out."', /Reply STOP to opt out\./.test(src2))
ck('S2 · still exactly 4 sends, all through the opt-out door', (src2.match(/await door\(/g) || []).length === 4)
for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
