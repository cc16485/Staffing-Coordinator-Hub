// The last senders without an opt-out check (Training invites/reminders/certificates/cleared/welcome, HomeTogether Hire
// emails) now ask the Hub's server-only door (2026-09-27). REAL Hub outreach-check + REAL Training/HomeTogether senders,
// fake databases, fake GoHighLevel and Resend, one fake network between them. node optout_remaining_test.mjs
import fs from 'fs'; import path from 'path'; import os from 'os';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const HUBF = 'supabase/functions', TP = path.join(os.homedir(), 'Claude/Projects/Caring Companions Training Platform/supabase/functions'),
  HT = path.join(os.homedir(), 'Claude/Projects/HomeTogether/supabase/functions')
const SECRET = 's'.repeat(48), CLEAN_P = '4175550101', OPT_P = '4175550202', DND_P = '4175550303', CLEAN_E = 'clean@example.test', OPT_E = 'optout@example.test'
let T, SENT, REFUSED, HUB_DOWN
const reset = () => { SENT = []; REFUSED = []; HUB_DOWN = false; T = {
  contact_optout_current: [{ address: '+1' + OPT_P, channel: 'sms', opted_out: true, source: 'stop_text' }, { address: OPT_E, channel: 'email', opted_out: true, source: 'staff' }],
  circle_contacts: [], app_data: [],
  caregivers: [{ id: 'cg1', name: 'Tia Train', mobile_phone: CLEAN_P, email: CLEAN_E, status_label: 'In Training', active: true, access_token: 'tok1', cleared_notified_at: null },
               { id: 'cg2', name: 'Oz Opted', mobile_phone: OPT_P, email: OPT_E, status_label: 'In Training', active: true, access_token: 'tok2', cleared_notified_at: null },
               { id: 'cg3', name: 'Dee Dnd', mobile_phone: DND_P, email: CLEAN_E, status_label: 'In Training', active: true, access_token: 'tok3', cleared_notified_at: null }],
  enrollments: [{ caregiver_id: 'cg1', requirement: 'pre_service', status: 'complete' }, { caregiver_id: 'cg2', requirement: 'pre_service', status: 'complete' }, { caregiver_id: 'cg3', requirement: 'pre_service', status: 'complete' }],
  htl_family_members: [{ id: 'm1', household_id: 'fam-A', email: OPT_E, status: 'invited', invite_code: 'aaaaaaaaaaaaaaaa' }, { id: 'm2', household_id: 'fam-A', email: CLEAN_E, status: 'invited', invite_code: 'cccccccccccccccc' }],
  htl_families: [{ user_id: 'fam-A', name: 'The Rivera Family' }],
  courses: [{ slug: 'basic-12', title: 'Basic 12-hour', hours: 12 }],
} }
const q = (t) => { const st = { f: [] }; const b = {
  select() { return b; }, order() { return b; }, limit() { return b; }, in() { return b; }, not() { return b; }, gte() { return b; }, contains() { return b; }, or() { return b; }, is() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; },
  update(p) { return { eq: (c, v) => { for (const r of (T[t] || [])) if (r[c] === v) Object.assign(r, p); return Promise.resolve({ data: null, error: null }) } } },
  insert() { return Promise.resolve({ data: null, error: null }) }, upsert() { return Promise.resolve({ data: null, error: null }) },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })); }, single() { return b.maybeSingle(); },
  then(ok) { let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v); return Promise.resolve({ data: rows, error: null }).then(ok); } }; return b; };
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'contact_send_refusal_log') REFUSED.push(a); return { data: null, error: null } },
  auth: { getUser: async (jwt) => jwt === 'staff' ? { data: { user: { id: 'u1', email: 'krystal@mo-care.com', app_metadata: {} } }, error: null }
                                 : jwt === 'fam-A' ? { data: { user: { id: 'fam-A', email: 'a@x.test' } }, error: null } : { data: { user: null }, error: { message: 'bad' } } },
  storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async (p) => ({ data: { signedUrl: 'https://tp.supabase.co/storage/v1/object/sign/waiver-docs/' + p + '?token=x' } }) }) } }
let HUB
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.endsWith('/functions/v1/outreach-check')) { if (HUB_DOWN) throw new Error('unreachable'); return HUB(new Request(url, { method: 'POST', headers: o.headers, body: o.body })) }
  if (url.includes('/contacts/upsert')) { const key = body.phone || body.email; const smsDnd = String(body.phone || '').endsWith(DND_P); return new Response(JSON.stringify({ contact: { id: 'C:' + key, dnd: false, ...(smsDnd ? { dndSettings: { SMS: { status: 'active' } } } : {}) } }), { status: 200 }) }
  if (url.includes('/conversations/messages')) { SENT.push({ via: 'ghl', type: body.type, to: body.contactId }); return new Response('{}', { status: 200 }) }
  if (url.includes('api.resend.com')) { SENT.push({ via: 'resend', to: [].concat(body.to)[0] }); return new Response('{"id":"x"}', { status: 200 }) }
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://tp.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', OUTREACH_SECRET: SECRET, HUB_ANON_KEY: 'hub-anon',
  RESEND_API_KEY: 'rk', HTL_PUBLIC_TOKEN: 'htlpub_x' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_orm_'))
const noCC = (s) => s.replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
for (const [dir, f] of [[TP, 'guard.ts'], [TP, 'optout-gate.ts']]) fs.writeFileSync(path.join(tmp, f), noCC(fs.readFileSync(path.join(dir, '_shared', f), 'utf8')))
fs.writeFileSync(path.join(tmp, 'ht-optout-gate.ts'), fs.readFileSync(path.join(HT, '_shared/optout-gate.ts'), 'utf8'))
const load = async (dir, name) => { let s = noCC(fs.readFileSync(path.join(dir, name, 'index.ts'), 'utf8'))
    .replace("from '../_shared/guard.ts'", "from './guard.ts'")
    .replace(/from ['"]\.\.\/_shared\/optout-gate\.ts['"]/, dir === HT ? "from './ht-optout-gate.ts'" : "from './optout-gate.ts'")
    .replace(/from '\.\.\/_shared\/(staff-auth|optout)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), HUBF, '_shared', m + '.ts') + "'")
  const f = path.join(tmp, name + (dir === HT ? '-ht' : '') + '.ts'); fs.writeFileSync(f, s); await import(f + '?' + Math.random()); return handler }
const post = async (h, body, headers = {}, q = '') => { const r = await h(new Request('https://x/functions/v1/x' + q, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })); let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
const to = (x) => SENT.filter((s) => s.to === x || s.to === 'C:' + x || s.to === 'C:+1' + x).length
try {
HUB = await load(HUBF, 'outreach-check')
const door = (body, secret) => post(HUB, body, secret === undefined ? {} : { 'x-outreach-secret': secret, Authorization: 'Bearer hub-anon' })
reset(); let r = await door({ sender: 't', channel: 'email', email: CLEAN_E, via_ghl: false }, 'x'.repeat(48))
ck('Hub server door · a wrong secret: refused (401)', r.status === 401, r)
reset(); r = await door({ sender: 't', channel: 'email', email: CLEAN_E, via_ghl: false }, SECRET)
ck('Hub server door · the right secret, a clean address: allowed', r.j?.allowed === true, r)
reset(); r = await door({ sender: 'send-reminder', channel: 'sms', phone: OPT_P }, SECRET)
ck('Hub server door · a number that replied STOP: not allowed, refusal logged with the sender', r.j?.allowed === false && REFUSED.length === 1 && REFUSED[0].p_sender === 'send-reminder', [r, REFUSED])
ENV.OUTREACH_SECRET = 'short'; reset(); r = await door({ sender: 't', channel: 'email', email: CLEAN_E, via_ghl: false }, 'short'); ENV.OUTREACH_SECRET = SECRET
ck('Hub server door · a secret under 32 characters never opens it', r.status === 401, r)

const texts = () => SENT.filter((s) => s.type === 'SMS').length, emails = () => SENT.filter((s) => s.type === 'Email').length
for (const [fn, extra, label] of [['send-invite', { course_slug: 'basic-12' }, 'invite'], ['send-reminder', {}, 'reminder']]) {
  const h = await load(TP, fn)
  reset(); r = await post(h, { caregiver_id: 'cg1', ...extra }, { Authorization: 'Bearer staff' })
  ck(`training ${label} · a clean caregiver: text and email both go`, texts() === 1 && emails() === 1, [r, SENT])
  reset(); r = await post(h, { caregiver_id: 'cg2', ...extra }, { Authorization: 'Bearer staff' })
  ck(`training ${label} · a caregiver who replied STOP and opted out of email: nothing sent`, SENT.length === 0, [r, SENT])
  reset(); r = await post(h, { caregiver_id: 'cg3', ...extra }, { Authorization: 'Bearer staff' })
  ck(`training ${label} · a caregiver on GoHighLevel Do Not Disturb for texts (this project's contact): no text; the email still goes`, texts() === 0 && emails() === 1, [r, SENT])
  reset(); HUB_DOWN = true; r = await post(h, { caregiver_id: 'cg1', ...extra }, { Authorization: 'Bearer staff' })
  ck(`training ${label} · if the Hub cannot be reached: nothing sent (fail closed)`, SENT.length === 0, [r, SENT])
}
let h = await load(TP, 'notify-cleared')
reset(); r = await post(h, { token: 'tok1' }); const cleared1 = to(CLEAN_P)
reset(); r = await post(h, { token: 'tok2' })
ck('training "you\'re cleared" · sent to a clean caregiver, not to one who replied STOP', cleared1 === 1 && SENT.length === 0, [r, SENT])
h = await load(TP, 'send-certificate')
reset(); r = await post(h, { token: 'tok2', slug: 'basic-12', course_title: 'Basic', pdf_base64: btoa('pdf') })
ck('training certificate · to a caregiver who opted out of email: not sent', SENT.length === 0 && r.j?.status === 'not_sent_opted_out', r)
const sync = fs.readFileSync(path.join(TP, 'sync-axiscare/index.ts'), 'utf8')
ck('training nightly welcome (source) · both the text and the email ask first', (sync.match(/await allow\('sync-axiscare \(welcome\)'/g) || []).length === 2)

h = await load(HT, 'htl-notify'); const NU = '?token=htlpub_x'
reset(); r = await post(h, { action: 'invite', invite_code: 'aaaaaaaaaaaaaaaa' }, { Authorization: 'Bearer fam-A' }, NU)
ck('HomeTogether invite · to an address that opted out: not emailed', SENT.length === 0, [r, SENT])
reset(); r = await post(h, { action: 'invite', invite_code: 'cccccccccccccccc' }, { Authorization: 'Bearer fam-A' }, NU)
ck('HomeTogether invite · to a clean address: emailed', to(CLEAN_E) === 1, [r, SENT])
for (const f of ['htl-apply', 'htl-admin']) {
  const s = fs.readFileSync(path.join(HT, f, 'index.ts'), 'utf8')
  ck(`HomeTogether ${f} (source) · every customer email asks first`, /async function sendEmail[^]*?if \(!\(await mayMessage\('/.test(s))
}
const fe = fs.readFileSync(path.join(HT, 'htl-founding-emails/index.ts'), 'utf8')
ck('HomeTogether founding emails (source) · ask first, and a family is marked done only after an email actually went', (fe.match(/&& await may\(\)\) \{/g) || []).length === 2)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
console.log('\nTHE LAST SENDERS · OPT-OUT CHECK (TRAINING + HOMETOGETHER HIRE) · TEST\n' + '='.repeat(60)); let all = true
for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
