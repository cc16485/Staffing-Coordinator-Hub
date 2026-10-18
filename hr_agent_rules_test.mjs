// The HR agent's rules (HR Agent build step 4) · node hr_agent_rules_test.mjs
import fs from 'fs'; import os from 'os'; import path from 'path'
const res = []; const ck = (n, c, d) => res.push([n, !!c, c ? '' : String(JSON.stringify(d ?? null)).slice(0, 600)])
const tmp = path.join(os.tmpdir(), 'hrr' + process.pid + '.ts'); fs.copyFileSync('supabase/functions/_shared/hr-agent-rules.ts', tmp)
let R; try { R = await import(tmp) } finally { fs.unlinkSync(tmp) }
const NOW = Date.parse('2026-10-18T17:00:00Z')
const day = (n) => new Date(NOW - n * 864e5).toISOString().slice(0, 10)
let seq = 0; const ev = (cg, type, ago, extra = {}) => ({ id: 'e' + (++seq), axiscare_caregiver_id: String(cg), caregiver: 'CG ' + cg, type, shift_date: day(ago), ...extra })
const S = R.settingsFrom({ notice_hours: 4, callin_count: 3, callin_window: 90, tardy_grace: 7, tardy_count: 3, tardy_window: 90 }, {})
const run = (o) => R.findCases({ now: NOW, events: [], missedNotes: [], kindWords: [], prior: [], names: {}, settings: S, ...o })

// thresholds
ck('settings: the approved numbers, with 3 missed clock-ins in 30 days', S.evv_count === 3 && S.evv_window === 30 && S.callin_count === 3 && S.tardy_grace === 7)
ck('settings: ops_settings can change the clock-in numbers (Hub-editable config)', R.settingsFrom({}, { hr_evv_count: 5, hr_evv_window: 14 }).evv_count === 5)
ck('settings: nonsense falls back to the approved number', R.settingsFrom({ callin_count: 'x' }, { hr_evv_count: -1 }).callin_count === 3 && R.settingsFrom({}, { hr_evv_count: -1 }).evv_count === 3)

// w06 missed clock-ins/outs
let c = run({ events: [ev(1, 'evv_missing_out', 2), ev(1, 'evv_missing_in', 5), ev(1, 'evv_missing_out', 20)] })
ck('3 missed clock-ins/outs in 30 days: one coaching case', c.length === 1 && c[0].rule === 'w06' && c[0].kind === 'coaching' && c[0].facts.length === 3, c)
ck('...it quotes the handbook (2D)', /2D/.test(c[0].handbook))
ck('2 in 30 days: nothing', run({ events: [ev(2, 'evv_missing_out', 2), ev(2, 'evv_missing_out', 5)] }).length === 0)
ck('the third one 31 days ago does not count', run({ events: [ev(3, 'evv_missing_out', 2), ev(3, 'evv_missing_out', 5), ev(3, 'evv_missing_out', 31)] }).length === 0)
const many = Array.from({ length: 17 }, (_, i) => ev(4, 'evv_missing_out', i + 1))
ck('17 in 30 days: still ONE case, not 15', run({ events: many }).length === 1)
c = run({ events: many })
ck('...and the next morning, with that case on file, nothing new', run({ events: many, prior: [{ id: c[0].id, axiscare_caregiver_id: '4', rule: 'w06', created_at: day(0) }] }).length === 0)
ck('...nor a day later with one more miss (same episode inside the 30 days)', run({ events: [...many, ev(4, 'evv_missing_in', 0)], prior: [{ id: c[0].id, axiscare_caregiver_id: '4', rule: 'w06', created_at: day(1) }] }).length === 0)
const old = [{ id: 'hr_old', axiscare_caregiver_id: '5', rule: 'w06', kind: 'coaching', created_at: day(40) }]
c = run({ events: [ev(5, 'evv_missing_out', 1), ev(5, 'evv_missing_out', 2), ev(5, 'evv_missing_out', 3)], prior: old })
ck('the same rule again after an earlier case (40 days ago): recurring, for Zach', c.length === 1 && c[0].kind === 'recurring', c)
c = run({ events: [ev(5, 'evv_missing_out', 1), ev(5, 'evv_missing_out', 2), ev(5, 'evv_missing_out', 3)], prior: [{ ...old[0], review: 'disagree' }] })
ck('...unless that earlier case was marked wrong: coaching again', c[0].kind === 'coaching')
c = run({ events: [ev(5, 'evv_missing_out', 1), ev(5, 'evv_missing_out', 2), ev(5, 'evv_missing_out', 3)], prior: [{ ...old[0], created_at: day(120) }] })
ck('...or it was more than 90 days ago: coaching again', c[0].kind === 'coaching')

// reviewed events never count again
ck('events already reviewed (a good reason or a write-up) do not count', run({ events: [ev(6, 'evv_missing_out', 1, { action_id: 'no_writeup' }), ev(6, 'evv_missing_out', 2), ev(6, 'evv_missing_out', 3)] }).length === 0)
ck('name-only records (no AxisCare number) are left to a person', run({ events: [1, 2, 3].map((n) => ({ ...ev(7, 'evv_missing_out', n), axiscare_caregiver_id: '' })) }).length === 0)

// w02 call-ins, w03 tardies
c = run({ events: [ev(8, 'callin', 10, { notice_hours: 12 }), ev(8, 'callin', 40, { notice_hours: 24 }), ev(8, 'callin', 80, { notice_hours: 24 })] })
ck('3 call-ins in 90 days (good notice): one coaching case', c.length === 1 && c[0].rule === 'w02', c)
ck('2 call-ins: nothing', run({ events: [ev(9, 'callin', 10, { notice_hours: 12 }), ev(9, 'callin', 40, { notice_hours: 24 })] }).length === 0)
c = run({ events: [ev(10, 'tardy', 5, { minutes_late: 12 }), ev(10, 'tardy', 10, { minutes_late: 9 }), ev(10, 'tardy', 15, { minutes_late: 20 })] })
ck('3 late arrivals over 7 minutes in 90 days: coaching', c.length === 1 && c[0].rule === 'w03')
ck('a 5-minute late arrival does not count (grace is 7)', run({ events: [ev(11, 'tardy', 5, { minutes_late: 12 }), ev(11, 'tardy', 10, { minutes_late: 5 }), ev(11, 'tardy', 15, { minutes_late: 20 })] }).length === 0)

// w01 short notice
c = run({ events: [ev(12, 'callin', 3, { notice_hours: 2 })] })
ck('a call-in with 2 hours notice: a short-notice case', c.length === 1 && c[0].rule === 'w01' && /2h notice/.test(c[0].title), c)
c = run({ events: [{ ...ev(13, 'callin', 3, { shift_time: '08:00', notice_hours: 13 }), reported_at: day(4) + 'T19:00' }] })
ck('a call at 7 PM the night before an 8 AM shift: short notice', c.length === 1 && /after 5 PM/.test(c[0].title), c)
ck('a call at 4:30 PM the day before: fine', run({ events: [{ ...ev(14, 'callin', 3, { shift_time: '08:00', notice_hours: 15.5 }), reported_at: day(4) + 'T16:30' }] }).length === 0)
ck('a server timestamp is read in Central time (23:30Z = 6:30 PM CDT, short)', run({ events: [{ ...ev(15, 'callin', 3, { shift_time: '08:00', notice_hours: 13.5 }), reported_at: day(4) + 'T23:30:00Z' }] }).length === 1)

// w04 no-call/no-show
c = run({ events: [ev(16, 'ncns', 2)] })
ck('a no-call/no-show: serious, straight to Zach', c.length === 1 && c[0].kind === 'serious' && c[0].rule === 'w04' && /2U/.test(c[0].handbook))

// w05 missed notes
const mn = (cg, ago, extra = {}) => ({ id: ++seq, axiscare_caregiver_id: String(cg), caregiver_name: 'CG ' + cg, shift_date: day(ago), status: 'unresolved', counts: true, ...extra })
c = run({ missedNotes: [mn(17, 1), mn(17, 8), mn(17, 20, { status: 'recovered' })] })
ck('3 counted missed notes in 30 days: coaching', c.length === 1 && c[0].rule === 'w05' && c[0].facts.some((f) => /texted in later/.test(f.what)), c)
ck('misses that do not count (web clock-outs, practice) are ignored', run({ missedNotes: [mn(18, 1), mn(18, 8, { counts: false }), mn(18, 20, { status: 'practice' })] }).length === 0)

// recognition
c = run({ kindWords: [{ id: 5, status: 'kind', quote: 'She made Mom laugh again', who: 'Mrs. H', link: { type: 'caregiver', id: '19' }, created_at: day(3) + 'T10:00:00Z' }] })
ck('kind words about a caregiver: recognition', c.length === 1 && c[0].kind === 'recognition' && /laugh/.test(c[0].facts[0].what), c)
ck('kind words not linked to a caregiver are left alone', run({ kindWords: [{ id: 6, status: 'kind', quote: 'x', link: null, about: 'Jane D.', created_at: day(3) }] }).length === 0)

// names, ids, determinism
c = run({ events: [ev(20, 'ncns', 1)], names: { 20: 'Jordan Miller' } })
ck('the roster name is used when known', c[0].caregiver === 'Jordan Miller')
const E = [ev(21, 'evv_missing_out', 1), ev(21, 'evv_missing_out', 2), ev(21, 'evv_missing_out', 3)]
ck('the same input gives the same case id (safe to run twice)', run({ events: E })[0].id === run({ events: E })[0].id)
ck('no em dashes in anything a person reads', !/—/.test(JSON.stringify(run({ events: [...E, ev(22, 'ncns', 1), ev(23, 'callin', 2, { notice_hours: 1 })] }))) && !/—/.test(JSON.stringify(R.HANDBOOK)))

let f = 0; for (const [n, ok, d] of res) { console.log((ok ? 'PASS' : 'FAIL') + ' · ' + n + (ok ? '' : '  ' + d)); if (!ok) f++ }
console.log((res.length - f) + '/' + res.length); process.exit(f ? 1 : 0)
