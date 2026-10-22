// bonus_v2_test.mjs · the bonus v2 (Samantha 2026-10-22): $75 to whoever did the home visit, earned at day 30 with 3
// completed visits, any Caring Companions payer; the scoreboard (counts and the team goal for everyone, dollars only for
// her own lines and owners); the moments; the morning line with no dollars. The REAL cc-bonus against a fake database,
// AxisCare and clock, as cc_bonus_959_test.mjs. Made-up people only.  node bonus_v2_test.mjs
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
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_ccb_'))
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

  const v2 = () => { APP.ops_settings.bonus_v2_live = true; APP.ops_settings.lead_rotation.people = [{ name: 'Krystal', on: true }, { name: 'Angiel', on: true }]
    APP.care_assessments = [{ id: 'as-a', lead_id: 'a', coordinator: 'Krystal Land', status: 'Completed', visit_date: '2026-10-30' },
      { id: 'as-g', lead_id: 'g', coordinator: 'Angiel Rose', status: 'Plan Drafted', visit_date: '2026-10-29' },
      { id: 'as-e', lead_id: 'e', coordinator: 'Krystal Land', status: 'Scheduled', visit_date: '2026-11-20' }]
    APP.leads.push({ id: 'h', first_name: 'Hal', client_first_name: 'Hope', funding_source: 'ltc', status: 'Converted', assigned_coordinator: 'Angiel', first_shift_at: '2026-11-05T15:00:00Z', axiscare_client_id: '108' })
    VIS[108] = days('2026-11-05', 2, 4, '108') }
  const B = await import(path.join(tmp, 'bonus-rules.ts'))

  /* ── v2 off: the old rules, exactly as before ── */
  reset(true); at('2026-11-10T18:00:00Z'); await cron()
  ck('v2 off: the old rule (original lead owner, $100)', line('a')?.recipient === 'Angiel' && line('a')?.amount === 100 && !line('a')?.rules, line('a'))
  let r = await call('kry', { action: 'scoreboard' })
  ck('v2 off: a Care Coordinator has no scoreboard yet', r.s === 200 && r.j.off === true, r.j)
  r = await call('sam', { action: 'scoreboard' })
  ck('v2 off: an owner can preview it (practice)', r.s === 200 && r.j.v2 === false && Array.isArray(r.j.people), r.j)

  /* ── v2 on ── */
  reset(true); v2(); at('2026-11-10T18:00:00Z'); await cron()
  ck('who did the home visit gets it, not the lead owner (Krystal did Rose’s visit; Angiel owned the lead)', line('a')?.recipient === 'Krystal' && line('a')?.by === 'home_visit' && line('a')?.rules === 'v2' && line('a')?.amount === 75, line('a'))
  ck('a home visit only booked does not count: the lead owner gets it, and the line says so', line('e')?.recipient === 'Krystal' && line('e')?.by === 'lead_owner' && /no home visit on file/.test(line('e').history[0].why), line('e'))
  ck('any Caring Companions payer counts (LTC insurance), Medicaid does not', !!line('h') && !line('b'), [line('h'), line('b')])
  ck('pending from the first completed shift: on the way, with visits counted', line('a')?.status === 'on_the_way' && line('a')?.visits === 6, line('a'))
  ck('the words: day and visits, not hours', /Day 8 of 30 · 3 of 3 visits \(6 so far\)/.test(B.progressWords(line('a'), B.settingsOf(APP.ops_settings))), B.progressWords(line('a'), B.settingsOf(APP.ops_settings)))

  /* ── the scoreboard: counts shared, dollars private ── */
  r = await call('kry', { action: 'scoreboard' })
  const kMe = r.j.people.find((p) => p.name === 'Krystal'), kAng = r.j.people.find((p) => p.name === 'Angiel')
  ck('Krystal sees her own dollars ($75 x 3 pending: Rose, Eve, Fay)', kMe.money === true && kMe.pending === 225 && kMe.you === true, kMe)
  ck('Krystal sees Angiel’s counts only, no dollars anywhere', kAng.money === false && kAng.pending === 2 && kAng.clients.every((c) => c.amount === undefined && !/\$/.test(c.words)), kAng)
  ck('the team goal: 5 new clients in November, 3 more to team lunch', r.j.goal.count === 8 && r.j.goal.got === 5 && r.j.goal.left === 3 && r.j.goal.prize === 'team lunch', r.j.goal)
  r = await call('ang', { action: 'scoreboard' })
  ck('Angiel sees her dollars and Krystal’s counts', r.j.people.find((p) => p.name === 'Angiel').pending === 150 && r.j.people.find((p) => p.name === 'Krystal').pending === 3, r.j.people)
  r = await call('zach', { action: 'scoreboard' })
  ck('an owner sees everyone’s dollars', r.j.people.every((p) => p.money) && r.j.people.find((p) => p.name === 'Krystal').pending === 225, r.j.people)
  r = await call('kry', { action: 'list' })
  ck('the private list still shows Krystal only her own lines', r.j.lines.every((l) => l.recipient === 'Krystal'), r.j.lines.map((l) => l.recipient))

  /* ── day 30 ── */
  at('2026-12-03T18:00:00Z'); await cron()
  ck('day 30 with 3+ visits: ready (earned), stamped the day it was earned', line('a')?.status === 'ready' && line('a')?.earned_on === '2026-12-03' && line('g')?.status === 'ready', [line('a'), line('g')])
  ck('9 short visits (18 hours) still earns it now: hours do not matter', line('e')?.status === 'ready', line('e'))
  at('2026-12-05T18:00:00Z'); await cron()   /* Hope's day 30 is Dec 4 */
  ck('2 visits by day 30: under review, "2 of 3 visits by day 30"', line('h')?.status === 'under_review' && /2 of 3 visits by day 30/.test(line('h').reasons.join()), line('h'))
  ck('a returning client is still under review (unchanged rule)', line('f')?.status === 'under_review' && /within 90 days/.test(line('f').reasons.join()), line('f'))
  r = await call('ang', { action: 'scoreboard' })
  const mine = r.j.moments.find((m) => m.name === 'Angiel'), theirs = r.j.moments.find((m) => m.name === 'Krystal')
  ck('the moment: Angiel sees her own +$75, and Krystal’s without dollars', mine?.you === true && mine?.amount === 75 && theirs && theirs.amount === undefined, r.j.moments)
  const line_ = B.morningLine(B.scoreboard(APP.cc_bonuses, { email: '', first: '', owner: false }, B.settingsOf(APP.ops_settings), '2026-12', '2026-12-05'))
  ck('the morning email line: who made it to day 30 and the team goal, no dollars', /made it to day 30/.test(line_) && /Team goal: 0 of 8/.test(line_) && !/\$/.test(line_), line_)
  r = await call('sam', { action: 'act', id: line('h').id, do: 'approve', why: 'Hope was in the hospital a week' })
  ck('Samantha approves an exception: earned that day', r.s === 200 && line('h').status === 'approved' && line('h').earned_on === '2026-12-05', [r.j, line('h')])
  ck('the goal on the day it is reached says so', /Team goal reached: 8 new clients this month. team lunch is on!/.test(B.morningLine({ people: [], moments: [], goal: { count: 8, got: 8, left: 0, reached: true, prize: 'team lunch' } })))
  ck('no em dash in what people read', !/[—―]/.test(fs.readFileSync(path.join(F, '_shared/bonus-rules.ts'), 'utf8').split('\n').filter((x) => !/^\s*(\/\/|\/\*|\*)/.test(x)).join('\n')))
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
const bad = res.filter((r) => !r[1])
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n      ' + note))
console.log(`\n${res.length - bad.length}/${res.length} passed` + (bad.length ? ' · FAIL' : ' · ALL GREEN'))
process.exit(bad.length ? 1 : 0)
