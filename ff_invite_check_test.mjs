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
let T, AX, SENT, AXDOWN, ISSUEDOWN, OPTDOWN, MSGS, CONTACTS, FAILMSG
const reset = () => {
  AXDOWN = false; ISSUEDOWN = false; OPTDOWN = false; SENT = []; MSGS = []; CONTACTS = {}; FAILMSG = ''
  AX = {
    caregivers: [cg(1, 'Ann', 'Able', '2026-09-01'), cg(2, 'Bea', 'Best', '2026-11-01'), cg(3, 'Cal', 'Cole', '2026-09-01'), cg(4, 'Dee', 'Dunn', '2026-09-01', { active: false }),
      cg(5, 'Eve', 'East', '2026-09-01'), cg(6, 'Fay', 'Ford', '2026-09-01', { phone: '' }), cg(7, 'Gus', 'Gray', '2026-06-01'), cg(8, 'Pat', 'Practice', '2026-09-01', { phone: '4175550183', email: 'pat@practice.invalid' }),
      cg(9, 'Ida', 'Ivy', ''), cg(10, 'Jan', 'Jolly', '', { phone: '', email: '' }), cg(11, 'Canceled', 'Shift', '2026-10-16', { phone: '', email: '' }),
      cg(12, 'Kris', 'Lane', '2026-09-01'), cg(13, 'Zed', 'Owner', '2026-09-01', { email: 'zed@mo-care.com' })],
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
    person_role: [], person_source_id: [], phone_index: [], ff_invites: [], ff_card_requests: [],
    /* the office: Sam and Kry sign in; Kris Lane (by name) and Zed (by email) are office staff who are also AxisCare caregivers */
    staff_roles: [{ person_id: 'p-s', entity: 'cc_ihs', role: 'owner_admin' }, { person_id: 'p-k', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p-kl', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p-z', entity: 'cc_ihs', role: 'owner_admin' }],
    persons: [{ person_id: 'p-s', full_name: 'Sam Boss', primary_email: 'sam@mo-care.com', active: true }, { person_id: 'p-k', full_name: 'Kry Desk', primary_email: 'kry@mo-care.com', active: true },
      { person_id: 'p-kl', full_name: 'Kris Lane', primary_email: 'kris.lane@mo-care.com', active: true }, { person_id: 'p-z', full_name: 'Zachary Owner', primary_email: 'zed@mo-care.com', active: true }],
    auth_identities: [{ auth_user_id: 'u-s', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-s' }, { auth_user_id: 'u-k', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-k' }],
    entity_memberships: [{ person_id: 'p-s', entity: 'cc_ihs', active: true }, { person_id: 'p-k', entity: 'cc_ihs', active: true }],
    ff_invite_runs: [{ run_day: '2026-10-01', ok: true, people: [] }, { run_day: '2026-10-25', ok: true, people: [] }]
  }
}

/* ── a small fake database: select with eq / in / not is null / lt / gte / or (this check's own), upsert, delete ──
   1141 found the check asking client_issue for a column it doesn't have, so every table this check reads now refuses an
   unknown column, as the real database does (columns copied from the real tables) */
const SCHEMA = {
  client_issue: 'id category client_person_id axiscare_client_id client_name_free_text client_link_status reported_by_person_id reported_by_name reported_by_role about_caregiver_id state urgency summary detail owner domain waiting_on resolution_note resolved_at resolved_by follow_up_due follow_up_done reached_samantha_at samantha_reason source source_ref reported_at updated_at',
  issue_category: 'code label default_domain default_urgency target_hours follow_up_required follow_up_days notify_beyond_owner owner_authority',
  circle_contacts: 'id circle_id name email phone relationship source sms_consent hipaa_authorized hipaa_office_ok_at stopped_at axiscare_removed_at welcome_sent_at welcome_skip_at welcome_ready_at axis_welcome_sent_at axis_welcome_failed_at axis_welcome_failed_why',
  care_circles: 'id client_name axiscare_client_id active',
  contact_optout_current: 'address channel opted_out source',
  job_applicants: 'phone sms_consent created_at',
  client_journey: 'lead_id axiscare_client_id status closed_reason is_test subject updated_at' }
function q(t) {
  const st = { f: [], op: 'select', row: null, single: false, head: false, cols: '*' }
  const val = (r, k) => k === 'data' ? r.data : r[k]
  const rowsOf = () => t === 'app_data' ? Object.entries(T.app_data).map(([key, data]) => ({ key, data })) : (T[t] || [])
  const run = () => {
    if (t === 'identity_door_audit') return { data: null, error: { message: 'permission denied' } }
    if (st.op === 'select' && SCHEMA[t] && st.cols !== '*') { const have = SCHEMA[t].split(' '), bad = st.cols.split(',').map((c) => c.trim()).filter((c) => c && !have.includes(c))
      if (bad.length) { (T._bad_cols = T._bad_cols || []).push(t + ': ' + bad.join(', ')); return { data: null, error: { message: `column ${t}.${bad[0]} does not exist` } } } }
    if (t === 'client_issue' && ISSUEDOWN) return { data: null, error: { message: 'down' } }
    if (t === 'contact_optout_current' && OPTDOWN) return { data: null, error: { message: 'down' } }
    if (st.op === 'upsert') {   /* ON CONFLICT DO UPDATE: only the columns given change */
      const k = st.conflict || 'run_day', list = T[t] = T[t] || []; const i = list.findIndex((r) => r[k] === st.row[k])
      if (i >= 0) Object.assign(list[i], clone(st.row)); else list.push(clone(st.row)); return { data: null, error: null }
    }
    if (st.op === 'insert') { const list = T[t] = T[t] || []; list.push({ id: list.length + 1, created_at: new Date().toISOString(), ...clone(st.row) }); return { data: null, error: null } }
    let rows = rowsOf().filter((r) => st.f.every((fn) => fn(r)))
    if (st.op === 'update') {
      if (t === 'app_data') { for (const r of rows) T.app_data[r.key] = clone(st.row.data); (T._w_app_data = T._w_app_data || []).push(rows.map((r) => r.key)) }
      else for (const r of rows) Object.assign(r, clone(st.row))
      return { data: null, error: null }
    }
    if (st.op === 'delete') { T[t] = (T[t] || []).filter((r) => !rows.includes(r)); return { data: null, error: null } }
    if (st.head) return { data: null, count: rows.length, error: null }
    if (st.order) rows = rows.sort((x, y) => (String(x[st.order.c]) < String(y[st.order.c]) ? -1 : 1) * (st.order.asc ? 1 : -1))
    if (st.limit) rows = rows.slice(0, st.limit)
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
    if (k === 'upsert' || k === 'update' || k === 'insert') return (r, o) => { st.op = k; st.row = r; st.conflict = o?.onConflict; return b }
    if (k === 'order') return (c, o) => { st.order = { c, asc: o?.ascending !== false }; return b }
    if (k === 'limit') return (n) => { st.limit = n; return b }
    if (k === 'delete') return () => { st.op = 'delete'; return b }
    if (k === 'select') return (cols, o) => { st.cols = String(cols ?? '*'); if (o?.head) st.head = true; return b }
    if (k === 'single' || k === 'maybeSingle') return () => { st.single = true; return Promise.resolve(run()) }
    return () => b } })
  return b
}
const USERS = { 'jwt-sam': { id: 'u-s' }, 'jwt-kry': { id: 'u-k' } }
globalThis.__db = { from: q, auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: { ...USERS[jwt], app_metadata: {} } }, error: null } : { data: null, error: { message: 'bad jwt' } } },
  rpc: async (fn, a) => {
    if (fn === 'upsert_app_data_item') { const list = T.app_data[a.target_key] = Array.isArray(T.app_data[a.target_key]) ? T.app_data[a.target_key] : []; const i = list.findIndex((x) => x.id === a.item.id); if (i >= 0) list[i] = clone(a.item); else list.push(clone(a.item)) }
    return { data: null, error: null } } }
let AXREADS = 0
globalThis.fetch = async (url, o = {}) => { const u = String(url)
  if (u.includes('leadconnectorhq.com')) {
    const body = o.body ? JSON.parse(o.body) : {}
    if (u.includes('/conversations/messages')) { if (FAILMSG && body.type === FAILMSG) return new Response('{"message":"nope"}', { status: 500 }); MSGS.push(body); return new Response(JSON.stringify({ messageId: 'm' + MSGS.length }), { status: 200 }) }
    const id = 'c-' + (body.email || body.phone || decodeURIComponent(u.split('/').pop() || 'x'))
    CONTACTS[id] = body.email || body.phone || CONTACTS[id] || ''
    if (/\/contacts\/[^/?]+$/.test(u) && (!o.method || o.method === 'GET')) return new Response(JSON.stringify({ contact: { id: decodeURIComponent(u.split('/').pop()), dnd: false } }), { status: 200 })
    return new Response(JSON.stringify({ contacts: [], contact: { id, dnd: false } }), { status: 200 })
  }
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
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc_' + 'k'.repeat(60), HUB_JOB_SECRET: JOBSEC, AXISCARE_TOKEN: 'ax', AXISCARE_SITE: '16485', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' }
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
  ck('every column it asks for exists in the real tables (what 1141 found)', !T._bad_cols, T._bad_cols)
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
  ck('the AxisCare "Canceled Shift" placeholder is nobody: never listed (1141 listed it)', !row(j, 'cg_11'))
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

  ck('office staff who are also AxisCare caregivers are left out (Kris Lane by name, Zed by email)', !row(j, 'cg_12') && !row(j, 'cg_13'))
  ck('switch OFF: nothing goes to GoHighLevel at all, 0 sent', j.sent === 0 && MSGS.length === 0 && !Object.keys(CONTACTS).length)

  /* ── STEP 4: the switch ON, a Friday 9 AM ── */
  const owner = async (jwt, body) => { const x = await handler(new Request('https://x/fn', { method: 'POST', headers: { Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return { s: x.status, j: await x.json() } }
  const orgsF = () => (T.app_data.referral_orgs || []).filter((o) => o.program_track === 'friends')
  const msgTo = (addr) => MSGS.filter((m) => CONTACTS[m.contactId] === addr)
  reset(); T.app_data.ops_settings.ff_invites_live = true; r = await call()
  ck('switch ON: every READY person is invited once (3 caregivers, 4 family members), the run row says 7 sent', r.j.sent === 7 && T.ff_invite_runs.find((x) => x.run_day === '2026-11-20')?.sent === 7, { sent: r.j.sent, to: r.j.sent_to })
  ck('...nobody waiting or held got anything (Bea, Cal, Deb, Sam Ridge, Gina, the shared inbox)', ['bea@example.com', 'cal@example.com', 'deb@example.com', 'sam@example.com', 'gina@example.com', 'shared@example.com'].every((e) => !msgTo(e).length), MSGS.map((m) => CONTACTS[m.contactId]))
  const ann = orgsF().find((o) => o.ff_key === 'cg_1'), annText = MSGS.find((m) => m.type === 'SMS' && /^Hi Ann!/.test(m.message || ''))
  ck('Ann gets her own link, made automatically: a Friends & Family partner record (kept off coordinator lists)', ann && /^ANN-[A-HJ-NP-Z2-9]{2}$/.test(ann.partner_code) && ann.type === 'Friends & Family' && ann.program_status === 'active', ann)
  ck("Ann's text is the approved wording with her link, from the office line", annText && annText.message.startsWith('Hi Ann! Thank you for being part of the Caring Companions team! 💙 Did you know you can help more families') && annText.message.includes('$100 bonus on your paycheck') && annText.message.includes('https://mo-care.com/r/?p=' + ann.partner_code) && /Reply STOP to opt out\.$/.test(annText.message) && annText.fromNumber === '+14172348494', annText)
  const annMail = msgTo('ann@example.com')[0]
  ck('...and the approved email, subject and her Refer a Friend page', annMail && annMail.type === 'Email' && annMail.subject === 'Thank you, and a way to help more families' && annMail.html.includes('https://mo-care.com/refer-a-friend/?p=' + ann.partner_code) && annMail.html.includes('$100 bonus on your paycheck'), annMail)
  ck('Eve (no to texts) gets the email only', msgTo('eve@example.com').length === 1 && !MSGS.some((m) => m.type === 'SMS' && /^Hi Eve!/.test(m.message || '')))
  const dana = msgTo('dana@example.com')[0], rose = msgTo('rose@example.com')[0]
  ck("Dana (family) gets the family email only: the credit goes on Rose Ridge's next invoice", dana && dana.subject === 'A thank-you from Caring Companions' && dana.html.includes('$100 credit on Rose Ridge&#39;s next invoice') && !MSGS.some((m) => m.type === 'SMS' && /grateful/.test(m.message || '')), dana)
  ck('Rose herself (the client) reads "your next invoice"', rose && rose.html.includes('$100 credit on your next invoice'), rose)
  ck('Carl (LTC insurance) is invited too', msgTo('carl@example.com').length === 1)
  ck('each invitation is recorded (sent), with no address kept', T.ff_invites.length === 7 && T.ff_invites.every((x) => x.status === 'sent' && x.code && x.first_sent_at) && !/@example|4175550/.test(JSON.stringify(T.ff_invites)), T.ff_invites)
  ck('7 personal links made, all different', orgsF().length === 7 && new Set(orgsF().map((o) => o.partner_code)).size === 7)
  const before = MSGS.length; r = await call()
  ck('the next run: nobody is invited twice', MSGS.length === before && r.j.sent === 0 && orgsF().length === 7)
  ck("...and today's list shows them as invited", row(r.j, 'cg_1')?.invited?.status === 'sent')

  /* paused, weekend, opt-out, refusals */
  reset(); T.app_data.ops_settings.ff_invites_live = true; T.app_data.ops_settings.ff_program_paused = true; r = await call()
  ck('program PAUSED: nothing sent', r.j.sent === 0 && !MSGS.length)
  reset(); T.app_data.ops_settings.ff_invites_live = true; NOW = Date.parse('2026-11-21T15:00:00Z'); r = await call()
  ck('a Saturday: nothing sent, and the run says they wait for the next weekday', r.j.sent === 0 && !MSGS.length && /next weekday morning/.test(r.j.held.join()), r.j.held)
  NOW = Date.parse('2026-11-20T15:00:00Z')
  reset(); T.app_data.ops_settings.ff_invites_live = true; T.contact_optout_current.push({ address: 'dana@example.com', channel: 'email', opted_out: true, source: 'stop' }); r = await call()
  ck('an opt-out recorded today is respected (Dana held, never emailed)', !msgTo('dana@example.com').length && row(r.j, 'fam_1')?.status === 'held')
  reset(); T.app_data.ops_settings.ff_invites_live = true; FAILMSG = 'Email'; r = await call()
  const annRow = T.ff_invites.find((x) => x.person_key === 'cg_1'), dRow = T.ff_invites.find((x) => x.person_key === 'fam_1')
  ck('GoHighLevel refuses the emails: Ann is "partial" (her text went), Dana "failed", and a Needs Attention card is raised', annRow?.status === 'partial' && dRow?.status === 'failed' && (T.app_data.ops_items || []).some((x) => x.sender === 'ff-invite-check'), { annRow, dRow })
  FAILMSG = ''; const b2 = MSGS.length; await call()
  ck('...a failed invitation is not retried by itself (an owner can Resend)', MSGS.length === b2)

  /* ── the owner actions (Hub, signed in) ── */
  reset(); await call()
  r = await owner('jwt-kry', { action: 'list' }); ck('a Care Coordinator is refused (owners only)', r.s === 403, r)
  r = await owner('nope', { action: 'list' }); ck('no sign-in: refused', r.s === 401, r)
  r = await owner('jwt-sam', { action: 'list' })
  ck("an owner lists today's run, the invitations and the switches", r.s === 200 && r.j.run?.run_day === '2026-11-20' && Array.isArray(r.j.invites) && r.j.switches.live === false && r.j.switches.paused === false && r.j.cap === 60, r.j)
  r = await owner('jwt-sam', { action: 'skip', key: 'cg_1', name: 'Ann Able' }); ck('Skip needs a reason', r.s === 400)
  r = await owner('jwt-sam', { action: 'skip', key: 'cg_1', name: 'Ann Able', why: 'She asked us not to' }); ck('Skip with a reason is saved', r.s === 200 && T.ff_invites.find((x) => x.person_key === 'cg_1')?.status === 'skipped')
  r = await owner('jwt-sam', { action: 'switch', name: 'ff_invites_live', on: true })
  ck('an owner turns invitations ON from the tab: saved with who and when', r.s === 200 && T.app_data.ops_settings.ff_invites_live === true && T.app_data.ops_settings.ff_switch_log.at(-1).by === 'Sam Boss', T.app_data.ops_settings.ff_switch_log)
  r = await owner('jwt-sam', { action: 'switch', name: 'team_work_live', on: false }); ck('only the two Friends & Family switches can be changed here', r.s === 400 && T.app_data.ops_settings.team_work_live === undefined)
  r = await call()
  ck('a skipped person is held with the reason, and not invited', row(r.j, 'cg_1')?.status === 'held' && /Skipped: She asked us not to \(Sam Boss\)/.test(row(r.j, 'cg_1').why[0]) && !MSGS.some((m) => /^Hi Ann!/.test(m.message || '')) && r.j.sent === 6, row(r.j, 'cg_1'))
  r = await owner('jwt-sam', { action: 'unskip', key: 'cg_1' }); ck('Undo skip: back on the list', r.s === 200 && !T.ff_invites.find((x) => x.person_key === 'cg_1'))
  const b3 = msgTo('dana@example.com').length
  r = await owner('jwt-sam', { action: 'resend', key: 'fam_1' })
  ck('Resend: Dana gets it again, same link, counted (2 sends)', r.s === 200 && msgTo('dana@example.com').length === b3 + 1 && T.ff_invites.find((x) => x.person_key === 'fam_1')?.sends === 2 && orgsF().filter((o) => o.ff_key === 'fam_1').length === 1, r.j)
  r = await owner('jwt-sam', { action: 'resend', key: 'fam_10' }); ck('Resend for someone held says why, sends nothing', r.s === 409 && /Open red shift-note flag/.test(r.j.error), r.j)
  await owner('jwt-sam', { action: 'switch', name: 'ff_program_paused', on: true }); r = await owner('jwt-sam', { action: 'resend', key: 'fam_1' })
  ck('Resend while paused is refused', r.s === 409 && /paused/.test(r.j.error), r.j)

  /* ── the printed card request (mo-care.com/refer-a-friend) ── */
  let handler2; globalThis.Deno.serve = (h) => { handler2 = h }
  fs.writeFileSync(path.join(tmp, 'card.ts'), shared(fs.readFileSync(path.join(F, 'ff-card-request/index.ts'), 'utf8')))
  await import(path.join(tmp, 'card.ts'))
  const card = async (body) => { const x = await handler2(new Request('https://x/card', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mo-care.com' }, body: JSON.stringify(body) })); return { s: x.status, j: await x.json(), cors: x.headers.get('access-control-allow-origin') } }
  const code = orgsF().find((o) => o.ff_key === 'fam_1').partner_code
  MSGS = []; r = await card({ code, mail_to: 'Dana Ridge', address: '12 Elm St\nNixa MO 65714', how_many: 25 })
  const mail = msgTo('samantha@mo-care.com')[0]
  ck('a card request emails Samantha: who, their code, how many, where to mail', r.s === 200 && r.cors === '*' && mail && mail.subject === 'Printed referral cards for Dana Ridge' && mail.html.includes(code) && mail.html.includes('How many: 25') && mail.html.includes('12 Elm St<br>Nixa MO 65714') && /family of Rose Ridge/.test(mail.html), { r, mail })
  ck('...the server keeps only the code, the count and that it went (no address)', T.ff_card_requests.length === 1 && T.ff_card_requests[0].emailed === true && !JSON.stringify(T.ff_card_requests).includes('Elm'), T.ff_card_requests)
  r = await card({ code, mail_to: 'Dana Ridge', address: '12 Elm St, Nixa MO 65714' }); ck('a second request the same day: "already have it", no second email', r.s === 200 && r.j.already === true && msgTo('samantha@mo-care.com').length === 1, r)
  r = await card({ code: 'NOPE-99', mail_to: 'X', address: '1 Main St, Ozark MO' }); ck('an unknown code: not found, call us', r.s === 404 && /call us/i.test(r.j.error))
  ;(T.app_data.referral_orgs = T.app_data.referral_orgs || []).push({ id: 'org-pro', name: 'Mercy Hospital', partner_code: 'MERCY-K7' })
  r = await card({ code: 'MERCY-K7', mail_to: 'X', address: '1 Main St, Ozark MO' }); ck('a professional partner code is not a Friends & Family page', r.s === 404)
  r = await card({ code, mail_to: 'Dana', address: 'short' }); ck('an incomplete address is asked for again', r.s === 400 && /mailing address/.test(r.j.error))
  r = await card({ code, mail_to: 'Bot', address: '1 Bot Lane, Botville', website: 'http://spam' }); ck('the hidden bot field: quietly ignored, nothing emailed', r.s === 200 && msgTo('samantha@mo-care.com').length === 1)
  T.ff_card_requests = []; FAILMSG = 'Email'; r = await card({ code, mail_to: 'Dana Ridge', address: '12 Elm St, Nixa MO 65714' })
  ck("the email can't go: the person is told to call, and a Needs Attention card names them", r.s === 502 && /call us/i.test(r.j.error) && (T.app_data.ops_items || []).some((x) => x.sender === 'ff-card-request') && T.ff_card_requests[0]?.emailed === false, r.j)
  FAILMSG = ''

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
  const words = ['_shared/ff-invite-rules.ts', '_shared/ff-invite-send.ts', 'ff-invite-check/index.ts', 'ff-card-request/index.ts'].map((f) => fs.readFileSync(path.join(F, f), 'utf8')).join('')
  ck('no em dashes in the code or its words (rules, wording, both functions)', !words.includes('\u2014'))
} catch (e) { ck('the test ran', false, String(e?.stack || e)) }
finally { fs.rmSync(tmp, { recursive: true, force: true }) }
for (const [n, ok, note] of res) console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note))
const pass = res.filter((x) => x[1]).length
console.log(`\n  ${pass}/${res.length} passed`)
process.exit(pass === res.length ? 0 : 1)
