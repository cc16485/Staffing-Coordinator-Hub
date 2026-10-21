// 1032 · REFERENCE TEXTS (Samantha 2026-10-21: "the Hub texts each reference automatically from the office line (with STOP to
// opt out), and the office calls when needed"). The real reference-chase against a fake database and fake GoHighLevel. Harness from s2_consent_test.mjs.
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



const R = await import(path.join(process.cwd(), FN, '_shared/reference-texts.ts'))
const now0 = new Date().toISOString(), sent3 = new Date(Date.now() - 3 * 86400_000).toISOString()
const rr = (id, extra) => ({ id, candidate_id: 'c-' + id, candidate_name: 'Jordan Ellis', ref_name: 'Susie Manning', ref_email: null, ref_phone: null, sent_at: null, reminded_at: null, responded_at: null, applicant_nudged_at: null, ...extra })
const setup = (live) => { reset(); if (live !== undefined) APP.ops_settings = { ref_auto_text_live: live }
  T.reference_requests = [
    rr('a-both', { ref_email: 'both@example.test', ref_phone: CLEAN_P }),
    rr('b-phone', { ref_phone: '4175550808' }),
    rr('c-remind', { ref_phone: '4175550909', sent_at: sent3 }),
    rr('d-optout', { ref_phone: OPT_P }),
    rr('e-none', {}) ] }
const sms = () => SENT.filter((m) => m.type === 'SMS').map((m) => m.to), mail = () => SENT.filter((m) => m.type === 'Email').map((m) => m.to)
const ops = () => (APP.ops_items || [])
let rc = await load('reference-chase')
setup(); let r = await post(rc, 'https://x/functions/v1/reference-chase', {}, { 'x-cron-secret': JOBSEC })
ck('switch off (the default): no reference is texted; the email ask goes as before; phone-only references are a Call card today, as before', sms().length === 0 && mail().includes('C:both@example.test') && r.j.texts === 'practice' && ops().some((i) => /No email for this reference/.test(i.title)), { j: r.j, SENT })
ck('...practice says how many would have been texted (three first asks and one reminder with a number)', r.j.would_text === 4, r.j)
setup(true); r = await post(rc, 'https://x/functions/v1/reference-chase', {}, { 'x-cron-secret': JOBSEC })
ck('switch on: the reference with an email and a number gets the text AND the email', sms().includes('C:+1' + CLEAN_P) && mail().includes('C:both@example.test'), SENT)
ck('switch on: a phone-only reference is texted the first ask (no longer a Call card on day 0)', sms().includes('C:+14175550808') && !ops().some((i) => /No email for this reference: Susie Manning/.test(i.title) && /b-phone/.test(i.id)), { SENT, ops: ops().map((i) => i.id) })
ck('switch on: the day-2 reminder goes by text too', sms().includes('C:+14175550909') && r.j.texted_reminder === 1, { j: r.j, SENT })
ck('switch on: a phone-only reference who texted STOP is never texted, and becomes a Call card the same day', !sms().includes('C:+1' + OPT_P) && ops().some((i) => i.id === 'ops_ref_d-optout'), { SENT, ops: ops().map((i) => i.id) })
ck('switch on: no email and no number: still a Call card for the office', ops().some((i) => i.id === 'ops_ref_e-none'), ops().map((i) => i.id))
ck('switch on: counted in the answer', r.j.texts === 'on' && r.j.texted_first === 2 && r.j.texted_reminder === 1, r.j)
const t1 = R.firstAskText('Susie Manning', 'Jordan Ellis', 'https://cc.mo-care.com/reference.html?r=1'), t2 = R.reminderText('Susie Manning', 'Jordan Ellis', 'https://cc.mo-care.com/reference.html?r=1')
ck('the words: first name, who listed them, the link, the office number, Reply STOP to opt out; no em dash', /^Hi Susie, this is Caring Companions In-Home Senior Care\. Jordan Ellis listed you as a reference/.test(t1) && /\(417\) 234-8494/.test(t1) && /Reply STOP to opt out\.$/.test(t1) && /Reply STOP to opt out\.$/.test(t2) && !/—/.test(t1 + t2), [t1, t2])
const src = fs.readFileSync(`${FN}/reference-chase/index.ts`, 'utf8')
ck('the texts go through ghlSendChecked (from the office line, a refusal raises a card) and only with ref_auto_text_live === true', /ref_auto_text_live === true/.test(src) && (src.match(/channel: 'sms', contactId: smsId, address: r\.ref_phone/g) || []).length === 2)
for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length); process.exit(res.every((x) => x[1]) ? 0 : 1)
