// SLICE 8 · client-audit (the nightly client pass with the real ihs-rules.js served and approved by fingerprint, the proof
// uploads, logged opens, the export with an as-of date), the grievance answer rule in issues-run, the caregiver export as-of.
// Fake database, fake AxisCare, fake storage. Nothing real is touched. node client_audit_577_test.mjs
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
const RULESRC = fs.readFileSync(path.join(ROOT, '..', 'wt-hub4', 'ihs-rules.js'))
const AXC = { active: {}, reads: [] }
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
  if (u.startsWith('https://cc.mo-care.com/ihs-rules.js')) return new Response(RULESRC, { status: 200 })
  if (u.startsWith('https://16485.axiscare.com/api/clients/')) { const id = u.split('/').pop(); AXC.reads.push(id); return new Response(JSON.stringify({ results: { client: { id: Number(id), status: { active: AXC.active[id] !== false, label: AXC.active[id] === false ? 'Inactive' : 'Active' } } } }), { status: 200 }) }
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
const reset = () => { DB = { client_journey_step_def: JSON.parse(JSON.stringify(DEFS)), client_journey: [], client_journey_step: [], client_journey_event: [], app_data: [], step1_forms: [], welcome_calls: [], caregiver_profiles: [], job_applicants: [], contact_optout_current: [], circle_contacts: [], axiscare_change_log: [], document_access_log: [], domains: [], persons_: [], rules_approved: [], client_issue: [], issue_action: [], issue_category: [{ code: 'grievance', follow_up_required: false, resolution_means: 'a written answer', target_hours: 24 }], client_care_change: [], client_pause: [], launch_evidence: [], auth_identities: [{ auth_user_id: 'u-sam', person_id: 'p-sam', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-kry', person_id: 'p-kry', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-cc', person_id: 'p-cc', project_ref: 'zngsgedlsxinbygwmxwn' }], persons: [{ person_id: 'p-sam', full_name: 'Samantha', active: true }, { person_id: 'p-kry', full_name: 'Krystal', active: true }, { person_id: 'p-cc', full_name: 'Casey', active: true }], entity_memberships: [{ person_id: 'p-sam', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-kry', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-cc', entity: 'cc_ihs', active: true, ended_at: null }], staff_roles: [{ person_id: 'p-sam', entity: 'cc_ihs', role: 'owner_admin' }, { person_id: 'p-kry', entity: 'cc_ihs', role: 'staffing_coordinator' }, { person_id: 'p-cc', entity: 'cc_ihs', role: 'care_coordinator' }] } }
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
      ilike: (k, v) => q(mode, payload, [...filters, (r) => String(r[k] ?? '').toLowerCase().includes(String(v).replace(/%/g, '').toLowerCase())], opts), not: (k, op, v) => q(mode, payload, [...filters, (r) => op === 'is' ? (r[k] ?? null) !== v : op === 'like' ? !new RegExp('^' + String(v).replace(/[.]/g, '\\.').replace(/%/g, '.*') + '$').test(String(r[k])) : true], opts),
      order: (k) => q(mode, payload, filters, { ...opts, order: k }), limit: (n) => q(mode, payload, filters, { ...opts, limit: n }), select: () => q(mode, payload, filters, opts),
      single: async () => { try { const r = run()[0]; return r ? { data: r, error: null } : { data: null, error: { message: 'no row' } } } catch (e) { return { data: null, error: { message: e.message } } } },
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
  if (name === 'issue_context') return { data: {}, error: null }
  if (name === 'caregiver_audit_patch') { const AUD = ['orient_date', 'orient_proof', 'alz_date', 'alz_hrs', 'alz_proof', 'ojt_online', 'ojt_online_proof', 'annual_date', 'annual_hrs', 'annual_proof', 'hire_date', 'first_contact', 'axiscare_id', 'th_synced', 'oig', 'oig_date', 'oig_proof', 'oig_evidence']; const bad = Object.keys(a.p_patch).filter((k) => !AUD.includes(k)); if (bad.length) return { data: null, error: { message: 'not a field the audit owns: ' + bad.join(', ') } }; const list = DB.app_data.find((x) => x.key === 'caregivers')?.data || []; const r = list.find((x) => String(x.id) === String(a.p_id)); if (!r) return { data: { ok: false, reason: 'gone' }, error: null }; Object.assign(r, a.p_patch); return { data: { ok: true, rev: 1 }, error: null } }
  if (name === 'caregiver_sweep_patch') { const bad = Object.keys(a.p_patch).filter((k) => !OWNED.includes(k)); if (bad.length) return { data: null, error: { message: 'not a field the sweep owns: ' + bad.join(', ') } }; const list = DB.app_data.find((x) => x.key === 'caregivers')?.data || []; const r = list.find((x) => String(x.id) === String(a.p_id)); if (!r) return { data: { ok: false, reason: 'gone' }, error: null }; Object.assign(r, a.p_patch); return { data: { ok: true, rev: 1 }, error: null } }
  if (name === 'upsert_app_data_item') { let row = DB.app_data.find((x) => x.key === a.target_key); if (!row) { row = { key: a.target_key, data: [] }; DB.app_data.push(row) } const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = a.item; else row.data.push(a.item); return { data: null, error: null } }
  return { data: null, error: { message: 'unknown rpc ' + name } }
}
const storage = { from: (bucket) => ({ upload: async (path, body, opts) => { if (STORE.uploads.some((u) => u.bucket === bucket && u.path === path)) return { error: { message: 'exists' } }; const text = typeof body === 'string' ? body : body instanceof Uint8Array ? Buffer.from(body).toString('latin1') : await body.text(); STORE.uploads.push({ bucket, path, text, opts }); return { data: { path }, error: null } }, createSignedUrl: async (path, s) => ({ data: { signedUrl: 'https://signed/' + bucket + '/' + path + '?s=' + s }, error: null }), createSignedUploadUrl: async (path) => ({ data: { token: 'tok', signedUrl: 'https://upload/' + bucket + '/' + path }, error: null }), list: async (dir, o) => ({ data: STORE.uploads.filter((u) => u.bucket === bucket && u.path.startsWith(dir + '/') && (!o?.search || u.path.endsWith('/' + o.search))).map((u) => ({ name: u.path.slice(dir.length + 1) })), error: null }) }) }
globalThis.__fakeCreateClient = () => ({ from: table, rpc, storage, auth: { getUser: async (jwt) => ({ sam: { data: { user: { id: 'u-sam', email: 'sam@mo-care.com', app_metadata: {} } }, error: null }, kry: { data: { user: { id: 'u-kry', email: 'krystal@mo-care.com', app_metadata: {} } }, error: null }, cc: { data: { user: { id: 'u-cc', email: 'casey@mo-care.com', app_metadata: {} } }, error: null } })[jwt] || { data: null, error: { message: 'bad' } } } })
const TMP = path.join(ROOT, '.ca_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(FN, TMP, { recursive: true })
for (const p of fs.readdirSync(TMP, { recursive: true })) { const f = path.join(TMP, String(p)); if (!f.endsWith('.ts')) continue; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient').replace(/^import .* from 'https:[^']*'$/mg, '')) }
let CA, CAM, IR_, CGX; try { await import(path.join(TMP, 'client-audit', 'index.ts')); CA = handler; CAM = await import(path.join(TMP, 'client-audit', 'index.ts')); await import(path.join(TMP, 'issues-run', 'index.ts')); IR_ = handler; await import(path.join(TMP, 'caregiver-export', 'index.ts')); CGX = handler } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const callOf = (h, fn) => async (body, tok, qs = '') => { const r = await h(new Request('http://x/' + fn + qs, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? (tok === 'cron' ? { 'x-cron-secret': env.HUB_JOB_SECRET } : { Authorization: 'Bearer ' + tok }) : {}) }, body: JSON.stringify(body) })); let j = null; try { j = await r.json() } catch {} return { status: r.status, j } }
const call = (b, t) => callOf(CA, 'client-audit')(b, t)
const db = globalThis.__fakeCreateClient()
const crypto_ = await import('crypto'); const fp = crypto_.createHash('sha256').update(RULESRC).digest('hex')
reset()
const T = new Date().toISOString().slice(0, 10), D = (n) => new Date(Date.parse(T + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
DB.rules_approved = [{ file: 'ihs-rules.js', sha256: fp }]
DB.domains = [{ code: 'payer_programs', owner_person: 'p-ang', entity: 'cc_ihs' }]
DB.persons.push({ person_id: 'p-ang', full_name: 'Angiel', primary_email: 'angiel@mo-care.com', active: true })
const svc = (k, start, end, units) => ({ type: k.toUpperCase(), kind: k, label: k === 'pc' ? 'Personal care' : k, program: 'ihs', start, end, ours: true, units: [{ start, end, code: 'T1019', units }] })
const PLAN = (id, ax, name, o) => Object.assign({ id, kind: 'plan', axiscare_client_id: ax, lead_id: 'L' + ax, client_name: name, dcn: '1' + ax, plan_start: D(-12), plan_end: D(300), generated: D(-13), received_on: D(-12), services: [svc('pc', D(-12), D(300), 120)], confirmed_by: 'kry@mo-care.com', confirmed_at: D(-12) + 'T15:00:00Z', start: { checks: {} }, changes: [] }, o || {})
DB.app_data = [{ key: 'onboarding_permissions', data: { version: 1, advance: [], work: [{ person_id: 'p-sam' }], screening: [], audit_export: [], history: [] } },
  { key: 'ops_settings', data: { staffing_email: 'krystal@mo-care.com' } },
  { key: 'medicaid_plans', data: [
    PLAN('mcp_290', '290', 'Ann Able', { plan_end: D(30) }),
    PLAN('mcp_291', '291', 'Bo Best', { plan_start: D(-400), plan_end: D(-10), received_on: D(-400), start: { checks: {}, started_on_manual: D(-395) }, fusion_verified: { by: 'kry', checked_on: D(-399), at: D(-399) + 'T15:00:00Z' }, pdf: { path: 'careplan/mcp_291/1-x.pdf', name: 'x.pdf', by: 'kry', at: D(-399) + 'T15:00:00Z' } }),
    PLAN('mcp_292', '292', 'Cy Cole', { plan_start: D(-400), plan_end: D(-10), received_on: D(-400), start: { checks: {}, started_on_manual: D(-395) }, fusion_verified: { by: 'kry', checked_on: D(-399), at: D(-399) + 'T15:00:00Z' }, pdf: { path: 'careplan/mcp_292/1-x.pdf', name: 'x.pdf', by: 'kry', at: D(-399) + 'T15:00:00Z' } }),
    PLAN('mcp_293', '293', 'Di Dunn', { received_on: D(-30), plan_start: D(-30), services: [svc('pc', D(-30), D(300), 120)], start: { checks: {}, started_on_manual: D(-25) }, fusion_verified: { by: 'kry', checked_on: D(-29), at: D(-29) + 'T15:00:00Z' }, pdf: { path: 'careplan/mcp_293/1-x.pdf', name: 'x.pdf', by: 'kry', at: D(-29) + 'T15:00:00Z' }, changes: [{ id: 'chg1', kind: 'more', why: 'Needs help with bathing now', seen_by: 'kry', seen_at: D(-6) + 'T15:00:00Z', status: 'recommended' }] }),
    { id: 'mcm_294', kind: 'payer_mark', payer: 'private' } ] },
  { key: 'leads', data: [{ id: 'L290', axiscare_client_id: '290', funding_source: 'Medicaid', docs: [{ slot: 'FUSION', name: 'fusion.pdf', path: 'L290/FUSION-1-fusion.pdf', at: D(-12) + 'T15:00:00Z' }] }] },
  { key: 'visit_watch', data: [{ id: 'vw_290_' + T.slice(0, 7), ax: '290', month: T.slice(0, 7), authorized_units: 120, delivered_units: 0, visits_scheduled: 0, visits_delivered: 0, missed: [] }] },
  { key: 'ghe_watch', data: [] }, { key: 'ops_items', data: [] }, { key: 'automation_log', data: [] }, { key: 'caregivers', data: [] }, { key: 'candidates', data: [] }]
AXC.active['292'] = false
const ops = () => DB.app_data.find((x) => x.key === 'ops_items').data, alog = () => DB.app_data.find((x) => x.key === 'automation_log').data
const plan = (id) => DB.app_data.find((x) => x.key === 'medicaid_plans').data.find((p) => p.id === id)
/* ═══ pure: the client pass's findings ═══ */
CAM.useRules(globalThis.IhsRules || (await import('module')).createRequire(import.meta.url)(path.join(ROOT, '..', 'wt-hub4', 'ihs-rules.js')))
const F = (p, fs) => CAM.findingsFor(p, fs || (p.start && p.start.started_on_manual) || '', T, [], new Date().toISOString()).map((f) => f.kind).sort().join(',')
ck('findings: Ann (received 12 days ago, not started, no justification; plan ends in 30 days; never checked against Fusion, no PDF) → late start, plan ending, unverified', F(plan('mcp_290')) === 'ihs_start_late,plan_end_soon,plan_unverified', F(plan('mcp_290')))
ck('findings: Bo and Cy (plan ended 10 days ago, verified, PDF kept) → authorization ended (needs AxisCare to confirm care continues)', F(plan('mcp_291')) === 'auth_ended' && F(plan('mcp_292')) === 'auth_ended')
ck('findings: Di (started on time, a change recommended 6 days ago) → change stalled only', F(plan('mcp_293')) === 'change_stalled', F(plan('mcp_293')))
ck('findings: Ann with the justification recorded → no late-start finding', !/ihs_start_late/.test(F({ ...plan('mcp_290'), start: { checks: {}, late: { sent_on: D(-1), how: 'Fusion', reason: 'Family away until this week', at: D(-1) } } })))
ck('currentPlans: one plan per client, the payer mark ignored', CAM.currentPlans(DB.app_data.find((x) => x.key === 'medicaid_plans').data).size === 4)
/* ═══ the nightly pass ═══ */
let r = await call({ action: 'nightly' })
ck('nightly without the job secret: refused', r.status === 401)
r = await call({ action: 'nightly' }, 'cron')
ck('nightly in practice: 4 clients, the findings counted (AxisCare says Cy is inactive, so only Bo\'s ended plan counts), no card, a dry run in the automation log', r.status === 200 && r.j.ok && r.j.clients === 4 && r.j.findings.ihs_start_late === 1 && r.j.findings.plan_end_soon === 1 && r.j.findings.plan_unverified === 1 && r.j.findings.auth_ended === 1 && r.j.findings.change_stalled === 1 && ops().length === 0 && alog().length === 1 && alog()[0].dry === true && alog()[0].automation === 'client_audit', r.j)
DB.app_data.find((x) => x.key === 'ops_settings').data.client_audit_live = true
r = await call({ action: 'nightly' }, 'cron')
const card = (id) => ops().find((i) => i.id === id)
ck('nightly live: five cards, each owned by the Payer Programs owner (Angiel), domain payer_programs, the late start and the ended authorization urgent', r.j.raised === 5 && ops().length === 5 && ops().every((i) => i.owner === 'angiel@mo-care.com' && i.domain === 'payer_programs' && i.created_by === 'client-audit') && card('ca_start_mcp_290').urgency === 'urgent' && card('ca_ended_mcp_291').urgency === 'urgent' && !card('ca_ended_mcp_292') && card('ca_change_chg1') && /19 CSR 15-7.021\(18\)\(J\)/.test(card('ca_start_mcp_290').detail), ops().map((i) => i.id + ':' + i.owner))
r = await call({ action: 'nightly' }, 'cron')
ck('nightly again: nothing new raised, nothing closed', r.j.raised === 0 && r.j.closed === 0 && ops().length === 5)
/* the office records the justification, checks Fusion, keeps the PDF → those cards close */
Object.assign(plan('mcp_290'), { start: { checks: {}, late: { sent_on: D(-1), how: 'Fusion', reason: 'Family away until this week', at: D(-1) + 'T15:00:00Z', by: 'kry' } }, fusion_verified: { by: 'kry@mo-care.com', by_name: 'Krystal', checked_on: D(0), at: new Date().toISOString(), note: 'units match' }, pdf: { path: 'careplan/mcp_290/2-plan.pdf', name: 'plan.pdf', by: 'kry', at: new Date().toISOString() } })
r = await call({ action: 'nightly' }, 'cron')
ck('after the justification, the Fusion check and the PDF: the late-start and verify cards close themselves', r.j.closed === 2 && card('ca_start_mcp_290').status === 'done' && card('ca_verify_mcp_290').status === 'done' && card('ca_end_mcp_290').status === 'open', ops().map((i) => i.id + ':' + i.status))
DB.rules_approved = []
r = await call({ action: 'nightly' }, 'cron')
ck('rules file not approved and not checkable against GitHub main: the pass checks nobody and says so (no card changes)', r.j.ok === false && /not approved|against GitHub main/.test(r.j.errors.join(' ')) && r.j.clients === 0)
DB.rules_approved = [{ file: 'ihs-rules.js', sha256: fp }]
/* ═══ proof uploads and logged opens ═══ */
r = await call({ action: 'upload_url', kind: 'careplan', ref: 'mcp_290', name: 'plan.docx' }, 'kry')
ck('upload: the care plan must be a PDF', r.status === 400)
r = await call({ action: 'upload_url', kind: 'careplan', ref: 'mcp_290', name: 'Plan Oct.pdf' }, 'kry')
ck('upload: a private slot under careplan/<plan>/', r.status === 200 && /^careplan\/mcp_290\/\d+-Plan_Oct\.pdf$/.test(r.j.path) && r.j.url, r.j)
r = await call({ action: 'upload_url', kind: 'payroll', ref: 'x', name: 'a.pdf' }, 'kry')
ck('upload: an unknown kind is refused', r.status === 400)
r = await call({ action: 'file_url', path: 'careplan/mcp_290/2-plan.pdf', ax: '290' }, 'kry')
ck('open a care plan PDF: a five-minute link, and a row in the access log for client:290 by Krystal', r.status === 200 && r.j.expires_in === 300 && DB.document_access_log.some((l) => l.offer_id === 'client:290' && l.doc === 'careplan' && l.by_email === 'krystal@mo-care.com'), DB.document_access_log)
r = await call({ action: 'file_url', path: 'bgcheck/901/oig.json' }, 'kry')
ck('a caregiver file through the client door: refused', r.status === 400)
r = await call({ action: 'lead_doc_url', lead_id: 'L290', path: 'L999/FUSION-1.pdf' }, 'kry')
ck('an inquiry document of another inquiry: refused', r.status === 403)
r = await call({ action: 'lead_doc_url', lead_id: 'L290', path: 'L290/FUSION-1-fusion.pdf', ax: '290' }, 'kry')
ck('an inquiry document: link and logged as lead-doc', r.status === 200 && DB.document_access_log.some((l) => l.doc === 'lead-doc' && l.path === 'L290/FUSION-1-fusion.pdf'))
r = await call({ action: 'file_url', path: 'careplan/mcp_290/2-plan.pdf' })
ck('no sign-in: refused', r.status === 401)
/* ═══ the grievance written answer (issues-run) ═══ */
const issue = (o) => DB.client_issue.push(Object.assign({ id: 'g1', category: 'grievance', axiscare_client_id: '290', summary: 'Caregiver arrived late twice', state: 'open', reported_at: D(-5) + 'T15:00:00Z' }, o || {}))
issue()
const IR = (b, t) => callOf(IR_, 'issues-run')(b, t, '?action=1')
let g = await IR({ issue_id: 'g1', action_type: 'resolution', state: 'resolved', note: 'Apologized, new schedule', by_whom: 'Krystal' }, 'kry')
ck('grievance resolve with no answer: refused, nothing changed', g.j.error && /written answer/.test(g.j.error) && DB.client_issue[0].state === 'open', g.j)
g = await IR({ issue_id: 'g1', action_type: 'resolution', state: 'resolved', note: 'x', in_person_reason: 'short', by_whom: 'Krystal' }, 'kry')
ck('an in-person reason under ten characters: refused', !!g.j.error && DB.client_issue[0].state === 'open')
g = await IR({ issue_id: 'g1', action_type: 'resolution', state: 'resolved', note: 'x', resolution_doc: 'grievance/g1/1-answer.pdf', by_whom: 'Krystal' }, 'kry')
ck('a written answer that never finished uploading: refused', /did not finish uploading/.test(g.j.error || ''), g.j)
g = await IR({ issue_id: 'g1', action_type: 'resolution', state: 'resolved', note: 'x', resolution_doc: 'grievance/g9/1-answer.pdf', by_whom: 'Krystal' }, 'kry')
ck('another grievance\'s file: refused', /not this grievance/.test(g.j.error || ''))
STORE.uploads.push({ bucket: 'client-journey-files', path: 'grievance/g1/1-answer.pdf', text: '%PDF' })
g = await IR({ issue_id: 'g1', action_type: 'resolution', state: 'resolved', note: 'Apologized, new schedule', resolution_note: 'Apologized, new schedule', resolution_doc: 'grievance/g1/1-answer.pdf', by_whom: 'Krystal' }, 'kry')
ck('with the written answer attached: resolved, the file and "written" kept on the grievance', !g.j.error && DB.client_issue[0].state === 'resolved' && DB.client_issue[0].resolution_doc === 'grievance/g1/1-answer.pdf' && DB.client_issue[0].resolution_how === 'written', { g: g.j, i: DB.client_issue[0] })
DB.client_issue.push({ id: 'g2', category: 'grievance', axiscare_client_id: '290', summary: 'Wants a different caregiver', state: 'open', reported_at: D(-2) + 'T15:00:00Z' })
g = await IR({ issue_id: 'g2', action_type: 'resolution', state: 'resolved', note: 'Changed caregiver', in_person_reason: 'Answered in person at the supervisory visit, family declined a letter', by_whom: 'Krystal' }, 'kry')
ck('answered in person with a reason: resolved, the reason kept', DB.client_issue[1].state === 'resolved' && DB.client_issue[1].resolution_how === 'in_person' && /supervisory visit/.test(DB.client_issue[1].resolution_in_person))
DB.client_issue.push({ id: 'n1', category: 'late_caregiver', axiscare_client_id: '290', summary: 'Late', state: 'open', reported_at: D(-2) + 'T15:00:00Z' })
DB.issue_category.push({ code: 'late_caregiver', follow_up_required: false })
g = await IR({ issue_id: 'n1', action_type: 'resolution', state: 'resolved', note: 'Talked to caregiver', by_whom: 'Krystal' }, 'kry')
ck('a non-grievance issue resolves as before (no answer needed)', DB.client_issue[2].state === 'resolved')
/* ═══ the client audit export ═══ */
DB.client_journey.push({ journey_id: 'cj1', subject: 'client', lead_id: 'L290', axiscare_client_id: '290', client_name: 'Ann Able', payer: 'medicaid', status: 'open', created_at: D(-12) + 'T15:00:00Z' })
DB.client_journey_step.push({ journey_id: 'cj1', step_key: 'docs.rights', state: 'complete', completed_at: D(-11) + 'T15:00:00Z', completed_by: 'kry@mo-care.com', completed_by_name: 'Krystal', evidence: { files: ['cj1/docs.rights/1-rights.pdf'], note: 'signed in person' } })
DB.client_journey_event.push({ journey_id: 'cj1', step_key: 'docs.rights', actor_email: 'kry@mo-care.com', actor_name: 'Krystal', kind: 'completed', at: D(-11) + 'T15:00:00Z', detail: {} }, { journey_id: 'cj1', step_key: 'docs.agreement', actor_email: 'kry@mo-care.com', actor_name: 'Krystal', kind: 'completed', at: D(-1) + 'T15:00:00Z', detail: {} })
DB.client_journey_step_def.push({ key: 'docs.rights', def: { title: 'Client rights signed and on file' }, active: true }, { key: 'docs.agreement', def: { title: 'Service agreement signed and on file' }, active: true })
DB.client_journey.push({ journey_id: 'cgX', subject: 'caregiver', axiscare_client_id: null, offer_id: 'o1', client_name: 'NOT A CLIENT', status: 'open', created_at: D(-3) })
r = await call({ action: 'export', axiscare_client_id: '290' }, 'cc')
ck('export by Casey (not an owner, not on the list): refused, nothing logged', r.status === 403 && !DB.document_access_log.some((l) => l.doc === 'client-export'))
const nlog = DB.document_access_log.length
r = await call({ action: 'export', axiscare_client_id: '290', reason: 'DSDS monitoring visit' }, 'sam')
const up = STORE.uploads.find((u) => u.bucket === 'onboarding-documents' && /^exports\/client:290\//.test(u.path))
ck('export by Samantha: a PDF stored privately (never overwritten), a five-minute link, the proofs (the journey file, the care plan PDF, the grievance answer, the inquiry document) each with a link', r.status === 200 && up && up.text.startsWith('%PDF') && up.opts.upsert === false && r.j.expires_in === 300 && ['Client rights signed and on file', 'Care plan PDF', 'Grievance written answer', 'Inquiry document'].every((x) => r.j.proofs.some((p) => p.label.startsWith(x) && p.url)), { r: r.j, up: up && up.path })
ck('the PDF: the journey row with who and the file, the plan with who checked it against Fusion, authorized against delivered, both grievances with how they were answered, the reason; never the caregiver card', /Client rights signed and on file/.test(up.text) && /Krystal on/.test(up.text) && /units match/.test(up.text) && /0 of 120 authorized units delivered/.test(up.text) && /written answer kept/.test(up.text) && /answered in person/.test(up.text) && /DSDS monitoring visit/.test(up.text) && !/NOT A CLIENT/.test(up.text))
ck('logged: one export row and one row per signed proof, all under client:290 with the reason', DB.document_access_log.length - nlog === 1 + r.j.proofs.filter((p) => p.url).length && DB.document_access_log.slice(nlog).every((l) => l.offer_id === 'client:290' && l.reason === 'DSDS monitoring visit' && l.by_email === 'sam@mo-care.com'))
r = await call({ action: 'export', axiscare_client_id: '290', as_of: D(-3), reason: 'as of check' }, 'sam')
const up2 = STORE.uploads.filter((u) => u.bucket === 'onboarding-documents' && /^exports\/client:290\//.test(u.path)).pop()
ck('as of three days ago: the rights row as last recorded then, the agreement (completed yesterday) absent, the later grievance not there, the earlier one OPEN then; the log says the date', r.status === 200 && r.j.as_of === D(-3) && /as of the end of/.test(up2.text) && /last recorded: completed/.test(up2.text) && !/Service agreement signed/.test(up2.text) && !/Wants a different caregiver/.test(up2.text) && /Open as of/.test(up2.text) && DB.document_access_log.some((l) => l.doc === 'client-export' && /\(as of /.test(l.reason)), up2 && up2.text.slice(0, 200))
r = await call({ action: 'export' }, 'sam')
ck('export with no client: refused', r.status === 400)
/* ═══ the caregiver export as of a date ═══ */
DB.client_journey.push({ journey_id: 'cgY', subject: 'caregiver', offer_id: 'o2', client_name: 'Eve Ennis', status: 'open', created_at: D(-20) + 'T15:00:00Z' })
DB.client_journey_event.push({ journey_id: 'cgY', step_key: 'cg.check.oig', actor_email: 'hub', actor_name: 'The Hub', kind: 'verified', at: D(-10) + 'T15:00:00Z', detail: {} }, { journey_id: 'cgY', step_key: 'cg.check.edl', actor_email: 'hub', actor_name: 'The Hub', kind: 'verified', at: D(-1) + 'T15:00:00Z', detail: {} })
const cgx = callOf(CGX, 'caregiver-export')
r = await cgx({ action: 'export', journey_id: 'cgY', as_of: D(-5), reason: 'as of' }, 'sam')
const up3 = STORE.uploads.filter((u) => u.bucket === 'onboarding-documents' && /^exports\/o2\//.test(u.path)).pop()
ck('caregiver export as of five days ago: the OIG row shows its event, the EDL row (verified yesterday) shows nothing recorded by then, the history stops there', r.status === 200 && r.j.as_of === D(-5) && /Requirements as of/.test(up3.text) && /nothing recorded by then/.test(up3.text) && /up to/.test(up3.text), { r: r.j, t: up3 && up3.text.slice(0, 120) })
/* ═══ SLICE 9: the value history in both exports, the true as-of roster values, and the care change columns ═══ */
DB.evidence_history = []
const cgList = () => { let row = DB.app_data.find((x) => x.key === 'caregivers'); if (!row) { row = { key: 'caregivers', data: [] }; DB.app_data.push(row) } return row.data }
cgList().push({ id: 'cg9', offer_id: 'o2', first: 'Eve', last: 'Ennis', oig: 'clear', oig_date: D(-1), oig_proof: 'bgcheck/cg9/oig-new.json' })
DB.evidence_history.push({ id: 1, at: D(-1) + 'T15:00:00Z', source: 'app_data:caregivers', record_id: 'cg9', change: 'changed', field: 'oig_date', old_value: D(-31), new_value: D(-1), actor: 'krystal@mo-care.com' },
  { id: 2, at: D(-1) + 'T15:00:00Z', source: 'app_data:caregivers', record_id: 'cg9', change: 'changed', field: 'oig_proof', old_value: 'bgcheck/cg9/oig-old.json', new_value: 'bgcheck/cg9/oig-new.json', actor: 'krystal@mo-care.com' },
  { id: 3, at: D(-1) + 'T15:00:00Z', source: 'app_data:caregivers', record_id: 'cg9', change: 'trigger_error', error: 'x' })
r = await cgx({ action: 'export', journey_id: 'cgY', as_of: D(-5), reason: 'as of 9' }, 'sam')
const up9 = STORE.uploads.filter((u) => u.bucket === 'onboarding-documents' && /^exports\/o2\//.test(u.path)).pop()
ck('slice 9 · caregiver export as of a past date: the roster shows the OIG date and proof the record held then (from the value history), and no later change is listed', r.status === 200 && up9.text.includes('date ' + D(-31)) && up9.text.includes('oig-old.json') && !up9.text.includes('date ' + D(-1)) && up9.text.includes('after\\) up to ' + D(-5)) && /No evidence value has changed since then/.test(up9.text), up9.text.slice(-1500))
r = await cgx({ action: 'export', journey_id: 'cgY', reason: 'now 9' }, 'sam')
const up10 = STORE.uploads.filter((u) => u.bucket === 'onboarding-documents' && /^exports\/o2\//.test(u.path)).pop()
ck('slice 9 · caregiver export today: the current values, and the change listed with before, after and who (the watcher failure line is not)', r.status === 200 && up10.text.includes('date ' + D(-1)) && up10.text.includes('oig_date: from ' + D(-31) + ' to ' + D(-1)) && /krystal@mo-care\.com/.test(up10.text) && !/trigger_error/.test(up10.text), up10.text.slice(-1500))
DB.client_care_change.push({ change_id: 'chg9', axiscare_client_id: '290', kind: 'pause', reason: 'hospital', made_at: D(-2) + 'T15:00:00Z', made_by: 'angie@mo-care.com', made_by_name: 'Angie', effective_date: D(-2), checklist: [{ key: 'dsds', label: 'Tell DSDS', state: 'done', on: D(-1), by: 'angie@mo-care.com' }] })
DB.client_pause.push({ pause_id: 'pz9', axiscare_client_id: '290', paused_from: D(-2), followup_date: D(5), reason: 'hospital', status: 'open' })
DB.evidence_history.push({ id: 4, at: D(-1) + 'T16:00:00Z', source: 'client_care_change', record_id: 'chg9', change: 'changed', field: 'checklist', old_value: [{ key: 'dsds', state: 'open' }], new_value: [{ key: 'dsds', state: 'done' }], actor: 'angie@mo-care.com' })
r = await call({ action: 'export', axiscare_client_id: '290', reason: 'slice 9' }, 'sam')
const up11 = STORE.uploads.filter((u) => u.bucket === 'onboarding-documents' && /^exports\/client:290\//.test(u.path)).pop()
ck('slice 9 · client export: the care change shows when and by whom it was recorded, the pause its dates (Slice 8 read the wrong column names)', r.status === 200 && /pause \\267 recorded .+ by Angie/.test(up11.text) && up11.text.includes('Pause from ' + D(-2).slice(5, 7) + '/' + D(-2).slice(8, 10) + '/' + D(-2).slice(0, 4)), up11.text.slice(-2500))
ck('slice 9 · client export: the checklist change is listed with before and after', /care change \\267 checklist: from .+open.+ to .+done.+ \\267 by/.test(up11.text), up11.text.slice(-1500))
r = await call({ action: 'export', axiscare_client_id: '290', as_of: D(-3), reason: 'slice 9 as of' }, 'sam')
const up12 = STORE.uploads.filter((u) => u.bucket === 'onboarding-documents' && /^exports\/client:290\//.test(u.path)).pop()
ck('slice 9 · client export as of before the change: neither the care change nor its checklist change is there', r.status === 200 && !/Pause from/.test(up12.text) && !/care change \\267 checklist/.test(up12.text), up12.text.slice(-1500))
ck('no identity value in any export', !STORE.uploads.some((u) => /\d{3}-\d{2}-\d{4}/.test(u.text || '')))
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
