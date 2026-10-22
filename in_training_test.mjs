// In Training is onboarding (Samantha 2026-10-22) · the one rule, the shift-text gate, and every place that uses it.
// node in_training_test.mjs   (fake data only)
import fs from 'fs'; import path from 'path'
const FNS = path.resolve('supabase/functions')
let pass = 0, fail = 0
const ck = (name, ok, note) => { if (ok) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (note !== undefined ? '  ' + JSON.stringify(note).slice(0, 300) : '')) } }
const R = await import(path.join(FNS, '_shared/in-training.ts'))

console.log('the rule')
ck('"In Training" in any case or spacing is In Training', ['In Training', 'in training', ' IN  TRAINING ', 'InTraining'].every(R.isInTraining))
ck('Active, blank, Inactive, "Training Complete" are not', !['Active', '', null, undefined, 'Inactive', 'Training Complete', 'In Training Hold'].some(R.isInTraining))
ck('switch on: Active works, In Training does not, inactive does not', R.isWorking(true, 'Active', true) && !R.isWorking(true, 'In Training', true) && !R.isWorking(false, 'Active', true))
ck('switch off: the old rule (In Training still counts as active)', R.isWorking(true, 'In Training', false) && !R.isWorking(false, 'In Training', false))
ck('an AxisCare row reads status.active and status.label', !R.rowWorking({ status: { active: true, label: 'In Training' } }, true) && R.rowWorking({ status: { active: true, label: 'Active' } }, true))
const fakeDb = (st) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { data: st } }) }) }) }) })
ck('the switch reads ops_settings (database or a settings object already read)',
  await R.inTrainingLive(fakeDb({ in_training_lock_live: true })) && !(await R.inTrainingLive(fakeDb({}))) && await R.inTrainingLive({ in_training_lock_live: true }) && !(await R.inTrainingLive({})))
ck('an unreadable switch is off (today\'s behavior)', !(await R.inTrainingLive({ from: () => { throw new Error('down') } })))
ck('no em dashes in the words a person reads', !R.IN_TRAINING_WHY.includes('—'))

console.log('the shift-text gate (team-ask, family offers)')
const G = await import(path.join(FNS, '_shared/shift-ask-gate.ts'))
// app_data reads go through one fake: answer ops_settings with the switch, everything else with an empty list
const db2 = (st) => ({ from: (t) => ({ select: () => ({
  eq: (col, val) => t === 'client_journey'
    ? { eq: () => ({ limit: async () => ({ data: [], error: null }) }) }
    : { maybeSingle: async () => ({ data: { data: val === 'ops_settings' ? st : [] } }) } }) }) })
const cg = { first: 'Taylor', last: 'Young', axiscare_id: '777', phone: '4175550100' }
const ask = (st, label) => G.shiftAskBlock(db2(st), { cg, name: 'Taylor Young', axId: '777', client: 'Pat Doe', readStatus: async () => ({ ok: true, active: true, label }) })
const on = await ask({ in_training_lock_live: true }, 'In Training')
ck('switch on: an In Training hire is not texted about a shift, and the office reads why', on && /In Training in AxisCare/.test(on), on)
ck('switch on: an Active caregiver still is', (await ask({ in_training_lock_live: true }, 'Active')) === null)
ck('switch off: nothing changes (In Training still passes the gate)', (await ask({}, 'In Training')) === null)

console.log('every place uses the one rule')
const src = (f) => fs.readFileSync(path.join(FNS, f), 'utf8')
const uses = [
  ['coverage-run/index.ts', /trainLive && inTrainingAx\.has/, 'call-off fills and open hours cut In Training with the reason'],
  ['coverage-run/index.ts', /!\(trainLiveW && isInTraining\(g\?\.status\?\.label\)\)/, 'scheduled waves leave In Training out of the census'],
  ['coverage-shifts/index.ts', /p\.in_training && !p\.work_locked\) \{ p\.work_locked = true; p\.work_lock_why = IN_TRAINING_WHY/, 'Team Builder pool flags In Training (never hidden)'],
  ['coverage-shifts/index.ts', /trainLiveM && isInTraining/, 'the intake matcher leaves In Training out'],
  ['schedule-push/index.ts', /isInTraining\(g\?\.status\?\.label\)\) locked\.add/, 'schedule push holds In Training back like the readiness lock'],
  ['availability-checkin/index.ts', /isWorking\(r\.active, r\.status_label, trainLive\)/, 'the 30-day availability text skips In Training'],
  ['family-offer/index.ts', /isWorking\(r\.active, r\.status_label, trainLive\)/, 'family visit offers skip In Training'],
  ['match-dark/index.ts', /rowWorking\(g, trainLive\)/, 'the nightly match report leaves In Training out'],
  ['_shared/shift-ask-gate.ts', /isInTraining\(live\.label\) && await inTrainingLive\(sb\)/, 'the shift-text gate refuses In Training'],
]
for (const [f, re, what] of uses) ck(what + ' (' + f + ')', re.test(src(f)))
ck('the call-off list ("Who\'s calling off?") still lists everyone active, so a real call-in is never lost', /if \(g\?\.status\?\.active !== true\) continue\n/.test(src('coverage-shifts/index.ts')))

console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
