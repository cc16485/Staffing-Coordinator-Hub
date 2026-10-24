// REASONS BY ID (Samantha 2026-10-24: "Build Cara reading the reasons by AxisCare id (the 6-reason plan), switch off").
// The shared rules (_shared/visit-reasons.ts) and the REAL coverage-watch under Node (fake AxisCare, fake database).
// Proves: with visit_reasons_live OFF the watcher behaves exactly as before and only reports what by-id would change; ON:
// only Call Off / No Show open a case; a swap and a client cancellation never do; cancelled visits are never open shifts;
// the placeholder is never a cover (case closes as cancelled, no texts); couldn't-staff, unknown-reason and mismatch cards;
// a direct swap with "Call Off" is recorded on Attendance; a corrected reason takes the attendance back; a renamed reason
// keeps its meaning; the visit history keeps every change. Nothing is sent. node visit_reasons_test.mjs
import fs from 'fs'; import path from 'path'
process.env.TZ = 'UTC'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1200)])
const FNS = path.resolve('supabase/functions')
const R = await import(path.join(FNS, '_shared/visit-reasons.ts'))
const NA = await import(path.join(FNS, '_shared/not-a-callin.ts'))
const LOOPS = await import(path.join(FNS, '_shared/loops.ts'))
const Rs = (s, b) => new Response(JSON.stringify(b), { status: s })
const LIST = [[1, 'EVV Correction - Missed Clock-In'], [5, 'Staffing Change - Caregiver Change'], [6, 'Staffing Change - Caregiver Call Off'], [7, 'Staffing Change - Unable to Staff'],
  [8, 'Staffing Change - No Show'], [9, 'Schedule Change - Client Cancellation'], [10, 'Schedule Change - Client Schedule Change'], [12, 'Schedule Change - Client Unavailable'], [13, 'Administrative Correction - Office Error']]
  .map(([id, name]) => ({ id, name, disabled: false }))

/* ── 1. the rules ── */
{
  const t = R.reasonTable(LIST, {})
  const v = (reason, cg, o = {}) => ({ id: 'x', modificationReason: reason ? { name: reason } : null, caregiver: cg, ...o })
  ck('her 6-reason plan by id: 6 call-off, 8 no-show, 5 swap, 7 couldn\'t staff, 9/11/12 client cancelled, 10 moved, 13 office fix', R.DEFAULT_MEANINGS['6'] === 'call_off' && R.DEFAULT_MEANINGS['8'] === 'no_show' && R.DEFAULT_MEANINGS['5'] === 'swap'
    && R.DEFAULT_MEANINGS['7'] === 'couldnt_staff' && ['9', '11', '12'].every((k) => R.DEFAULT_MEANINGS[k] === 'client_cancelled') && R.DEFAULT_MEANINGS['10'] === 'moved' && R.DEFAULT_MEANINGS['13'] === 'office_fix')
  ck('a call-off on an empty visit opens a case; a swap on an empty visit is an open shift, never a call-off', R.readVisit(v('Staffing Change - Caregiver Call Off', null), t).opens_case
    && !R.readVisit(v('Staffing Change - Caregiver Change', null), t).opens_case && R.readVisit(v('Staffing Change - Caregiver Change', null), t).needs_care)
  ck('a client cancellation on an empty visit is cancelled: no case, not an open shift', (() => { const r = R.readVisit(v('Schedule Change - Client Cancellation', null), t); return r.cancelled === 'client' && !r.needs_care && !r.opens_case })())
  ck('Unable to Staff = cancelled by us', R.readVisit(v('Staffing Change - Unable to Staff', null), t).cancelled === 'us' && R.readVisit(v('Staffing Change - Unable to Staff', { id: 618, firstName: 'Canceled', lastName: 'Shift' }), t).cancelled === 'us')
  ck('the placeholder is cancelled whatever the reason says (even "Call Off"), by id 618 or by name', R.readVisit(v('Staffing Change - Caregiver Call Off', { id: 618 }), t).cancelled === 'client'
    && R.readVisit(v(null, { id: 9, firstName: 'Cancelled', lastName: 'Shift' }), t).state === 'placeholder' && !R.readVisit(v('Staffing Change - Caregiver Call Off', { id: 618 }), t).opens_case)
  ck('a deleted visit is cancelled only when its reason says so', R.readVisit(v('Schedule Change - Client Cancellation', null, { removed: true }), t).cancelled === 'client' && R.readVisit(v('Staffing Change - Unable to Staff', null, { removed: true }), t).cancelled === 'us')
  ck('a deleted visit with "Office Error" or no reason (a schedule edit) is NOT cancelled, and never opens a case or a card', (() => { const a = R.readVisit(v('Administrative Correction - Office Error', null, { removed: true }), t), b = R.readVisit(v(null, null, { removed: true }), t)
    return a.state === 'removed' && a.cancelled === null && b.cancelled === null && !a.needs_care && !a.opens_case && !b.needs_care })())
  ck('no reason on an empty visit: an open shift, never a call-off', (() => { const r = R.readVisit(v(null, null), t); return r.needs_care && !r.opens_case && r.reason.meaning === null })())
  ck('cancelled reason but a real caregiver on it: a mismatch to ask about', R.readVisit(v('Schedule Change - Client Cancellation', { id: 44, firstName: 'Amy' }), t).mismatch)
  ck('a name AxisCare\'s list doesn\'t have: unknown (visible, never a call-off)', R.readVisit(v('Weird New Reason', null), t).reason.meaning === 'unknown' && !R.readVisit(v('Weird New Reason', null), t).opens_case)
  const renamed = R.reasonTable(LIST.map((x) => x.id === 6 ? { ...x, name: 'Caregiver Called Off' } : x), {})
  ck('RENAMED in AxisCare: the id keeps its meaning ("Caregiver Called Off" is still a call-off)', R.readVisit(v('Caregiver Called Off', null), renamed).opens_case && R.readVisit(v('caregiver  called off', null), renamed).reason.id === '6')
  ck('a meaning can be changed per id in settings', R.reasonTable(LIST, { visit_reason_meanings: { '13': 'swap' } }).byName.get('administrative correction - office error').meaning === 'swap'
    && R.reasonTable(LIST, { visit_reason_meanings: { '13': 'nonsense' } }).byName.get('administrative correction - office error').meaning === 'office_fix')
  ck('a call-off case read by id counts (attendance); a no-show waits for a person; the old watcher case still doesn\'t count', !NA.takenOffNotCalledIn({ opened_by: 'axiscare-watch', reason_by_id: true, reason_meaning: 'call_off' })
    && NA.takenOffNotCalledIn({ opened_by: 'axiscare-watch', reason_by_id: true, reason_meaning: 'no_show' }) && NA.takenOffNotCalledIn({ opened_by: 'axiscare-watch' })
    && NA.takenOffNotCalledIn({ opened_by: 'axiscare-watch', reason_by_id: true, reason_meaning: 'call_off', not_a_callin: true }) && NA.offWords({ reason_by_id: true, reason_meaning: 'call_off', opened_by: 'axiscare-watch' }) === 'called off')
  ck('after the shift: the placeholder is never "covered"', LOOPS.pastCaseVerdict({}, { caregiver: { id: 618, firstName: 'Canceled', lastName: 'Shift' }, clockIn: { time: 'x' } }, () => 'covered').how === null)
  ck('"we couldn\'t staff it" gets the family called, like uncovered', LOOPS.familyCallNeeded({ status: 'resolved', resolved_how: 'couldnt_staff', resolved_at: new Date().toISOString(), family_notified: 'x', family_no_recipients: true }, '', Date.now()))
}

/* ── 2. the REAL coverage-watch ── */
const src0 = fs.readFileSync(path.join(FNS, 'coverage-watch/index.ts'), 'utf8')
const src = src0.replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace("from '../_shared/job-auth.ts'", "from '" + path.resolve('test_stubs/job-auth-by-role.mjs') + "'")
  .replace(/from '\.\.\/_shared\/([\w.-]+\.(?:ts|js))'/g, (_, m) => "from '" + path.join(FNS, '_shared', m) + "'")
const tmp = path.join(process.cwd(), '_cw_reasons_under_test.ts'); fs.writeFileSync(tmp, src)
let handler; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' }
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
const NOW = Date.now(), HR = 36e5
const wall = (ms) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00` }
const vid = (s, ms) => `s=${s}:d=${wall(ms).slice(0, 10)}`
const PH = { id: 618, firstName: 'Canceled', lastName: 'Shift' }
let DB, AX, TBL, calls, events, LISTNOW, LISTFAIL
function world(st = {}) {
  const t8 = NOW + 8 * HR
  AX = {
    swapEmpty: { id: vid(201, t8), start: t8, reason: 'Staffing Change - Caregiver Change', cg: null },
    callOff: { id: vid(202, t8), start: t8, reason: 'Staffing Change - Caregiver Call Off', cg: null },
    clientCancel: { id: vid(203, t8), start: t8, reason: 'Schedule Change - Client Cancellation', cg: null },
    onPh: { id: vid(204, t8), start: t8, reason: 'Schedule Change - Client Cancellation', cg: PH },
    noStaff: { id: vid(205, t8), start: t8, reason: 'Staffing Change - Unable to Staff', cg: null },
    unknown: { id: vid(206, t8), start: t8, reason: 'Weird New Reason', cg: { id: 44, firstName: 'Kim', lastName: 'Keep' } },
    mismatch: { id: vid(207, t8), start: t8, reason: 'Schedule Change - Client Cancellation', cg: { id: 45, firstName: 'Lou', lastName: 'Still' } },
    swapDirect: { id: vid(208, t8), start: t8, reason: 'Staffing Change - Caregiver Call Off', cg: { id: 46, firstName: 'Ben', lastName: 'New' } },
    noShow: { id: vid(209, t8), start: t8, reason: 'Staffing Change - No Show', cg: null },
    deleted: { id: vid(210, t8), start: t8, reason: 'Schedule Change - Client Cancellation', cg: null, removed: true },
    deletedEdit: { id: vid(212, t8), start: t8, reason: 'Administrative Correction - Office Error', cg: null, removed: true },
    corrected: { id: vid(211, t8), start: t8, reason: 'Staffing Change - Caregiver Change', cg: { id: 47, firstName: 'Cy', lastName: 'Cover' } },
  }
  LISTNOW = LIST; LISTFAIL = false
  DB = { ops_settings: { coverage_watch_live: true, loops_close_live: true, open_shift_cards_live: true, coverage_alert_admins: ['samantha@mo-care.com'], ...st },
    coverage_cases: [
      { id: 'cw_ph', axiscare_visit_id: AX.onPh.id, status: 'open', client: 'Pat Placeholder', calling_off: 'Dee Off', opened_at: new Date(NOW - HR).toISOString(), opened_by: 'axiscare-watch', resolved_at: null, seen_unassigned_at: 'x' },
      { id: 'cw_del', axiscare_visit_id: AX.deleted.id, status: 'open', client: 'Del Gone', opened_at: new Date(NOW - HR).toISOString(), opened_by: 'axiscare-watch', resolved_at: null },
      { id: 'cw_del2', axiscare_visit_id: AX.deletedEdit.id, status: 'open', client: 'Ed Edit', opened_at: new Date(NOW - HR).toISOString(), opened_by: 'axiscare-watch', resolved_at: null },
      { id: 'cw_fix', axiscare_visit_id: AX.corrected.id, status: 'resolved', resolved_how: 'covered', covered_by: 'Cy Cover', client: 'Fix Me', calling_off: 'Fay First', reason_by_id: true, reason_meaning: 'call_off',
        opened_at: new Date(NOW - 3 * HR).toISOString(), resolved_at: new Date(NOW - 2 * HR).toISOString(), opened_by: 'axiscare-watch' } ],
    ops_items: [{ id: 'ops_open_' + AX.clientCancel.id.replace(/[^A-Za-z0-9]/g, '_'), kind: 'open_shift', status: 'open', created_by: 'coverage-watch', axiscare_visit_id: AX.clientCancel.id }],
    visit_memory: [{ id: 'vm_a', visit_id: AX.swapDirect.id, caregiver: 'Amy Old', seen_at: new Date(NOW - HR).toISOString() }],
    attendance_events: [{ id: 'att_cov_cw_fix', caregiver: 'Fay First', type: 'callin', action_id: null }],
    attendance_watch_state: [{ id: 'state', last_date: wall(NOW - 864e5).slice(0, 10) }], notes_watch_state: [{ id: 'state', last_hour: new Date().toISOString().slice(0, 13) }] }
  TBL = { visit_history: [], visit_last: [] }; calls = []; events = []
}
globalThis.__db = {
  from: (t) => { const st = { k: null, inF: null, op: 'select', row: null }; const p = {
    select() { return p }, eq(k, v) { st.k = v; return p }, in(c, v) { st.inF = v; return p }, order() { return p }, limit() { return p },
    maybeSingle() { return Promise.resolve({ data: DB[st.k] !== undefined ? { data: JSON.parse(JSON.stringify(DB[st.k])) } : null, error: null }) },
    insert(row) { if (t === 'op_events') events.push(row); else if (TBL[t]) TBL[t].push(row); return Promise.resolve({ error: null }) },
    upsert(row) { if (t === 'app_data') { DB[row.key] = row.data } else if (t === 'visit_last') { TBL.visit_last = TBL.visit_last.filter((x) => x.visit_id !== row.visit_id); TBL.visit_last.push(row) } return Promise.resolve({ error: null }) },
    then(ok, bad) { const rows = (TBL[t] || []).filter((x) => !st.inF || st.inF.includes(x.visit_id)); return Promise.resolve({ data: rows, error: null }).then(ok, bad) } }; return p },
  rpc(fn, a) { if (fn === 'upsert_app_data_item') { const arr = DB[a.target_key] = Array.isArray(DB[a.target_key]) ? DB[a.target_key] : []; const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) }
    if (fn === 'delete_app_data_item') DB[a.target_key] = (DB[a.target_key] || []).filter((x) => x.id !== a.item_id)
    return Promise.resolve({ error: null }) },
}
globalThis.fetch = async (u, o = {}) => {
  const url = new URL(String(u)); calls.push({ u: String(u), m: o.method || 'GET' })
  if (url.pathname === '/api/visits/modification-reasons') return LISTFAIL ? Rs(500, { errors: ['down'] }) : Rs(200, { results: { modificationReasons: LISTNOW } })
  if (url.pathname !== '/api/visits') return Rs(404, { errors: ['not here'] })
  if (url.searchParams.get('updatedSinceDate')) return Rs(404, { errors: ['No visits found'] })
  const rows = Object.values(AX).map((v) => ({ id: v.id, scheduledStartDate: wall(v.start), scheduledEndDate: wall(v.start + 2 * HR), timezone: 'America/Chicago',
    client: { id: 7, firstName: 'Joel', lastName: 'W' }, caregiver: v.cg, modificationReason: v.reason ? { name: v.reason } : null, removed: v.removed === true }))
  return Rs(200, { results: { visits: rows } })
}
await import(tmp); fs.unlinkSync(tmp)
const run = async () => { const r = await handler(new Request('http://x/coverage-watch', { method: 'POST' })); return r.json() }
const caseFor = (v) => DB.coverage_cases.find((c) => c.axiscare_visit_id === v.id && c.status === 'open' && /^cw_/.test(c.id) && !['cw_ph', 'cw_del'].includes(c.id))
const item = (re) => DB.ops_items.find((i) => re.test(String(i.id)))

/* switch OFF: exactly as before, plus a report of what by-id would change */
world(); let out = await run()
ck('off: the old word match still decides (the swap opens a case, the client cancellation doesn\'t)', !!caseFor(AX.swapEmpty) && !!caseFor(AX.callOff) && !caseFor(AX.clientCancel), out.reasons_by_id)
ck('off: the report says what reading by id would change (swap: no case)', out.reasons_by_id.by_id === false && out.reasons_by_id.list_read === true && out.reasons_by_id.would.some((w) => w.visit === AX.swapEmpty.id && /open-shift card/.test(w.by_id)), out.reasons_by_id.would)
ck('off: no new cases carry reason fields, no reason cards, the placeholder case stays OPEN with a note (never covered)', !DB.coverage_cases.some((c) => c.reason_by_id && c.id !== 'cw_fix') && !item(/^ops_(nostaff|reason|rmis|ncns)_/)
  && DB.coverage_cases.find((c) => c.id === 'cw_ph').status === 'open' && /Canceled Shift placeholder/.test(DB.coverage_cases.find((c) => c.id === 'cw_ph').note || ''), DB.coverage_cases.find((c) => c.id === 'cw_ph'))
ck('off: the corrected call-off keeps its attendance (only reported)', DB.attendance_events.some((e) => e.id === 'att_cov_cw_fix') && out.reasons_by_id.would.some((w) => w.case === 'cw_fix'))
ck('off: the latest report is kept for the Hub', DB.visit_reason_practice?.would?.length > 0 && DB.visit_reason_practice.by_id === false)
ck('the visit history keeps every visit, deleted ones too, with reason id and state (always on)', TBL.visit_history.length === Object.keys(AX).length && TBL.visit_history.some((h) => h.visit_id === AX.onPh.id && h.state === 'placeholder' && h.reason_id === '9')
  && TBL.visit_history.some((h) => h.visit_id === AX.deleted.id && h.state === 'removed'), TBL.visit_history.slice(0, 3))
const h1 = TBL.visit_history.length; await run()
ck('...and writes again only when something changed', TBL.visit_history.length === h1)

/* switch ON */
world({ visit_reasons_live: true }); out = await run()
ck('on: a call-off on an empty visit opens a case that says so (reason id 6, call_off)', caseFor(AX.callOff)?.reason_by_id === true && caseFor(AX.callOff).reason_meaning === 'call_off' && caseFor(AX.callOff).reason_id === '6', caseFor(AX.callOff))
ck('on: the office\'s swap opens NO call-off case (it stays an open-shift card)', !caseFor(AX.swapEmpty), out.reasons_by_id)
ck('on: a client cancellation opens no case, and its open-shift card closes saying it was cancelled', !caseFor(AX.clientCancel) && DB.ops_items.find((i) => i.kind === 'open_shift' && i.axiscare_visit_id === AX.clientCancel.id)?.status === 'done'
  && /cancelled in AxisCare/.test(DB.ops_items.find((i) => i.kind === 'open_shift' && i.axiscare_visit_id === AX.clientCancel.id).auto_closed_reason))
ck('on: "Cancelled today" never lists a visit deleted by a schedule edit', !(DB.visit_reason_practice?.cancelled_today || []).some((x) => x.reason === 'Administrative Correction - Office Error'))
const ph = DB.coverage_cases.find((c) => c.id === 'cw_ph')
ck('on: the case on the placeholder closes as CLIENT CANCELLED, never covered, and no texts will go', ph.status === 'resolved' && ph.resolved_how === 'client_cancelled' && !ph.covered_by && !!ph.closure_notified && ph.family_no_recipients === true, ph)
const del = DB.coverage_cases.find((c) => c.id === 'cw_del')
ck('on: the case whose visit was deleted WITH a cancel reason closes as client cancelled', del.status === 'resolved' && del.resolved_how === 'client_cancelled' && /deleted in AxisCare with the reason "Schedule Change - Client Cancellation"/.test(del.note), del)
const del2 = DB.coverage_cases.find((c) => c.id === 'cw_del2')
ck('on: the case whose visit was deleted with "Office Error" stays OPEN, says why, and a person is asked once', del2.status === 'open' && /doesn't say it was cancelled/.test(del2.note || '') && /does it still need someone\?/.test(item(/^ops_rdel_/)?.title || '') && item(/^ops_rdel_/).coverage_case_id === 'cw_del2', [del2, item(/^ops_rdel_/)])
ck('on: couldn\'t staff = an urgent "call the family" card (a person calls)', item(/^ops_nostaff_/)?.urgency === 'urgent' && /call the family/.test(item(/^ops_nostaff_/).title) && item(/^ops_nostaff_/).kind === 'family_call', item(/^ops_nostaff_/))
ck('on: a reason Cara doesn\'t know = one card asking what it means', /New reason in AxisCare: "Weird New Reason"/.test(item(/^ops_reason_/)?.title || ''))
ck('on: cancelled reason with a caregiver still on it = one card asking which is right', /the reason says cancelled, but Lou is on it/.test(item(/^ops_rmis_/)?.title || ''))
const sw = DB.coverage_cases.find((c) => /^cwr_/.test(c.id))
ck('on: straight from Amy to Ben with "Call Off": Amy\'s call-off is recorded (closed, covered by Ben, no texts) and on Attendance', sw && sw.calling_off === 'Amy Old' && sw.covered_by === 'Ben New' && sw.status === 'resolved' && !!sw.closure_notified
  && DB.attendance_events.some((e) => e.id === 'att_cov_' + sw.id && e.caregiver === 'Amy Old' && e.type === 'callin'), [sw, DB.attendance_events])
const ns = caseFor(AX.noShow)
ck('on: a no-show opens a case and a "confirm the no-call/no-show" card; nothing logged by itself', ns?.reason_meaning === 'no_show' && /Confirm: .*didn't show/.test(item(/^ops_ncns_/)?.title || '') && !DB.attendance_events.some((e) => e.type === 'ncns'), [ns, item(/^ops_ncns_/)])
const fix = DB.coverage_cases.find((c) => c.id === 'cw_fix')
ck('on: the reason was corrected to "Caregiver Change": the automatic call-off comes off Attendance, and the case says why', !DB.attendance_events.some((e) => e.id === 'att_cov_cw_fix') && fix.not_a_callin === true && /no longer counted as a call-off/.test(fix.note), fix)
ck('on: the Hub\'s report carries today\'s cancelled visits (for the quiet "Cancelled today" line)', Array.isArray(DB.visit_reason_practice?.cancelled_today) && /^\d{4}-\d\d-\d\d$/.test(DB.visit_reason_practice.cancelled_day) && DB.visit_reason_practice.by_id === true)
const n2 = DB.coverage_cases.length, i2 = DB.ops_items.length; await run()
ck('on: a second run adds nothing (no duplicate cases or cards)', DB.coverage_cases.length === n2 && DB.ops_items.length === i2, [n2, DB.coverage_cases.length, i2, DB.ops_items.length])

/* renamed reason, and the list unreadable */
world({ visit_reasons_live: true }); LISTNOW = LIST.map((x) => x.id === 6 ? { ...x, name: 'Caregiver Called Off' } : x); AX.callOff.reason = 'Caregiver Called Off'
await run()
ck('on, renamed in AxisCare: "Caregiver Called Off" still opens the call-off case (by id)', caseFor(AX.callOff)?.reason_id === '6')
world({ visit_reasons_live: false }); LISTNOW = LIST.map((x) => x.id === 6 ? { ...x, name: 'Caregiver Called Off' } : x); AX.callOff.reason = 'Caregiver Called Off'
await run()
ck('off, renamed: the old word match would MISS it (why renaming waits for the switch)', !caseFor(AX.callOff))
world({ visit_reasons_live: true }); LISTFAIL = true; out = await run()
ck('on, but AxisCare\'s reason list can\'t be read: the old way decides, and it says why', out.reasons_by_id.by_id === false && /reason list/.test(out.reasons_by_id.error || '') && !!caseFor(AX.swapEmpty), out.reasons_by_id)
ck('nothing is ever sent or changed in AxisCare: every AxisCare call is a read', calls.every((c) => c.m === 'GET'))

/* the always-on guards elsewhere (source checks) */
const tk = fs.readFileSync(path.join(FNS, 'timekeeper-watch/index.ts'), 'utf8'), lw = fs.readFileSync(path.join(FNS, 'late-watch/index.ts'), 'utf8'), cr = fs.readFileSync(path.join(FNS, 'coverage-run/index.ts'), 'utf8')
ck('missed clock-ins and running-late never look at the placeholder', /!isPlaceholder\(v\?\.caregiver\)\) visits\.push/.test(tk) && (lw.match(/isPlaceholder\(v\?\.caregiver\)\) continue/g) || []).length === 2)
ck('a case "covered" by the placeholder gets no confirmed, courtesy or family text', /isPlaceholderCaregiver\(String\(c\.covered_by \|\| ''\)\)\) \{[\s\S]{0,400}family_no_recipients = true[\s\S]{0,200}continue/.test(cr))
ck('copy: no em dashes in the new words', !/[—]/.test(fs.readFileSync(path.join(FNS, '_shared/visit-reasons.ts'), 'utf8').split('\n').filter((l) => /'[^']*'/.test(l) && !/^\s*\/\//.test(l)).join('\n')))

for (const [n, ok, note] of res) console.log((ok ? 'PASS · ' : 'FAIL · ') + n + (note ? '\n     ' + note : ''))
console.log(`${res.filter((r) => r[1]).length}/${res.length}`)
