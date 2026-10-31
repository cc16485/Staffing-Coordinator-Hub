// 1033 LEVEL OF CARE (her approved design of 2026-10-08; decision 4: approvers = the Approve to Work list), on the harness of caregiver_journey_6_test.mjs.
// SLICE 7 · the caregiver-journey function (3b + 5 + 6 behaviour kept) plus AxisCare preparation (hire date and level class
// written once after the Active read-back, copy sheets, the hire nudge), the nightly audit (Training sync, monthly OIG with retained
// results, expiries as events and owned tasks) and the caregiver-export function against a fake database (the real caregiver catalog from the 3a migration file, the real rules file),
// a fake Training Platform, a fake AxisCare, a fake GoHighLevel and a settable clock. Nothing real is touched. node caregiver_journey_6_test.mjs
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
const reset = () => { DB = { caregiver_level_evidence: [], reference_requests: [], client_journey_step_def: JSON.parse(JSON.stringify(DEFS)), client_journey: [], client_journey_step: [], client_journey_event: [], app_data: [], step1_forms: [], welcome_calls: [], caregiver_profiles: [], job_applicants: [], contact_optout_current: [], circle_contacts: [], axiscare_change_log: [], document_access_log: [], domains: [], auth_identities: [{ auth_user_id: 'u-sam', person_id: 'p-sam', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-kry', person_id: 'p-kry', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-cc', person_id: 'p-cc', project_ref: 'zngsgedlsxinbygwmxwn' }], persons: [{ person_id: 'p-sam', full_name: 'Samantha', active: true }, { person_id: 'p-kry', full_name: 'Krystal', active: true }, { person_id: 'p-cc', full_name: 'Casey', active: true }], entity_memberships: [{ person_id: 'p-sam', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-kry', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-cc', entity: 'cc_ihs', active: true, ended_at: null }], staff_roles: [{ person_id: 'p-sam', entity: 'cc_ihs', role: 'owner_admin' }, { person_id: 'p-kry', entity: 'cc_ihs', role: 'staffing_coordinator' }, { person_id: 'p-cc', entity: 'cc_ihs', role: 'care_coordinator' }] } }
let seq = 0
function table(name) {
  const rows = () => DB[name]
  const q = (mode, payload, filters = [], opts = {}) => {
    const match = (r) => filters.every((f) => f(r))
    const run = () => {
      if (mode === 'select') { let out = rows().filter(match); if (opts.order) out = [...out].sort((a, b) => String(b[opts.order]).localeCompare(String(a[opts.order]))); if (opts.limit) out = out.slice(0, opts.limit); return JSON.parse(JSON.stringify(out)) }
      if (mode === 'insert' && Array.isArray(payload)) { for (const p of payload) rows().push({ id: ++seq, ...p }); return payload }
      if (mode === 'insert') { const r = { ...payload }; if (name === 'caregiver_level_evidence') { if (rows().some((x) => x.ref_request_id && x.ref_request_id === r.ref_request_id && x.level === r.level)) throw new Error('duplicate key value'); r.id = r.id || 'ev-' + (++seq) } if (name === 'client_journey') { if (rows().some((x) => x.offer_id === r.offer_id)) throw new Error('duplicate offer_id'); r.journey_id = r.journey_id || 'j-' + (++seq); r.created_at = new Date().toISOString() } if (name === 'client_journey_event') { r.id = ++seq; r.at = r.at || new Date().toISOString() } rows().push(r); return [r] }
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
const KINDS = ['client_created','client_linked','client_updated','responsible_party','care_level','care_tasks','care_plan_note','client_note','caregiver_note','schedule','visit_caregiver','call_summary','scheduling_note','caregiver_status','prn_team_classes','caregiver_hire_date','caregiver_level']
const OWNED = ['eligibility_history', 'eligibility_state', 'eligibility_reason', 'eligibility_at', 'axiscare_note_for', 'approved_to_work_at', 'approved_to_work_by', 'axiscare_status_active', 'axiscare_status_label', 'axiscare_status_at', 'work_lock']
async function rpc(name, a) {
  if (name === 'axiscare_change_record') { if (!KINDS.includes(a.p_kind) || !['sent_confirmed','sent','refused','practice'].includes(a.p_outcome) || !/^\d+$/.test(String(a.p_caregiver ?? ''))) return { data: { outcome: 'refused', reason: 'check' }, error: null }; DB.axiscare_change_log.push({ id: DB.axiscare_change_log.length + 1, at: new Date().toISOString(), kind: a.p_kind, caregiver: a.p_caregiver, outcome: a.p_outcome, summary: a.p_summary, detail: a.p_detail, by: a.p_by, via: a.p_via }); return { data: { outcome: 'recorded', id: DB.axiscare_change_log.length }, error: null } }
  if (name === 'caregiver_audit_patch') { const AUD = ['orient_date', 'orient_proof', 'alz_date', 'alz_hrs', 'alz_proof', 'ojt_online', 'ojt_online_proof', 'annual_date', 'annual_hrs', 'annual_proof', 'hire_date', 'first_contact', 'axiscare_id', 'th_synced', 'oig', 'oig_date', 'oig_proof', 'oig_evidence']; const bad = Object.keys(a.p_patch).filter((k) => !AUD.includes(k)); if (bad.length) return { data: null, error: { message: 'not a field the audit owns: ' + bad.join(', ') } }; const list = DB.app_data.find((x) => x.key === 'caregivers')?.data || []; const r = list.find((x) => String(x.id) === String(a.p_id)); if (!r) return { data: { ok: false, reason: 'gone' }, error: null }; Object.assign(r, a.p_patch); return { data: { ok: true, rev: 1 }, error: null } }
  if (name === 'caregiver_sweep_patch') { const bad = Object.keys(a.p_patch).filter((k) => !OWNED.includes(k)); if (bad.length) return { data: null, error: { message: 'not a field the sweep owns: ' + bad.join(', ') } }; const list = DB.app_data.find((x) => x.key === 'caregivers')?.data || []; const r = list.find((x) => String(x.id) === String(a.p_id)); if (!r) return { data: { ok: false, reason: 'gone' }, error: null }; Object.assign(r, a.p_patch); return { data: { ok: true, rev: 1 }, error: null } }
  if (name === 'upsert_app_data_item') { let row = DB.app_data.find((x) => x.key === a.target_key); if (!row) { row = { key: a.target_key, data: [] }; DB.app_data.push(row) } const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = a.item; else row.data.push(a.item); return { data: null, error: null } }
  if (name === 'level_patch') { const LV = ['care_level_approved', 'care_level_by', 'care_level_by_email', 'care_level_at', 'care_level_note', 'care_level_evidence', 'care_level_history']; const bad = Object.keys(a.p_patch).filter((k) => !LV.includes(k)); if (bad.length) return { data: null, error: { message: 'not a Level of Care field: ' + bad.join(', ') } }
    const row = DB.app_data.find((x) => x.key === a.p_key); const rec = (row?.data || []).find((x) => String(x.id) === String(a.p_id)); if (!rec) return { data: { ok: false, reason: 'gone' }, error: null }; Object.assign(rec, a.p_patch); return { data: { ok: true }, error: null } }
  if (name === 'ok_applicant_hold') return { data: false, error: null }   // 806: nobody here is an Oklahoma applicant
  return { data: null, error: { message: 'unknown rpc ' + name } }
}
const storage = { from: (bucket) => ({ upload: async (path, body, opts) => { if (STORE.uploads.some((u) => u.bucket === bucket && u.path === path)) return { error: { message: 'exists' } }; const text = typeof body === 'string' ? body : body instanceof Uint8Array ? Buffer.from(body).toString('latin1') : await body.text(); STORE.uploads.push({ bucket, path, text, opts }); return { data: { path }, error: null } }, createSignedUrl: async (path, s) => ({ data: { signedUrl: 'https://signed/' + bucket + '/' + path + '?s=' + s }, error: null }) }) }
globalThis.__fakeCreateClient = () => ({ from: table, rpc, storage, auth: { getUser: async (jwt) => ({ sam: { data: { user: { id: 'u-sam', email: 'sam@mo-care.com', app_metadata: {} } }, error: null }, kry: { data: { user: { id: 'u-kry', email: 'krystal@mo-care.com', app_metadata: {} } }, error: null }, cc: { data: { user: { id: 'u-cc', email: 'casey@mo-care.com', app_metadata: {} } }, error: null } })[jwt] || { data: null, error: { message: 'bad' } } } })
const TMP = path.join(ROOT, '.lvl_1033_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(FN, TMP, { recursive: true })
for (const p of fs.readdirSync(TMP, { recursive: true })) { const f = path.join(TMP, String(p)); if (!f.endsWith('.ts')) continue; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient').replace(/^import .* from 'https:[^']*'$/mg, '')) }
let CJ, WL, EXPORT, CJI; try { CJI = await import(path.join(TMP, 'caregiver-journey', 'index.ts')); const h1 = handler; await import(path.join(TMP, 'caregiver-export', 'index.ts')); EXPORT = handler; handler = h1; CJ = await import(path.join(TMP, '_shared', 'caregiver-journey.ts')); WL = await import(path.join(TMP, '_shared', 'work-lock.ts')) } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const call = async (body, tok) => { const r = await handler(new Request('http://x/caregiver-journey', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? (tok === 'cron' ? { 'x-cron-secret': env.HUB_JOB_SECRET } : { Authorization: 'Bearer ' + tok }) : {}) }, body: JSON.stringify(body) })); let j = null; try { j = await r.json() } catch {} return { status: r.status, j } }
const db = globalThis.__fakeCreateClient()
const OID = '11111111-2222-4333-8444-555555555555'
reset()
OFFERS[OID] = { id: OID, first_name: 'Ava', last_name: 'Lee', phone: '4175550100', offer_signed_at: '2026-10-09T20:00:00Z', pd_signed_at: '2026-10-09T20:05:00Z', offer_version: 1, pd_version: 1, offer_status: 'accepted', onboarding_path: 'new' }
DB.app_data = [{ key: 'onboarding_permissions', data: { version: 1, advance: [{ person_id: 'p-kry' }], work: [{ person_id: 'p-sam' }], screening: [{ person_id: 'p-kry' }], history: [] } }, { key: 'ops_settings', data: { staffing_email: 'krystal@mo-care.com' } }, { key: 'candidates', data: [] }, { key: 'caregivers', data: [] }]
/* ═══ start (from offer-sign) ═══ */
let s = await CJ.startCaregiverJourney(db, { id: OID, first_name: 'Ava', last_name: 'Lee' }, 'offer-sign')
ck('start: a caregiver journey row with the offer id and a started event', s.created && DB.client_journey.length === 1 && DB.client_journey[0].subject === 'caregiver' && DB.client_journey[0].offer_id === OID && DB.client_journey_event[0].kind === 'started', { s, j: DB.client_journey[0] })
s = await CJ.startCaregiverJourney(db, { id: OID, first_name: 'Ava', last_name: 'Lee' }, 'offer-sign')
ck('start again: the same journey, no second row or event', !s.created && DB.client_journey.length === 1 && DB.client_journey_event.length === 1)
const JID = DB.client_journey[0].journey_id

const cand = { id: 901, first: 'Ava', last: 'Lee', offer_id: OID, onboarding_path: 'new', r1n: 'Susie Boss', r1s: 'Positive', r1_type: 'professional', r2n: 'Pat Pal', r2s: 'Positive' }
DB.app_data.find((x) => x.key === 'candidates').data = [cand]
DB.step1_forms = [{ offer_id: OID, answers: { level2: 'Yes', preferred_levels: ['Level 2', 'Level 3'], specialties: { "Parkinson's disease": 'yes' }, jobs: [{ company: 'Brookdale', role: 'Caregiver', from: '2023-01', to: '2026-01', tasks: ['bathing', 'transfers_gait_belt'] }] }, completed_at: '2026-10-10T15:00:00Z', signatures: {} }]
OFFERS[OID].level_suggested = 2
let r = await call({ action: 'level_get', offer_id: OID }, 'kry')
ck('level_get: claimed in their words and the interviewer’s, approved Level 1 by default, verified 1, Krystal may not approve, the duty lists', r.status === 200 && r.j.claimed.level === 3 && r.j.claimed.said.level2 === 'Yes' && r.j.claimed.interviewer_level === 2 && r.j.claimed.said.experience[0].where === 'Brookdale, Caregiver'
  && r.j.approved.level === 1 && r.j.approved.default === true && r.j.verified_level === 1 && r.j.may_approve === false && r.j.duties[2].some((d) => d.key === 'transfers_gait_belt') && r.j.duties[3].some((d) => d.key === 'hoyer_lift'), r.j)
r = await call({ action: 'level_evidence', offer_id: OID, level: 2, kind: 'employment', source: 'Brookdale', who: 'Susie Boss', duties: [], from: '2023-01-01', to: '2026-01-01' }, 'kry')
ck('evidence with no duties: refused (a job title or a place is not enough)', r.status === 400 && /duty/.test(r.j.error), r.j)
r = await call({ action: 'level_evidence', offer_id: OID, level: 3, kind: 'credential', credential: { type: 'CNA', number: '123', status: 'active', looked_up: '2026-10-21' } }, 'kry')
ck('a credential for Level 3: refused (Level 2 only)', r.status === 400 && /Level 2 only/.test(r.j.error), r.j)
r = await call({ action: 'level_evidence', offer_id: OID, level: 2, kind: 'credential', credential: { type: 'CNA', number: '123', status: 'expired', looked_up: '2026-10-21' } }, 'kry')
ck('an expired credential: refused', r.status === 400 && /active/.test(r.j.error), r.j)
r = await call({ action: 'level_approve', offer_id: OID, level: 2 }, 'sam')
ck('approve Level 2 before any proof: refused, no override', r.status === 409 && /not verified/.test(r.j.error) && !cand.care_level_approved, r.j)
r = await call({ action: 'level_evidence', offer_id: OID, level: 2, kind: 'employment', source: 'Brookdale', who: 'Susie Boss', duties: ['bathing', 'Transfers with gait belt'], from: '2023-01-01', to: '2026-01-01', note: 'called 10/21' }, 'kry')
ck('a dated employment call naming Level 2 duties: recorded with who and when; verified Level 2', r.status === 200 && r.j.verified_level === 2 && r.j.evidence.length === 1 && r.j.evidence[0].by === 'Krystal' && r.j.evidence[0].duties.join() === 'bathing,transfers_gait_belt' && DB.client_journey_event.some((e) => e.kind === 'level_evidence'), r.j)
r = await call({ action: 'level_approve', offer_id: OID, level: 2 }, 'kry')
ck('Krystal (not on the Approve to Work list) cannot approve a level', r.status === 403, r.j)
r = await call({ action: 'level_approve', offer_id: OID, level: 3 }, 'sam')
ck('Samantha: Level 3 above verified is refused', r.status === 409, r.j)
r = await call({ action: 'level_approve', offer_id: OID, level: 2, note: 'Susie confirmed' }, 'sam')
ck('Samantha approves Level 2: care_level_approved on the record (the field Approve to Work reads), who, when, note, the evidence snapshot, history; AxisCare waits for Approve to Work', r.status === 200 && cand.care_level_approved === 2 && cand.care_level_by_email === 'sam@mo-care.com' && cand.care_level_note === 'Susie confirmed' && cand.care_level_evidence.length === 1 && cand.care_level_history.length === 1
  && r.j.approved.level === 2 && r.j.approved.default === false && r.j.axiscare.state === 'not_yet' && DB.client_journey_event.some((e) => e.kind === 'level_approved'), { j: r.j, cand })
/* the reference form's "Yes, I saw it myself" answers */
DB.reference_requests = [{ id: 'rq-1', candidate_id: '901', slot: 1, ref_type: 'professional', ref_name: 'Susie Boss', ref_company: 'Brookdale', emp_from: '2023-01-01', emp_to: '2026-01-01', responded_at: '2026-10-20T15:00:00Z', task_confirm: { bedbound_care: 'saw', hoyer_lift: 'saw', bathing: 'believe', feeding: 'saw' } }]
r = await call({ action: 'sweep' }, 'cron')
ck('switch off: the sweep only counts the reference evidence it would add', r.j.level_refs && r.j.level_refs.live === false && r.j.level_refs.would === 1 && DB.caregiver_level_evidence.length === 1, r.j.level_refs)
DB.app_data.find((x) => x.key === 'ops_settings').data.level_from_refs_live = true
r = await call({ action: 'sweep' }, 'cron')
const ref3 = DB.caregiver_level_evidence.find((e) => e.ref_request_id === 'rq-1')
ck('switch on: ONE Level 3 row from "I saw it myself" (bedbound, repositioning, Hoyer), with the employer’s dates; "believe" and non-level tasks never count', r.j.level_refs.added === 1 && ref3 && ref3.level === 3 && ref3.duties.join() === 'bedbound_clients,frequent_repositioning,hoyer_lift' && ref3.date_from === '2023-01-01' && !DB.caregiver_level_evidence.some((e) => e.ref_request_id === 'rq-1' && e.level === 2), DB.caregiver_level_evidence)
r = await call({ action: 'sweep' }, 'cron')
ck('the next sweep adds nothing twice', DB.caregiver_level_evidence.length === 2 && r.j.level_refs.added === 0)
r = await call({ action: 'level_get', offer_id: OID }, 'sam')
ck('verified Level 3 now; approved stays Level 2 until Samantha approves; she may approve', r.j.verified_level === 3 && r.j.approved.level === 2 && r.j.may_approve === true, r.j)
cand.r1s = 'Conditional'; DB.reference_requests[0].id = 'rq-2'; r = await call({ action: 'sweep' }, 'cron')
ck('a reference that is not Positive on the record never becomes evidence', !DB.caregiver_level_evidence.some((e) => e.ref_request_id === 'rq-2'))
fs.rmSync(TMP, { recursive: true, force: true })
for (const [n, o, note] of res) console.log((o ? 'PASS  ' : 'FAIL  ') + n + (o ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
