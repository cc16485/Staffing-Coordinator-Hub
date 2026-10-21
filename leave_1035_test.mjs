// 1035 LEAVING ONBOARDING (leave / come_back), on the harness of caregiver_journey_6_test.mjs.
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
const PATCHED = []
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
    if (m === 'PATCH') { if (AX.patch === 200 && o.body) { const b = JSON.parse(o.body); if (b.hireDate) AX.hireDate = b.hireDate; if (b.classes) AX.classes = b.classes } return new Response(AX.patch === 200 ? JSON.stringify({ results: { caregiver: { id: Number(id) } } }) : JSON.stringify({ errors: ['Status not found'] }), { status: AX.patch }) }
    return new Response(JSON.stringify({ results: { caregiver: { id: Number(id), status: { active: AX.active, label: AX.label }, hireDate: AX.hireDate, classes: AX.classes || [] } } }), { status: 200 }) }
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
const reset = () => { DB = { reference_requests: [], client_journey_step_def: JSON.parse(JSON.stringify(DEFS)), client_journey: [], client_journey_step: [], client_journey_event: [], app_data: [], step1_forms: [], welcome_calls: [], caregiver_profiles: [], job_applicants: [], contact_optout_current: [], circle_contacts: [], axiscare_change_log: [], document_access_log: [], domains: [], auth_identities: [{ auth_user_id: 'u-sam', person_id: 'p-sam', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-kry', person_id: 'p-kry', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-cc', person_id: 'p-cc', project_ref: 'zngsgedlsxinbygwmxwn' }], persons: [{ person_id: 'p-sam', full_name: 'Samantha', active: true }, { person_id: 'p-kry', full_name: 'Krystal', active: true }, { person_id: 'p-cc', full_name: 'Casey', active: true }], entity_memberships: [{ person_id: 'p-sam', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-kry', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-cc', entity: 'cc_ihs', active: true, ended_at: null }], staff_roles: [{ person_id: 'p-sam', entity: 'cc_ihs', role: 'owner_admin' }, { person_id: 'p-kry', entity: 'cc_ihs', role: 'staffing_coordinator' }, { person_id: 'p-cc', entity: 'cc_ihs', role: 'care_coordinator' }] } }
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
      eq: (k, v) => q(mode, payload, [...filters, (r) => String(r[k]) === String(v)], opts), is: (k, v) => q(mode, payload, [...filters, (r) => v === null ? (r[k] ?? null) === null : r[k] === v], opts), neq: (k, v) => q(mode, payload, [...filters, (r) => String(r[k]) !== String(v)], opts),
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
  if (name === 'leave_patch') { const LV = ['not_hired', 'not_hired_reason', 'not_hired_notes', 'not_hired_date', 'left_at', 'left_by', 'onboarding_left', 'came_back']; const bad = Object.keys(a.p_patch).filter((k) => !LV.includes(k)); if (bad.length) return { data: null, error: { message: 'not a leaving field: ' + bad.join(', ') } }
    const row = DB.app_data.find((x) => x.key === a.p_key); const rec = (row?.data || []).find((x) => String(x.id) === String(a.p_id)); if (!rec) return { data: { ok: false, reason: 'gone' }, error: null }; Object.assign(rec, a.p_patch); PATCHED.push(a.p_key + ':' + a.p_id); return { data: { ok: true }, error: null } }
  if (name === 'ok_applicant_hold') return { data: false, error: null }   // 806: nobody here is an Oklahoma applicant
  return { data: null, error: { message: 'unknown rpc ' + name } }
}
const storage = { from: (bucket) => ({ upload: async (path, body, opts) => { if (STORE.uploads.some((u) => u.bucket === bucket && u.path === path)) return { error: { message: 'exists' } }; const text = typeof body === 'string' ? body : body instanceof Uint8Array ? Buffer.from(body).toString('latin1') : await body.text(); STORE.uploads.push({ bucket, path, text, opts }); return { data: { path }, error: null } }, createSignedUrl: async (path, s) => ({ data: { signedUrl: 'https://signed/' + bucket + '/' + path + '?s=' + s }, error: null }) }) }
globalThis.__fakeCreateClient = () => ({ from: table, rpc, storage, auth: { getUser: async (jwt) => ({ sam: { data: { user: { id: 'u-sam', email: 'sam@mo-care.com', app_metadata: {} } }, error: null }, kry: { data: { user: { id: 'u-kry', email: 'krystal@mo-care.com', app_metadata: {} } }, error: null }, cc: { data: { user: { id: 'u-cc', email: 'casey@mo-care.com', app_metadata: {} } }, error: null } })[jwt] || { data: null, error: { message: 'bad' } } } })
const TMP = path.join(ROOT, '.leave_1035_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(FN, TMP, { recursive: true })
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

const cand = { id: 901, first: 'Ava', last: 'Lee', offer_id: OID, onboarding_path: 'new', r1n: 'Susie', r1s: 'Pending', r2n: 'Pat', r2s: 'Pending', r3n: 'Old', r3s: 'Positive' }
DB.app_data.find((x) => x.key === 'candidates').data = [cand]
DB.reference_requests = [{ id: 'rq1', candidate_id: '901', slot: 1, responded_at: null, closed_at: null }, { id: 'rq2', candidate_id: '901', slot: 2, responded_at: null, closed_at: null },
  { id: 'rq3', candidate_id: '901', slot: 3, responded_at: '2026-10-11T15:00:00Z', closed_at: null }, { id: 'rq4', candidate_id: '901', slot: 4, responded_at: null, closed_at: '2026-10-10T15:00:00Z', closed_reason: 'replaced by the office' },
  { id: 'rq9', candidate_id: '777', slot: 1, responded_at: null, closed_at: null }]
DB.app_data.push({ key: 'ops_items', data: [{ id: 'step2_stalled_901', kind: 'step2_stalled', status: 'open', candidate_id: '901' }, { id: 'cj_final_' + JID, kind: 'final_approval', status: 'open', offer_id: OID },
  { id: 's1done_' + OID, kind: 'step1_complete', status: 'open', offer_id: OID }, { id: 'other', kind: 'x', status: 'open', candidate_id: '777' }, { id: 'old', kind: 'x', status: 'done', offer_id: OID }] })
const ops = () => DB.app_data.find((x) => x.key === 'ops_items').data
let r = await call({ action: 'leave', candidate_id: '901', reason: 'bg_finding' }, 'kry')
ck('a reason that is not one of her four is refused (a background finding goes through the background review)', r.status === 400 && /background review/.test(r.j.error), r.j)
r = await call({ action: 'leave', reason: 'ghosted' }, 'kry')
ck('no id: refused', r.status === 404, r.j)
r = await call({ action: 'leave', reason: 'ghosted' })
ck('no sign-in: refused', r.status === 401)
r = await call({ action: 'leave', candidate_id: '901', reason: 'ghosted', note: 'no answer since Oct 9' }, 'kry')
ck('leave (Krystal, office): the answer is { ok, closed: { references, cards }, axiscare_card }', r.status === 200 && r.j.ok && r.j.closed.references === 2 && r.j.closed.cards === 3 && r.j.axiscare_card === false, r.j)
ck('(a) the candidate through the leave door only: not_hired, the reason code, the note, the Central date, who and when', cand.not_hired === true && cand.not_hired_reason === 'ghosted' && cand.not_hired_notes === 'no answer since Oct 9' && /^\d{4}-\d{2}-\d{2}$/.test(cand.not_hired_date) && cand.left_by === 'Krystal' && cand.left_at && PATCHED.join() === 'candidates:901', { cand, PATCHED })
ck('(b) the readiness card is closed with the reason; its open cards closed with "They left onboarding: Stopped answering"; others untouched', DB.client_journey[0].status === 'closed' && DB.client_journey[0].closed_reason === 'left onboarding: ghosted'
  && ops().filter((i) => ['step2_stalled_901', 'cj_final_' + JID, 's1done_' + OID].includes(i.id)).every((i) => i.status === 'done' && i.close_reason === 'They left onboarding: Stopped answering') && ops().find((i) => i.id === 'other').status === 'open', ops())
ck('(c) only their unanswered, still-open reference requests close; answered, already-closed and other people’s are untouched', ['rq1', 'rq2'].every((id) => DB.reference_requests.find((x) => x.id === id).closed_reason === 'left onboarding: ghosted') && !DB.reference_requests.find((x) => x.id === 'rq3').closed_at && DB.reference_requests.find((x) => x.id === 'rq4').closed_reason === 'replaced by the office' && !DB.reference_requests.find((x) => x.id === 'rq9').closed_at, DB.reference_requests)
ck('history: one left_onboarding event with who, the reason and what closed', DB.client_journey_event.some((e) => e.kind === 'left_onboarding' && e.actor_email === 'krystal@mo-care.com' && e.detail.reason === 'ghosted' && e.detail.references_closed === 2))
r = await call({ action: 'sweep' }, 'cron')
ck('the sweep never looks at a closed card again', r.j.looked_at === 0, r.j)
r = await call({ action: 'leave', candidate_id: '901', reason: 'other_job' }, 'kry')
ck('leave twice: refused, nothing changed', r.status === 409 && cand.not_hired_reason === 'ghosted')
r = await call({ action: 'come_back', candidate_id: '901', note: 'she called back' }, 'kry')
ck('come back: Krystal (not an owner, not on the Approve to Work list) is refused', r.status === 403, r.j)
r = await call({ action: 'come_back', candidate_id: '901', note: 'she called back' }, 'sam')
ck('come back (Samantha): not hired cleared, the leave kept as history, the card reopened, ONLY the requests leave closed reopen', r.status === 200 && cand.not_hired === false && cand.not_hired_reason === null && cand.came_back.by === 'Samantha' && cand.came_back.had_left.reason === 'ghosted'
  && DB.client_journey[0].status === 'open' && r.j.reopened.references === 2 && !DB.reference_requests.find((x) => x.id === 'rq1').closed_at && DB.reference_requests.find((x) => x.id === 'rq4').closed_reason === 'replaced by the office', { j: r.j, cand })
ck('history: a came_back event with who and why', DB.client_journey_event.some((e) => e.kind === 'came_back' && e.actor_email === 'sam@mo-care.com' && e.reason === 'she called back'))
r = await call({ action: 'come_back', candidate_id: '901' }, 'sam')
ck('come back for someone who did not leave: refused', r.status === 409)
/* already on the caregiver roster (after the video call) */
const ros = { id: 55, candidate_id: 902, first: 'Bo', last: 'Ray', offer_id: 'off-2', axiscare_id: '9002' }
DB.app_data.find((x) => x.key === 'caregivers').data = [ros]
r = await call({ action: 'leave', candidate_id: '902', reason: 'other_job' }, 'kry')
const axc = ops().find((i) => i.kind === 'axiscare_inactive_after_leave')
ck('on the roster: the roster record marked the same plus onboarding_left, and ONE card to set them inactive in AxisCare; AxisCare itself untouched', r.status === 200 && r.j.axiscare_card === true && ros.not_hired === true && ros.onboarding_left === true && ros.not_hired_reason === 'other_job'
  && axc && axc.title === 'Set Bo Ray inactive in AxisCare (they left onboarding)' && !AX.calls.some((c) => c.startsWith('PATCH')), { j: r.j, ros, axc })
fs.rmSync(TMP, { recursive: true, force: true })
/* every automation skips people who left */
const src = (p) => fs.readFileSync(path.join(FN, p), 'utf8')
ck('reference-chase never chases a closed request (first ask, texts, reminder, applicant nudge, Call card)', /\.is\('responded_at', null\)\s*\n\s*\/\*[^*]*\*\/\s*\n\s*\.is\('closed_at', null\)/.test(src('reference-chase/index.ts')) || /\.is\('closed_at', null\)/.test(src('reference-chase/index.ts')))
ck('reference-send refuses a closed request', /if \(r\?\.closed_at\) return json/.test(src('reference-send/index.ts')))
ck('Step 2: the pass skips anyone not hired or who left (reminders, held invitation texts, profile reminders, cards); the office actions refuse them (except Undo)', /if \(c\.not_hired \|\| c\.onboarding_left\) \{ out\.skipped_left/.test(src('step2-handoff/index.ts')) && /\(p\.rec\.not_hired \|\| p\.rec\.onboarding_left\) && action !== 'undo'/.test(src('step2-handoff/index.ts')))
ck('the welcome call and the one welcome message are never sent to someone who left (fails closed)', /const left = await leftOnboarding\(cand\)/.test(src('welcome-call/index.ts')))
ck('the readiness sweep skips anyone who left even if their card is still open (verdicts, advance, OIG, badge, references, level)', /if \(f\.candidate\?\.not_hired \|\| f\.roster\?\.onboarding_left \|\| f\.roster\?\.not_hired\) \{ out\.skipped_left/.test(src('caregiver-journey/index.ts')))
for (const [n, o, note] of res) console.log((o ? 'PASS  ' : 'FAIL  ') + n + (o ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
