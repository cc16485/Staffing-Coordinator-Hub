// bonus_separation_test.mjs · bonuses when a Care Coordinator leaves (audit step 5, Samantha 2026-10-18; decision 3 still
// open, so it only lists): the REAL cc-bonus against a fake database, a fake AxisCare and a controllable clock. Made-up
// people only; nothing leaves this machine. node bonus_separation_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
let NOW = Date.parse('2026-11-10T18:00:00Z')
const RealDate = Date
class FakeDate extends RealDate { constructor(...a) { if (!a.length) super(NOW); else super(...a) } static now() { return NOW } }
globalThis.Date = FakeDate
const at = (iso) => { NOW = RealDate.parse(iso) }
const S = 'sam@mo-care.com', Z = 'zach@mo-care.com', K = 'kry@mo-care.com', A = 'ang@mo-care.com'
const PEOPLE = [['p-s', 'Samantha Troutman', S, 'owner_admin'], ['p-z', 'Zach Troutman', Z, 'owner_admin'], ['p-k', 'Krystal Land', K, 'care_coordinator'], ['p-a', 'Angiel Rose', A, 'care_coordinator']]
const JWT = { sam: ['u-s', S], zach: ['u-z', Z], kry: ['u-k', K], ang: ['u-a', A] }
let T, APP, VIS
const visit = (ax, day, hours, extra) => ({ id: ax + day, client: { id: ax }, clockIn: { time: day + 'T15:00:00Z' }, clockOut: { time: new RealDate(RealDate.parse(day + 'T15:00:00Z') + hours * 36e5).toISOString() }, ...(extra || {}) })
const days = (from, n, hours, ax) => Array.from({ length: n }, (_, i) => visit(ax, new RealDate(RealDate.parse(from + 'T12:00:00Z') + i * 864e5).toISOString().slice(0, 10), hours))
const reset = (live = true) => {
  APP = { ops_settings: { bonus_live: live, bonus: { decider: S, payroll: K }, lead_rotation: { people: [{ name: 'Krystal', on: true }, { name: 'Angiel', on: false }] } }, cc_bonuses: [], automation_heartbeats: [],
    leads: [
      { id: 'a', first_name: 'Ann', last_name: 'Able', client_first_name: 'Rose', client_last_name: 'Able', funding_source: 'private', status: 'Converted', assigned_coordinator: 'Krystal', original_owner: { name: 'Angiel', at: 'x', how: 'turn' }, first_shift_at: '2026-11-03T15:00:00Z', axiscare_client_id: '101' },
      { id: 'b', first_name: 'Bo', client_first_name: 'Bea', funding_source: 'medicaid', status: 'Converted', assigned_coordinator: 'Krystal', first_shift_at: '2026-11-04T15:00:00Z', axiscare_client_id: '102' },
      { id: 'c', first_name: 'Cy', client_first_name: 'Cal', funding_source: 'private', status: 'Converted', assigned_coordinator: 'Krystal', first_shift_at: '2026-10-20T15:00:00Z', axiscare_client_id: '103' },
      { id: 'd', first_name: 'Di', client_first_name: 'Dot', funding_source: 'private', status: 'Converted', assigned_coordinator: 'Samantha', first_shift_at: '2026-11-03T15:00:00Z', axiscare_client_id: '104' },
      { id: 'e', first_name: 'Ed', client_first_name: 'Eve', funding_source: 'private', status: 'Converted', assigned_coordinator: 'Krystal', first_shift_at: '2026-11-03T15:00:00Z', axiscare_client_id: '105' },
      { id: 'f', first_name: 'Flo', client_first_name: 'Fay', funding_source: 'private', status: 'Converted', assigned_coordinator: 'Krystal', first_shift_at: '2026-11-03T15:00:00Z', axiscare_client_id: '106' },
      { id: 'g', first_name: 'Gus', client_first_name: 'Gil', funding_source: 'private', status: 'Converted', assigned_coordinator: 'Krystal', first_shift_at: '2026-11-03T15:00:00Z', axiscare_client_id: '107' },
      { id: 'n', first_name: 'Nan', funding_source: 'private', status: 'New', assigned_coordinator: 'Krystal' } ] }
  VIS = { 101: [...days('2026-11-03', 6, 4, '101'), visit('101', '2026-11-12', 4, { removed: true })],            /* 24 h by day 30; a removed visit never counts */
    105: days('2026-11-03', 9, 2, '105'),                                                                         /* 18 h: under review */
    106: [visit('106', '2026-09-20', 4), ...days('2026-11-03', 6, 4, '106')],                                      /* care 44 days before: returning */
    107: days('2026-11-03', 6, 4, '107') }
  T = { auth_identities: PEOPLE.map(([p], i) => ({ auth_user_id: Object.values(JWT)[i][0], project_ref: 'zngsgedlsxinbygwmxwn', person_id: p })),
    persons: PEOPLE.map(([p, n, e]) => ({ person_id: p, full_name: n, primary_email: e, active: true })),
    entity_memberships: PEOPLE.map(([p]) => ({ person_id: p, entity: 'cc_ihs', active: true, ended_at: null })),
    staff_roles: PEOPLE.map(([p, , , r]) => ({ person_id: p, entity: 'cc_ihs', role: r })),
    client_journey: [{ subject: 'client', lead_id: 'g', axiscare_client_id: '107', status: 'active', closed_reason: null, updated_at: '2026-11-03T15:00:00Z' }], op_events: [] }
}
const clone = (x) => JSON.parse(JSON.stringify(x))
const q = (t) => { const st = { f: [], ins: [], not: [], op: 'select', row: null }; const run = () => {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]
      if (st.op === 'update') { APP[k] = clone(st.row.data); return { data: [], error: null } }
      return { data: k in APP ? [{ key: k, data: clone(APP[k]) }] : [], error: null } }
    const rows = T[t] ?? (T[t] = [])
    if (st.op === 'insert') { rows.push(...(Array.isArray(st.row) ? st.row : [st.row])); return { data: null, error: null } }
    return { data: clone(rows.filter((r) => st.f.every(([c, v]) => r[c] === v) && st.ins.every(([c, vs]) => vs.includes(r[c])) && st.not.every((c) => r[c] != null))), error: null } }
  const b = { select() { return b }, eq(c, v) { st.f.push([c, v]); return b }, in(c, vs) { st.ins.push([c, vs]); return b }, not(c) { st.not.push(c); return b }, limit() { return b }, order() { return b },
    insert(r) { st.op = 'insert'; st.row = r; return b }, update(r) { st.op = 'update'; st.row = r; return b }, upsert(r) { st.op = 'insert'; st.row = r; return b },
    maybeSingle() { const r = run(); return Promise.resolve({ data: r.data ? r.data[0] ?? null : null, error: r.error }) }, then(ok, no) { return Promise.resolve(run()).then(ok, no) } }; return b }
globalThis.__db = { from: q,
  rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); const it = clone(a.item); if (i >= 0) arr[i] = it; else arr.push(it) } return { data: null, error: null } },
  auth: { getUser: async (jwt) => JWT[jwt] ? { data: { user: { id: JWT[jwt][0], email: JWT[jwt][1], app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
let AXREADS = 0, AXDOWN = false
globalThis.fetch = async (url) => { const u = String(url)
  if (u.includes('.axiscare.com/api/visits')) { AXREADS++; if (AXDOWN) return new Response('{}', { status: 500 })
    const p = new URL(u), id = p.searchParams.get('clientIds'), from = p.searchParams.get('startDate'), to = p.searchParams.get('endDate')
    const vs = (VIS[id] || []).filter((v) => v.clockIn.time.slice(0, 10) >= from && v.clockIn.time.slice(0, 10) <= to)
    return new Response(JSON.stringify({ results: { visits: vs } }), { status: 200 }) }
  return new Response('{}', { status: 404 }) }
const JOBSEC = 'j'.repeat(64)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc_' + 'k'.repeat(60), HUB_JOB_SECRET: JOBSEC, AXISCARE_TOKEN: 'ax', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_ccs_'))
const shared = (s) => s.replace(/from '\.\.\/_shared\/([\w-]+)\.(ts|js)'/g, (_, m, e) => "from '" + path.join(tmp, m + '.' + e) + "'").replace(/from '\.\/([\w-]+)\.(ts|js)'/g, (_, m, e) => "from '" + path.join(tmp, m + '.' + e) + "'")
  .replace(/import '\.\.\/_shared\/([\w-]+)\.js'/g, (_, m) => "import '" + path.join(tmp, m + '.js') + "'")
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
try {
  for (const f of fs.readdirSync(path.join(F, '_shared')).filter((f) => f.endsWith('.ts') || f.endsWith('.js'))) fs.writeFileSync(path.join(tmp, f), shared(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))
  fs.writeFileSync(path.join(tmp, 'fn.ts'), shared(fs.readFileSync(path.join(F, 'cc-bonus/index.ts'), 'utf8')))
  await import(path.join(tmp, 'fn.ts'))
  const cron = async (qs = '') => { const r = await handler(new Request('https://x/fn' + qs, { method: 'POST', headers: { Authorization: 'Bearer eyJanon', 'x-cron-secret': JOBSEC, 'Content-Type': 'application/json' }, body: '{}' })); return { s: r.status, j: await r.json() } }
  const call = async (jwt, body) => { const r = await handler(new Request('https://x/fn', { method: 'POST', headers: { ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json() } }
  const line = (lead) => APP.cc_bonuses.find((x) => x.lead_id === lead)

  reset(true)
  APP.cc_bonuses = [
    { id: 'bonus_a', lead_id: 'a', client: 'Rose Able', recipient: 'Krystal', recipient_email: K, first_visit: '2026-11-03', day30: '2026-12-02', amount: 100, status: 'approved', history: [] },
    { id: 'bonus_e', lead_id: 'e', client: 'Eve', recipient: 'Krystal', recipient_email: K, first_visit: '2026-11-20', day30: '2026-12-19', amount: 100, status: 'on_the_way', hours: 6, day: 5, history: [] },
    { id: 'bonus_f', lead_id: 'f', client: 'Fay', recipient: 'Krystal', recipient_email: K, first_visit: '2026-11-03', day30: '2026-12-02', amount: 100, status: 'not_earned', history: [] },
    { id: 'bonus_g', lead_id: 'g', client: 'Gil', recipient: 'Krystal', recipient_email: K, first_visit: '2026-11-03', day30: '2026-12-02', amount: 100, status: 'paid', paid_on: '2026-12-11', history: [] },
    { id: 'bonus_h', lead_id: 'h', client: 'Hal', recipient: 'Angiel', recipient_email: A, first_visit: '2026-11-04', day30: '2026-12-03', amount: 100, status: 'ready', history: [] } ]
  APP.offboardings_team = [{ id: 'off1', name: 'krystal  land', kind: 'Resignation', last_day: '2026-12-15', status: 'open', created_at: '2026-12-01T15:00:00Z' },
    { id: 'off2', name: 'Kris Caregiver', kind: 'End of assignment / inactive', status: 'open', created_at: '2026-12-01T15:00:00Z' }]
  APP.offboardings = []
  T.persons.find((p) => p.primary_email === K).active = false   /* already switched off when Samantha looks */
  const before = JSON.stringify(APP.cc_bonuses)
  let r = await call('sam', { action: 'separation', name: 'Krystal Land' })
  ck('Samantha · Krystal leaving (already switched off): approved $100 not paid, $100 still running, $100 already paid', r.s === 200 && r.j.office === true && r.j.email === K
    && r.j.approved.total === 100 && r.j.approved.lines[0].client === 'Rose Able' && r.j.running.total === 100 && r.j.running.lines[0].status === 'on_the_way' && r.j.paid.lines[0].paid_on === '2026-12-11', r.j)
  ck('...a bonus marked not earned is not listed, and nothing else (Angiel’s) is', r.j && ![...r.j.approved.lines, ...r.j.running.lines, ...r.j.paid.lines].some((l) => ['bonus_f', 'bonus_h'].includes(l.id)), r.j)
  ck('...it says nothing is paid or cancelled because someone leaves', /Nothing here is paid or cancelled/.test(r.j.note || ''), r.j.note)
  ck('...looking changes nothing', JSON.stringify(APP.cc_bonuses) === before)
  r = await call('zach', { action: 'separation', name: 'Kris Caregiver' })
  ck('a caregiver’s offboarding · office:false, no bonus box', r.s === 200 && r.j.office === false, r.j)
  r = await call('zach', { action: 'separation', name: 'Krystal' })
  ck('a first name alone never matches (only the exact full name)', r.j.office === false, r.j)
  T.persons.find((p) => p.primary_email === K).active = true   /* she still works here for the checks below */
  r = await call('kry', { action: 'separation', name: 'Angiel Rose' })
  ck('Krystal (payroll, the Springfield lead) is refused', r.s === 403, r)
  r = await call('ang', { action: 'separation', name: 'Krystal Land' })
  ck('Angiel is refused', r.s === 403, r)
  r = await call('sam', { action: 'list' })
  const la = r.j.lines.find((x) => x.id === 'bonus_a'), lh = r.j.lines.find((x) => x.id === 'bonus_h')
  ck('owners’ list · Krystal’s lines say she is leaving (Resignation, last day Dec 15); Angiel’s do not', la && la.leaving && la.leaving.kind === 'Resignation' && la.leaving.last_day === '2026-12-15' && lh && !lh.leaving, { la, lh })
  APP.offboardings = [{ id: 'off3', name: 'Angiel Rose', kind: 'Termination', status: 'open', created_at: '2026-12-02T15:00:00Z' }]
  r = await call('kry', { action: 'list' })
  ck('payroll’s list · never shows who is leaving (a termination is owner-only)', r.s === 200 && r.j.lines.length && r.j.lines.every((x) => !x.leaving), r.j.lines.map((x) => [x.id, x.leaving]))
  r = await call('sam', { action: 'list' })
  ck('owners’ list · a termination shows too', r.j.lines.find((x) => x.id === 'bonus_h').leaving?.kind === 'Termination', r.j.lines.find((x) => x.id === 'bonus_h'))
  ck('nothing was sent and no office event written', T.op_events.length === 0, T.op_events)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }

for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n      ' + note))
const bad = res.filter((x) => !x[1]).length
console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
