// new-hire.ts: who counts as a new hire who still needs hours. node new_hire_test.mjs
import { newHireNeed, NEW_HIRE_DAYS } from './supabase/functions/_shared/new-hire.ts'
const res = []; const ck = (n, c, d) => res.push([n, !!c, c ? '' : JSON.stringify(d ?? null)])
const T = '2026-10-12'
ck('hired 10 days ago, nothing scheduled: needs hours', newHireNeed('2026-10-02', T, 0, null)?.days === 10)
ck('hired today counts (day 0)', newHireNeed('2026-10-12T00:00:00', T, 0, null)?.days === 0)
ck('a hire date in the future (not started yet): not on the list', newHireNeed('2026-10-20', T, 0, null) === null)
ck(`hired ${NEW_HIRE_DAYS + 1} days ago: no longer a new hire`, newHireNeed('2026-08-12', T, 0, null) === null)
ck('hired 60 days ago still counts', newHireNeed('2026-08-13', T, 0, null) !== null)
ck('some hours, no target: scheduled is enough, off the list', newHireNeed('2026-10-02', T, 12, null) === null)
ck('wants 30 a week, has 24 in two weeks (12 a week): needs hours, numbers kept', JSON.stringify(newHireNeed('2026-10-02', T, 24, 30)) === JSON.stringify({ hired: '2026-10-02', days: 10, scheduled_14d: 24, target_week: 30 }))
ck('wants 20 a week, has 40 in two weeks: off the list', newHireNeed('2026-10-02', T, 40, 20) === null)
ck('nonsense in: nothing', newHireNeed('', T, 0, null) === null && newHireNeed('soon', T, 0, null) === null)
let p = 0; for (const [n, ok, d] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '  ' + d)); if (ok) p++ }
console.log(`\n${p}/${res.length} passed`); process.exit(p === res.length ? 0 : 1)
