// 2026-10-31 (Samantha: "fix the AxisCare caregiver read everywhere as proposed, with the safety stop on class changes"). AxisCare's
// one-caregiver answer is { results: { data: {...} } } (the 2026-09-20 field probe). The shared reader, and the class changes in
// _shared/axiscare-caregiver.ts and _shared/nurse-hire.ts, against a fake AxisCare. Nothing real is reached.
// node axis_caregiver_read_test.mjs
import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
globalThis.Deno = { env: { get: (k) => ({ AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' })[k] } }
const F = path.join(process.cwd(), 'supabase/functions/_shared')
const R = await import(path.join(F, 'axis-caregiver-read.ts'))
const AC = await import(path.join(F, 'axiscare-caregiver.ts'))
const NH = await import(path.join(F, 'nurse-hire.ts'))
const SET = await import(path.join(F, 'axis-setup.ts'))

const REC = { id: 530, firstName: 'Ana', status: { active: true, label: 'Active' }, hireDate: '2025-03-01', classes: [{ code: 'L3', label: 'LEVEL 3 ADVANCED CARE' }, { code: 'ALZ', label: 'ALZHEIMER CERTIFIED' }] }
ck("AxisCare's real answer (results.data) is read", R.caregiverOf({ results: { data: REC } })?.id === 530)
ck('...the older shapes still read', R.caregiverOf({ results: { caregiver: REC } })?.id === 530 && R.caregiverOf({ caregiver: REC })?.id === 530 && R.caregiverOf(REC)?.id === 530)
ck('...the { data } wrapper is never mistaken for the caregiver; no id = nothing', R.caregiverOf({ results: { data: { firstName: 'x' } } }) === null && R.caregiverOf({ results: {} }) === null && R.caregiverOf(null) === null && R.caregiverOf({ results: [REC] }) === null)
ck('safety stop: classes seen only when the answer carries the list (an empty list is fine: a new hire)', R.classesSeen(REC) && R.classesSeen({ ...REC, classes: [] }) && !R.classesSeen({ id: 1 }) && !R.classesSeen(null))

/* a fake AxisCare: GET one caregiver, the class list, PATCH */
let CG, PATCHES, SHAPE
const VOCAB = [{ code: 'L1', label: 'LEVEL 1 COMPANION' }, { code: 'L2', label: 'LEVEL 2 PERSONAL CARE' }, { code: 'L3', label: 'LEVEL 3 ADVANCED CARE' }, { code: 'LPN', label: 'LPN' }, { code: 'ALZ', label: 'ALZHEIMER CERTIFIED' }]
const send = async (url, o = {}) => { url = String(url); const m = o.method || 'GET'
  if (url.endsWith('/api/classes/caregiver')) return new Response(JSON.stringify({ results: { classes: VOCAB } }), { status: 200 })
  if (/\/api\/caregivers\/\d+$/.test(url)) {
    if (m === 'PATCH') { const b = JSON.parse(o.body); PATCHES.push(b); if (b.classes) CG.classes = b.classes.map((c) => VOCAB.find((v) => v.code === c.code || v.label === c.label) || c); return new Response('{}', { status: 200 }) }
    return new Response(JSON.stringify(SHAPE === 'data' ? { results: { data: CG } } : SHAPE === 'noclasses' ? { results: { data: { ...CG, classes: undefined } } } : { results: { caregiver: CG } }), { status: 200 }) }
  return new Response('{}', { status: 404 }) }
const reset = (shape = 'data', cls = REC.classes) => { CG = { ...REC, classes: cls.slice() }; PATCHES = []; SHAPE = shape }
const db = { rpc: async () => ({ data: { outcome: 'recorded' }, error: null }) }

reset(); let r = await AC.readCaregiverStatus('530', send)
ck("Approved to Work's status read works on AxisCare's real answer", r.ok && r.active === true && r.label === 'Active' && r.hire_date === '2025-03-01', r)
reset(); ck('the hiring hand-off reads the caregiver', (await SET.axisCaregiver('530', send))?.firstName === 'Ana')
reset(); r = await AC.setCaregiverLevel(db, '530', 2, 'K', 'test', true, send)
ck('Level 3 to Level 2: the level class is swapped and every other class kept', r.outcome === 'confirmed' && CG.classes.map((c) => c.label).sort().join('|') === 'ALZHEIMER CERTIFIED|LEVEL 2 PERSONAL CARE', [r, CG.classes])
reset('noclasses'); r = await AC.setCaregiverLevel(db, '530', 2, 'K', 'test', true, send)
ck("safety stop: Level change when AxisCare's answer has no class list = refused, nothing sent", r.outcome === 'refused' && /didn't include their classes/.test(r.detail) && !PATCHES.length, r)
reset('data', []); r = await AC.setCaregiverLevel(db, '530', 1, 'K', 'test', true, send)
ck('a brand-new hire with no classes yet: their Level is added', r.outcome === 'confirmed' && CG.classes.map((c) => c.label).join() === 'LEVEL 1 COMPANION', [r, CG.classes])
reset(); r = await NH.setCaregiverNurseClass(db, '530', 'LPN', 'K', 'test', true, send)
ck('nurse hire: the LPN class is added and every other class kept', r.outcome === 'confirmed' && CG.classes.map((c) => c.label).sort().join('|') === 'ALZHEIMER CERTIFIED|LEVEL 3 ADVANCED CARE|LPN', [r, CG.classes])
reset('noclasses'); r = await NH.setCaregiverNurseClass(db, '530', 'LPN', 'K', 'test', true, send)
ck('safety stop: nurse class with no class list in the answer = refused, nothing sent', r.outcome === 'refused' && /didn't include their classes/.test(r.detail) && !PATCHES.length, r)
reset('old'); r = await AC.readCaregiverStatus('530', send); ck('the older answer shape still works (fallback)', r.ok && r.active === true)

for (const [n, o, d] of res) console.log((o ? 'PASS ' : 'FAIL ') + n + (o ? '' : '  ' + d))
const f = res.filter((x) => !x[1]); console.log(`\n${res.length - f.length}/${res.length} passed`); process.exit(f.length ? 1 : 0)
