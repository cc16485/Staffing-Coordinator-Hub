// lead-digest (the morning brief): test/forced briefs need the caller's own Hub sign-in (2026-09-28).
// The REAL function + REAL staff check against a fake database and fake GoHighLevel. node lead_digest_auth_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 600)])
let T, MAIL, CALLS
const reset = () => { MAIL = []; CALLS = []; T = {
  app_data: [{ key: 'leads', data: [{ id: 'l1', name: 'Pat Lead', phone: '4175551234', status: 'New', follow_up_due: '2000-01-01' }] },
    { key: 'ops_settings', data: { morning_brief_recipients: [{ name: 'Samantha', email: 'samantha@mo-care.com', admin: true }, { name: 'Krystal', email: 'krystal@mo-care.com', admin: false }] } },
    { key: 'coordinator_staff', data: [{ name: 'Angiel Staff', email: 'angiel@mo-care.com' }] }],
  auth_identities: [['u-s', 'p-s'], ['u-k', 'p-k'], ['u-a', 'p-a'], ['u-c', 'p-c']].map(([a, p]) => ({ auth_user_id: a, project_ref: 'zngsgedlsxinbygwmxwn', person_id: p })),
  persons: ['p-s', 'p-k', 'p-a', 'p-c'].map((p) => ({ person_id: p, full_name: p, active: true })),
  entity_memberships: ['p-s', 'p-k', 'p-a', 'p-c'].map((p) => ({ person_id: p, entity: 'cc_ihs', active: true, ended_at: null })),
  staff_roles: [{ person_id: 'p-s', entity: 'cc_ihs', role: 'owner_admin' }, { person_id: 'p-k', entity: 'cc_ihs', role: 'care_coordinator' },
    { person_id: 'p-a', entity: 'cc_ihs', role: 'staffing_coordinator' }, { person_id: 'p-c', entity: 'cc_ihs', role: 'caregiver' }] } }
const USERS = { s: ['u-s', 'samantha@mo-care.com'], k: ['u-k', 'krystal@mo-care.com'], a: ['u-a', 'angiel@mo-care.com'], c: ['u-c', 'cg@mo-care.com'] }
const q = (t) => { const st = { f: [] }; const b = { select() { return b }, in() { return b }, order() { return b }, limit() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, maybeSingle() { return b.then((x) => ({ data: x.data[0] ?? null, error: null })) },
  then(ok) { let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v); return Promise.resolve({ data: rows, error: null }).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async () => ({ error: null }),
  auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: { id: USERS[jwt][0], email: USERS[jwt][1], app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
globalThis.fetch = async (url, o) => { url = String(url); CALLS.push(url); const body = o?.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + body.email, email: body.email } }), { status: 200 })
  if (url.includes('/conversations/messages')) { MAIL.push({ to: body.contactId.slice(2), subject: body.subject, html: body.html }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 404 }) }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_ld_'))
try {
  const src = fs.readFileSync(path.join(F, 'lead-digest/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.resolve(F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'ld.ts'), src); await import(path.join(tmp, 'ld.ts'))
  const call = async (qs, jwt) => { const r = await handler(new Request('https://x/functions/v1/lead-digest' + qs, { headers: jwt ? { Authorization: 'Bearer ' + jwt } : {} }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
  reset(); let r = await call('?to=outsider%40evil.test&force=1')
  ck('no sign-in, ?to= an outside address: refused (401), no email, nothing read from GoHighLevel', r.status === 401 && !MAIL.length && !CALLS.length, r)
  reset(); r = await call('?to=outsider%40evil.test&force=1', 'public-anon-key'); ck('the public page key: refused (401), no email', r.status === 401 && !MAIL.length, r)
  reset(); r = await call('?force=1'); ck('?force=1 alone (everyone, early) without a sign-in: refused', r.status === 401 && !MAIL.length, r)
  reset(); r = await call('?to=outsider%40evil.test', 'k'); ck('signed-in staff sending a test brief to SOMEONE ELSE: refused (403), no email', r.status === 403 && !MAIL.length, r)
  reset(); r = await call('?to=samantha%40mo-care.com', 'c'); ck('a caregiver account (no office role): refused (403)', r.status === 403 && !MAIL.length, r)
  reset(); r = await call('?to=krystal%40mo-care.com&force=1', 'k')
  ck('staff test brief to their own email: exactly one email, to them, personal edition', r.status === 200 && MAIL.length === 1 && MAIL[0].to === 'krystal@mo-care.com' && !MAIL[0].html.includes('Full Picture'), { r, MAIL: MAIL.map((m) => m.to) })
  reset(); r = await call('?to=samantha%40mo-care.com&force=1', 's'); ck('the listed admin gets the Full Picture edition', MAIL.length === 1 && MAIL[0].html.includes('Full Picture'), MAIL.map((m) => m.to))
  reset(); r = await call('?to=angiel%40mo-care.com&force=1', 'a'); ck('office staff NOT on the recipient list get the personal edition, never admin (it used to default to admin)', MAIL.length === 1 && !MAIL[0].html.includes('Full Picture'), MAIL.map((m) => m.to))
  reset(); r = await call('')
  ck('the plain scheduled run still needs no sign-in, and only ever mails the configured recipients', r.status === 200 && (r.j.status === 'outside the morning window' || r.j.status === 'already sent today' ||
     MAIL.every((m) => ['samantha@mo-care.com', 'krystal@mo-care.com'].includes(m.to))), { r, MAIL: MAIL.map((m) => m.to) })
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
