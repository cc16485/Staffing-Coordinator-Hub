// 708 LPN HIRING (Samantha approved the LPN nurse visit plan, 2026-10-14): the readiness card for an LPN or RN hire. The real
// caregiver-journey function against the fake database of caregiver_journey_6_test.mjs with the real catalog (3a, 7 and the 708
// rows). A caregiver card never shows a nurse row and its Approve to Work is unchanged; an LPN card needs the four nurse rows, and
// Approve to Work runs the nurse setup (practice with the switch off; the nurse list, the AxisCare LPN class, the training waiver
// and the Compliance tab card with it on). Nothing real is touched. node lpn_journey_708_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', OFFERS_PROJECT_URL: 'http://trn', OFFERS_SERVICE_ROLE_KEY: 'tkey', HUB_JOB_SECRET: 'j'.repeat(48),
  AXISCARE_SITE: '16485', AXISCARE_API_KEY: 'axkey', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'L', OUTREACH_SECRET: 'o'.repeat(40) }
/* the clock (texts go 8am to 6pm Central) */
const RealDate = Date; let NOW = RealDate.parse('2026-10-12T15:00:00Z')   // 10am Chicago (CDT)
class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOW) } static now() { return NOW } }
globalThis.Date = FakeDate; const at = (iso) => { NOW = RealDate.parse(iso) }
/* fake AxisCare + GoHighLevel, every call counted */
const AX = { patch: 200, label: 'Active', active: true, hireDate: '2026-10-12', classes: [{ code: 'CNA', label: 'CNA' }], calls: [] }
const GHL = { messages: [], contacts: 0 }
const TRN = { rows: [], calls: [], lists: [] }
const LEIE = { downloads: 0, csv: '"LASTNAME","FIRSTNAME","MIDNAME","BUSNAME","GENERAL","SPECIALTY","UPIN","NPI","DOB","ADDRESS","CITY","STATE","ZIP","EXCLTYPE","EXCLDATE","REINDATE","WAIVERDATE","WVRSTATE"\n"RAY","BEN","T","","NURSE","","","0","19800101","1 MAIN","TULSA","OK","74101","1128b4","20200101","00000000","00000000",""\n"LEE","AVERY","","","","","","0","19900101","","","","","1128a1","20100101","00000000","00000000",""\n' }
const STORE = { uploads: [] }
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
/* the real caregiver catalog, from the migration file */
const sql = fs.readFileSync(path.join(ROOT, 'supabase/slice3a-journey-caregiver-subject.sql'), 'utf8')
const DEFS = [...sql.matchAll(/values \('([^']+)', 1, '(.*)'::jsonb, false/g)].map((m) => ({ key: m[1], catalog_version: 1, def: JSON.parse(m[2].replace(/''/g, "'")), active: true }))
const sql7 = fs.readFileSync(path.join(ROOT, 'supabase/slice7-axiscare-prep.sql'), 'utf8')
for (const m of sql7.matchAll(/values \('([^']+)', 1, '(.*)'::jsonb, true/g)) DEFS.push({ key: m[1], catalog_version: 1, def: JSON.parse(m[2].replace(/''/g, "'").replace(/\\u0027/g, "'")), active: true })
/* LPN HIRING: the four nurse rows, from the 708 migration file */
const sql708 = fs.readFileSync(path.join(ROOT, 'supabase/lpn-hiring-708.sql'), 'utf8')
for (const m of sql708.matchAll(/values \('([^']+)', 1, '(.*)'::jsonb, true/g)) DEFS.push({ key: m[1], catalog_version: 1, def: JSON.parse(m[2].replace(/''/g, "'")), active: true })
/* fake Training REST */
const OFFERS = {}
globalThis.fetch = async (url, o = {}) => { const u = String(url), m = (o.method || 'GET').toUpperCase()
  if (u.startsWith('http://trn/rest/v1/job_offers')) { const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(u)[1]); return new Response(JSON.stringify(OFFERS[id] ? [OFFERS[id]] : []), { status: 200 }) }
  if (u === 'https://16485.axiscare.com/api/classes/caregiver') return new Response(JSON.stringify({ results: { classes: [{ code: 'L1', label: 'Level 1 Wellness' }, { code: 'L2', label: 'Level 2 Personal Care' }, { code: 'L3', label: 'Level 3 Advanced Care' }, { code: 'PRN', label: 'PRN Team' }, { code: 'CNA', label: 'CNA' }] } }), { status: 200 })
  if (u.startsWith('https://16485.axiscare.com/api/caregivers/')) { const id = u.split('/').pop(); AX.calls.push(m + ' ' + id + (o.body ? ' ' + o.body : ''))
    if (m === 'PATCH') { if (AX.patch === 200 && o.body) { const b = JSON.parse(o.body); if (b.hireDate) AX.hireDate = b.hireDate; if (b.classes) AX.classes = b.classes } return new Response(AX.patch === 200 ? JSON.stringify({ results: { data: { id: Number(id) } } }) : JSON.stringify({ errors: ['Status not found'] }), { status: AX.patch }) }
    return new Response(JSON.stringify({ results: { data: { id: Number(id), status: { active: AX.active, label: AX.label }, hireDate: AX.hireDate, classes: AX.classes || [] } } }), { status: 200 }) }
  if (u === 'http://trn/rest/v1/app_settings?key=eq.hub_read_key&select=value') return new Response(JSON.stringify([{ value: { key: 'rk' } }]), { status: 200 })
  if (u === 'http://trn/rest/v1/rpc/hub_training_status') { TRN.calls.push(JSON.parse(o.body)); return new Response(JSON.stringify(TRN.rows), { status: 200 }) }
  if (u === 'http://trn/rest/v1/caregivers?select=id,axiscare_id&active=eq.true') return new Response(JSON.stringify([{ id: 't-ava', axiscare_id: '9001' }, { id: 't-ben', axiscare_id: '9002' }]), { status: 200 })
  if (u === 'http://trn/storage/v1/object/list/waiver-docs') { const p = JSON.parse(o.body).prefix; TRN.lists.push(p); return new Response(JSON.stringify(p === 'certificates/t-ben' ? [{ name: 'agency-orientation.pdf' }] : []), { status: 200 }) }
  if (u.startsWith('http://trn/storage/v1/object/sign/waiver-docs/')) return new Response(JSON.stringify({ signedURL: '/object/sign/waiver-docs/' + u.split('/waiver-docs/')[1] + '?token=t' }), { status: 200 })
  if (u === 'https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv') { LEIE.downloads++; return new Response(LEIE.csv, { status: 200 }) }
  if (u.startsWith('https://services.leadconnectorhq.com/contacts/search/duplicate')) return new Response(JSON.stringify({ contacts: [] }), { status: 200 })
  if (u === 'https://services.leadconnectorhq.com/contacts/upsert') { GHL.contacts++; return new Response(JSON.stringify({ contact: { id: 'c1', phone: '+14175550100' } }), { status: 200 }) }
  if (u.startsWith('https://services.leadconnectorhq.com/contacts/c1')) return new Response(JSON.stringify({ contact: { id: 'c1', phone: '+14175550100' } }), { status: 200 })
  if (u === 'https://services.leadconnectorhq.com/conversations/messages') { GHL.messages.push(JSON.parse(o.body)); return new Response('{}', { status: 200 }) }
  throw new Error('unexpected fetch ' + m + ' ' + u) }
/* fake tables */
let DB = {}
const reset = () => { DB = { client_journey_step_def: JSON.parse(JSON.stringify(DEFS)), client_journey: [], client_journey_step: [], client_journey_event: [], app_data: [], step1_forms: [], welcome_calls: [], caregiver_profiles: [], job_applicants: [], contact_optout_current: [], circle_contacts: [], axiscare_change_log: [], document_access_log: [], domains: [], auth_identities: [{ auth_user_id: 'u-sam', person_id: 'p-sam', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-kry', person_id: 'p-kry', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-cc', person_id: 'p-cc', project_ref: 'zngsgedlsxinbygwmxwn' }], persons: [{ person_id: 'p-sam', full_name: 'Samantha', active: true }, { person_id: 'p-kry', full_name: 'Krystal', active: true }, { person_id: 'p-cc', full_name: 'Casey', active: true }], entity_memberships: [{ person_id: 'p-sam', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-kry', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-cc', entity: 'cc_ihs', active: true, ended_at: null }], staff_roles: [{ person_id: 'p-sam', entity: 'cc_ihs', role: 'owner_admin' }, { person_id: 'p-kry', entity: 'cc_ihs', role: 'staffing_coordinator' }, { person_id: 'p-cc', entity: 'cc_ihs', role: 'care_coordinator' }] } }
let seq = 0
function table(name) {
  const rows = () => DB[name]
  const q = (mode, payload, filters = [], opts = {}) => {
    const match = (r) => filters.every((f) => f(r))
    const run = () => {
      if (mode === 'select') { let out = rows().filter(match); if (opts.order) out = [...out].sort((a, b) => String(b[opts.order]).localeCompare(String(a[opts.order]))); if (opts.limit) out = out.slice(0, opts.limit); return JSON.parse(JSON.stringify(out)) }
      if (mode === 'insert' && Array.isArray(payload)) { for (const p of payload) rows().push({ id: ++seq, ...p }); return payload }
      if (mode === 'insert') { const r = { ...payload }; if (name === 'client_journey') { if (rows().some((x) => x.offer_id === r.offer_id)) throw new Error('duplicate offer_id'); r.journey_id = r.journey_id || 'j-' + (++seq); r.created_at = new Date().toISOString() } if (name === 'client_journey_event') { r.id = ++seq; r.at = r.at || new Date().toISOString() } rows().push(r); return [r] }
      if (mode === 'upsert') { const i = rows().findIndex((x) => x.journey_id === payload.journey_id && x.step_key === payload.step_key); if (i >= 0) rows()[i] = { ...rows()[i], ...payload }; else rows().push({ ...payload }); return [payload] }
      if (mode === 'update') { const out = []; for (const r of rows()) if (match(r)) { Object.assign(r, payload); out.push(r) } return out }
    }
    const api = {
      eq: (k, v) => q(mode, payload, [...filters, (r) => String(r[k]) === String(v)], opts), neq: (k, v) => q(mode, payload, [...filters, (r) => String(r[k]) !== String(v)], opts),
      in: (k, vs) => q(mode, payload, [...filters, (r) => vs.map(String).includes(String(r[k]))], opts), like: (k, v) => q(mode, payload, [...filters, (r) => new RegExp('^' + String(v).replace(/%/g, '.*') + '$').test(String(r[k]))], opts),
      ilike: (k, v) => q(mode, payload, [...filters, (r) => String(r[k] ?? '').toLowerCase().includes(String(v).replace(/%/g, '').toLowerCase())], opts), not: (k, op, v) => q(mode, payload, [...filters, (r) => op === 'is' ? (r[k] ?? null) !== v : true], opts),
      order: (k) => q(mode, payload, filters, { ...opts, order: k }), limit: (n) => q(mode, payload, filters, { ...opts, limit: n }), select: () => q(mode, payload, filters, opts),
      maybeSingle: async () => { try { return { data: run()[0] ?? null, error: null } } catch (e) { return { data: null, error: { message: e.message } } } },
      then: (ok) => { try { ok({ data: run(), error: null }) } catch (e) { ok({ data: null, error: { message: e.message } }) } },
    }
    return api
  }
  return { select: () => q('select'), insert: (p) => q('insert', p), upsert: (p) => q('upsert', p), update: (p) => q('update', p) }
}
const KINDS = ['caregiver_class', 'client_created','client_linked','client_updated','responsible_party','care_level','care_tasks','care_plan_note','client_note','caregiver_note','schedule','visit_caregiver','call_summary','scheduling_note','caregiver_status','prn_team_classes','caregiver_hire_date','caregiver_level']
const OWNED = ['eligibility_history', 'eligibility_state', 'eligibility_reason', 'eligibility_at', 'axiscare_note_for', 'approved_to_work_at', 'approved_to_work_by', 'axiscare_status_active', 'axiscare_status_label', 'axiscare_status_at', 'work_lock']
async function rpc(name, a) {
  if (name === 'axiscare_change_record') { if (!KINDS.includes(a.p_kind) || !['sent_confirmed','sent','refused','practice'].includes(a.p_outcome) || !/^\d+$/.test(String(a.p_caregiver ?? ''))) return { data: { outcome: 'refused', reason: 'check' }, error: null }; DB.axiscare_change_log.push({ id: DB.axiscare_change_log.length + 1, at: new Date().toISOString(), kind: a.p_kind, caregiver: a.p_caregiver, outcome: a.p_outcome, summary: a.p_summary, detail: a.p_detail, by: a.p_by, via: a.p_via }); return { data: { outcome: 'recorded', id: DB.axiscare_change_log.length }, error: null } }
  if (name === 'caregiver_audit_patch') { const AUD = ['orient_date', 'orient_proof', 'alz_date', 'alz_hrs', 'alz_proof', 'ojt_online', 'ojt_online_proof', 'annual_date', 'annual_hrs', 'annual_proof', 'hire_date', 'first_contact', 'axiscare_id', 'th_synced', 'oig', 'oig_date', 'oig_proof', 'oig_evidence']; const bad = Object.keys(a.p_patch).filter((k) => !AUD.includes(k)); if (bad.length) return { data: null, error: { message: 'not a field the audit owns: ' + bad.join(', ') } }; const list = DB.app_data.find((x) => x.key === 'caregivers')?.data || []; const r = list.find((x) => String(x.id) === String(a.p_id)); if (!r) return { data: { ok: false, reason: 'gone' }, error: null }; Object.assign(r, a.p_patch); return { data: { ok: true, rev: 1 }, error: null } }
  if (name === 'caregiver_sweep_patch') { const bad = Object.keys(a.p_patch).filter((k) => !OWNED.includes(k)); if (bad.length) return { data: null, error: { message: 'not a field the sweep owns: ' + bad.join(', ') } }; const list = DB.app_data.find((x) => x.key === 'caregivers')?.data || []; const r = list.find((x) => String(x.id) === String(a.p_id)); if (!r) return { data: { ok: false, reason: 'gone' }, error: null }; Object.assign(r, a.p_patch); return { data: { ok: true, rev: 1 }, error: null } }
  if (name === 'upsert_app_data_item') { let row = DB.app_data.find((x) => x.key === a.target_key); if (!row) { row = { key: a.target_key, data: [] }; DB.app_data.push(row) } const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = a.item; else row.data.push(a.item); return { data: null, error: null } }
  return { data: null, error: { message: 'unknown rpc ' + name } }
}
const storage = { from: (bucket) => ({ upload: async (path, body, opts) => { if (STORE.uploads.some((u) => u.bucket === bucket && u.path === path)) return { error: { message: 'exists' } }; const text = typeof body === 'string' ? body : body instanceof Uint8Array ? Buffer.from(body).toString('latin1') : await body.text(); STORE.uploads.push({ bucket, path, text, opts }); return { data: { path }, error: null } }, createSignedUrl: async (path, s) => ({ data: { signedUrl: 'https://signed/' + bucket + '/' + path + '?s=' + s }, error: null }) }) }
globalThis.__fakeCreateClient = () => ({ from: table, rpc, storage, auth: { getUser: async (jwt) => ({ sam: { data: { user: { id: 'u-sam', email: 'sam@mo-care.com', app_metadata: {} } }, error: null }, kry: { data: { user: { id: 'u-kry', email: 'krystal@mo-care.com', app_metadata: {} } }, error: null }, cc: { data: { user: { id: 'u-cc', email: 'casey@mo-care.com', app_metadata: {} } }, error: null } })[jwt] || { data: null, error: { message: 'bad' } } } })
const TMP = path.join(ROOT, '.lpn_journey_708_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(FN, TMP, { recursive: true })
for (const p of fs.readdirSync(TMP, { recursive: true })) { const f = path.join(TMP, String(p)); if (!f.endsWith('.ts')) continue; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient').replace(/^import .* from 'https:[^']*'$/mg, '')) }
let CJ, WL, EXPORT, CJI; try { CJI = await import(path.join(TMP, 'caregiver-journey', 'index.ts')); const h1 = handler; await import(path.join(TMP, 'caregiver-export', 'index.ts')); EXPORT = handler; handler = h1; CJ = await import(path.join(TMP, '_shared', 'caregiver-journey.ts')); WL = await import(path.join(TMP, '_shared', 'work-lock.ts')) } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const call = async (body, tok) => { const r = await handler(new Request('http://x/caregiver-journey', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? (tok === 'cron' ? { 'x-cron-secret': env.HUB_JOB_SECRET } : { Authorization: 'Bearer ' + tok }) : {}) }, body: JSON.stringify(body) })); let j = null; try { j = await r.json() } catch {} return { status: r.status, j } }
const db = globalThis.__fakeCreateClient()

/* LPN HIRING fakes: the AxisCare class list has an LPN class; the Training Platform's waiver door; the private store's upload links */
const WAIVES = []
const fetch0 = globalThis.fetch
globalThis.fetch = async (url, o = {}) => { const u = String(url), m = (o.method || 'GET').toUpperCase()
  if (u === 'https://16485.axiscare.com/api/classes/caregiver') return new Response(JSON.stringify({ results: { classes: [{ code: 'L1', label: 'Level 1 Wellness' }, { code: 'L2', label: 'Level 2 Personal Care' }, { code: 'L3', label: 'Level 3 Advanced Care' }, { code: 'PRN', label: 'PRN Team' }, { code: 'CNA', label: 'CNA' }, { code: 'LPN', label: 'LPN' }, { code: 'RN', label: 'RN' }] } }), { status: 200 })
  if (u === 'https://rdqujxiycycwhskyvrwa.supabase.co/functions/v1/job-offer') { const b = JSON.parse(o.body); WAIVES.push({ b, secret: o.headers['x-outreach-secret'] }); return new Response(JSON.stringify({ ok: true, waived: ['on-the-job-training'], kept: ['agency-orientation', 'dementia-care'], already: [] }), { status: 200 }) }
  return fetch0(url, o) }
const UP = new Set()
const from0 = storage.from
storage.from = (b) => ({ ...from0(b), createSignedUploadUrl: async (p) => ({ data: { token: 't', signedUrl: 'https://upload/' + b + '/' + p }, error: null }), list: async (dir, o) => ({ data: [...UP].filter((x) => x.startsWith(b + ':' + dir + '/')).map((x) => ({ name: x.slice((b + ':' + dir + '/').length) })).filter((x) => !o?.search || x.name === o.search), error: null }) })
const CG = '11111111-2222-4333-8444-000000000708', LPN = '22222222-2222-4333-8444-000000000708'
reset()
DB.app_data = [{ key: 'onboarding_permissions', data: { version: 1, advance: [{ person_id: 'p-kry' }], work: [{ person_id: 'p-sam' }], screening: [{ person_id: 'p-kry' }], history: [] } }, { key: 'ops_settings', data: { staffing_email: 'krystal@mo-care.com' } }, { key: 'candidates', data: [] },
  { key: 'caregivers', data: [{ id: 301, first: 'Ava', last: 'Lee', offer_id: CG, axiscare_id: '9001', connected: { at: '2026-10-12T16:00:00Z' }, hire_date: '2026-10-12', orient_date: '2026-10-12', alz_date: '2026-10-12', email: 'ava@x.test', phone: '4175550100' },
    { id: 302, first: 'Lee', last: 'Nurse', offer_id: LPN, axiscare_id: '9003', connected: { at: '2026-10-12T16:00:00Z' }, hire_date: '2026-10-12', orient_date: '2026-10-12', alz_date: '2026-10-12', email: 'lee@x.test', phone: '4175550101' }] },
  { key: 'nurse_staff', data: [{ id: 'ns-natasha', name: 'Natasha Early', cred: 'RN', license: 'RN0000', expires: '2027-04-30', email: 'natasha@x.test', employee: true, supervising_rn: true }] }]
OFFERS[CG] = { id: CG, first_name: 'Ava', last_name: 'Lee', email: 'ava@x.test', offer_signed_at: '2026-10-09T20:00:00Z', pd_signed_at: '2026-10-09T20:05:00Z', offer_version: 2, pd_version: 2, offer_status: 'accepted', onboarding_path: 'new', position_key: 'caregiver' }
OFFERS[LPN] = { id: LPN, first_name: 'Lee', last_name: 'Nurse', email: 'lee@x.test', offer_signed_at: '2026-10-09T20:00:00Z', pd_signed_at: null, offer_version: 1, pd_version: null, offer_status: 'accepted', onboarding_path: 'new', position_key: 'lpn' }
DB.step1_forms = [{ offer_id: CG, answers: { lived_outside_mo: 'no', cna: 'no', hha: 'no', transport_willing: 'no' }, signatures: {}, completed_at: '2026-10-10T01:00:00Z', countersignatures: {}, nurse_form: false },
  { offer_id: LPN, answers: { lived_outside_mo: 'no', cna: 'no', hha: 'no', transport_willing: 'no', nurse_license_type: 'Licensed Practical Nurse (LPN)', nurse_license_state: 'MO', nurse_license_multistate: 'No, a single-state license', nurse_license_expires: '2028-05-31', nurse_license_doc: { path: 'offer/' + LPN + '/nurse_license_doc-1.pdf' } }, signatures: {}, completed_at: '2026-10-10T01:00:00Z', countersignatures: {}, nurse_form: true }]
DB.step1_identity = [{ offer_id: LPN, nurse_license_last4: '6813' }]
await CJ.startCaregiverJourney(db, { id: CG, first_name: 'Ava', last_name: 'Lee' }, 'offer-sign'); await CJ.startCaregiverJourney(db, { id: LPN, first_name: 'Lee', last_name: 'Nurse' }, 'offer-sign')
const JC = DB.client_journey.find((j) => j.offer_id === CG).journey_id, JL = DB.client_journey.find((j) => j.offer_id === LPN).journey_id
const NURSE_KEYS = ['cg.credential.nurse_license', 'cg.nurse.orientation', 'cg.nurse.section2_ack', 'cg.step2.position_description']
const stepOf = (jid, k) => DB.client_journey_step.find((x) => x.journey_id === jid && x.step_key === k)
/* settle every caregiver row the catalog requires (not Approve to Work and what follows it), as if the whole process had run */
const ROWS = DEFS.filter((d) => d.def.required !== false && d.def.subject === 'caregiver' && !NURSE_KEYS.includes(d.key) && !['cg.offer.signed', 'cg.approve.work', 'cg.axiscare.active', 'cg.axiscare.hire_date', 'cg.axiscare.level', 'cg.training.ojt', 'cg.training.annual'].includes(d.key))
for (const jid of [JC, JL]) for (const d of ROWS) DB.client_journey_step.push({ journey_id: jid, step_key: d.key, state: 'complete', completed_at: '2026-10-12T15:00:00Z', completed_by: 'test', evidence: { test: true }, version: 1 })
/* ═══ 1. the caregiver card: no nurse row, Approve to Work as before ═══ */
let r = await call({ action: 'sweep' }, 'cron')
ck('the sweep verifies the caregiver offer from both signatures, exactly as before', stepOf(JC, 'cg.offer.signed')?.state === 'complete' && stepOf(JC, 'cg.offer.signed').evidence.pd_signed_at === '2026-10-09T20:05:00Z' && !stepOf(JC, 'cg.offer.signed').evidence.letter_only)
r = await call({ action: 'get', offer_id: CG }, 'sam')
ck('caregiver card: none of the four nurse rows shows; the fact is known (not a nurse); nothing nurse in the facts', r.status === 200 && !r.j.view.rows.some((x) => NURSE_KEYS.includes(x.key)) && !('licensed_nurse' in r.j.facts) && !r.j.approve.missing.some((m) => /Nurs|Section 2|LPN packet/i.test(m)), r.j && { m: r.j.approve && r.j.approve.missing, f: r.j.facts })
ck('caregiver card: ready for final approval exactly as before', r.j.approve.ready_for_final === true, r.j.approve)
r = await call({ action: 'nurse_facts', journey_id: JC }, 'kry')
ck('caregiver card: the nurse forms refuse ("not an LPN or RN hire")', r.status === 400 && /not an LPN or RN/.test(r.j.error), r)
r = await call({ action: 'approve_work', journey_id: JC }, 'sam')
ck('caregiver Approve to Work: approved (practice AxisCare), and NO nurse setup of any kind', r.status === 200 && !r.j.result.nurse && !(stepOf(JC, 'cg.approve.work').evidence || {}).nurse_setup && !DB.axiscare_change_log.some((x) => x.kind === 'caregiver_class') && WAIVES.length === 0 && DB.app_data.find((x) => x.key === 'nurse_staff').data.length === 1, r.j && r.j.result)
/* ═══ 2. the LPN card ═══ */
r = await call({ action: 'get', offer_id: LPN }, 'kry')
ck('LPN card: all four nurse rows show, the fact says licensed nurse', r.status === 200 && NURSE_KEYS.every((k) => r.j.view.rows.some((x) => x.key === k)) && r.j.facts.licensed_nurse === true && r.j.facts.position_key === 'lpn', r.j && r.j.view.rows.map((x) => x.key))
ck('LPN card: not ready for final approval; the four nurse rows are named as missing', r.j.approve.ready_for_final === false && ['Nursing license verified', 'Nurse orientation', 'Section 2', 'LPN packet'].every((t) => r.j.approve.missing.some((m) => m.includes(t))), r.j.approve.missing)
ck('the sweep verifies the LPN offer from the letter alone (no position description)', stepOf(JL, 'cg.offer.signed')?.state === 'complete' && stepOf(JL, 'cg.offer.signed').evidence.letter_only === true, stepOf(JL, 'cg.offer.signed'))
r = await call({ action: 'approve_work', journey_id: JL }, 'sam')
ck('LPN Approve to Work is refused while the nurse rows are open', r.status === 409 && /Nursing license verified/.test(r.j.error) && !stepOf(JL, 'cg.approve.work'), r)
r = await call({ action: 'record', journey_id: JL, step_key: 'cg.credential.nurse_license', result: 'ok', document: 'x' }, 'kry')
ck('the generic Record prompt is refused for the nurse license (its own form checks every field)', r.status === 400 && /nurse form/.test(r.j.error), r)
r = await call({ action: 'nurse_facts', journey_id: JL }, 'kry')
ck('nurse facts: their Step 1 answers (type, ending 6813, MO, single state, expiry, their picture), the 7 topics, the packet line, the switch off', r.status === 200 && r.j.step1.license_last4 === '6813' && r.j.step1.state === 'MO' && r.j.step1.picture.path.includes('nurse_license_doc') && r.j.topics.length === 7 && /LPN packet/.test(r.j.packet) && r.j.switch_live === false && r.j.waived_courses.join() === 'on-the-job-training', r.j)
r = await call({ action: 'nurse_upload_url', journey_id: JL, kind: 'nursys', ext: 'pdf' }, 'kry')
ck('the Nursys report uploads to the private onboarding store under nurse/<offer>/', r.status === 200 && new RegExp('^nurse/' + LPN + '/nursys-\\d+\\.pdf$').test(r.j.path) && /onboarding-documents/.test(r.j.signed_url), r.j)
const nursys = r.j.path
const lic = (b) => call({ action: 'nurse_record', journey_id: JL, step_key: 'cg.credential.nurse_license', license_type: 'LPN', result: 'active', discipline: false, state: 'MO', multistate: false, expires: '2028-05-31', checked_on: '2026-10-12', document: nursys, ...b }, 'kry')
r = await lic({ expires: '' })
ck('an active result without the expiration is refused, nothing saved', r.status === 400 && /expiration/.test(r.j.error) && !stepOf(JL, 'cg.credential.nurse_license'), r)
r = await lic({})
ck('the report must really be there (uploaded): refused when it never arrived', r.status === 409 && /did not arrive/.test(r.j.error), r)
UP.add('onboarding-documents:' + nursys)
r = await lic({ discipline: true })
ck('discipline shown: recorded, the row BLOCKS with the reason, an urgent card', r.status === 200 && stepOf(JL, 'cg.credential.nurse_license').state === 'blocked' && /discipline/.test(stepOf(JL, 'cg.credential.nurse_license').blocked_reason) && DB.app_data.find((x) => x.key === 'ops_items').data.some((c) => c.id === 'cj_nurselic_' + JL && c.urgency === 'urgent'), stepOf(JL, 'cg.credential.nurse_license'))
r = await lic({ license_type: 'RN' })
ck('an RN license on an LPN offer is not cleared (type mismatch blocks)', stepOf(JL, 'cg.credential.nurse_license').state === 'blocked' && /RN license but the offer is for an LPN/.test(stepOf(JL, 'cg.credential.nurse_license').blocked_reason))
r = await lic({})
const L1 = stepOf(JL, 'cg.credential.nurse_license')
ck('a clean active result: complete, with who, the date checked, the result, the report, the expiration, the source and the last four', r.status === 200 && L1.state === 'complete' && L1.evidence.result === 'Active' && L1.evidence.expires === '2028-05-31' && L1.evidence.checked_on === '2026-10-12' && L1.evidence.document === nursys && /Nursys QuickConfirm/.test(L1.evidence.source) && L1.evidence.license_last4 === '6813' && L1.evidence.recorded.by === 'krystal@mo-care.com', L1)
r = await lic({})
ck('recorded once: a second record is refused (permanent history)', r.status === 409 && /Already recorded/.test(r.j.error))
r = await call({ action: 'nurse_record', journey_id: JL, step_key: 'cg.nurse.orientation', date: '2026-10-12', given_by: 'Krystal Land', topics: ['ethics', 'rights', 'activities', 'infection', 'records', 'osha'] }, 'kry')
ck('orientation with a topic missing is refused and names it', r.status === 400 && /Communicating with the appropriate state agency/.test(r.j.error) && !stepOf(JL, 'cg.nurse.orientation'), r)
r = await call({ action: 'nurse_record', journey_id: JL, step_key: 'cg.nurse.orientation', date: '2026-10-12', given_by: 'Krystal Land', topics: ['ethics', 'rights', 'activities', 'infection', 'records', 'osha', 'communicating'] }, 'kry')
ck('orientation with all 7 topics: complete with the date, who gave it and each topic (manual 2.6)', r.status === 200 && stepOf(JL, 'cg.nurse.orientation').state === 'complete' && stepOf(JL, 'cg.nurse.orientation').evidence.topics.length === 7 && stepOf(JL, 'cg.nurse.orientation').evidence.given_by === 'Krystal Land', r.j && r.j.error)
r = await call({ action: 'nurse_doc', journey_id: JL, which: 'section2' }, 'kry')
const s2pdf = Buffer.from(r.j.pdf_base64 || '', 'base64').toString('latin1'), s2txt = [...s2pdf.matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]).join(' ')
ck('the Section 2 statement prints with her name and license (ending 6813)', r.status === 200 && s2pdf.startsWith('%PDF') && /Lee Nurse/.test(s2txt) && /ending 6813/.test(s2txt) && /Section 2 of the MO HealthNet Personal Care Provider Manual/.test(s2txt), r.j && r.j.error)
r = await call({ action: 'nurse_upload_url', journey_id: JL, kind: 'section2', ext: 'jpg' }, 'kry'); UP.add('onboarding-documents:' + r.j.path)
r = await call({ action: 'nurse_record', journey_id: JL, step_key: 'cg.nurse.section2_ack', signed_on: '2026-10-12', document: r.j.path }, 'kry')
ck('the signed Section 2 statement: complete with the date and the signed copy', r.status === 200 && stepOf(JL, 'cg.nurse.section2_ack').state === 'complete' && /^nurse\//.test(stepOf(JL, 'cg.nurse.section2_ack').evidence.document))
r = await call({ action: 'nurse_open', journey_id: JL, path: nursys }, 'kry')
ck('opening the Nursys report: a five-minute link, the open logged', r.status === 200 && /\?s=300$/.test(r.j.url) && DB.document_access_log.some((x) => x.path === nursys && x.by_email === 'krystal@mo-care.com'), r.j)
r = await call({ action: 'nurse_open', journey_id: JL, path: 'nurse/' + CG + '/nursys-1.pdf' }, 'kry')
ck('another person\'s document cannot be opened from this card', r.status === 400, r)
r = await call({ action: 'confirm', journey_id: JL, step_key: 'cg.step2.position_description' }, 'kry')
ck('the LPN packet confirmed by the office (Step 2 Verify does the same with one tick)', r.status === 200 && stepOf(JL, 'cg.step2.position_description').state === 'complete')
r = await call({ action: 'get', offer_id: LPN }, 'sam')
ck('every row done: ready for final approval', r.j.approve.ready_for_final === true, r.j.approve.missing)
/* ═══ 3. Approve to Work, switch OFF: practice ═══ */
const log0 = DB.axiscare_change_log.length
r = await call({ action: 'approve_work', journey_id: JL }, 'sam')
const ns1 = stepOf(JL, 'cg.approve.work').evidence.nurse_setup
ck('switch off: approved, and the nurse setup is PRACTICE: shown on the card, nothing written', r.status === 200 && ns1.state === 'practice' && ns1.nurse_list.state === 'practice' && ns1.nurse_list.would === 'add' && ns1.nurse_list.supervisor === 'Natasha Early' && ns1.nurse_list.license === 'on file, ending 6813' && DB.app_data.find((x) => x.key === 'nurse_staff').data.length === 1, ns1)
ck('switch off: the AxisCare LPN class is recorded as practice only (no PATCH)', ns1.axiscare_class.outcome === 'practice' && DB.axiscare_change_log.slice(log0).some((x) => x.kind === 'caregiver_class' && x.outcome === 'practice') && !AX.calls.some((c) => /^PATCH 9003 .*classes.*LPN/.test(c)), [ns1.axiscare_class, AX.calls])
ck('switch off: no training waiver (Hub row or Training), no Compliance card', WAIVES.length === 0 && !stepOf(JL, 'cg.training.ojt') && !(DB.app_data.find((x) => x.key === 'ops_items')?.data || []).some((c) => c.id === 'cj_nurse_' + JL) && ns1.waiver.training.practice === true)
/* ═══ 4. switch ON: Run nurse setup ═══ */
r = await call({ action: 'nurse_setup', journey_id: JL }, 'kry')
ck('Run nurse setup: the Approve to Work list only', r.status === 403)
DB.app_data.find((x) => x.key === 'ops_settings').data.nurse_hire_live = true
r = await call({ action: 'nurse_setup', journey_id: JL }, 'sam')
const NS = DB.app_data.find((x) => x.key === 'nurse_staff').data, lee = NS.find((n) => n.offer_id === LPN)
ck('switch on: Lee is on the nurse list: LPN, employee, the license as "on file, ending 6813" (never the full number), the verified expiry, Natasha Early as supervising RN, their email', r.status === 200 && lee && lee.cred === 'LPN' && lee.employee === true && lee.license === 'on file, ending 6813' && lee.expires === '2028-05-31' && lee.supervisor === 'Natasha Early' && lee.supervisor_id === 'ns-natasha' && lee.email === 'lee@x.test' && lee.supervising_rn === false && !JSON.stringify(NS).includes('PN2468'), lee)
ck('switch on: the AxisCare LPN class is added, every other class kept, read back', AX.calls.some((c) => /^PATCH 9003 /.test(c) && /"LPN"/.test(c)) && stepOf(JL, 'cg.approve.work').evidence.nurse_setup.axiscare_class.outcome === 'confirmed', [AX.calls.slice(-4), stepOf(JL, 'cg.approve.work').evidence.nurse_setup.axiscare_class])
ck('switch on: the training waiver: ONLY the On-the-Job Skills Training, with the reason (license ending, Nursys, 19 CSR 15-7.021(22)(A)4), through the Training Platform\'s own door', WAIVES.length === 1 && WAIVES[0].b.action === 'nurse_waive' && WAIVES[0].b.offer_id === LPN && WAIVES[0].b.axiscare_id === '9003' && /ending 6813/.test(WAIVES[0].b.reason) && /15-7\.021\(22\)\(A\)4/.test(WAIVES[0].b.reason) && /dementia training and the 2-hour agency orientation, which are kept/.test(WAIVES[0].b.reason) && WAIVES[0].secret === env.OUTREACH_SECRET, WAIVES)
ck('switch on: the Hub\'s OJT row is not needed (waived, with the rule); orientation and dementia stay as they are', stepOf(JL, 'cg.training.ojt').state === 'not_needed' && stepOf(JL, 'cg.training.ojt').exception.kind === 'waived' && stepOf(JL, 'cg.training.ojt').exception.rule === '19 CSR 15-7.021(22)(A)4' && stepOf(JL, 'cg.training.orientation').state === 'complete' && stepOf(JL, 'cg.training.dementia').state === 'complete')
const card = DB.app_data.find((x) => x.key === 'ops_items').data.find((c) => c.id === 'cj_nurse_' + JL)
ck('switch on: ONE card for the office: enter the license in AxisCare\'s Compliance tab (type, ending 6813, state, expiry)', card && /Compliance tab/.test(card.title) && /LPN, number ending 6813, state MO, expires 2028-05-31/.test(card.detail) && card.owner === 'krystal@mo-care.com', card)
r = await call({ action: 'nurse_setup', journey_id: JL }, 'sam')
ck('running it again changes nothing twice: one nurse record, the class unchanged, still one card', DB.app_data.find((x) => x.key === 'nurse_staff').data.filter((n) => n.offer_id === LPN).length === 1 && stepOf(JL, 'cg.approve.work').evidence.nurse_setup.axiscare_class.outcome === 'unchanged' && DB.app_data.find((x) => x.key === 'ops_items').data.filter((c) => c.id === 'cj_nurse_' + JL).length === 1)
/* the waiver words, the nurse rows' wording */
ck('no em dash and no "plain language" in any nurse row, form or the Section 2 statement', !/—/.test(JSON.stringify(DEFS.filter((d) => NURSE_KEYS.includes(d.key)))) && !/plain (language|english)/i.test(JSON.stringify(DEFS)) && !/—/.test(s2txt))
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
