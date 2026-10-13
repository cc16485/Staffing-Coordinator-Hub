// HEPATITIS B VACCINATION (2026-10-13, OSHA 1910.1030): the hepb function and _shared/hepb.ts, run for real against a fake
// database, a fake private bucket, a fake GoHighLevel, a fake job offers project and a settable clock. Nothing real is
// touched; no network.  node hepb_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const SECRET = 'j'.repeat(48)
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 's'.repeat(40), HUB_JOB_SECRET: SECRET, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'L', OFFERS_PROJECT_URL: 'http://offers', OFFERS_SERVICE_ROLE_KEY: 'o'.repeat(40) }
/* the clock: Tuesday 2026-10-13, 10am Chicago (CDT) */
const RealDate = Date; let NOW = RealDate.parse('2026-10-13T15:00:00Z')
class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOW) } static now() { return NOW } }
globalThis.Date = FakeDate; const at = (iso) => { NOW = RealDate.parse(iso) }
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
const OA = '11111111-2222-4333-8444-555555555551', OB = '11111111-2222-4333-8444-555555555552', OC = '11111111-2222-4333-8444-555555555553', OP = '11111111-2222-4333-8444-555555555554', OD = '11111111-2222-4333-8444-555555555555'
const OFFER_POS = { [OA]: 'Caregiver', [OB]: 'Office', [OP]: 'Caregiver', [OD]: 'Caregiver' }   // OC: the offers project fails
const GHL = { messages: [], fail: false }; const OFFER_CALLS = []
globalThis.fetch = async (url, o = {}) => { const u = String(url), m = (o.method || 'GET').toUpperCase()
  if (u.startsWith('http://offers/rest/v1/job_offers?id=eq.')) { const id = decodeURIComponent(u.split('id=eq.')[1].split('&')[0]); OFFER_CALLS.push({ id, m }); if (m !== 'GET') throw new Error('the offers project is read only here'); if (!OFFER_POS[id]) return new Response('{}', { status: 500 }); return new Response(JSON.stringify([{ id, position: OFFER_POS[id] }]), { status: 200 }) }
  if (u.startsWith('https://services.leadconnectorhq.com/contacts/search/duplicate')) return new Response(JSON.stringify({ contacts: [] }), { status: 200 })
  if (u === 'https://services.leadconnectorhq.com/contacts/upsert') { const b = JSON.parse(o.body); return new Response(JSON.stringify({ contact: { id: 'c-' + (b.phone || b.email), phone: b.phone, email: b.email } }), { status: 200 }) }
  if (u.startsWith('https://services.leadconnectorhq.com/contacts/c-')) { const id = decodeURIComponent(u.split('/contacts/')[1]); const a = id.slice(2); return new Response(JSON.stringify({ contact: { id, ...(a.includes('@') ? { email: a } : { phone: a }) } }), { status: 200 }) }
  if (u === 'https://services.leadconnectorhq.com/conversations/messages') { if (GHL.fail) return new Response('{"message":"down"}', { status: 500 }); GHL.messages.push(JSON.parse(o.body)); return new Response('{}', { status: 200 }) }
  throw new Error('unexpected fetch ' + m + ' ' + u) }

/* ── the fake database ── */
let DB = {}, EVENT_WRITES = 0, LOG_FAIL = false
DB = { hepb_record: [], hepb_event: [], hepb_document: [], app_data: [], auth_identities: [], persons: [], entity_memberships: [], staff_roles: [], document_access_log: [],
  client_journey: [], client_journey_step: [], client_journey_event: [], domains: [], job_applicants: [], contact_optout_current: [], circle_contacts: [], identity_door_audit: [] }
let seq = 0
const uuid = () => { const h = (++seq).toString(16).padStart(12, '0'); return `aaaaaaaa-bbbb-4ccc-8ddd-${h}` }
const clone = (x) => JSON.parse(JSON.stringify(x))
function guardUpdate(name, r, p) {
  if (name === 'hepb_event') { EVENT_WRITES++; throw new Error('Hepatitis B history is append-only') }
  if (name === 'hepb_document') throw new Error('an uploaded document is never changed')
  if (name === 'hepb_record') {
    if ('offer_id' in p && r.offer_id && p.offer_id !== r.offer_id) throw new Error('the offer never changes')
    if ('caregiver_id' in p && r.caregiver_id && p.caregiver_id !== r.caregiver_id) throw new Error('the caregiver never changes')
    if (r.declined_at && ['declined_at', 'declination_pdf', 'declination_fingerprint', 'declination_typed_name'].some((k) => k in p && p[k] !== r[k])) throw new Error('a signed declination is never changed')
    if (p.status && !['not_required', 'pending', 'vaccine', 'complete', 'prior_series', 'immune', 'contraindicated', 'declined'].includes(p.status)) throw new Error('check status')
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
        if (name === 'hepb_record') { if (r.offer_id && rows().some((x) => x.offer_id === r.offer_id)) throw new Error('duplicate offer_id'); if (r.caregiver_id && rows().some((x) => x.caregiver_id === r.caregiver_id)) throw new Error('duplicate caregiver_id'); if (!r.offer_id && !r.caregiver_id) throw new Error('hepb_record_someone')
          if (typeof r.exposed !== 'boolean') throw new Error('exposed not null')
          Object.assign(r, { id: r.id || uuid(), reminders: r.reminders || {}, doses: r.doses || [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }
        if (name === 'hepb_document') { if (rows().some((x) => x.hepb_id === r.hepb_id && x.path === r.path)) throw new Error('duplicate path'); r.id = r.id || uuid() }
        if (name === 'hepb_event') { r.id = ++seq; r.at = new Date(NOW + seq).toISOString() }
        if (name === 'document_access_log' && LOG_FAIL) throw new Error('log down')
        if (name === 'client_journey_event') { r.id = ++seq; r.at = new Date().toISOString() }
        rows().push(r); return [clone(r)] }
      if (mode === 'upsert') { const i = rows().findIndex((x) => x.journey_id === payload.journey_id && x.step_key === payload.step_key); if (i >= 0) rows()[i] = { ...rows()[i], ...payload }; else rows().push({ ...payload }); return [clone(payload)] }
      if (mode === 'update') { const out = []; for (const r of rows()) if (match(r)) { guardUpdate(name, r, payload); Object.assign(r, payload); out.push(clone(r)) } return out }
    }
    return {
      eq: (k, v) => q(mode, payload, [...filters, (r) => String(r[k]) === String(v)], opts), neq: (k, v) => q(mode, payload, [...filters, (r) => String(r[k]) !== String(v)], opts),
      in: (k, vs) => q(mode, payload, [...filters, (r) => vs.map(String).includes(String(r[k]))], opts),
      is: (k, v) => q(mode, payload, [...filters, (r) => (v === null ? r[k] == null : r[k] === v)], opts),
      not: (k, op, v) => q(mode, payload, [...filters, (r) => op === 'is' ? (r[k] ?? null) !== v : true], opts),
      ilike: (k, v) => q(mode, payload, [...filters, (r) => String(r[k] ?? '').toLowerCase().includes(String(v).replace(/%/g, '').toLowerCase())], opts),
      order: (k, o2) => q(mode, payload, filters, { ...opts, order: k, asc: o2?.ascending }), limit: (n) => q(mode, payload, filters, { ...opts, limit: n }),
      select: (_c, o2) => q(mode, payload, filters, { ...opts, head: !!o2?.head }),
      maybeSingle: async () => { try { return { data: run()[0] ?? null, error: null } } catch (e) { return { data: null, error: { message: e.message } } } },
      then: (ok) => { try { return Promise.resolve(ok({ data: run(), error: null })) } catch (e) { return Promise.resolve(ok({ data: null, error: { message: e.message } })) } },
    }
  }
  return { select: (c, o2) => q('select', null, [], { head: !!o2?.head }), insert: (p) => q('insert', p), upsert: (p) => q('upsert', p), update: (p) => q('update', p), delete: () => { EVENT_WRITES += name === 'hepb_event' ? 1 : 0; throw new Error('never deleted') } }
}
const ad = (k) => DB.app_data.find((x) => x.key === k)?.data
const setAd = (k, v) => { const r = DB.app_data.find((x) => x.key === k); if (r) r.data = v; else DB.app_data.push({ key: k, data: v }) }
async function rpc(name, a) {
  if (name === 'upsert_app_data_item') { let row = DB.app_data.find((x) => x.key === a.target_key); if (!row) { row = { key: a.target_key, data: [] }; DB.app_data.push(row) } const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = a.item; else row.data.push(a.item); return { data: null, error: null } }
  if (name === 'contact_send_refusal_log') return { data: null, error: null }
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
const TMP = path.join(ROOT, '.hepb_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(FN, TMP, { recursive: true })
for (const p of fs.readdirSync(TMP, { recursive: true })) { const f = path.join(TMP, String(p)); if (!f.endsWith('.ts')) continue; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient').replace(/^import .* from 'https:[^']*'$/mg, '')) }
let HB, LINKS, OR, SP
try { await import(path.join(TMP, 'hepb', 'index.ts')); HB = await import(path.join(TMP, '_shared', 'hepb.ts')); LINKS = await import(path.join(TMP, '_shared', 'applicant-links.ts')); OR = await import(path.join(TMP, '_shared', 'outreach.ts')); SP = fs.readFileSync(path.join(TMP, '_shared', 'send-problems.ts'), 'utf8') } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const H = handler
const call = async (body, tok, extra = {}) => { const r = await H(new Request('http://x/hepb', { method: 'POST', headers: { 'Content-Type': 'application/json', 'user-agent': 'TestPhone', 'x-forwarded-for': '203.0.113.9', ...(tok ? (tok === 'cron' ? { 'x-cron-secret': SECRET } : { Authorization: 'Bearer ' + tok }) : {}), ...extra }, body: JSON.stringify(body) })); let j = null; try { j = await r.json() } catch {} return { status: r.status, j } }
const linkOf = async (id) => { const u = new URL(await LINKS.makeHepbLink(SECRET, id)); return { h: u.searchParams.get('h'), e: u.searchParams.get('e'), t: u.searchParams.get('t') } }
const asCg = async (id, body) => call({ ...body, ...(await linkOf(id)) })
const ops = () => ad('ops_items') || []
const card = (id) => ops().find((c) => c.id === id)
const evs = (id, kind) => DB.hepb_event.filter((e) => e.hepb_id === id && (!kind || e.kind === kind))
const rec = (pred) => DB.hepb_record.find(pred)
const stepOf = (oid) => { const j = DB.client_journey.find((x) => x.offer_id === oid); return j && DB.client_journey_step.find((s) => s.journey_id === j.journey_id && s.step_key === 'cg.health.hepb') }
const noDash = (s) => !/—/.test(String(s))
const set = (k, v) => { const s = ad('ops_settings'); s[k] = v }

/* ── people ── */
DB.auth_identities = [['u-sam', 'p-sam'], ['u-kry', 'p-kry'], ['u-cc', 'p-cc'], ['u-no', 'p-no']].map(([a, p]) => ({ auth_user_id: a, person_id: p, project_ref: 'zngsgedlsxinbygwmxwn' }))
DB.persons = [['p-sam', 'Samantha Troutman', 'sam@mo-care.com'], ['p-kry', 'Krystal', 'krystal@mo-care.com'], ['p-cc', 'Casey', 'casey@mo-care.com'], ['p-no', 'Nora', 'no@mo-care.com']].map(([p, n, e]) => ({ person_id: p, full_name: n, primary_email: e, active: true }))
DB.entity_memberships = ['p-sam', 'p-kry', 'p-cc', 'p-no'].map((p) => ({ person_id: p, entity: 'cc_ihs', active: true, ended_at: null }))
DB.staff_roles = [{ person_id: 'p-sam', entity: 'cc_ihs', role: 'owner_admin' }, { person_id: 'p-kry', entity: 'cc_ihs', role: 'staffing_coordinator' }, { person_id: 'p-cc', entity: 'cc_ihs', role: 'care_coordinator' }]
DB.domains = [{ entity: 'cc_ihs', code: 'caregivers', owner_person: 'p-kry' }]
setAd('ops_settings', { staffing_email: 'krystal@mo-care.com', company_holidays: [] })
setAd('caregivers', [
  { id: 201, first: 'Ava', last: 'Lee', phone: '4175550101', email: 'ava@x.com', offer_id: OA, axiscare_id: '9001', approved_to_work_at: '2026-10-09T16:00:00Z', first_contact: '2026-10-13' },
  { id: 202, first: 'Ben', last: 'Ray', phone: '4175550102', email: 'ben@x.com', offer_id: OB, approved_to_work_at: '2026-10-09T16:00:00Z' },
  { id: 203, first: 'Cy', last: 'Lo', phone: '4175550103', email: 'cy@x.com', offer_id: OC, approved_to_work_at: '2026-10-12T16:00:00Z' },
  { id: 204, first: 'Pat', last: 'Practice', phone: '(417) 555-0181', email: 'pat@practice.invalid', offer_id: OP, approved_to_work_at: '2026-10-09T16:00:00Z' },
  { id: 205, first: 'Dee', last: 'Waiting', phone: '4175550105', email: 'dee@x.com', offer_id: OD },                          // not Approved to Work yet
  { id: 206, first: 'Gone', last: 'Away', phone: '4175550106', offer_id: '11111111-2222-4333-8444-555555555556', approved_to_work_at: '2026-10-01T16:00:00Z', active: false },
  { id: 207, first: 'Old', last: 'Hand', phone: '4175550107', email: 'old@x.com', axiscare_id: '9007', first_contact: '2026-09-01', position: 'CNA' },   // existing caregiver, no offer
  { id: 208, first: 'Ola', last: 'Office', phone: '4175550108', email: 'ola@x.com' } ])
for (const [oid, nm] of [[OA, 'Ava Lee'], [OB, 'Ben Ray'], [OC, 'Cy Lo'], [OP, 'Pat Practice']]) DB.client_journey.push({ journey_id: 'j-' + oid.slice(-1), subject: 'caregiver', offer_id: oid, status: 'open', client_name: nm })

/* ═══ 1. the pure rules ═══ */
const ST0 = {}
const E = (p, st = ST0) => HB.exposureFor(p, st)
ck('exposure: Caregiver, CNA, PRN CNA Team, LPN, RN reasonably anticipated (all employees)', ['Caregiver', 'CNA', 'PRN CNA Team', 'LPN', 'RN'].every((p) => E(p).exposed && E(p).scope === 'all' && !E(p).fallback))
ck('exposure: Companion / Homemaker and Office not; Care Coordinator yes for some employees with the tasks named', !E('Companion / Homemaker').exposed && !E('Office').exposed && E('Care Coordinator').exposed && E('Care Coordinator').scope === 'some' && E('Care Coordinator').tasks.length >= 2)
ck('exposure: names match loosely (case, "CNA (current license)", "Homemaker", "office staff")', E('caregiver').matched === 'Caregiver' && E('CNA (current license)').matched === 'CNA' && E('Homemaker').matched === 'Companion / Homemaker' && E('office staff').matched === 'Office')
ck('exposure: an unknown or empty position counts as Caregiver (the fallback), marked as a fallback', E('Night Owl').matched === 'Caregiver' && E('Night Owl').fallback && E('').exposed && E(null).fallback)
ck('exposure: decided without regard to gloves (the reason says so) and every exposed row lists its tasks', /without regard to gloves/.test(E('Caregiver').why) && HB.DEFAULT_EXPOSURE.filter((r) => r.exposed).every((r) => r.tasks.length))
const OV = { hepb_exposure: { Office: { exposed: true, note: 'Ola covers shifts' }, Caregiver: { exposed: false }, 'Live Scheduler': { exposed: true, tasks: ['covers shifts'] }, CNA: { exposed: 'yes' }, '': { exposed: true } } }
ck('exposure: the Admin override wins (Office on, Caregiver off), adds a new position, ignores a malformed one', E('Office', OV).exposed && E('Office', OV).source === 'admin' && E('Office', OV).why === 'Ola covers shifts' && !E('Caregiver', OV).exposed && E('Live Scheduler', OV).exposed && !E('Live Scheduler', OV).fallback && E('CNA', OV).source === 'default' && E('CNA', OV).exposed)
ck('exposure: with Caregiver overridden off, an unknown position follows the fallback row (off)', !E('Night Owl', OV).exposed)
const APPX = 'I understand that due to my occupational exposure to blood or other potentially infectious materials I may be at risk of acquiring hepatitis B virus (HBV) infection. I have been given the opportunity to be vaccinated with hepatitis B vaccine, at no charge to myself. However, I decline hepatitis B vaccination at this time. I understand that by declining this vaccine, I continue to be at risk of acquiring hepatitis B, a serious disease. If in the future I continue to have occupational exposure to blood or other potentially infectious materials and I want to be vaccinated with hepatitis B vaccine, I can receive the vaccination series at no charge to me.'
ck('declination: the statement is Appendix A to 1910.1030 character for character (an independent copy)', HB.APPENDIX_A === APPX && HB.DECLINATION.statement === APPX)
const FP = await HB.declinationFingerprint()
ck('declination: a 64-hex wording fingerprint, stable, and it changes if one character of the statement changes', /^[0-9a-f]{64}$/.test(FP) && FP === await HB.declinationFingerprint() && HB.declinationText().includes('statement|' + APPX))
ck('declination: the words around it neither discourage the vaccine nor add liability; they say it can be chosen later at no cost; no em dash', HB.DECLINATION.intro.some((p) => /change your mind/.test(p) && /no cost/.test(p)) && !/liab|waive|release|hold harmless/i.test(HB.DECLINATION.intro.join(' ')) && noDash(HB.DECLINATION.intro.join(' ') + HB.DECLINATION.title))
ck('deadline: 10 working days after initial assignment (Tue Oct 13 -> Tue Oct 27; a company holiday pushes it a day; Friday start skips weekends)', HB.dueFrom('2026-10-13', []) === '2026-10-27' && HB.dueFrom('2026-10-13', [{ date: '2026-10-19' }]) === '2026-10-28' && HB.dueFrom('2026-10-16', []) === '2026-10-30' && HB.dueFrom(null, []) === null)
ck('initial assignment: the first client visit, else Approve to Work (Central date), else unknown', JSON.stringify(HB.assignmentFrom({ first_contact: '2026-10-14', approved_to_work_at: '2026-10-09T16:00:00Z' })) === '{"date":"2026-10-14","source":"first_contact"}' && HB.assignmentFrom({ approved_to_work_at: '2026-10-10T03:00:00Z' }).date === '2026-10-09' && HB.assignmentFrom({}).date === null)
const PS = (r) => HB.publicStatus(r)
ck('status words for the office: offered / accepted / declined / complete; an exception never says which', PS({ status: 'pending' }) === 'Not offered yet' && PS({ status: 'pending', offered_at: 'x' }) === 'Offered' && PS({ status: 'vaccine' }) === 'Accepted' && PS({ status: 'declined' }) === 'Declined' && PS({ status: 'complete' }) === 'Complete'
  && ['prior_series', 'immune', 'contraindicated'].every((s) => PS({ status: s }) === 'Answered, the office is checking' && PS({ status: s, verified_at: 'x' }) === 'Complete') && PS(null) === 'Not set up yet' && PS({ status: 'not_required' }) === 'Not required for this position')
ck('a declining employee may choose the vaccine later; nothing else after declining; nothing once checked or a dose recorded', HB.mayChoose({ status: 'declined' }, 'vaccine').ok && !HB.mayChoose({ status: 'declined' }, 'immune').ok && !HB.mayChoose({ status: 'immune', verified_at: 'x' }, 'vaccine').ok && !HB.mayChoose({ status: 'vaccine', doses: [{ n: 1 }] }, 'immune').ok && HB.mayChoose({ status: 'vaccine', doses: [] }, 'immune').ok && !HB.mayChoose({ status: 'complete' }, 'vaccine').ok)
const MSG = HB.offerMessage('Ava', 'LINK')
ck('the offer words: the link, no cost, her choice, the phone; no em dash; never pay', /LINK/.test(MSG.text) && /no cost/.test(MSG.text) && /choice/.test(MSG.text) && /234-8494/.test(MSG.text) && noDash(MSG.text + MSG.html + MSG.subject) && !/\bpay\b/i.test(MSG.text + MSG.html))
const L1 = await LINKS.makeHepbLink(SECRET, OA), u1 = new URL(L1)
ck('link: https://cc.mo-care.com/hepb.html with h, e and t only; 21 days; checks back; another kind does not', u1.origin + u1.pathname === 'https://cc.mo-care.com/hepb.html' && [...u1.searchParams.keys()].join() === 'h,e,t' && Number(u1.searchParams.get('e')) - Math.floor(NOW / 1000) === 21 * 86400 && await LINKS.checkLink(SECRET, 'hepb', OA, u1.searchParams.get('e'), u1.searchParams.get('t')) && !(await LINKS.checkLink(SECRET, 'driver', OA, u1.searchParams.get('e'), u1.searchParams.get('t'))) && !LINKS.okId('hepb', '123'))
ck('the sender is registered (outreach SENDER_REGISTER, scheduled) and the send-problem words know it', OR.SENDER_REGISTER.hepb?.scheduled === true && OR.SENDER_REGISTER.hepb.class === 'routine_internal' && /'hepb': \['hepatitis B vaccine offer link', 'caregivers'\]/.test(SP))

/* ═══ 2. the pass: new-path hires set up at Approve to Work, nothing sent while the switch is off ═══ */
let r = await call({ action: 'pass' })
ck('the pass is for the schedule only', r.status === 401)
r = await call({ action: 'pass' }, 'cron')
const A = rec((x) => x.offer_id === OA), B = rec((x) => x.offer_id === OB), C = rec((x) => x.offer_id === OC), P = rec((x) => x.offer_id === OP)
ck('pass: four new-path hires set up (Approve to Work stamped, active); the one not yet approved and the inactive one are not', r.j.created === 4 && A && B && C && P && !rec((x) => x.offer_id === OD) && !rec((x) => x.caregiver_id === '206'), r.j)
ck('pass: Ava, Caregiver from her offer: pending, assignment = first client visit, due 10 working days later', A.position === 'Caregiver' && A.position_source === 'offer' && A.exposed && A.status === 'pending' && A.assignment_date === '2026-10-13' && A.assignment_source === 'first_contact' && A.due_date === '2026-10-27', A)
ck('pass: Ben, Office: not required; the readiness row is not needed', B.status === 'not_required' && !B.exposed && stepOf(OB)?.state === 'not_needed', [B, stepOf(OB)])
ck('pass: Cy, the offers project did not answer: the fallback Caregiver (exposed), assignment = Approve to Work', C.position === 'Caregiver' && C.position_source === 'fallback' && C.exposed && C.exposure_basis.fallback === true && C.assignment_source === 'approved_to_work' && C.assignment_date === '2026-10-12', C)
ck('pass: the offers project is only read (GET), never written', OFFER_CALLS.length >= 4 && OFFER_CALLS.every((c) => c.m === 'GET'))
ck('pass: training not confirmed: one card per person to the Caregivers owner, nothing sent, nothing offered', card('hepb_training_' + A.id)?.owner === 'krystal@mo-care.com' && /bloodborne pathogens training/.test(card('hepb_training_' + A.id).title) && GHL.messages.length === 0 && !A.offered_at)
ck('pass: the readiness row for Ava is open with only the status words', stepOf(OA)?.state === 'open' && JSON.stringify(stepOf(OA).evidence) === JSON.stringify({ hepb_id: A.id, status: 'Not offered yet', due: '2026-10-27' }), stepOf(OA))
const nCards = ops().length; await call({ action: 'pass' }, 'cron')
ck('pass again: nothing new (no second record, no second card)', DB.hepb_record.length === 4 && ops().length === nCards)

/* ═══ 3. the office door and the offer ═══ */
r = await call({ action: 'get', offer_id: OA }); ck('no sign-in: 401', r.status === 401)
r = await call({ action: 'get', offer_id: OA }, 'nobody'); ck('a signed-in person with no office role: 403', r.status === 403)
r = await call({ action: 'confirm_training', key: A.id, date: '2026-10-20' }, 'kry'); ck('training date in the future: refused', r.status === 400)
r = await call({ action: 'confirm_training', key: A.id, date: '2026-10-12' }, 'kry')
ck('confirm_training: a staffing coordinator records it (a training record, not medical); the card closes', r.status === 200 && A.training_date === '2026-10-12' && A.training_confirmed_by === 'Krystal' && card('hepb_training_' + A.id).status === 'done' && evs(A.id, 'training_confirmed').length === 1, r.j)
await call({ action: 'pass' }, 'cron')
ck('switch off: the offer is held as practice (recorded, not sent, NOT counted as offered)', GHL.messages.length === 0 && !A.offered_at && A.reminders.offer?.practice === true && evs(A.id, 'offer_held').length === 1)
r = await call({ action: 'send_link', key: A.id }, 'kry')
ck('switch off: Send link is practice: nothing sent, the link shown for testing, not counted as offered', r.j.state === 'practice' && /hepb\.html\?h=/.test(r.j.link) && GHL.messages.length === 0 && !A.offered_at, r.j)
r = await asCg(A.id, { action: 'decline', typed_name: 'Ava Lee', consent: true, fingerprint: FP })
ck('switch off: a real person cannot sign the declination yet', r.status === 409 && r.j.not_live, r.j)
set('hepb_offer_live', true); delete A.reminders.offer
at('2026-10-18T15:00:00Z')   // Sunday
await call({ action: 'pass' }, 'cron')
ck('switch on, Sunday: held (never dropped), nothing sent', GHL.messages.length === 0 && !A.offered_at && A.reminders['offer:held'])
at('2026-10-19T15:00:00Z')   // Monday 10am
r = await call({ action: 'pass' }, 'cron')
const sentA = GHL.messages.filter((m) => /ava|4175550101/.test(m.contactId))
ck('switch on, Monday 10am: Ava gets the offer by text and email with her link; offered_at recorded; the readiness row says Offered', r.j.offered === 1 && sentA.length === 2 && sentA.some((m) => /hepb\.html\?h=/.test(m.message || '') && /STOP/.test(m.message)) && !!A.offered_at && /text and email/.test(A.offered_via) && stepOf(OA).evidence.status === 'Offered', [r.j, sentA])
ck('no message holds a medical word or pay', GHL.messages.every((m) => !/\bpay\b|immun|contraindicat|antibod/i.test(JSON.stringify(m))))
const nMsg = GHL.messages.length; await call({ action: 'pass' }, 'cron')
ck('the offer goes once', GHL.messages.length === nMsg)
await call({ action: 'confirm_training', key: P.id, date: '2026-10-12' }, 'kry'); await call({ action: 'pass' }, 'cron')
ck('a practice person is never contacted, even with the switch on', GHL.messages.length === nMsg && P.reminders.offer?.practice && !P.offered_at)

/* ═══ 4. the deadline cards ═══ */
r = await call({ action: 'setup', caregiver_id: '207' }, 'kry')
const O = rec((x) => x.caregiver_id === '207')
ck('setup: an existing caregiver (CNA on the roster, first visit Sep 1): exposed, due Sep 15', r.status === 200 && O.position === 'CNA' && O.position_source === 'roster' && O.exposed && O.due_date === '2026-09-15', [r.j, O])
r = await call({ action: 'setup', caregiver_id: '207' }, 'kry'); ck('setup twice: refused, the record named', r.status === 409 && r.j.key === O.id)
r = await call({ action: 'setup', caregiver_id: '208', position: 'Office' }, 'cc')
ck('setup: an office person by the office\'s position: not required', r.status === 200 && rec((x) => x.caregiver_id === '208').status === 'not_required')
await call({ action: 'pass' }, 'cron')
ck('deadline passed with no offer: an URGENT card naming the deadline and that training is not confirmed', card('hepb_late_' + O.id)?.urgency === 'urgent' && /September 15, 2026/.test(card('hepb_late_' + O.id).detail) && /not confirmed/.test(card('hepb_late_' + O.id).detail), card('hepb_late_' + O.id))
r = await call({ action: 'record_offer', key: O.id, how: 'in person at the office' }, 'kry')
ck('record_offer: the office offered it in person; the late card closes', r.status === 200 && O.offered_at && /in person/.test(O.offered_via) && card('hepb_late_' + O.id).status === 'done')
await call({ action: 'pass' }, 'cron')
ck('deadline passed, offered, no answer: a follow-up card', card('hepb_noanswer_' + O.id)?.status === 'open')

/* ═══ 5. the caregiver's link: every choice ═══ */
r = await call({ action: 'view', h: A.id, e: '9999999999', t: 'x'.repeat(43) }); ck('a forged link: 401', r.status === 401)
r = await asCg(B.id, { action: 'view' }); ck('a position with no exposure: the link says it does not apply', r.status === 409 && r.j.not_required)
r = await asCg(A.id, { action: 'view' })
ck('view: her name, all five answers open, the Appendix A statement and its fingerprint', r.status === 200 && r.j.first === 'Ava' && JSON.stringify(r.j.can_choose) === '["vaccine","prior_series","immune","contraindicated","declined"]' && r.j.declination.statement === APPX && r.j.declination.fingerprint === FP, r.j)
r = await asCg(A.id, { action: 'choose', choice: 'surgery' }); ck('choose: an unknown answer is refused', r.status === 400)
r = await asCg(A.id, { action: 'choose', choice: 'vaccine' })
ck('(1) the vaccine: Accepted; a card to arrange it at no cost; the deadline cards close; the readiness row stays open (Accepted)', r.status === 200 && A.status === 'vaccine' && ops().some((c) => c.kind === 'hepb_arrange' && /no cost/.test(c.detail) && c.owner === 'sam@mo-care.com') && stepOf(OA).state === 'open' && stepOf(OA).evidence.status === 'Accepted', r.j)
r = await asCg(A.id, { action: 'decline', typed_name: 'Ava Lee', consent: false, fingerprint: FP }); ck('decline: no consent ticked, refused', r.status === 400)
r = await asCg(A.id, { action: 'decline', typed_name: 'Ava', consent: true, fingerprint: FP }); ck('decline: one name only, refused', r.status === 400)
r = await asCg(A.id, { action: 'decline', typed_name: 'Ava Lee', consent: true, fingerprint: 'f'.repeat(64) }); ck('decline: words on screen out of date (fingerprint), refused', r.status === 409 && r.j.stale)
r = await asCg(A.id, { action: 'decline', typed_name: 'Ava Lee', consent: true, fingerprint: FP })
const dEv = evs(A.id, 'declined')[0]
ck('(5) decline: Declined; the signature audit (typed name, time, device address, browser, wording fingerprint, version, consent); a private PDF', r.status === 200 && A.status === 'declined' && A.declination_typed_name === 'Ava Lee' && A.declination_fingerprint === FP && A.declination_version === 1 && dEv.detail.ip === '203.0.113.9' && dEv.detail.agent === 'TestPhone' && dEv.detail.consent === true && /^hb\/.+\/declination\/v1-.+\.pdf$/.test(A.declination_pdf) && STORE['hepb-docs/' + A.declination_pdf] && /^https:\/\/signed\/hepb-docs\//.test(r.j.copy_url), [r.j, dEv])
const pdfText = Buffer.from(STORE['hepb-docs/' + A.declination_pdf]).toString('latin1')
ck('the PDF carries the Appendix A words, her typed name and the fingerprint', /serious disease/.test(pdfText) && /Ava Lee/.test(pdfText) && pdfText.includes(FP.slice(0, 16)) && /1910\.1030, Appendix A/.test(pdfText))
ck('declined: the readiness row completes (Declined); never in onboarding-documents', stepOf(OA).state === 'complete' && stepOf(OA).evidence.status === 'Declined' && !Object.keys(STORE).some((k) => k.startsWith('onboarding-documents/')))
r = await asCg(A.id, { action: 'decline', typed_name: 'Ava Lee', consent: true, fingerprint: FP }); ck('a signed declination is never signed again or changed', r.status === 409 && r.j.already)
r = await asCg(A.id, { action: 'view' }); ck('after declining, the page offers the vaccine (and nothing else)', JSON.stringify(r.j.can_choose) === '["vaccine"]' && r.j.declined_at)
r = await asCg(A.id, { action: 'choose', choice: 'immune' }); ck('after declining, another answer is refused (call the office)', r.status === 409)
r = await asCg(A.id, { action: 'choose', choice: 'vaccine' })
ck('(f)(2)(iii): after declining she chooses the vaccine at no cost; the declination stays on file beside it', r.status === 200 && A.status === 'vaccine' && A.declined_at && A.declination_pdf && evs(A.id, 'chose').some((e) => e.detail.after_declining && e.detail.rule === '1910.1030(f)(2)(iii)') && stepOf(OA).state === 'open')
/* (2) the series already completed, with proof; (3) immune by antibody test; (4) contraindicated, the fact only */
set('hepb_offer_live', false)
r = await asCg(P.id, { action: 'decline', typed_name: 'Pat Practice', consent: true, fingerprint: FP })
ck('a practice person may sign while the switch is off (the practice run)', r.status === 200 && P.status === 'declined', r.j)
set('hepb_offer_live', true)
r = await asCg(C.id, { action: 'choose', choice: 'immune' })
ck('(3) immune: answered, the office is checking; a check card that names no medical detail', r.status === 200 && C.status === 'immune' && HB.publicStatus(C) === 'Answered, the office is checking' && ops().some((c) => c.kind === 'hepb_check' && c.hepb_id === C.id))
r = await asCg(C.id, { action: 'upload_url', kind: 'provider_note', content_type: 'application/pdf' }); ck('the link never takes a medical note (only series proof or an antibody result)', r.status === 400)
r = await asCg(C.id, { action: 'upload_url', kind: 'titer_proof', content_type: 'application/pdf' })
const tp = r.j.path
ck('upload_url: a private slot under hb/<record>/titer_proof/', r.status === 200 && new RegExp(`^hb/${C.id}/titer_proof/[^/]+\\.pdf$`).test(tp))
r = await asCg(C.id, { action: 'uploaded', kind: 'titer_proof', path: tp, content_type: 'application/pdf' }); ck('uploaded before the file arrived: refused', r.status === 409)
STORE['hepb-docs/' + tp] = new Uint8Array([1, 2])
r = await asCg(C.id, { action: 'uploaded', kind: 'titer_proof', path: `hb/${A.id}/titer_proof/x.pdf`, content_type: 'application/pdf' }); ck('uploaded: someone else\'s slot refused', r.status === 403)
r = await asCg(C.id, { action: 'uploaded', kind: 'titer_proof', path: tp, content_type: 'application/pdf' })
ck('uploaded: recorded, a check card for the owners', r.status === 200 && DB.hepb_document.filter((d) => d.hepb_id === C.id).length === 1 && evs(C.id, 'doc_uploaded').length === 1)

/* ═══ 6. access control: owners only for the medical record ═══ */
r = await call({ action: 'get', offer_id: OC }, 'kry')
ck('get, not an owner: only the status words and dates; no answer, no documents, no history, nothing that says immune', r.status === 200 && r.j.owner === false && r.j.row.status_label === 'Answered, the office is checking' && !('detail' in r.j) && !('docs' in r.j) && !('events' in r.j) && !/immun|titer|antibod|contraindicat|dose/i.test(JSON.stringify(r.j)), r.j)
for (const [a, extra] of [['verify', {}], ['record_dose', { date: '2026-10-19' }], ['record_choice', { choice: 'vaccine' }], ['series_complete', {}], ['upload_url', { kind: 'dose_record', content_type: 'application/pdf' }]]) {
  r = await call({ action: a, key: C.id, ...extra }, 'cc'); ck(`${a}: a care coordinator is refused (owners only)`, r.status === 403 && /owner/.test(r.j.error)) }
r = await call({ action: 'open', key: A.id, what: 'declination' }, 'kry'); ck('open the signed declination, not an owner: 403, no link', r.status === 403 && !r.j.url)
const nLog = DB.document_access_log.length
r = await call({ action: 'get', offer_id: OC }, 'sam')
ck('get, an owner: the answer, the documents (no paths) and the history; the view itself is logged', r.status === 200 && r.j.owner && r.j.detail.status === 'immune' && r.j.docs.length === 1 && r.j.docs.every((d) => !('path' in d)) && !JSON.stringify(r.j).includes(tp) && r.j.events.length >= 3 && DB.document_access_log.length === nLog + 1 && DB.document_access_log.at(-1).by_email === 'sam@mo-care.com', r.j)
r = await call({ action: 'open', key: A.id, what: 'declination' }, 'sam')
ck('open, an owner: a five-minute link; every open in document_access_log with her name', r.status === 200 && r.j.expires_in === 300 && /hepb-docs/.test(r.j.url) && DB.document_access_log.at(-1).doc === 'hepb:declination' && DB.document_access_log.at(-1).by_name === 'Samantha Troutman')
LOG_FAIL = true; r = await call({ action: 'open', doc_id: DB.hepb_document[0].id }, 'sam'); LOG_FAIL = false
ck('open: when the log cannot be written, no link', r.status === 500 && !r.j.url)
r = await call({ action: 'verify', key: C.id }, 'sam')
ck('verify (immune, with the antibody result on file): Complete; the readiness row completes', r.status === 200 && C.verified_by === 'Samantha Troutman' && HB.publicStatus(C) === 'Complete' && stepOf(OC).state === 'complete' && stepOf(OC).evidence.status === 'Complete')
r = await asCg(C.id, { action: 'choose', choice: 'vaccine' }); ck('once checked, the link cannot change the answer', r.status === 409)
/* (4) contraindicated, recorded by an owner on paper; (2) prior series without proof cannot be checked */
r = await call({ action: 'record_choice', key: O.id, choice: 'declined' }, 'sam'); ck('an owner can never record a declination (only the employee\'s signature makes one)', r.status === 400)
r = await call({ action: 'record_choice', key: O.id, choice: 'prior_series' }, 'sam')
r = await call({ action: 'verify', key: O.id }, 'sam'); ck('(2) prior series: cannot be checked without the proof', r.status === 409)
r = await call({ action: 'upload_url', key: O.id, kind: 'series_proof', content_type: 'image/jpeg' }, 'sam'); const sp = r.j.path; STORE['hepb-docs/' + sp] = new Uint8Array([1])
r = await call({ action: 'record', key: O.id, kind: 'series_proof', path: sp, content_type: 'image/jpeg' }, 'sam')
r = await call({ action: 'verify', key: O.id }, 'sam')
ck('(2) prior series with the proof the office holds: Complete; the follow-up card closed when answered', r.status === 200 && HB.publicStatus(O) === 'Complete' && card('hepb_noanswer_' + O.id).status === 'done')
setAd('caregivers', [...ad('caregivers'), { id: 209, first: 'Zed', last: 'Med', phone: '4175550109', email: 'zed@x.com', first_contact: '2026-10-15' }])
await call({ action: 'setup', caregiver_id: '209', position: 'Caregiver' }, 'kry'); const Z = rec((x) => x.caregiver_id === '209')
r = await asCg(Z.id, { action: 'choose', choice: 'contraindicated', reason: 'my allergy to yeast' })
ck('(4) contraindicated: only the fact is kept (anything typed with it is dropped), no upload asked', r.status === 200 && Z.status === 'contraindicated' && !JSON.stringify(DB.hepb_record.concat(DB.hepb_event)).includes('yeast'))
r = await call({ action: 'verify', key: Z.id }, 'sam'); ck('(4) contraindicated: an owner records that it was checked: Complete', r.status === 200 && HB.publicStatus(Z) === 'Complete')
/* (1) the vaccine through to complete */
r = await call({ action: 'series_complete', key: A.id }, 'sam'); ck('series complete with no dose recorded: refused', r.status === 409)
r = await call({ action: 'record_dose', key: A.id, date: '2026-10-19' }, 'sam'); r = await call({ action: 'record_dose', key: A.id, date: '2026-11-16' }, 'sam'); ck('a dose in the future: refused', r.status === 400)
at('2026-11-16T15:00:00Z'); r = await call({ action: 'record_dose', key: A.id, date: '2026-11-16' }, 'sam')
ck('doses numbered in order with who recorded them', A.doses.length === 2 && A.doses[1].n === 2 && A.doses[1].recorded_by === 'Samantha Troutman')
r = await asCg(A.id, { action: 'decline', typed_name: 'Ava Lee', consent: true, fingerprint: FP }); ck('with a dose recorded, the link cannot change her answer', r.status === 409)
r = await call({ action: 'series_complete', key: A.id }, 'sam')
ck('(1) series complete: Complete; the readiness row completes; the declination is still on file', r.status === 200 && A.status === 'complete' && stepOf(OA).state === 'complete' && A.declination_pdf)

/* ═══ 6b. 2026-10-13 HEPATITIS B IN STEP 1 (the form in Step 1, offered to everyone): the record the Step 1 server makes,
   and the 30-minute pass afterward. Ivy (Caregiver) accepts in Step 1; Oz (Office) declines in Step 1. ═══ */
{
  const OI = '11111111-2222-4333-8444-5555555555a1', OZ = '11111111-2222-4333-8444-5555555555a2'
  const db = globalThis.__fakeCreateClient(), st = ad('ops_settings')
  const base = { at: '2026-11-16T15:00:00.000Z', ip: '203.0.113.9', agent: 'TestPhone', formVersion: 1, formFingerprint: 'e'.repeat(64) }
  let x = await HB.stepOneRecord(db, st, { ...base, offerId: OI, name: 'Ivy Step', position: 'Caregiver', choice: 'vaccine', typedName: 'Ivy Step' })
  const I = rec((r) => r.offer_id === OI)
  ck('Step 1: the record is made from the offer with the choice, offered in Step 1 (information first), no roster link yet', x.ok && x.created && I.status === 'vaccine' && I.step1_at && I.offered_at && /Step 1/.test(I.offered_via) && !I.caregiver_id && I.exposed === true && evs(I.id, 'offered').length === 1 && evs(I.id, 'chose').length === 1, { x, I })
  x = await HB.stepOneRecord(db, st, { ...base, offerId: OI, name: 'Ivy Step', position: 'Caregiver', choice: 'vaccine', typedName: 'Ivy Step' })
  ck('Step 1: a retry finds the same record (never two), no second offer line', x.ok && !x.created && DB.hepb_record.filter((r) => r.offer_id === OI).length === 1 && evs(I.id, 'offered').length === 1)
  x = await HB.stepOneRecord(db, { ...st, hepb_exposure: {} }, { ...base, offerId: OZ, name: 'Oz Desk', position: 'Office', choice: 'declined', typedName: 'Oz Desk' })
  const Zr = rec((r) => r.offer_id === OZ)
  ck('Step 1: offered to everyone: an Office hire (no exposure in the table) is covered, never "not required"; the determination is kept beside it', x.ok && Zr.status === 'declined' && Zr.exposed === true && Zr.exposure_basis.determination === false && Zr.exposure_basis.offered_to_all === true && HB.publicStatus(Zr) === 'Declined', Zr)
  const d = await HB.stepOneDeclination(db, Zr, { typedName: 'Oz Desk', at: base.at, ip: base.ip, agent: base.agent, fingerprint: FP, pdf: 'hb/' + Zr.id + '/declination/v1.pdf' })
  ck('Step 1: the declination half is written once (a second write leaves it as it was)', d.declined_at && d.declination_typed_name === 'Oz Desk' && (await HB.stepOneDeclination(db, d, { typedName: 'Someone Else', at: 'x', ip: '', agent: '', fingerprint: 'z', pdf: null })).declination_typed_name === 'Oz Desk' && evs(Zr.id, 'declined').length === 1)
  x = await HB.stepOneRecord(db, st, { ...base, offerId: OA, name: 'Ava Lee', position: 'Caregiver', choice: 'immune', typedName: 'Ava Lee' })
  ck('Step 1: a record already answered outside Step 1 (the link, an owner) is never overwritten', x.ok && x.kept === true && rec((r) => r.offer_id === OA).status === 'complete')
  ck('Step 1: a bad offer id or a choice not on the list is refused', !(await HB.stepOneRecord(db, st, { ...base, offerId: 'x', name: 'a', position: '', choice: 'vaccine', typedName: 'a' })).ok && !(await HB.stepOneRecord(db, st, { ...base, offerId: OI, name: 'a', position: '', choice: 'maybe', typedName: 'a' })).ok)
  /* the pass, at Approve to Work: linked, dated, the Arrange card for Ivy; no second record, no offer sent to either */
  setAd('caregivers', [...ad('caregivers'), { id: 301, first: 'Ivy', last: 'Step', phone: '4175550131', email: 'ivy@x.com', offer_id: OI, approved_to_work_at: '2026-11-16T16:00:00Z', first_contact: '2026-11-17' },
    { id: 302, first: 'Oz', last: 'Desk', phone: '4175550132', email: 'oz@x.com', offer_id: OZ, approved_to_work_at: '2026-11-16T16:00:00Z' }])
  set('hepb_offer_live', true); const sent0 = GHL.messages.length, n0 = DB.hepb_record.length
  r = await call({ action: 'pass' }, 'cron')
  const I2 = rec((r2) => r2.offer_id === OI), Z2 = rec((r2) => r2.offer_id === OZ)
  ck('pass: someone who answered in Step 1 is linked to the roster, never set up twice, and never sent an offer (even with sending on)', r.status === 200 && DB.hepb_record.length === n0 && I2.caregiver_id === '301' && Z2.caregiver_id === '302' && GHL.messages.length === sent0 && evs(I2.id, 'offered').length === 1 && r.j.linked === 2, { j: r.j, sent: GHL.messages.length - sent0 })
  ck('pass: Ivy (accepted in Step 1): initial assignment = her first client visit, the 10-working-day deadline, ONE Arrange card for the owners', I2.assignment_date === '2026-11-17' && I2.due_date === HB.dueFrom('2026-11-17', []) && card('hepb_arrange_' + I2.id) && card('hepb_arrange_' + I2.id).owner === 'sam@mo-care.com' && /accepted the hepatitis B vaccine/.test(card('hepb_arrange_' + I2.id).detail) && noDash(card('hepb_arrange_' + I2.id).detail), { I2, c: card('hepb_arrange_' + I2.id) })
  r = await call({ action: 'pass' }, 'cron')
  ck('pass again: nothing new (no second card, no offer, no new record)', ops().filter((c) => c.id === 'hepb_arrange_' + I2.id).length === 1 && GHL.messages.length === sent0 && DB.hepb_record.length === n0 && r.j.linked === 0)
  at('2026-12-15T15:00:00Z'); r = await call({ action: 'pass' }, 'cron')
  ck('pass: past the deadline with no dose recorded: ONE urgent card', card('hepb_dose_late_' + I2.id)?.urgency === 'urgent' && /not arranged by the deadline/.test(card('hepb_dose_late_' + I2.id).title))
  r = await call({ action: 'get', key: Z2.id }, 'kry')
  ck('Oz (declined in Step 1): the office sees only "Declined"; a later yes on the link or the office button still works', r.j.row.status_label === 'Declined' && r.j.row.may_send === true && !r.j.detail && HB.mayChoose(Z2, 'vaccine').ok)
  r = await asCg(Z2.id, { action: 'choose', choice: 'vaccine' })
  ck('Oz changes her mind on the link: the vaccine at no cost ((f)(2)(iii)); the signed declination stays on file', r.status === 200 && Z2.status === 'vaccine' && Z2.declined_at && Z2.declination_pdf)
  set('hepb_offer_live', false)
}

/* ═══ 7. the rest ═══ */
r = await call({ action: 'exposure' }, 'cc'); ck('exposure: any office role reads the table in force', r.status === 200 && r.j.table.find((x) => x.position === 'Caregiver').exposed && r.j.fallback === 'Caregiver')
set('hepb_exposure', { Office: { exposed: true } }); r = await call({ action: 'exposure' }, 'cc'); ck('exposure: the Admin override shows (source admin)', r.j.table.find((x) => x.position === 'Office').exposed && r.j.table.find((x) => x.position === 'Office').source === 'admin')
r = await call({ action: 'mirror_all' }, 'kry'); ck('mirror_all is for the schedule only', r.status === 401)
r = await call({ action: 'mirror_all' }, 'cron'); ck('mirror_all: every record looked at', r.status === 200 && r.j.looked_at === DB.hepb_record.length)
ck('history is append-only: the function never changed or removed a line', EVENT_WRITES === 0)
ck('no em dash in any card; no card names an exception (immune, antibody, contraindicated)', ops().filter((c) => c.created_by === 'hepb').every((c) => noDash(c.title + c.detail) && !/immun|antibod|contraindicat/i.test(c.title + c.detail)))
const SRC = fs.readFileSync(path.join(FN, 'hepb', 'index.ts'), 'utf8') + fs.readFileSync(path.join(FN, '_shared', 'hepb.ts'), 'utf8')
ck('no em dash anywhere in the function or the shared module', noDash(SRC))
ck('nothing reached any service but GoHighLevel and the read-only offers project (every other fetch would have thrown)', true)

for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (note ? '  ' + note : ''))
console.log(`${res.filter((x) => x[1]).length}/${res.length} passed`); process.exit(res.every((x) => x[1]) ? 0 : 1)
