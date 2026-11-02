// ACTIVE AT ORIENTATION (Samantha 2026-11-01): AxisCare Active the moment orientation is done, even with other readiness steps
// open, while the Hub's work lock still holds shifts until Approve to Work. Fake database, fake AxisCare, nothing real is touched.
// node orientation_active_test.mjs
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
    if (m === 'PATCH') { if (AX.patch === 200 && o.body) { const b = JSON.parse(o.body); if (b.hireDate) AX.hireDate = b.hireDate; if (b.status) AX.label = b.status; if (b.classes) AX.classes = b.classes } return new Response(AX.patch === 200 ? JSON.stringify({ results: { data: { id: Number(id) } } }) : JSON.stringify({ errors: ['Status not found'] }), { status: AX.patch }) }
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
const KINDS = ['client_created','client_linked','client_updated','responsible_party','care_level','care_tasks','care_plan_note','client_note','caregiver_note','schedule','visit_caregiver','call_summary','scheduling_note','caregiver_status','prn_team_classes','caregiver_hire_date','caregiver_level']
const OWNED = ['eligibility_history', 'eligibility_state', 'eligibility_reason', 'eligibility_at', 'axiscare_note_for', 'approved_to_work_at', 'approved_to_work_by', 'axiscare_status_active', 'axiscare_status_label', 'axiscare_status_at', 'work_lock']
async function rpc(name, a) {
  if (name === 'axiscare_change_record') { if (!KINDS.includes(a.p_kind) || !['sent_confirmed','sent','refused','practice'].includes(a.p_outcome) || !/^\d+$/.test(String(a.p_caregiver ?? ''))) return { data: { outcome: 'refused', reason: 'check' }, error: null }; DB.axiscare_change_log.push({ id: DB.axiscare_change_log.length + 1, at: new Date().toISOString(), kind: a.p_kind, caregiver: a.p_caregiver, outcome: a.p_outcome, summary: a.p_summary, detail: a.p_detail, by: a.p_by, via: a.p_via }); return { data: { outcome: 'recorded', id: DB.axiscare_change_log.length }, error: null } }
  if (name === 'caregiver_audit_patch') { const AUD = ['orient_date', 'orient_proof', 'alz_date', 'alz_hrs', 'alz_proof', 'ojt_online', 'ojt_online_proof', 'annual_date', 'annual_hrs', 'annual_proof', 'hire_date', 'first_contact', 'axiscare_id', 'th_synced', 'oig', 'oig_date', 'oig_proof', 'oig_evidence']; const bad = Object.keys(a.p_patch).filter((k) => !AUD.includes(k)); if (bad.length) return { data: null, error: { message: 'not a field the audit owns: ' + bad.join(', ') } }; const list = DB.app_data.find((x) => x.key === 'caregivers')?.data || []; const r = list.find((x) => String(x.id) === String(a.p_id)); if (!r) return { data: { ok: false, reason: 'gone' }, error: null }; Object.assign(r, a.p_patch); return { data: { ok: true, rev: 1 }, error: null } }
  if (name === 'caregiver_sweep_patch') { const bad = Object.keys(a.p_patch).filter((k) => !OWNED.includes(k)); if (bad.length) return { data: null, error: { message: 'not a field the sweep owns: ' + bad.join(', ') } }; const list = DB.app_data.find((x) => x.key === 'caregivers')?.data || []; const r = list.find((x) => String(x.id) === String(a.p_id)); if (!r) return { data: { ok: false, reason: 'gone' }, error: null }; Object.assign(r, a.p_patch); return { data: { ok: true, rev: 1 }, error: null } }
  if (name === 'upsert_app_data_item') { let row = DB.app_data.find((x) => x.key === a.target_key); if (!row) { row = { key: a.target_key, data: [] }; DB.app_data.push(row) } const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = a.item; else row.data.push(a.item); return { data: null, error: null } }
  if (name === 'ok_applicant_hold') return { data: false, error: null }   // 806: nobody here is an Oklahoma applicant
  return { data: null, error: { message: 'unknown rpc ' + name } }
}
const storage = { from: (bucket) => ({ upload: async (path, body, opts) => { if (STORE.uploads.some((u) => u.bucket === bucket && u.path === path)) return { error: { message: 'exists' } }; const text = typeof body === 'string' ? body : body instanceof Uint8Array ? Buffer.from(body).toString('latin1') : await body.text(); STORE.uploads.push({ bucket, path, text, opts }); return { data: { path }, error: null } }, createSignedUrl: async (path, s) => ({ data: { signedUrl: 'https://signed/' + bucket + '/' + path + '?s=' + s }, error: null }) }) }
globalThis.__fakeCreateClient = () => ({ from: table, rpc, storage, auth: { getUser: async (jwt) => ({ sam: { data: { user: { id: 'u-sam', email: 'sam@mo-care.com', app_metadata: {} } }, error: null }, kry: { data: { user: { id: 'u-kry', email: 'krystal@mo-care.com', app_metadata: {} } }, error: null }, cc: { data: { user: { id: 'u-cc', email: 'casey@mo-care.com', app_metadata: {} } }, error: null } })[jwt] || { data: null, error: { message: 'bad' } } } })
const TMP = path.join(ROOT, '.orient_active_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(FN, TMP, { recursive: true })
for (const p of fs.readdirSync(TMP, { recursive: true })) { const f = path.join(TMP, String(p)); if (!f.endsWith('.ts')) continue; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient').replace(/^import .* from 'https:[^']*'$/mg, '')) }
let CJ, WL, EXPORT, CJI; try { CJI = await import(path.join(TMP, 'caregiver-journey', 'index.ts')); const h1 = handler; await import(path.join(TMP, 'caregiver-export', 'index.ts')); EXPORT = handler; handler = h1; CJ = await import(path.join(TMP, '_shared', 'caregiver-journey.ts')); WL = await import(path.join(TMP, '_shared', 'work-lock.ts')) } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const call = async (body, tok) => { const r = await handler(new Request('http://x/caregiver-journey', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? (tok === 'cron' ? { 'x-cron-secret': env.HUB_JOB_SECRET } : { Authorization: 'Bearer ' + tok }) : {}) }, body: JSON.stringify(body) })); let j = null; try { j = await r.json() } catch {} return { status: r.status, j } }
const db = globalThis.__fakeCreateClient()
const OID = '77777777-2222-4333-8444-555555555555'
const fresh = (settings) => {
  reset(); AX.calls = []; AX.patch = 200; AX.label = 'In Training'; AX.active = true; AX.hireDate = null
  DB.app_data = [{ key: 'onboarding_permissions', data: { version: 1, advance: [], work: [{ person_id: 'p-sam' }], screening: [], history: [] } },
    { key: 'ops_settings', data: { staffing_email: 'krystal@mo-care.com', approve_work_axiscare_live: true, axiscare_hire_date_live: true, axiscare_level_live: true, axiscare_active_at_orientation_live: true, ...settings } },
    { key: 'candidates', data: [] }, { key: 'caregivers', data: [{ id: 501, first: 'Ava', last: 'Test', offer_id: OID, axiscare_id: '619', orient_date: '2026-10-19', work_lock: true }] }]
  OFFERS[OID] = { id: OID, first_name: 'Ava', last_name: 'Test', phone: '4175550100', offer_signed_at: '2026-10-09T20:00:00Z', pd_signed_at: '2026-10-09T20:05:00Z', offer_version: 1, pd_version: 1, offer_status: 'accepted', onboarding_path: 'new' }
}
const steps = (jid) => DB.client_journey_step.filter((x) => x.journey_id === jid), st = (jid, k) => steps(jid).find((x) => x.step_key === k)
const roster = () => DB.app_data.find((x) => x.key === 'caregivers').data[0]
const patches = () => AX.calls.filter((c) => c.startsWith('PATCH 619') && c.includes('"status"'))

/* 1. the sweep: orientation done, references and Step 2 still open */
fresh({})
await CJ.startCaregiverJourney(db, { id: OID, first_name: 'Ava', last_name: 'Test' }, 'offer-sign')
let JID = DB.client_journey[0].journey_id
let r = await call({ action: 'sweep' }, 'cron')
ck('sweep: like a real case, the card still holds its orientation row (Orientation Video Call not done), yet the roster says orientation is done', st(JID, 'cg.training.orientation')?.state !== 'complete' && roster().orient_date, steps(JID).map((x) => x.step_key + ':' + x.state))
ck('sweep: AxisCare set Active (one PATCH status Active) and read back, even though Approve to Work is not done', patches().some((c) => c.includes('"status":"Active"')) && st(JID, 'cg.axiscare.active')?.state === 'complete' && st(JID, 'cg.axiscare.active').evidence.at_orientation === true && st(JID, 'cg.approve.work')?.state !== 'complete', { calls: AX.calls, r: r.j })
ck('sweep: the run counts it', r.j?.active_at_orientation?.confirmed === 1, r.j)
ck('the hire date is written as the orientation day', AX.hireDate === '2026-10-19' && st(JID, 'cg.axiscare.hire_date')?.state === 'complete', { hire: AX.hireDate })
ck('the change log says why: Orientation finished', DB.axiscare_change_log.some((x) => /^Orientation finished: set the caregiver Active/.test(x.summary)), DB.axiscare_change_log)
ck('roster: AxisCare status Active recorded, work_lock still true', roster().axiscare_status_active === true && roster().work_lock === true, roster())
let L = await WL.workLock(db)
ck('work lock still holds them: no shift offers before Approve to Work', L.ok && L.axis.has('619'), L)
ck('no cleared text, no check-in card yet', GHL.messages.length === 0 && !steps(JID).some((x) => x.step_key === 'cg.checkin.call'))
const n = patches().length
r = await call({ action: 'sweep' }, 'cron')
ck('the next sweep does nothing more (already Active, no second PATCH)', patches().length === n, AX.calls)

/* 2. switch off: the old way */
fresh({ axiscare_active_at_orientation_live: false })
await CJ.startCaregiverJourney(db, { id: OID, first_name: 'Ava', last_name: 'Test' }, 'offer-sign'); JID = DB.client_journey[0].journey_id
await call({ action: 'sweep' }, 'cron')
ck('switch off: nothing is sent to AxisCare, Active waits for Approve to Work', patches().length === 0 && st(JID, 'cg.axiscare.active')?.state !== 'complete', AX.calls)
fresh({ approve_work_axiscare_live: false })
await CJ.startCaregiverJourney(db, { id: OID, first_name: 'Ava', last_name: 'Test' }, 'offer-sign'); JID = DB.client_journey[0].journey_id
await call({ action: 'sweep' }, 'cron')
ck('AxisCare writes off: nothing is sent either', patches().length === 0, AX.calls)

/* 3. orientation not done: nothing */
fresh({}); roster().orient_date = null
await CJ.startCaregiverJourney(db, { id: OID, first_name: 'Ava', last_name: 'Test' }, 'offer-sign'); JID = DB.client_journey[0].journey_id
await call({ action: 'sweep' }, 'cron')
ck('orientation not done: AxisCare untouched', patches().length === 0, AX.calls)

/* 4. AxisCare refuses: one card, then a person sets it by hand and the sweep reads it back */
fresh({}); AX.patch = 400
await CJ.startCaregiverJourney(db, { id: OID, first_name: 'Ava', last_name: 'Test' }, 'offer-sign'); JID = DB.client_journey[0].journey_id
r = await call({ action: 'sweep' }, 'cron')
const ops = () => (DB.app_data.find((x) => x.key === 'ops_items')?.data || []).filter((x) => String(x.id).startsWith('cj_orientax_'))
ck('refused: the row is blocked with AxisCare\'s words, one card says what to do', st(JID, 'cg.axiscare.active')?.state === 'blocked' && /Orientation finished, AxisCare not switched to Active/.test(st(JID, 'cg.axiscare.active').blocked_reason) && ops().length === 1 && /Set them Active in AxisCare by hand/.test(ops()[0].detail), { s: st(JID, 'cg.axiscare.active'), ops: ops() })
const n2 = patches().length
AX.label = 'Active'
r = await call({ action: 'sweep' }, 'cron')
ck('next sweep only READS (no new PATCH), sees Active set by hand, completes the row and closes the card', patches().length === n2 && st(JID, 'cg.axiscare.active')?.state === 'complete' && ops()[0]?.status === 'done', { status: ops().map((x) => x.status + '|' + x.close_reason), calls: AX.calls })

/* 5. the Training Platform report: orientation lands, Active at once */
fresh({}); roster().orient_date = null
await CJ.startCaregiverJourney(db, { id: OID, first_name: 'Ava', last_name: 'Test' }, 'offer-sign'); JID = DB.client_journey[0].journey_id
await call({ action: 'sweep' }, 'cron')
const rep = async (body) => { const x = await handler(new Request('http://x/caregiver-journey', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-outreach-secret': env.OUTREACH_SECRET }, body: JSON.stringify(body) })); return { status: x.status, j: await x.json().catch(() => null) } }
roster().orient_date = '2026-11-01'
r = await rep({ action: 'training_report', axiscare_id: '619', courses: [{ slug: 'agency-orientation', title: 'Agency Orientation', status: 'complete', completed_at: '2026-11-01T16:00:00Z' }] })
ck('training report: orientation reported (the card still holds its row for the welcome call) and AxisCare Active right away anyway', r.status === 200 && r.j.held.includes('cg.training.orientation') && r.j.active_at_orientation === 'confirmed' && st(JID, 'cg.axiscare.active')?.state === 'complete', { r: r.j, calls: AX.calls, held: r.j?.held })

const bad = res.filter((x) => !x[1])
for (const [n3, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n3 + (ok ? '' : '\n      ' + note))
console.log(`${res.length - bad.length}/${res.length} passed`)
process.exit(bad.length ? 1 : 0)
