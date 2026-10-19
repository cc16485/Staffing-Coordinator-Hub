// lead-digest (the morning brief): supervisory visits are concern-only from 2026-11-16 (her decision 2026-10-18), so the
// "supervisory visits past due" line stops that day (Central). The REAL function against a fake database and fake
// GoHighLevel, with the clock pinned either side of the day. node supervisory_digest_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 600)])
let T, MAIL, CALLS
const reset = () => { MAIL = []; CALLS = []; T = {
  app_data: [{ key: 'leads', data: [{ id: 'l1', name: 'Pat Lead', phone: '4175551234', status: 'New', follow_up_due: '2000-01-01' }] },
    { key: 'ops_settings', data: { morning_brief_recipients: [{ name: 'Samantha', email: 'samantha@mo-care.com', admin: true }, { name: 'Krystal', email: 'krystal@mo-care.com', admin: false }] } },
    { key: 'supervisory_visits', data: [{ id: 'sv1', caregiver_name: 'Ann Able', client_name: 'Mae', visit_date: '2025-01-05', due_date: '2026-01-05', status: 'Completed' }] },
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
const JOBSEC = 'j'.repeat(64)   // J1: the schedule's vault secret
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HUB_JOB_SECRET: JOBSEC }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_ld_'))
try {
  /* J1: the shared lock, with its database probe answered "no" (no key here is the owner's) */
  fs.writeFileSync(path.join(tmp, 'job-auth.ts'), fs.readFileSync(path.join(F, '_shared/job-auth.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, "const createClient = () => ({ from: () => ({ select: () => ({ limit: async () => ({ error: { message: 'denied' } }) }) }) })")
    .replace("from './staff-auth.ts'", "from '" + path.resolve(F, '_shared/staff-auth.ts') + "'"))
  const src = fs.readFileSync(path.join(F, 'lead-digest/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + (m === 'job-auth' ? path.join(tmp, 'job-auth.ts') : path.resolve(F, '_shared', m + '.ts')) + "'")
  fs.writeFileSync(path.join(tmp, 'ld.ts'), src); await import(path.join(tmp, 'ld.ts'))
  const call = async (qs, jwt, extra = {}) => { const r = await handler(new Request('https://x/functions/v1/lead-digest' + qs, { headers: { ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}), ...extra } }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
  const RealDate = Date
  const pinAt = (iso) => { const t = new RealDate(iso).getTime(); globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [t])) } static now() { return t } } }
  const brief = async (iso) => { pinAt(iso); try { reset(); const r = await call('?to=samantha%40mo-care.com&force=1', 's'); return { r, html: (MAIL[0] || {}).html || '' } } finally { globalThis.Date = RealDate } }
  let b = await brief('2026-11-13T14:00:00Z')
  ck('Fri Nov 13: the old visit is still past due in the brief', b.r.status === 200 && /1 supervisory visit past due/.test(b.html), { s: b.r.status, j: b.r.j })
  b = await brief('2026-11-16T05:30:00Z')
  ck('Nov 15, 11:30pm Central: still yearly', /1 supervisory visit past due/.test(b.html), b.r.j)
  b = await brief('2026-11-16T14:00:00Z')
  ck('Mon Nov 16: no supervisory line', b.r.status === 200 && b.html.length > 500 && !/supervisory visit/i.test(b.html), { s: b.r.status, j: b.r.j })
  b = await brief('2027-02-01T14:00:00Z')
  ck('2027: still none', !/supervisory visit/i.test(b.html))
  const s = fs.readFileSync(path.join(F, 'lead-digest/index.ts'), 'utf8')
  ck('the day matches the Hub rules file (eligibility-rules.js SUPERVISORY_CONCERN_FROM)', /SUPERVISORY_CONCERN_FROM = '2026-11-16'/.test(s))
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
