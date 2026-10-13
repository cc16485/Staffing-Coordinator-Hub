// TRACK 1a (Samantha 2026-10-11: "Please complete everything you can using test data and automated tests ... I want more than
// one practice applicant ... Make sure missing information never gets interpreted as verified experience or an approved
// qualification"). Ten made-up applicants go through the real Step 1 server (every form signed in order), land on Background
// & References, have their references asked and answered through the real reference-tasks server, and are read back through
// the real skills picture the profile shows. A fake database; nothing real is touched. node practice_scenarios_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const L = await import(path.join(FN, '_shared/applicant-links.ts'))
const D = await import(path.join(FN, '_shared/step1-documents.ts'))
const E = await import(path.join(FN, '_shared/step1-experience.ts'))
const SECRET = 's'.repeat(48), KEK = Buffer.alloc(32, 7).toString('base64')
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', HUB_JOB_SECRET: SECRET, STEP1_KEK: KEK, OFFERS_PROJECT_URL: 'http://trn', OFFERS_SERVICE_ROLE_KEY: 'tkey' }
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
const OFFERS = {}, EVENTS = [], SENT = []
globalThis.fetch = async (url, o = {}) => {
  const u = String(url)
  if (u.startsWith('http://trn/rest/v1/job_offers')) {
    const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(u)[1])
    if ((o.method || 'GET') === 'GET') return new Response(JSON.stringify(OFFERS[id] ? [OFFERS[id]] : []), { status: 200 })
    const body = JSON.parse(o.body); const guard = /&(\w+)=is\.null/.exec(u)
    if (!OFFERS[id] || (guard && OFFERS[id][guard[1]] != null)) return new Response('[]', { status: 200 })
    Object.assign(OFFERS[id], body); return new Response(JSON.stringify([OFFERS[id]]), { status: 200 })
  }
  if (u.startsWith('http://trn/rest/v1/offer_events')) { EVENTS.push(JSON.parse(o.body)); return new Response('', { status: 201 }) }
  SENT.push(u); throw new Error('unexpected network call ' + u)
}
/* ── a tiny table store with the query shapes the function uses ── */
let DB = { step1_forms: [], step1_identity: [], job_applicants: [], document_access_log: [], auth_identities: [], persons: [], entity_memberships: [], staff_roles: [], app_data: [] }
const STORE = {}
const getPath = (r, p) => p.split('->').reduce((a, k) => a == null ? undefined : a[k], r)
function table(name) {
  const rows = () => DB[name]
  const q = (mode, payload, filters = [], opts = {}) => {
    const match = (r) => filters.every((f) => f(r))
    const run = () => {
      if (mode === 'select') { let out = rows().filter(match); if (opts.order) out = [...out].reverse(); if (opts.limit) out = out.slice(0, opts.limit); return out.map((r) => JSON.parse(JSON.stringify(r))) }
      if (mode === 'insert') { const r = { ...payload }; if (name === 'step1_forms') Object.assign(r, { answers: {}, signatures: {}, pdfs: {}, ...r }); if ((name === 'step1_forms' || name === 'step1_identity') && rows().some((x) => x.offer_id === r.offer_id)) throw Object.assign(new Error('duplicate key'), { code: '23505' }); rows().push(r); return [r] }
      if (mode === 'upsert') { const i = rows().findIndex((x) => x.offer_id === payload.offer_id); if (i >= 0) Object.assign(rows()[i], payload); else rows().push({ ...payload }); return [rows()[i >= 0 ? i : rows().length - 1]] }
      if (mode === 'update') { const out = []; for (const r of rows()) if (match(r)) {
        if (name === 'step1_forms') { for (const k of Object.keys(r.signatures || {})) if (payload.signatures && JSON.stringify(payload.signatures[k]) !== JSON.stringify(r.signatures[k])) throw new Error('trigger: signature never changed')
          for (const k of Object.keys(r.pdfs || {})) if (payload.pdfs && payload.pdfs[k] !== r.pdfs[k]) throw new Error('trigger: pdf never replaced') }
        Object.assign(r, payload); out.push(r) } return out }
    }
    const api = {
      eq: (k, v) => q(mode, payload, [...filters, (r) => String(getPath(r, k)) === String(v)], opts),
      is: (k, v) => q(mode, payload, [...filters, (r) => (v === null ? getPath(r, k) == null : getPath(r, k) === v)], opts),
      filter: (k, op, v) => q(mode, payload, [...filters, (r) => op === 'is' && v === null ? getPath(r, k) == null : false], opts),
      like: (k, v) => q(mode, payload, [...filters, (r) => { const pat = '^' + String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'; return new RegExp(pat).test(String(getPath(r, k) ?? '')) }], opts),
      ilike: (k, v) => q(mode, payload, [...filters, (r) => { const pat = '^' + String(v).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'; return new RegExp(pat).test(String(r[k] ?? '').toLowerCase()) }], opts),
      order: () => q(mode, payload, filters, { ...opts, order: true }), limit: (n) => q(mode, payload, filters, { ...opts, limit: n }),
      select: () => q(mode, payload, filters, opts),
      maybeSingle: async () => { try { const r = run(); return { data: r[0] ?? null, error: null } } catch (e) { return { data: null, error: { message: e.message } } } },
      then: (ok) => { try { ok({ data: run(), error: null }) } catch (e) { ok({ data: null, error: { message: e.message } }) } },
    }
    return api
  }
  return { select: () => q('select'), insert: (p) => q('insert', p), upsert: (p) => q('upsert', p), update: (p) => q('update', p) }
}
const UPLOADS = new Set()
const storage = { from: (bucket) => ({ createSignedUploadUrl: async (p) => { UPLOADS.add(bucket + ':' + p); return { data: { token: 't', signedUrl: 'https://upload/' + p }, error: null } }, list: async (dir, o) => ({ data: [...UPLOADS].filter((x) => x.startsWith(bucket + ':' + dir + '/')).map((x) => ({ name: x.slice((bucket + ':' + dir + '/').length) })).filter((x) => !o?.search || x.name === o.search), error: null }), upload: async (p, bytes, o) => { if (STORE[p] && !o?.upsert) return { error: { message: 'exists' } }; STORE[p] = bytes; return { data: { path: p }, error: null } }, createSignedUrl: async (p) => ({ data: STORE[p] ? { signedUrl: 'https://signed/' + p } : null, error: STORE[p] ? null : { message: 'no' } }) }) }
DB.reference_requests = []; DB.client_journey = []; DB.client_journey_event = []
/* the database doors Step 1 uses, as the installed SQL behaves: the record is made once per offer, the landing fills blanks */
let NEXT_ID = 900
globalThis.__fakeCreateClient = () => ({ from: table, storage, auth: { getUser: async () => ({ data: null, error: { message: 'no' } }) }, rpc: async (name, args) => {
  const cands = () => { let r = DB.app_data.find((x) => x.key === 'candidates'); if (!r) { r = { key: 'candidates', data: [] }; DB.app_data.push(r) } return r.data }
  if (name === 'step1_candidate_create') { const c = cands(); const had = c.find((x) => x.offer_id === args.p_offer_id); if (had) return { data: { ok: true, created: false, how: 'already', id: had.id }, error: null }
    const rec = { ...args.p_record, id: ++NEXT_ID, offer_id: args.p_offer_id }; c.push(rec); return { data: { ok: true, created: true, how: 'created', id: rec.id }, error: null } }
  if (name === 'step1_land_apply') { const c = cands().find((x) => x.offer_id === args.p_offer_id); if (!c) return { data: { ok: false, reason: 'no_candidate' }, error: null }
    const filled = []; for (const [k, v] of Object.entries(args.p_patch)) { if (k === 'step1_landed') { c.step1_landed = { ...(c.step1_landed || {}), ...v }; continue } if (c[k] == null || c[k] === '' || c[k] === 'Pending' && /^r\ds$/.test(k)) { c[k] = v; filled.push(k) } } return { data: { ok: true, candidate_id: c.id, filled }, error: null } }
  if (name === 'upsert_app_data_item') { let r = DB.app_data.find((x) => x.key === args.target_key); if (!r) { r = { key: args.target_key, data: [] }; DB.app_data.push(r) } r.data = [...r.data.filter((x) => x.id !== args.item.id), args.item]; return { data: null, error: null } }
  return { data: null, error: { message: 'unexpected ' + name } } } })
const load = async (fn) => { const s = fs.readFileSync(path.join(FN, fn, 'index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient'); const tmp = path.join(FN, fn, '_sc.ts'); fs.writeFileSync(tmp, s); try { await import(tmp) } finally { fs.unlinkSync(tmp) } return handler }
const STEP1 = await load('step1-sign'), REFS = await load('reference-tasks')
const post = async (h, body) => { const r = await h(new Request('http://x', { method: 'POST', headers: { 'Content-Type': 'application/json', 'user-agent': 'ScenarioPhone' }, body: JSON.stringify(body) })); let j = {}; try { j = await r.json() } catch {} return { status: r.status, j } }

/* ───── the same complete answers for every made-up applicant; each scenario changes only what it is about ───── */
const week = { Monday: { Morning: true }, Tuesday: { Morning: true }, Wednesday: { Afternoon: true }, Thursday: { Afternoon: true }, Friday: { Morning: true }, Saturday: { 'Not available': true }, Sunday: { 'Not available': true } }
const base = (o = {}) => ({
  screen2: { preferred_name: o.first, lived_outside_mo: 'no', hs_name: 'Nixa High', cna: 'no', hha: 'no', moving_violations: 'no', license_suspended: 'no', convicted: 'no' },
  screen3: { jobs: o.jobs, family_care: o.family_care, ...(o.no_jobs ? { no_employer_history: 'yes' } : {}) },
  screen4: { professional_refs: o.pro, personal_refs: o.per, backup_refs: o.backups },
  screen5b: { address1: '1 Practice Way', city: 'Nixa', state: 'MO', zip: '65714' },
  screen6: { windows: week, hours_ideal: 30, hours_min: 20, hours_max: 40, shift_prefs: ['Morning shifts'], max_miles: '20 miles', open_shift_texts: 'yes', text_consent: 'yes' },
  screen7: { level1: 'Yes', level2: 'Yes', level3: 'Not at this time', specialties: Object.fromEntries(D.SPECIALTIES.map((x) => [x, (o.notNow || []).includes(x) ? 'Not at this time' : 'Yes'])),
    matching_facts: Object.fromEntries(D.MATCHING_FACTS.map((m) => [m.label, (o.notNow || []).includes(m.label) ? 'Not at this time' : 'Yes'])), languages: ['English'], experience: o.experience || '2 to 5 years', preferred_levels: 'Any level I\'m qualified for', ...(o.exclusions ? { exclusions: o.exclusions } : {}) },
  screen8: { transport_willing: 'yes', license_state: 'MO', license_expires: '2029-01-01', insurer: 'Practice Mutual', insurance_expires: '2027-06-30' },
})
const job = (company, sup, tasks, x = {}) => ({ company, city_state: 'Springfield, MO', role: 'Caregiver', from: 'March 2019', to: 'June 2023', supervisor: sup, phone: '417-555-0181', may_contact: 'yes', reason_leaving: 'Moved', did_care: 'yes', tasks, refresher: ['none'], ...x })
const R = (name, company, may = 'yes', x = {}) => ({ name, company, role: 'Supervisor', phone: '417-555-0181', may_contact: may, ...x }), P = (name, rel, may = 'yes') => ({ name, relationship: rel, email: name.split(' ')[0].toLowerCase() + '@practice.invalid', may_contact: may })

/* ───── the ten scenarios ───── */
const S = [
  { key: 'experienced', first: 'Avery', jobs: [job('Home Helpers', 'Jane Boss', ['bathing', 'toileting', 'transfers_gait_belt', 'dementia_care']), job('Visiting Angels', 'Tom Lead', ['bathing', 'bedbound_care', 'hospice_support'])],
    pro: [R('Jane Boss', 'Home Helpers'), R('Tom Lead', 'Visiting Angels')], per: [P('Sue Friend', 'Friend'), P('Bo Neighbor', 'Neighbor')],
    answers: { 'Jane Boss': { bathing: 'saw', toileting: 'saw', transfers_gait_belt: 'saw', dementia_care: 'saw' }, 'Tom Lead': { bathing: 'saw', bedbound_care: 'saw', hospice_support: 'believe' } } },
  { key: 'family_confirmed', first: 'Blake', no_jobs: true, family_care: [{ who: 'A family member', relationship: 'my grandmother', from: '2022', to: '2025', paid: ['Not paid'], tasks: ['bathing', 'hospice_support', 'catheter_bag'], refresher: ['none'], confirmer: 'Kay Nurse', confirmer_how: 'her hospice nurse', phone: '417-555-0182', may_contact: 'yes' }],
    pro: [], per: [P('Kay Nurse', 'Hospice nurse'), P('Lin Pastor', 'Pastor')], answers: { 'Kay Nurse': { bathing: 'saw', hospice_support: 'saw', catheter_bag: 'unknown' } } },
  { key: 'family_unconfirmed', first: 'Casey', no_jobs: true, family_care: [{ who: 'A private client', from: '2021', to: '2024', paid: ['The client or family paid me directly', 'A VA program'], tasks: ['bathing', 'bedbound_care', 'hoyer_lift'], lifts: ['Sit-to-stand'], refresher: ['hoyer_lift'] }],
    pro: [], per: [P('Dee Friend', 'Friend'), P('Eli Friend', 'Friend')], answers: {} },
  { key: 'missing_refs', first: 'Drew', jobs: [job('Home Helpers', 'Jane Boss', ['bathing', 'dementia_care']), job('Comfort Keepers', 'Gil Gone', ['bedbound_care'])],
    pro: [R('Jane Boss', 'Home Helpers'), R('Gil Gone', 'Comfort Keepers'), R('No Call', 'Old Job', 'no')], per: [P('Fay Friend', 'Friend'), P('Gus Friend', 'Friend')],
    backups: [{ type: 'Professional', name: 'Hal Backup', relationship: 'Scheduler at Comfort Keepers', phone: '417-555-0184', may_contact: 'yes' }], answers: {}, silent: ['Gil Gone'] },
  { key: 'hoyer_refresher', first: 'Emery', jobs: [job('Brookside Care', 'Ivy Boss', ['transfers_gait_belt', 'hoyer_lift', 'bedbound_care'], { lifts: ['Full-body sling'], refresher: ['hoyer_lift'] })],
    pro: [R('Ivy Boss', 'Brookside Care'), R('Jo Lead', 'Brookside Care')], per: [P('Kim Friend', 'Friend'), P('Lou Friend', 'Friend')], answers: { 'Ivy Boss': { transfers_gait_belt: 'saw', hoyer_lift: 'believe', bedbound_care: 'saw' } } },
  { key: 'bedbound_hospice', first: 'Finley', jobs: [job('Hospice of the Ozarks', 'Mae Boss', ['bedbound_care', 'hospice_support', 'toileting', 'ostomy_bag'])],
    pro: [R('Mae Boss', 'Hospice of the Ozarks'), R('Ned Lead', 'Hospice of the Ozarks')], per: [P('Ora Friend', 'Friend'), P('Pip Friend', 'Friend')], answers: { 'Mae Boss': { bedbound_care: 'saw', hospice_support: 'saw', toileting: 'saw', ostomy_bag: 'saw' } } },
  { key: 'dementia_new', first: 'Gray', experience: 'Less than 6 months', jobs: [job('Sunrise Memory Care', 'Quinn Boss', ['companionship', 'dementia_care'])],
    pro: [R('Quinn Boss', 'Sunrise Memory Care'), R('Ray Lead', 'Sunrise Memory Care')], per: [P('Sal Friend', 'Friend'), P('Tia Friend', 'Friend')], answers: { 'Quinn Boss': { companionship: 'saw', dementia_care: 'no' } } },
  { key: 'restrictions', first: 'Harper', notNow: ['Homes where someone smokes', 'Bedbound clients', 'Clients who are bedbound'], exclusions: 'Overnights', jobs: [job('Home Helpers', 'Uma Boss', ['companionship', 'meals_housekeeping', 'med_reminders'])],
    pro: [R('Uma Boss', 'Home Helpers'), R('Vic Lead', 'Home Helpers')], per: [P('Wes Friend', 'Friend'), P('Xan Friend', 'Friend')], answers: { 'Uma Boss': { companionship: 'saw', meals_housekeeping: 'saw', med_reminders: 'saw' } } },
  { key: 'no_care_jobs', first: 'Indy', jobs: [job('Corner Diner', 'Yan Boss', undefined, { did_care: 'no', refresher: undefined })],
    pro: [R('Yan Boss', 'Corner Diner'), R('Zed Lead', 'Corner Diner')], per: [P('Abe Friend', 'Friend'), P('Bea Friend', 'Friend')], answers: {} },
  { key: 'mixed_disagree', first: 'Jules', jobs: [job('Home Helpers', 'Cy Boss', ['bathing', 'two_person_transfers']), job('Visiting Angels', 'Di Lead', ['bathing', 'two_person_transfers'])],
    pro: [R('Cy Boss', 'Home Helpers'), R('Di Lead', 'Visiting Angels')], per: [P('Ed Friend', 'Friend'), P('Flo Friend', 'Friend')], answers: { 'Cy Boss': { bathing: 'saw', two_person_transfers: 'no' }, 'Di Lead': { bathing: 'believe', two_person_transfers: 'unknown' } } },
]

const out = {}; const TASK_OK = ['saw', 'believe', 'no', 'unknown']
for (const [n, sc] of S.entries()) {
  const OID = `00000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`
  OFFERS[OID] = { id: OID, first_name: sc.first, last_name: 'Practice', phone: '', email: sc.first.toLowerCase() + '@practice.invalid', position: 'Caregiver', offered_by: 'Slice 10 practice run', onboarding_path: 'new', offer_status: 'accepted', offer_signed_at: '2026-10-10T15:00:00Z', pd_signed_at: '2026-10-10T15:01:00Z' }
  const exp = L.expiry(); const link = { o: OID, e: exp, t: await L.sign(SECRET, 'step1', OID, exp) }
  const A = base(sc), name = sc.first + ' Practice', errs = []
  const step = async (b) => { const r = await post(STEP1, { ...b, ...link }); if (r.status !== 200) errs.push(b.action + ' ' + (b.form || b.screen || '') + ': ' + (r.j.error || r.status)); return r }
  await step({ action: 'view' }); await step({ action: 'begin', esign_consent: true })
  for (const [scr, ans] of [['2', A.screen2], ['3', A.screen3]]) await step({ action: 'save', screen: scr, answers: Object.fromEntries(Object.entries(ans).filter(([, v]) => v !== undefined)) })
  await step({ action: 'sign', form: 'employee_application', typed_name: name, consent: true })
  await step({ action: 'save', screen: '4', answers: Object.fromEntries(Object.entries(A.screen4).filter(([, v]) => v !== undefined)) })
  await step({ action: 'sign', form: 'reference_consent', typed_name: name, consent: true })
  await step({ action: 'save', screen: '5a', answers: { edl_listed: 'no', fcsr_listed: 'No' } }); await step({ action: 'sign', form: 'fcra_disclosure', typed_name: name, consent: true })
  await step({ action: 'identity', ssn: '987-65-4321', ssn2: '987-65-4321', dob: '1990-05-05' })
  await step({ action: 'save', screen: '5b', answers: A.screen5b }); await step({ action: 'sign', form: 'edl_fcsr_consent', typed_name: name, consent: true })
  await step({ action: 'save', screen: '6', answers: A.screen6 }); await step({ action: 'sign', form: 'availability', typed_name: name, consent: true, initials: sc.first.slice(0, 1) + 'P' })
  await step({ action: 'save', screen: '7', answers: A.screen7 }); await step({ action: 'sign', form: 'experience', typed_name: name, consent: true })
  /* 2026-10-13: every other practice hire says No to transporting clients (the Non-Driver Agreement); the rest drive (pictures + license) */
  let last
  if (S.indexOf(sc) % 2) { await step({ action: 'save', screen: '8', answers: { transport_willing: 'no' } }); last = await step({ action: 'sign', form: 'non_driver', typed_name: name, consent: true }) }
  else {
    await step({ action: 'identity', license_number: 'P1234567', license_state: 'MO', license_expires: '2029-01-01' })
    await step({ action: 'save', screen: '8', answers: A.screen8 })
    for (const [item, ext] of [['license_front', 'jpg'], ['license_back', 'jpg'], ['insurance_doc', 'pdf']]) { const u = await step({ action: 'upload_url', item, ext }); await step({ action: 'uploaded', item, path: u.j.path }) }
    last = await step({ action: 'sign', form: 'vehicle', typed_name: name, consent: true })
  }
  /* 2026-10-13: the forms moved from Viventium: the agreement with its two initials, then the rest */
  const ini = name.split(' ').map((x) => x[0]).join('').slice(0, 4)
  await step({ action: 'save', screen: '10', answers: { ea_arbitration_initials: ini, ea_class_waiver_initials: ini } })
  for (const f of ['employment_agreement', 'handbook_ack', 'code_of_ethics', 'medication_policy', 'hipaa_privacy']) last = await step({ action: 'sign', form: f, typed_name: name, consent: true })
  ck(`${sc.key}: every Step 1 form signs in order through the real server`, !errs.length && last.j.done === true, errs)
  const cand = DB.app_data.find((x) => x.key === 'candidates').data.find((c) => c.offer_id === OID)
  ck(`${sc.key}: Step 1 complete puts them into Background & References once, with the practice mark on their Step 1`, cand && DB.step1_forms.find((f) => f.offer_id === OID).practice === true && DB.app_data.find((x) => x.key === 'candidates').data.filter((c) => c.offer_id === OID).length === 1, cand)
  /* the office asks the references that landed (the four slots); each answers, or stays silent */
  const slots = [1, 2, 3, 4].filter((s) => cand[`r${s}n`])
  for (const s of slots) DB.reference_requests.push({ id: `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(4, '0')}0000000${s}`, candidate_id: cand.id, slot: s, ref_name: cand[`r${s}n`], ref_type: cand[`r${s}_type`], responded_at: null, task_confirm: null })
  for (const rr of DB.reference_requests.filter((x) => x.candidate_id === cand.id)) {
    const v = await post(REFS, { action: 'view', r: rr.id })
    const asked = (v.j.entries || []).flatMap((e) => e.tasks.map((t) => t.key))
    out[sc.key + ':asked:' + rr.ref_name] = asked
    if ((sc.silent || []).includes(rr.ref_name)) continue
    const mine = sc.answers[rr.ref_name] || {}
    if (asked.length) { const tc = Object.fromEntries(asked.map((k) => [k, mine[k] || 'unknown'])); const s2 = await post(REFS, { action: 'save', r: rr.id, task_confirm: tc, comfort_why: 'Practice answer' }); if (s2.status !== 200) errs.push('reference save ' + rr.ref_name + ': ' + JSON.stringify(s2.j)) }
    rr.responded_at = '2026-10-12T15:00:00Z'; rr.trust_family = 'yes'   /* the reference_answer database function closes it */
  }
  out[sc.key] = { cand, refs: DB.reference_requests.filter((x) => x.candidate_id === cand.id), summary: E.experienceSummary(DB.step1_forms.find((f) => f.offer_id === OID).answers, DB.reference_requests.filter((x) => x.candidate_id === cand.id)) }
  ck(`${sc.key}: every reference answer saved through the real server`, !errs.length, errs)
}
const st = (k, key) => (out[k].summary.skills.find((l) => l.key === key) || {}).standing
const SKILL = (k) => out[k].summary.skills.map((l) => l.key + ':' + l.standing).join(', ')

/* ═══ her rule, scenario by scenario ═══ */
ck('experienced: what a supervisor saw is confirmed; "believe" is support only, never confirmed', st('experienced', 'bathing') === 'confirmed' && st('experienced', 'bedbound_care') === 'confirmed' && st('experienced', 'hospice_support') === 'supported', SKILL('experienced'))
ck('experienced: each supervisor is asked only about the tasks from the job they supervised', out['experienced:asked:Jane Boss'].join() === 'bathing,toileting,transfers_gait_belt,dementia_care' && out['experienced:asked:Tom Lead'].join() === 'bathing,bedbound_care,hospice_support', out)
ck('family_confirmed: family care counts only where the hospice nurse saw it; "don\'t know" on the catheter bag leaves it self-reported', st('family_confirmed', 'bathing') === 'confirmed' && st('family_confirmed', 'hospice_support') === 'confirmed' && st('family_confirmed', 'catheter_bag') === 'self_reported', SKILL('family_confirmed'))
ck('family_unconfirmed: kept on the record, every task self-reported (not counted), the lift refresher noted; never "cannot"', out.family_unconfirmed.summary.skills.length === 3 && out.family_unconfirmed.summary.skills.every((l) => l.standing === 'self_reported' && /does not count yet/.test(l.words)) && /refresher before doing again: A Hoyer/.test(out.family_unconfirmed.summary.restrictions.join()), SKILL('family_unconfirmed'))
ck('family_unconfirmed: friends are never asked task questions about care they did not see', out['family_unconfirmed:asked:Dee Friend'].length === 0 && out['family_unconfirmed:asked:Eli Friend'].length === 0)
ck('missing_refs: the reference they asked us not to contact never reaches Background & References (so is never asked)', !JSON.stringify(out.missing_refs.cand).includes('No Call') && !out.missing_refs.refs.some((r) => r.ref_name === 'No Call'), out.missing_refs.cand)
ck('missing_refs: the silent reference leaves bedbound care self-reported, not "cannot"; the backup is on the profile', st('missing_refs', 'bedbound_care') === 'self_reported' && out.missing_refs.summary.backups[0].name === 'Hal Backup', out.missing_refs.summary)
ck('hoyer_refresher: the lift is only "believed" and wanted a refresher: not confirmed, and flagged', st('hoyer_refresher', 'hoyer_lift') === 'supported' && out.hoyer_refresher.summary.skills.find((l) => l.key === 'hoyer_lift').refresher === true && out.hoyer_refresher.summary.skills.find((l) => l.key === 'hoyer_lift').lifts.join() === 'Full-body sling')
ck('bedbound_hospice: bedbound, hospice, toileting and ostomy bag care all confirmed by the supervisor who saw them', ['bedbound_care', 'hospice_support', 'toileting', 'ostomy_bag'].every((k) => st('bedbound_hospice', k) === 'confirmed'), SKILL('bedbound_hospice'))
ck('dementia_new: a supervisor who did not see dementia care leaves it "questioned" (talk it through), never confirmed', st('dementia_new', 'dementia_care') === 'questioned' && st('dementia_new', 'companionship') === 'confirmed', SKILL('dementia_new'))
ck('restrictions: not at this time (smoking homes, bedbound) and "would rather not" (overnights) are on the profile', /Not at this time: .*Homes where someone smokes.*/.test(out.restrictions.summary.restrictions.join()) && /Bedbound clients/.test(out.restrictions.summary.restrictions.join()) && /Would rather not accept: Overnights/.test(out.restrictions.summary.restrictions.join()), out.restrictions.summary.restrictions)
ck('no_care_jobs: a job without care adds no tasks and asks the reference nothing about care', out.no_care_jobs.summary.skills.length === 0 && out['no_care_jobs:asked:Yan Boss'].length === 0)
ck('mixed_disagree: one saw bathing (confirmed); two-person transfers "no" plus "don\'t know" is questioned, never confirmed', st('mixed_disagree', 'bathing') === 'confirmed' && st('mixed_disagree', 'two_person_transfers') === 'questioned', SKILL('mixed_disagree'))

/* ═══ across everyone: missing never counts, nothing reached the outside world ═══ */
const all = S.flatMap((sc) => out[sc.key].summary.skills.map((l) => ({ sc: sc.key, ...l })))
ck('across all ten: no task is confirmed without a reference who saw it themselves', all.every((l) => l.standing !== 'confirmed' || l.confirmations.some((c) => c.answer === 'saw')), all.filter((l) => l.standing === 'confirmed' && !l.confirmations.some((c) => c.answer === 'saw')))
ck('across all ten: no unanswered or silent reference turns into a confirmation', all.every((l) => l.confirmations.every((c) => TASK_OK.includes(c.answer))))
ck('across all ten: every profile says nothing here sets a level, a qualification or a match', S.every((sc) => /nothing here sets a level, a qualification or a match/.test(out[sc.key].summary.note)))
ck('across all ten: no level, qualification, skills record or availability record was written (only Background & References and the cards)', !DB.app_data.some((x) => ['caregiver_overlay', 'caregiver_availability', 'caregivers'].includes(x.key)))
ck('across all ten: nothing left this machine (no text, email or outside call)', SENT.length === 0, SENT)

if (process.env.DUMP_SCENARIOS) fs.writeFileSync(process.env.DUMP_SCENARIOS, JSON.stringify(Object.fromEntries(S.map((sc) => [sc.key, { name: sc.first + ' Practice', summary: out[sc.key].summary }])), null, 1))
const bad = res.filter((x) => !x[1]); for (const [n, ok, note] of res) console.log((ok ? 'ok    ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
console.log(`${res.length - bad.length}/${res.length} passed`); if (bad.length) process.exit(1)
