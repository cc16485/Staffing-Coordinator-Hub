// 1225 · fewer AxisCare reads for the ask lists and the timekeeper (2026-10-31, Samantha: "ask lists for shifts more than
// 2 days out refresh every 2 hours and share the caregiver list and past 14 days, and the timekeeper re-checks the
// confirm-times cards every hour"). Static checks on both functions, a parse check, and the share helper run on fake reads.
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'
const read = f => readFileSync(new URL('./supabase/functions/' + f, import.meta.url), 'utf8')
const cov = read('coverage-run/index.ts'), tk = read('timekeeper-watch/index.ts')
let pass = 0, fail = 0
const t = (name, cond) => { if (cond) { pass++; console.log('  ok   ' + name) } else { fail++; console.log('  FAIL ' + name) } }
const parses = src => { try { new vm.Script(stripTypeScriptTypes(src).replace(/^\s*import [^\n]*$/gm, '').replace(/^export /gm, ''), { filename: 'x.js' }); return true } catch (e) { console.log('    ' + e.message); return false } }
t('coverage-run still parses', parses(cov))
t('timekeeper-watch still parses', parses(tk))

/* the ask lists */
const build = cov.slice(cov.indexOf('async function buildCandidatesForCase'), cov.indexOf('\nasync function ', cov.indexOf('async function buildCandidatesForCase') + 10))
t('every schedule read in the ask-list builder goes through the share', !/await fetchVisits\(/.test(build) && (build.match(/await fetchVisits_\(/g) || []).length === 7)
t('the builder passes its share to the busy check', /await scheduleConflicts\(c, opts\.share\)/.test(build))
t('the caregiver census in the builder is shared', /await shared\(opts\.share, 'caregivers',/.test(build))
t('a census refusal still marks the census unusable', /if \(census\.error\) censusError = census\.error/.test(build))
const sc = cov.slice(cov.indexOf('async function scheduleConflicts'), cov.indexOf('\nasync function ', cov.indexOf('async function scheduleConflicts') + 10))
t('the busy check uses the share for both of its reads', (sc.match(/, share\)/g) || []).length === 2)
const pre = cov.slice(cov.indexOf('PRE-BUILT ASK LIST (her pick'), cov.indexOf('THE QUIET-CALLOUT NUDGE'))
t('the cron prebuild passes the run share', /buildCandidatesForCase\(c, \{ share: prebuildShare \}\)/.test(pre))
t('one share for the whole run, made before the case loop', /const prebuildShare: ReadShare = new Map\(\)[^\n]*\n\s+for \(const c of open\) \{/.test(cov))
t('shifts more than 2 days out refresh every 2 hours, others every 30 minutes', /pbStart - Date\.now\(\) > 48 \* 3600000 \? 120 : 30/.test(pre) && /> pbEveryMin \* 60000\)/.test(pre) && !/> 30 \* 60000\)\) \{/.test(pre))
const others = [...cov.matchAll(/(?<!function )buildCandidatesForCase\([^)]*\)/g)].map(m => m[0]).filter(x => /share/.test(x))
t('only the cron prebuild shares; every click still reads fresh', others.length === 1)

/* the share helper on fake reads */
const helper = cov.slice(cov.indexOf('function shared('), cov.indexOf('\nasync function fetchVisits('))
const shared = vm.runInNewContext('(' + stripTypeScriptTypes(helper).replace(/^function shared/, 'function') + ')')
let calls = 0
const ok = () => { calls++; return Promise.resolve({ rows: [calls], error: null }) }
const bad = () => { calls++; return Promise.resolve({ rows: [], error: 'AxisCare responded 503' }) }
const run = async () => {
  const share = new Map()
  const a = await shared(share, 'visits?x', ok), b = await shared(share, 'visits?x', ok)
  t('the same question read twice in one run costs one read', calls === 1 && a === b)
  await shared(share, 'visits?y', ok)
  t('a different question is read on its own', calls === 2)
  await shared(share, 'caregivers', bad); await shared(share, 'caregivers', ok)
  t('a failed read is never shared: the next case reads again', calls === 4)
  calls = 0; await shared(undefined, 'visits?x', ok); await shared(undefined, 'visits?x', ok)
  t('without a share (a click) every read is fresh', calls === 2)
}
await run()

/* the timekeeper */
const p3 = tk.slice(tk.indexOf('PHASE 3 · AFTER A FIX'), tk.indexOf('PHASE 3 · AFTER A FIX') + 3000)
t('past-day cards are read once an hour', /const cftHourly = new Date\(\)\.getMinutes\(\) < 2\n/.test(p3) && /if \(!v \|\| String\(c\.shift_date\) !== day\) \{\n\s+if \(!cftHourly\) continue\n\s+try \{/.test(p3))
t('the watcher still looks every 10 minutes (today\'s cards, no extra read)', /new Date\(\)\.getMinutes\(\) % 10 >= 2 \? \[\] :/.test(p3))
t('one visit read per card, at most 20 a run, unchanged', /\.slice\(0, 20\)/.test(p3) && (p3.match(/api\/visits\//g) || []).length === 1)
console.log(fail ? `${fail} FAILED, ${pass} passed` : `${pass}/${pass} passed`)
process.exit(fail ? 1 : 0)
