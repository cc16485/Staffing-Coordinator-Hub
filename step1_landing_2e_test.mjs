// SLICE 2e: the converters (grid to windows, answers to skills) and the landing at connect against a fake database. node step1_landing_2e_test.mjs
import path from 'path'
const FN = path.join(path.dirname(new URL(import.meta.url).pathname), 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
globalThis.Deno = { env: { get: () => '' } }
const L = await import(path.join(FN, '_shared/step1-landing.ts'))
const AT = '2026-10-10T15:00:00Z'
const A = { windows: { Monday: { Morning: true, Afternoon: true, 'Hours (optional)': '7-3' }, Tuesday: { 'Not available': true }, Saturday: { Overnight: true } }, hours_ideal: 30, hours_min: 20, hours_max: 40, shift_prefs: ['Morning shifts', 'Weekends'], max_miles: '20 miles', open_shift_texts: 'yes', text_consent: 'yes',
  level1: 'Yes', level2: 'Yes', level3: 'Not at this time', specialties: { "Alzheimer's disease": 'Yes', 'Hospice clients': 'Not at this time', 'Clients requiring Hoyer lift assistance (if trained)': 'Yes' }, matching_facts: { 'Homes with cats': 'Yes', 'Homes with dogs': 'Not at this time', 'Driving clients to appointments and errands': 'Yes', 'Clients who use a gait belt': 'Yes' },
  languages: ['English', 'Spanish', 'Another language'], languages_other: 'Hmong', experience: '2 to 5 years', preferred_levels: 'Levels 1 & 2', exclusions: 'No smokers please' }
/* converters */
const av = L.availabilityItem(A, { id: 207, name: 'Ava Lee', axiscare_id: 9001, phone: '(417) 555-0101' }, AT)
ck('the grid becomes windows by day with the record keys; Not available is an empty day; untouched days are empty', JSON.stringify(av.windows) === JSON.stringify({ mon: ['morning', 'afternoon'], tue: [], wed: [], thu: [], fri: [], sat: ['overnight'], sun: [] }), av.windows)
ck('target hours = ideal; the rest rides under step1; source step1; keyed by roster id and AxisCare id', av.target_hours === 30 && av.step1.hours_min === 20 && av.step1.hours_max === 40 && av.step1.hours_by_day.mon === '7-3' && av.step1.max_miles === '20 miles' && av.source === 'step1' && av.id === '207' && av.axiscare_id === '9001' && av.phone_digits === '4175550101', av)
ck('no grid, no availability item', L.availabilityItem({ hours_ideal: 30 }, { id: 1, name: 'x', axiscare_id: 2 }, AT) === null && L.availabilityItem({ windows: { Monday: { 'Not available': true } } }, { id: 1, name: 'x', axiscare_id: 2 }, AT) === null)
const ov = L.overlayPatch(A, AT)
ck('skills: Level 2 willing = personal_care yes; Alzheimer\'s = dementia_care yes; hospice not at this time = hospice_support no; Hoyer (if trained) = hoyer_lift yes; gait belt = transfers_gait_belt yes; cats yes, dogs no',
  ov.skills.personal_care.have === 'yes' && ov.skills.dementia_care.have === 'yes' && ov.skills.hospice_support.have === 'no' && ov.skills.hoyer_lift.have === 'yes' && ov.skills.transfers_gait_belt.have === 'yes' && ov.skills.ok_cats.have === 'yes' && ov.skills.ok_dogs.have === 'no', ov.skills)
ck('every landed skill is attested, by Step 1, dated, with a note', Object.values(ov.skills).every((s) => s.evidence === 'attested' && s.by === L.STEP1_BY && s.at === AT && s.note.length > 10))
ck('driving and Level 3 land nothing: no transportation, no complex_care', !('transportation' in ov.skills) && !('complex_care' in ov.skills) && !('ok_smoking' in ov.skills))
ck('fields: languages incl. the other one, max miles, preferred levels, exclusions, experience, all marked as said', JSON.stringify(ov.fields.languages) === JSON.stringify(['English', 'Spanish', 'Another language', 'Hmong']) && ov.fields.max_miles === '20 miles' && ov.fields.preferred_levels_said === 'Levels 1 & 2' && ov.fields.exclusions_said === 'No smokers please' && ov.fields.experience_said === '2 to 5 years', ov.fields)
/* the landing against a fake database */
function fake(init) {
  const t = { app_data: init.app_data, step1_forms: init.step1_forms || [] }; const calls = []
  const q = (table) => { const f = []; const b = { select() { return b }, eq(k, v) { f.push((r) => String(r[k]) === String(v)); return b }, async maybeSingle() { return { data: (t[table] || []).filter((r) => f.every((x) => x(r)))[0] ?? null, error: null } } }; return b }
  return { from: q, rpc: async (name, args) => { calls.push([name, JSON.parse(JSON.stringify(args))]); if (name !== 'upsert_app_data_item') return { error: { message: 'unknown' } }; const row = t.app_data.find((r) => r.key === args.target_key); const i = row.data.findIndex((x) => x.id === args.item.id); if (i >= 0) row.data[i] = args.item; else row.data.push(args.item); return { error: null } }, calls, t }
}
const CAND = { id: 50, first: 'Ava', last: 'Lee', phone: '(417) 555-0101', offer_id: 'off-1' }, AX = { id: '9001', first: 'Ava', last: 'Lee', mobile: '1-417-555-0101' }
const SIGNED = { availability: { at: AT }, experience: { at: AT } }
let db = fake({ app_data: [{ key: 'caregiver_availability', data: [] }, { key: 'caregiver_overlay', data: [] }], step1_forms: [{ offer_id: 'off-1', answers: A, signatures: SIGNED }] })
let r = await L.landAtConnect(db, CAND, 207, AX, AT)
ck('a moved candidate with signed Step 1 forms: availability landed, seven skills and five fields landed, through the item door only', r.availability === 'landed' && r.skills.length === 7 && r.fields.length === 5 && db.calls.length === 2 && db.calls.every((c) => c[0] === 'upsert_app_data_item'), { r, calls: db.calls.map((c) => c[1].target_key) })
const ovRow = db.t.app_data.find((x) => x.key === 'caregiver_overlay').data[0]
ck('the overlay item is keyed cgov_<axiscare id> with step1_landed_at and updated_by Step 1', ovRow.id === 'cgov_9001' && ovRow.axiscare_id === '9001' && ovRow.step1_landed_at === AT && ovRow.updated_by === L.STEP1_BY && ovRow.skills.personal_care.have === 'yes', ovRow)
db = fake({ app_data: [{ key: 'caregiver_availability', data: [{ id: '207', source: 'self', windows: { mon: ['evening'] } }] }, { key: 'caregiver_overlay', data: [{ id: 'cgov_9001', axiscare_id: '9001', skills: { personal_care: { have: 'no', evidence: 'observed', by: 'Krystal', at: '2026-09-01' } }, languages: ['English'] }] }], step1_forms: [{ offer_id: 'off-1', answers: A, signatures: SIGNED }] })
r = await L.landAtConnect(db, CAND, 207, AX, AT)
const ov2 = db.t.app_data.find((x) => x.key === 'caregiver_overlay').data[0]
ck('an existing availability record is kept; an existing skill (personal_care observed no) is kept; languages already set are kept; the other skills land', r.availability === 'kept (a record already exists)' && ov2.skills.personal_care.have === 'no' && ov2.skills.personal_care.by === 'Krystal' && JSON.stringify(ov2.languages) === '["English"]' && ov2.skills.dementia_care.have === 'yes' && r.skills.length === 6 && !r.fields.includes('languages'), { r, ov2 })
db = fake({ app_data: [{ key: 'caregiver_availability', data: [] }, { key: 'caregiver_overlay', data: [] }], step1_forms: [{ offer_id: 'off-1', answers: A, signatures: { availability: { at: AT } } }] })
r = await L.landAtConnect(db, CAND, 207, AX, AT)
ck('only the availability form signed: availability lands, no skills (the experience form is not signed)', r.availability === 'landed' && r.skills.length === 0 && db.calls.length === 1)
db = fake({ app_data: [{ key: 'caregiver_availability', data: [] }, { key: 'caregiver_overlay', data: [] }], step1_forms: [] })
r = await L.landAtConnect(db, CAND, 207, AX, AT)
ck('no Step 1 record: nothing lands, says why', r.availability === 'none' && r.why === 'no Step 1 record' && db.calls.length === 0, r)
r = await L.landAtConnect(db, { id: 51, first: 'Old', last: 'Path' }, 208, AX, AT)
ck('a candidate without an offer: nothing lands', r.why === 'no offer on the record' && db.calls.length === 0)
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
