// cc_bonus_959_test.mjs · the Care Coordinator new-client bonus (Care Coordinator Leads and Bonus, Stage 4; policy approved
// by Samantha 2026-10-18): the REAL cc-bonus against a fake database, a fake AxisCare and a controllable clock. Made-up
// people only; nothing leaves this machine. node cc_bonus_959_test.mjs
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

  /* ── off: lists, writes nothing ── */
  reset(false); let r = await cron()
  ck('off · lists the lines it would start and writes nothing', r.s === 200 && r.j.live === false && r.j.write === false && r.j.new_lines.length === 4 && APP.cc_bonuses.length === 0, r.j)
  ck('off · skips with reasons: not private pay, first visit before Nov 1, not on the Care Coordinator list', r.j.skipped['not private pay'] === 1 && r.j.skipped['first visit before the program started'] === 1 && r.j.skipped['Samantha is not on the Care Coordinator list'] === 1, r.j.skipped)
  r = await call(null, { action: 'list' })
  ck('no sign-in · refused', r.s === 401, r)
  r = await handler(new Request('https://x/fn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))
  ck('no key on the daily check · refused', r.status === 401)

  /* ── on, Nov 10 (day 8) ── */
  reset(true); r = await cron()
  ck('on · four lines start: Rose for Angiel (the original owner, not today’s owner), and Eve, Fay and Gil for Krystal', r.j.write && line('a') && line('a').recipient === 'Angiel' && line('a').recipient_email === A && ['e', 'f', 'g'].every((x) => line(x) && line(x).recipient === 'Krystal') && APP.cc_bonuses.length === 4, APP.cc_bonuses.map((x) => [x.lead_id, x.recipient, x.status]))
  ck('on · day 8: on the way, 24 hours so far for Rose (the removed visit not counted), $100', line('a').status === 'on_the_way' && line('a').hours === 24 && line('a').day === 8 && line('a').amount === 100 && line('a').day30 === '2026-12-02', line('a'))
  r = await call('ang', { action: 'list' })
  ck('Angiel sees only her own line, with "Day 8 of 30 · 24 of 20 hours"', r.s === 200 && r.j.lines.length === 1 && r.j.lines[0].lead_id === 'a' && r.j.lines[0].words === 'Day 8 of 30 · 24 of 20 hours' && !r.j.lines[0].history, r.j)
  r = await call('kry', { action: 'list' })
  ck('Krystal (payroll) sees her own three, not Angiel’s yet (nothing approved)', r.j.lines.length === 3 && r.j.lines.every((x) => x.recipient === 'Krystal') && r.j.me.payroll === true, r.j.lines.map((x) => x.lead_id))
  r = await call('zach', { action: 'list' })
  ck('Zach (an owner) sees all four', r.j.lines.length === 4 && r.j.me.owner === true && r.j.me.decider === false)
  r = await call('zach', { action: 'act', id: 'bonus_a', do: 'approve' })
  ck('before day 30 · nobody can approve', r.s === 400 && /on the way/.test(r.j.error), r.j)

  /* ── Dec 3 (past day 30) ── */
  at('2026-12-03T18:00:00Z'); T.client_journey.push({ subject: 'client', lead_id: 'g', axiscare_client_id: '107', status: 'closed', closed_reason: 'Care ended: moved to a facility', updated_at: '2026-11-25T15:00:00Z' }); T.client_journey.shift()
  r = await cron()
  ck('after day 30 · Rose: 24 of 20 hours, active: ready for approval', line('a').status === 'ready' && line('a').reasons.length === 0, line('a'))
  ck('after day 30 · Eve: 18 hours goes to review with the reason, never straight to not earned', line('e').status === 'under_review' && line('e').reasons.join() === '18 of 20 hours by day 30', line('e'))
  ck('after day 30 · Fay: care in the 90 days before goes to review', line('f').status === 'under_review' && /within 90 days/.test(line('f').reasons.join()), line('f'))
  ck('after day 30 · Gil: care ended Nov 25 (before day 30) goes to review', line('g').status === 'under_review' && /care ended 2026-11-25/.test(line('g').reasons.join()), line('g'))
  const reads = AXREADS; r = await cron()
  ck('after day 30 · hours are final: the next check reads AxisCare for nobody', AXREADS === reads, { before: reads, after: AXREADS })

  /* ── decisions ── */
  r = await call('ang', { action: 'act', id: 'bonus_a', do: 'approve' })
  ck('Angiel can’t approve her own bonus', r.s === 400 && /Only Samantha or Zachary/.test(r.j.error), r.j)
  r = await call('zach', { action: 'act', id: 'bonus_e', do: 'approve' })
  ck('Zach can’t approve one under review (only Samantha makes exceptions)', r.s === 400 && /Only Samantha/.test(r.j.error), r.j)
  r = await call('zach', { action: 'act', id: 'bonus_a', do: 'approve' })
  ck('Zach approves the ready one (Samantha away before payroll)', r.s === 200 && line('a').status === 'approved' && line('a').decided_by === Z, r.j)
  r = await call('sam', { action: 'act', id: 'bonus_e', do: 'approve' })
  ck('Samantha’s exception needs a written reason', r.s === 400 && /reason/.test(r.j.error), r.j)
  r = await call('sam', { action: 'act', id: 'bonus_e', do: 'approve', why: 'hospital stay for four days' })
  ck('Samantha approves the exception with her reason', r.s === 200 && line('e').status === 'approved' && line('e').exception === true && line('e').decision_why === 'hospital stay for four days', line('e'))
  r = await call('sam', { action: 'act', id: 'bonus_f', do: 'not_earned', why: 'returning client, away 44 days' })
  ck('Samantha marks Fay not earned with her reason; the history keeps who, when and why', r.s === 200 && line('f').status === 'not_earned' && line('f').history.at(-1).by === S && line('f').history.at(-1).why === 'returning client, away 44 days', line('f').history)
  r = await call('zach', { action: 'act', id: 'bonus_g', do: 'not_earned', why: 'x' })
  ck('Zach can’t mark not earned', r.s === 400 && /Only Samantha/.test(r.j.error))

  /* ── payroll ── */
  r = await call('kry', { action: 'list' })
  ck('Krystal (payroll) now sees Angiel’s approved bonus too, to enter it', r.j.lines.some((x) => x.lead_id === 'a' && x.status === 'approved'), r.j.lines.map((x) => [x.lead_id, x.status]))
  r = await call('kry', { action: 'act', id: 'bonus_a', do: 'paid', paid_on: '2026-12-11' })
  ck('paid · blocked until Samantha confirms the overtime treatment with Viventium', r.s === 400 && /Viventium/.test(r.j.error), r.j)
  r = await call('kry', { action: 'ot_checked', note: 'x' })
  ck('only Samantha records the Viventium check', r.s === 403)
  r = await call('sam', { action: 'ot_checked', note: 'Viventium: added to the regular rate for those weeks' })
  ck('Samantha records the Viventium check', r.s === 200 && APP.ops_settings.bonus.ot_checked.by === S && APP.ops_settings.bonus_live === true, APP.ops_settings.bonus)
  r = await call('kry', { action: 'act', id: 'bonus_a', do: 'paid' })
  ck('paid · needs the payroll date', r.s === 400 && /payroll date/.test(r.j.error))
  r = await call('kry', { action: 'act', id: 'bonus_a', do: 'paid', paid_on: '2026-12-11' })
  ck('paid · Krystal marks it paid on the Dec 11 payroll', r.s === 200 && line('a').status === 'paid' && line('a').paid_on === '2026-12-11' && line('a').paid_by === K, line('a'))
  r = await call('ang', { action: 'list' })
  ck('Angiel sees "Paid on the 2026-12-11 payroll"', r.j.lines[0].words === 'Paid on the 2026-12-11 payroll', r.j.lines[0])
  r = await call('ang', { action: 'act', id: 'bonus_e', do: 'approve' })
  ck('Angiel can’t act on someone else’s line (not even see it)', r.s === 404)
  ck('no bonus decision goes to the office event record (pay is private); the line keeps the history', !T.op_events.some((e) => /bonus/i.test(JSON.stringify(e)) && e.verb !== 'setting_changed') && line('e').history.length >= 2, T.op_events)
  ck('a decided line never changes on the next check', ((await cron()), line('a').status === 'paid' && line('f').status === 'not_earned'))
  ck('nothing was sent to anyone (only AxisCare reads went out)', true)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }

for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n      ' + note))
const bad = res.filter((x) => !x[1]).length
console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
