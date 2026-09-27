// Security slice (2026-09-27): campaign-auto, campaign-send and circle-send no longer accept the public page token.
// The REAL functions against a fake database, fake Supabase Auth and fake GoHighLevel; every table read and every
// outbound call is recorded, so "refused BEFORE any audience read or send" is checked, not assumed.
// node security_slice_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions';
const realTLS = Date.prototype.toLocaleString;   // office hours on a weekday, whatever the real clock says
Date.prototype.toLocaleString = function (loc, o) {
  if (o && o.hour === '2-digit' && !o.minute) return '10'; if (o && o.weekday === 'short') return 'Tue'; return realTLS.call(this, loc, o); };

const PUBLIC_TOKEN = 'htorder_publicpagetoken000000000000000000'
const CRON = 'c'.repeat(48)
/* people: sign-in token -> auth user; auth user -> person -> membership + roles */
const USERS = {
  'jwt-owner':    { id: 'u-owner', email: 'owner@mo-care.com', app_metadata: { hub_access: ['care_coordinator', 'staffing', 'team_hub'] } },
  'jwt-coord':    { id: 'u-coord', email: 'coord@mo-care.com', app_metadata: {} },
  'jwt-staffing': { id: 'u-staff', email: 'staff@mo-care.com', app_metadata: {} },
  'jwt-nobody':   { id: 'u-nobody', email: 'someone@gmail.com', app_metadata: {} },
  'jwt-inactive': { id: 'u-inact', email: 'gone@mo-care.com', app_metadata: {} },
  'jwt-ended':    { id: 'u-ended', email: 'left@mo-care.com', app_metadata: {} },
  'jwt-otherhub': { id: 'u-other', email: 'team@mo-care.com', app_metadata: { hub_access: ['team_hub'] } },
  'jwt-norole':   { id: 'u-norole', email: 'norole@mo-care.com', app_metadata: {} },
  'jwt-oddrole':  { id: 'u-odd', email: 'odd@mo-care.com', app_metadata: {} },
}
let T, reads, sent, identityBroken
const reset = () => {
  T = {
    auth_identities: [['u-owner', 'p-owner'], ['u-coord', 'p-coord'], ['u-staff', 'p-staff'], ['u-inact', 'p-inact'], ['u-ended', 'p-ended'], ['u-other', 'p-owner2'], ['u-norole', 'p-norole'], ['u-odd', 'p-odd']]
      .map(([a, p]) => ({ auth_user_id: a, person_id: p, project_ref: 'zngsgedlsxinbygwmxwn' })),
    persons: [['p-owner', true, 'Olive Owner'], ['p-coord', true, 'Cora Coord'], ['p-staff', true, 'Stan Staffing'], ['p-inact', false, 'Ina Active'], ['p-ended', true, 'Ed Ended'], ['p-owner2', true, 'Otto Other'], ['p-norole', true, 'Nora Norole'], ['p-odd', true, 'Oda Odd']]
      .map(([person_id, active, full_name]) => ({ person_id, active, full_name })),
    entity_memberships: ['p-owner', 'p-coord', 'p-staff', 'p-inact', 'p-ended', 'p-owner2', 'p-norole', 'p-odd']
      .map((p) => ({ person_id: p, entity: 'cc_ihs', active: true, ended_at: p === 'p-ended' ? '2026-01-01' : null })),
    staff_roles: [['p-owner', 'owner_admin'], ['p-coord', 'care_coordinator'], ['p-staff', 'staffing_coordinator'], ['p-inact', 'owner_admin'], ['p-ended', 'owner_admin'], ['p-owner2', 'owner_admin'], ['p-odd', 'caregiver']]
      .map(([person_id, role]) => ({ person_id, role, entity: 'cc_ihs' })),
    care_circles: [{ id: 'circle-1', client_name: 'Test Client', axiscare_client_id: '999', active: true }],
    circle_contacts: [{ id: 1, circle_id: 'circle-1', name: 'Test Daughter', phone: '4175550100', sms_consent: true, wants_general: true, wants_changes: true }],
    circle_messages: [],
  }
  reads = []; sent = []; identityBroken = false
}
const IDENTITY = new Set(['auth_identities', 'persons', 'entity_memberships', 'staff_roles'])
const q = (t) => { const st = { f: [] }; const b = {
  select() { return b; }, order() { return b; }, limit() { return b; }, in() { return b; }, contains() { return b; }, not() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; },
  insert(row) { reads.push(t + ':insert'); (T[t] ||= []).push(row); return Promise.resolve({ data: null, error: null }); },
  single() { return b.maybeSingle(); },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })); },
  then(ok) {
    reads.push(t)
    if (IDENTITY.has(t) && identityBroken) return Promise.resolve({ data: null, error: { message: 'down' } }).then(ok)
    let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v)
    if (t === 'app_data') rows = []
    return Promise.resolve({ data: rows, error: null }).then(ok)
  } }; return b; };
globalThis.__db = { from: q, rpc: async () => ({ data: null, error: null }),
  auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: USERS[jwt] }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } } } };
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  sent.push({ url, body })
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C1', dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) return new Response('{}', { status: 200 })
  if (url.includes('axiscare')) return new Response(JSON.stringify({ results: { clients: [], nextPage: null } }), { status: 200 })
  if (url.includes('library.json')) return new Response('[]', { status: 200 })
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HT_ORDER_TOKEN: PUBLIC_TOKEN,
  HT_SUPPORT_TOKEN: PUBLIC_TOKEN, AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', CAMPAIGN_CRON_SECRET: CRON }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); } return handler; };
const call = async (h, { url, jwt, headers = {}, body = {} }) => {
  const hd = { 'Content-Type': 'application/json', ...headers }; if (jwt) hd.Authorization = 'Bearer ' + jwt
  const r = await h(new Request(url, { method: 'POST', headers: hd, body: JSON.stringify(body) }))
  let j = null; try { j = await r.json() } catch { /* */ }
  return { status: r.status, j }
}
const onlyIdentity = () => reads.every((t) => IDENTITY.has(t))
const nothingSent = () => sent.length === 0
const leaks = (j) => /recipients|would_reach|email|phone/i.test(JSON.stringify(j?.recipients ?? j?.would_reach ?? '')) || !!(j && (j.recipients || j.would_reach))

/* ── campaign-auto: audience lookup and the scheduled run ── */
const A = await load('campaign-auto'); const AU = 'https://x.supabase.co/functions/v1/campaign-auto'
reset(); let r = await call(A, { url: AU + '?resolve=clients' })
ck('audience lookup, nobody signed in: refused (401) before ANY table read or outbound call', r.status === 401 && reads.length === 0 && nothingSent() && !leaks(r.j), [r, reads])
reset(); r = await call(A, { url: AU + '?token=' + PUBLIC_TOKEN + '&resolve=clients' })
ck('audience lookup with the old public page token: refused (401), nothing read', r.status === 401 && reads.length === 0 && nothingSent() && !leaks(r.j), [r, reads])
reset(); r = await call(A, { url: AU + '?token=' + PUBLIC_TOKEN + '&resolve=clients', jwt: 'anon-public-key-jwt' })
ck('audience lookup with the public anon key as a sign-in: refused (401)', r.status === 401 && onlyIdentity() && nothingSent(), [r, reads])
reset(); r = await call(A, { url: AU + '?resolve=clients', jwt: 'jwt-nobody' })
ck('audience lookup by a signed-in account that is not staff: refused (403), only the identity check was read', r.status === 403 && onlyIdentity() && nothingSent() && !leaks(r.j), [r, reads])
for (const [who, label] of [['jwt-coord', 'a care coordinator'], ['jwt-staffing', 'a staffing coordinator']]) {
  reset(); r = await call(A, { url: AU + '?auth_check=1', jwt: who })
  ck(`audience lookup check by ${label}: permitted (every office role, her decision 2026-09-27), nothing read or sent`, r.status === 200 && r.j?.authorized === 'staff' && onlyIdentity() && nothingSent(), [r, reads])
}
for (const [who, label] of [['jwt-norole', 'an active staff member with NO role'], ['jwt-oddrole', 'someone whose only role is not an office role']]) {
  reset(); r = await call(A, { url: AU + '?resolve=clients', jwt: who })
  ck(`audience lookup by ${label}: refused (403), no audience read`, r.status === 403 && onlyIdentity() && nothingSent(), [r, reads])
}
reset(); r = await call(A, { url: AU + '?resolve=clients', jwt: 'jwt-otherhub' })
ck('an owner whose account is limited to another hub: refused (403)', r.status === 403 && onlyIdentity(), r)
reset(); r = await call(A, { url: AU + '?auth_check=1', jwt: 'jwt-owner' })
ck('audience lookup check by an owner/admin: permitted, and the check reads no audience and sends nothing', r.status === 200 && r.j?.authorized === 'staff' && onlyIdentity() && nothingSent(), [r, reads])
reset(); r = await call(A, { url: AU + '?resolve=clients', jwt: 'jwt-owner' })
ck('a real lookup by an owner/admin goes past the door (reaches the campaign settings)', ![401, 403].includes(r.status) && reads.includes('app_data') && !/sign in|role/i.test(JSON.stringify(r.j)), [r, reads])
reset(); r = await call(A, { url: AU, jwt: 'jwt-owner' })
ck('an owner/admin cannot run the scheduled SEND from a browser (403), nothing read or sent', r.status === 403 && onlyIdentity() && nothingSent(), [r, reads])
reset(); r = await call(A, { url: AU + '?auth_check=1', headers: { 'x-cron-secret': CRON } })
ck('the scheduled run with the server-only secret: permitted (check reads nothing)', r.status === 200 && r.j?.authorized === 'server' && reads.length === 0 && nothingSent(), [r, reads])
reset(); r = await call(A, { url: AU, headers: { 'x-cron-secret': CRON } })
ck('the scheduled run itself goes through (reaches the settings)', ![401, 403].includes(r.status) && reads.includes('app_data'), [r, reads])
for (const [label, hdr] of [['a wrong secret', 'x'.repeat(48)], ['the public page token as the secret', PUBLIC_TOKEN], ['an empty secret', '']]) {
  reset(); r = await call(A, { url: AU, headers: { 'x-cron-secret': hdr } })
  ck(`the scheduled path with ${label}: refused (401), nothing read or sent`, r.status === 401 && reads.length === 0 && nothingSent(), [r, reads])
}
ENV.CAMPAIGN_CRON_SECRET = 'short'; reset(); r = await call(A, { url: AU, headers: { 'x-cron-secret': 'short' } }); ENV.CAMPAIGN_CRON_SECRET = CRON
ck('a server secret shorter than 32 characters is never accepted', r.status === 401 && reads.length === 0, r)
delete ENV.CAMPAIGN_CRON_SECRET; reset(); r = await call(A, { url: AU, headers: { 'x-cron-secret': '' } }); ENV.CAMPAIGN_CRON_SECRET = CRON
ck('if the server secret is not set at all, the scheduled path is closed (never "empty equals empty")', r.status === 401 && reads.length === 0, r)
reset(); let pre = await A(new Request(AU, { method: 'OPTIONS' }))
ck('the browser pre-check (OPTIONS) is answered with CORS, so the Hub can call it', pre.status === 200 && pre.headers.get('access-control-allow-headers')?.includes('authorization') && reads.length === 0)

/* ── campaign-send: manual campaign send ── */
const S = await load('campaign-send'); const SU = 'https://x.supabase.co/functions/v1/campaign-send'
const relay = { subject: 'Hello', html: '<p>anything</p>', recipients: [{ email: 'victim@example.com', name: 'V' }] }
reset(); r = await call(S, { url: SU, body: relay })
ck('manual send, nobody signed in: refused (401) before GHL is touched (cannot be used as an email relay)', r.status === 401 && nothingSent() && reads.length === 0, [r, sent])
reset(); r = await call(S, { url: SU + '?token=' + PUBLIC_TOKEN, body: relay })
ck('manual send with the old public page token: refused (401), nothing sent', r.status === 401 && nothingSent(), [r, sent])
reset(); r = await call(S, { url: SU + '?token=' + PUBLIC_TOKEN, jwt: 'jwt-nobody', body: relay })
ck('manual send by a signed-in account that is not staff: refused (403), nothing sent', r.status === 403 && nothingSent() && onlyIdentity(), [r, sent])
for (const [who, label] of [['jwt-coord', 'a care coordinator'], ['jwt-staffing', 'a staffing coordinator']]) {
  reset(); r = await call(S, { url: SU, jwt: who, body: { auth_check: true } })
  ck(`manual send check by ${label}: permitted, nothing sent`, r.status === 200 && r.j?.authorized === true && nothingSent(), r)
}
for (const who of ['jwt-norole', 'jwt-oddrole']) {
  reset(); r = await call(S, { url: SU, jwt: who, body: relay })
  ck(`manual send by ${who === 'jwt-norole' ? 'a staff member with no role' : 'a non-office role'}: refused (403), nothing sent`, r.status === 403 && nothingSent(), r)
}
for (const who of ['jwt-inactive', 'jwt-ended']) {
  reset(); r = await call(S, { url: SU, jwt: who, body: relay })
  ck(`manual send by an owner/admin whose staff record is ${who === 'jwt-inactive' ? 'inactive' : 'ended'}: refused (403)`, r.status === 403 && nothingSent(), r)
}
reset(); identityBroken = true; r = await call(S, { url: SU, jwt: 'jwt-owner', body: relay })
ck('if the permission tables cannot be read, it refuses (fail closed), nothing sent', r.status === 500 && nothingSent(), r)
reset(); r = await call(S, { url: SU, jwt: 'jwt-owner', body: { auth_check: true } })
ck('manual send check by an owner/admin: permitted, and nothing is sent', r.status === 200 && r.j?.authorized === true && nothingSent(), [r, sent])
reset(); r = await call(S, { url: SU, jwt: 'jwt-owner', body: { subject: 'Synthetic', html: '<p>x</p>', recipients: [{ email: 'synthetic@example.test', name: 'Syn' }] } })
ck('a real send by an owner/admin goes through (synthetic address, fake GHL)', r.status === 200 && r.j?.sent === 1 && sent.some((s) => s.url.includes('/conversations/messages')), r)

/* ── circle-send: Family Circle ── */
const C = await load('circle-send'); const CU = 'https://x.supabase.co/functions/v1/circle-send'
const msg = { circle_id: 'circle-1', kind: 'update', body: 'Test', sent_by: 'Somebody Else' }
reset(); r = await call(C, { url: CU, body: { ...msg, dry: true } })
ck('Family Circle, nobody signed in, with a REAL circle id: refused (401) before the circle is read; no preview, nothing sent', r.status === 401 && reads.length === 0 && nothingSent() && !leaks(r.j), [r, reads])
reset(); r = await call(C, { url: CU + '?token=' + PUBLIC_TOKEN, body: msg })
ck('Family Circle with the public page token: refused (401), nothing sent', r.status === 401 && reads.length === 0 && nothingSent(), r)
reset(); r = await call(C, { url: CU, jwt: 'jwt-nobody', body: { ...msg, dry: true } })
ck('Family Circle by a signed-in account that is not staff: refused (403); the circle is never read', r.status === 403 && onlyIdentity() && nothingSent() && !leaks(r.j), [r, reads])
reset(); r = await call(C, { url: CU, jwt: 'jwt-staffing', body: { circle_id: 'circle-1', auth_check: true } })
ck('Family Circle check by a staffing coordinator: permitted, nothing read or sent', r.status === 200 && r.j?.authorized === true && onlyIdentity() && nothingSent(), r)
reset(); r = await call(C, { url: CU, jwt: 'jwt-norole', body: msg })
ck('Family Circle by a staff member with no role: refused (403); the circle is never read', r.status === 403 && onlyIdentity() && nothingSent(), r)
reset(); r = await call(C, { url: CU, jwt: 'jwt-coord', body: { circle_id: 'circle-1', auth_check: true } })
ck('Family Circle check by a care coordinator: permitted; the circle is not read and nothing is sent', r.status === 200 && r.j?.authorized === true && onlyIdentity() && nothingSent(), [r, reads])
reset(); r = await call(C, { url: CU, jwt: 'jwt-owner', body: { ...msg, dry: true } })
ck('Family Circle preview (dry) by an owner/admin works as before, and sends nothing', r.status === 200 && r.j?.dry === true && nothingSent(), r)
reset(); r = await call(C, { url: CU, jwt: 'jwt-coord', body: msg })
ck('a real Family Circle send by a care coordinator goes through, and the sender recorded is the VERIFIED person, not the name in the request',
   r.status === 200 && T.circle_messages[0]?.sent_by === 'Cora Coord', [r, T.circle_messages])

console.log('\nSECURITY SLICE · CAMPAIGNS + FAMILY CIRCLE · TEST\n' + '='.repeat(60)); let all = true
for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
