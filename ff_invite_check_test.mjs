// ff_invite_check_test.mjs · the daily Friends & Family invite check (step 3, Samantha 2026-10-27: "Yes, use this definition for the
// invitation check, including the 30-day wait after serious issues. Continue building step 3 with the switch off.")
// The REAL ff-invite-check against a fake database, a fake AxisCare and a fake clock (Nov 20, 2026). Made-up people only.
// It must list who WOULD be invited and why, never send anything, and fail closed.  node ff_invite_check_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1200)])
let NOW = Date.parse('2026-11-20T15:00:00Z')
const RealDate = Date
class FakeDate extends RealDate { constructor(...a) { if (!a.length) super(NOW); else super(...a) } static now() { return NOW } }
globalThis.Date = FakeDate
const clone = (x) => JSON.parse(JSON.stringify(x))

/* ── the made-up agency ── */
const cg = (id, first, last, hire, o = {}) => ({ id, firstName: first, lastName: last, status: { active: o.active !== false, label: o.active === false ? 'Inactive' : 'Active' }, hireDate: hire,
  mobilePhone: o.phone ?? ('417555' + String(id).padStart(4, '0')), personalEmail: o.email ?? (first.toLowerCase() + '@example.com') })
const cl = (id, first, last, o = {}) => ({ id, firstName: first, lastName: last, status: { active: o.active !== false, label: o.active === false ? 'Discharged' : 'Active' }, classes: o.classes ?? [] })
const visit = (client, caregiver, day, o = {}) => ({ id: `${client}-${caregiver}-${day}`, client: { id: client }, caregiver: { id: caregiver },
  clockIn: o.noOut === 'in' ? null : { time: day + 'T15:00:00Z' }, clockOut: o.noOut ? null : { time: day + 'T19:00:00Z' }, removed: !!o.removed })
let T, AX, SENT, AXDOWN, ISSUEDOWN, OPTDOWN
const reset = () => {
  AXDOWN = false; ISSUEDOWN = false; OPTDOWN = false; SENT = []
  AX = {
    caregivers: [cg(1, 'Ann', 'Able', '2026-09-01'), cg(2, 'Bea', 'Best', '2026-11-01'), cg(3, 'Cal', 'Cole', '2026-09-01'), cg(4, 'Dee', 'Dunn', '2026-09-01', { active: false }),
      cg(5, 'Eve', 'East', '2026-09-01'), cg(6, 'Fay', 'Ford', '2026-09-01', { phone: '' }), cg(7, 'Gus', 'Gray', '2026-06-01'), cg(8, 'Pat', 'Practice', '2026-09-01', { phone: '4175550183', email: 'pat@practice.invalid' }),
      cg(9, 'Ida', 'Ivy', ''), cg(10, 'Jan', 'Jolly', '', { phone: '', email: '' })],
    clients: [cl(101, 'Rose', 'Ridge'), cl(102, 'Bob', 'Bell'), cl(103, 'Cara', 'Cross', { classes: [{ code: 'L2', label: 'Level 2 - Personal Care' }, { code: 'LTC', label: 'Long Term Care Insurance' }] }),
      cl(104, 'Dan', 'Dale'), cl(105, 'Eli', 'Elm'), cl(106, 'Flo', 'Fern'), cl(107, 'Gil', 'Gold'), cl(108, 'Hal', 'Hart'),
      cl(109, 'Ivy', 'Ink', { classes: [{ code: 'L1', label: 'Level 1 - Wellness Care' }, { code: 'PP', label: 'Private Pay' }] }), cl(110, 'Jo', 'Jay'), cl(111, 'Kim', 'Lee'),
      cl(112, 'Paula', 'Paused'), cl(293, 'Office', 'Staff'), cl(113, 'Lu', 'Lark'), cl(114, 'Mo', 'Moss'), cl(115, 'Old', 'Gone', { active: false }), cl(116, 'Practice', 'Client')],
    visits: [visit(101, 1, '2026-09-10'), visit(103, 1, '2026-08-20'), visit(104, 5, '2026-11-05'), visit(105, 7, '2026-09-02'), visit(106, 9, '2026-09-03'), visit(107, 1, '2026-09-04'),
      visit(108, 1, '2026-09-05'), visit(109, 1, '2026-09-06'), visit(110, 1, '2026-09-07'), visit(111, 1, '2026-09-08'), visit(113, 1, '2026-09-09'), visit(114, 1, '2026-09-09'),
      visit(102, 3, '2026-09-01', { noOut: true }), visit(102, 3, '2026-09-02', { removed: true }), visit(101, 2, '2026-11-03', { noOut: 'in' }), visit(116, 6, '2026-09-01'), visit(112, 6, '2026-09-01')]
  }
  const L = (id, ax, fund, first_shift_at, o = {}) => ({ id, axiscare_client_id: ax, funding_source: fund, first_shift_at, status: 'Converted', ...o })
  T = {
    app_data: {
      ops_settings: { ff_invites_live: false, test_people: { phones: [], emails: [] } },
      caregivers: [{ id: 9, axiscare_id: '9', approved_to_work_at: '2026-09-15T14:00:00Z' }],
      caregiver_census_state: [{ id: 'state', map: {} }, { id: 'obs_1', kind: 'reactivated', axiscare_id: '7', observed_at: '2026-11-10T12:00:00Z' }],
      leads: [L('l101', '101', 'private', '2026-09-10T15:00:00Z'), L('l102', '102', 'medicaid', '2026-09-01T15:00:00Z'), L('l104', '104', 'private', '2026-11-05T15:00:00Z'),
        L('l105', '105', 'private', null), L('l106', '106', 'private', null), L('l107', '107', 'private', null), L('l109', '109', 'ltc', null), L('l110', '110', 'private', null),
        L('l111', '', 'private', null), L('l113', '113', 'private', null), L('l114', '114', 'private', null),
        { id: 'dnc', email: 'blocked@example.com', do_not_contact: true, status: 'Lost' }],
      ops_items: [
        { id: 'cn1', kind: 'care_note', level: 'red', client_ax: '107', about: 'Gil Gold', status: 'open', created_at: '2026-11-18T16:00:00Z' },
        { id: 'cn2', kind: 'care_note', level: 'yellow', client_ax: '101', about: 'Rose Ridge', status: 'done' },
        { id: 'cn3', kind: 'care_note', level: 'unread', client_ax: '110', about: 'Jo Jay', status: 'open' },
        { id: 'ck1', kind: 'client_issue', about: 'Jo Jay', client_ax: '110', status: 'open', source: { type: 'client_checkin' }, title: 'Check-in due' },
        { id: 'man1', kind: 'client_issue', about: 'Kim Lee', status: 'open', title: 'Family upset about the schedule' },
        { id: 'ops_issue_x', kind: 'client_issue', issue_id: 'i-105', client_ax: '105', status: 'open', title: 'Family complaint: late again' }]
    },
    client_journey: [{ lead_id: 'l111', axiscare_client_id: '111', status: 'active', subject: 'client' }],
    client_issue: [
      { id: 'i-105', category: 'family_complaint', state: 'in_progress', axiscare_client_id: '105', reported_at: '2026-11-15T15:00:00Z' },
      { id: 'i-106', category: 'fall_injury_hospital', state: 'resolved', axiscare_client_id: '106', resolved_at: '2026-11-10T15:00:00Z' },
      { id: 'i-106b', category: 'general_question', state: 'reported', axiscare_client_id: '106' },
      { id: 'i-110', category: 'care_plan_concern', state: 'resolved', axiscare_client_id: '110', resolved_at: '2026-11-12T15:00:00Z' },
      { id: 'i-110b', category: 'family_complaint', state: 'resolved', axiscare_client_id: '110', resolved_at: '2026-10-01T15:00:00Z' },
      { id: 'i-110c', category: 'safety_concern', state: 'closed_no_action', axiscare_client_id: '110', resolved_at: '2026-11-15T15:00:00Z' }],
    issue_category: [{ code: 'family_complaint', label: 'Family complaint about a caregiver' }, { code: 'fall_injury_hospital', label: 'Fall, injury or hospitalisation' },
      { code: 'general_question', label: 'General question, not an issue' }, { code: 'care_plan_concern', label: 'Care plan or task concern' }, { code: 'safety_concern', label: 'Safety concern in the home' }],
    care_circles: [101, 103, 104, 105, 106, 107, 108, 109, 110, 111, 114].map((ax) => ({ id: 'c' + ax, axiscare_client_id: String(ax), client_name: 'x', active: true })).concat([{ id: 'c115', axiscare_client_id: '115', active: true }]),
    circle_contacts: [
      { id: 1, circle_id: 'c101', name: 'Dana Ridge', email: 'dana@example.com', relationship: 'daughter', hipaa_authorized: true },
      { id: 2, circle_id: 'c101', name: 'Sam Ridge', email: 'sam@example.com', relationship: 'son', hipaa_authorized: false },
      { id: 3, circle_id: 'c101', name: 'Stopped Ridge', email: 'stop@example.com', relationship: 'son', hipaa_authorized: true, stopped_at: '2026-10-01' },
      { id: 4, circle_id: 'c101', name: 'Rose Ridge', email: 'rose@example.com', relationship: 'client' },
      { id: 5, circle_id: 'c101', name: 'Shared Inbox', email: 'Shared@Example.com', relationship: 'son', hipaa_authorized: true },
      { id: 6, circle_id: 'c105', name: 'Shared Inbox', email: 'shared@example.com', relationship: 'son', hipaa_authorized: true },
      { id: 7, circle_id: 'c103', name: 'Carl Cross', email: 'carl@example.com', relationship: 'husband', hipaa_office_ok_at: '2026-09-01' },
      { id: 8, circle_id: 'c104', name: 'Deb Dale', email: 'deb@example.com', relationship: 'wife', hipaa_authorized: true },
      { id: 9, circle_id: 'c106', name: 'Fran Fern', email: 'fran@example.com', relationship: 'niece', hipaa_authorized: true },
      { id: 10, circle_id: 'c107', name: 'Gina Gold', email: 'gina@example.com', relationship: 'daughter', hipaa_authorized: true },
      { id: 11, circle_id: 'c108', name: 'Hank Hart', email: 'hank@example.com', relationship: 'son', hipaa_authorized: true },
      { id: 12, circle_id: 'c109', name: 'Iris Ink', email: 'iris@example.com', relationship: 'daughter', hipaa_authorized: true },
      { id: 13, circle_id: 'c110', name: 'Jill Jay', email: 'jill@example.com', relationship: 'daughter', hipaa_authorized: true },
      { id: 14, circle_id: 'c111', name: 'Ken Lee', email: 'ken@example.com', relationship: 'son', hipaa_authorized: true },
      { id: 15, circle_id: 'c114', name: 'Opted Out Moss', email: 'optout@example.com', relationship: 'son', hipaa_authorized: true },
      { id: 16, circle_id: 'c114', name: 'Blocked Moss', email: 'blocked@example.com', relationship: 'son', hipaa_authorized: true },
      { id: 17, circle_id: 'c115', name: 'Former Gone', email: 'former@example.com', relationship: 'son', hipaa_authorized: true },
      { id: 18, circle_id: 'c101', name: 'Practice Kin', email: 'kin@practice.invalid', relationship: 'son', hipaa_authorized: true }],
    contact_optout_current: [{ address: 'optout@example.com', channel: 'email', opted_out: true, source: 'staff' },
      { address: 'fay@example.com', channel: 'email', opted_out: true, source: 'stop' }],
    job_applicants: [{ phone: '(417) 555-0005', sms_consent: false, created_at: '2026-08-01' }, { phone: '4175550001', sms_consent: true, created_at: '2026-08-01' }],
    client_pause: [{ axiscare_client_id: '112', status: 'open' }],
    person_role: [], person_source_id: [],
    ff_invite_runs: [{ run_day: '2026-10-01', ok: true, people: [] }, { run_day: '2026-10-25', ok: true, people: [] }]
  }
}

/* ── a small fake database: select with eq / in / not is null / lt / gte / or (this check's own), upsert, delete ── */
function q(t) {
  const st = { f: [], op: 'select', row: null, single: false, head: false }
  const val = (r, k) => k === 'data' ? r.data : r[k]
  const rowsOf = () => t === 'app_data' ? Object.entries(T.app_data).map(([key, data]) => ({ key, data })) : (T[t] || [])
  const run = () => {
    if (t === 'identity_door_audit') return { data: null, error: { message: 'permission denied' } }
    if (t === 'client_issue' && ISSUEDOWN) return { data: null, error: { message: 'down' } }
    if (t === 'contact_optout_current' && OPTDOWN) return { data: null, error: { message: 'down' } }
    if (st.op === 'upsert') {
      const list = T[t] = T[t] || []; const i = list.findIndex((r) => r.run_day === st.row.run_day)
      if (i >= 0) list[i] = clone(st.row); else list.push(clone(st.row)); return { data: null, error: null }
    }
    if (st.op === 'update' || st.op === 'insert') { (T['_w_' + t] = T['_w_' + t] || []).push(st.row); return { data: null, error: null } }
    let rows = rowsOf().filter((r) => st.f.every((fn) => fn(r)))
    if (st.op === 'delete') { T[t] = (T[t] || []).filter((r) => !rows.includes(r)); return { data: null, error: null } }
    return { data: st.single ? (rows[0] ? clone(rows[0]) : null) : clone(rows), error: null }
  }
  const b = new Proxy({}, { get: (_, k) => {
    if (k === 'then') return (ok, ko) => Promise.resolve(run()).then(ok, ko)
    if (k === 'eq') return (a, v) => { st.f.push((r) => String(val(r, a)) === String(v)); return b }
    if (k === 'in') return (a, vs) => { st.f.push((r) => vs.map(String).includes(String(val(r, a)))); return b }
    if (k === 'not') return (a, op, v) => { st.f.push((r) => op === 'is' && v === null ? r[a] != null : true); return b }
    if (k === 'lt') return (a, v) => { st.f.push((r) => String(r[a]) < String(v)); return b }
    if (k === 'gte') return (a, v) => { st.f.push((r) => String(r[a]) >= String(v)); return b }
    if (k === 'or') return (expr) => { const m = /^state\.not\.in\.\(([^)]*)\),resolved_at\.gte\.(.+)$/.exec(expr); const closed = m[1].split(','); st.f.push((r) => !closed.includes(r.state) || (r.resolved_at && String(r.resolved_at) >= m[2])); return b }
    if (k === 'upsert' || k === 'update' || k === 'insert') return (r) => { st.op = k; st.row = r; return b }
    if (k === 'delete') return () => { st.op = 'delete'; return b }
    if (k === 'single' || k === 'maybeSingle') return () => { st.single = true; return Promise.resolve(run()) }
    return () => b } })
  return b
}
globalThis.__db = { from: q, rpc: async () => ({ data: null, error: null }) }
let AXREADS = 0
globalThis.fetch = async (url, o = {}) => { const u = String(url)
  if (!u.includes('.axiscare.com')) { SENT.push(u); return new Response('{}', { status: 200 }) }
  AXREADS++
  if (u.includes('/api/visits')) {
    if (AXDOWN) return new Response('{}', { status: 500 })
    const p = new URL(u), page = Number(p.searchParams.get('page') || 0), from = p.searchParams.get('startDate'), to = p.searchParams.get('endDate')
    const vs = AX.visits.filter((v) => { const d = (v.clockIn?.time || v.clockOut?.time || '2026-09-01').slice(0, 10); return d >= from && d <= to })
    const half = Math.ceil(vs.length / 2), slice = page === 0 ? vs.slice(0, half) : vs.slice(half)
    return new Response(JSON.stringify({ results: { visits: Object.fromEntries(slice.map((v, i) => [i, v])), nextPage: page === 0 ? u + '&page=1' : null } }), { status: 200 })
  }
  if (u.includes('/api/caregivers')) return new Response(JSON.stringify({ results: { caregivers: AX.caregivers } }), { status: 200 })
  if (u.includes('/api/clients')) return new Response(JSON.stringify({ results: { clients: AX.clients } }), { status: 200 })
  return new Response('{}', { status: 404 }) }
const JOBSEC = 'j'.repeat(64)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc_' + 'k'.repeat(60), HUB_JOB_SECRET: JOBSEC, AXISCARE_TOKEN: 'ax', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_ffi_'))
const shared = (s) => s.replace(/from '\.\.\/_shared\/([\w-]+)\.(ts|js)'/g, (_, m, e) => "from '" + path.join(tmp, m + '.' + e) + "'").replace(/from '\.\/([\w-]+)\.(ts|js)'/g, (_, m, e) => "from '" + path.join(tmp, m + '.' + e) + "'")
  .replace(/import '\.\.\/_shared\/([\w-]+)\.js'/g, (_, m) => "import '" + path.join(tmp, m + '.js') + "'")
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
try {
  for (const f of fs.readdirSync(path.join(F, '_shared')).filter((f) => f.endsWith('.ts') || f.endsWith('.js'))) fs.writeFileSync(path.join(tmp, f), shared(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))
  fs.writeFileSync(path.join(tmp, 'fn.ts'), shared(fs.readFileSync(path.join(F, 'ff-invite-check/index.ts'), 'utf8')))
  await import(path.join(tmp, 'fn.ts'))
  const R = await import(path.join(tmp, 'ff-invite-rules.ts'))
  const call = async (qs = '', h = { 'x-cron-secret': JOBSEC, Authorization: 'Bearer eyJanon' }) => { const r = await handler(new Request('https://x/fn' + qs, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' })); return { s: r.status, j: await r.json() } }
  const row = (j, k) => j.rows.find((r) => r.key === k)

  /* ── who may run it ── */
  reset()
  let r = await call('?auth_check=1', { Authorization: 'Bearer eyJanon' })
  ck('the public key is turned away (401) before anything is read', r.s === 401 && AXREADS === 0, r)
  r = await call('?auth_check=1'); ck('its schedule gets in (the vault secret)', r.s === 200 && r.j.caller === 'cron', r)
  r = await call('?auth_check=1', { Authorization: 'Bearer ' + ENV.SUPABASE_SERVICE_ROLE_KEY }); ck("the owner's server key gets in", r.s === 200 && r.j.caller === 'owner', r)

  /* ── the full run ── */
  reset(); r = await call()
  const j = r.j
  ck('a clean run: ok, nothing it could not read', r.s === 200 && j.ok === true && j.problems.length === 0, j.problems)
  ck('it sends NOTHING: no text, no email, no GoHighLevel, no card, no task', j.sent === 0 && SENT.length === 0 && !T._w_app_data && T.app_data.ops_items.length === 6, { SENT, w: T._w_app_data })
  ck('the switch is reported as off', j.live === false)
  /* caregivers */
  ck('Ann: Active since Sep 1, a completed shift: READY, text and email', row(j, 'cg_1')?.status === 'ready' && row(j, 'cg_1').channels.join() === 'text,email', row(j, 'cg_1'))
  ck('Bea: Active since Nov 1: WAITING, ready on Dec 1 (a clock-in without a clock-out is not a shift)', row(j, 'cg_2')?.status === 'waiting' && row(j, 'cg_2').ready_on === '2026-12-01' && /30 days on Dec 1/.test(row(j, 'cg_2').why.join()) && /No completed shift yet/.test(row(j, 'cg_2').why.join()), row(j, 'cg_2'))
  ck('Cal: no completed shift (no clock-out, a removed visit): WAITING, "No completed shift yet"', row(j, 'cg_3')?.status === 'waiting' && row(j, 'cg_3').why.join() === 'No completed shift yet', row(j, 'cg_3'))
  ck('Dee is inactive in AxisCare: not listed', !row(j, 'cg_4'))
  ck('Eve said no to texts on her application: READY by email only, and it says so', row(j, 'cg_5')?.status === 'ready' && row(j, 'cg_5').channels.join() === 'email' && /Email only: said no to texts/.test(row(j, 'cg_5').why.join()), row(j, 'cg_5'))
  ck('Fay has no phone and opted out of email: HELD', row(j, 'cg_6')?.status === 'held' && /No phone, opted out of email/.test(row(j, 'cg_6').why.join()) && !row(j, 'cg_6').channels.length, row(j, 'cg_6'))
  ck('Gus came back to active on Nov 10 (hired in June): the 30 days count from Nov 10, WAITING until Dec 10', row(j, 'cg_7')?.status === 'waiting' && row(j, 'cg_7').ready_on === '2026-12-10', row(j, 'cg_7'))
  ck('a practice hire (555-0183, @practice.invalid) is never listed', !row(j, 'cg_8'))
  ck('Ida has no AxisCare hire date: her Approve to Work date (Sep 15) is used, READY', row(j, 'cg_9')?.status === 'ready' && row(j, 'cg_9').ready_on === '2026-10-15', row(j, 'cg_9'))
  ck('Jan has no hire date, no phone, no email: HELD with each reason', row(j, 'cg_10')?.status === 'held' && /No Active date/.test(row(j, 'cg_10').why.join()) && /No phone or email/.test(row(j, 'cg_10').why.join()), row(j, 'cg_10'))
  /* families */
  ck("Rose (private pay, first visit Sep 10): her daughter Dana is READY, email only", row(j, 'fam_1')?.status === 'ready' && row(j, 'fam_1').channels.join() === 'email' && row(j, 'fam_1').client === 'Rose Ridge', row(j, 'fam_1'))
  ck('...Rose herself (the client) is READY without a HIPAA form', row(j, 'fam_4')?.status === 'ready', row(j, 'fam_4'))
  ck('...her son with HIPAA "No" is HELD: "No HIPAA permission on file"', row(j, 'fam_2')?.status === 'held' && /No HIPAA permission/.test(row(j, 'fam_2').why.join()), row(j, 'fam_2'))
  ck('...a stopped family member and a practice address are never listed', !row(j, 'fam_3') && !row(j, 'fam_18'))
  ck('...an old shift-note flag that was handled does not hold anyone', !row(j, 'fam_1').why.length)
  ck('Bob is Medicaid: nobody listed, counted under "not invited: Medicaid"', !j.rows.some((x) => x.client_ax === '102') && j.summary.not_invited_by_payer.Medicaid === 1, j.summary)
  ck("Cara has no inquiry: AxisCare's class says long-term care insurance, first visit Aug 20 from AxisCare: Carl is READY, with the LTC note", row(j, 'fam_7')?.status === 'ready' && row(j, 'fam_7').payer === 'Long-term care insurance' && /reviewed separately/.test(row(j, 'fam_7').note), row(j, 'fam_7'))
  ck('Dan started Nov 5: Deb is WAITING until Dec 5', row(j, 'fam_8')?.status === 'waiting' && row(j, 'fam_8').ready_on === '2026-12-05', row(j, 'fam_8'))
  const shared_ = j.rows.find((x) => x.name === 'Shared Inbox')
  ck("Eli has an open family complaint: HELD, and the inbox shared with Rose's family gets ONE row, held (the strictest wins)", shared_?.status === 'held' && /Open client issue: Family complaint about a caregiver \(since Nov 15\)/.test(shared_.why.join()) && /Rose Ridge and Eli Elm|Eli Elm and Rose Ridge/.test(shared_.client) && j.rows.filter((x) => x.name === 'Shared Inbox').length === 1, shared_)
  ck("Flo's fall was resolved Nov 10: HELD until Dec 10 (an open general question doesn't count)", row(j, 'fam_9')?.status === 'held' && row(j, 'fam_9').why.join() === 'Fall, injury or hospitalisation, resolved Nov 10: waits until Dec 10', row(j, 'fam_9'))
  ck('Gil has an open red shift-note flag: HELD', row(j, 'fam_10')?.status === 'held' && /Open red shift-note flag \(Nov 18\)/.test(row(j, 'fam_10').why.join()), row(j, 'fam_10'))
  ck('Hal has no payer anywhere: HELD, "Payer needed"', row(j, 'fam_11')?.status === 'held' && /^Payer needed: no payer on the inquiry or in AxisCare$/.test(row(j, 'fam_11').why[0]), row(j, 'fam_11'))
  ck('Ivy: the inquiry says long-term care insurance, AxisCare says Private Pay: HELD, "Payer needed" with both', row(j, 'fam_12')?.status === 'held' && /inquiry says Long-term care insurance but AxisCare says Private pay/.test(row(j, 'fam_12').why.join()), row(j, 'fam_12'))
  ck("Jo: a check-in reminder, a non-serious issue resolved last week, an old complaint (Oct 1), a safety report closed as no issue and an unreadable note: none hold her, Jill is READY", row(j, 'fam_13')?.status === 'ready', row(j, 'fam_13'))
  ck('Kim: a "Client issue" card made by hand with only her name: HELD', row(j, 'fam_14')?.status === 'held' && /Open client issue card: Family upset/.test(row(j, 'fam_14').why.join()), row(j, 'fam_14'))
  ck('a paused client, Office Staff, a discharged client and the Practice client: nobody listed', !j.rows.some((x) => ['112', '293', '115', '116'].includes(x.client_ax)) && !row(j, 'fam_17'))
  ck('Lu has no family email: one row for her, "No family email on file"', row(j, 'cl_113')?.status === 'held' && row(j, 'cl_113').why[0] === 'No family email on file' && j.summary.clients_without_family_email === 1, row(j, 'cl_113'))
  ck("Mo's son opted out of email and the other is on a do-not-contact inquiry: both HELD", row(j, 'fam_15')?.status === 'held' && /Opted out of email/.test(row(j, 'fam_15').why.join()) && row(j, 'fam_16')?.status === 'held', [row(j, 'fam_15'), row(j, 'fam_16')])
  ck('the counts add up', j.summary.caregivers.ready === 3 && j.summary.caregivers.waiting === 3 && j.summary.caregivers.held === 2 && j.summary.families.ready === 4 && j.summary.families.waiting === 1, j.summary)
  /* the day's row */
  const saved = T.ff_invite_runs.find((x) => x.run_day === '2026-11-20')
  ck("today's list is kept in ff_invite_runs (one row for the day, ok, 0 sent)", saved && saved.ok === true && saved.sent === 0 && saved.people.length === j.rows.length && saved.live === false, saved)
  ck('rows older than 30 days are cleared (Oct 1 gone, Oct 25 kept)', !T.ff_invite_runs.some((x) => x.run_day === '2026-10-01') && T.ff_invite_runs.some((x) => x.run_day === '2026-10-25'))
  ck('no phone number or email is kept in the list (names and reasons only)', !/@|4175550/.test(JSON.stringify(saved.people)), JSON.stringify(saved.people).match(/.{40}(@|4175550).{20}/))
  await call()
  ck('running it again the same day replaces the row (still one for the day)', T.ff_invite_runs.filter((x) => x.run_day === '2026-11-20').length === 1)

  /* ── the switch ON still sends nothing in this step ── */
  reset(); T.app_data.ops_settings.ff_invites_live = true; r = await call()
  ck('with the switch ON, step 3 still sends nothing (the sending part comes in step 4)', r.j.live === true && r.j.sent === 0 && SENT.length === 0, { SENT })

  /* ── dry run ── */
  reset(); r = await call('?dry=1')
  ck('?dry=1 works it out without saving', r.j.saved === false && !T.ff_invite_runs.some((x) => x.run_day === '2026-11-20') && r.j.rows.length > 0)

  /* ── fail closed ── */
  reset(); AXDOWN = true; r = await call()
  ck("AxisCare's visits can't be read: nobody listed, the reason saved (not ok)", r.j.ok === false && r.j.rows.length === 0 && /visit list answered 500/.test(r.j.problems.join()) && T.ff_invite_runs.find((x) => x.run_day === '2026-11-20')?.ok === false, r.j.problems)
  reset(); ISSUEDOWN = true; r = await call()
  ck("the client issues can't be read: every family HELD (\"Couldn't check for open complaints\"), caregivers still listed", r.j.ok === false && r.j.rows.filter((x) => x.kind === 'family').every((x) => x.status === 'held' && /Couldn't check for open complaints/.test(x.why.join())) && row(r.j, 'cg_1')?.status === 'ready', r.j.problems)
  reset(); OPTDOWN = true; r = await call()
  ck("the opt-out record can't be read: nobody is ready", r.j.ok === false && !r.j.rows.some((x) => x.status === 'ready'), r.j.rows.filter((x) => x.status === 'ready'))
  reset(); T.app_data.ops_settings.test_people = { phones: ['4175550001'], emails: ['ann@example.com'] }; r = await call()
  ck("the owner's own test phone and email (Admin, test people) are never listed", !row(r.j, 'cg_1'))

  /* ── the rules on their own ── */
  ck('payer: one payer class wins; a care level alone or two payers = unknown', R.payerFromClasses([{ label: 'Level 1 - Wellness Care' }, { label: 'Private Pay' }]) === 'private' && R.payerFromClasses([{ label: 'Level 1 - Wellness Care' }]) === null && R.payerFromClasses([{ label: 'Private Pay' }, { label: 'Long Term Care Insurance' }]) === null)
  ck('payer: VA, GUIDE and Medicaid classes are read as not invited', R.clientFacts({ firstVisit: '2026-09-01', payer: R.payerOf('', [{ label: 'VA Community Care' }]), concerns: [], today: '2026-11-20' }).status === 'not_invited' && R.clientFacts({ firstVisit: '2026-09-01', payer: R.payerOf('guide', []), concerns: [], today: '2026-11-20' }).status === 'not_invited')
  ck('the 30th day counts as ready (first visit Oct 21, today Nov 20)', R.clientFacts({ firstVisit: '2026-10-21', payer: { payer: 'private' }, concerns: [], today: '2026-11-20' }).status === 'ready' && R.clientFacts({ firstVisit: '2026-10-22', payer: { payer: 'private' }, concerns: [], today: '2026-11-20' }).status === 'waiting')
  ck('a serious issue resolved exactly 30 days ago no longer holds; 29 days ago still does', !R.concernsOf([{ category: 'family_complaint', state: 'resolved', axiscare_client_id: '1', resolved_at: '2026-10-20T15:00:00Z' }], [], {}, '2026-11-20').byAx.size &&
    R.concernsOf([{ category: 'family_complaint', state: 'resolved', axiscare_client_id: '1', resolved_at: '2026-10-22T15:00:00Z' }], [], {}, '2026-11-20').byAx.size === 1)
  ck('every one of the six serious kinds waits 30 days after it is resolved', R.SERIOUS.length === 6 && R.SERIOUS.every((c) => R.concernsOf([{ category: c, state: 'resolved', axiscare_client_id: '1', resolved_at: '2026-11-19T15:00:00Z' }], [], {}, '2026-11-20').byAx.size === 1))
  ck('every open issue state but Resolved and "Closed, no action needed" holds', ['reported', 'triaged', 'in_progress', 'waiting', 'resolving', 'follow_up'].every((s) => R.concernsOf([{ category: 'billing_hours_question', state: s, axiscare_client_id: '1' }], [], {}, '2026-11-20').byAx.size === 1))
  /* no em dashes in anything a person reads */
  const words = fs.readFileSync(path.join(F, '_shared/ff-invite-rules.ts'), 'utf8') + fs.readFileSync(path.join(F, 'ff-invite-check/index.ts'), 'utf8')
  ck('no em dashes in the code or its words', !words.includes('—'))
} catch (e) { ck('the test ran', false, String(e?.stack || e)) }
finally { fs.rmSync(tmp, { recursive: true, force: true }) }
for (const [n, ok, note] of res) console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note))
const pass = res.filter((x) => x[1]).length
console.log(`\n  ${pass}/${res.length} passed`)
process.exit(pass === res.length ? 0 : 1)
