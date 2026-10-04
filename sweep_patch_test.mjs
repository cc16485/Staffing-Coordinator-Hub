// 441 · the sweep's caregiver save (_shared/sweep-patch.ts) and how eligibility-sweep uses it. node sweep_patch_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 600)])
const P = await import(path.join(FN, '_shared/sweep-patch.ts'))
const clone = (x) => JSON.parse(JSON.stringify(x))
function db(list, opt = {}) {   /* does what caregiver_sweep_patch does */
  const d = { list: clone(list), calls: [] }
  d.rpc = async (fn, a) => { d.calls.push([fn, clone(a)])
    if (opt.error) return { error: { message: 'down' } }
    if (opt.editBefore) { const f = opt.editBefore; opt.editBefore = null; f(d) }
    const r = d.list.find((x) => String(x.id) === a.p_id); if (!r) return { data: { ok: false, reason: 'gone' } }
    if (P.rev(r) !== a.p_base_rev) return { data: { ok: false, reason: 'changed', current_record: clone(r) } }
    Object.assign(r, a.p_patch); r._rev = P.rev(r) + 1; return { data: { ok: true, rev: r._rev } } }
  return d
}
const recompute = (f) => { f.eligibility_state = f.ojt_date ? 'eligible' : 'lapsed'; f.eligibility_at = 'now' }
let D = db([{ id: 5, first: 'Jo', phone: '1', _rev: 3 }])
let c = { id: 5, first: 'Jo', phone: '1', _rev: 3, eligibility_state: 'lapsed', eligibility_history: [{ s: 'lapsed' }], eligibility_reason: 'OJT', eligibility_at: 't', axiscare_note_for: 'ojt_overdue@x' }
let r = await P.saveSweepFields(D, c, recompute)
ck('saves only the five sweep fields, on the _rev it read', r === 'saved' && JSON.stringify(Object.keys(D.calls[0][1].p_patch).sort()) === JSON.stringify(P.SWEEP_FIELDS.slice().sort()) && D.calls[0][1].p_base_rev === 3 && D.list[0].phone === '1', D.calls)
D = db([{ id: 5, first: 'Jo', phone: '1', _rev: 3 }], { editBefore: (d) => { d.list[0].phone = '2'; d.list[0].ojt_date = '2026-10-01'; d.list[0]._rev = 4 } })
r = await P.saveSweepFields(D, clone(c), recompute)
ck('an office edit lands during the run: worked out again on the current record, the edit kept', r === 'saved' && D.list[0].phone === '2' && D.list[0].eligibility_state === 'eligible' && D.calls.length === 2 && D.calls[1][1].p_base_rev === 4, [D.list, D.calls.length])
D = db([{ id: 5, _rev: 0 }]); D.rpc = async () => ({ data: { ok: false, reason: 'changed', current_record: { id: 5, _rev: 9 } } })
ck('still changing after 3 tries: skipped (next run)', (await P.saveSweepFields(D, clone(c), recompute)) === 'skipped')
ck('no number: skipped, nothing sent', (await P.saveSweepFields(db([]), { first: 'X' }, recompute)) === 'skipped')
ck('gone: skipped', (await P.saveSweepFields(db([]), clone(c), recompute)) === 'skipped')
ck('the database down: error', (await P.saveSweepFields(db([{ id: 5, _rev: 3 }], { error: true }), clone(c), recompute)) === 'error')
const SW = fs.readFileSync(path.join(FN, 'eligibility-sweep/index.ts'), 'utf8')
ck('the sweep never saves a whole caregiver record any more', !/target_key: 'caregivers'/.test(SW) && /saveSweepFields\(supabase, c,/.test(SW))
ck('...and on a retry it re-derives eligibility and keeps this run\'s note outcome', /E\.eligRecord\(fresh, E\.eligibility\(fresh\)\); fresh\.axiscare_note_for = noteFor/.test(SW))
ck('no em dash', !/—/.test(fs.readFileSync(path.join(FN, '_shared/sweep-patch.ts'), 'utf8') + fs.readFileSync(path.join(ROOT, 'sweep_fields.sql'), 'utf8')))
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
