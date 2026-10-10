// SLICE 5 · the caregiver-journey function (3b behaviour kept, Approve to Work + AxisCare read-back + the cleared text + the lock +
// the Training report added) against a fake database (the real caregiver catalog from the 3a migration file, the real rules file),
// a fake Training Platform, a fake AxisCare, a fake GoHighLevel and a settable clock. Nothing real is touched. node caregiver_journey_5_test.mjs
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
const AX = { patch: 200, label: 'Active', active: true, hireDate: '2026-10-12', calls: [] }
const GHL = { messages: [], contacts: 0 }
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
  if (u.startsWith('https://services.leadconnectorhq.com/contacts/search/duplicate')) return new Response(JSON.stringify({ contacts: [] }), { status: 200 })
  if (u === 'https://services.leadconnectorhq.com/contacts/upsert') { GHL.contacts++; return new Response(JSON.stringify({ contact: { id: 'c1', phone: '+14175550100' } }), { status: 200 }) }
  if (u.startsWith('https://services.leadconnectorhq.com/contacts/c1')) return new Response(JSON.stringify({ contact: { id: 'c1', phone: '+14175550100' } }), { status: 200 })
  if (u === 'https://services.leadconnectorhq.com/conversations/messages') { GHL.messages.push(JSON.parse(o.body)); return new Response('{}', { status: 200 }) }
  throw new Error('unexpected fetch ' + m + ' ' + u) }
/* fake tables */
let DB = {}
const reset = () => { DB = { client_journey_step_def: JSON.parse(JSON.stringify(DEFS)), client_journey: [], client_journey_step: [], client_journey_event: [], app_data: [], step1_forms: [], welcome_calls: [], caregiver_profiles: [], job_applicants: [], contact_optout_current: [], circle_contacts: [], axiscare_change_log: [], auth_identities: [{ auth_user_id: 'u-sam', person_id: 'p-sam', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-kry', person_id: 'p-kry', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-cc', person_id: 'p-cc', project_ref: 'zngsgedlsxinbygwmxwn' }], persons: [{ person_id: 'p-sam', full_name: 'Samantha', active: true }, { person_id: 'p-kry', full_name: 'Krystal', active: true }, { person_id: 'p-cc', full_name: 'Casey', active: true }], entity_memberships: [{ person_id: 'p-sam', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-kry', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-cc', entity: 'cc_ihs', active: true, ended_at: null }], staff_roles: [{ person_id: 'p-sam', entity: 'cc_ihs', role: 'owner_admin' }, { person_id: 'p-kry', entity: 'cc_ihs', role: 'staffing_coordinator' }, { person_id: 'p-cc', entity: 'cc_ihs', role: 'care_coordinator' }] } }
let seq = 0
function table(name) {
  const rows = () => DB[name]
  const q = (mode, payload, filters = [], opts = {}) => {
    const match = (r) => filters.every((f) => f(r))
    const run = () => {
      if (mode === 'select') { let out = rows().filter(match); if (opts.order) out = [...out].sort((a, b) => String(b[opts.order]).localeCompare(String(a[opts.order]))); if (opts.limit) out = out.slice(0, opts.limit); return JSON.parse(JSON.stringify(out)) }
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
const KINDS = ['client_created','client_linked','client_updated','responsible_party','care_level','care_tasks','care_plan_note','client_note','caregiver_note','schedule','visit_caregiver','call_summary','scheduling_note','caregiver_status','prn_team_classes']
const OWNED = ['eligibility_history', 'eligibility_state', 'eligibility_reason', 'eligibility_at', 'axiscare_note_for', 'approved_to_work_at', 'approved_to_work_by', 'axiscare_status_active', 'axiscare_status_label', 'axiscare_status_at', 'work_lock']
async function rpc(name, a) {
  if (name === 'axiscare_change_record') { if (!KINDS.includes(a.p_kind) || !['sent_confirmed','sent','refused','practice'].includes(a.p_outcome) || !/^\d+$/.test(String(a.p_caregiver ?? ''))) return { data: { outcome: 'refused', reason: 'check' }, error: null }; DB.axiscare_change_log.push({ id: DB.axiscare_change_log.length + 1, at: new Date().toISOString(), kind: a.p_kind, caregiver: a.p_caregiver, outcome: a.p_outcome, summary: a.p_summary, detail: a.p_detail, by: a.p_by, via: a.p_via }); return { data: { outcome: 'recorded', id: DB.axiscare_change_log.length }, error: null } }
  if (name === 'caregiver_sweep_patch') { const bad = Object.keys(a.p_patch).filter((k) => !OWNED.includes(k)); if (bad.length) return { data: null, error: { message: 'not a field the sweep owns: ' + bad.join(', ') } }; const list = DB.app_data.find((x) => x.key === 'caregivers')?.data || []; const r = list.find((x) => String(x.id) === String(a.p_id)); if (!r) return { data: { ok: false, reason: 'gone' }, error: null }; Object.assign(r, a.p_patch); return { data: { ok: true, rev: 1 }, error: null } }
  if (name === 'upsert_app_data_item') { let row = DB.app_data.find((x) => x.key === a.target_key); if (!row) { row = { key: a.target_key, data: [] }; DB.app_data.push(row) } const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = a.item; else row.data.push(a.item); return { data: null, error: null } }
  return { data: null, error: { message: 'unknown rpc ' + name } }
}
globalThis.__fakeCreateClient = () => ({ from: table, rpc, auth: { getUser: async (jwt) => ({ sam: { data: { user: { id: 'u-sam', email: 'sam@mo-care.com', app_metadata: {} } }, error: null }, kry: { data: { user: { id: 'u-kry', email: 'krystal@mo-care.com', app_metadata: {} } }, error: null }, cc: { data: { user: { id: 'u-cc', email: 'casey@mo-care.com', app_metadata: {} } }, error: null } })[jwt] || { data: null, error: { message: 'bad' } } } })
const TMP = path.join(ROOT, '.cj_5_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(FN, TMP, { recursive: true })
for (const p of fs.readdirSync(TMP, { recursive: true })) { const f = path.join(TMP, String(p)); if (!f.endsWith('.ts')) continue; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient').replace(/^import .* from 'https:[^']*'$/mg, '')) }
let CJ, WL; try { await import(path.join(TMP, 'caregiver-journey', 'index.ts')); CJ = await import(path.join(TMP, '_shared', 'caregiver-journey.ts')); WL = await import(path.join(TMP, '_shared', 'work-lock.ts')) } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
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
/* ═══ get: the catalog applies, permissions per list ═══ */
let r = await call({ action: 'get', offer_id: OID })
ck('get without a sign-in is refused', r.status === 401)
r = await call({ action: 'get', offer_id: OID }, 'kry')
ck('get: the journey, the caregiver rows only, offer and Step 1 rows not yet verified, fingerprints hidden (fact unknown), Approved to Work later', r.status === 200 && r.j.journey.journey_id === JID && r.j.view.rows.every((x) => x.key.startsWith('cg.')) && !r.j.view.rows.some((x) => x.key === 'cg.check.fingerprints') && r.j.view.rows.find((x) => x.key === 'cg.approve.work').status === 'later', r.j && r.j.view && r.j.view.rows.map((x) => x.key + ':' + x.status))
ck('may: Krystal (advance + screening lists, coordinator) may confirm advance, may not approve to work; hub rows never', r.j.may['cg.approve.advance'] === true && r.j.may['cg.approve.work'] === false && r.j.may['cg.offer.signed'] === false && r.j.may['cg.step2.w4'] === true && r.j.is_owner === false, r.j.may)
/* ═══ sweep: the records verify rows ═══ */
r = await call({ action: 'sweep' })
ck('sweep without the job secret is refused', r.status === 401)
r = await call({ action: 'sweep' }, 'cron')
let steps = () => DB.client_journey_step.filter((x) => x.journey_id === JID), st = (k) => steps().find((x) => x.step_key === k)
ck('sweep 1: the signed offer verified from the Training record, with evidence and a verified event; nothing else yet', r.status === 200 && r.j.changed === 1 && st('cg.offer.signed')?.state === 'complete' && st('cg.offer.signed').completed_by === 'hub' && DB.client_journey_event.some((e) => e.kind === 'verified' && e.step_key === 'cg.offer.signed'), { r: r.j, st: steps().map((x) => x.step_key) })
DB.step1_forms = [{ offer_id: OID, answers: { lived_outside_mo: 'yes', cna: 'yes', driver_ack: 'I meet all requirements and request approval to transport clients.' }, signatures: { employee_application: { at: '2026-10-10T01:00:00Z', version: 2, fingerprint: 'f'.repeat(64), typed_name: 'Ava Lee' }, reference_consent: { at: '2026-10-10T01:05:00Z', version: 2, fingerprint: 'g'.repeat(64) }, fcra_disclosure: { at: '2026-10-10T01:06:00Z', version: 1, fingerprint: 'h'.repeat(64) }, edl_fcsr_consent: { at: '2026-10-10T01:07:00Z', version: 3, fingerprint: 'i'.repeat(64) }, availability: { at: '2026-10-10T01:08:00Z', version: 2, fingerprint: 'j'.repeat(64) }, experience: { at: '2026-10-10T01:09:00Z', version: 2, fingerprint: 'k'.repeat(64) }, vehicle: { at: '2026-10-10T01:10:00Z', version: 3, fingerprint: 'l'.repeat(64) } } }]
DB.app_data.find((x) => x.key === 'candidates').data = [{ id: 901, first: 'Ava', last: 'Lee', offer_id: OID, oig: 'CLEAR', oig_date: '2026-10-10', oig_proof: 'bgcheck/901/oig.json', edl: 'Issues Found', edl_date: '2026-10-10', r1n: 'Jane Boss', r1s: 'Positive', r1_type: 'professional', r2n: 'Sue Friend', r2s: 'Positive', r2_type: 'personal' }]
r = await call({ action: 'sweep' }, 'cron')
ck('sweep 2: the seven Step 1 forms, the consents gate, OIG clear with its LEIE document, references cleared (two positive, one professional) verified; EDL flagged is BLOCKED with the reason', st('cg.step1.application')?.state === 'complete' && st('cg.consent.checks')?.state === 'complete' && st('cg.check.oig')?.state === 'complete' && st('cg.check.oig').evidence.document === 'bgcheck/901/oig.json' && st('cg.refs.cleared')?.state === 'complete' && st('cg.check.edl')?.state === 'blocked' && /Flagged/.test(st('cg.check.edl').blocked_reason), steps().map((x) => x.step_key + ':' + x.state))
ck('no identity value appears in any step or event', !JSON.stringify(DB.client_journey_step).match(/\d{3}-?\d{2}-?\d{4}/) )
r = await call({ action: 'get', offer_id: OID }, 'kry')
ck('get after: fingerprints now apply (lived outside Missouri), the CNA credential applies, the driver credential applies; the next move is the blocked EDL owned by the Staffing Coordinator', r.j.view.rows.some((x) => x.key === 'cg.check.fingerprints') && r.j.view.rows.some((x) => x.key === 'cg.credential.cna_hha') && r.j.view.rows.some((x) => x.key === 'cg.credential.driver') && r.j.view.next.key === 'cg.check.edl' && r.j.view.next.owner.email === 'krystal@mo-care.com' && r.j.facts.lived_outside_mo === true, { next: r.j.view.next && r.j.view.next.key, keys: r.j.view.rows.map((x) => x.key) })
/* ═══ confirm: in order, by list ═══ */
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.approve.advance' }, 'kry')
ck('Approve to Advance is refused while it is not its turn (EDL blocked, FCSR not done)', r.status === 409 && /Not yet/.test(r.j.error), r)
DB.app_data.find((x) => x.key === 'candidates').data[0] = { ...DB.app_data.find((x) => x.key === 'candidates').data[0], edl: 'Clear', edl_proof: 'bgcheck/901/edl.pdf', fcsr: 'Clear', fcsr_date: '2026-10-10', fcsr_proof: 'bgcheck/901/fcsr.pdf', fcsr_reg_date: '2026-10-09', fp: 'Clear', fp_date: '2026-10-10', fp_proof: 'bgcheck/901/fp.pdf' }
r = await call({ action: 'sweep' }, 'cron')
ck('sweep 3: EDL now Clear with a document: the block lifts to complete; FCSR, registration and fingerprints verified', st('cg.check.edl')?.state === 'complete' && st('cg.check.fcsr')?.state === 'complete' && st('cg.check.fcsr_registration')?.state === 'complete' && st('cg.check.fingerprints')?.state === 'complete', steps().map((x) => x.step_key + ':' + x.state))
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.approve.advance' }, 'cc')
ck('Casey (a coordinator on no list) is refused: the list decides, not the office role', r.status === 403 && /Approve to Advance list/.test(r.j.error), r)
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.approve.advance' }, 'kry')
ck('Krystal (on the Advance list) confirms: complete in her name with the time, a confirmed event naming the list', r.status === 200 && st('cg.approve.advance').state === 'complete' && st('cg.approve.advance').completed_by === 'krystal@mo-care.com' && DB.client_journey_event.some((e) => e.kind === 'confirmed' && e.step_key === 'cg.approve.advance' && e.detail.list === 'advance'), r)
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.approve.advance' }, 'kry')
ck('confirming twice: already settled', r.status === 409)
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.step2.w4' }, 'kry')
ck('a Step 2 item: any office person confirms, in their name', r.status === 200 && st('cg.step2.w4').completed_by === 'krystal@mo-care.com')
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.offer.signed' }, 'kry')
ck('a verified row cannot be confirmed by hand', r.status === 403 && /on its own/.test(r.j.error), r)
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.approve.work' }, 'kry')
ck('Approve to Work by a coordinator: refused (owners list)', r.status === 403 && /owners/.test(r.j.error), r)
/* ═══ record (credentials) ═══ */
r = await call({ action: 'record', journey_id: JID, step_key: 'cg.credential.cna_hha', result: 'verified on the registry' }, 'kry')
ck('a credential without its document is refused', r.status === 400 && /document/.test(r.j.error))
r = await call({ action: 'record', journey_id: JID, step_key: 'cg.credential.cna_hha', result: 'verified on the registry', document: 'bgcheck/901/cna.pdf', expires: '2028-01-31' }, 'kry')
ck('with the document: complete with result, document, expiry and an evidence_added event', r.status === 200 && st('cg.credential.cna_hha').evidence.document === 'bgcheck/901/cna.pdf' && st('cg.credential.cna_hha').evidence.expires === '2028-01-31' && DB.client_journey_event.some((e) => e.kind === 'evidence_added'), r)
/* ═══ not needed: owners only ═══ */
r = await call({ action: 'not_needed', journey_id: JID, step_key: 'cg.credential.driver', reason: 'They will not drive clients' }, 'kry')
ck('not needed by a coordinator: refused', r.status === 403)
r = await call({ action: 'not_needed', journey_id: JID, step_key: 'cg.credential.driver', reason: 'They will not drive clients' }, 'sam')
ck('not needed by an owner: recorded with the reason, permanent event', r.status === 200 && st('cg.credential.driver').state === 'not_needed' && DB.client_journey_event.some((e) => e.kind === 'not_needed' && e.reason === 'They will not drive clients'))
/* ═══ the gate (welcome-call, reference-send) ═══ */
let g = await CJ.caregiverGate(db, { candidate_id: 999 }, 'cg.approve.advance')
ck('gate: a candidate with no readiness card (the old path) is allowed', g.allowed === true)
g = await CJ.caregiverGate(db, { candidate_id: 901 }, 'cg.approve.work')
ck('gate: a card whose row is not complete refuses, with the plain words', g.allowed === false && /Approved to Work \(owners only\)/.test(g.why), g)
g = await CJ.caregiverGate(db, { candidate_id: 901 }, 'cg.approve.advance')
ck('gate: a completed row allows', g.allowed === true)
/* ═══ list + the rest of the journey ═══ */
r = await call({ action: 'list' }, 'sam')
ck('list: the one open journey with its stage, next move and owner, not approved to work', r.status === 200 && r.j.rows.length === 1 && r.j.rows[0].approved_to_work === false && r.j.rows[0].next, r.j)
for (const k of ['i9_s1', 'mo_w4', 'direct_deposit', 'handbook', 'participant_rights', 'code_of_ethics', 'confidentiality', 'license_upload', 'ss_card_upload']) await call({ action: 'confirm', journey_id: JID, step_key: 'cg.step2.' + k }, 'kry')
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.i9.section2' }, 'kry')
ck('I-9 Section 2 after Section 1, its own confirmation', r.status === 200 && st('cg.i9.section2').state === 'complete')
DB.welcome_calls = [{ id: 'w1', candidate_id: '901', status: 'done', done_at: '2026-10-11T15:00:00Z', invited_at: '2026-10-10' }]
DB.app_data.find((x) => x.key === 'caregivers').data = [{ id: 207, candidate_id: 901, first: 'Ava', last: 'Lee', offer_id: OID, axiscare_id: '9001', hire_date: '2026-10-12', orient_date: '2026-10-12', alz_date: '2026-10-13', ojt_date: '2026-10-20', ojt_online: '2026-10-20', ojt_signed: 'yes' }]
DB.app_data.find((x) => x.key === 'candidates').data = []
DB.caregiver_profiles = [{ id: 'pr1', candidate_id: '207', published: true, published_at: '2026-10-13T00:00:00Z', status: 'published' }]
r = await call({ action: 'sweep' }, 'cron')
ck('sweep 4 (after the move to the roster): welcome call, orientation, dementia, OJT and the profile verified from the records', ['cg.welcome.call', 'cg.training.orientation', 'cg.training.dementia', 'cg.training.ojt', 'cg.profile.published'].every((k) => st(k)?.state === 'complete'), steps().filter((x) => x.state !== 'complete').map((x) => x.step_key + ':' + x.state))
r = await call({ action: 'get', offer_id: OID }, 'sam')
ck('the dates line: employment start = orientation completion 2026-10-12, AxisCare hire 2026-10-12, no difference; Approve to Work is now ready and Samantha (Work list) may', r.j.facts.dates.orientation === '2026-10-12' && r.j.facts.dates.differ === false && r.j.view.rows.find((x) => x.key === 'cg.approve.work').status === 'ready' && r.j.may['cg.approve.work'] === true, { dates: r.j.facts.dates, aw: r.j.view.rows.find((x) => x.key === 'cg.approve.work').status })
/* ═══ SLICE 5: Ready for Final Approval, the lock, the press, AxisCare, the text, the Training report ═══ */
const ops = () => (DB.app_data.find((x) => x.key === 'ops_items') || { data: [] }).data
const roster = () => DB.app_data.find((x) => x.key === 'caregivers').data[0]
const ev = (k) => DB.client_journey_event.filter((e) => e.kind === k && e.journey_id === JID)
ck('get (coordinator): ready for final approval, scheduling locked, may not approve, Level 1 by default, both switches off', r.j.approve.ready_for_final === true && r.j.approve.locked === true && r.j.approve.approved === false && r.j.approve.level_of_care.level === 'Level 1' && r.j.approve.switches.axiscare_live === false, r.j.approve)
r = await call({ action: 'get', offer_id: OID }, 'kry')
ck('get (Krystal, not on the Work list): may_approve_work false', r.j.approve.may_approve_work === false)
r = await call({ action: 'sweep' }, 'cron')
ck('sweep: the Ready for final approval card is raised once, the roster record is locked (work_lock true), the journey learns the AxisCare number', ops().some((i) => i.id === 'cj_final_' + JID && i.status === 'open' && i.kind === 'final_approval') && roster().work_lock === true && DB.client_journey[0].axiscare_caregiver_id === '9001', { cards: ops().map((i) => i.id), r: roster(), j: DB.client_journey[0] })
await call({ action: 'sweep' }, 'cron')
ck('sweep again: still one card', ops().filter((i) => i.id === 'cj_final_' + JID).length === 1)
r = await call({ action: 'confirm', journey_id: JID, step_key: 'cg.approve.work' }, 'sam')
ck('the generic confirm cannot approve to work (its own button, AxisCare included)', r.status === 400 && /own button/.test(r.j.error), r)
r = await call({ action: 'not_needed', journey_id: JID, step_key: 'cg.approve.work', reason: 'skip this one' }, 'sam')
ck('Approve to Work is never marked not needed, even by an owner', r.status === 400, r)
r = await call({ action: 'approve_work', journey_id: JID }, 'kry')
ck('approve_work by Krystal (coordinator, Advance list): refused', r.status === 403 && /Approve to Work list/.test(r.j.error), r)
r = await call({ action: 'approve_work', journey_id: JID }, 'cc')
ck('approve_work by Casey (coordinator, no list): refused', r.status === 403)
r = await call({ action: 'approve_work', journey_id: JID })
ck('approve_work without a sign-in: refused', r.status === 401)
/* practice first: both switches off */
r = await call({ action: 'approve_work', journey_id: JID }, 'sam')
ck('approve_work by Samantha (Work list), switches off: the stamp in her name with the exact time; AxisCare in practice (nothing sent, one practice row in the change log); the text recorded, not sent', r.status === 200 && st('cg.approve.work').state === 'complete' && st('cg.approve.work').completed_by === 'sam@mo-care.com' && st('cg.approve.work').completed_at === new Date().toISOString() && r.j.result.outcome === 'practice' && AX.calls.length === 0 && GHL.messages.length === 0 && DB.axiscare_change_log.length === 1 && DB.axiscare_change_log[0].kind === 'caregiver_status' && DB.axiscare_change_log[0].outcome === 'practice' && DB.axiscare_change_log[0].caregiver === '9001', { r: r.j.result, log: DB.axiscare_change_log, ax: AX.calls })
ck('events: approved_to_work, axiscare_practice, cleared_text_practice with her words (Dementia course, Open Shifts, STOP, no em dash)', ev('approved_to_work').length === 1 && ev('axiscare_practice').length === 1 && ev('cleared_text_practice').length === 1 && /completed your Dementia course/.test(ev('cleared_text_practice')[0].detail.words) && /Open Shifts section of the AxisCare app/.test(ev('cleared_text_practice')[0].detail.words) && /Reply STOP/.test(ev('cleared_text_practice')[0].detail.words) && !/[—]/.test(ev('cleared_text_practice')[0].detail.words) && !/approved to work/i.test(ev('cleared_text_practice')[0].detail.words), ev('cleared_text_practice'))
ck('the answer: approved, AxisCare "practice", text "practice", still LOCKED (no read-back), Approved to Work pill not earned; the card is closed; the roster carries approved_to_work_at/by', r.j.approve.approved === true && r.j.approve.axiscare.state === 'practice' && r.j.approve.text.state === 'practice' && r.j.approve.locked === true && st('cg.axiscare.active')?.state !== 'complete' && ops().find((i) => i.id === 'cj_final_' + JID).status === 'done' && roster().approved_to_work_at && roster().approved_to_work_by === 'sam@mo-care.com', { a: r.j.approve, roster: roster() })
r = await call({ action: 'approve_work', journey_id: JID }, 'sam')
ck('approve_work twice: already approved', r.status === 409 && /Already approved/.test(r.j.error), r)
/* the lock, as coverage reads it */
let L = await WL.workLock(db)
ck('workLock: the journey is locked by its AxisCare number and its offer id', L.ok && L.axis.has('9001') && L.offers.has(OID) && L.open === 1, L)
/* live: AxisCare refuses */
DB.app_data.find((x) => x.key === 'ops_settings').data = { staffing_email: 'krystal@mo-care.com', approve_work_axiscare_live: true, approve_work_text_live: true }
AX.patch = 400
r = await call({ action: 'retry_axiscare', journey_id: JID }, 'cc')
ck('retry (any office person) with the switch on and AxisCare refusing: PATCH by the caregiver id with status Active; the row is BLOCKED "Approval recorded, AxisCare update failed"; a refused change-log row; an urgent card; no text', r.status === 200 && r.j.result.outcome === 'failed' && AX.calls[0] === 'PATCH 9001 {"status":"Active"}' && st('cg.axiscare.active').state === 'blocked' && /Approval recorded, AxisCare update failed: AxisCare answered 400/.test(st('cg.axiscare.active').blocked_reason) && DB.axiscare_change_log[1].outcome === 'refused' && ops().some((i) => i.id === 'cj_axfail_' + JID && i.status === 'open' && i.urgency === 'urgent') && GHL.messages.length === 0 && r.j.approve.axiscare.state === 'failed' && r.j.approve.locked === true, { r: r.j.result, ax: AX.calls, st: st('cg.axiscare.active'), log: DB.axiscare_change_log })
await call({ action: 'sweep' }, 'cron')
ck('the sweep never un-blocks the AxisCare row from a stale roster flag', st('cg.axiscare.active').state === 'blocked')
/* live: AxisCare accepts, read-back Active, after hours, hire date differs */
AX.patch = 200; AX.hireDate = '2026-10-11'; at('2026-10-13T02:00:00Z')   // 9pm Chicago
r = await call({ action: 'retry_axiscare', journey_id: JID }, 'cc')
ck('retry with AxisCare accepting: PATCH then GET read back Active; the row completes with the label; sent_confirmed in the change log; the roster reads Active and UNLOCKED; the failed card closes', r.status === 200 && r.j.result.outcome === 'confirmed' && AX.calls.slice(-2).join('|') === 'PATCH 9001 {"status":"Active"}|GET 9001' && st('cg.axiscare.active').state === 'complete' && st('cg.axiscare.active').evidence.label === 'Active' && st('cg.axiscare.active').evidence.read_back_at && DB.axiscare_change_log[2].outcome === 'sent_confirmed' && roster().axiscare_status_active === true && roster().work_lock === false && ops().find((i) => i.id === 'cj_axfail_' + JID).status === 'done' && r.j.approve.locked === false && r.j.approve.axiscare.state === 'confirmed', { r: r.j.result, ax: AX.calls, st: st('cg.axiscare.active'), roster: roster() })
ck('hire date differs (AxisCare 2026-10-11, orientation 2026-10-12): an event and a card, nothing written to AxisCare', ev('hire_date_differs').length === 1 && ops().some((i) => i.id === 'cj_hiredate_' + JID && /2026-10-11/.test(i.detail)) && !AX.calls.some((c) => /hireDate/.test(c)), ops().map((i) => i.id))
ck('after hours: the text is DUE (held), not sent', r.j.approve.text.state === 'due' && GHL.messages.length === 0 && ev('cleared_text_due').length === 1, r.j.approve.text)
L = await WL.workLock(db)
ck('workLock: unlocked after the stamp and the read-back', L.ok && !L.axis.has('9001') && !L.offers.has(OID), L)
/* the sweep sends the held text in hours */
at('2026-10-13T15:00:00Z')   // 10am Chicago
r = await call({ action: 'sweep' }, 'cron')
ck('sweep in hours: the held text goes through GoHighLevel (contact upsert, one SMS with her words), state sent; the journey completes (active)', r.j.texts_sent === 1 && GHL.messages.length === 1 && GHL.messages[0].type === 'SMS' && /completed your Dementia course/.test(GHL.messages[0].message) && /Reply STOP/.test(GHL.messages[0].message) && st('cg.approve.work').evidence.text.state === 'sent' && ev('cleared_text_sent').length === 1 && DB.client_journey[0].status === 'active' && r.j.completed === 1, { r: r.j, msgs: GHL.messages, t: st('cg.approve.work').evidence.text })
await call({ action: 'sweep' }, 'cron')
ck('sweep again: no second text', GHL.messages.length === 1)
r = await call({ action: 'list' }, 'sam')
ck('list: approved, AxisCare confirmed, unlocked, may_approve_work for Samantha', r.j.rows[0].approved_to_work === true && r.j.rows[0].axiscare === 'confirmed' && r.j.rows[0].locked === false && r.j.may_approve_work === true, r.j)
/* ═══ the Training Platform's report (new path): verified onto a fresh card, server door only ═══ */
const OID2 = '22222222-2222-4333-8444-555555555555'
OFFERS[OID2] = { id: OID2, first_name: 'Ben', last_name: 'Ray', phone: '4175550101', offer_signed_at: '2026-10-11T20:00:00Z', pd_signed_at: '2026-10-11T20:05:00Z', offer_version: 1, pd_version: 1, offer_status: 'accepted', onboarding_path: 'new' }
await CJ.startCaregiverJourney(db, { id: OID2, first_name: 'Ben', last_name: 'Ray' }, 'offer-sign')
const JID2 = DB.client_journey[1].journey_id, st2 = (k) => DB.client_journey_step.find((x) => x.journey_id === JID2 && x.step_key === k)
DB.app_data.find((x) => x.key === 'caregivers').data.push({ id: 208, first: 'Ben', last: 'Ray', offer_id: OID2, axiscare_id: '9002', hire_date: '2026-10-13' })
const rep = (body, secret) => handler(new Request('http://x/caregiver-journey', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-outreach-secret': secret } : {}) }, body: JSON.stringify(body) })).then(async (x) => ({ status: x.status, j: await x.json() }))
r = await rep({ action: 'training_report', axiscare_id: '9002', courses: [{ slug: 'agency-orientation', status: 'complete', completed_at: '2026-10-13T16:00:00Z' }] })
ck('training_report without the server secret: refused', r.status === 401)
r = await rep({ action: 'training_report', axiscare_id: '9002', courses: [{ slug: 'agency-orientation', status: 'complete', completed_at: '2026-10-13T16:00:00Z' }] }, 'wrong')
ck('training_report with a wrong secret: refused', r.status === 401)
r = await rep({ action: 'training_report', axiscare_id: '9002', courses: [{ slug: 'agency-orientation', title: 'Agency Orientation', status: 'complete', completed_at: '2026-10-13T16:00:00Z' }, { slug: 'dementia-care', title: 'Dementia Care', status: 'waived', completed_at: '2026-10-13T17:00:00Z' }, { slug: 'on-the-job-training', status: 'complete' }, { slug: 'agency-orientation', status: 'in_progress' }] }, env.OUTREACH_SECRET)
ck('training_report with the secret: orientation (complete) and dementia (waived) verified onto Ben\'s card as reported by the Training Platform, OJT ignored (needs the signed form), the journey learns the AxisCare number', r.status === 200 && r.j.journey === true && r.j.applied.join(',') === 'cg.training.orientation,cg.training.dementia' && st2('cg.training.orientation').completed_by === 'training-platform' && st2('cg.training.orientation').completed_at === '2026-10-13T16:00:00.000Z' && st2('cg.training.dementia').evidence.status === 'waived' && !st2('cg.training.ojt') && DB.client_journey[1].axiscare_caregiver_id === '9002', { r: r.j, s: st2('cg.training.orientation') })
r = await rep({ action: 'training_report', axiscare_id: '9002', courses: [{ slug: 'agency-orientation', status: 'complete', completed_at: '2026-10-13T16:00:00Z' }] }, env.OUTREACH_SECRET)
ck('the same report again: nothing re-applied', r.status === 200 && r.j.applied.length === 0)
r = await rep({ action: 'training_report', axiscare_id: '7777', courses: [] }, env.OUTREACH_SECRET)
ck('a report for an AxisCare number with no card (the old path): journey false, nothing written', r.status === 200 && r.j.journey === false)
L = await WL.workLock(db)
ck('workLock: Ben (card open, not approved) is locked by 9002; Ava is not', L.ok && L.axis.has('9002') && !L.axis.has('9001') && L.offers.has(OID2), L)
ck('no identity value appears in any step, event or change-log row', !JSON.stringify([DB.client_journey_step, DB.client_journey_event, DB.axiscare_change_log]).match(/\d{3}-\d{2}-\d{4}/))
ck('history: every change is an event; none was ever updated or deleted', DB.client_journey_event.length >= 40 && DB.client_journey_event.every((e) => e.at && e.actor_email && e.kind))
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
