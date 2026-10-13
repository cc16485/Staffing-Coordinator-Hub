// SLICE 4 · the step2-handoff function (Viventium Step 2: Record Sent, the caregiver's DONE by link and by text reply, Verify with
// the Admin checklist, undo, the 15-minute pass) and the Orientation Video Call server door, against a fake database, a fake GoHighLevel
// and a settable clock. Nothing real is touched. against a fake database (the real caregiver catalog from the 3a migration file, the real rules file),
// a fake Training Platform, a fake AxisCare, a fake GoHighLevel and a settable clock. Nothing real is touched. node step2_handoff_575_test.mjs
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
    if (m === 'PATCH') return new Response(AX.patch === 200 ? JSON.stringify({ results: { caregiver: { id: Number(id) } } }) : JSON.stringify({ errors: ['Status not found'] }), { status: AX.patch })
    return new Response(JSON.stringify({ results: { caregiver: { id: Number(id), status: { active: AX.active, label: AX.label }, hireDate: AX.hireDate } } }), { status: 200 }) }
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
const TMP = path.join(ROOT, '.s2_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(FN, TMP, { recursive: true })
for (const p of fs.readdirSync(TMP, { recursive: true })) { const f = path.join(TMP, String(p)); if (!f.endsWith('.ts')) continue; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient').replace(/^import .* from 'https:[^']*'$/mg, '')) }
let CJ, S2, LINKS, WC, S2H; try { await import(path.join(TMP, 'welcome-call', 'index.ts')); WC = handler; await import(path.join(TMP, 'step2-handoff', 'index.ts')); S2H = handler; CJ = await import(path.join(TMP, '_shared', 'caregiver-journey.ts')); S2 = await import(path.join(TMP, '_shared', 'step2.ts')); LINKS = await import(path.join(TMP, '_shared', 'applicant-links.ts')) } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const call = async (body, tok, qs = '') => { const r = await S2H(new Request('http://x/step2-handoff' + qs, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? (tok === 'cron' ? { 'x-cron-secret': env.HUB_JOB_SECRET } : { Authorization: 'Bearer ' + tok }) : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) })); let j = null; try { j = await r.json() } catch {} return { status: r.status, j } }
const db = globalThis.__fakeCreateClient()
const OID = '11111111-2222-4333-8444-555555555555', OID2 = '22222222-2222-4333-8444-555555555555', OID4 = '44444444-2222-4333-8444-555555555555'
reset()
for (const [id, f, l] of [[OID, 'Ava', 'Lee'], [OID2, 'Ben', 'Ray'], [OID4, 'Cy', 'Lo']]) OFFERS[id] = { id, first_name: f, last_name: l, offer_signed_at: '2026-10-09T20:00:00Z', pd_signed_at: '2026-10-09T20:05:00Z', offer_version: 1, pd_version: 1, offer_status: 'accepted', onboarding_path: 'new' }
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
/* ═══ pure rules ═══ */
ck('isDoneReply: DONE, done, finished, "I finished"; not "done with this" questions or other words', S2.isDoneReply('DONE') && S2.isDoneReply(' done ') && S2.isDoneReply('Finished!') && S2.isDoneReply('I finished step 2') && !S2.isDoneReply('what is viventium') && !S2.isDoneReply('not done yet'))
ck('rowFor maps her checklist to the card rows; the offer letter line and Section 2 map to nothing', S2.rowFor('I-9 Section 1') === 'cg.step2.i9_s1' && S2.rowFor('I-9 Section 2') === null && S2.rowFor('Federal W-4') === 'cg.step2.w4' && S2.rowFor('Missouri W-4') === 'cg.step2.mo_w4' && S2.rowFor('Direct deposit') === 'cg.step2.direct_deposit' && S2.rowFor('Employee handbook acknowledged') === 'cg.step2.handbook' && S2.rowFor('Participant rights acknowledged') === 'cg.step2.participant_rights' && S2.rowFor('Code of ethics acknowledged') === 'cg.step2.code_of_ethics' && S2.rowFor('Confidentiality and HIPAA acknowledged') === 'cg.step2.confidentiality' && S2.rowFor('Driver license or ID uploaded') === 'cg.step2.license_upload' && S2.rowFor('Social Security card uploaded') === 'cg.step2.ss_card_upload' && S2.rowFor('Offer letter signed in Viventium') === null)
ck('the four messages carry her words, the STOP line, no em dash, never "verified"', /great news from Caring Companions/.test(S2.sentMessages('Ava', 'L').text) && /Reply STOP/.test(S2.sentMessages('Ava', 'L').text) && /reminder from Caring Companions/.test(S2.reminderMessages('Ava', 'L').text) && /usually within one business day/.test(S2.receiptText('Ava')) && !/verified/i.test(S2.receiptText('Ava')) && /still shows a task open on your Step 2: W-4/.test(S2.stillOpenText('Ava', 'W-4', 'L')) && ![S2.sentMessages('Ava', 'L').text, S2.reminderMessages('Ava', 'L').text, S2.receiptText('Ava'), S2.stillOpenText('Ava', 'x', 'L')].some((t) => /—/.test(t)))
/* ═══ Record Sent ═══ */
let r = await call({ action: 'sent', candidate_id: '901' })
ck('sent without a sign-in: refused', r.status === 401)
r = await call({ action: 'sent', candidate_id: '901' }, 'cc')
ck('new path, Approve to Advance not complete: refused with the gate words', r.status === 409 && /Not yet/.test(r.j.error) && r.j.gate === 'cg.approve.advance', r)
advance(OID); advance(OID2); 
r = await call({ action: 'sent', candidate_id: '901', note: 'ava@x.com in Viventium' }, 'cc')
ck('Record Sent (switch off): stamped with who, when and the note; the Step 2 message recorded as practice with her words and a step2.html link; nothing sent; a step2_sent event', r.status === 200 && cand(901).step2_sent_at && cand(901).step2_sent_by === 'casey@mo-care.com' && cand(901).step2_sent_note === 'ava@x.com in Viventium' && cand(901).step2_msg.state === 'practice' && /great news/.test(cand(901).step2_msg.text) && /cc\.mo-care\.com\/step2\.html\?c=901&e=\d+&t=/.test(cand(901).step2_msg.text) && GHL.messages.length === 0 && evs(OID, 'step2_sent').length === 1 && r.j.new_path === true, { r: r.j, c: cand(901) })
r = await call({ action: 'sent', candidate_id: '901' }, 'cc')
ck('pressing Record Sent twice: refused, points to Resend', r.status === 409 && /Resend/.test(r.j.error), r)
r = await call({ action: 'sent', candidate_id: '901', resend: true }, 'kry')
ck('Resend: its own stamp and event', r.status === 200 && cand(901).step2_resent_at && cand(901).step2_resent_by === 'krystal@mo-care.com' && evs(OID, 'step2_resent').length === 1)
r = await call({ action: 'sent', candidate_id: '902' }, 'cc')
ck('old path (no card): Record Sent works, no message from the Hub, no journey', r.status === 200 && cand(902).step2_sent_at && !cand(902).step2_msg && r.j.new_path === false && r.j.message.state === 'none', r.j)
r = await call({ action: 'preview' }, 'cc')
ck('preview: the words, the Admin checklist (version 2, 11 items) and the three switches', r.status === 200 && r.j.checklist.version === 2 && r.j.checklist.items.length === 11 && r.j.switches.send === false && /great news/.test(r.j.sent.text))
/* ═══ the caregiver's DONE by link ═══ */
r = await call({ action: 'done', c: '901', e: '9999999999', t: 'x'.repeat(43) })
ck('a forged link: refused with the office number', r.status === 401 && /234-8494/.test(r.j.error))
const link = await LINKS.makeStep2Link(env.HUB_JOB_SECRET, '901'); const q = new URL(link).searchParams
r = await call({ action: 'done', c: q.get('c'), e: q.get('e'), t: q.get('t') })
ck('the real link: reported (how link), the receipt recorded as practice, a step2_reported event; the page learns first name and practice', r.status === 200 && r.j.state === 'reported' && r.j.first === 'Ava' && r.j.practice === true && cand(901).step2_done_at && cand(901).step2_done_how === 'link' && cand(901).step2_receipt.state === 'practice' && /usually within one business day/.test(cand(901).step2_receipt.words) && evs(OID, 'step2_reported').length === 1 && GHL.messages.length === 0, { r: r.j, c: cand(901) })
r = await call({ action: 'done', c: q.get('c'), e: q.get('e'), t: q.get('t') })
ck('tapping again: still reported, nothing changes', r.status === 200 && r.j.state === 'reported' && evs(OID, 'step2_reported').length === 1)
const link4 = await LINKS.makeStep2Link(env.HUB_JOB_SECRET, '904'); const q4 = new URL(link4).searchParams
r = await call({ action: 'done', c: q4.get('c'), e: q4.get('e'), t: q4.get('t') })
ck('a DONE before Sent was recorded (Cy): noted, a card for the Staffing Coordinator, no stamp', r.status === 200 && r.j.state === 'noted' && !cand(904).step2_done_at && ops().some((i) => i.id === 'step2_early_904' && i.owner === 'krystal@mo-care.com' && /nobody recorded sending it/.test(i.title)), ops().map((i) => i.id))
/* ═══ the caregiver's DONE by text reply (GoHighLevel webhook) ═══ */
r = await call({ phone: '4175550101', name: 'Ben Ray', message: 'DONE' }, null, '?token=wrong')
ck('webhook with a wrong token: refused', r.status === 401)
r = await call({ action: 'sent', candidate_id: '903' }, 'cc')
r = await call({ phone: '4175550101', name: 'Ben Ray', message: 'done' }, null, '?token=' + env.STEP2_REPLY_TOKEN)
ck('a "done" reply from a phone shared by Ben (at Sent) and Dee (not at Sent): exactly one person at Sent, so Ben is reported (how reply)', r.status === 200 && r.j.routed === 'reported' && cand(903).step2_done_at && cand(903).step2_done_how === 'reply' && !cand(905).step2_done_at, { r: r.j, ben: cand(903) })
r = await call({ phone: '4175550777', name: 'Who Dis', message: 'DONE' }, null, '?token=' + env.STEP2_REPLY_TOKEN)
ck('a DONE from a number not on file: nothing changes, a review card', r.j.routed === 'review card' && r.j.matched === 0 && ops().some((i) => i.id === 'step2_reply_4175550777' && i.kind === 'step2_reply_review'))
r = await call({ phone: '4175550101', name: 'Ben Ray', message: 'What is Viventium?' }, null, '?token=' + env.STEP2_REPLY_TOKEN)
ck('a non-DONE reply: a review card with their exact words, nothing recorded', r.j.routed === 'review card' && ops().some((i) => i.kind === 'step2_reply' && /What is Viventium\?/.test(i.detail)))
r = await call('{"id":"c1","phone":"4175550199","name":"Olga Old","message":"Done, "thanks" }', null, '?token=' + env.STEP2_REPLY_TOKEN)
ck('broken JSON from GoHighLevel merge fields is still read; Olga (old path, at Sent) is reported by reply', r.status === 200 && r.j.routed === 'reported' && cand(902).step2_done_how === 'reply', r.j)
/* ═══ the 15-minute pass: reminders and cards ═══ */
cand(904).step2_sent_at = null
r = await call({ action: 'pass' })
ck('pass without the job secret: refused', r.status === 401)
advance(OID4); step(OID4, 'cg.approve.advance').completed_at = '2026-10-08T15:00:00Z'   // a Thursday
r = await call({ action: 'pass' }, 'cron')
ck('pass: Cy approved to advance Thursday, Sent not recorded by Friday 5pm Central: the card, owned by the Staffing Coordinator, due then', r.status === 200 && ops().some((i) => i.id === 'step2_notsent_904' && i.owner === 'krystal@mo-care.com' && /Viventium Step 2 not sent to Cy Lo/.test(i.title) && /^2026-10-09T22:00/.test(i.due)), ops().filter((i) => /904/.test(i.id)))
ck('pass: Ava reported DONE just now: not yet due for verification, no card', !ops().some((i) => i.id === 'step2_verify_901'))
cand(901).step2_done_at = '2026-10-08T15:00:00Z'
r = await call({ action: 'pass' }, 'cron')
ck('pass: a DONE from Thursday not verified by Friday 5pm: "Verify Step 2 for Ava Lee"', ops().some((i) => i.id === 'step2_verify_901' && /Verify Step 2 for Ava Lee/.test(i.title) && i.due === '2026-10-09T22:00:00.000Z'), ops().find((i) => i.id === 'step2_verify_901'))
/* Ben: reported; move him back to Sent (undo reported) to test reminders */
r = await call({ action: 'undo', candidate_id: '903', which: 'reported', reason: 'test: he was not done' }, 'cc')
ck('undo reported with a reason: the stamp clears, the history keeps it, an event', r.status === 200 && !cand(903).step2_done_at && cand(903).step2_history.some((h) => h.what === 'undo_reported' && h.reason === 'test: he was not done') && evs(OID2, 'step2_undo').length === 1, r)
cand(903).step2_sent_at = '2026-10-09T15:00:00Z'   // sent 3 days before "today" 2026-10-12
r = await call({ action: 'pass' }, 'cron')
ck('pass, reminders switch off: day 3 recorded as practice, nothing sent, an event', r.j.reminders_practice === 1 && cand(903).step2_reminders.d3.practice === true && GHL.messages.length === 0 && evs(OID2, 'step2_reminder').length === 1, { r: r.j, rem: cand(903).step2_reminders })
r = await call({ action: 'pass' }, 'cron')
ck('pass again the same day: no second day-3 reminder', r.j.reminders_practice === 0 && r.j.reminders_sent === 0)
DB.app_data.find((x) => x.key === 'ops_settings').data.step2_reminders_live = true
cand(903).step2_sent_at = '2026-10-06T15:00:00Z'   // 6 days ago
r = await call({ action: 'pass' }, 'cron')
ck('pass, reminders live, day 6: one text with her reminder words and the DONE link, one email; recorded', r.j.reminders_sent === 1 && GHL.messages.filter((m) => m.type === 'SMS').length === 1 && /reminder from Caring Companions/.test(GHL.messages.find((m) => m.type === 'SMS').message) && /step2\.html\?c=903/.test(GHL.messages.find((m) => m.type === 'SMS').message) && GHL.messages.some((m) => m.type === 'Email' && /Step 2 tasks in Viventium/.test(m.subject)) && cand(903).step2_reminders.d6.texted === true, { r: r.j, msgs: GHL.messages.map((m) => m.type) })
cand(903).step2_sent_at = '2026-10-03T15:00:00Z'   // 9 days ago
r = await call({ action: 'pass' }, 'cron')
ck('pass, day 9 without DONE: "Step 2 not finished: call Ben Ray"', ops().some((i) => i.id === 'step2_stalled_903' && /call Ben Ray/.test(i.title)))
/* ═══ Verify ═══ */
r = await call({ action: 'verify', candidate_id: '904', ticked: ['Federal W-4'] }, 'cc')
ck('verify before Sent: refused', r.status === 409 && /Sent first/.test(r.j.error))
r = await call({ action: 'verify', candidate_id: '901', ticked: [] }, 'cc')
ck('verify with nothing ticked: refused', r.status === 400)
r = await call({ action: 'verify', candidate_id: '901', ticked: CHECKLIST.filter((x) => x !== 'Offer letter signed in Viventium'), i9_section2: true, note: 'Active in Viventium' }, 'cc')
ck('Verify (invite switch off): stamped by Casey with the ticked list (version 2) and the note; ten card rows + I-9 Section 2 confirmed in his name; invite recorded as practice; the verify card closes', r.status === 200 && cand(901).step2_verified_by === 'casey@mo-care.com' && cand(901).step2_checklist.version === 2 && cand(901).step2_checklist.items.filter((x) => x.ticked).length === 10 && cand(901).step2_note === 'Active in Viventium' && cand(901).step2_i9_s2_by === 'casey@mo-care.com' && r.j.confirmed.length === 11 && step(OID, 'cg.step2.w4').state === 'complete' && step(OID, 'cg.step2.w4').completed_by === 'casey@mo-care.com' && step(OID, 'cg.step2.w4').evidence.confirmed.via === 'step2 verify' && step(OID, 'cg.i9.section2').state === 'complete' && r.j.invite.state === 'practice' && cand(901).step2_invite.state === 'practice' && ops().find((i) => i.id === 'step2_verify_901').status === 'done' && evs(OID, 'step2_verified').length === 1, { r: r.j, c: cand(901) })
r = await call({ action: 'verify', candidate_id: '901', ticked: ['Federal W-4'] }, 'cc')
ck('verify twice: refused', r.status === 409 && /Already verified/.test(r.j.error))
r = await call({ action: 'reported', candidate_id: '901' }, 'cc')
ck('reported after verified: nothing changes', r.status === 200 && r.j.state === 'verified')
/* undo verified → rows go back to open with the reason */
r = await call({ action: 'undo', candidate_id: '901', which: 'verified', reason: 'ticked the wrong person' }, 'kry')
ck('undo verified: the stamp clears, the rows confirmed by this verify go back to open with an unconfirmed event and the reason; nothing deleted', r.status === 200 && !cand(901).step2_verified_at && step(OID, 'cg.step2.w4').state === 'open' && step(OID, 'cg.step2.w4').evidence.unconfirmed.reason === 'ticked the wrong person' && DB.client_journey_event.filter((e) => e.kind === 'unconfirmed').length === 11 && cand(901).step2_done_at, { c: cand(901), w4: step(OID, 'cg.step2.w4') })
r = await call({ action: 'undo', candidate_id: '901', which: 'sent', reason: 'wrong person entirely' }, 'kry')
ck('undo sent while a DONE stands: refused (later steps first)', r.status === 409)
/* ═══ Verify with the automatic invitation (option A) ═══ */
DB.app_data.find((x) => x.key === 'ops_settings').data.wc_auto_invite_live = true
GHL.messages.length = 0
r = await call({ action: 'verify', candidate_id: '903', ticked: ['I-9 Section 1', 'Federal W-4'] }, 'kry')
ck('Verify with the invitation switch on: Orientation Video Call is called through its server door; a welcome_calls row invited by "The Hub (Step 2 verified by Krystal)"; the invitation text and email go in today\'s words; recorded on the record and the card', r.status === 200 && r.j.invite.state === 'sent' && r.j.invite.texted === true && DB.welcome_calls.length === 1 && DB.welcome_calls[0].candidate_id === '903' && /The Hub \(Step 2 verified by Krystal\)/.test(DB.welcome_calls[0].invited_by) && GHL.messages.some((m) => m.type === 'SMS' && /welcome/i.test(m.message)) && cand(903).step2_invite.state === 'sent' && evs(OID2, 'welcome_invite_sent').length === 1, { r: r.j, wc: DB.welcome_calls, msgs: GHL.messages.map((m) => m.type) })
ck('the stalled card for Ben closed at verification', ops().find((i) => i.id === 'step2_stalled_903').status === 'done')
r = await WC(new Request('http://x/functions/v1/welcome-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'invite_auto', candidate_id: '903' }) }))
ck('the Orientation Video Call server door refuses a caller without the job secret', r.status === 401)
/* ═══ still open ═══ */
cand(901).step2_verified_at = null
r = await call({ action: 'still_open', candidate_id: '901', task: 'Missouri W-4', preview: true }, 'cc')
ck('still open, preview: her words with the task', r.status === 200 && /still shows a task open on your Step 2: Missouri W-4/.test(r.j.preview), r.j)
GHL.messages.length = 0
r = await call({ action: 'still_open', candidate_id: '901', task: 'Missouri W-4' }, 'cc')
ck('still open, send: one text, stamped with who and the task, an event', r.status === 200 && r.j.texted === true && GHL.messages.length === 1 && cand(901).step2_still_open_task === 'Missouri W-4' && cand(901).step2_still_open_by === 'casey@mo-care.com' && evs(OID, 'step2_still_open').length === 1)
r = await call({ action: 'still_open', candidate_id: '902', task: 'W-4' }, 'cc')
ck('still open for an old-path person: refused (no DONE link); call them', r.status === 409 && /Call Olga/.test(r.j.error), r)
/* ═══ live sends at Record Sent ═══ */
DB.app_data.find((x) => x.key === 'ops_settings').data.step2_send_live = true
GHL.messages.length = 0; GHL.contacts = 0
r = await call({ action: 'sent', candidate_id: '904' }, 'cc')
ck('Record Sent with the switch on: the Step 2 text (with the link) and the email go; the contact upsert carries the step2-sent tag; recorded as sent', r.status === 200 && r.j.message.state === 'sent' && r.j.message.texted && r.j.message.emailed && GHL.messages.filter((m) => m.type === 'SMS').length === 1 && /great news/.test(GHL.messages.find((m) => m.type === 'SMS').message) && GHL.messages.some((m) => m.type === 'Email' && m.subject === 'Step 2: your paperwork in Viventium') && GHL.contacts >= 1, { r: r.j.message, msgs: GHL.messages })
ck('Cy\'s "not sent" and "done before sent" cards closed at Record Sent', ops().find((i) => i.id === 'step2_notsent_904').status === 'done' && ops().find((i) => i.id === 'step2_early_904').status === 'done')
GHL.messages.length = 0
r = await call({ action: 'done', c: q4.get('c'), e: q4.get('e'), t: q4.get('t') })
ck('DONE by link with the switch on: the receipt text goes (never says verified)', r.status === 200 && r.j.practice === false && GHL.messages.length === 1 && /Thank you, Cy!/.test(GHL.messages[0].message) && !/verified/i.test(GHL.messages[0].message) && cand(904).step2_receipt.state === 'sent', GHL.messages)
/* ═══ a moved person: the roster record keeps candidate_id ═══ */
DB.app_data.find((x) => x.key === 'caregivers').data.push({ id: 300, candidate_id: 902, first: 'Olga', last: 'Old', phone: '4175550199', step2_sent_at: cand(902).step2_sent_at, step2_done_at: cand(902).step2_done_at })
DB.app_data.find((x) => x.key === 'candidates').data = DB.app_data.find((x) => x.key === 'candidates').data.filter((c) => c.id !== 902)
r = await call({ action: 'verify', candidate_id: '902', ticked: ['Federal W-4'] }, 'cc')
ck('Olga moved to the roster: the Step 2 record is found by candidate_id and verified there', r.status === 200 && DB.app_data.find((x) => x.key === 'caregivers').data[0].step2_verified_by === 'casey@mo-care.com', r.j)
ck('no identity value appears in any record, event or card', !JSON.stringify([DB.app_data, DB.client_journey_event, DB.client_journey_step]).match(/\d{3}-\d{2}-\d{4}/))
/* ═══ GO-LIVE (2026-10-13): reminders Monday to Saturday 9 to 6, held not dropped; the invitation text held after hours ═══ */
ck('reminderDue: the latest due day wins (a reminder held past day 6 never sends day 3 and day 6 back to back)', S2.reminderDue({ step2_sent_at: '2026-10-05T15:00:00Z' }, [3, 6], '2026-10-12', (iso) => iso.slice(0, 10)) === 6 && S2.reminderDue({ step2_sent_at: '2026-10-08T15:00:00Z' }, [3, 6], '2026-10-12', (iso) => iso.slice(0, 10)) === 3 && S2.reminderDue({ step2_sent_at: '2026-10-05T15:00:00Z', step2_reminders: { d6: {} } }, [3, 6], '2026-10-12', (iso) => iso.slice(0, 10)) === 0)
ck('the reminder window: Monday to Saturday 9am up to 6pm Central', S2.inReminderWindow(new Date('2026-10-12T15:00:00Z')) && !S2.inReminderWindow(new Date('2026-10-11T15:00:00Z')) && !S2.inReminderWindow(new Date('2026-10-12T13:30:00Z')) && !S2.inReminderWindow(new Date('2026-10-12T23:30:00Z')) && S2.inReminderWindow(new Date('2026-10-17T22:30:00Z')))
const OID6 = '66666666-2222-4333-8444-555555555555'
OFFERS[OID6] = { id: OID6, first_name: 'Eve', last_name: 'Fox', offer_signed_at: '2026-10-01T20:00:00Z', pd_signed_at: '2026-10-01T20:05:00Z', offer_status: 'accepted', onboarding_path: 'new' }
DB.app_data.find((x) => x.key === 'candidates').data.push({ id: 906, first: 'Eve', last: 'Fox', offer_id: OID6, phone: '4175550106', email: 'eve@x.com', step2_sent_at: '2026-10-08T15:00:00Z', step2_sent_by: 'casey@mo-care.com' })
await CJ.startCaregiverJourney(db, { id: OID6, first_name: 'Eve', last_name: 'Fox' }, 'offer-sign'); advance(OID6)
const S = DB.app_data.find((x) => x.key === 'ops_settings').data; S.step2_reminders_live = true
at('2026-10-11T15:00:00Z')   // Sunday 10am Chicago, day 3
GHL.messages.length = 0
r = await call({ action: 'pass' }, 'cron')
ck('GO-LIVE: day 3 falls on a Sunday: HELD, nothing sent, nothing recorded (not lost)', r.j.reminders_held >= 1 && !(cand(906).step2_reminders && cand(906).step2_reminders.d3) && GHL.messages.length === 0, { r: r.j, rem: cand(906).step2_reminders })
at('2026-10-12T23:30:00Z')   // Monday 6:30pm Chicago
r = await call({ action: 'pass' }, 'cron')
ck('GO-LIVE: Monday after 6pm: still held', !(cand(906).step2_reminders && cand(906).step2_reminders.d3) && GHL.messages.length === 0)
at('2026-10-12T15:00:00Z'); GHL.fail = true   // Monday 10am, GoHighLevel refusing
r = await call({ action: 'pass' }, 'cron')
ck('GO-LIVE: inside the window but GoHighLevel refuses both: NOT recorded as done; a try is counted for the next pass', r.j.reminders_retry === 1 && !cand(906).step2_reminders.d3 && cand(906).step2_reminders.d3_tries.n === 1, cand(906).step2_reminders)
GHL.fail = false
r = await call({ action: 'pass' }, 'cron')
ck('GO-LIVE: the next pass sends it: recorded as texted and emailed, one event', r.j.reminders_sent === 1 && cand(906).step2_reminders.d3.texted === true && cand(906).step2_reminders.d3.emailed === true && GHL.messages.filter((m) => m.type === 'SMS').length === 1 && evs(OID6, 'step2_reminder').length === 1, { r: r.j, rem: cand(906).step2_reminders })
/* refused for good: said no to texts on their application and no email on file */
cand(906).email = ''; cand(906).step2_sent_at = '2026-10-06T15:00:00Z'
DB.job_applicants.push({ phone: '4175550106', sms_consent: false, created_at: '2026-10-01T00:00:00Z' })
GHL.messages.length = 0
r = await call({ action: 'pass' }, 'cron')
ck('GO-LIVE: day 6, they said no to texts and no email is on file: recorded as refused (not retried) with a Needs Attention card', cand(906).step2_reminders.d6 && cand(906).step2_reminders.d6.refused === true && GHL.messages.length === 0 && ops().some((i) => i.id === 'step2_reminder_906_d6' && i.status === 'open' && /did not reach Eve Fox/.test(i.title)), { rem: cand(906).step2_reminders, cards: ops().filter((i) => /906/.test(i.id)) })
/* the Orientation Video Call invitation at night: the email goes, the text is HELD and goes at 8am */
cand(906).email = 'eve@x.com'; DB.job_applicants = DB.job_applicants.filter((a) => a.phone !== '4175550106')
S.wc_auto_invite_live = true
at('2026-10-13T02:00:00Z')   // Monday 9pm Chicago
GHL.messages.length = 0
r = await call({ action: 'verify', candidate_id: '906', ticked: ['Federal W-4'] }, 'kry')
ck('GO-LIVE: Verify at 9pm: the invitation email goes, the text is HELD (not failed, no failure card)', r.status === 200 && r.j.invite.state === 'sent' && r.j.invite.text_held === true && r.j.invite.texted === false && GHL.messages.length === 1 && GHL.messages[0].type === 'Email' && cand(906).step2_invite.text_held === true && !ops().some((i) => i.id === 'step2_invite_906'), { r: r.j, msgs: GHL.messages.map((m) => m.type) })
r = await call({ action: 'pass' }, 'cron')
ck('GO-LIVE: a pass at night: the held text still waits', GHL.messages.length === 1 && cand(906).step2_invite.text_held === true)
at('2026-10-13T13:05:00Z')   // Tuesday 8:05am Chicago
r = await call({ action: 'pass' }, 'cron')
ck('GO-LIVE: the first pass after 8am sends the held invitation text (no second email), recorded with an event', r.j.invite_texts_sent === 1 && GHL.messages.length === 2 && GHL.messages[1].type === 'SMS' && /Orientation Video Call/.test(GHL.messages[1].message) && cand(906).step2_invite.texted === true && cand(906).step2_invite.text_held === false && evs(OID6, 'welcome_invite_text_sent').length === 1, { r: r.j, inv: cand(906).step2_invite })
r = await call({ action: 'pass' }, 'cron')
ck('GO-LIVE: the pass again: no second text', GHL.messages.length === 2)
DB.welcome_calls.find((w) => w.candidate_id === '906').status = 'booked'
r = await WC(new Request('http://x/functions/v1/welcome-call', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': env.HUB_JOB_SECRET }, body: JSON.stringify({ action: 'invite_auto', candidate_id: '906', first: 'Eve', phone: '4175550106', email: 'eve@x.com', only: 'text' }) })).then(async (x) => ({ status: x.status, j: await x.json() }))
ck('GO-LIVE: a held text for someone who has since booked is skipped, not sent', r.status === 200 && r.j.skipped && r.j.texted === false && GHL.messages.length === 2, r.j)
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
