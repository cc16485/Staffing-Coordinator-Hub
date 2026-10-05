// Today cockpit, Phase 2 · the Hub closes its own loops (_shared/loops.ts + coverage-watch + timekeeper-watch +
// coverage-run). The REAL functions against a fake AxisCare, a fake database, a fake GoHighLevel and a controllable
// clock. Made-up people only; nothing leaves this machine. node loops_phase2_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1400)]);
const FN = 'supabase/functions';
let NOW = Date.parse('2026-10-06T15:00:00Z')          // Tue Oct 6, 10:00am Central (CDT)
const RealDate = Date
class FakeDate extends RealDate { constructor(...a) { if (!a.length) super(NOW); else super(...a) } static now() { return NOW } }
globalThis.Date = FakeDate
const at = (iso) => { NOW = RealDate.parse(iso) }

/* ── 1 · the rules on their own ── */
const L = await import(path.join(process.cwd(), FN, '_shared/loops.ts'))
ck('rule · shift end: 09:00-13:00 ends 13:00 that day; 22:00-06:00 ends next morning; no time = 23:59',
  L.caseShiftEnd({ shift_date: '2026-10-05', shift_time: '09:00-13:00' }) === '2026-10-05T13:00'
  && L.caseShiftEnd({ shift_date: '2026-10-05', shift_time: '22:00-06:00' }) === '2026-10-06T06:00'
  && L.caseShiftEnd({ shift_date: '2026-10-05', shift_time: '' }) === '2026-10-05T23:59')
ck('rule · ended = 30 minutes past the end', !L.caseEnded({ shift_date: '2026-10-06', shift_time: '08:00-09:45' }, '2026-10-06T10:00')
  && L.caseEnded({ shift_date: '2026-10-06', shift_time: '08:00-09:30' }, '2026-10-06T10:00'))
const ov = (c, cg) => String(cg.id) === String(c.calling_off_id) ? 'caller_still_on' : (c.unsure ? 'unsure' : 'covered')
ck('rule · someone else clocked in = covered by them', L.pastCaseVerdict({ calling_off_id: 501 }, { caregiver: { id: 601, firstName: 'Joyce', lastName: 'Kim' }, clockIn: { time: 'x' } }, ov).how === 'covered')
ck('rule · the caller clocked in = covered other way', L.pastCaseVerdict({ calling_off_id: 501 }, { caregiver: { id: 501, firstName: 'Maria' }, clockIn: { time: 'x' } }, ov).how === 'covered_other_way')
ck('rule · nobody on it, no clock-in, unsure, or no visit = ask a person', [
  L.pastCaseVerdict({}, { caregiver: null }, ov), L.pastCaseVerdict({}, { caregiver: { id: 601 } }, ov),
  L.pastCaseVerdict({ unsure: true }, { caregiver: { id: 601 }, clockIn: { time: 'x' } }, ov), L.pastCaseVerdict({}, undefined, ov)].every((v) => v.how === null))
{ const c = {}; L.markNoClosureTexts(c, 'T', 'why')
  ck('rule · a closed-after-the-fact case is marked so no closure or family text can go', c.closure_notified === 'T' && c.family_notified === 'T' && c.family_no_recipients === true && c.closure_skip_reason === 'why') }
ck('rule · EVV week: under 90% only, worst first, whole percents', JSON.stringify(L.evvWeek([{ by: { A: [5, 4], B: [5, 5] } }, { by: { A: [5, 3], C: [10, 9] } }], 90).below)
  === JSON.stringify([{ name: 'A', visits: 10, complete: 7, pct: 70 }]))
ck('rule · attendance card: an open one keeps owner and history', (() => { const r = L.attendanceCard({ id: 'x', status: 'open', owner: 'k', history: [1], created_at: 'old', title: 't: 3 x' }, { title: 't: 4 x', detail: 'd', created_at: 'new' }, 4); return r.owner === 'k' && r.history.length === 1 && r.created_at === 'old' && r.count === 4 })())
ck('rule · a closed one stays closed unless the count rose', L.attendanceCard({ status: 'done', title: 'Attendance pattern: 3 call-ins' }, { title: 'x', detail: 'd' }, 3) === null
  && L.attendanceCard({ status: 'done', count: 3, history: [1] }, { title: 'x', detail: 'd', owner: 'o' }, 4)?.status !== 'done')

/* ── the fake world ── */
let APP, T, SENT, VISITS
const reset = () => {
  APP = { ops_settings: { coverage_watch_live: true, timekeeper_watch_live: true, timekeeper_text_live: true, timekeeper_admin_loop_live: true,
      coverage_alert_admins: ['sam@mo-care.com', 'kry@mo-care.com'] },
    coverage_cases: [], ops_items: [], attendance_events: [], attendance_watch_state: [{ id: 'state', last_date: '2026-10-05' }], evv_daily_stats: [],
    caregivers: [{ id: 1, first: 'Maria', last: 'Lopez', phone: '4175550111', axiscare_id: '501', active: true }],
    coordinator_staff: [{ email: 'sam@mo-care.com', name: 'Samantha T', phone: '4175550901' }, { email: 'kry@mo-care.com', name: 'Krystal L', phone: '4175550902' }],
    timekeeper_cases: [], automation_log: [], automation_heartbeats: [] }
  T = { domains: [{ code: 'scheduling_coverage', entity: 'cc_ihs', owner_person: 'p_s' }, { code: 'caregiver_performance', entity: 'cc_ihs', owner_person: 'p_k' }],
    persons: [{ person_id: 'p_s', primary_email: 'sam@mo-care.com' }, { person_id: 'p_k', primary_email: 'kry@mo-care.com' }],
    phone_index: [], contact_optout_current: [], circle_contacts: [], op_events: [], contact_send_refusals: [] }
  SENT = []; VISITS = []
}
const q = (t) => { const st = { f: [] }; const b = {
  select() { return b; }, order() { return b; }, limit() { return b; }, contains() { return b; }, in() { return b; }, is() { return b; }, gte() { return b; }, lte() { return b; }, ilike() { return b; }, not() { return b; }, or() { return b; }, neq() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; },
  insert(row) { (T[t] ||= []).push(row); return Promise.resolve({ data: row, error: null }); },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: null })); },
  then(ok) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]
      return Promise.resolve({ data: k in APP ? [{ key: k, data: JSON.parse(JSON.stringify(APP[k])) }] : [], error: null }).then(ok) }
    let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v)
    return Promise.resolve({ data: rows, error: null }).then(ok);
  } }; return b; };
globalThis.__db = { from: q, auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) },
  rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); const it = JSON.parse(JSON.stringify(a.item)); if (i >= 0) arr[i] = it; else arr.push(it) } return { data: null, error: null } } }
const PHONE_OF = {}
globalThis.fetch = async (url, o) => { url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('axiscare.com/api/visits?')) { const u = new URL(url); const s = u.searchParams.get('startDate'), e = u.searchParams.get('endDate')
    const v = VISITS.filter((x) => { const d = String(x.scheduledStartDate).slice(0, 10); return (!s || d >= s) && (!e || d <= e) })
    return new Response(JSON.stringify({ results: { visits: JSON.parse(JSON.stringify(v)), nextPage: null } }), { status: 200 }) }
  if (url.includes('axiscare.com')) return new Response(JSON.stringify({ results: {} }), { status: 200 })
  if (url.includes('/contacts/upsert')) { const id = 'C:' + (body.phone || body.email); PHONE_OF[id] = body.phone || body.email; return new Response(JSON.stringify({ contact: { id, dnd: false } }), { status: 200 }) }
  if (url.includes('/conversations/messages')) { SENT.push({ to: PHONE_OF[body.contactId] || body.contactId, message: body.message || '' }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 }) }
const SVC = 'svc_' + 'k'.repeat(60), JOBSEC = 'j'.repeat(64)
const ENV = { HUB_JOB_SECRET: JOBSEC, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
globalThis.__dbFor = (key) => ({ from: (t) => { const bb = { select() { return bb; }, limit() { return Promise.resolve(t === 'identity_door_audit' && key !== SVC ? { data: null, error: { message: 'denied' } } : { data: [], error: null }); } }; return bb; } })
fs.writeFileSync(`${FN}/_shared/_job-auth_t.ts`, fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)'))
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_t.ts`) } catch { /* */ } })
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'../_shared/job-auth.ts'", "'../_shared/_job-auth_t.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); } return handler; };
const CW = await load('coverage-watch'), TK = await load('timekeeper-watch')
const run = async (h, qs = '') => { const r = await h(new Request('https://x/fn' + qs, { method: 'POST', headers: { Authorization: 'Bearer eyJanon', 'x-cron-secret': JOBSEC } })); return r.json() }
const item = (id) => APP.ops_items.find((i) => i.id === id), kase = (id) => APP.coverage_cases.find((c) => c.id === id)
const cases = () => [
  { id: 'c1', status: 'open', client: 'Ruth A.', shift_date: '2026-10-05', shift_time: '09:00-13:00', axiscare_visit_id: '9101', calling_off: 'Maria Lopez', calling_off_id: '501', asked: [{ name: 'Joyce Kim', state: 'yes', auto: true, ghl_contact_id: 'g1' }] },
  { id: 'c2', status: 'open', client: 'Ted B.', shift_date: '2026-10-05', shift_time: '14:00-16:00', axiscare_visit_id: '9102', calling_off: 'Ann Cole', asked: [] },
  { id: 'c3', status: 'open', client: 'Old C.', shift_date: '2026-09-16', shift_time: '09:00-11:00', axiscare_visit_id: '9003', calling_off: 'Ann Cole', asked: [] },
  { id: 'c4', status: 'open', client: 'Future D.', shift_date: '2026-10-07', shift_time: '09:00-13:00', axiscare_visit_id: '9104', calling_off: 'Ann Cole', asked: [] },
  { id: 'c5', status: 'open', client: 'Today E.', shift_date: '2026-10-06', shift_time: '09:00-13:00', axiscare_visit_id: '9105', calling_off: 'Ann Cole', asked: [] },
  { id: 'c6', status: 'done', client: 'Uncov F.', resolved_how: 'uncovered', resolved_at: '2026-10-06T14:00:00Z', shift_date: '2026-10-06', shift_time: '07:00-09:00', asked: [] },
  { id: 'c7', status: 'done', client: 'Before G.', resolved_how: 'uncovered', resolved_at: '2026-10-01T14:00:00Z', shift_date: '2026-10-01', shift_time: '07:00-09:00', asked: [] }]
const visits = () => [
  { id: 9101, caregiver: { id: 601, firstName: 'Joyce', lastName: 'Kim' }, client: { id: 701, firstName: 'Ruth' }, scheduledStartDate: '2026-10-05T09:00:00', scheduledEndDate: '2026-10-05T13:00:00', clockIn: { time: '2026-10-05T09:03:00' }, clockOut: { time: '2026-10-05T13:01:00' } },
  { id: 9102, caregiver: null, client: { id: 702, firstName: 'Ted' }, scheduledStartDate: '2026-10-05T14:00:00', scheduledEndDate: '2026-10-05T16:00:00', clockIn: null, clockOut: null },
  { id: 9104, caregiver: null, client: { id: 704, firstName: 'Future' }, scheduledStartDate: '2026-10-07T09:00:00', scheduledEndDate: '2026-10-07T13:00:00', clockIn: null, clockOut: null },
  { id: 9105, caregiver: null, client: { id: 705, firstName: 'Today' }, scheduledStartDate: '2026-10-06T09:00:00', scheduledEndDate: '2026-10-06T13:00:00', clockIn: null, clockOut: null }]
const seedItems = () => [
  { id: 'ops_cov_c1', kind: 'coverage', coverage_case_id: 'c1', status: 'open', title: 'Uncovered shift: Ruth A.' },
  { id: 'ops_cov_c4', kind: 'coverage', coverage_case_id: 'c4', status: 'open', title: 'Uncovered shift: Future D.' },
  { id: 'ops_cov_c6', kind: 'coverage', coverage_case_id: 'c6', status: 'open', title: 'Uncovered shift: Uncov F.' }]

/* ── 2 · switched off: it only says what it would do ── */
reset(); APP.coverage_cases = cases(); VISITS = visits(); APP.ops_items = seedItems(); APP.ops_settings.loops_close_since = '2026-10-05T00:00:00Z'
let before = JSON.stringify({ c: APP.coverage_cases, i: APP.ops_items })
let r = await run(CW)
ck('off · it reports what WOULD close, be asked and be called', r.loops?.live === false && r.loops.cases_closed.map((x) => x.case).join() === 'c1'
   && r.loops.asked.map((x) => x.case).sort().join() === 'c2,c3' && r.loops.items_closed === 1 && r.loops.family_calls.map((x) => x.case).join() === 'c6', r.loops)
{ const a = JSON.parse(before), b = { c: APP.coverage_cases, i: APP.ops_items }
  const diff = []; b.c.forEach((x, k) => { for (const f of Object.keys(x)) if (JSON.stringify(x[f]) !== JSON.stringify((a.c[k] || {})[f])) diff.push(x.id + '.' + f) })
  b.i.forEach((x) => { if (!a.i.some((y) => JSON.stringify(y) === JSON.stringify(x))) diff.push('item ' + x.id) })
  ck('off · and changes nothing of its own (the watcher\'s existing "seen unassigned" stamp aside)', diff.every((d) => /\.seen_unassigned_at$/.test(d)), diff) }

/* ── 3 · switched on ── */
reset(); APP.coverage_cases = cases(); VISITS = visits(); APP.ops_items = seedItems(); APP.ops_settings.loops_close_live = true; APP.ops_settings.loops_close_since = '2026-10-05T00:00:00Z'
r = await run(CW)
const c1 = kase('c1')
ck('on · a past shift AxisCare shows someone else worked: closed, covered by them, by Cara (Resolved)', c1.status === 'resolved' && c1.resolved_how === 'covered' && c1.covered_by === 'Joyce Kim' && c1.resolved_by === 'cara' && c1.closed_after_shift === true, c1)
ck('on · ...marked so no closure, confirmation or family text can go', !!c1.closure_notified && !!c1.family_notified && c1.family_no_recipients === true && /no texts sent/.test(c1.closure_skip_reason), c1)
const c2 = kase('c2')
ck('on · a past shift AxisCare can\'t settle: off the board, and ONE card asks "Was it covered?"', c2.status === 'needs_outcome' && item('ops_covq_c2')?.kind === 'coverage_outcome' && item('ops_covq_c2').status === 'open'
   && /Was Ted B\.'s shift covered\? \(Mon, Oct 5, 2pm-4pm\)/.test(item('ops_covq_c2').title) && /nobody on the shift/.test(item('ops_covq_c2').detail), [c2, item('ops_covq_c2')])
ck('on · the question goes to the owner of Scheduling and coverage (the role, from domains)', item('ops_covq_c2').owner === 'sam@mo-care.com')
ck('on · a shift over 14 days old is asked too (without guessing from AxisCare)', kase('c3').status === 'needs_outcome' && /more than 14 days old/.test(item('ops_covq_c3').detail))
ck('on · future and still-running shifts are untouched', kase('c4').status === 'open' && kase('c5').status === 'open' && !item('ops_covq_c4') && !item('ops_covq_c5'))
ck('on · the case card closes with its case (Resolved, says why); the future case\'s card stays', item('ops_cov_c1').status === 'resolved' && item('ops_cov_c1').resolved_how === 'case_closed'
   && /closed \(covered\)/.test(item('ops_cov_c1').close_note) && item('ops_cov_c4').status === 'open' && item('ops_cov_c6').status === 'resolved', APP.ops_items)
ck('on · not covered (after the switch-on): ONE urgent "call the family" card for a person', item('ops_famcall_c6')?.kind === 'family_call' && item('ops_famcall_c6').urgency === 'urgent'
   && /never contacts them by itself/.test(item('ops_famcall_c6').detail) && kase('c6').family_call_item === 'ops_famcall_c6', item('ops_famcall_c6'))
ck('on · an uncovered case from before the switch-on is left alone', !item('ops_famcall_c7'))
const n1 = APP.ops_items.length; r = await run(CW)
ck('on · running again changes nothing (no duplicates, nobody re-asked)', APP.ops_items.length === n1 && r.loops.cases_closed.length === 0 && r.loops.asked.length === 0 && r.loops.items_closed === 0, r.loops)
ck('on · nothing was texted or emailed', SENT.length === 0, SENT)

/* ── 4 · the nightly sweep and the weekly Caregiver EVV Review (Monday after midnight) ── */
reset(); APP.ops_settings.loops_close_live = true; at('2026-10-05T05:10:00Z')        // Mon Oct 5, 12:10am Central
APP.attendance_watch_state = [{ id: 'state', last_date: '2026-10-03' }]
const day = (d, by) => ({ id: 'evvd_' + d, date: d, by })
APP.evv_daily_stats = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'].map((d) => day(d, { 'Joyce Kim': [1, 1], 'Pat Long': [1, 1] }))
VISITS = [ { id: 9201, caregiver: { id: 601, firstName: 'Joyce', lastName: 'Kim' }, scheduledStartDate: '2026-10-04T09:00:00', clockIn: null, clockOut: null },
  { id: 9202, caregiver: { id: 602, firstName: 'Pat', lastName: 'Long' }, scheduledStartDate: '2026-10-04T09:00:00', clockIn: { time: '2026-10-04T09:00:00' }, clockOut: { time: '2026-10-04T12:00:00' } }]
APP.attendance_events = [1, 2, 3].map((i) => ({ id: 'cin' + i, caregiver: 'Ann Cole', type: 'callin', shift_date: '2026-09-2' + i }))
APP.ops_items = [ { id: 'ops_att_evv_sherylle_202610', status: 'open', kind: 'staffing_issue', title: 'old nightly EVV card' },
  { id: 'ops_att_callin_anncole_202610', status: 'done', title: 'Attendance pattern — Ann Cole: 3 call-ins in 30 days', owner: 'kry@mo-care.com', history: [{ text: 'Talked to Ann' }] } ]
r = await run(CW)
const st = APP.evv_daily_stats.find((d) => d.date === '2026-10-04')
ck('sweep · yesterday\'s EVV totals are recorded (visits, complete)', JSON.stringify(st?.by) === JSON.stringify({ 'Joyce Kim': [1, 0], 'Pat Long': [1, 1] }), st)
ck('sweep · the old nightly EVV card is closed (Resolved, replaced by the weekly review)', item('ops_att_evv_sherylle_202610').status === 'resolved' && item('ops_att_evv_sherylle_202610').resolved_how === 'replaced_by_weekly_review')
ck('sweep · no new nightly EVV cards', !APP.ops_items.some((i) => /^ops_att_evv_/.test(i.id) && i.status === 'open'), APP.ops_items.map((i) => i.id))
ck('sweep · a call-in card a person closed stays closed while the count is the same', item('ops_att_callin_anncole_202610').status === 'done' && r.attendance_cards?.kept_closed === 1, [item('ops_att_callin_anncole_202610'), r.attendance_cards])
const rev = APP.ops_items.find((i) => /^ops_evvrev_/.test(i.id))
ck('review · Monday: ONE Caregiver EVV Review for last week, owned by caregiver performance\'s owner', rev?.id === 'ops_evvrev_2026-09-28' && rev.kind === 'evv_review' && rev.owner === 'kry@mo-care.com', rev)
ck('review · lists only caregivers under 90%, with their numbers', /Joyce Kim: 6 of 7 visits \(85%\)/.test(rev?.detail) && !/Pat Long/.test(rev?.detail) && /1 below 90%/.test(rev?.title), rev?.detail)
APP.attendance_watch_state = [{ id: 'state', last_date: '2026-10-03' }]; APP.attendance_events.push({ id: 'cin4', caregiver: 'Ann Cole', type: 'callin', shift_date: '2026-10-02' })
const nRev = APP.ops_items.filter((i) => /^ops_evvrev_/.test(i.id)).length; r = await run(CW)
const ann = item('ops_att_callin_anncole_202610')
ck('sweep · the count went up (4): the card reopens and keeps its owner and history', ann.status === 'open' && ann.owner === 'kry@mo-care.com' && ann.history?.[0]?.text === 'Talked to Ann' && /from 3 to 4/.test(ann.detail), ann)
ck('review · only once a week', APP.ops_items.filter((i) => /^ops_evvrev_/.test(i.id)).length === nRev)
reset(); APP.ops_settings.loops_close_live = false; at('2026-10-07T15:00:00Z'); APP.evv_daily_stats = [day('2026-09-28', { 'Joyce Kim': [4, 2] })]
r = await run(CW, '?evv_review=1')
ck('review · on demand while switched off: shows the plan, makes nothing', /would make/.test(String(r.evv_review?.card)) && !APP.ops_items.some((i) => /^ops_evvrev_/.test(i.id)), r.evv_review)

/* ── 5 · a missed clock-in whose shift is over becomes an EVV fix ── */
const tkSeed = (live) => { reset(); APP.ops_settings.loops_close_live = live; at('2026-10-06T19:00:00Z')    // 2pm Central
  VISITS = [{ id: 9301, caregiver: { id: 501, firstName: 'Maria', lastName: 'Lopez' }, client: { id: 701, firstName: 'Ruth', lastName: 'Adams' },
    scheduledStartDate: '2026-10-06T09:00:00', scheduledEndDate: '2026-10-06T13:00:00', clockIn: null, clockOut: null }]
  APP.timekeeper_cases = [{ id: 'tk_9301', visit_id: '9301', caregiver: 'Maria Lopez', caregiver_axiscare_id: '501', client_first: 'Ruth', client_axiscare_id: '701',
    shift_date: '2026-10-06', shift_time: '09:00', opened_at: '2026-10-06T14:05:00Z', texted_at: '2026-10-06T14:05:00Z', office_alerted_at: '2026-10-06T14:10:00Z',
    admin_loop: { started_at: '2026-10-06T14:10:00Z', sends: [{ at: '2026-10-06T18:00:00Z', stage: 'after_end', admins: 2 }], last_sent_at: '2026-10-06T18:00:00Z', snooze: {}, texts_to: {} } }]
  APP.ops_items = [{ id: 'ops_tk_tk_9301', kind: 'staffing_issue', status: 'open', owner: 'sam@mo-care.com', title: 'NO CLOCK-IN' }] }
tkSeed(false); r = await run(TK)
ck('tk off · it lists what would become an EVV fix and keeps the old behaviour', r.evv_fix?.became_evv_fix?.length === 1 && !APP.timekeeper_cases[0].resolved_at && item('ops_tk_tk_9301').status === 'open', r.evv_fix)
tkSeed(true); SENT = []; r = await run(TK)
const lad = APP.timekeeper_cases[0]
ck('tk on · the alert closes as "became EVV fix" (Resolved) and its card says so', lad.resolved_how === 'became_evv_fix' && item('ops_tk_tk_9301').status === 'resolved' && item('ops_tk_tk_9301').resolved_how === 'became_evv_fix', [lad, item('ops_tk_tk_9301')])
const fix = item('ops_evvfix_9301')
ck('tk on · ONE "EVV fix needed" card, same owner, with the next step', fix?.kind === 'evv_fix' && fix.status === 'open' && fix.owner === 'sam@mo-care.com'
   && /Maria Lopez, Ruth's 9am shift \(2026-10-06\) had no clock-in/.test(fix.title) && /Text the EVV form/.test(fix.detail), fix)
ck('tk on · the admin texts stop: nothing sent this run or the next', SENT.length === 0 && (at('2026-10-06T19:40:00Z'), true) && (await run(TK), SENT.length === 0), SENT)
tkSeed(true); VISITS[0].caregiver = { id: 777, firstName: 'Other', lastName: 'Person' }; r = await run(TK)
ck('tk on · a visit that changed caregiver is still "visit changed", not an EVV fix', APP.timekeeper_cases[0].resolved_how === 'visit_changed' && !item('ops_evvfix_9301'), APP.timekeeper_cases[0])

/* ── 6 · coverage-run never asks caregivers about a shift that is over ── */
const CRsrc = fs.readFileSync(`${FN}/coverage-run/index.ts`, 'utf8')
ck('coverage-run · the wave send checks the shift is not over', /!quietHold && !shiftOver && wave\.length/.test(CRsrc) && /const shiftOver = caseEnded\(c, chiNowNaive\(\), 0\)/.test(CRsrc))
ck('source · the new rules never send anything', !/ghlSend|conversations\/messages|textAdmin|fetch\(/.test(fs.readFileSync(`${FN}/_shared/loops.ts`, 'utf8')))

for (const [n, ok, note] of res) console.log((ok ? 'PASS' : 'FAIL') + ' · ' + n + (ok ? '' : '  ' + note))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
process.exit(res.every((x) => x[1]) ? 0 : 1)
