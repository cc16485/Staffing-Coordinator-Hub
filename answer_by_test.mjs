// The answer-by rule (_shared/answer-by.ts) on the 12 situations Samantha approved (2026-10-17), plus DST and settings.
//   node answer_by_test.mjs
import path from 'path'; import { pathToFileURL } from 'url'
const A = await import(pathToFileURL(path.resolve('supabase/functions/_shared/answer-by.ts')).href)
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 500)])
const C = (date, hhmm) => A.at(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)))   // a Central wall-clock instant
const W = (iso) => iso ? A.words(iso) : null
const S = [
  ['1 weekday, one day ahead', '2026-10-20', '10:00', '2026-10-21', '10:00', 'Tue, Oct 20, 6 PM', false],
  ['2 same day, morning for afternoon', '2026-10-19', '09:00', '2026-10-19', '15:00', 'Mon, Oct 19, 1 PM', false],
  ['3 late night for tomorrow afternoon', '2026-10-19', '22:30', '2026-10-20', '14:00', 'Tue, Oct 20, 12 PM', false],
  ['4 afternoon for next morning', '2026-10-20', '17:00', '2026-10-21', '09:00', 'Tue, Oct 20, 7:30 PM', false],
  ['5 Friday evening for Saturday morning: too soon', '2026-10-23', '19:00', '2026-10-24', '09:00', null, false],
  ['6 Saturday for Monday morning', '2026-10-24', '11:00', '2026-10-26', '09:00', 'Sun, Oct 25, 6 PM', false],
  ['7 six days ahead', '2026-10-19', '09:00', '2026-10-25', '10:00', 'Sat, Oct 24, 6 PM', false],
  ['8 ten days ahead: two stages', '2026-10-19', '09:00', '2026-10-29', '10:00', 'Tue, Oct 27, 6 PM', true],
  ['9 three weeks ahead, across the clock change', '2026-10-28', '14:00', '2026-11-18', '13:00', 'Mon, Nov 16, 6 PM', true],
  ['10 five weeks ahead, asked at night', '2026-10-19', '20:30', '2026-11-23', '10:00', 'Sat, Nov 21, 6 PM', true],
  ['11 visit at 6 PM, booked that morning', '2026-10-19', '08:30', '2026-10-19', '18:00', 'Mon, Oct 19, 4 PM', false],
  ['12 Sunday 9 PM for Monday noon', '2026-10-25', '21:00', '2026-10-26', '12:00', 'Mon, Oct 26, 10 AM', false],
]
for (const [n, nd, nt, vd, vt, want, two] of S) {
  const p = A.planRequest(C(nd, nt), vd, vt)
  ck(n, want ? (p.ok && W(p.answer_by) === want && p.two_stage === two) : (!p.ok && p.why === 'too_soon'), p.ok ? { got: W(p.answer_by), two: p.two_stage, rule: p.rule } : p)
}
let p = A.planRequest(C('2026-10-19', '09:00'), '2026-10-29', '10:00')
ck('8b two stages: picks now, the team from 8 AM seven days before', W(p.asking_from) === 'Mon, Oct 19, 9 AM' && W(p.team_from) === 'Thu, Oct 22, 8 AM', [W(p.asking_from), W(p.team_from)])
p = A.planRequest(C('2026-10-19', '22:30'), '2026-10-20', '14:00')
ck('3b a request at night is asked from 8 AM, never at night', W(p.asking_from) === 'Tue, Oct 20, 8 AM', W(p.asking_from))
p = A.planRequest(C('2026-10-28', '14:00'), '2026-11-18', '13:00')
ck('9b the team date is right after the clock change (Nov 11, 8 AM Central)', W(p.team_from) === 'Wed, Nov 11, 8 AM' && new Date(p.team_from).toISOString() === '2026-11-11T14:00:00.000Z', [W(p.team_from), p.team_from])
ck('13 nothing ends after 7:30 PM in any situation', S.every(([, nd, nt, vd, vt]) => { const q = A.planRequest(C(nd, nt), vd, vt); return !q.ok || A.wall(new Date(q.answer_by)).min <= 19 * 60 + 30 }))
ck('14 texting hours: 9 PM to 8 AM counts as none', A.textHours(C('2026-10-19', '21:00'), C('2026-10-20', '08:00')) === 0 && A.textHours(C('2026-10-19', '08:00'), C('2026-10-19', '21:00')) === 13)
ck('15 earliest start: at 9 AM the earliest today is 1 PM; at 1 PM nothing is left today; Friday 7 PM for Saturday it is 10 AM',
  A.earliestStart(C('2026-10-19', '09:00'), '2026-10-19', '07:00', '18:00', 2) === '13:00' && A.earliestStart(C('2026-10-19', '13:00'), '2026-10-19', '07:00', '18:00', 2) === null && A.earliestStart(C('2026-10-23', '19:00'), '2026-10-24', '07:00', '18:00', 2) === '10:00',
  [A.earliestStart(C('2026-10-19', '09:00'), '2026-10-19', '07:00', '18:00', 2), A.earliestStart(C('2026-10-19', '13:00'), '2026-10-19', '07:00', '18:00', 2), A.earliestStart(C('2026-10-23', '19:00'), '2026-10-24', '07:00', '18:00', 2)])
ck('16 nothing left today late in the day', A.earliestStart(C('2026-10-19', '15:30'), '2026-10-19', '07:00', '18:00', 2) === null)
p = A.planRequest(C('2026-10-20', '10:00'), '2026-10-21', '10:00', { family_ask_close_hour: 17 })
ck('17 Hub settings can move the 6 PM close (here 5 PM)', W(p.answer_by) === 'Tue, Oct 20, 5 PM', W(p.answer_by))
ck('18 inHours: 7:29 PM inside 8 to 19.5, 7:30 PM outside', A.inHours(C('2026-10-19', '19:29'), 8, 19.5) && !A.inHours(C('2026-10-19', '19:30'), 8, 19.5))
for (const [n, ok, note] of res) console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note))
console.log(`\n  answer-by rule: ${res.filter((r) => r[1]).length}/${res.length} passed`); process.exit(res.every((r) => r[1]) ? 0 : 1)
