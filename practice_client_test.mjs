// The Practice client (Samantha's In Training plan, 2026-10-22): a fake AxisCare client for a new hire's test clock-in.
// Its visits never trip a missed clock-in, running late, coverage, attendance, Team Builder, matching or a new-client launch.
// node practice_client_test.mjs   (fake data only)
import fs from 'fs'; import path from 'path'
const FNS = path.resolve('supabase/functions')
let pass = 0, fail = 0
const ck = (n, ok, note) => { if (ok) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (note !== undefined ? '  ' + JSON.stringify(note).slice(0, 300) : '')) } }
const Q = await import(path.join(FNS, '_shared/client-quiet.ts'))
const db = (st) => ({ from: (t) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: t === 'app_data' ? { data: st } : null, error: null }), }), }) }) })
console.log('the rule')
await Q.loadNotClients(db({ not_client_ax: [{ ax: '293', name: 'Office Staff' }, { ax: '777', name: 'Practice' }] }))
ck('by number: the Practice client on the not-client list', Q.isNotClient({ client: { id: 777 } }) && Q.isNotClient('777') && Q.isNotClient({ id: '777' }))
ck('by name, before its number is on the list: "Practice" or "Practice Client", any case', Q.isNotClient({ client: { id: 9, firstName: 'Practice' } }) && Q.isNotClient({ client: { id: 9, firstName: 'practice', lastName: 'client' } }) && Q.isNotClient({ firstName: 'PRACTICE', lastName: '' }))
ck('never a real person whose name only contains the word', !Q.isNotClient({ client: { id: 9, firstName: 'Practice', lastName: 'Jones' } }) && !Q.isNotClient({ client: { id: 9, firstName: 'Pat', lastName: 'Practice' } }) && !Q.isNotClient({ client: { id: 10, firstName: 'Ava', lastName: 'Lee' } }))
ck('Office Staff stays on the list', Q.isNotClient({ client: { id: 293 } }))
await Q.loadNotClients(db({}))
ck('an empty setting still knows Office Staff and the Practice name', Q.isNotClient({ client: { id: 293 } }) && Q.isNotClient({ client: { id: 5, firstName: 'Practice' } }))
ck('the shift jobs\' quiet check skips a Practice visit by name too (missed clock-ins, running late, coverage, missed notes)', Q.isQuiet({ client: { id: 5, firstName: 'Practice' } }) && !Q.isQuiet({ client: { id: 6, firstName: 'Ava' } }))
console.log('every visit reader uses it')
const src = (f) => fs.readFileSync(path.join(FNS, f), 'utf8')
const uses = [
  ['coverage-run/index.ts', /if \(v\?\.removed \|\| isNotClient\(v\)\) continue/, 'coverage engine: the one visit fetcher (conflicts, recent hours, new-hire hours, waves)'],
  ['coverage-shifts/index.ts', /try \{ const \{ createClient: ccN \} = await import\('https:\/\/esm\.sh\/@supabase\/supabase-js@2'\); await loadNotClients\(ccN\(/, 'Team Builder, Today board, Live Schedule, forecasts, Hours Watch: the list is read each call'],
  ['coverage-watch/index.ts', /!\(v as any\)\?\.removed && !isNotClient\(v\)\) dayRows\.push/, 'nightly attendance, EVV stats, tardy and missing clock-in records'],
  ['match-dark/index.ts', /xs\.filter\(\(v\) => !isNotClient\(v\)\)/, 'nightly match report: visits'],
  ['match-dark/index.ts', /status\?\.active === true && !isNotClient\(c\)/, 'nightly match report: clients'],
  ['axiscare-client-webhook/index.ts', /isNotClient\(clientId\) \|\| \/\^\(practice\|practice client\|office staff\)\$\/i\.test\(name\)/, 'new client in AxisCare: no client event, no New Clients launch'],
]
for (const [f, re, what] of uses) ck(what, re.test(src(f)))
ck('coverage-shifts: all eight visit loops skip it', (src('coverage-shifts/index.ts').match(/isNotClient\(v\)/g) || []).length === 8, (src('coverage-shifts/index.ts').match(/isNotClient\(v\)/g) || []).length)
const already = [['timekeeper-watch/index.ts', /isQuiet\(/], ['late-watch/index.ts', /isQuiet\(/], ['missed-notes/index.ts', /isQuiet\(/], ['shift-confirm/index.ts', /isNotClient\(/], ['carematch-watch/index.ts', /isQuiet\(/], ['care-notes/index.ts', /isNotClient\(/], ['client-sync/index.ts', /isNotClient\(/], ['lead-digest/index.ts', /isNotClient\(|isQuiet\(/]]
for (const [f, re] of already) ck('already skips it: ' + f.split('/')[0], re.test(src(f)))
console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
