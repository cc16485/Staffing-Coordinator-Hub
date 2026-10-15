// 771: saved for future (Future Service Opportunities). The REAL shared rules file, and the three server jobs that must
// leave a saved family alone (no journey cards, no new-lead clocks, not open work in the morning brief). node future_saved_771_test.mjs
import fs from 'fs'; import { createRequire } from 'module'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 500)])
globalThis.window = globalThis; createRequire(import.meta.url)('./supabase/functions/_shared/lead-rules.js'); const R = globalThis.LeadRules
const l = { id: 'a', status: 'Contacted', client_city: 'Bolivar', county: 'Polk', schedule: { hours_per_week: 24 }, first_human_contact_at: '2026-10-01T00:00:00Z' }
ck('Saved is a lead status', R.STATUSES.includes('Saved'))
ck('save for future: status Saved with the reason, kind, county and permission (didn\'t ask counts as no)', R.saveForFuture(l, { key: 'no_caregiver', by: 'k@x' }) && l.status === 'Saved' && l.future.kind === 'staff' && l.future.county === 'Polk' && l.future.permission.answer === 'not_asked' && !R.mayContact(l))
ck('Other needs a note', R.futureRecord(l, { key: 'other' }) === null && !!R.futureRecord(l, { key: 'other', note: 'x' }))
ck('the three problems stay apart', R.futureRecord(l, { key: 'outside_area' }).kind === 'area' && R.futureRecord(l, { key: 'expansion' }).kind === 'area' && R.futureRecord(l, { key: 'schedule' }).kind === 'schedule')
const many = [1, 2, 3].map((i) => { const x = { id: 'p' + i, status: 'New', county: 'Polk', client_city: 'Bolivar' }; R.saveForFuture(x, { key: 'no_caregiver' }); return x })
const d = R.demand(many, () => ({ hours: 5, usd: 0 }))
ck('demand: 3 families in one county is worth acting on (her 3+ rule)', d.length === 1 && d[0].families === 3 && d[0].worth === true, d)
ck('demand: 40+ hours alone is worth acting on', R.demand([many[0]], () => ({ hours: 40 }))[0].worth === true)
ck('reactivate: the same lead goes back to the status it had, the saved record kept in its history', R.reactivate(l, { by: 'k', why: 'x' }) === 'Contacted' && l.status === 'Contacted' && !l.future && l.future_history.length === 1)
const src = (f) => fs.readFileSync('supabase/functions/' + f + '/index.ts', 'utf8')
ck('client-journey: no journey cards for a saved family, and no new journey opened for one', /savedForFuture\(ld\)\) cards = \[\]/.test(src('client-journey')) && /l\.status === 'Spam' \|\| l\.status === 'Saved'\) continue/.test(src('client-journey')))
ck('lead-watch: no new-lead clocks for a saved family', /\['Lost', 'Converted', 'Saved'\]\.includes/.test(src('lead-watch')))
ck('lead-digest: a saved family is not open work in the morning brief', (src('lead-digest').match(/l\?\.status !== 'Saved'/g) || []).length === 2)
ck('the server and the Hub run the same lead-rules.js', !process.env.HUB_ROOT || fs.readFileSync(process.env.HUB_ROOT + '/lead-rules.js', 'utf8') === fs.readFileSync('supabase/functions/_shared/lead-rules.js', 'utf8'))
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
