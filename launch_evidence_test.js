// Launch evidence (Change 1): node launch_evidence_test.js <path to launch-evidence.js>
require(require('path').resolve(process.argv[2]));
const X = globalThis.CCLaunchEvidence;
const res = [];
const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note).slice(0, 700)]);

const NOW = new Date('2026-09-26T17:00:00Z');            // noon in Springfield
const L = o => Object.assign({ id: 'q1', axiscare_client_id: '295', added_at: '2026-09-15T14:00:00Z', episode_n: 1, status: 'pending',
  start_date: '2026-09-22', caregiver_assigned: false, schedule_added: false, evv_verified: false, first_shift_done: false }, o || {});
let n = 0;
const V = (day, o) => Object.assign({ id: 'v=' + (++n), client: { id: 295, firstName: 'Peggy', lastName: 'T' },
  caregiver: { id: 77, firstName: 'Jane', lastName: 'Doe' },
  scheduledStartDate: day + 'T09:00:00', scheduledEndDate: day + 'T12:00:00', clockIn: null, clockOut: null, verified: false, removed: false }, o || {});
const clocked = (day, o) => V(day, Object.assign({ clockIn: { time: day + 'T09:02:00', method: 'Mobile' }, clockOut: { time: day + 'T12:01:00', method: 'Mobile' } }, o || {}));
const ev = (launch, visits, now) => X.evaluate({ launch, visits, now: now || NOW });
const fact = (r, f) => r.record.find(x => x.fact === f);

// 1. the ordinary case
let r = ev(L(), [clocked('2026-09-22', { verified: true }), V('2026-09-29'), V('2026-10-06')]);
ck('first clocked-in-and-out visit is the first shift; Actual SOC is its clock-in date',
  r.first_shift.state === 'evidenced' && r.actual_soc.date === '2026-09-22' && r.actual_soc.basis === 'axiscare_first_clock_in', r);
ck('it records all four facts and ticks the empty boxes, with the clock-in as the time',
  ['schedule', 'caregiver', 'first_shift', 'evv'].every(f => fact(r, f) && fact(r, f).tick) && fact(r, 'first_shift').at === '2026-09-22T09:02:00', r.record);
ck('caregiver comes from AxisCare (the next assigned visit), not a typed name', fact(r, 'caregiver').name === 'Jane Doe' && r.caregiver.primary === 'Jane Doe', r.caregiver);
ck('EVV is proven by the first shift, with the clock-in method', r.evv.state === 'proven' && r.evv.method === 'Mobile', r.evv);
ck('schedule counts visits in the window and names the next one', r.schedule.state === 'yes' && r.schedule.upcoming === 2 && r.schedule.next.date === '2026-09-29', r.schedule);
ck('verified is carried as strength, not required', fact(r, 'first_shift').detail.verified === true, fact(r, 'first_shift'));

// 2. a scheduled visit is never proof
r = ev(L({ start_date: '2026-09-30' }), [V('2026-09-29'), V('2026-10-06')]);
ck('scheduled and assigned but not yet clocked: schedule and caregiver only, no first shift, no Actual SOC',
  r.first_shift.state === 'none' && !r.actual_soc && fact(r, 'schedule') && fact(r, 'caregiver') && !fact(r, 'first_shift') && !fact(r, 'evv') && !r.exceptions.length, r);
r = ev(L(), [V('2026-09-22', { verified: true })]);
ck('a past visit with a caregiver but no clock-in is flagged, never counted (even when marked verified)',
  !r.actual_soc && r.exceptions.some(e => e.code === 'past_visits_unclocked') && r.exceptions.some(e => e.code === 'start_passed_no_clock_in'), r.exceptions);

// 3. missing / exceptional evidence goes to a person
r = ev(L(), [V('2026-09-22', { clockIn: { time: '2026-09-22T09:02:00', method: 'Telephony' } })]);
ck('clock-in without clock-out, long past the end: a question, not a start', r.first_shift.state === 'review' && !r.actual_soc
  && r.exceptions.some(e => e.code === 'no_clock_out') && !fact(r, 'first_shift'), r);
r = ev(L(), [V('2026-09-26', { scheduledStartDate: '2026-09-26T11:00:00', scheduledEndDate: '2026-09-26T14:00:00', clockIn: { time: '2026-09-26T11:03:00' } })]);
ck('clock-in without clock-out while the visit is still going: under way, nothing recorded yet', r.first_shift.state === 'under_way' && !r.exceptions.length && !fact(r, 'first_shift'), r);
r = ev(L(), [V('2026-09-20'), clocked('2026-09-22')]);
ck('an earlier assigned visit with no clock-in makes the start date a question', r.first_shift.state === 'review' && !r.actual_soc
  && r.exceptions.some(e => e.code === 'earlier_visit_unclocked' && e.date === '2026-09-20') && !fact(r, 'first_shift'), r.exceptions);
r = ev(L(), [V('2026-09-20', { caregiver: undefined }), clocked('2026-09-22')]);
ck('an earlier OPEN visit (nobody assigned) is not evidence of missed care', r.first_shift.state === 'evidenced' && r.actual_soc.date === '2026-09-22', r.exceptions);

// 4. episodes and the launch window
r = ev(L(), [clocked('2026-09-01'), clocked('2026-09-22')]);
ck('episode 1: a clocked visit before this launch opened is a conflict for a person', r.first_shift.state === 'review' && !r.actual_soc
  && r.exceptions.some(e => e.code === 'clocked_before_launch'), r);
r = ev(L({ episode_n: 2 }), [clocked('2026-09-01'), clocked('2026-09-22')]);
ck('a returning client: the earlier episode\'s visits are history, not this start', r.first_shift.state === 'evidenced' && r.actual_soc.date === '2026-09-22', r);
r = ev(L({ added_at: '2026-08-01T12:00:00Z' }), [clocked('2026-08-10'), clocked('2026-08-20')]);
ck('visits before AxisCare went live are never evidence either way', r.first_shift.state === 'evidenced' && r.actual_soc.date === '2026-08-20'
  && r.window_from === '2026-08-17' && !r.exceptions.length, r);

// 5. never overwrite a person; never touch a finished launch
r = ev(L({ first_shift_done: true, first_shift_done_at: '2026-09-23T15:00:00Z', caregiver_assigned: true, caregiver_assigned_name: 'Jane D',
  schedule_added: true, evv_verified: true }), [clocked('2026-09-22')]);
ck('already ticked by hand: evidence is still recorded (so Actual SOC is the real date) but nothing is re-ticked or renamed',
  r.record.length === 4 && r.record.every(x => !x.tick) && fact(r, 'caregiver').name === null && r.actual_soc.date === '2026-09-22', r.record);
r = ev(L({ first_shift_done: true, first_shift_done_at: '2026-09-18T15:00:00Z' }), [clocked('2026-09-22')]);
ck('marked done by hand BEFORE any clock-in: a conflict, no Actual SOC', r.first_shift.state === 'review' && !r.actual_soc
  && r.exceptions.some(e => e.code === 'hand_mark_before_care'), r);
r = ev(L({ status: 'complete' }), [clocked('2026-09-22')]);
ck('a completed launch is read but never recorded to', r.record.length === 0 && r.actual_soc.date === '2026-09-22', r);

// 6. data hygiene
r = ev(L(), [clocked('2026-09-22', { client: { id: 999 } }), clocked('2026-09-23', { removed: true }), clocked('2026-09-24')]);
ck('other clients\' visits and removed visits are ignored', r.actual_soc.date === '2026-09-24', r);
r = ev(L(), [V('2026-09-22', { clockIn: { time: '2026-09-23T02:30:00Z', method: 'Mobile' }, clockOut: { time: '2026-09-23T04:00:00Z' },
  scheduledStartDate: '2026-09-23T02:30:00Z', scheduledEndDate: '2026-09-23T04:00:00Z' })]);
ck('zoned stamps are read on Springfield\'s calendar (9:30pm Sep 22, not Sep 23 UTC)', r.actual_soc.date === '2026-09-22' && r.first_shift.visit.clock_in === '21:30', r);
r = ev(L(), [clocked('2026-09-22', { clockIn: '2026-09-22T09:02:00', clockOut: '2026-09-22T12:00:00' })]);
ck('a clock-in delivered as bare text is still read', r.actual_soc && r.actual_soc.date === '2026-09-22', r);
r = ev(L({ axiscare_client_id: '' }), [clocked('2026-09-22')]);
ck('no AxisCare id: nothing to read, nothing proposed', r.ok === false && r.reason === 'no_axiscare_id' && !r.record.length, r);
r = ev(L(), [clocked('2026-09-24'), clocked('2026-09-22')]);
ck('order of the API reply does not matter: earliest clock-in wins', r.actual_soc.date === '2026-09-22', r);
r = ev(L({ caregiver_assigned: false }), [clocked('2026-09-22'), V('2026-09-29', { caregiver: undefined })]);
ck('upcoming visits with nobody assigned are counted and do not invent a caregiver',
  r.caregiver.unassigned_upcoming === 1 && r.caregiver.state === 'no' && !fact(r, 'caregiver'), r.caregiver);

// 7. a person's hand record settles the first shift
const HAND = [{ fact: 'first_shift', source: 'person', recorded_by: 'kat@cc.test', reason: 'Forgot to clock in; family confirmed', evidence: { date: '2026-09-20' } }];
r = X.evaluate({ launch: L({ first_shift_done: true, first_shift_done_at: '2026-09-20T17:00:00Z' }), visits: [V('2026-09-20'), clocked('2026-09-22')], evidence: HAND, now: NOW });
ck('recorded by hand with a reason: its questions close and Actual SOC is the person\'s date',
  r.exceptions.length === 0 && r.actual_soc.date === '2026-09-20' && r.actual_soc.basis === 'recorded_by_hand' && r.first_shift.by_hand.by === 'kat@cc.test', r);
r = X.evaluate({ launch: L({ first_shift_done: true, first_shift_done_at: '2026-09-20T17:00:00Z' }), visits: [clocked('2026-09-21')], evidence: HAND, now: NOW });
ck('recorded by hand, then AxisCare evidence arrives: kept beside it (no tick), the hand date stands',
  r.actual_soc.date === '2026-09-20' && fact(r, 'first_shift') && fact(r, 'first_shift').tick === false && !r.exceptions.length, r);
r = X.evaluate({ launch: L({ first_shift_done: true, first_shift_done_at: '2026-09-20T17:00:00Z' }), visits: [clocked('2026-09-21')], now: NOW });
ck('a bare checkbox tick before the first clock-in is still a conflict (no reason was given)', r.exceptions.some(e => e.code === 'hand_mark_before_care'), r);

let pass = 0;
for (const [name, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n     ' + note)); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`);
process.exit(pass === res.length ? 0 : 1);
