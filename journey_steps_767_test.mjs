// 767 · the three new journey steps, run through the REAL journey-rules.js with the catalog plus 767's change.
//   node journey_steps_767_test.mjs
import fs from 'fs'
await import('./supabase/functions/_shared/journey-rules.js')
const R = globalThis.JourneyRules
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 600)])
const CAT = JSON.parse(fs.readFileSync('client-journey/catalog-v1.json', 'utf8')).steps
const A5 = JSON.parse(fs.readFileSync('client-journey/catalog-a5-767.json', 'utf8'))
export function apply767(defs, a5) {
  const out = defs.map((d) => ({ ...d }))
  for (const [k, p] of Object.entries(a5.patch)) { const d = out.find((x) => x.key === k); if (d) Object.assign(d, p) }
  const ac = out.find((x) => x.key === 'active.complete'); if (ac) ac.after = [...new Set([...(ac.after || []), ...a5.complete_after])]
  for (const n of a5.add) if (!out.some((x) => x.key === n.key)) out.push({ ...n })
  return out
}
const DEFS = apply767(CAT, A5)
ck('every new key fits the catalog\'s key rule and names a stage the rules know', A5.add.every((d) => /^[a-z0-9_.-]{3,60}$/.test(d.key) && R.STAGES.includes(d.stage) && d.title && Array.isArray(d.howto)))
ck('each new step comes after steps that exist', A5.add.every((d) => d.after.every((k) => DEFS.some((x) => x.key === k))))
const done = (keys) => keys.map((k) => ({ step_key: k, state: 'complete', completed_at: '2026-10-14T15:00:00Z' }))
const J = { journey_id: 'j', payer: 'private', status: 'open', assigned_cc: 'cc@x', target_start: '2026-10-30' }
const ctx = { today: '2026-10-15' }
let v = R.compute(DEFS, J, done(['intake.payer', 'intake.basics', 'asmt.book', 'asmt.outcome']), ctx)
ck('before the yes, the welcome call is not up', v.rows.find((r) => r.key === 'signed.welcome').status === 'later')
v = R.compute(DEFS, J, done(['intake.payer', 'intake.basics', 'asmt.book', 'asmt.outcome', 'signed.yes']), ctx)
const w = v.rows.find((r) => r.key === 'signed.welcome')
ck('after the yes, the welcome call is ready, for the Care Coordinator', ['ready', 'attention'].includes(w.status) && w.owner.email === 'cc@x', w)
ck('...and it is the next required step (it sorts right after the yes)', v.next && v.next.key === 'signed.welcome', v.next && v.next.key)
v = R.compute(DEFS, J, done(['intake.payer', 'intake.basics', 'asmt.book', 'asmt.outcome', 'signed.yes', 'signed.welcome', 'ax.client']), ctx)
const sd = v.rows.find((r) => r.key === 'ax.startdate')
ck('once the client is in AxisCare, Set the Start Date is up, due 2 days before the start', sd.status === 'ready' && sd.due === '2026-10-28', sd)
const allBut = DEFS.filter((d) => R.STAGES.indexOf(d.stage) < R.STAGES.indexOf('active') && (!d.payers.length || d.payers.includes('private')) && d.key !== 'fw.evv').map((d) => d.key)
v = R.compute(DEFS, J, done(allBut), ctx)
ck('everything done except the EVV check: the EVV check is up and Complete start of care waits for it', v.rows.find((r) => r.key === 'fw.evv').status !== 'later' && v.rows.find((r) => r.key === 'active.complete').status === 'later', v.rows.filter((r) => ['fw.evv', 'active.complete'].includes(r.key)).map((r) => [r.key, r.status, r.why]))
v = R.compute(DEFS, J, done([...allBut, 'fw.evv']), ctx)
ck('...with it done, Complete start of care is up', v.rows.find((r) => r.key === 'active.complete').status !== 'later')
ck('the First visit instructions say clock-in and clock-out', /clock-in and a clock-out/.test(DEFS.find((d) => d.key === 'fw.first_visit').howto[0]))
ck('no home safety step (part of the assessment, her answer 2026-10-15)', !DEFS.some((d) => /safety/i.test(d.key + d.title)))
ck('no em dash', !/—/.test(fs.readFileSync('client-journey/catalog-a5-767.json', 'utf8')))
let f = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (!ok) f++ }
console.log(`\n${res.length - f}/${res.length} passed`); process.exit(f ? 1 : 0)
