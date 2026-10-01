// Security slice (2026-09-27): the public senders found in 0c. The REAL functions from three projects against a fake
// database, fake GoHighLevel and fake Resend; every send is recorded. node security_public_senders_test.mjs
import fs from 'fs'; import path from 'path'; import os from 'os';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const HUB = 'supabase/functions', HT = path.join(os.homedir(), 'Claude/Projects/HomeTogether/supabase/functions'),
  TP = path.join(os.homedir(), 'Claude/Projects/Caring Companions Training Platform/supabase/functions')
const RELAY_SECRET = 'r'.repeat(48), CRON = 'c'.repeat(48), SVC = 'svc-key', PUBLIC = 'htorder_publicpagetoken'
let T, SENT
const reset = () => { SENT = []; T = {
  contact_optout_current: [{ address: 'optout@example.test', channel: 'email', opted_out: true, source: 'staff' }], circle_contacts: [], app_data: [],
  htl_family_members: [{ id: 'm1', household_id: 'fam-A', email: 'helper@example.test', status: 'invited', invite_code: 'aaaaaaaaaaaaaaaa' },
                       { id: 'm2', household_id: 'fam-B', email: 'other@example.test', status: 'invited', invite_code: 'bbbbbbbbbbbbbbbb' }],
  htl_families: [{ user_id: 'fam-A', name: 'The Rivera Family' }],
  htl_contact_requests: [{ family_user_id: 'fam-A', caregiver_id: 'cg-linked' }],
  htl_caregivers: [{ id: 'cg-linked', email: 'linked@example.test' }, { id: 'cg-other', email: 'stranger@example.test' }],
  caregivers: [{ id: 'tp-cg', name: 'Tia Train', email: 'tia@example.test', mobile_phone: '4175550101', access_token: 'tok-tia', active: true, status: 'In Training' }],
} }
const q = (t) => { const st = { f: [] }; const b = {
  select() { return b; }, order() { return b; }, limit() { return b; }, in() { return b; }, gte() { return b; }, not() { return b; }, or() { return b; }, is() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; },
  update(patch) { return { eq: (c, v) => { for (const r of (T[t] || [])) if (r[c] === v) Object.assign(r, patch); return Promise.resolve({ data: null, error: null }) } } },
  insert() { return Promise.resolve({ data: null, error: null }) }, upsert() { return Promise.resolve({ data: null, error: null }) },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })); }, single() { return b.maybeSingle(); },
  then(ok) { let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v); return Promise.resolve({ data: rows, error: null }).then(ok); } }; return b; };
const USERS = { 'jwt-fam-A': { id: 'fam-A', email: 'a@example.test' }, 'jwt-fam-B': { id: 'fam-B', email: 'b@example.test' }, 'jwt-staff': { id: 'st1', email: 'krystal@mo-care.com' } }
globalThis.__db = { from: q, rpc: async () => ({ data: null, error: null }),
  auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: USERS[jwt] }, error: null } : { data: { user: null }, error: { message: 'bad' } } },
  storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async (p) => ({ data: { signedUrl: 'https://tp.supabase.co/storage/v1/object/sign/waiver-docs/' + p + '?token=x' } }) }) } };
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.endsWith('/functions/v1/outreach-check')) return new Response(JSON.stringify({ allowed: true }), { status: 200 })   // the Hub's opt-out door (tested in optout_remaining_test.mjs)
  if (url.includes('api.resend.com')) { SENT.push({ via: 'resend', to: [].concat(body.to)[0], subject: body.subject, html: body.html }); return new Response('{"id":"x"}', { status: 200 }) }
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.email || body.phone), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ via: 'ghl', to: body.contactId, type: body.type, html: body.html }); return new Response('{}', { status: 200 }) }
  if (url.includes('/hooks/')) { SENT.push({ via: 'ghl-hook', to: body.email }); return new Response('{}', { status: 200 }) }
  if (url.includes('/functions/v1/resend-relay')) { SENT.push({ via: 'relay', headers: o.headers, body }); return new Response('{"ok":true}', { status: 200 }) }
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://tp.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, RESEND_API_KEY: 'rk', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc',
  HTL_PUBLIC_TOKEN: 'htlpub_x', RELAY_SECRET, OUTREACH_SECRET: 'o'.repeat(48), HUB_ANON_KEY: 'hub-anon', TRAINING_CRON_SECRET: CRON, HT_ORDER_TOKEN: PUBLIC, HT_SUPPORT_TOKEN: PUBLIC, AXISCARE_SITE_NUMBER: '1', AXISCARE_TOKEN: 't' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
const tmpDir = fs.mkdtempSync(path.join(process.cwd(), '_psl_'))
const noCC = (s) => s.replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
fs.writeFileSync(path.join(tmpDir, 'guard.ts'), noCC(fs.readFileSync(path.join(TP, '_shared/guard.ts'), 'utf8')))
fs.writeFileSync(path.join(tmpDir, 'optout-gate.ts'), fs.readFileSync(path.join(TP, '_shared/optout-gate.ts'), 'utf8'))
const load = async (dir, name) => {
  let src = noCC(fs.readFileSync(path.join(dir, name, 'index.ts'), 'utf8'))
    .replace("from '../_shared/guard.ts'", "from './guard.ts'").replace(/from ['"]\.\.\/_shared\/optout-gate\.ts['"]/, "from './optout-gate.ts'").replace(/from '\.\.\/_shared\/optout\.ts'/, "from '" + path.join(process.cwd(), HUB, '_shared/optout.ts') + "'").replace(/from '\.\.\/_shared\/send-problems\.ts'/, "from '" + path.join(process.cwd(), HUB, '_shared/send-problems.ts') + "'")
  const tmp = path.join(tmpDir, name + '.ts'); fs.writeFileSync(tmp, src); await import(tmp + '?' + Math.random()); return handler }
const post = async (h, url, body, headers = {}) => { const r = await h(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) })); let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
try {
/* ── resend-relay (Hub) ── */
let h = await load(HUB, 'resend-relay')
const mail = { from: 'HomeTogether <support@tryhometogether.com>', to: 'victim@example.test', subject: 'Your account', html: '<a href="https://evil.example">verify</a>' }
reset(); let r = await post(h, 'https://x/functions/v1/resend-relay', { token: PUBLIC, ...mail })
ck('resend-relay · the public page key no longer sends anything (401): the open relay is closed', r.status === 401 && SENT.length === 0, r)
reset(); r = await post(h, 'https://x/functions/v1/resend-relay', mail, { 'x-relay-secret': 'x'.repeat(48) })
ck('resend-relay · a wrong secret: refused, nothing sent', r.status === 401 && SENT.length === 0, r)
reset(); r = await post(h, 'https://x/functions/v1/resend-relay', { ...mail, to: 'friend@example.test' }, { 'x-relay-secret': RELAY_SECRET })
ck('resend-relay · the server-only secret (the founding-emails job): relayed', r.j?.ok === true && SENT.length === 1, r)
reset(); r = await post(h, 'https://x/functions/v1/resend-relay', { ...mail, to: 'optout@example.test' }, { 'x-relay-secret': RELAY_SECRET })
ck('resend-relay · still honors the opt-out check with the right secret', r.j?.opted_out === true && SENT.length === 0, r)
ENV.RELAY_SECRET = 'short'; reset(); r = await post(h, 'https://x/functions/v1/resend-relay', mail, { 'x-relay-secret': 'short' }); ENV.RELAY_SECRET = RELAY_SECRET
ck('resend-relay · a secret under 32 characters (or unset) never opens it', r.status === 401 && SENT.length === 0, r)

/* ── htl-founding-emails (HomeTogether Hire) ── */
h = await load(HT, 'htl-founding-emails')
reset(); r = await post(h, 'https://x/functions/v1/htl-founding-emails', { token: 'htlpub_x', test: 'victim@example.test' })
ck('founding-emails · test mode is gone: the public key plus any address sends nothing (400)', r.status === 400 && SENT.length === 0, r)
const src = fs.readFileSync(path.join(HT, 'htl-founding-emails/index.ts'), 'utf8')
ck('founding-emails · the public page key is no longer written in its code; the relay gets the server-only secret in a header', !/htorder_/.test(src) && /"x-relay-secret": RELAY_SECRET/.test(src))

/* ── htl-notify (HomeTogether Hire) ── */
h = await load(HT, 'htl-notify'); const NU = 'https://x/functions/v1/htl-notify?token=htlpub_x'
reset(); r = await post(h, NU, { action: 'invite', invite_code: 'aaaaaaaaaaaaaaaa', email: 'victim@example.test', link: 'https://evil.example', inviter: 'Your Bank' }, { Authorization: 'Bearer jwt-fam-A' })
ck('htl-notify invite · the organizer\'s own pending invite: sent to the address ON THE INVITE, with our link and the family\'s name; the caller\'s address, link and name are ignored',
   SENT.length === 1 && SENT[0].to === 'helper@example.test' && SENT[0].html.includes('https://tryhometogether.com/family?invite=aaaaaaaaaaaaaaaa') && !SENT[0].html.includes('evil') && SENT[0].subject.startsWith('The Rivera Family'), SENT)
r = await post(h, NU, { action: 'invite', invite_code: 'aaaaaaaaaaaaaaaa' }, { Authorization: 'Bearer jwt-fam-A' })
ck('htl-notify invite · the same invite again within 24 hours: not re-sent', r.j?.sent === false && SENT.length === 1, r)
reset(); r = await post(h, NU, { action: 'invite', invite_code: 'bbbbbbbbbbbbbbbb' }, { Authorization: 'Bearer jwt-fam-A' })
ck('htl-notify invite · someone else\'s invite: refused (403), nothing sent', r.status === 403 && SENT.length === 0, r)
reset(); r = await post(h, NU, { action: 'invite', email: 'victim@example.test', link: 'https://evil.example', inviter: 'x' }, { Authorization: 'Bearer jwt-fam-A' })
ck('htl-notify invite · the old shape (address + link from the caller): refused, nothing sent', r.status === 400 && SENT.length === 0, r)
reset(); r = await post(h, NU, { action: 'doc', caregiver_id: 'cg-other', title: 'Sign this' }, { Authorization: 'Bearer jwt-fam-A' })
ck('htl-notify doc · a caregiver the family is not in contact with: refused, nothing sent', r.status === 403 && SENT.length === 0, r)
reset(); r = await post(h, NU, { action: 'doc', caregiver_id: 'cg-linked', title: 'Care agreement' }, { Authorization: 'Bearer jwt-fam-A' })
ck('htl-notify doc · a caregiver the family is in contact with: sent', SENT.length === 1 && SENT[0].to === 'linked@example.test', SENT)

/* ── Training Platform ── */
ENV.SUPABASE_URL = 'https://tp.supabase.co'
for (const [fn, body] of [['send-invite', { caregiver_id: 'tp-cg' }], ['send-reminder', { caregiver_id: 'tp-cg' }], ['sync-axiscare', {}], ['monthly-backup', {}]]) {
  h = await load(TP, fn)
  reset(); r = await post(h, `https://x/functions/v1/${fn}`, body)
  const r2 = await post(h, `https://x/functions/v1/${fn}`, body, { Authorization: 'Bearer anon-public-key' })
  ck(`training ${fn} · no sign-in, or the public key: refused (401) before anything is read or sent`, r.status === 401 && r2.status === 401 && SENT.length === 0, [r, r2])
  reset(); r = await post(h, `https://x/functions/v1/${fn}`, body, { Authorization: 'Bearer jwt-staff' })
  ck(`training ${fn} · signed-in staff: allowed past the check`, r.status !== 401, r)
}
h = await load(TP, 'send-reminder'); reset(); r = await post(h, 'https://x/functions/v1/send-reminder', { caregiver_id: 'tp-cg' }, { Authorization: 'Bearer ' + SVC })
ck('training send-reminder · the nightly sync\'s own server key: allowed', r.status !== 401, r)
for (const fn of ['sync-axiscare', 'monthly-backup']) {
  h = await load(TP, fn); reset(); r = await post(h, `https://x/functions/v1/${fn}`, {}, { 'x-cron-secret': CRON, Authorization: 'Bearer anon-public-key' })
  const r2 = await post(h, `https://x/functions/v1/${fn}`, {}, { 'x-cron-secret': PUBLIC, Authorization: 'Bearer anon-public-key' })
  ck(`training ${fn} · the scheduled job's server-only secret: allowed; the public key as the secret: refused`, r.status !== 401 && r2.status === 401, [r, r2])
  reset(); const r3 = await post(h, `https://x/functions/v1/${fn}`, { auth_check: true }, { 'x-cron-secret': CRON, Authorization: 'Bearer anon-public-key' })
  ck(`training ${fn} · check-only mode with the secret: answers "cron", runs nothing, sends nothing`, r3.j?.authorized === 'cron' && SENT.length === 0, r3)
}
h = await load(TP, 'send-certificate'); const CU = 'https://x/functions/v1/send-certificate'
reset(); r = await post(h, CU, { caregiver_id: 'tp-cg', course_title: 'X', url: 'https://evil.example/login' })
ck('training send-certificate · the admin path without a staff sign-in: refused (401), nothing sent', r.status === 401 && SENT.length === 0, r)
reset(); r = await post(h, CU, { caregiver_id: 'tp-cg', course_title: 'X', url: 'https://evil.example/login' }, { Authorization: 'Bearer jwt-staff' })
ck('training send-certificate · a link that is not our own certificate storage: refused, even for staff', r.status === 400 && /our own/.test(r.j?.error) && SENT.length === 0, r)
reset(); r = await post(h, CU, { token: 'tok-tia', slug: 'basic-12', course_title: '<a href="https://evil.example">Click</a>', date_str: 'Today', pdf_base64: btoa('pdf') })
const html = (SENT.find((s) => s.via === 'ghl') || {}).html || ''
ck('training send-certificate · the caregiver\'s own completion: sent with our signed link, and any HTML in the title is escaped',
   html.includes('/storage/v1/object/sign/waiver-docs/certificates/tp-cg/basic-12.pdf') && !html.includes('<a href="https://evil') && html.includes('&lt;a href='), html.slice(0, 300))
reset(); r = await post(h, CU, { token: 'tok-tia', slug: '../../x', course_title: 'X', pdf_base64: btoa('pdf') })
ck('training send-certificate · a slug that is not a plain course name (path tricks): refused', r.status === 400 && SENT.length === 0, r)
} finally { fs.rmSync(tmpDir, { recursive: true, force: true }) }

console.log('\nSECURITY SLICE · PUBLIC SENDERS (HUB, HOMETOGETHER HIRE, TRAINING) · TEST\n' + '='.repeat(60)); let all = true
for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
