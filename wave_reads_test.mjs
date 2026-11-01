// 1224 · coverage-run reads AxisCare only for what is still used (2026-10-31, Samantha: "remove the call-off job", her pick:
// just the wasted reads). The automatic waves are retired, so the reads that fed only them must be gated on WAVE_READS,
// and the reads the office still relies on (ask lists, the Text button, client city and level) must not be.
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('./supabase/functions/coverage-run/index.ts', import.meta.url), 'utf8')
let pass = 0, fail = 0
const t = (name, cond) => { if (cond) { pass++; console.log('  ok   ' + name) } else { fail++; console.log('  FAIL ' + name) } }
const cron = src.slice(src.indexOf('const AUTO_WAVES_RETIRED = true'))
t('the waves are still retired', /const AUTO_WAVES_RETIRED = true\n/.test(src))
t('WAVE_READS is off while the waves are retired', /const WAVE_READS = !AUTO_WAVES_RETIRED\n/.test(cron))
t('14-day history read is gated', /const recent = open\.length && WAVE_READS \? await fetchVisits\(`startDate=\$\{dISO\(14\)\}/.test(cron))
t('caregiver census read is gated', /if \(open\.length && WAVE_READS\) \{\n\s+const \{ token, site \} = axisCreds\(\)\n[\s\S]{0,200}api\/caregivers`/.test(cron))
t('false "HOLDING all callouts" card is gated', /if \(open\.length && WAVE_READS && !censusUsable && commit\) \{\n[\s\S]{0,300}ops_cov_censusdown_/.test(cron))
t('7-day supply read is gated', /const wantGap = new Map<string, number>\(\)[^\n]*\n\s+if \(open\.length && WAVE_READS\) \{/.test(cron))
t('per-case busy check is gated', /const schedW = WAVE_READS \? await scheduleConflicts\(c\)\n/.test(cron))
t('per-case 180-day history is gated', /if \(clientRes\.id && WAVE_READS\) \{\n\s+const h = await fetchVisits\(\n\s+`startDate=\$\{dISO\(180\)\}/.test(cron))
const cronFetches = [...cron.slice(0, cron.indexOf('CLOSURE TEXTS')).matchAll(/fetchVisits\(|api\/caregivers`/g)].length
t('no other wave-pass schedule or census read was missed (the 4 above)', cronFetches === 4)
t('the automatic send still needs the waves on', /if \(sendLive && !manualSelect && !planHold/.test(cron))
const builder = src.slice(src.indexOf('async function buildCandidatesForCase'), src.indexOf('async function buildCandidatesForCase') + 20000)
t('the ask-list builder still reads the census itself (ask lists, the Text button)', /api\/caregivers`/.test(builder) && !/WAVE_READS/.test(builder))
t('the client city and level read is untouched', /if \(\(!c\.client_city \|\| levelStale\) && clientRes\.id\) \{/.test(cron))
console.log(fail ? `${fail} FAILED, ${pass} passed` : `${pass}/${pass} passed`)
process.exit(fail ? 1 : 0)
