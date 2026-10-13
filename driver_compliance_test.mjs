// DRIVER COMPLIANCE (2026-10-13): the driver-compliance function and the Step 1 hook (_shared/driver.ts), run for real
// against a fake database, a fake private bucket, a fake GoHighLevel and a settable clock. Nothing real is touched; no
// network.  node driver_compliance_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const SECRET = 'j'.repeat(48)
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 's'.repeat(40), HUB_JOB_SECRET: SECRET, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'L' }
/* the clock: Tuesday 2026-10-13, 10am Chicago (CDT) */
const RealDate = Date; let NOW = RealDate.parse('2026-10-13T15:00:00Z')
class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOW) } static now() { return NOW } }
globalThis.Date = FakeDate; const at = (iso) => { NOW = RealDate.parse(iso) }
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
/* fake GoHighLevel (the only outside service the function may call) */
const GHL = { messages: [], fail: false }
globalThis.fetch = async (url, o = {}) => { const u = String(url), m = (o.method || 'GET').toUpperCase()
  if (u.startsWith('https://services.leadconnectorhq.com/contacts/search/duplicate')) return new Response(JSON.stringify({ contacts: [] }), { status: 200 })
  if (u === 'https://services.leadconnectorhq.com/contacts/upsert') { const b = JSON.parse(o.body); return new Response(JSON.stringify({ contact: { id: 'c-' + (b.phone || b.email), phone: b.phone, email: b.email } }), { status: 200 }) }
  if (u.startsWith('https://services.leadconnectorhq.com/contacts/c-')) { const id = decodeURIComponent(u.split('/contacts/')[1]); const a = id.slice(2); return new Response(JSON.stringify({ contact: { id, ...(a.includes('@') ? { email: a } : { phone: a }) } }), { status: 200 }) }
  if (u === 'https://services.leadconnectorhq.com/conversations/messages') { if (GHL.fail) return new Response('{"message":"down"}', { status: 500 }); GHL.messages.push(JSON.parse(o.body)); return new Response('{}', { status: 200 }) }
  throw new Error('unexpected fetch ' + m + ' ' + u) }

/* ── the fake database ── */
let DB = {}, EVENT_WRITES = 0, LOG_FAIL = false
const reset = () => { DB = { driver_compliance: [], driver_compliance_event: [], driver_document: [], app_data: [], auth_identities: [], persons: [], entity_memberships: [], staff_roles: [], document_access_log: [],
  client_journey: [], client_journey_step: [], client_journey_event: [], domains: [], job_applicants: [], contact_optout_current: [], circle_contacts: [], identity_door_audit: [] } }
reset()
let seq = 0
const uuid = () => { const h = (++seq).toString(16).padStart(12, '0'); return `aaaaaaaa-bbbb-4ccc-8ddd-${h}` }
const clone = (x) => JSON.parse(JSON.stringify(x))
function guardUpdate(name, r, p) {
  if (name === 'driver_compliance_event') { EVENT_WRITES++; throw new Error('Driver compliance history is append-only') }
  if (name === 'driver_compliance') {
    if ('offer_id' in p && r.offer_id && p.offer_id !== r.offer_id) throw new Error('the offer never changes')
    if ('caregiver_id' in p && r.caregiver_id && p.caregiver_id !== r.caregiver_id) throw new Error('the caregiver never changes')
    if (p.caregiver_id && DB.driver_compliance.some((x) => x !== r && x.caregiver_id === p.caregiver_id)) throw new Error('duplicate caregiver_id')
    if (p.status && !['non_driver', 'pending', 'approved', 'suspended'].includes(p.status)) throw new Error('check status')
  }
  if (name === 'driver_document') {
    for (const k of ['path', 'kind', 'dc_id', 'uploaded_by', 'uploaded_at', 'content_type']) if (k in p && p[k] !== r[k]) throw new Error('an uploaded document is never changed')
    if (r.verified_at && 'verified_at' in p && p.verified_at !== r.verified_at) throw new Error('a verification is never changed')
    if (r.superseded_at && 'superseded_at' in p && p.superseded_at !== r.superseded_at) throw new Error('stays superseded')
  }
}
function table(name) {
  const rows = () => DB[name]
  const q = (mode, payload, filters = [], opts = {}) => {
    const match = (r) => filters.every((f) => f(r))
    const run = () => {
      if (mode === 'select') { let out = rows().filter(match); if (opts.order) out = [...out].sort((a, b) => String(a[opts.order]).localeCompare(String(b[opts.order])) * (opts.asc === false ? -1 : 1)); if (opts.limit) out = out.slice(0, opts.limit); if (opts.head) throw new Error('no such table for you'); return clone(out) }
      if (mode === 'insert') {
        const r = { ...payload }
        if (name === 'driver_compliance') { if (r.offer_id && rows().some((x) => x.offer_id === r.offer_id)) throw new Error('duplicate offer_id'); if (r.caregiver_id && rows().some((x) => x.caregiver_id === r.caregiver_id)) throw new Error('duplicate caregiver_id'); if (!r.offer_id && !r.caregiver_id) throw new Error('driver_compliance_someone')
          Object.assign(r, { id: r.id || uuid(), reminders: r.reminders || {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }
        if (name === 'driver_document') { if (rows().some((x) => x.dc_id === r.dc_id && x.path === r.path)) throw new Error('duplicate dc path'); r.id = r.id || uuid(); r.uploaded_at = r.uploaded_at || new Date().toISOString() }
        if (name === 'driver_compliance_event') { r.id = ++seq; r.at = new Date(NOW + seq).toISOString() }
        if (name === 'document_access_log' && LOG_FAIL) throw new Error('log down')
        if (name === 'client_journey_event') { r.id = ++seq; r.at = new Date().toISOString() }
        rows().push(r); return [clone(r)] }
      if (mode === 'upsert') { const i = rows().findIndex((x) => x.journey_id === payload.journey_id && x.step_key === payload.step_key); if (i >= 0) rows()[i] = { ...rows()[i], ...payload }; else rows().push({ ...payload }); return [clone(payload)] }
      if (mode === 'update') { const out = []; for (const r of rows()) if (match(r)) { guardUpdate(name, r, payload); Object.assign(r, payload); if (name === 'driver_compliance') r.updated_at = new Date().toISOString(); out.push(clone(r)) } return out }
    }
    const api = {
      eq: (k, v) => q(mode, payload, [...filters, (r) => String(r[k]) === String(v)], opts), neq: (k, v) => q(mode, payload, [...filters, (r) => String(r[k]) !== String(v)], opts),
      in: (k, vs) => q(mode, payload, [...filters, (r) => vs.map(String).includes(String(r[k]))], opts),
      is: (k, v) => q(mode, payload, [...filters, (r) => (v === null ? r[k] == null : r[k] === v)], opts),
      not: (k, op, v) => q(mode, payload, [...filters, (r) => op === 'is' ? (r[k] ?? null) !== v : true], opts),
      ilike: (k, v) => q(mode, payload, [...filters, (r) => String(r[k] ?? '').toLowerCase().includes(String(v).replace(/%/g, '').toLowerCase())], opts),
      order: (k, o2) => q(mode, payload, filters, { ...opts, order: k, asc: o2?.ascending }), limit: (n) => q(mode, payload, filters, { ...opts, limit: n }),
      select: (_c, o2) => q(mode, payload, filters, { ...opts, head: !!o2?.head }),
      maybeSingle: async () => { try { return { data: run()[0] ?? null, error: null } } catch (e) { return { data: null, error: { message: e.message } } } },
      then: (ok, bad) => { try { return Promise.resolve(ok({ data: run(), error: null })) } catch (e) { return Promise.resolve(ok({ data: null, error: { message: e.message } })) } },
    }
    return api
  }
  return { select: (c, o2) => q('select', null, [], { head: !!o2?.head }), insert: (p) => q('insert', p), upsert: (p) => q('upsert', p), update: (p) => q('update', p), delete: () => { if (name === 'driver_compliance_event') EVENT_WRITES++; throw new Error('never deleted') } }
}
const ad = (k) => DB.app_data.find((x) => x.key === k)?.data
const setAd = (k, v) => { const r = DB.app_data.find((x) => x.key === k); if (r) r.data = v; else DB.app_data.push({ key: k, data: v }) }
const DOOR = { calls: [], history: [] }
async function rpc(name, a) {
  if (name === 'upsert_app_data_item') { let row = DB.app_data.find((x) => x.key === a.target_key); if (!row) { row = { key: a.target_key, data: [] }; DB.app_data.push(row) } const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = a.item; else row.data.push(a.item); return { data: null, error: null } }
  if (name === 'contact_send_refusal_log') return { data: null, error: null }
  if (name === 'driver_roster_patch') {
    DOOR.calls.push(clone(a))
    const OK = ['dl_status', 'cleared_to_drive', 'dl_expires', 'auto_ins_expires', 'dl_approved_by', 'dl_approved_at']
    const bad = Object.keys(a.p_patch).filter((k) => !OK.includes(k)); if (bad.length) return { data: null, error: { message: 'not a field driver compliance may write: ' + bad.join(', ') } }
    const list = ad('caregivers') || [], hits = list.filter((x) => String(x.id) === String(a.p_id))
    if (!hits.length) return { data: { ok: false, reason: 'gone' }, error: null }
    const r = hits[0], rev = /^\d+$/.test(String(r._rev ?? '')) ? Number(r._rev) : 0
    if (rev !== a.p_base_rev) return { data: { ok: false, reason: 'changed', current_record: clone(r) }, error: null }
    const changed = Object.keys(a.p_patch).filter((k) => JSON.stringify(r[k]) !== JSON.stringify(a.p_patch[k]))
    if (!changed.length) return { data: { ok: true, unchanged: true, rev }, error: null }
    Object.assign(r, a.p_patch); r._rev = rev + 1; DOOR.history.push({ id: r.id, fields: changed }); return { data: { ok: true, rev: r._rev }, error: null }
  }
  return { data: null, error: { message: 'unknown rpc ' + name } }
}
const STORE = {}; let PDF_FAIL = false
const storage = { from: (bucket) => ({
  createSignedUploadUrl: async (p) => ({ data: { token: 'tok', signedUrl: 'https://up/' + bucket + '/' + p, path: p }, error: null }),
  list: async (dir, o) => ({ data: Object.keys(STORE).filter((k) => k.startsWith(bucket + '/' + dir + '/') && k.slice((bucket + '/' + dir + '/').length) === o.search).map((k) => ({ name: k.split('/').pop() })), error: null }),
  upload: async (p, bytes, o) => { if (PDF_FAIL) return { error: { message: 'storage down' } }; if (STORE[bucket + '/' + p] && !o?.upsert) return { error: { message: 'exists' } }; STORE[bucket + '/' + p] = bytes; return { data: { path: p }, error: null } },
  createSignedUrl: async (p) => STORE[bucket + '/' + p] ? { data: { signedUrl: 'https://signed/' + bucket + '/' + p }, error: null } : { data: null, error: { message: 'not found' } } }) }
const USERS = { sam: ['u-sam', 'sam@mo-care.com'], kry: ['u-kry', 'krystal@mo-care.com'], cc: ['u-cc', 'casey@mo-care.com'], nobody: ['u-no', 'no@mo-care.com'] }
globalThis.__fakeCreateClient = () => ({ from: table, rpc, storage, auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: { id: USERS[jwt][0], email: USERS[jwt][1], app_metadata: {} } }, error: null } : { data: null, error: { message: 'bad' } } } })
const TMP = path.join(ROOT, '.driver_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(FN, TMP, { recursive: true })
for (const p of fs.readdirSync(TMP, { recursive: true })) { const f = path.join(TMP, String(p)); if (!f.endsWith('.ts')) continue; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient').replace(/^import .* from 'https:[^']*'$/mg, '')) }
let DRV, LINKS, P, DOCS, OR
try { await import(path.join(TMP, 'driver-compliance', 'index.ts')); DRV = await import(path.join(TMP, '_shared', 'driver.ts')); LINKS = await import(path.join(TMP, '_shared', 'applicant-links.ts')); P = await import(path.join(TMP, '_shared', 'onboarding-permissions.ts')); DOCS = await import(path.join(TMP, '_shared', 'step1-documents.ts')); OR = await import(path.join(TMP, '_shared', 'outreach.ts')) } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const H = handler
const call = async (body, tok, extra = {}) => { const r = await H(new Request('http://x/driver-compliance', { method: 'POST', headers: { 'Content-Type': 'application/json', 'user-agent': 'TestPhone', ...(tok ? (tok === 'cron' ? { 'x-cron-secret': SECRET } : { Authorization: 'Bearer ' + tok }) : {}), ...extra }, body: JSON.stringify(body) })); let j = null; try { j = await r.json() } catch {} return { status: r.status, j } }
const db = globalThis.__fakeCreateClient()
const ops = () => ad('ops_items') || []
const evs = (dc, kind) => DB.driver_compliance_event.filter((e) => e.dc_id === dc && (!kind || e.kind === kind))
const row = (id) => DB.driver_compliance.find((r) => r.id === id)
const cgRec = (id) => (ad('caregivers') || []).find((x) => String(x.id) === String(id))
const stepOf = (oid) => { const j = DB.client_journey.find((x) => x.offer_id === oid); return j && DB.client_journey_step.find((s) => s.journey_id === j.journey_id && s.step_key === 'cg.credential.driver') }
const noDash = (s) => !/—/.test(String(s))

/* ── people ── */
const OA = '11111111-2222-4333-8444-555555555551', OB = '11111111-2222-4333-8444-555555555552', OC = '11111111-2222-4333-8444-555555555553', OP = '11111111-2222-4333-8444-555555555554'
DB.auth_identities = [['u-sam', 'p-sam'], ['u-kry', 'p-kry'], ['u-cc', 'p-cc'], ['u-no', 'p-no']].map(([a, p]) => ({ auth_user_id: a, person_id: p, project_ref: 'zngsgedlsxinbygwmxwn' }))
DB.persons = [['p-sam', 'Samantha Troutman', 'sam@mo-care.com'], ['p-kry', 'Krystal', 'krystal@mo-care.com'], ['p-cc', 'Casey', 'casey@mo-care.com'], ['p-no', 'Nora', 'no@mo-care.com']].map(([p, n, e]) => ({ person_id: p, full_name: n, primary_email: e, active: true }))
DB.entity_memberships = ['p-sam', 'p-kry', 'p-cc', 'p-no'].map((p) => ({ person_id: p, entity: 'cc_ihs', active: true, ended_at: null }))
DB.staff_roles = [{ person_id: 'p-sam', entity: 'cc_ihs', role: 'owner_admin' }, { person_id: 'p-kry', entity: 'cc_ihs', role: 'staffing_coordinator' }, { person_id: 'p-cc', entity: 'cc_ihs', role: 'care_coordinator' }]
DB.domains = [{ entity: 'cc_ihs', code: 'caregivers', owner_person: 'p-kry' }]
setAd('ops_settings', { staffing_email: 'krystal@mo-care.com' })
setAd('onboarding_permissions', { version: 1, advance: [], work: [{ person_id: 'p-sam' }], screening: [], history: [] })
setAd('caregivers', [
  { id: 201, first: 'Ava', last: 'Lee', phone: '4175550101', email: 'ava@x.com', offer_id: OA, axiscare_id: '9001', _rev: 3 },
  { id: 202, first: 'Ben', last: 'Ray', phone: '4175550102', email: 'ben@x.com', offer_id: OB, axiscare_id: '9002' },
  { id: 203, first: 'Old', last: 'Driver', phone: '4175550103', email: 'old@x.com', axiscare_id: '9003', dl_expires: '2027-02-01', auto_ins_expires: '2026-12-01', dl_proof: 'typed.pdf' },
  { id: 204, first: 'Pat', last: 'Practice', phone: '(417) 555-0181', email: 'pat@practice.invalid', offer_id: OP } ])
setAd('candidates', [{ id: 901, first: 'Cy', last: 'Lo', phone: '4175550104', email: 'cy@x.com', offer_id: OC }])
for (const [oid, nm] of [[OA, 'Ava Lee'], [OB, 'Ben Ray'], [OC, 'Cy Lo']]) DB.client_journey.push({ journey_id: 'j-' + oid.slice(-1), subject: 'caregiver', offer_id: oid, status: 'open', client_name: nm })

/* ═══ 1. the link and the pure rules ═══ */
const L1 = await LINKS.makeDriverLink(SECRET, OA)
const u1 = new URL(L1)
ck('link: https://cc.mo-care.com/driver.html with d, e and t only; 21 days; checks back; another kind does not', u1.origin + u1.pathname === 'https://cc.mo-care.com/driver.html' && [...u1.searchParams.keys()].join() === 'd,e,t' && Number(u1.searchParams.get('e')) - Math.floor(NOW / 1000) === 21 * 86400 && await LINKS.checkLink(SECRET, 'driver', u1.searchParams.get('d'), u1.searchParams.get('e'), u1.searchParams.get('t')) && !(await LINKS.checkLink(SECRET, 'step1', u1.searchParams.get('d'), u1.searchParams.get('e'), u1.searchParams.get('t'))), L1)
ck('link: a non-uuid record number is never a driver link', !LINKS.okId('driver', '123') && LINKS.okId('driver', OA))
const T = '2026-10-13'
const R0 = { status: 'approved', license_expires: '2027-01-01', insurance_expires: '2026-11-12', reminders: {} }
ck('deriveStatus: cleared only when approved and both expiries are in the future; labels', DRV.deriveStatus(R0, T).cleared_to_drive && DRV.deriveStatus({ ...R0, status: 'pending' }, T).cleared_to_drive === false && DRV.deriveStatus({ ...R0, insurance_expires: T }, T).cleared_to_drive === false && DRV.deriveStatus(null).label === 'Not set up yet' && DRV.deriveStatus({ status: 'non_driver' }).label === 'Non-Driver' && DRV.deriveStatus({ status: 'suspended' }).label === 'Suspended' && DRV.deriveStatus({ status: 'pending' }).label === 'Pending Verification' && DRV.deriveStatus(R0).label === 'Approved Driver')
ck('reminderDue: 30 days out is d30 (insurance 2026-11-12)', JSON.stringify(DRV.reminderDue(T, R0).map((d) => d.key)) === '["insurance:2026-11-12:d30"]', DRV.reminderDue(T, R0))
ck('reminderDue: 31 days out is nothing yet', DRV.reminderDue(T, { ...R0, insurance_expires: '2026-11-13' }).length === 0)
ck('reminderDue: 14, 7 days out are d14, d7; the expiry day itself is still d7; the day after is expired', DRV.reminderDue(T, { ...R0, insurance_expires: '2026-10-27' })[0].stage === 'd14' && DRV.reminderDue(T, { ...R0, insurance_expires: '2026-10-20' })[0].stage === 'd7' && DRV.reminderDue(T, { ...R0, insurance_expires: T })[0].stage === 'd7' && DRV.reminderDue(T, { ...R0, insurance_expires: '2026-10-12' })[0].stage === 'expired')
ck('reminderDue: a stamped stage is never due again; non-drivers and suspended never', DRV.reminderDue(T, { ...R0, reminders: { 'insurance:2026-11-12:d30': { at: 'x' } } }).length === 0 && DRV.reminderDue(T, { ...R0, status: 'non_driver' }).length === 0 && DRV.reminderDue(T, { ...R0, status: 'suspended' }).length === 0)
ck('reminderDue: a newer insurance uploaded since the 30-day mark stops the reminders (not the expiry)', DRV.reminderDue(T, { ...R0, insurance_expires: '2026-10-27' }, [{ kind: 'insurance', uploaded_at: '2026-10-10T00:00:00Z', expires: '2027-10-27' }]).length === 0 && DRV.reminderDue(T, { ...R0, insurance_expires: '2026-10-12' }, [{ kind: 'insurance', uploaded_at: '2026-10-10T00:00:00Z', expires: '2027-10-27' }])[0].stage === 'expired')
const B0 = DRV.approveBlockers({ status: 'pending' }, [], T)
ck('approveBlockers: an empty record names all six things (agreement, license docs and verify, insurance docs and verify, coverage, MVR)', B0.length === 7 && B0.some((b) => /agreement/.test(b)) && B0.some((b) => /coverage/i.test(b)) && B0.some((b) => /MVR/.test(b)), B0)
ck('rosterFields: never blanks an office-typed date; the approval only once approved', !('dl_expires' in DRV.rosterFields({ status: 'non_driver' }, T)) && DRV.rosterFields({ status: 'non_driver' }, T).cleared_to_drive === false && DRV.rosterFields({ ...R0, approved_at: 'x', approved_by: 'Sam' }, T).dl_approved_by === 'Sam')
ck('the words: no em dash, no pay, her phone number; the link in every message', ['d30', 'd14', 'd7'].every((s) => { const m = DRV.reminderMessage('Ava', { what: 'license', expires: '2026-11-12', stage: s }, 'LINK'); return noDash(m.text + m.html + m.subject) && /LINK/.test(m.text) && /234-8494/.test(m.text) && !/\bpay\b/i.test(m.text) }) && noDash(DRV.linkMessage('Ava', 'renewal', 'L').text))
ck('the sender is registered (outreach SENDER_REGISTER), scheduled', OR.SENDER_REGISTER['driver-compliance']?.scheduled === true)
ck('the Approve drivers list: owners always; a coordinator only once named; only owners change it', P.mayApprove(P.normalizePerms({}), 'driver', { person_id: 'p-sam', roles: ['owner_admin'] }) && !P.mayApprove(P.normalizePerms({}), 'driver', { person_id: 'p-kry', roles: ['staffing_coordinator'] }) && P.mayApprove(P.normalizePerms({ driver: [{ person_id: 'p-kry' }] }), 'driver', { person_id: 'p-kry', roles: [] }) && P.mayChange(P.normalizePerms({}), 'driver', { person_id: 'p-sam', roles: ['owner_admin'] }) && !P.mayChange(P.normalizePerms({ driver: [{ person_id: 'p-kry' }] }), 'driver', { person_id: 'p-kry', roles: [] }))
const ch = P.applyChange(P.normalizePerms({}), 'driver', 'add', { person_id: 'p-kry', email: 'krystal@mo-care.com', name: 'Krystal' }, { person_id: 'p-sam', roles: ['owner_admin'], email: 'sam@mo-care.com' }, '2026-10-13T15:00:00Z')
ck('...adding Krystal writes a history line of kind driver and touches no other list', ch.ok && ch.next.driver.length === 1 && ch.next.history[0].kind === 'driver' && /Approve drivers/.test(ch.changed) && ch.next.work.length === 0)

/* ═══ 2. the Step 1 hook ═══ */
const SIG = { at: '2026-10-13T14:00:00Z', typed_name: 'Ava Lee', version: 4, fingerprint: 'f'.repeat(64) }
const ansA = { transport_willing: 'yes', license_front: { path: `offer/${OA}/lf.jpg`, content_type: 'image/jpeg' }, license_back: { path: `offer/${OA}/lb.jpg`, content_type: 'image/jpeg' }, insurance_doc: { path: `offer/${OA}/ins.pdf`, content_type: 'application/pdf' },
  license_expires: '2029-01-01', insurance_expires: '2027-04-01', insurer: 'State Farm', license_state: 'mo' }
let h = await DRV.driverFromStep1(db, OA, { first: 'Ava', last: 'Lee' }, ansA, { vehicle: SIG }, { vehicle: `step1/${OA}/vehicle.pdf` }, '2026-10-13T14:00:01Z')
const A = DB.driver_compliance.find((r) => r.offer_id === OA)
ck('Step 1 YES: one record, Pending Verification, the agreement, three documents, the dates, the insurer, MO', h.ok && A.status === 'pending' && A.agreement_form === 'vehicle' && A.agreement_version === 4 && A.agreement_pdf === `step1/${OA}/vehicle.pdf` && DB.driver_document.filter((d) => d.dc_id === A.id).length === 3 && A.license_expires === '2029-01-01' && A.insurance_expires === '2027-04-01' && A.insurer === 'State Farm' && A.license_state === 'MO', [h, A])
ck('Step 1 YES: history created, agreement_signed, three doc_uploaded', evs(A.id, 'created').length === 1 && evs(A.id, 'agreement_signed').length === 1 && evs(A.id, 'doc_uploaded').length === 3)
ck('Step 1 YES: the roster record (found by the offer) is linked and mirrored: Pending Verification, not cleared, the dates', A.caregiver_id === '201' && cgRec(201).dl_status === 'Pending Verification' && cgRec(201).cleared_to_drive === false && cgRec(201).dl_expires === '2029-01-01' && cgRec(201).auto_ins_expires === '2027-04-01', cgRec(201))
const n1 = DB.driver_compliance_event.length, d1 = DB.driver_document.length
h = await DRV.driverFromStep1(db, OA, { first: 'Ava', last: 'Lee' }, ansA, { vehicle: SIG }, { vehicle: `step1/${OA}/vehicle.pdf` }, '2026-10-13T14:00:01Z')
ck('Step 1 hook is idempotent: a second call writes no event, no document, no change', h.ok && DB.driver_compliance_event.length === n1 && DB.driver_document.length === d1 && h.changed.length === 0 && DB.driver_compliance.filter((r) => r.offer_id === OA).length === 1, h)
h = await DRV.driverFromStep1(db, OC, { first: 'Cy', last: 'Lo' }, { transport_willing: 'yes', license_front: { path: `offer/${OA}/lf.jpg`, content_type: 'image/jpeg' }, license_back: { path: `offer/${OC}/../x.jpg`, content_type: 'image/jpeg' }, insurance_doc: { path: `offer/${OC}/ins.exe`, content_type: 'application/x-msdownload' } }, {}, {}, '2026-10-13T14:05:00Z')
const C = DB.driver_compliance.find((r) => r.offer_id === OC)
ck('Step 1: another offer\'s file, a path with .., and a non-image are refused (a note in the history; nothing recorded)', h.ok && h.refused.length === 3 && DB.driver_document.filter((d) => d.dc_id === C.id).length === 0 && evs(C.id, 'note').length === 1, h)
ck('Step 1: no roster record yet (Background & References only): not on the roster, no card', h.mirror.roster === 'not_on_roster' && !ops().some((c) => c.id === 'dc_mirror_' + C.id), h.mirror)
h = await DRV.driverFromStep1(db, OB, { first: 'Ben', last: 'Ray' }, { transport_willing: 'no' }, { non_driver: { at: '2026-10-13T14:10:00Z', typed_name: 'Ben Ray', version: 1 } }, { non_driver: `step1/${OB}/non_driver.pdf` }, '2026-10-13T14:10:01Z')
const Bn = DB.driver_compliance.find((r) => r.offer_id === OB)
ck('Step 1 NO: Non-Driver at once, the Non-Driver Agreement recorded, no documents asked for', h.ok && Bn.status === 'non_driver' && Bn.agreement_form === 'non_driver' && DB.driver_document.filter((d) => d.dc_id === Bn.id).length === 0 && DRV.missingItems(Bn).length === 0, h)
ck('Step 1 NO: the roster says Non-Driver, cleared_to_drive false; the readiness row is not needed ("Non-Driver Agreement signed")', cgRec(202).dl_status === 'Non-Driver' && cgRec(202).cleared_to_drive === false && stepOf(OB)?.state === 'not_needed' && stepOf(OB).exception.reason === 'Non-Driver Agreement signed' && DB.client_journey_event.some((e) => e.kind === 'not_needed' && e.reason === 'Non-Driver Agreement signed'), [cgRec(202), stepOf(OB)])
ck('Step 1 hook: no transport answer yet, nothing made', (await DRV.driverFromStep1(db, OP, {}, {}, {}, {}, 'x')).skipped && !DB.driver_compliance.some((r) => r.offer_id === OP))

/* ═══ 3. the office door: who may ═══ */
let r = await call({ action: 'get', offer_id: OA })
ck('no sign-in: 401', r.status === 401, r)
r = await call({ action: 'get', offer_id: OA }, 'nobody')
ck('a signed-in person with no office role: 403', r.status === 403, r)
r = await call({ action: 'get', offer_id: OA }, 'cc')
ck('get: a care coordinator sees the record, documents without paths, history, Pending Verification, what blocks approval', r.status === 200 && r.j.row.id === A.id && r.j.status_label === 'Pending Verification' && r.j.docs.length === 3 && r.j.docs.every((d) => !('path' in d)) && !JSON.stringify(r.j).includes('lf.jpg') && r.j.events.length >= 5 && r.j.derived.approve_blockers.some((b) => /not verified/.test(b)) && r.j.derived.can_approve === false && !('reminders' in r.j.row), r.j)
r = await call({ action: 'get', caregiver_id: '203' }, 'kry')
ck('get: an existing driver with no record: "Not set up yet" and the office-typed roster dates (read only)', r.status === 200 && r.j.row === null && r.j.status_label === 'Not set up yet' && r.j.roster_dates.dl_expires === '2027-02-01', r.j)
r = await call({ action: 'report' }, 'kry')
const rp = (id) => r.j.rows.find((x) => x.caregiver_id === id)
ck('report: who has driving dates on file, set up or not (the old driver not set up; Ava set up by Step 1)', r.status === 200 && r.j.rows.length === 2 && rp('203').set_up === false && rp('203').status_label === 'Not set up yet' && rp('203').has_dl_proof === true && rp('201').set_up === true, r.j)
ck('install created no status for the existing driver (no assumption)', !DB.driver_compliance.some((x) => x.caregiver_id === '203') && !cgRec(203).dl_status)

/* ═══ 4. documents: upload slots are path-checked; every open is logged ═══ */
r = await call({ action: 'upload_url', key: A.id, kind: 'mvr', content_type: 'application/pdf' }, 'kry')
ck('upload_url: a private slot under dc/<record>/mvr/', r.status === 200 && new RegExp(`^dc/${A.id}/mvr/[^/]+\\.pdf$`).test(r.j.path) && r.j.token, r.j)
const mvrPath = r.j.path
r = await call({ action: 'upload_url', key: A.id, kind: 'mvr', content_type: 'text/html' }, 'kry')
ck('upload_url: only images and PDF', r.status === 400)
r = await call({ action: 'record', key: A.id, kind: 'mvr', path: mvrPath, content_type: 'application/pdf' }, 'kry')
ck('record: a file that never arrived is refused', r.status === 409, r)
STORE['driver-docs/' + mvrPath] = new Uint8Array([1])
r = await call({ action: 'record', key: A.id, kind: 'mvr', path: `dc/${Bn.id}/mvr/x.pdf`, content_type: 'application/pdf' }, 'kry')
ck('record: another person\'s slot is refused (403)', r.status === 403, r)
r = await call({ action: 'record', key: A.id, kind: 'insurance', path: mvrPath, content_type: 'application/pdf' }, 'kry')
ck('record: a slot of another kind is refused (403)', r.status === 403, r)
r = await call({ action: 'record', key: A.id, kind: 'mvr', path: mvrPath, content_type: 'application/pdf' }, 'kry')
const mvrDoc = r.j?.doc_id
ck('record: the driving record is kept, uploaded by Krystal, with a history line', r.status === 200 && DB.driver_document.find((d) => d.id === mvrDoc)?.uploaded_by === 'Krystal' && evs(A.id, 'doc_uploaded').length === 4, r)
LOG_FAIL = true
r = await call({ action: 'open', doc_id: mvrDoc }, 'kry')
ck('open: when the open cannot be logged, no link is given (500)', r.status === 500 && !r.j.url && /logged/.test(r.j.error), r)
LOG_FAIL = false
r = await call({ action: 'open', doc_id: mvrDoc }, 'kry')
const lg = DB.document_access_log.at(-1)
ck('open: a five-minute link, logged with her name, the document kind and the record', r.status === 200 && r.j.expires_in === 300 && /driver-docs/.test(r.j.url) && lg.by_name === 'Krystal' && lg.doc === 'driver:mvr' && lg.offer_id === 'driver:' + A.id && lg.path === mvrPath, [r.j, lg])

/* ═══ 5. verify and approve ═══ */
r = await call({ action: 'verify', key: A.id, what: 'license' }, 'kry')
ck('verify license: the license photos came from Step 1 but the files are recorded; future expiry from the document; stamped', r.status === 200 && row(A.id).license_verified_by === 'Krystal' && row(A.id).license_expires === '2029-01-01' && DB.driver_document.filter((d) => d.dc_id === A.id && d.kind.startsWith('license')).every((d) => d.verified_by === 'Krystal'), r)
r = await call({ action: 'verify', key: A.id, what: 'insurance', expires: '2026-10-01' }, 'kry')
ck('verify insurance with a past expiry: refused', r.status === 400 && /future/.test(r.j.error), r)
r = await call({ action: 'verify', key: A.id, what: 'mvr', result: 'fine' }, 'kry')
ck('verify MVR without acceptable / not_acceptable: refused', r.status === 400, r)
r = await call({ action: 'approve', key: A.id }, 'kry')
ck('approve by a coordinator not on the Approve drivers list: 403', r.status === 403 && /Approve drivers/.test(r.j.error), r)
r = await call({ action: 'approve', key: A.id }, 'sam')
ck('approve by an owner with checks missing: 409 with the list (insurance, coverage, MVR)', r.status === 409 && r.j.blockers.length === 3 && r.j.blockers.some((b) => /insurance is not verified/.test(b)) && r.j.blockers.some((b) => /Coverage/.test(b)) && r.j.blockers.some((b) => /MVR/.test(b)) && row(A.id).status === 'pending', r.j)
await call({ action: 'verify', key: A.id, what: 'insurance' }, 'kry')
await call({ action: 'verify', key: A.id, what: 'coverage', note: 'Business use endorsement on the declarations page' }, 'kry')
r = await call({ action: 'verify', key: A.id, what: 'mvr', result: 'not_acceptable' }, 'kry')
r = await call({ action: 'approve', key: A.id }, 'sam')
ck('approve with an MVR that is not acceptable: refused', r.status === 409 && r.j.blockers.join() === 'The driving record result is not acceptable', r.j)
const nEv = evs(A.id, 'verified').length
r = await call({ action: 'verify', key: A.id, what: 'mvr', result: 'acceptable', note: 'Clean record, 3 years' }, 'kry')
ck('verify MVR again with acceptable: a new history line, the record updated, the earlier verification of the document never changed', r.status === 200 && row(A.id).mvr_result === 'acceptable' && evs(A.id, 'verified').length === nEv + 1, r)
r = await call({ action: 'approve', key: A.id }, 'sam')
const Aa = row(A.id)
ck('approve by an owner: Approved Driver, who and when, a history line', r.status === 200 && Aa.status === 'approved' && Aa.approved_by === 'Samantha Troutman' && Aa.approved_at && evs(A.id, 'approved').length === 1, r)
ck('approve mirrors the roster through the door: Approved Driver, cleared, both dates, approved by and at; only the six fields', cgRec(201).dl_status === 'Approved Driver' && cgRec(201).cleared_to_drive === true && cgRec(201).dl_approved_by === 'Samantha Troutman' && cgRec(201).dl_approved_at === Aa.approved_at && DOOR.calls.every((c) => Object.keys(c.p_patch).every((k) => DRV.ROSTER_FIELDS.includes(k))), cgRec(201))
ck('approve completes the readiness row cg.credential.driver (completed_by the approver), with an event', stepOf(OA)?.state === 'complete' && stepOf(OA).completed_by === 'sam@mo-care.com' && stepOf(OA).evidence.driver_compliance.dc_id === A.id && DB.client_journey_event.some((e) => e.step_key === 'cg.credential.driver' && e.kind === 'evidence_added'), stepOf(OA))
r = await call({ action: 'approve', key: A.id }, 'sam')
ck('approve twice: refused', r.status === 409)
const nLog = DB.document_access_log.length
r = await call({ action: 'open', key: A.id, what: 'agreement' }, 'kry')
ck('open the signed agreement: no PDF in this test bucket means a clear refusal, nothing logged', r.status === 500 && DB.document_access_log.length === nLog, r)
STORE['onboarding-documents/' + A.agreement_pdf] = new Uint8Array([9])
r = await call({ action: 'open', key: A.id, what: 'agreement' }, 'cc')
ck('open the signed agreement (from Step 1): a link from onboarding-documents, logged as driver:agreement:vehicle', r.status === 200 && /onboarding-documents/.test(r.j.url) && DB.document_access_log.at(-1).doc === 'driver:agreement:vehicle' && DB.document_access_log.at(-1).by_name === 'Casey', r.j)

/* ═══ 6. the caregiver link ═══ */
const lk = async (dc) => { const u = new URL(await LINKS.makeDriverLink(SECRET, dc)); return { d: u.searchParams.get('d'), e: u.searchParams.get('e'), t: u.searchParams.get('t') } }
const LA = await lk(A.id)
r = await call({ action: 'view', ...LA, t: 'x'.repeat(43) })
ck('a forged link: 401 with the office number', r.status === 401 && /234-8494/.test(r.j.error))
r = await call({ action: 'view', ...LA })
ck('view: first name, Approved Driver, cleared, nothing needed, the expiries in words, the vehicle words to read; no paths', r.status === 200 && r.j.first === 'Ava' && r.j.status_label === 'Approved Driver' && r.j.cleared_to_drive === true && r.j.needed.length === 0 && r.j.expiries.license.date === '2029-01-01' && r.j.forms.vehicle.title && r.j.agreement_needed === null && !JSON.stringify(r.j).includes('offer/'), r.j)
r = await call({ action: 'upload_url', ...LA, kind: 'mvr', content_type: 'image/jpeg' })
ck('the caregiver may not upload a driving record (the office orders it)', r.status === 400)
r = await call({ action: 'upload_url', ...LA, kind: 'insurance', content_type: 'image/heic' })
const insPath = r.j.path
ck('upload_url on the link: a slot under their own record', r.status === 200 && insPath.startsWith(`dc/${A.id}/insurance/`) && insPath.endsWith('.heic'))
STORE['driver-docs/' + insPath] = new Uint8Array([2])
const LB = await lk(Bn.id)
r = await call({ action: 'uploaded', ...LB, kind: 'insurance', path: insPath, content_type: 'image/heic', expires: '2027-11-12' })
ck('uploaded: someone else\'s file on another person\'s link is refused (403)', r.status === 403, r)
r = await call({ action: 'uploaded', ...LA, kind: 'insurance', path: insPath, content_type: 'image/heic', expires: '2027-11-12', insurer: 'Progressive' })
ck('uploaded by an Approved Driver: stays approved (the verified date stays until the office verifies the new one); the old proof superseded; a card for the office', r.status === 200 && row(A.id).status === 'approved' && row(A.id).insurance_expires === '2027-04-01' && DB.driver_document.filter((d) => d.dc_id === A.id && d.kind === 'insurance' && !d.superseded_at).length === 1 && ops().some((c) => c.id === 'dc_verify_' + A.id && c.owner === 'krystal@mo-care.com'), [r.j, row(A.id)])
r = await call({ action: 'verify', key: A.id, what: 'insurance', insurer: 'Progressive' }, 'kry')
ck('the office verifies the new proof: the record takes its date, the roster follows, the verify card closes', r.status === 200 && row(A.id).insurance_expires === '2027-11-12' && row(A.id).insurer === 'Progressive' && cgRec(201).auto_ins_expires === '2027-11-12' && ops().find((c) => c.id === 'dc_verify_' + A.id).status === 'done', [row(A.id), cgRec(201)])
/* 2026-10-13: the Non-Driver Agreement is in the form list now (proposed, not approved for real): a real caregiver cannot sign it yet */
r = await call({ action: 'sign', ...LB, form: 'non_driver', typed_name: 'Ben Ray', consent: true })
ck('sign the Non-Driver Agreement as a real caregiver while its wording is not approved for real: refused with a clear message (409)', r.status === 409 && r.j.not_approved === true, r)
r = await call({ action: 'sign', ...LB, form: 'vehicle', typed_name: 'Ben Ray', consent: true })
ck('sign the vehicle form as a real caregiver while its wording is not approved for real: refused, nothing changed', r.status === 409 && r.j.not_approved === true && row(Bn.id).status === 'non_driver', r)
/* a practice person (Pat Practice, 555-0181, @practice.invalid) may sign the practice way */
h = await DRV.driverFromStep1(db, OP, { first: 'Pat', last: 'Practice' }, { transport_willing: 'no' }, {}, {}, '2026-10-13T14:20:00Z')
const Pp = DB.driver_compliance.find((x) => x.offer_id === OP), LP = await lk(Pp.id)
r = await call({ action: 'sign', ...LP, form: 'vehicle', typed_name: 'Pat', consent: true })
ck('sign: a one-word name is refused', r.status === 400)
r = await call({ action: 'sign', ...LP, form: 'vehicle', typed_name: 'Pat Practice', consent: false })
ck('sign: no consent tick, refused', r.status === 400)
r = await call({ action: 'sign', ...LP, form: 'vehicle', typed_name: 'Pat Practice', consent: true })
const pdfKey = Object.keys(STORE).find((k) => k.startsWith(`onboarding-documents/driver/${Pp.id}/vehicle-v`))
ck('sign the vehicle form (practice person): the PDF kept in onboarding-documents/driver/<record>/, the signature in the history, Non-Driver becomes Pending Verification (driver_requested)', r.status === 200 && r.j.pdf === true && pdfKey && String.fromCharCode(...STORE[pdfKey].slice(0, 5)) === '%PDF-' && row(Pp.id).status === 'pending' && row(Pp.id).agreement_form === 'vehicle' && evs(Pp.id, 'agreement_signed').some((e) => e.detail.typed_name === 'Pat Practice' && /^[0-9a-f]{64}$/.test(e.detail.fingerprint) && e.detail.agent === 'TestPhone') && evs(Pp.id, 'driver_requested').length === 1 && cgRec(204).dl_status === 'Pending Verification', r)
r = await call({ action: 'sign', ...LP, form: 'vehicle', typed_name: 'Pat Practice', consent: true })
ck('sign the same agreement twice: refused (a signed agreement is never changed)', r.status === 409 && r.j.already === true)
/* once Samantha approves the vehicle wording for real, a real caregiver may sign it; a PDF that cannot be stored is never silent */
DOCS.APPROVED_FOR_REAL.vehicle = DOCS.FORMS.vehicle.version; PDF_FAIL = true
r = await call({ action: 'sign', ...LB, form: 'vehicle', typed_name: 'Ben Ray', consent: true })
ck('real caregiver, wording approved for real, storage down: the signature is recorded, Non-Driver becomes Pending Verification, and a card says the PDF is missing', r.status === 200 && r.j.pdf === false && row(Bn.id).agreement_form === 'vehicle' && row(Bn.id).status === 'pending' && ops().some((c) => c.id === 'dc_pdf_' + Bn.id + '_vehicle' && noDash(c.detail)) && cgRec(202).dl_status === 'Pending Verification', r.j)
PDF_FAIL = false; delete DOCS.APPROVED_FOR_REAL.vehicle

/* ═══ 7. suspend, non-driver, setup, send link ═══ */
r = await call({ action: 'suspend', key: Pp.id, reason: 'no' }, 'kry')
ck('suspend needs a reason of five characters', r.status === 400)
r = await call({ action: 'non_driver', key: Pp.id, reason: 'Told Krystal she will not drive any more' }, 'cc')
ck('non_driver (staff, immediate): Non-Driver, history, the roster not cleared, the readiness card row not needed', r.status === 200 && row(Pp.id).status === 'non_driver' && evs(Pp.id, 'non_driver').some((e) => e.by_name === 'Casey' && e.detail.reason === 'Told Krystal she will not drive any more') && cgRec(204).dl_status === 'Non-Driver' && cgRec(204).cleared_to_drive === false, r)
r = await call({ action: 'suspend', key: Pp.id, reason: 'Accident report pending' }, 'kry')
ck('suspend a Non-Driver: refused (nothing to suspend)', r.status === 409)
r = await call({ action: 'setup', caregiver_id: '203' }, 'kry')
const O = DB.driver_compliance.find((x) => x.caregiver_id === '203')
ck('setup an existing driver: Pending Verification, the typed dates carried (noted as not verified), the roster not cleared', r.status === 200 && O.status === 'pending' && O.license_expires === '2027-02-01' && O.insurance_expires === '2026-12-01' && evs(O.id, 'created')[0].detail.note.includes('not verified') && cgRec(203).dl_status === 'Pending Verification' && cgRec(203).cleared_to_drive === false, r)
r = await call({ action: 'setup', caregiver_id: '203' }, 'kry')
ck('setup twice: refused, the record named', r.status === 409 && r.j.key === O.id)
r = await call({ action: 'send_link', key: O.id, why: 'renewal' }, 'kry')
ck('send_link with its switch off: practice, nothing sent, the link and words handed back to paste', r.status === 200 && r.j.state === 'practice' && /driver\.html\?d=/.test(r.j.link) && GHL.messages.length === 0 && evs(O.id, 'note').some((e) => e.detail.link_sent === 'practice'), r.j)
setAd('ops_settings', { ...ad('ops_settings'), driver_link_send_live: true })
r = await call({ action: 'send_link', key: O.id, why: 'renewal' }, 'kry')
ck('send_link with its switch on: a text (with STOP) and an email with the private link', r.status === 200 && r.j.state === 'sent' && GHL.messages.length === 2 && GHL.messages[0].type === 'SMS' && /Reply STOP/.test(GHL.messages[0].message) && /driver\.html\?d=/.test(GHL.messages[0].message) && GHL.messages[1].type === 'Email', [r.j, GHL.messages])
r = await call({ action: 'send_link', key: Pp.id, why: 'change' }, 'kry')
ck('send_link to a practice person: never contacted', r.status === 200 && r.j.state === 'practice' && GHL.messages.length === 2, r.j)
setAd('ops_settings', { ...ad('ops_settings'), driver_link_send_live: false })

/* ═══ 8. the pass ═══ */
r = await call({ action: 'pass' })
ck('the pass without the schedule\'s secret: 401', r.status === 401)
GHL.messages = []
/* O: insurance 2026-12-01 is 49 days out today; move the clock to 2026-11-01 (Sunday): 30 days out, held on Sunday */
at('2026-11-01T16:00:00Z')
r = await call({ action: 'pass' }, 'cron')
ck('Sunday: the d30 reminder is held (never dropped), one reminder_held line, not stamped', r.status === 200 && r.j.held >= 1 && !row(O.id).reminders['insurance:2026-12-01:d30'] && row(O.id).reminders['insurance:2026-12-01:d30:held'] && evs(O.id, 'reminder_held').length === 1, [r.j, row(O.id).reminders])
await call({ action: 'pass' }, 'cron')
ck('...held again on the next pass without a second history line', evs(O.id, 'reminder_held').length === 1)
at('2026-11-02T16:00:00Z')   /* Monday 10am Chicago (CST), 29 days out */
r = await call({ action: 'pass' }, 'cron')
ck('Monday, switch off: practice: stamped as practice, a reminder_sent line (sent false), nothing sent', r.j.practice === 1 && row(O.id).reminders['insurance:2026-12-01:d30'].practice === true && evs(O.id, 'reminder_sent').at(-1).detail.sent === false && GHL.messages.length === 0, [r.j, row(O.id).reminders])
r = await call({ action: 'pass' }, 'cron')
ck('the stamp holds: the next pass does nothing for it', r.j.practice === 0 && r.j.sent === 0 && evs(O.id, 'reminder_sent').length === 1, r.j)
setAd('ops_settings', { ...ad('ops_settings'), driver_reminders_live: true })
at('2026-11-17T16:00:00Z')   /* 14 days out */
r = await call({ action: 'pass' }, 'cron')
ck('switch on, 14 days out: the d14 text (STOP, link) and email go; stamped with texted and emailed', r.j.sent === 1 && row(O.id).reminders['insurance:2026-12-01:d14'].texted === true && row(O.id).reminders['insurance:2026-12-01:d14'].emailed === true && GHL.messages.length === 2 && /reminder from Caring Companions/.test(GHL.messages[0].message) && /Reply STOP/.test(GHL.messages[0].message) && /driver\.html/.test(GHL.messages[0].message), [r.j, GHL.messages])
await call({ action: 'pass' }, 'cron')
ck('one stamp only: no second d14', GHL.messages.length === 2)
at('2026-11-25T00:30:00Z')   /* 6:30pm Chicago Monday the 24th, 7 days out: outside 9 to 6 */
r = await call({ action: 'pass' }, 'cron')
ck('7 days out at 6:30pm: held, no message, no card yet', r.j.held === 1 && GHL.messages.length === 2 && !ops().some((c) => c.id === `dc_d7_${O.id}_insurance_2026-12-01`), r.j)
at('2026-11-25T15:00:00Z')   /* Tuesday 9am Chicago, 6 days out */
r = await call({ action: 'pass' }, 'cron')
const d7card = ops().find((c) => c.id === `dc_d7_${O.id}_insurance_2026-12-01`)
ck('d7: the text again AND one card for their coordinator (the Caregivers domain owner, no roster coordinator)', r.j.sent === 1 && GHL.messages.length === 4 && /expires in 6 days/.test(GHL.messages[2].message) && d7card && d7card.owner === 'krystal@mo-care.com' && noDash(d7card.title + d7card.detail), [r.j, d7card])
await call({ action: 'pass' }, 'cron')
ck('d7 never twice: no second message, still one card', GHL.messages.length === 4 && ops().filter((c) => c.id === `dc_d7_${O.id}_insurance_2026-12-01`).length === 1)
/* a test person gets it even with the switch off; a practice person never */
setAd('ops_settings', { ...ad('ops_settings'), driver_reminders_live: false, test_people: { phones: ['4175550101'], emails: ['ava@x.com'] } })
DB.driver_compliance.find((x) => x.id === A.id).license_expires = '2026-12-20'   /* Ava (approved) license 25 days out */
Object.assign(DB.driver_compliance.find((x) => x.id === Pp.id), { status: 'pending', insurance_expires: '2026-12-20' })
r = await call({ action: 'pass' }, 'cron')
ck('switch off: a test person (Ava, on the Admin test list) still gets her d30; the practice person is stamped practice, never sent', row(A.id).reminders['license:2026-12-20:d30'].texted === true && GHL.messages.length === 6 && row(Pp.id).reminders['insurance:2026-12-20:d30'].practice === true && !GHL.messages.some((m) => /555-?0181|practice\.invalid/.test(JSON.stringify(m))), [r.j, row(Pp.id).reminders])
setAd('ops_settings', { ...ad('ops_settings'), test_people: {} , driver_reminders_live: true })
/* a send GoHighLevel refuses three times: a card, recorded as failed */
GHL.fail = true
DB.driver_compliance.find((x) => x.id === A.id).insurance_expires = '2026-12-10'   /* Ava insurance 15 days: nothing yet; 14 tomorrow */
at('2026-11-26T15:00:00Z')
for (let i = 0; i < 3; i++) await call({ action: 'pass' }, 'cron')
ck('GoHighLevel refusing: tried three passes, then recorded failed with a card and a reminder_refused line', row(A.id).reminders['insurance:2026-12-10:d14']?.failed === true && evs(A.id, 'reminder_refused').length === 1 && ops().some((c) => c.id === `dc_rem_${A.id}_insurance:2026-12-10:d14`), row(A.id).reminders)
GHL.fail = false
/* expiry: O was never re-verified; approve O first so the expiry suspends an Approved Driver */
Object.assign(DB.driver_compliance.find((x) => x.id === O.id), { status: 'approved', approved_at: '2026-11-03T15:00:00Z', approved_by: 'Samantha Troutman' })
at('2026-12-02T15:00:00Z')   /* the day after 2026-12-01 */
r = await call({ action: 'pass' }, 'cron')
const Ox = row(O.id), expCard = ops().find((c) => c.id === `dc_exp_${O.id}_insurance_2026-12-01`)
ck('expiry: an Approved Driver is suspended automatically ("insurance expired"), expired and suspended lines, one urgent card', r.j.suspended === 1 && Ox.status === 'suspended' && Ox.status_reason === 'insurance expired' && evs(O.id, 'expired').length === 1 && evs(O.id, 'suspended').some((e) => e.detail.automatic === true) && expCard?.urgency === 'urgent' && noDash(expCard.title + expCard.detail), [r.j, Ox])
ck('expiry: the roster says Suspended, not cleared to drive', cgRec(203).dl_status === 'Suspended' && cgRec(203).cleared_to_drive === false, cgRec(203))
await call({ action: 'pass' }, 'cron')
ck('expiry acts once: no second suspension line or card', evs(O.id, 'suspended').length === 1 && ops().filter((c) => c.id === `dc_exp_${O.id}_insurance_2026-12-01`).length === 1)
/* Ava's approved license expires: suspended, and her readiness row goes back to open */
DB.driver_compliance.find((x) => x.id === A.id).license_expires = '2026-12-01'
r = await call({ action: 'pass' }, 'cron')
ck('expiry of a new-path hire: suspended, the readiness row cg.credential.driver back to open with an event', row(A.id).status === 'suspended' && stepOf(OA).state === 'open' && DB.client_journey_event.some((e) => e.step_key === 'cg.credential.driver' && e.kind === 'unconfirmed'), stepOf(OA))
/* back again: new documents uploaded, verified, approved */
const LA2 = await lk(A.id)
r = await call({ action: 'upload_url', ...LA2, kind: 'license_front', content_type: 'image/jpeg' }); STORE['driver-docs/' + r.j.path] = new Uint8Array([3])
r = await call({ action: 'uploaded', ...LA2, kind: 'license_front', path: r.j.path, content_type: 'image/jpeg', expires: '2026-11-30' })
ck('uploaded with an expiry already past: refused', r.status === 400)
r = await call({ action: 'upload_url', ...LA2, kind: 'license_front', content_type: 'image/jpeg' }); const lfp = r.j.path; STORE['driver-docs/' + lfp] = new Uint8Array([3])
r = await call({ action: 'uploaded', ...LA2, kind: 'license_front', path: lfp, content_type: 'image/jpeg', expires: '2034-12-01' })
ck('a suspended driver uploads a new license: Pending Verification, the license verification cleared', r.status === 200 && row(A.id).status === 'pending' && row(A.id).license_verified_at === null && row(A.id).license_expires === '2034-12-01' && cgRec(201).dl_status === 'Pending Verification', [r.j, row(A.id)])
r = await call({ action: 'approve', key: A.id }, 'sam')
ck('approve before the new license is verified: 409', r.status === 409 && r.j.blockers.some((b) => /license is not verified/.test(b)), r.j)
await call({ action: 'verify', key: A.id, what: 'license' }, 'kry')
DB.app_data.find((x) => x.key === 'onboarding_permissions').data.driver = [{ person_id: 'p-kry' }]
r = await call({ action: 'approve', key: A.id }, 'kry')
ck('once Krystal is on the Approve drivers list she may approve: Approved Driver again, roster cleared, readiness row complete', r.status === 200 && row(A.id).status === 'approved' && row(A.id).approved_by === 'Krystal' && cgRec(201).cleared_to_drive === true && cgRec(201).dl_expires === '2034-12-01' && stepOf(OA).state === 'complete', r.j)

/* ═══ 9. the roster door is the only way; history append-only; mirror_all ═══ */
const was = cgRec(201)._rev
cgRec(201)._rev = was + 5   /* someone saved the roster since: the door hands back the current record, the mirror retries once on it */
r = await call({ action: 'suspend', key: A.id, reason: 'Accident under review' }, 'kry')
ck('the door: a stale read is retried on the fresh record (never a whole-record save); the office edit is kept', r.status === 200 && cgRec(201).dl_status === 'Suspended' && cgRec(201)._rev === was + 6 && r.j.mirror.roster === 'saved', [r.j, cgRec(201)])
/* the expiry day itself, and people who have left */
setAd('caregivers', [...ad('caregivers'), { id: 205, first: 'Eve', last: 'Day', phone: '4175550105', email: 'eve@x.com' }, { id: 206, first: 'Gone', last: 'Away', phone: '4175550106', active: false }])
await call({ action: 'setup', caregiver_id: '205' }, 'kry'); await call({ action: 'setup', caregiver_id: '206' }, 'kry')
const E = DB.driver_compliance.find((x) => x.caregiver_id === '205'), G = DB.driver_compliance.find((x) => x.caregiver_id === '206')
Object.assign(E, { status: 'approved', approved_at: '2026-11-01T15:00:00Z', approved_by: 'Samantha Troutman', license_expires: '2026-12-02', insurance_expires: '2027-06-01', reminders: { 'license:2026-12-02:d7': { at: 'x' } } })
Object.assign(G, { status: 'approved', approved_at: '2026-11-01T15:00:00Z', approved_by: 'Samantha Troutman', license_expires: '2026-12-20', insurance_expires: '2027-06-01' })
const nMsg = GHL.messages.length
r = await call({ action: 'pass' }, 'cron')
ck('the expiry day itself: still an Approved Driver (the date has not passed) but the roster is no longer cleared to drive', row(E.id).status === 'approved' && cgRec(205).dl_status === 'Approved Driver' && cgRec(205).cleared_to_drive === false, [r.j, cgRec(205)])
ck('a caregiver who has left (inactive on the roster) is never reminded, and nothing is stamped', r.j.not_current >= 1 && !Object.keys(row(G.id).reminders || {}).length && GHL.messages.length === nMsg, [r.j, row(G.id).reminders])
ck('history is append-only: the function never changed or removed a history line', EVENT_WRITES === 0)
ck('every status change left its line: Ava has created, agreement, uploads, verified, approved twice, suspended twice, expired', ['created', 'agreement_signed', 'doc_uploaded', 'verified', 'approved', 'suspended', 'expired'].every((k) => evs(A.id, k).length >= 1) && evs(A.id, 'approved').length === 2 && evs(A.id, 'suspended').length === 2)
r = await call({ action: 'mirror_all' }, 'kry')
ck('mirror_all is for the schedule or an owner only (a staff sign-in is not enough)', r.status === 401)
r = await call({ action: 'mirror_all' }, 'cron')
ck('mirror_all: every record copied (on the roster or not)', r.status === 200 && r.j.looked_at === DB.driver_compliance.length && (r.j.roster_saved || 0) >= 3, r.j)
ck('no em dash in any card the function raised', ops().filter((c) => c.created_by === 'driver-compliance').every((c) => noDash(c.title + c.detail)))
ck('nothing in the function reached any service but GoHighLevel (every other fetch would have thrown)', true)

for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (note ? '  ' + note : ''))
console.log(`${res.filter((x) => x[1]).length}/${res.length} passed`); process.exit(res.every((x) => x[1]) ? 0 : 1)
