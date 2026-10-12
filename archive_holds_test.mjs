// Archived call-offs stay handled: coverage-watch's history sets (generation, last closed case, ongoing-sweep ids)
// include coverage_cases_archive, while its open-case sets do not. node archive_holds_test.mjs
import { readFileSync } from 'node:fs'
import { archivedSchedules, caseHistory, decideHeld } from './supabase/functions/_shared/held-shift.ts'
const res = []; const ck = (n, c, note = '') => res.push([n, !!c, c ? '' : JSON.stringify(note).slice(0, 300)])
const cases = [{ id: 'cw_live_g1', axiscare_visit_id: 'v9', status: 'open' }]
const archived = [
  { id: 'cw_s1_d1_g1', axiscare_visit_id: 's=1:d=2026-10-13', status: 'open', archived_at: '2026-10-12T15:00:00Z' },
  { id: 'cwo_s77', axiscare_visit_id: 's=77:d=2026-10-14', status: 'open', archived_at: '2026-10-12T15:00:00Z' },
  { id: 'cw_old', axiscare_visit_id: 's=2:d=2026-09-01', status: 'resolved', resolved_at: '2026-09-02T00:00:00Z', resolved_how: 'covered', archived_at: '2026-10-12T05:39:00Z' },
  null,
]
const h = caseHistory(cases, archived)
ck('history keeps the live cases first and adds every archived one', h.length === 4 && h[0].id === 'cw_live_g1', h)
const a1 = h.find((c) => c.id === 'cw_s1_d1_g1')
ck('an archived case that was still open counts as closed at its archive time', a1.status === 'archived' && a1.resolved_at === '2026-10-12T15:00:00Z' && a1.resolved_how === 'archived', a1)
ck('an archived case that was already closed keeps how and when it closed', h.find((c) => c.id === 'cw_old').resolved_how === 'covered' && h.find((c) => c.id === 'cw_old').resolved_at === '2026-09-02T00:00:00Z')
ck('nothing archived is ever open', h.slice(1).every((c) => c.status !== 'open'))
ck('unchanged in AxisCare since the archive -> hold (no new case, no one asked)', decideHeld(false, a1) === 'hold')
ck('changed in AxisCare since the archive -> a real new call-off opens', decideHeld(true, a1) === 'reopen')
ck('empty or missing archive changes nothing', caseHistory(cases, null).length === 1 && caseHistory([], []).length === 0)
const now = Date.parse('2026-10-12T16:00:00Z')
const sch = archivedSchedules(caseHistory([], [...archived, { id: 'x', axiscare_visit_id: 'v=5:s=88:d=2026-10-15', status: 'by_hand', archived_at: '2026-10-12T15:00:00Z' }]), 14, now)
ck('the sweep leaves alone schedules whose open call-offs were just archived (incl. v= ids)', sch.has('1') && sch.has('77') && sch.has('88'), [...sch])
ck('a schedule archived after it was already closed is not held by the sweep', !sch.has('2'), [...sch])
ck('after the 14-day window the sweep looks again', archivedSchedules(h, 14, Date.parse('2026-10-27T00:00:00Z')).size === 0)
// the watcher's own wiring, read from the source
const src = readFileSync('./supabase/functions/coverage-watch/index.ts', 'utf8')
ck('the watcher reads coverage_cases_archive into history', /from\('app_data'\)\.select\('data'\)\.eq\('key', 'coverage_cases_archive'\)/.test(src) && /caseHistory\(cases,/.test(src))
ck('generation and last-closed-case use history', /for \(const cc of history\) \{\s*const v = String\(cc\?\.axiscare_visit_id \?\? ''\); if \(!v\) continue\s*genByVisit/.test(src) && /for \(const cc of history\) \{\s*const v = String\(cc\?\.axiscare_visit_id \?\? ''\); if \(!v\) continue\s*if \(cc\?\.status === 'open'/.test(src))
ck('ongoing sweep "handled once" uses history', src.includes('const haveSweepCase = new Set(history.map('))
ck('the sweep skips archived schedules', src.includes('const archivedSchedIds = archivedSchedules(history, SWEEP_DAYS, Date.now())') && src.includes('if (archivedSchedIds.has(schedId)) continue'))
ck('open-case sets still come from live cases only', src.includes("const openByVisit = new Set(cases.filter(c => c?.status === 'open')") && src.includes('const openSchedIds = new Set(cases.filter('))
const uses = src.split('\n').filter((l) => /\bhistory\b/.test(l) && !/^\s*(\/\/|\/\*|\*|-)/.test(l) && !/^\s+\S.*\*\/\s*$/.test(l) || /(const history|of history|history\.map|archivedSchedules\(history)/.test(l))
ck('history is used nowhere else (the 4 history reads + its definition)', uses.length === 5, uses)
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
console.log(`${res.filter((r) => r[1]).length}/${res.length} passed`)
