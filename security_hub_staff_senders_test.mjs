// Lead texts, GoHighLevel replies and job offers: the staff member's own Hub sign-in + the Hub's opt-out check
// (2026-09-27). The REAL Hub outreach-check and the REAL Training senders, with fake databases, a fake GoHighLevel, and
// the Training senders talking to the Hub function over a fake network. node security_hub_staff_senders_test.mjs
import fs from 'fs'; import path from 'path'; import os from 'os';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const HUBF = 'supabase/functions', TP = path.join(os.homedir(), 'Claude/Projects/Caring Companions Training Platform/supabase/functions')
const CLEAN_P = '4175550101', OPT_P = '4175550202', CLEAN_E = 'clean@example.test', OPT_E = 'optout@example.test'
let SENT, GHL_TOUCHED, REFUSED, T
const reset = () => { SENT = []; GHL_TOUCHED = 0; REFUSED = []; T = {
  contact_optout_current: [{ address: '+1' + OPT_P, channel: 'sms', opted_out: true, source: 'stop_text' }, { address: OPT_E, channel: 'email', opted_out: true, source: 'staff' }],
  circle_contacts: [], app_data: [],
  auth_identities: [{ auth_user_id: 'u-k', person_id: 'p-k', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-n', person_id: 'p-n', project_ref: 'zngsgedlsxinbygwmxwn' }],
  persons: [{ person_id: 'p-k', active: true, full_name: 'Krystal Land' }, { person_id: 'p-n', active: true, full_name: 'No Role' }],
  entity_memberships: [{ person_id: 'p-k', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-n', entity: 'cc_ihs', active: true, ended_at: null }],
  staff_roles: [{ person_id: 'p-k', entity: 'cc_ihs', role: 'care_coordinator' }],
  job_offers: [{ id: 'o1', first_name: '<b>Pat</b>', last_name: 'New', phone: CLEAN_P, email: OPT_E, welcome_sent_at: null, start_link_sent_at: null }],
} }
const q = (t) => { const st = { f: [] }; const b = {
  select() { return b; }, order() { return b; }, limit() { return b; }, in() { return b; }, not() { return b; }, gte() { return b; }, contains() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; },
  update(p) { return { eq: (c, v) => { for (const r of (T[t] || [])) if (r[c] === v) Object.assign(r, p); return Promise.resolve({ data: null, error: null }) } } },
  insert(row) { const r = { id: 'new', ...row }; (T[t] ||= []).push(r); return { select: () => ({ single: () => Promise.resolve({ data: r, error: null }) }) } },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })); }, single() { return b.maybeSingle(); },
  then(ok) { let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v); return Promise.resolve({ data: rows, error: null }).then(ok); } }; return b; };
const USERS = { 'hub-krystal': { id: 'u-k', email: 'krystal@mo-care.com', app_metadata: {} }, 'hub-norole': { id: 'u-n', email: 'n@mo-care.com', app_metadata: {} } }
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'contact_send_refusal_log') REFUSED.push(a); return { data: null, error: null } },
  auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: USERS[jwt] }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
let HUB   // the Hub's outreach-check handler, reached over the fake network
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.endsWith('/functions/v1/outreach-check')) return HUB(new Request(url, { method: 'POST', headers: o.headers, body: o.body }))
  GHL_TOUCHED++
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  const gm = url.match(/\/contacts\/([^/?]+)$/); if (gm) { const id = decodeURIComponent(gm[1]); return new Response(JSON.stringify({ contact: { id, phone: id === 'cg-opt' ? '+1' + OPT_P : '+1' + CLEAN_P, dnd: false } }), { status: 200 }) }
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, type: body.type, html: body.html }); return new Response('{}', { status: 200 }) }
  if (url.includes('/conversations/search')) return new Response(JSON.stringify({ conversations: [] }), { status: 200 })
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HUB_ANON_KEY: 'hub-anon' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_hss_'))
const noCC = (s) => s.replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
fs.writeFileSync(path.join(tmp, 'hub-gate.ts'), fs.readFileSync(path.join(TP, '_shared/hub-gate.ts'), 'utf8'))
const load = async (dir, name) => { let s = noCC(fs.readFileSync(path.join(dir, name, 'index.ts'), 'utf8')).replace("from '../_shared/hub-gate.ts'", "from './hub-gate.ts'")
  s = s.replace(/from '\.\.\/_shared\/(staff-auth|optout)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), HUBF, '_shared', m + '.ts') + "'")
  const f = path.join(tmp, name + '.ts'); fs.writeFileSync(f, s); await import(f + '?' + Math.random()); return handler }
const post = async (h, body, hubTok) => { const hd = { 'Content-Type': 'application/json', Authorization: 'Bearer training-anon' }; if (hubTok) hd['x-hub-token'] = hubTok
  const r = await h(new Request('https://tp/functions/v1/x', { method: 'POST', headers: hd, body: JSON.stringify(body) })); let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
try {
HUB = await load(HUBF, 'outreach-check')
const hubPost = async (body, jwt) => { const r = await HUB(new Request('https://hub/functions/v1/outreach-check', { method: 'POST', headers: jwt ? { Authorization: 'Bearer ' + jwt } : {}, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
reset(); let r = await hubPost({ auth_check: true })
ck('Hub outreach-check · no sign-in: refused (401)', r.status === 401, r)
r = await hubPost({ auth_check: true }, 'hub-norole')
ck('Hub outreach-check · signed in with no office role: refused (403)', r.status === 403, r)
r = await hubPost({ auth_check: true }, 'hub-krystal')
ck('Hub outreach-check · a care coordinator: identified by her own sign-in', r.j?.authorized === true && r.j?.email === 'krystal@mo-care.com', r)
reset(); r = await hubPost({ sender: 'ghl-lead-comms', channel: 'sms', phone: OPT_P }, 'hub-krystal')
ck('Hub outreach-check · a number that replied STOP: not allowed, and the refusal is logged with who tried', r.j?.allowed === false && REFUSED.length === 1 && /by krystal@mo-care.com/.test(REFUSED[0].p_sender), [r, REFUSED])

const LC = await load(TP, 'ghl-lead-comms')
reset(); r = await post(LC, { key: 'the-old-shared-key', action: 'send_sms', phone: CLEAN_P, message: 'hi' })
ck('lead texts · the old shared key alone: refused (401), GoHighLevel never touched', r.status === 401 && GHL_TOUCHED === 0 && SENT.length === 0, r)
reset(); r = await post(LC, { action: 'send_sms', phone: CLEAN_P, message: 'hi' }, 'hub-norole')
ck('lead texts · a Hub account with no office role: refused (401), nothing sent', r.status === 401 && SENT.length === 0, r)
reset(); r = await post(LC, { action: 'send_sms', phone: CLEAN_P, message: 'Hi from Krystal' }, 'hub-krystal')
ck('lead texts · Krystal signed in: the text goes to the contact the Hub cleared', r.j?.status === 'sent' && SENT.length === 1 && SENT[0].to === 'C:+1' + CLEAN_P, [r, SENT])
reset(); r = await post(LC, { action: 'send_sms', phone: OPT_P, message: 'hi' }, 'hub-krystal')
ck('lead texts · to a number that replied STOP: not sent, and she is told why', SENT.length === 0 && /opted out/.test(r.j?.error), r)
reset(); r = await post(LC, { action: 'send_email', email: OPT_E, subject: 'S', message: 'M' }, 'hub-krystal')
ck('lead emails · to an opted-out address: not sent', SENT.length === 0 && /opted out/.test(r.j?.error), r)
reset(); r = await post(LC, { action: 'timeline', phone: CLEAN_P }, 'hub-krystal')
ck('lead history (timeline) · works for signed-in staff', Array.isArray(r.j?.timeline), r)
reset(); r = await post(LC, { action: 'timeline', phone: CLEAN_P })
ck('lead history (timeline) · refused without a Hub sign-in (it holds message history)', r.status === 401 && GHL_TOUCHED === 0, r)

const RP = await load(TP, 'ghl-reply')
reset(); r = await post(RP, { key: 'the-old-shared-key', contact_id: 'cg-clean', message: 'hi' })
ck('GoHighLevel replies · the old shared key alone: refused (401), nothing sent', r.status === 401 && SENT.length === 0, r)
reset(); r = await post(RP, { contact_id: 'cg-clean', message: 'on my way' }, 'hub-krystal')
ck('GoHighLevel replies · signed-in staff: sent to the cleared contact', r.j?.status === 'sent' && SENT.length === 1 && SENT[0].to === 'cg-clean', [r, SENT])
reset(); r = await post(RP, { contact_id: 'cg-opt', message: 'hi' }, 'hub-krystal')
ck('GoHighLevel replies · to someone who replied STOP: not sent', SENT.length === 0 && /opted out/.test(r.j?.error), r)
reset(); r = await post(RP, { action: 'dismiss', conversation_id: 'conv1' }, 'hub-krystal')
ck('GoHighLevel replies · clearing a conversation still works for staff', r.j?.status === 'dismissed', r)

const JO = await load(TP, 'job-offer')
reset(); r = await post(JO, { key: 'the-old-shared-key', action: 'send_welcome', offer_id: 'o1' })
ck('job offers · the old shared key alone: refused (401), nothing sent', r.status === 401 && SENT.length === 0, r)
reset(); r = await post(JO, { action: 'send_welcome', offer_id: 'o1' }, 'hub-krystal')
ck('job offers · welcome by signed-in staff: the text goes; the email to an opted-out address does not', SENT.length === 1 && SENT[0].type === 'SMS' && r.j?.sms === true && r.j?.email === false, [r, SENT])
reset(); T.job_offers[0].email = CLEAN_E; r = await post(JO, { action: 'send_start_link', offer_id: 'o1' }, 'hub-krystal')
const em = SENT.find((s) => s.type === 'Email')
ck('job offers · the new hire\'s name is escaped in the email (no HTML injection)', em && em.html.includes('&lt;b&gt;Pat') && !em.html.includes('<b>Pat'), SENT)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
console.log('\nLEAD TEXTS, GHL REPLIES, JOB OFFERS · HUB SIGN-IN + OPT-OUT · TEST\n' + '='.repeat(60)); let all = true
for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
