// partner-revenue (2026-10-26): the REAL function with a fake database, fake sign-in and fake AxisCare.
// Owners only; completed visits × each visit's charge rate; unread never counts as $0; read only. node partner_revenue_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_pr_'))
let T, WRITES, AXCALLS, AXDOWN
const ORGS = [{ id: 'jane', name: 'Ozark Senior Moves', partner_code: 'JANE-K7' }, { id: 'cox', name: 'CoxHealth' }, { id: 'old', name: 'Old', partner_code: 'OLD-11', archived: true }]
const LEADS = [
  { id: 'l1', referral_org_id: 'jane', axiscare_client_id: '901', first_shift_at: '2026-10-20T14:00:00Z' },
  { id: 'l2', referral_org_id: 'jane', axiscare_client_id: '902', first_shift_at: '2026-10-22T14:00:00Z' },
  { id: 'l3', referral_org_id: 'jane', axiscare_client_id: '903' },                                   // not started
  { id: 'l4', referral_org_id: 'cox', axiscare_client_id: '904', first_shift_at: '2026-10-21T14:00:00Z' },   // not a program partner
  { id: 'l5', referral_org_id: 'jane', axiscare_client_id: '905', first_shift_at: '2026-10-21T14:00:00Z', spam: { at: 'x' } },
  { id: 'l6', referral_org_id: 'jane', axiscare_client_id: '901', first_shift_at: '2026-10-20T14:00:00Z', archived: true, duplicate_of: 'l1' },
  { id: 'l7', referral_org_id: 'jane', axiscare_client_id: '906', first_shift_at: '2026-10-23T14:00:00Z' },   // AxisCare fails for this one
  { id: 'l8', referral_org_id: 'old', axiscare_client_id: '907', first_shift_at: '2026-10-23T14:00:00Z' },
]
const V = (cid, inn, out, rate, type = 'Hourly', extra = {}) => Object.assign({ client: { id: cid }, clockIn: inn ? { time: inn } : null, clockOut: out ? { time: out } : null, chargeRate: rate, type }, extra)
const VISITS = {
  '901': [V(901, '2026-10-20T14:00:00Z', '2026-10-20T18:00:00Z', 32), V(901, '2026-10-21T14:00:00Z', '2026-10-21T18:30:00Z', 32),
          V(901, '2026-10-22T14:00:00Z', null, 32), V(901, '2026-10-23T14:00:00Z', '2026-10-23T18:00:00Z', 32, 'Hourly', { removed: true }),
          V(901, '2026-10-19T14:00:00Z', '2026-10-19T18:00:00Z', 32)],                       // before the first shift: not counted
  '902': [V(902, '2026-10-22T14:00:00Z', '2026-10-22T18:00:00Z', null), V(902, '2026-10-23T08:00:00Z', '2026-10-24T08:00:00Z', 300, 'Daily')],
}
const reset = (o = {}) => {
  T = { app_data: [{ key: 'leads', data: LEADS }, { key: 'referral_orgs', data: ORGS }],
    auth_identities: [{ auth_user_id: 'u-sam', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-sam' }, { auth_user_id: 'u-kry', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-kry' }],
    persons: [{ person_id: 'p-sam', full_name: 'Samantha', active: true }, { person_id: 'p-kry', full_name: 'Krystal', active: true }],
    entity_memberships: [{ person_id: 'p-sam', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-kry', entity: 'cc_ihs', active: true, ended_at: null }],
    staff_roles: [{ person_id: 'p-sam', entity: 'cc_ihs', role: 'owner_admin' }, { person_id: 'p-kry', entity: 'cc_ihs', role: 'care_coordinator' }] }
  WRITES = []; AXCALLS = []; AXDOWN = o.axDown || new Set(['906'])
}
function q(t) {
  const st = { f: [], single: false }
  const run = () => { const rows = (T[t] || []).filter((r) => st.f.every(([k, v]) => String(r[k]) === String(v))); return { data: st.single ? (rows[0] ?? null) : rows, error: null } }
  const b = new Proxy({}, { get: (_, k) => {
    if (k === 'then') return (ok, ko) => Promise.resolve(run()).then(ok, ko)
    if (k === 'eq') return (a, v) => { st.f.push([a, v]); return b }
    if (['insert', 'upsert', 'update', 'delete'].includes(k)) return (r) => { WRITES.push([t, k, r]); return b }
    if (k === 'single' || k === 'maybeSingle') return () => { st.single = true; return Promise.resolve(run()) }
    return () => b } })
  return b
}
globalThis.__db = { from: q, rpc: async (...a) => { WRITES.push(['rpc', ...a]); return { data: null, error: null } },
  auth: { getUser: async (jwt) => ({ data: { user: jwt === 'sam' ? { id: 'u-sam', email: 'samantha@mo-care.com', app_metadata: {} } : jwt === 'kry' ? { id: 'u-kry', email: 'krystal@mo-care.com', app_metadata: {} } : null }, error: jwt === 'sam' || jwt === 'kry' ? null : { message: 'bad' } }) } }
globalThis.fetch = async (url) => { url = String(url); const m = /clientIds=(\d+)/.exec(url)
  if (/axiscare\.com\/api\/visits/.test(url) && m) { AXCALLS.push(url); if (AXDOWN.has(m[1])) return new Response('{}', { status: 500 }); return new Response(JSON.stringify({ results: { visits: VISITS[m[1]] || [], nextPage: null } }), { status: 200 }) }
  return new Response('{}', { status: 404 }) }
const ENV = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 'ax', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
try {
  const src = fs.readFileSync(path.join(F, 'partner-revenue/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'pr.ts'), src); await import(path.join(tmp, 'pr.ts'))
  const post = async (jwt, qs = '') => { const h = { 'Content-Type': 'application/json' }; if (jwt) h.Authorization = 'Bearer ' + jwt
    const r = await handler(new Request('http://x/partner-revenue' + qs, { method: 'POST', headers: h, body: '{}' })); return { s: r.status, j: await r.json() } }

  reset(); let r = await post(null)
  ck('nobody signed in: refused, AxisCare never asked', r.s === 401 && !AXCALLS.length, r)
  r = await post('kry')
  ck('a Care Coordinator: refused ("Only Samantha or Zachary can see billed revenue"), AxisCare never asked', r.s === 403 && /Only Samantha or Zachary/.test(r.j.error) && !AXCALLS.length, r)
  r = await post('sam', '?auth_check=1')
  ck('an owner\'s auth check says who, reads nothing', r.s === 200 && r.j.who === 'samantha@mo-care.com' && !AXCALLS.length, r)
  r = await post('sam'); const J = r.j.partners && r.j.partners.jane
  ck('an owner: one row for Jane; CoxHealth (not in the program), the archived partner and spam are left out', r.s === 200 && Object.keys(r.j.partners).join() === 'jane', r.j)
  ck('...clients read: 901, 902 and 906 once each (not the duplicate, not the one that hasn\'t started)', AXCALLS.length === 3 && J.clients === 3, [AXCALLS, J])
  const PR = await import(path.join(process.cwd(), F, '_shared', 'partner-revenue.ts'))
  const b901 = PR.billedFrom(VISITS['901'], '901', '2026-10-20', '2026-10-26')
  ck('...901: 8.5 completed hours from the first shift on (not the open, removed or earlier visits), $272.00', b901.visits === 2 && b901.hours === 8.5 && b901.billed === 272 && b901.no_rate_visits === 0, b901)
  ck('...902: an hourly visit with no rate (hours counted, flagged) plus a daily visit at its $300 rate', J.no_rate_clients === 1, J)
  ck('...totals: 4 completed visits from 2 clients read, 36.5 hours, $572.00 billed (estimate)', J.read === 2 && J.visits === 4 && J.hours === 36.5 && J.billed === 572, J)
  ck('...AxisCare not readable for 906: counted as unread, never as $0', J.unread === 1, J)
  ck('...it says what the number is: visits times rates, not invoices or payments', /not invoices or payments/.test(r.j.basis) && r.j.through, r.j)
  ck('read only: nothing written anywhere', WRITES.length === 0, WRITES)
  reset({ axDown: new Set(['901', '902', '906']) }); r = await post('sam')
  ck('AxisCare down for everyone: every client unread, billed 0 with read 0 (the screen shows "couldn\'t read")', r.j.partners.jane.read === 0 && r.j.partners.jane.unread === 3, r.j)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
