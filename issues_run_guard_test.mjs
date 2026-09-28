// issues-run: office staff or a server caller only; CORS for the Hub (2026-09-28). The REAL function + REAL staff
// check against a fake database. node issues_run_guard_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 500)])
let TOUCHED
const SVC = 'svc-key-' + 'x'.repeat(30)
const T = { auth_identities: [['u-s', 'p-s'], ['u-c', 'p-c']].map(([a, p]) => ({ auth_user_id: a, project_ref: 'zngsgedlsxinbygwmxwn', person_id: p })),
  persons: ['p-s', 'p-c'].map((p) => ({ person_id: p, full_name: p, active: true })),
  entity_memberships: ['p-s', 'p-c'].map((p) => ({ person_id: p, entity: 'cc_ihs', active: true, ended_at: null })),
  staff_roles: [{ person_id: 'p-s', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p-c', entity: 'cc_ihs', role: 'caregiver' }] }
const STAFF = new Set(['auth_identities', 'persons', 'entity_memberships', 'staff_roles'])
const q = (t) => { if (!STAFF.has(t)) TOUCHED.push(t); const st = { f: [] }; const b = { select() { return b }, in() { return b }, order() { return b }, limit() { return b }, lt() { return b }, lte() { return b }, gte() { return b }, not() { return b }, is() { return b }, neq() { return b }, ilike() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, insert() { return b }, update() { return b }, upsert() { return b }, delete() { return b }, single() { return b.maybeSingle() },
  maybeSingle() { return b.then((x) => ({ data: x.data[0] ?? null, error: null })) },
  then(ok) { let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v); return Promise.resolve({ data: rows, error: null, count: 0 }).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async (fn) => { TOUCHED.push('rpc:' + fn); return { data: [], error: null } },
  auth: { getUser: async (jwt) => jwt === 'staff' ? { data: { user: { id: 'u-s', email: 's@mo-care.com', app_metadata: {} } }, error: null }
                                : jwt === 'cg' ? { data: { user: { id: 'u-c', email: 'c@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
globalThis.fetch = async () => new Response('{}', { status: 200 })
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: SVC }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_ir_'))
try {
  const src = fs.readFileSync(path.join(F, 'issues-run/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.resolve(F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'ir.ts'), src); await import(path.join(tmp, 'ir.ts'))
  const call = async (mode, tok, method = 'POST') => { TOUCHED = []; const r = await handler(new Request('https://x/functions/v1/issues-run?' + mode, { method,
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: method === 'POST' ? JSON.stringify({ category: 'needs_triage', summary: 'x', client_name: 'Proof' }) : undefined }))
    return { status: r.status, cors: r.headers.get('access-control-allow-origin'), touched: TOUCHED } }
  const svcJwt = 'e.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.s'
  let r = await call('', null, 'OPTIONS'); ck('the browser pre-check is answered with CORS headers (the Hub could not save before)', r.status === 200 && r.cors === '*', r)
  r = await call('intake=1', null); ck('no sign-in: filing a concern is refused (401), nothing touched', r.status === 401 && !r.touched.length, r)
  r = await call('intake=1', 'public-anon-key'); ck('the public page key: refused (401), nothing touched', r.status === 401 && !r.touched.length, r)
  r = await call('action=1', null); ck('no sign-in: acting on / resolving an issue is refused', r.status === 401 && !r.touched.length, r)
  r = await call('intake=1', 'cg'); ck('a caregiver account: refused (403)', r.status === 403 && !r.touched.length, r)
  r = await call('intake=1', 'staff'); ck('office staff by their own sign-in: reaches the intake, and the answer carries CORS', r.status !== 401 && r.status !== 403 && r.touched.length > 0 && r.cors === '*', r)
  r = await call('intake=1', SVC); ck('the server key (phone-call concerns from call-disposition): reaches the intake', r.status !== 401 && r.touched.length > 0, r)
  r = await call('intake=1', svcJwt); ck('a platform-verified service sign-in: reaches the intake', r.status !== 401 && r.touched.length > 0, r)
  r = await call('sweep=1&commit=1', 'staff'); ck('the sweep is server-only: staff refused', r.status === 401 && !r.touched.length, r)
  r = await call('scenarios=1', 'staff'); ck('the test scenarios are server-only: staff refused', r.status === 401 && !r.touched.length, r)
  r = await call('scenarios=1', null); ck('the test scenarios with no sign-in: refused', r.status === 401 && !r.touched.length, r)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
