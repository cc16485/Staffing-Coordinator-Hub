// 708 LPN HIRING (Samantha approved the LPN nurse visit plan, 2026-10-14): Verify Viventium Step 2 for an LPN or RN has ONE more
// tick, the LPN packet (job description, RN supervision acknowledgment, documentation expectations), which confirms
// cg.step2.position_description. A caregiver never sees it and cannot send it. The real step2-handoff function against the fake
// database of step2_handoff_575_test.mjs. node lpn_step2_708_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', OFFERS_PROJECT_URL: 'http://trn', OFFERS_SERVICE_ROLE_KEY: 'tkey', HUB_JOB_SECRET: 'j'.repeat(48),
  AXISCARE_SITE: '16485', AXISCARE_API_KEY: 'axkey', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'L', OUTREACH_SECRET: 'o'.repeat(40), STEP2_REPLY_TOKEN: 'r'.repeat(32), SUPABASE_ANON_KEY: 'anon' }
/* the clock (texts go 8am to 6pm Central) */
const RealDate = Date; let NOW = RealDate.parse('2026-10-12T15:00:00Z')   // 10am Chicago (CDT)
class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOW) } static now() { return NOW } }
globalThis.Date = FakeDate; const at = (iso) => { NOW = RealDate.parse(iso) }
/* fake AxisCare + GoHighLevel, every call counted */
const AX = { patch: 200, label: 'Active', active: true, hireDate: '2026-10-12', calls: [] }
const GHL = { messages: [], contacts: 0 }
const TRN = { rows: [], calls: [], lists: [] }
const LEIE = { downloads: 0, csv: '"LASTNAME","FIRSTNAME","MIDNAME","BUSNAME","GENERAL","SPECIALTY","UPIN","NPI","DOB","ADDRESS","CITY","STATE","ZIP","EXCLTYPE","EXCLDATE","REINDATE","WAIVERDATE","WVRSTATE"\n"RAY","BEN","T","","NURSE","","","0","19800101","1 MAIN","TULSA","OK","74101","1128b4","20200101","00000000","00000000",""\n"LEE","AVERY","","","","","","0","19900101","","","","","1128a1","20100101","00000000","00000000",""\n' }
const STORE = { uploads: [] }
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
/* the real caregiver catalog, from the migration file */
const sql = fs.readFileSync(path.join(ROOT, 'supabase/slice3a-journey-caregiver-subject.sql'), 'utf8')
const DEFS = [...sql.matchAll(/values \('([^']+)', 1, '(.*)'::jsonb, false/g)].map((m) => ({ key: m[1], catalog_version: 1, def: JSON.parse(m[2].replace(/''/g, "'")), active: true }))
/* fake Training REST */
const OFFERS = {}
globalThis.fetch = async (url, o = {}) => { const u = String(url), m = (o.method || 'GET').toUpperCase()
  if (u.startsWith('http://trn/rest/v1/job_offers')) { const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(u)[1]); return new Response(JSON.stringify(OFFERS[id] ? [OFFERS[id]] : []), { status: 200 }) }
  if (u.startsWith('https://16485.axiscare.com/api/caregivers/')) { const id = u.split('/').pop(); AX.calls.push(m + ' ' + id + (o.body ? ' ' + o.body : ''))
    if (m === 'PATCH') return new Response(AX.patch === 200 ? JSON.stringify({ results: { data: { id: Number(id) } } }) : JSON.stringify({ errors: ['Status not found'] }), { status: AX.patch })
    return new Response(JSON.stringify({ results: { data: { id: Number(id), status: { active: AX.active, label: AX.label }, hireDate: AX.hireDate } } }), { status: 200 }) }
  if (u === 'http://trn/rest/v1/app_settings?key=eq.hub_read_key&select=value') return new Response(JSON.stringify([{ value: { key: 'rk' } }]), { status: 200 })
  if (u === 'http://trn/rest/v1/rpc/hub_training_status') { TRN.calls.push(JSON.parse(o.body)); return new Response(JSON.stringify(TRN.rows), { status: 200 }) }
  if (u === 'http://trn/rest/v1/caregivers?select=id,axiscare_id&active=eq.true') return new Response(JSON.stringify([{ id: 't-ava', axiscare_id: '9001' }, { id: 't-ben', axiscare_id: '9002' }]), { status: 200 })
  if (u === 'http://trn/storage/v1/object/list/waiver-docs') { const p = JSON.parse(o.body).prefix; TRN.lists.push(p); return new Response(JSON.stringify(p === 'certificates/t-ben' ? [{ name: 'agency-orientation.pdf' }] : []), { status: 200 }) }
  if (u.startsWith('http://trn/storage/v1/object/sign/waiver-docs/')) return new Response(JSON.stringify({ signedURL: '/object/sign/waiver-docs/' + u.split('/waiver-docs/')[1] + '?token=t' }), { status: 200 })
  if (u === 'https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv') { LEIE.downloads++; return new Response(LEIE.csv, { status: 200 }) }
  if (u === 'http://x/functions/v1/welcome-call') return await WC(new Request(u, o))
  if (u.startsWith('https://services.leadconnectorhq.com/contacts/search/duplicate')) return new Response(JSON.stringify({ contacts: [] }), { status: 200 })
  if (u === 'https://services.leadconnectorhq.com/contacts/upsert') { GHL.contacts++; return new Response(JSON.stringify({ contact: { id: 'c1', phone: '+14175550100' } }), { status: 200 }) }
  if (u.startsWith('https://services.leadconnectorhq.com/contacts/c1')) return new Response(JSON.stringify({ contact: { id: 'c1', phone: '+14175550100' } }), { status: 200 })
  if (u === 'https://services.leadconnectorhq.com/conversations/messages') { if (GHL.fail) return new Response('{"message":"down"}', { status: 500 }); GHL.messages.push(JSON.parse(o.body)); return new Response('{}', { status: 200 }) }
  throw new Error('unexpected fetch ' + m + ' ' + u) }
/* fake tables */
let DB = {}
const reset = () => { DB = { client_journey_step_def: JSON.parse(JSON.stringify(DEFS)), client_journey: [], client_journey_step: [], client_journey_event: [], app_data: [], step1_forms: [], welcome_calls: [], job_applicants_: [], caregiver_profiles: [], job_applicants: [], contact_optout_current: [], circle_contacts: [], axiscare_change_log: [], document_access_log: [], domains: [], auth_identities: [{ auth_user_id: 'u-sam', person_id: 'p-sam', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-kry', person_id: 'p-kry', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-cc', person_id: 'p-cc', project_ref: 'zngsgedlsxinbygwmxwn' }], persons: [{ person_id: 'p-sam', full_name: 'Samantha', active: true }, { person_id: 'p-kry', full_name: 'Krystal', active: true }, { person_id: 'p-cc', full_name: 'Casey', active: true }], entity_memberships: [{ person_id: 'p-sam', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-kry', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-cc', entity: 'cc_ihs', active: true, ended_at: null }], staff_roles: [{ person_id: 'p-sam', entity: 'cc_ihs', role: 'owner_admin' }, { person_id: 'p-kry', entity: 'cc_ihs', role: 'staffing_coordinator' }, { person_id: 'p-cc', entity: 'cc_ihs', role: 'care_coordinator' }] } }
let seq = 0
function table(name) {
  const rows = () => DB[name]
  const q = (mode, payload, filters = [], opts = {}) => {
    const match = (r) => filters.every((f) => f(r))
    const run = () => {
      if (mode === 'select') { let out = rows().filter(match); if (opts.order) out = [...out].sort((a, b) => String(b[opts.order]).localeCompare(String(a[opts.order]))); if (opts.limit) out = out.slice(0, opts.limit); return JSON.parse(JSON.stringify(out)) }
      if (mode === 'insert' && Array.isArray(payload)) { for (const p of payload) rows().push({ id: ++seq, ...p }); return payload }
      if (mode === 'insert') { const r = { ...payload }; if (name === 'client_journey') { if (rows().some((x) => x.offer_id === r.offer_id)) throw new Error('duplicate offer_id'); r.journey_id = r.journey_id || 'j-' + (++seq); r.created_at = new Date().toISOString() } if (name === 'client_journey_event') { r.id = ++seq; r.at = r.at || new Date().toISOString() } if (name === 'welcome_calls') { r.id = r.id || '00000000-0000-4000-8000-' + String(++seq).padStart(12, '0'); r.status = r.status || 'invited'; r.invited_at = r.invited_at || new Date().toISOString() } rows().push(r); return [r] }
      if (mode === 'upsert') { const i = rows().findIndex((x) => x.journey_id === payload.journey_id && x.step_key === payload.step_key); if (i >= 0) rows()[i] = { ...rows()[i], ...payload }; else rows().push({ ...payload }); return [payload] }
      if (mode === 'update') { const out = []; for (const r of rows()) if (match(r)) { Object.assign(r, payload); out.push(r) } return out }
    }
    const api = {
      eq: (k, v) => q(mode, payload, [...filters, (r) => String(r[k]) === String(v)], opts), neq: (k, v) => q(mode, payload, [...filters, (r) => String(r[k]) !== String(v)], opts),
      in: (k, vs) => q(mode, payload, [...filters, (r) => vs.map(String).includes(String(r[k]))], opts), like: (k, v) => q(mode, payload, [...filters, (r) => new RegExp('^' + String(v).replace(/%/g, '.*') + '$').test(String(r[k]))], opts),
      ilike: (k, v) => q(mode, payload, [...filters, (r) => String(r[k] ?? '').toLowerCase().includes(String(v).replace(/%/g, '').toLowerCase())], opts), not: (k, op, v) => q(mode, payload, [...filters, (r) => op === 'is' ? (r[k] ?? null) !== v : true], opts),
      order: (k) => q(mode, payload, filters, { ...opts, order: k }), limit: (n) => q(mode, payload, filters, { ...opts, limit: n }), select: () => q(mode, payload, filters, opts),
      single: async () => { try { const r = run()[0]; return r ? { data: r, error: null } : { data: null, error: { message: 'no row' } } } catch (e) { return { data: null, error: { message: e.message } } } },
      maybeSingle: async () => { try { return { data: run()[0] ?? null, error: null } } catch (e) { return { data: null, error: { message: e.message } } } },
      then: (ok) => { try { ok({ data: run(), error: null }) } catch (e) { ok({ data: null, error: { message: e.message } }) } },
    }
    return api
  }
  return { select: () => q('select'), insert: (p) => q('insert', p), upsert: (p) => q('upsert', p), update: (p) => q('update', p) }
}
const KINDS = ['client_created','client_linked','client_updated','responsible_party','care_level','care_tasks','care_plan_note','client_note','caregiver_note','schedule','visit_caregiver','call_summary','scheduling_note','caregiver_status','prn_team_classes']
const OWNED = ['eligibility_history', 'eligibility_state', 'eligibility_reason', 'eligibility_at', 'axiscare_note_for', 'approved_to_work_at', 'approved_to_work_by', 'axiscare_status_active', 'axiscare_status_label', 'axiscare_status_at', 'work_lock']
async function rpc(name, a) {
  if (name === 'axiscare_change_record') { if (!KINDS.includes(a.p_kind) || !['sent_confirmed','sent','refused','practice'].includes(a.p_outcome) || !/^\d+$/.test(String(a.p_caregiver ?? ''))) return { data: { outcome: 'refused', reason: 'check' }, error: null }; DB.axiscare_change_log.push({ id: DB.axiscare_change_log.length + 1, at: new Date().toISOString(), kind: a.p_kind, caregiver: a.p_caregiver, outcome: a.p_outcome, summary: a.p_summary, detail: a.p_detail, by: a.p_by, via: a.p_via }); return { data: { outcome: 'recorded', id: DB.axiscare_change_log.length }, error: null } }
  if (name === 'caregiver_audit_patch') { const AUD = ['orient_date', 'orient_proof', 'alz_date', 'alz_hrs', 'alz_proof', 'ojt_online', 'ojt_online_proof', 'annual_date', 'annual_hrs', 'annual_proof', 'hire_date', 'first_contact', 'axiscare_id', 'th_synced', 'oig', 'oig_date', 'oig_proof', 'oig_evidence']; const bad = Object.keys(a.p_patch).filter((k) => !AUD.includes(k)); if (bad.length) return { data: null, error: { message: 'not a field the audit owns: ' + bad.join(', ') } }; const list = DB.app_data.find((x) => x.key === 'caregivers')?.data || []; const r = list.find((x) => String(x.id) === String(a.p_id)); if (!r) return { data: { ok: false, reason: 'gone' }, error: null }; Object.assign(r, a.p_patch); return { data: { ok: true, rev: 1 }, error: null } }
  if (name === 'step2_patch') { const S2 = ['step2_sent_at', 'step2_sent_by', 'step2_sent_note', 'step2_resent_at', 'step2_resent_by', 'step2_msg', 'step2_done_at', 'step2_done_by', 'step2_done_how', 'step2_receipt', 'step2_verified_at', 'step2_verified_by', 'step2_checklist', 'step2_i9_s2_by', 'step2_i9_s2_at', 'step2_note', 'step2_still_open_at', 'step2_still_open_by', 'step2_still_open_task', 'step2_reminders', 'step2_history', 'step2_invite']; const bad = Object.keys(a.p_patch).filter((k) => !S2.includes(k)); if (bad.length) return { data: null, error: { message: 'not a Step 2 field: ' + bad.join(', ') } }; if (!['candidates', 'caregivers'].includes(a.p_key)) return { data: null, error: { message: 'bad key' } }; const list = DB.app_data.find((x) => x.key === a.p_key)?.data || []; const r = list.find((x) => String(x.id) === String(a.p_id)); if (!r) return { data: { ok: false, reason: 'gone' }, error: null }; Object.assign(r, a.p_patch); return { data: { ok: true, rev: 1 }, error: null } }
  if (name === 'caregiver_sweep_patch') { const bad = Object.keys(a.p_patch).filter((k) => !OWNED.includes(k)); if (bad.length) return { data: null, error: { message: 'not a field the sweep owns: ' + bad.join(', ') } }; const list = DB.app_data.find((x) => x.key === 'caregivers')?.data || []; const r = list.find((x) => String(x.id) === String(a.p_id)); if (!r) return { data: { ok: false, reason: 'gone' }, error: null }; Object.assign(r, a.p_patch); return { data: { ok: true, rev: 1 }, error: null } }
  if (name === 'upsert_app_data_item') { let row = DB.app_data.find((x) => x.key === a.target_key); if (!row) { row = { key: a.target_key, data: [] }; DB.app_data.push(row) } const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = a.item; else row.data.push(a.item); return { data: null, error: null } }
  return { data: null, error: { message: 'unknown rpc ' + name } }
}
const storage = { from: (bucket) => ({ upload: async (path, body, opts) => { if (STORE.uploads.some((u) => u.bucket === bucket && u.path === path)) return { error: { message: 'exists' } }; const text = typeof body === 'string' ? body : body instanceof Uint8Array ? Buffer.from(body).toString('latin1') : await body.text(); STORE.uploads.push({ bucket, path, text, opts }); return { data: { path }, error: null } }, createSignedUrl: async (path, s) => ({ data: { signedUrl: 'https://signed/' + bucket + '/' + path + '?s=' + s }, error: null }) }) }
globalThis.__fakeCreateClient = () => ({ from: table, rpc, storage, auth: { getUser: async (jwt) => ({ sam: { data: { user: { id: 'u-sam', email: 'sam@mo-care.com', app_metadata: {} } }, error: null }, kry: { data: { user: { id: 'u-kry', email: 'krystal@mo-care.com', app_metadata: {} } }, error: null }, cc: { data: { user: { id: 'u-cc', email: 'casey@mo-care.com', app_metadata: {} } }, error: null } })[jwt] || { data: null, error: { message: 'bad' } } } })
const TMP = path.join(ROOT, '.lpn_s2_708_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(FN, TMP, { recursive: true })
for (const p of fs.readdirSync(TMP, { recursive: true })) { const f = path.join(TMP, String(p)); if (!f.endsWith('.ts')) continue; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient').replace(/^import .* from 'https:[^']*'$/mg, '')) }
let CJ, S2, LINKS, WC, S2H; try { await import(path.join(TMP, 'welcome-call', 'index.ts')); WC = handler; await import(path.join(TMP, 'step2-handoff', 'index.ts')); S2H = handler; CJ = await import(path.join(TMP, '_shared', 'caregiver-journey.ts')); S2 = await import(path.join(TMP, '_shared', 'step2.ts')); LINKS = await import(path.join(TMP, '_shared', 'applicant-links.ts')) } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const call = async (body, tok, qs = '') => { const r = await S2H(new Request('http://x/step2-handoff' + qs, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? (tok === 'cron' ? { 'x-cron-secret': env.HUB_JOB_SECRET } : { Authorization: 'Bearer ' + tok }) : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) })); let j = null; try { j = await r.json() } catch {} return { status: r.status, j } }
const db = globalThis.__fakeCreateClient()
const OID = '11111111-2222-4333-8444-555555555555', OID2 = '22222222-2222-4333-8444-555555555555', OID4 = '44444444-2222-4333-8444-555555555555'
reset()
for (const [id, f, l] of [[OID, 'Ava', 'Lee'], [OID2, 'Ben', 'Ray'], [OID4, 'Cy', 'Lo']]) OFFERS[id] = { id, first_name: f, last_name: l, offer_signed_at: '2026-10-09T20:00:00Z', pd_signed_at: id === OID2 ? null : '2026-10-09T20:05:00Z', offer_version: 1, pd_version: id === OID2 ? null : 1, offer_status: 'accepted', onboarding_path: 'new', position_key: id === OID2 ? 'lpn' : id === OID4 ? 'caregiver' : undefined }
const CHECKLIST = ['Offer letter signed in Viventium', 'I-9 Section 1', 'Federal W-4', 'Missouri W-4', 'Direct deposit', 'Employee handbook acknowledged', 'Participant rights acknowledged', 'Code of ethics acknowledged', 'Confidentiality and HIPAA acknowledged', 'Driver license or ID uploaded', 'Social Security card uploaded']
DB.app_data = [{ key: 'onboarding_permissions', data: { version: 1, advance: [{ person_id: 'p-kry' }], work: [{ person_id: 'p-sam' }], screening: [], history: [] } },
  { key: 'ops_settings', data: { staffing_email: 'krystal@mo-care.com', onboarding: { step2_days: [3, 6], step2_sent_due_days: 1, verify_due_days: 1, due_hour: 17 }, viventium_step2_checklist: { version: 2, items: CHECKLIST } } },
  { key: 'candidates', data: [
    { id: 901, first: 'Ava', last: 'Lee', offer_id: OID, phone: '4175550100', email: 'ava@x.com' },
    { id: 902, first: 'Olga', last: 'Old', phone: '4175550199', email: 'olga@x.com' },
    { id: 903, first: 'Ben', last: 'Ray', offer_id: OID2, phone: '4175550101', email: 'ben@x.com' },
    { id: 904, first: 'Cy', last: 'Lo', offer_id: OID4, phone: '4175550104', email: 'cy@x.com' },
    { id: 905, first: 'Dee', last: 'Two', offer_id: null, phone: '4175550101' } ] },
  { key: 'caregivers', data: [] }]
for (const [id, f, l] of [[OID, 'Ava', 'Lee'], [OID2, 'Ben', 'Ray'], [OID4, 'Cy', 'Lo']]) await CJ.startCaregiverJourney(db, { id, first_name: f, last_name: l }, 'offer-sign')
const J = (oid) => DB.client_journey.find((j) => j.offer_id === oid)
const cand = (id) => DB.app_data.find((x) => x.key === 'candidates').data.find((c) => c.id === id)
const ops = () => (DB.app_data.find((x) => x.key === 'ops_items') || { data: [] }).data
const evs = (oid, kind) => DB.client_journey_event.filter((e) => e.journey_id === J(oid).journey_id && e.kind === kind)
const step = (oid, k) => DB.client_journey_step.find((s) => s.journey_id === J(oid).journey_id && s.step_key === k)
const advance = (oid) => DB.client_journey_step.push({ journey_id: J(oid).journey_id, step_key: 'cg.approve.advance', state: 'complete', completed_at: new Date().toISOString(), completed_by: 'krystal@mo-care.com', version: 1 })

advance(OID); advance(OID2); advance(OID4)
for (const c of [901, 903, 904]) await call({ action: 'sent', candidate_id: String(c) }, 'cc')
/* ═══ the preview: the packet line only for the LPN ═══ */
let r = await call({ action: 'preview' }, 'cc')
ck('the preview without a person is exactly as before (no packet key at all)', r.status === 200 && !('nurse_packet' in r.j) && r.j.checklist.items.length === 11)
r = await call({ action: 'preview', candidate_id: '901' }, 'cc')
ck('a caregiver from before (no key): no packet line', r.status === 200 && !('nurse_packet' in r.j))
r = await call({ action: 'preview', candidate_id: '904' }, 'cc')
ck('a caregiver (key caregiver): no packet line', r.status === 200 && !('nurse_packet' in r.j))
r = await call({ action: 'preview', candidate_id: '903' }, 'cc')
ck('the LPN: the packet line names the three documents', r.status === 200 && r.j.nurse_packet === 'LPN packet signed in Viventium: LPN job description, RN supervision acknowledgment and the nursing documentation expectations', r.j)
/* ═══ verify ═══ */
r = await call({ action: 'verify', candidate_id: '904', ticked: ['Federal W-4'], nurse_packet: true }, 'cc')
ck('a caregiver cannot send the packet tick: refused, nothing recorded', r.status === 400 && /only for an LPN or RN hire/.test(r.j.error) && !cand(904).step2_verified_at && !step(OID4, 'cg.step2.position_description'), r)
r = await call({ action: 'verify', candidate_id: '901', ticked: ['Federal W-4'] }, 'cc')
ck('a caregiver verifies exactly as before: the checklist as ticked, no packet line in it', r.status === 200 && cand(901).step2_checklist.items.length === 11 && !cand(901).step2_checklist.items.some((x) => x.nurse_packet) && !step(OID, 'cg.step2.position_description') && step(OID, 'cg.step2.w4').state === 'complete', cand(901).step2_checklist)
r = await call({ action: 'verify', candidate_id: '903', ticked: ['Federal W-4'], nurse_packet: true }, 'kry')
ck('the LPN: the packet tick confirms the LPN packet row in Krystal\'s name, with the time; the checklist keeps the line; the event names it', r.status === 200 && step(OID2, 'cg.step2.position_description').state === 'complete' && step(OID2, 'cg.step2.position_description').completed_by === 'krystal@mo-care.com' && cand(903).step2_checklist.items.some((x) => x.nurse_packet && /LPN packet/.test(x.text)) && evs(OID2, 'step2_verified')[0].detail.nurse_packet, r.j)
ck('the packet tick alone is enough to verify for an LPN (like any tick)', r.j.confirmed.includes('cg.step2.position_description') && r.j.confirmed.includes('cg.step2.w4'), r.j.confirmed)
/* when the offer cannot be read, the Step 1 record answers */
const OID5 = '55555555-2222-4333-8444-555555555555'
DB.app_data.find((x) => x.key === 'candidates').data.push({ id: 907, first: 'Rae', last: 'Nurse', offer_id: OID5, phone: '4175550107', email: 'rae@x.com' })
DB.step1_forms = [...(DB.step1_forms || []), { offer_id: OID5, nurse_form: true, answers: { nurse_license_type: 'Registered Nurse (RN)' } }]
r = await call({ action: 'preview', candidate_id: '907' }, 'cc')
ck('offer unreadable: the Step 1 record (nursing license form, RN) gives the RN packet line', r.status === 200 && /^RN packet signed in Viventium: RN job description/.test(r.j.nurse_packet || ''), r.j)
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
