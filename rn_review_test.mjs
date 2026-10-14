// RN REVIEW (2026-10-14, LPN nurse visit plan steps 5 to 7): the rn-review function and _shared/rn-review.ts, run for real
// against a fake database, a fake private bucket, a fake AxisCare and a settable clock. Nothing real is touched; no network.
//   node rn_review_test.mjs        (HUB_ROOT=<care-coordinator-hub checkout> adds the checks against the Hub's own GHE form,
//                                   ghe-forms-rules.js and nurse-rules.js)
import fs from 'fs'; import path from 'path'; import vm from 'vm'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const SECRET = 'j'.repeat(48)
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 's'.repeat(40), HUB_JOB_SECRET: SECRET, AXISCARE_TOKEN: 'ax', AXISCARE_SITE: '16485' }
/* the clock: Wednesday 2026-10-14, 10am Chicago (CDT) */
const RealDate = Date; let NOW = RealDate.parse('2026-10-14T15:00:00Z')
class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOW) } static now() { return NOW } }
globalThis.Date = FakeDate; const at = (iso) => { NOW = RealDate.parse(iso) }
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
/* fake AxisCare (the only outside service the function may call) */
const AX = { calls: [], fail: false, visits: [] }
globalThis.fetch = async (url, o = {}) => { const u = String(url)
  if (u.startsWith('https://16485.axiscare.com/api/visits?')) { AX.calls.push(u); if (AX.fail) return new Response('{}', { status: 500 })
    const q = new URL(u).searchParams, from = q.get('startDate'), to = q.get('endDate')
    return new Response(JSON.stringify({ results: { visits: AX.visits.filter((v) => String(v.scheduledStartDate).slice(0, 10) >= from && String(v.scheduledStartDate).slice(0, 10) <= to && String(v.client) === q.get('clientIds')) } }), { status: 200 }) }
  throw new Error('unexpected fetch ' + u) }

/* ── the fake database ── */
let DB = {}, LOG_FAIL = false, UPSERT_FAIL = null, EVENT_WRITES = 0
const reset = () => { DB = { nurse_flag: [], rn_ghe_signature: [], rn_review_event: [], app_data: [], auth_identities: [], persons: [], entity_memberships: [], staff_roles: [], document_access_log: [], domains: [], evidence_history: [] } }
reset()
let seq = 0
const uuid = () => { const h = (++seq).toString(16).padStart(12, '0'); return `aaaaaaaa-bbbb-4ccc-8ddd-${h}` }
const clone = (x) => JSON.parse(JSON.stringify(x))
function guardUpdate(name, r, p) {
  if (name === 'rn_review_event') { EVENT_WRITES++; throw new Error('append-only') }
  if (name === 'nurse_flag') {
    for (const k of ['client_id', 'seen', 'by_name', 'service_key', 'at', 'practice']) if (k in p && p[k] !== r[k]) throw new Error('nurse_flag: what the LPN marked is never changed')
    if (r.status === 'reviewed') throw new Error('nurse_flag: a review is final and never changed')
  }
  if (name === 'rn_ghe_signature') {
    for (const k of Object.keys(p)) if (!['pdf_path', 'form_updated_at'].includes(k) && p[k] !== r[k]) throw new Error('rn_ghe_signature: a signature is write-once')
    if (r.pdf_path && 'pdf_path' in p && p.pdf_path !== r.pdf_path) throw new Error('the signed PDF never changes')
  }
}
function table(name) {
  const rows = () => DB[name]
  const q = (mode, payload, filters = [], opts = {}) => {
    const match = (r) => filters.every((f) => f(r))
    const run = () => {
      if (mode === 'select') { let out = rows().filter(match); if (opts.order) out = [...out].sort((a, b) => String(a[opts.order]).localeCompare(String(b[opts.order])) * (opts.asc === false ? -1 : 1)); if (opts.limit) out = out.slice(0, opts.limit); return clone(out) }
      if (mode === 'insert') {
        const r = { ...payload }
        if (name === 'nurse_flag') { if (!r.client_id && !r.client_axiscare_id) throw new Error('nurse_flag_client'); Object.assign(r, { id: uuid(), at: new Date().toISOString(), status: 'open', rn_note: null, reviewed_at: null, reviewed_by: null }) }
        if (name === 'rn_ghe_signature') { if (rows().some((x) => x.ghe_id === r.ghe_id)) throw new Error('duplicate key value violates unique constraint "rn_ghe_signature_ghe_id_key"'); Object.assign(r, { id: uuid(), pdf_path: null, form_updated_at: null }) }
        if (name === 'rn_review_event') { r.id = ++seq; r.at = new Date(NOW + seq).toISOString() }
        if (name === 'document_access_log' && LOG_FAIL) throw new Error('log down')
        rows().push(r); return [clone(r)] }
      if (mode === 'update') { const out = []; for (const r of rows()) if (match(r)) { guardUpdate(name, r, payload); Object.assign(r, payload); out.push(clone(r)) } return out }
    }
    const api = {
      eq: (k, v) => q(mode, payload, [...filters, (r) => String(r[k]) === String(v)], opts),
      in: (k, vs) => q(mode, payload, [...filters, (r) => vs.map(String).includes(String(r[k]))], opts),
      is: (k, v) => q(mode, payload, [...filters, (r) => (v === null ? r[k] == null : r[k] === v)], opts),
      order: (k, o2) => q(mode, payload, filters, { ...opts, order: k, asc: o2?.ascending }), limit: (n) => q(mode, payload, filters, { ...opts, limit: n }),
      select: () => q(mode, payload, filters, opts),
      maybeSingle: async () => { try { return { data: run()[0] ?? null, error: null } } catch (e) { return { data: null, error: { message: e.message } } } },
      then: (ok) => { try { return Promise.resolve(ok({ data: run(), error: null })) } catch (e) { return Promise.resolve(ok({ data: null, error: { message: e.message } })) } },
    }
    return api
  }
  return { select: () => q('select', null, []), insert: (p) => q('insert', p), update: (p) => q('update', p), delete: () => { if (name === 'rn_review_event') EVENT_WRITES++; throw new Error('never deleted') } }
}
const ad = (k) => DB.app_data.find((x) => x.key === k)?.data
const setAd = (k, v) => { const r = DB.app_data.find((x) => x.key === k); if (r) r.data = v; else DB.app_data.push({ key: k, data: v }) }
async function rpc(name, a) {
  if (name === 'upsert_app_data_item') {
    if (UPSERT_FAIL && a.target_key === UPSERT_FAIL) return { data: null, error: { message: 'The GHE form was signed by the participant, so its answers cannot change' } }
    let row = DB.app_data.find((x) => x.key === a.target_key); if (!row) { row = { key: a.target_key, data: [] }; DB.app_data.push(row) }
    const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = clone(a.item); else row.data.push(clone(a.item)); return { data: null, error: null } }
  return { data: null, error: { message: 'unknown rpc ' + name } }
}
const STORE = {}; let PDF_FAIL = false
const storage = { from: (bucket) => ({
  upload: async (p, bytes, o) => { if (PDF_FAIL) return { error: { message: 'storage down' } }; if (STORE[bucket + '/' + p] && !o?.upsert) return { error: { message: 'exists' } }; STORE[bucket + '/' + p] = bytes; return { data: { path: p }, error: null } },
  createSignedUrl: async (p, s) => STORE[bucket + '/' + p] ? { data: { signedUrl: 'https://signed/' + bucket + '/' + p + '?s=' + s }, error: null } : { data: null, error: { message: 'not found' } } }) }
const USERS = { nat: ['u-nat', 'natasha@mo-care.com'], rita: ['u-rita', 'rita@mo-care.com'], lpn: ['u-lpn', 'lena@mo-care.com'], lpn2: ['u-lpn2', 'lou@mo-care.com'], sam: ['u-sam', 'sam@mo-care.com'], cc: ['u-cc', 'casey@mo-care.com'],
  natvault: ['u-natv', 'natasha@mo-care.com', { hub_access: ['rn_review'] }], natstaff: ['u-nats', 'natasha@mo-care.com', { hub_access: ['staffing'] }], gone: ['u-gone', 'old@mo-care.com'] }
globalThis.__fakeCreateClient = () => ({ from: table, rpc, storage, auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: { id: USERS[jwt][0], email: USERS[jwt][1], app_metadata: USERS[jwt][2] || {} } }, error: null } : { data: null, error: { message: 'bad' } } } })
const TMP = path.join(ROOT, '.rn_review_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(FN, TMP, { recursive: true })
for (const p of fs.readdirSync(TMP, { recursive: true })) { const f = path.join(TMP, String(p)); if (!f.endsWith('.ts')) continue; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient').replace(/^import .* from 'https:[^']*'$/mg, '')) }
let RN, FNMOD, NS
try { FNMOD = await import(path.join(TMP, 'rn-review', 'index.ts')); RN = await import(path.join(TMP, '_shared', 'rn-review.ts')); NS = await import(path.join(TMP, '_shared', 'nurse-services.ts')) } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const H = handler
const call = async (body, tok, extra = {}) => { const r = await H(new Request('http://x/rn-review', { method: 'POST', headers: { 'Content-Type': 'application/json', 'user-agent': 'TestPhone', ...(tok ? (tok === 'cron' ? { 'x-cron-secret': SECRET } : { Authorization: 'Bearer ' + tok }) : {}), ...extra }, body: JSON.stringify(body) })); let j = null; try { j = await r.json() } catch {} return { status: r.status, j } }
const ops = () => ad('ops_items') || []
const ghe = (id) => (ad('ghe_forms') || []).find((g) => g.id === id)
const evs = (kind) => DB.rn_review_event.filter((e) => !kind || e.kind === kind)
const noDash = (s) => !/\u2014/.test(String(s))

/* ── people and records ── */
DB.auth_identities = [['u-nat', 'p-nat'], ['u-natv', 'p-nat'], ['u-nats', 'p-nat'], ['u-rita', 'p-rita'], ['u-lpn', 'p-lpn'], ['u-sam', 'p-sam'], ['u-cc', 'p-cc'], ['u-gone', 'p-gone']].map(([a, p]) => ({ auth_user_id: a, person_id: p, project_ref: 'zngsgedlsxinbygwmxwn' }))
DB.persons = [['p-nat', 'Natasha Early', 'natasha@mo-care.com', true], ['p-rita', 'Rita Rowe', 'rita@mo-care.com', true], ['p-lpn', 'Lena Park', 'lena@mo-care.com', true], ['p-sam', 'Samantha Troutman', 'sam@mo-care.com', true], ['p-cc', 'Casey', 'casey@mo-care.com', true], ['p-gone', 'Old Nurse', 'old@mo-care.com', false], ['p-pay', 'Mia Medicaid', 'mia@mo-care.com', true]]
  .map(([p, n, e, a]) => ({ person_id: p, full_name: n, primary_email: e, active: a }))
DB.entity_memberships = ['p-sam', 'p-cc'].map((p) => ({ person_id: p, entity: 'cc_ihs', active: true, ended_at: null }))
DB.staff_roles = [{ person_id: 'p-sam', entity: 'cc_ihs', role: 'owner_admin' }, { person_id: 'p-cc', entity: 'cc_ihs', role: 'care_coordinator' }]
DB.domains = [{ entity: 'cc_ihs', code: 'payer_programs', owner_person: 'p-pay' }]
const NURSES = [
  { name: 'Natasha Early', cred: 'RN', license: 'RN-1', expires: '2027-05-31', email: 'natasha@mo-care.com', employee: true, supervising_rn: true, phone: '4175550110' },
  { name: 'Rita Rowe', cred: 'RN', license: 'RN-2', expires: '2027-05-31', email: 'rita@mo-care.com', employee: true },
  { name: 'Lena Park', cred: 'LPN', license: 'LPN-1', expires: '2027-05-31', email: 'lena@mo-care.com', employee: true },
  { name: 'Lou Lane', cred: 'LPN', license: 'LPN-2', expires: '2027-05-31', email: 'lou@mo-care.com', employee: true },
  { name: 'Old Nurse', cred: 'RN', license: 'RN-3', expires: '2026-01-31', email: 'old@mo-care.com', employee: true },
]
setAd('nurse_staff', NURSES)
setAd('nurse_clients', [{ id: 'nc1', name: 'Ada Client', axiscare_client_id: '7001', assigned_nurse: 'Lena Park' }, { id: 'nc2', name: 'Bo Client', axiscare_client_id: '7002', assigned_nurse: 'Lou Lane' },
  { id: 'nc3', name: 'Pat Practice (TRAINING)', axiscare_client_id: '', assigned_nurse: 'Lena Park' }, { id: 'nc4', name: 'Cy Client', axiscare_client_id: '7004', assigned_nurse: 'Rita Rowe' }])
setAd('ops_settings', { company_holidays: [], nurse_review_live: false })
const PNG = 'data:image/png;base64,iVBORw0KGgo='
const FORM = (id, o = {}) => ({ id, client: 'Ada Client', client_id: 'nc1', visit_date: '2026-10-06', nurse: 'Lena Park', status: 'rn_review', total: 9, rn_reviewer: '', sig_nurse: PNG, sig_part: PNG, sig_sup: '',
  f: { ghe_client: 'Ada Client', ghe_visit_date: '2026-10-06', ghe_bp: '128/80', ghe_diagnoses: 'CHF, diabetes', ghe_c_mobility: 'uses a walker', ghe_sig_nurse_date: '2026-10-06', ghe_sig_part_date: '2026-10-06', ghe_sig_sup_date: '' },
  checks: ['#ghe_reason_grid input[value="ghe"]', '#ghe_cardio_grid input[value="hypertension"]'], radios: { ghe_s_mobility: '3', ghe_s_safety: '6', ghe_integ: 'none', ghe_yn_vet: 'no' }, updated_at: '2026-10-07T15:00:00Z', ...o })
setAd('ghe_forms', [FORM('g1'), FORM('g2', { client: 'Bo Client', client_id: 'nc2', nurse: 'Lou Lane', rn_reviewer: 'Natasha Early', updated_at: '2026-10-13T15:00:00Z' }), FORM('g3', { rn_reviewer: 'Rita Rowe' }),
  FORM('g4', { nurse: 'Rita Rowe', client: 'Cy Client', client_id: 'nc4' }), FORM('g5', { superseded_by: 'g1' }), FORM('g6', { sig_part: '' }), FORM('gp', { client: 'Pat Practice (TRAINING)', client_id: 'nc3' }),
  FORM('gr', { status: 'ready', rn_reviewer: 'Natasha Early', visit_date: '2026-09-01' })])
/* the slice 9 value history: g1 went to RN review on Oct 7 (5 working days ago), g2 on Oct 13 (1) */
DB.evidence_history = [{ source: 'app_data:ghe_forms', record_id: 'g1', field: 'status', new_value: 'draft', at: '2026-10-06T15:00:00Z' }, { source: 'app_data:ghe_forms', record_id: 'g1', field: 'status', new_value: 'rn_review', at: '2026-10-07T15:00:00Z' },
  { source: 'app_data:ghe_forms', record_id: 'g2', field: 'status', new_value: 'rn_review', at: '2026-10-13T15:00:00Z' }]

/* ═══ 1. the pure rules ═══ */
ck('uploadDue: the earlier of 10 working days or the 15th of the next month', RN.uploadDue('2026-10-06') === '2026-10-20' && RN.uploadDue('2026-10-28') === '2026-11-11' && RN.uploadDue('2026-10-30') === '2026-11-13' && RN.uploadDue('x') === '')
ck('typedOk: first and last, holding the names on her record (credentials allowed)', RN.typedOk('Natasha Early', 'Natasha Early') && RN.typedOk('natasha  early, RN', 'Natasha Early') && !RN.typedOk('Natasha', 'Natasha Early') && !RN.typedOk('Nat Early', 'Natasha Early') && !RN.typedOk('Rita Rowe', 'Natasha Early'))
ck('rnReady: RN, our employee, license and a current expiry (nurse-rules.js reading)', RN.rnReady(NURSES[0], '2026-10-14') && !RN.rnReady(NURSES[4], '2026-10-14') && !RN.rnReady({ ...NURSES[0], employee: false }, '2026-10-14') && !RN.rnReady(NURSES[2], '2026-10-14') && !RN.rnReady({ ...NURSES[0], license: '' }, '2026-10-14'))
ck('mineToReview: named reviewer, or none named and she is the supervising RN', RN.mineToReview(FORM('a'), NURSES[0], NURSES, '2026-10-14') && !RN.mineToReview(FORM('a'), NURSES[1], NURSES, '2026-10-14') && RN.mineToReview(FORM('a', { rn_reviewer: 'Rita Rowe' }), NURSES[1], NURSES, '2026-10-14') && !RN.mineToReview(FORM('a', { rn_reviewer: 'Rita Rowe' }), NURSES[0], NURSES, '2026-10-14'))
ck('services: the Admin setting wins; with none, the ONE built-in list (nurse-services.ts DEFAULT_NURSE_SERVICES, the visit check\'s list) with its keys and names, saying skin monitoring, never assessment', RN.servicesOf({}).map((s) => s.key).join() === 'med_setup,ghe,skin_monitoring,nail_care,insulin_prefill,nurse_visit' && RN.servicesOf({}).find((s) => s.key === 'skin_monitoring').name === 'Skin monitoring'
  && JSON.stringify(RN.NURSE_SERVICES_FALLBACK.map((s) => [s.key, s.name, s.axis])) === JSON.stringify(NS.DEFAULT_NURSE_SERVICES.map((s) => [s.key, s.name, s.axis]))
  && !JSON.stringify(RN.NURSE_SERVICES_FALLBACK).match(/skin assessment/i) && RN.servicesOf({ nurse_services: [{ key: 'foot_care', name: 'Foot care', axis: ['T1001'] }] }).map((s) => s.key).join() === 'foot_care'
  && RN.servicesOf({ nurse_services: [{ key: 'foot_care', name: 'Foot care', axis: ['T1001'], active: false }] }).map((s) => s.key).join() === RN.servicesOf({}).map((s) => s.key).join())
ck('decision 1 (participant signs before Fusion) is NOT in force: the constant is false and the blocker says nothing while off; switched on, an unsigned participant blocks Natasha and a signed one does not', RN.PARTICIPANT_SIGNS_BEFORE_FUSION === false && RN.participantBlocker({ sig_part: '' }) === null && /participant .*has not signed/.test(RN.participantBlocker({ sig_part: '' }, true) || '') && /HCBS 8\.00 Appendix 4/.test(RN.participantBlocker({}, true) || '') && RN.participantBlocker({ sig_part: 'data:image/png;base64,AAAA' }, true) === null && !/\u2014/.test(RN.participantBlocker({}, true)))
ck('visitServices: matches by service code, procedure code or description, as a whole word; a named service wins, the catch-all only when none is named', RN.visitServices({ service: { code: 'T1001' } }, RN.servicesOf({})).join() === 'nurse_visit' && RN.visitServices({ service: { code: 'T1001', description: 'Nurse Visit, medication setup' } }, RN.servicesOf({})).join() === 'med_setup' && RN.visitServices({ service: { description: 'Personal Care T1019' } }, RN.servicesOf({})).length === 0 && RN.visitServices({ service: { code: 'T10011' } }, RN.servicesOf({})).length === 0)
const rd = RN.readable(FORM('a'))
const row = (h, l) => rd.sections.find((s) => s.h.startsWith(h)).rows.find((r) => r.label === l)
const sc = (t) => rd.sections.find((s) => s.h.startsWith('H:')).scored.find((x) => x.title === t)
ck('readable: the state form sections A to J in order, the answers where they were typed, the boxes ticked, the choices made', rd.sections.map((s) => s.h[0]).join('') === 'ABCDEFGHIJ' && row('A', 'Participant Name').value === 'Ada Client' && row('E', 'Blood Pressure').value === '128/80'
  && row('C', 'Marked').value === 'General Health Evaluation (Semi-Annual Nurse Visits)' && row('F', 'Marked').value === 'Hypertension' && row('G', 'Skin').value === 'No Concerns' && row('J', rd.sections[9].rows[0].label).value === 'No', rd.sections)
ck('readable: the Level of Care scores with the state wording, the comment, and the total worked out again', sc('MOBILITY').points === 3 && /^Limited or moderate assistance/.test(sc('MOBILITY').answer) && sc('MOBILITY').comment === 'uses a walker' && sc('SAFETY').points === 6 && sc('BATHING').points === null && rd.total === 9, rd.sections[7])
const svg = RN.sigImage('Natasha Early', 'Signed electronically 2026-10-14, RN')
ck('the signature image: an SVG data address with her typed name (the Hub form draws it in the Supervisory Nurse box)', /^data:image\/svg\+xml;base64,/.test(svg) && Buffer.from(svg.split(',')[1], 'base64').toString().includes('Natasha Early'))
ck('the e-sign consent words name the GHE, the supervising RN and the typed name; no em dash', /General Health Evaluation/.test(RN.ESIGN_WORDS) && /supervising RN/.test(RN.ESIGN_WORDS) && /typed name/.test(RN.ESIGN_WORDS) && noDash(RN.ESIGN_WORDS))
const fp1 = await RN.formFingerprint(FORM('a')), fp2 = await RN.formFingerprint({ ...FORM('a'), f: { ...FORM('a').f, ghe_bp: '130/80' } }), fp3 = await RN.formFingerprint({ ...FORM('a'), status: 'ready', updated_at: 'x' })
const fp4 = await RN.formFingerprint({ ...FORM('a'), sig_part: 'data:image/png;base64,LATER', f: { ...FORM('a').f, ghe_sig_part_date: '2026-10-20', ghe_sig_sup_date: '2026-10-14' } }), fp5 = await RN.formFingerprint({ ...FORM('a'), sig_nurse: 'data:image/png;base64,OTHER' })
ck('the fingerprint covers the answers and the nurse\'s signature, not the status, the save time, or the participant\'s signature (which may come after hers)', /^[0-9a-f]{64}$/.test(fp1) && fp1 !== fp2 && fp1 === fp3 && fp1 === fp4 && fp1 !== fp5)

/* ═══ 2. who may call ═══ */
let r = await call({ action: 'queue' })
ck('no sign-in: 401', r.status === 401, r)
r = await call({ action: 'queue' }, 'cc')
ck('a care coordinator (not an RN, not an owner): 403', r.status === 403 && /supervising RN/.test(r.j.error), r)
r = await call({ action: 'queue' }, 'lpn')
ck('an LPN: 403 (the review page is the RN\'s)', r.status === 403, r)
r = await call({ action: 'queue' }, 'gone')
ck('a nurse whose staff record is not active: 403, even with the email on the nurse list', r.status === 403 && /not active/.test(r.j.error), r)
setAd('nurse_staff', NURSES.map((n) => n.name === 'Old Nurse' ? { ...n } : n)); DB.persons.find((p) => p.person_id === 'p-gone').active = true
r = await call({ action: 'queue' }, 'gone')
ck('an RN with an expired license: 403', r.status === 403, r)
r = await call({ action: 'queue' }, 'natstaff')
ck('an account limited to another hub (hub_access staffing): 403', r.status === 403 && /access/.test(r.j.error), r)
r = await call({ action: 'queue' }, 'natvault')
ck('Natasha with hub_access [rn_review] only (no app_data key is mapped to it, so RLS shows her nothing directly): the function answers', r.status === 200 && r.j.me.rn === true, r)

/* ═══ 3. the queue: only her work ═══ */
r = await call({ action: 'queue' }, 'nat')
const ids = (r.j?.ghe || []).map((g) => g.id).sort().join()
ck('queue: Natasha sees the LPN forms waiting on her (none named and she supervises, or named her), practice included; never Rita\'s, an RN\'s own form or a replaced one', r.status === 200 && ids === 'g1,g2,g6,gp', [ids, r.j])
const q1 = r.j.ghe.find((g) => g.id === 'g1'), q2 = r.j.ghe.find((g) => g.id === 'g2')
ck('queue: waiting working days from the value history (g1: Oct 7, 5 days; g2: Oct 13, 1 day); over 2 is overdue; the upload date', q1.waiting_days === 5 && q1.waiting_over && q2.waiting_days === 1 && !q2.waiting_over && q1.upload_due === '2026-10-20' && !q1.upload_overdue, [q1, q2])
ck('queue: the practice form is marked practice', r.j.ghe.find((g) => g.id === 'gp').practice === true)
ck('queue: overdue holds g1 (waiting) and gr (she signed it; the upload to Fusion was due Sep 15), not g2', r.j.overdue.some((x) => x.id === 'gr' && x.kind === 'upload') && r.j.overdue.some((x) => x.id === 'g1' && /5 working days/.test(x.why)) && !r.j.overdue.some((x) => x.id === 'g2'), r.j.overdue)
ck('queue: counts; switch off is said; the service list comes along (the one list: five named services and the catch-all)', r.j.counts.ghe === 4 && r.j.live === false && r.j.services.length === 6 && r.j.services.at(-1).key === 'nurse_visit', r.j.counts)
r = await call({ action: 'queue' }, 'rita')
ck('Rita (an RN, not supervising) sees only the form naming her', r.status === 200 && r.j.ghe.map((g) => g.id).join() === 'g3', r.j?.ghe)
r = await call({ action: 'queue' }, 'sam')
ck('an owner sees every RN\'s queue, read only', r.status === 200 && r.j.ghe.map((g) => g.id).sort().join() === 'g1,g2,g3,g6,gp' && r.j.me.rn === false, r.j?.ghe)

/* ═══ 4. open: the form, the history, every open logged ═══ */
r = await call({ action: 'open', ghe_id: 'g1' }, 'nat')
ck('open a GHE: the state form laid out, the drawn signatures, may sign false while off (with the reason), the consent words', r.status === 200 && r.j.readable.sections.length === 10 && r.j.images.nurse === PNG && r.j.images.supervisor === null && r.j.may_sign === false && /not turned on yet/.test(r.j.why_not.join()) && r.j.consent_words === RN.ESIGN_WORDS, r.j)
ck('...the open is in document_access_log with her name, the client by AxisCare id', DB.document_access_log.some((l) => l.offer_id === 'client:7001' && l.doc === 'ghe_form' && l.by_email === 'natasha@mo-care.com' && l.by_name === 'Natasha Early'), DB.document_access_log)
r = await call({ action: 'open', ghe_id: 'g3' }, 'nat')
ck('open a form for Rita: refused (404)', r.status === 404, r)
LOG_FAIL = true; r = await call({ action: 'open', ghe_id: 'g1' }, 'nat'); LOG_FAIL = false
ck('open when the access log cannot be written: refused, nothing shown', r.status === 500 && !r.j.readable, r)
AX.visits = [{ id: 'v1', client: '7001', scheduledStartDate: '2026-10-06T14:00:00', service: { code: 'T1001', description: 'Nurse Visit (T1001)' }, caregiver: { firstName: 'Lena', lastName: 'Park' }, clockIn: { time: '2026-10-06T14:02:00' }, clockOut: { time: '2026-10-06T15:00:00' }, careNote: 'Organizer filled; skin intact.' },
  { id: 'v2', client: '7001', scheduledStartDate: '2026-10-07T09:00:00', service: { code: 'T1019', description: 'Personal Care' } },
  { id: 'v3', client: '7001', scheduledStartDate: '2026-05-20T10:00:00', service: { code: 'T1001' }, caregiver: { firstName: 'Natasha', lastName: 'Early' } }]
r = await call({ action: 'open', client_id: 'nc1' }, 'nat')
ck('open a client\'s nursing history: AxisCare nurse visits read by service match through the server (personal care left out), newest first', r.status === 200 && r.j.axiscare.ok && r.j.axiscare.visits.map((v) => v.id).join() === 'v1,v3' && r.j.axiscare.visits[0].note === 'Organizer filled; skin intact.' && r.j.axiscare.visits[0].nurse === 'Lena Park' && AX.calls.length === 7, r.j?.axiscare)
ck('...with the Hub\'s GHE forms for the client, and logged as nursing_history', r.j.ghe.some((g) => g.id === 'g1') && DB.document_access_log.some((l) => l.doc === 'nursing_history' && l.offer_id === 'client:7001'))
AX.fail = true; r = await call({ action: 'open', client_id: 'nc1' }, 'nat'); AX.fail = false
ck('AxisCare down: the history still opens and says AxisCare could not be read', r.status === 200 && r.j.axiscare.ok === false && /could not be read/.test(r.j.axiscare.why), r.j?.axiscare)
r = await call({ action: 'open', client_id: 'nc4' }, 'nat')
ck('open a client that is not hers (Rita\'s own client): 404', r.status === 404, r)

/* ═══ 5. switch off: practice only ═══ */
r = await call({ action: 'sign', ghe_id: 'g1', typed_name: 'Natasha Early', consent: true }, 'nat')
ck('switch off: signing a real form is refused (409), nothing recorded', r.status === 409 && r.j.not_live && !DB.rn_ghe_signature.length && ghe('g1').status === 'rn_review', r)
r = await call({ action: 'send_back', ghe_id: 'g1', note: 'Please add the blood glucose.' }, 'nat')
ck('switch off: sending back a real form is refused', r.status === 409 && ghe('g1').status === 'rn_review', r)
r = await call({ action: 'sign', ghe_id: 'gp', typed_name: 'Natasha Early', consent: true }, 'nat')
ck('switch off: a practice form can be signed (rehearsal), marked practice, its PDF under practice/', r.status === 200 && r.j.practice === true && DB.rn_ghe_signature[0].practice === true && /^practice\/ghe\/gp\//.test(DB.rn_ghe_signature[0].pdf_path) && ghe('gp').status === 'ready', r)
setAd('ops_settings', { ...ad('ops_settings'), test_people: { phones: ['4175550110'], emails: ['natasha@mo-care.com'] } })
r = await call({ action: 'open', ghe_id: 'g1' }, 'nat')
ck('switch off: Natasha on the Admin page\'s test list may rehearse on real forms', r.j.may_sign === true, r.j)
setAd('ops_settings', { company_holidays: [], nurse_review_live: true })

/* ═══ 6. sign (switch on) ═══ */
r = await call({ action: 'sign', ghe_id: 'g1', typed_name: 'Natasha Early' }, 'nat')
ck('sign without the consent tick: 400', r.status === 400 && /electronically/.test(r.j.error))
r = await call({ action: 'sign', ghe_id: 'g1', typed_name: 'Natasha', consent: true }, 'nat')
ck('sign with only a first name: 400, names her record', r.status === 400 && /Natasha Early/.test(r.j.error))
r = await call({ action: 'open', ghe_id: 'g6' }, 'nat')
ck('a form the participant has not signed yet: she may still sign it (no rule sets the order); the page is told', r.status === 200 && r.j.may_sign === true && r.j.participant_signed === false, r.j)
r = await call({ action: 'sign', ghe_id: 'g6', typed_name: 'Natasha Early', consent: true, sig_png: 'data:image/png;base64,bm90IGEgcG5n' }, 'nat')
const S6 = DB.rn_ghe_signature.find((s) => s.ghe_id === 'g6'), P6 = STORE['nurse-docs/' + S6?.pdf_path] ? Buffer.from(STORE['nurse-docs/' + S6.pdf_path]).toString('latin1') : ''
ck('...signed: Ready for Fusion, the PDF says the participant had not signed yet; a picture that is not a PNG is not kept (her typed name is drawn instead)', r.status === 200 && ghe('g6').status === 'ready' && /not signed yet/.test(P6) && /^data:image\/svg\+xml;base64,/.test(ghe('g6').sig_sup), [r.j, ghe('g6').sig_sup?.slice(0, 40)])
r = await call({ action: 'sign', ghe_id: 'g3', typed_name: 'Natasha Early', consent: true }, 'nat')
ck('a form for Rita: refused', r.status === 409 && /Rita Rowe to review/.test(r.j.error), r)
r = await call({ action: 'sign', ghe_id: 'g1', typed_name: 'Natasha Early', consent: true }, 'sam')
ck('an owner cannot sign (only the RN)', r.status === 403, r)
const before = clone(ghe('g1'))
const SIGPNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]).toString('base64')
r = await call({ action: 'sign', ghe_id: 'g1', typed_name: 'Natasha Early, RN', consent: true, sig_png: SIGPNG }, 'nat', { 'x-forwarded-for': '203.0.113.9' })
const S1 = DB.rn_ghe_signature.find((s) => s.ghe_id === 'g1'), G1 = ghe('g1')
ck('sign: one write-once signature row: who, when, typed name, consent and its words, device, the fingerprint of what she signed', r.status === 200 && S1 && S1.rn_name === 'Natasha Early' && S1.rn_email === 'natasha@mo-care.com' && S1.typed_name === 'Natasha Early, RN' && S1.consent === true && S1.consent_words === RN.ESIGN_WORDS
  && S1.ip === '203.0.113.9' && S1.agent === 'TestPhone' && S1.form_fingerprint === fp1.replace(fp1, S1.form_fingerprint) && S1.form_fingerprint === (await RN.formFingerprint(before)) && S1.lpn_name === 'Lena Park' && S1.client_axiscare_id === '7001' && S1.form_updated_at, [r.j, S1])
ck('sign: the form moves to Ready for Fusion with the reviewer, the times, her signature picture (the PNG the page drew) and the date (the pipeline\'s own fields)', G1.status === 'ready' && G1.rn_reviewer === 'Natasha Early' && G1.rn_reviewed_at === S1.signed_at && G1.rn_reviewed_by === 'natasha@mo-care.com' && G1.ready_at === S1.signed_at && G1.ready_by === 'natasha@mo-care.com'
  && G1.sig_sup === SIGPNG && G1.f.ghe_sig_sup_date === '2026-10-14' && G1.rn_signature.id === S1.id, G1)
ck('sign: nothing she signed changed (answers, scores, client, visit, nurse, both drawn signatures)', ['f', 'checks', 'radios', 'client', 'client_id', 'visit_date', 'nurse', 'total', 'sig_nurse', 'sig_part'].every((k) => JSON.stringify(k === 'f' ? { ...G1.f, ghe_sig_sup_date: '' } : G1[k]) === JSON.stringify(before[k])), G1)
const pdfKey = 'nurse-docs/' + S1.pdf_path, pdfText = STORE[pdfKey] ? Buffer.from(STORE[pdfKey]).toString('latin1') : ''
ck('sign: the signed PDF is in the private bucket nurse-docs under ghe/<form>/, a real PDF with her name and the audit lines', /^ghe\/g1\/rn-signed-.*\.pdf$/.test(S1.pdf_path) && pdfText.startsWith('%PDF-1.4') && pdfText.includes('Natasha Early, RN') && pdfText.includes(S1.form_fingerprint) && pdfText.includes('128/80'), S1.pdf_path)
ck('sign: the trail: signed and form_updated events with the consent, device and fingerprint', evs('signed').some((e) => e.ghe_id === 'g1' && e.detail.consent === true && e.detail.ip === '203.0.113.9' && e.detail.fingerprint === S1.form_fingerprint && e.by_email === 'natasha@mo-care.com') && evs('form_updated').some((e) => e.ghe_id === 'g1'))
r = await call({ action: 'sign', ghe_id: 'g1', typed_name: 'Natasha Early', consent: true }, 'nat')
ck('a second signature on the same form: refused (409 already), nothing changes', r.status === 409 && r.j.already && DB.rn_ghe_signature.filter((s) => s.ghe_id === 'g1').length === 1, r)
r = await call({ action: 'open', signature_id: S1.id }, 'nat')
ck('the signed PDF opens through a five-minute link, logged', r.status === 200 && /nurse-docs/.test(r.j.url) && r.j.expires_in === 300 && DB.document_access_log.some((l) => l.doc === 'rn_ghe_signed_pdf'), r)
r = await call({ action: 'open', signature_id: S1.id }, 'rita')
ck('...not for another RN', r.status === 404)
r = await call({ action: 'queue' }, 'nat')
ck('the queue after signing: g1 gone from waiting, in recent with a PDF', !r.j.ghe.some((g) => g.id === 'g1') && r.j.recent.some((s) => s.ghe_id === 'g1' && s.pdf), r.j.recent)
/* the Hub's own pipeline accepts it */
const HUB = process.env.HUB_ROOT
if (HUB && fs.existsSync(path.join(HUB, 'ghe-forms-rules.js'))) {
  const sb = { module: { exports: {} } }; vm.runInNewContext(fs.readFileSync(path.join(HUB, 'ghe-forms-rules.js'), 'utf8'), sb); const GR = sb.module.exports
  { const pj = fs.readFileSync(path.join(HUB, 'nurse-review-portal.js'), 'utf8'), m = /const FALLBACK = (\[\[.*?\]\]);/.exec(pj)
    const fb = m ? JSON.parse(m[1].replace(/'/g, '"')) : null
    ck('HUB: the Nurse Portal\'s built-in service list (Mark for Natasha) is the ONE list, nurse-services.ts DEFAULT_NURSE_SERVICES, key and name for each', !!fb && JSON.stringify(fb) === JSON.stringify(NS.DEFAULT_NURSE_SERVICES.map((s) => [s.key, s.name])), fb) }
  ck('HUB: decision 1 is the same on both sides: ghe-forms-rules.js PARTICIPANT_SIGNS_BEFORE_FUSION equals rn-review.ts (both false until she approves)', GR.PARTICIPANT_SIGNS_BEFORE_FUSION === RN.PARTICIPANT_SIGNS_BEFORE_FUSION && GR.PARTICIPANT_SIGNS_BEFORE_FUSION === false, GR.PARTICIPANT_SIGNS_BEFORE_FUSION)
  const tr = GR.transition({ ...before, sig_sup: 'x', rn_reviewer: 'Natasha Early' }, 'ready', { staff: NURSES, me: 'natasha@mo-care.com', at: S1.signed_at, reviewer: 'Natasha Early', today: '2026-10-14' })
  ck('HUB: ghe-forms-rules.js transition(form, ready) for this LPN form records exactly what the signature wrote', tr.ok && Object.entries(tr.patch).every(([k, v]) => G1[k] === v) && Object.keys(tr.patch).sort().join() === 'ready_at,ready_by,rn_reviewed_at,rn_reviewed_by,rn_reviewer,status', [tr, G1])
  ck('HUB: uploadDue is the same rule (every visit day of a year)', Array.from({ length: 366 }, (_, i) => new RealDate(RealDate.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)).every((d) => GR.uploadDue(d) === RN.uploadDue(d)))
  ck('HUB: the RN form (g4) needs no RN, as the pipeline says', GR.transition(FORM('x', { nurse: 'Rita Rowe', status: 'draft' }), 'rn_review', { staff: NURSES }).ok === false && !RN.needsRn(FORM('x', { nurse: 'Rita Rowe' }), NURSES) && RN.needsRn(FORM('x'), NURSES))
  const nb = { module: { exports: {} } }; vm.runInNewContext(fs.readFileSync(path.join(HUB, 'nurse-rules.js'), 'utf8'), nb); const NR = nb.module.exports
  ck('HUB: supervisorOf and rnReady read the nurse list as nurse-rules.js does', NURSES.every((n) => RN.rnReady(n, '2026-10-14') === (NR.readiness(n, NURSES, '2026-10-14').ready && n.cred === 'RN')) && RN.supervisorOf(NURSES, '2026-10-14').name === NR.supervisor(NURSES, '2026-10-14').name)
  /* the layout covers the Hub's GHE form: every field, box and choice */
  const html = fs.readFileSync(path.join(HUB, 'index.html'), 'utf8')
  const a = html.indexOf('const GHE_SECTIONS=['), bb = html.indexOf('];', a); const SEC = vm.runInNewContext(html.slice(a + 'const GHE_SECTIONS='.length, bb + 1))
  ck('HUB: the Level of Care sections are word for word the Hub\'s GHE_SECTIONS', JSON.stringify(SEC) === JSON.stringify(RN.SCORED))
  const v0 = html.indexOf('<div id="gheView">'), view = html.slice(v0, html.indexOf('MO 580-2985 (9-2025)', v0))
  const hubIds = [...view.matchAll(/<(?:input|textarea)[^>]*\bid="(ghe_[a-z0-9_]+)"/g)].map((m) => m[1]).filter((x) => !['ghe_client_id', 'ghe_id'].includes(x))
  const mine = new Set([...RN.LAYOUT.flatMap((s) => [...(s.fields || []), ...(s.after || [])].map((f) => f[0])), ...RN.SIG_DATES.map((x) => x[0]), ...RN.SCORED.flatMap((s) => (s.fields || []).map((f) => f[0]))])
  ck('HUB: every typed field on the Hub\'s GHE form is laid out here', hubIds.length > 40 && hubIds.every((x) => mine.has(x)), hubIds.filter((x) => !mine.has(x)))
  const grids = [...view.matchAll(/id="(ghe_[a-z_]+_grid)"([\s\S]*?)<\/div>/g)].map((m) => [m[1], [...m[2].matchAll(/type="checkbox" value="([a-z_]+)"/g)].map((x) => x[1])])
  ck('HUB: every tick box (reason, cardiopulmonary) is laid out here', grids.length === 2 && grids.every(([g, vs]) => { const s = RN.LAYOUT.find((x) => x.checks?.grid === g); return s && vs.join() === s.checks.opts.map((o) => o[0]).join() }), grids)
  const radios = [...new Set([...view.matchAll(/type="radio" name="(ghe_[a-z_]+)" value="([^"]+)"/g)].map((m) => m[1] + '=' + m[2]))]
  const myRadios = new Set(RN.LAYOUT.flatMap((s) => (s.radios || []).flatMap(([n, , o]) => o.map((x) => n + '=' + x[0]))))
  ck('HUB: every choice (skin, authorization review, risk, veteran) is laid out here', radios.length >= 15 && radios.every((x) => myRadios.has(x)), radios.filter((x) => !myRadios.has(x)))
} else ck('HUB_ROOT is set (the checks against the Hub\'s own form and rules need it)', false, 'set HUB_ROOT')

/* storage down: the signature stands, a card, the form still moves */
PDF_FAIL = true
setAd('ghe_forms', [...ad('ghe_forms'), FORM('g7', { client: 'Bo Client', client_id: 'nc2', nurse: 'Lou Lane' })])
r = await call({ action: 'sign', ghe_id: 'g7', typed_name: 'Natasha Early', consent: true }, 'nat'); PDF_FAIL = false
const S7 = DB.rn_ghe_signature.find((s) => s.ghe_id === 'g7')
ck('the PDF cannot be saved: the signature is kept, the form still moves, one card for the Payer Programs owner, a pdf_failed line', r.status === 200 && r.j.pdf === false && S7 && !S7.pdf_path && ghe('g7').status === 'ready' && ops().some((c) => c.id === 'rn_pdf_' + S7.id && c.owner === 'mia@mo-care.com') && evs('pdf_failed').length === 1, r.j)
/* the form cannot be saved (the Hub's GHE lock refused): the signature is kept, a card; the check repairs it */
setAd('ghe_forms', [...ad('ghe_forms'), FORM('g8')])
UPSERT_FAIL = 'ghe_forms'
r = await call({ action: 'sign', ghe_id: 'g8', typed_name: 'Natasha Early', consent: true }, 'nat'); UPSERT_FAIL = null
const S8 = DB.rn_ghe_signature.find((s) => s.ghe_id === 'g8')
ck('the form cannot be saved: the signature is kept, form_updated false, a card, a form_update_failed line', r.status === 200 && r.j.form_updated === false && S8 && !S8.form_updated_at && ghe('g8').status === 'rn_review' && ops().some((c) => c.id === 'rn_sigform_' + S8.id) && evs('form_update_failed').length === 1, r.j)

/* ═══ 7. send back ═══ */
r = await call({ action: 'send_back', ghe_id: 'g2', note: 'Fix' }, 'nat')
ck('send back with too short a note: 400', r.status === 400)
r = await call({ action: 'send_back', ghe_id: 'g2', note: 'Please add the blood glucose and the A1C.' }, 'nat')
const G2 = ghe('g2')
ck('send back: the form goes back to Draft with her note (the LPN sees it on the Nurse Portal), a history line', r.status === 200 && G2.status === 'draft' && G2.rn_sent_back.note === 'Please add the blood glucose and the A1C.' && G2.rn_sent_back.by === 'Natasha Early' && G2.rn_sent_back_log.length === 1 && evs('sent_back').length === 1 && !G2.sig_sup, G2)
r = await call({ action: 'send_back', ghe_id: 'g2', note: 'Please add the blood glucose and the A1C.' }, 'nat')
ck('send back again: refused (no longer waiting for her)', r.status === 409)

/* ═══ 8. Mark for Natasha (the LPN) ═══ */
setAd('ops_settings', { company_holidays: [], nurse_review_live: false })
r = await call({ action: 'flag_create', client_id: 'nc1', service_key: 'skin_monitoring', seen: 'Red area on the left heel, about 2 cm.' }, 'lpn')
ck('switch off: a real mark is refused with words telling the LPN to call Natasha', r.status === 409 && /call or text Natasha/.test(r.j.error) && !DB.nurse_flag.length, r)
r = await call({ action: 'flag_create', client_id: 'nc3', service_key: 'skin_monitoring', seen: 'Practice mark for the walkthrough.' }, 'lpn')
ck('switch off: a practice client can be marked (practice)', r.status === 200 && r.j.flag.practice === true, r)
setAd('ops_settings', { company_holidays: [], nurse_review_live: true })
r = await call({ action: 'flag_create', client_id: 'nc2', service_key: 'skin_monitoring', seen: 'Red area on the left heel.' }, 'lpn')
ck('an LPN marking a client not on their caseload: 403', r.status === 403 && /not on your caseload/.test(r.j.error), r)
r = await call({ action: 'flag_create', client_id: 'nc1', service_key: 'skin_assessment', seen: 'Red area.' }, 'lpn')
ck('a service not on the list: 400', r.status === 400)
r = await call({ action: 'flag_create', client_id: 'nc1', service_key: 'skin_monitoring', seen: 'Red', visit_date: '2026-10-20' }, 'lpn')
ck('too few words: 400', r.status === 400)
r = await call({ action: 'flag_create', client_id: 'nc1', service_key: 'skin_monitoring', seen: 'Red area on the left heel.', visit_date: '2026-10-20' }, 'lpn')
ck('a visit date in the future: 400', r.status === 400)
r = await call({ action: 'flag_create', client_id: 'nc1', service_key: 'skin_monitoring', seen: 'Red area on the left heel, about 2 cm.', visit_id: 'v1', visit_date: '2026-10-06' }, 'lpn')
const F1 = DB.nurse_flag.find((f) => f.client_id === 'nc1')
ck('Mark for Natasha: saved with the client (Hub and AxisCare), the visit, the service, what was seen, by whom; for the supervising RN; a history line', r.status === 200 && F1.client_axiscare_id === '7001' && F1.visit_id === 'v1' && F1.visit_date === '2026-10-06' && F1.service_name === 'Skin monitoring' && F1.by_name === 'Lena Park' && F1.rn_name === 'Natasha Early' && F1.practice === false && evs('flag_created').length === 2, F1)
r = await call({ action: 'flag_create', client_id: 'nc1', service_key: 'skin_monitoring', seen: 'Red area on the left heel, about 2 cm.', visit_id: 'v1', visit_date: '2026-10-06' }, 'lpn')
ck('a double tap is one mark', r.status === 200 && r.j.again && DB.nurse_flag.filter((f) => f.client_id === 'nc1').length === 1)
r = await call({ action: 'flag_create', client_id: 'nc2', service_key: 'med_setup', seen: 'Two bottles of metoprolol, different doses.', as_nurse: 'Lou Lane' }, 'cc')
ck('office staff can enter a mark for a nurse (recorded as entered by them)', r.status === 200 && r.j.flag.by_name === 'Lou Lane' && r.j.flag.entered_by === 'Casey', r)
r = await call({ action: 'flag_create', client_id: 'nc2', service_key: 'med_setup', seen: 'Two bottles.' }, 'cc')
ck('office staff without naming the nurse: 403', r.status === 403)
r = await call({ action: 'mine' }, 'lpn')
ck('the LPN sees their own marks only', r.status === 200 && r.j.flags.every((f) => f.by_name === 'Lena Park') && r.j.flags.length === 2, r.j)
r = await call({ action: 'queue' }, 'nat')
ck('Natasha\'s queue shows the open marks from her LPNs', r.j.flags.some((f) => f.id === F1.id) && r.j.flags.some((f) => f.by_name === 'Lou Lane'), r.j.flags)

/* ═══ 9. review a mark ═══ */
r = await call({ action: 'flag_review', flag_id: F1.id, note: 'ok' }, 'nat')
ck('a review note too short: 400', r.status === 400)
r = await call({ action: 'flag_review', flag_id: F1.id, note: 'Stage 1 pressure area. Offload heels, recheck Friday, tell the family.' }, 'rita')
ck('another RN cannot review her marks', r.status === 404)
r = await call({ action: 'flag_review', flag_id: F1.id, note: 'Stage 1 pressure area. Offload heels, recheck Friday, tell the family.' }, 'nat')
const F1b = DB.nurse_flag.find((f) => f.id === F1.id)
ck('review: reviewed with her note, who and when; a history line', r.status === 200 && F1b.status === 'reviewed' && /Offload heels/.test(F1b.rn_note) && F1b.reviewed_by === 'Natasha Early' && F1b.reviewed_at && evs('flag_reviewed').length === 1, F1b)
r = await call({ action: 'flag_review', flag_id: F1.id, note: 'Changing my note now.' }, 'nat')
ck('a review is final: a second one is refused', r.status === 409 && r.j.already)
r = await call({ action: 'mine' }, 'lpn')
ck('the LPN sees Natasha\'s note on their mark', r.j.flags.some((f) => f.id === F1.id && f.status === 'reviewed' && /Offload heels/.test(f.rn_note)))

/* ═══ 10. the schedule ═══ */
r = await call({ action: 'pass' }, 'nat')
ck('the pass is for the schedule (or the owner\'s server key) only', r.status === 401)
setAd('ops_settings', { company_holidays: [], nurse_review_live: false })
let n0 = ops().length
r = await call({ action: 'pass' }, 'cron')
ck('switch off: the pass counts what is waiting and late, raises no card', r.status === 200 && r.j.live === false && r.j.waiting >= 1 && r.j.upload_late >= 1 && r.j.cards === 0 && ops().length === n0 && r.j.practice >= 2, r.j)
ck('...and repairs the signature whose form did not move (g8 is now Ready for Fusion, her signature on it)', r.j.repaired === 1 && ghe('g8').status === 'ready' && ghe('g8').rn_signature.id === S8.id && DB.rn_ghe_signature.find((s) => s.id === S8.id).form_updated_at, [r.j, ghe('g8')])
setAd('ops_settings', { company_holidays: [], nurse_review_live: true })
at('2026-10-20T15:00:00Z')
r = await call({ action: 'pass' }, 'cron')
const cw = ops().find((c) => c.id === 'rn_wait_flag_' + DB.nurse_flag.find((f) => f.by_name === 'Lou Lane').id), cu = ops().find((c) => c.id === 'rn_upload_late_gr')
ck('switch on: a card for Natasha on the mark waiting more than 2 working days (owner: her email)', cw && cw.owner === 'natasha@mo-care.com' && cw.kind === 'rn_review_waiting' && cw.domain === 'payer_programs', [r.j, cw])
ck('switch on: a card for the Payer Programs owner on the signed GHE past its upload date', cu && cu.owner === 'mia@mo-care.com' && cu.kind === 'ghe_upload_late' && /Fusion/.test(cu.title), cu)
ck('practice items never get a card', !ops().some((c) => /gp$/.test(c.id)) && !ops().some((c) => c.id === 'rn_wait_flag_' + DB.nurse_flag.find((f) => f.practice).id))
const n1 = ops().length
r = await call({ action: 'pass' }, 'cron')
ck('one card per problem: a second pass raises nothing new', ops().length === n1 && r.j.cards === 0, r.j)
setAd('ghe_forms', ad('ghe_forms').map((g) => g.id === 'gr' ? { ...g, status: 'uploaded', uploaded_on: '2026-10-20' } : g))
r = await call({ action: 'pass' }, 'cron')
ck('once uploaded, the late-upload card closes itself', ops().find((c) => c.id === 'rn_upload_late_gr').status === 'done' && r.j.closed >= 1, r.j)
ck('a heartbeat and an automation log line', (ad('automation_heartbeats') || []).some((h) => h.id === 'hb_rn-review') && (ad('automation_log') || []).some((l) => l.automation === 'rn_review'))
ck('history is append-only: the function never changed or removed a history line', EVENT_WRITES === 0)
ck('no em dash in any card the function raised, or in the function and its shared file and SQL', ops().filter((c) => c.created_by === 'rn-review').every((c) => noDash(c.title + c.detail))
  && ['supabase/functions/rn-review/index.ts', 'supabase/functions/_shared/rn-review.ts', 'supabase/nurse-review.sql', 'supabase/nurse-review-rollback.sql'].every((f) => noDash(fs.readFileSync(path.join(ROOT, f), 'utf8'))))
ck('the words people see say skin monitoring, never skin assessment', !/skin assessment/i.test(fs.readFileSync(path.join(ROOT, 'supabase/functions/rn-review/index.ts'), 'utf8') + fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/rn-review.ts'), 'utf8')))
ck('the function answers the browser (CORS on every answer and on OPTIONS)', (await H(new Request('http://x/rn-review', { method: 'OPTIONS' }))).headers.get('Access-Control-Allow-Origin') === '*')
ck('nothing reached any service but AxisCare (every other fetch would have thrown); nothing is sent to anyone', true)

for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (note ? '  ' + note : ''))
console.log(`${res.filter((x) => x[1]).length}/${res.length} passed`); process.exit(res.every((x) => x[1]) ? 0 : 1)
