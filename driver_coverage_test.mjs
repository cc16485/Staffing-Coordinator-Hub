// Driver Compliance in Cara's ask lists (2026-10-13). Her rule: Non-Driver, Pending Verification, Suspended (and no driver
// record yet) are never eligible for a shift that needs transporting the client; only Approved Drivers with a current
// license and insurance. Needs transportation = the client's care needs, the lead checklist, or the Team Builder plan (the
// only source for an open-hours plan with no client). 'Preferred' ranks lower, never cuts. Other shifts are unaffected.
// The real coverage-run against a fake database, AxisCare and GoHighLevel. node driver_coverage_test.mjs
import fs from 'fs'; import path from 'path';
/* pin the clock: tomorrow 10:00 Central (15:00 UTC in October), inside the 9am to 6pm window for the open-hours send */
const RealDate = Date; const FIXED = (() => { const d = new RealDate(Date.now() + 86400e3); return RealDate.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 15, 0) })()
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [FIXED])) } static now() { return FIXED } }
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1200)]);
const FN = 'supabase/functions'
let T, APP, SENT, VISITS
const SVC = 'svc_' + 'k'.repeat(60)
const ymd = (d) => d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d) }
/* the next Saturday at least 3 days away, so notice is never the reason in the base case */
const nextSat = (() => { const d = new Date(); d.setDate(d.getDate() + 3); while (d.getDay() !== 6) d.setDate(d.getDate() + 1); return ymd(d) })()
const W = (days, times) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, days.includes(d) ? times : []]))
const reset = (kase) => {
  SENT = []; VISITS = []
  APP = {
    caregivers: [
      { first: 'Sarah', last: 'Prn', phone: '4175550101', axiscare_id: '9001', active: true },
      { first: 'Jess', last: 'Prn', phone: '4175550102', axiscare_id: '9002', active: true },
      { first: 'Maria', last: 'Prn', phone: '4175550103', axiscare_id: '9003', active: true },
      { first: 'Ann', last: 'Regular', phone: '4175550104', axiscare_id: '9004', active: true },
      { first: 'Bob', last: 'Regular', phone: '4175550105', axiscare_id: '9005', active: true }],
    caregiver_availability: [
      { id: '9001', axiscare_id: '9001', windows: W(['sat', 'sun'], ['morning']), updated_at: '2026-09-29T10:00:00Z' },
      { id: '9002', axiscare_id: '9002', windows: W(['sat'], ['morning', 'afternoon']), updated_at: '2026-09-20T10:00:00Z' },
      { id: '9003', axiscare_id: '9003', windows: W(['sat'], ['morning']), updated_at: '2026-09-29T10:00:00Z' }],
    coverage_cases: [kase], ops_settings: { coverage_send_live: true, coverage_quiet_from: 0, coverage_quiet_until: 0 /* CI1: no night hold in these tests, whatever the clock */ }, responsibilities: [], nurse_staff: [], coverage_do_not_offer: [], client_checkins: [],
  }
  T = { domains: [], persons: [], contact_optout_current: [], circle_contacts: [], phone_index: [], client_callin_current: [], person_identity: [], person_source_id: [],
    pay_tracks: [{ applicant_id: 'a1', track: 'prn_team', axiscare_caregiver_id: '9001' }, { applicant_id: 'a2', track: 'prn_team', axiscare_caregiver_id: '9002' },
                 { applicant_id: 'a3', track: 'prn_team', axiscare_caregiver_id: '9003' }, { applicant_id: 'a9', track: 'ongoing', axiscare_caregiver_id: '9004' }],
    job_applicants: [{ id: 'a1', prn: { notice: 'same_day' } }, { id: 'a2', prn: { notice: 'few_hours' } }, { id: 'a3', prn: { notice: '48h' } }, { id: 'a9', prn: { notice: 'same_day' } }] }
}
const q = (t) => { const st = { f: [], inF: null, nn: [] }; const b = {
  select() { return b }, order() { return b }, limit() { return b }, gte() { return b }, lte() { return b }, lt() { return b }, gt() { return b }, ilike() { return b }, or() { return b }, contains() { return b }, range() { return b }, neq() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF = [c, v]; return b }, is() { return b }, not(c, op, v) { if (op === 'is' && v === null) st.nn.push(c); return b },
  update() { return { eq: () => Promise.resolve({ data: null, error: null }) } }, upsert() { return Promise.resolve({ data: null, error: null }) }, insert() { return Promise.resolve({ data: null, error: null }) },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: null })) }, single() { return b.maybeSingle() },
  then(ok, bad) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok, bad) }
    let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); for (const c of st.nn) r = r.filter((x) => x[c] != null)
    if (st.inF) r = r.filter((x) => st.inF[1].includes(x[st.inF[0]])); return Promise.resolve({ data: r, error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) }
  /* CI1: the ask is recorded under the case's lock before the text (the real one is SQL: ci1_sql_test.py) */
  if (fn === 'coverage_case_add_ask') { const c = (APP.coverage_cases || []).find((x) => x.id === a.p_id); if (!c) return { data: 'not_found', error: null }; if (c.status !== 'open') return { data: 'not_open', error: null };
    const ten = (p) => String(p || '').replace(/\D/g, '').slice(-10); c.asked = c.asked || [];
    if (c.asked.some((x) => ten(x.phone) === ten(a.p_ask.phone) || (a.p_ask.axiscare_id && x.axiscare_id === a.p_ask.axiscare_id))) return { data: 'already_asked', error: null };
    c.asked.push(a.p_ask); return { data: 'added', error: null } }
  if (fn === 'coverage_case_remove_ask') { const c = (APP.coverage_cases || []).find((x) => x.id === a.p_id); if (c) c.asked = (c.asked || []).filter((x) => x.id !== a.p_ask_id); return { data: true, error: null } }
  return { data: null, error: null } }, auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) } }
globalThis.__dbFor = (key) => ({ from: () => { const b = { select() { return b }, limit() { return Promise.resolve(key === SVC ? { data: [], error: null } : { data: null, error: { message: 'denied' } }) } }; return b } })
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, msg: body.message }); return new Response('{}', { status: 200 }) }
  if (/axiscare\.com\/api\/caregivers(\?|$)/.test(url)) return new Response(JSON.stringify({ results: { caregivers: APP.caregivers.map((c) => ({ id: Number(c.axiscare_id), status: { active: true }, classes: [], hireDate: c.hire || '2024-01-01', mailingAddress: { city: 'Nixa', postalCode: '65714' } })) } }), { status: 200 })
  if (/axiscare\.com\/api\/clients\//.test(url)) return new Response(JSON.stringify({ results: { client: { classes: [], residentialAddress: { city: 'Nixa', postalCode: '65714' } } } }), { status: 200 })
  if (url.includes('axiscare.com')) return new Response(JSON.stringify({ results: { visits: VISITS }, nextPage: null }), { status: 200 })
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', HUB_JOB_SECRET: 'j'.repeat(64) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
{ const ja = fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)')
  fs.writeFileSync(`${FN}/_shared/_job-auth_dc.ts`, ja) }
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_dc.ts`) } catch { /* */ } })
const src = fs.readFileSync(`${FN}/coverage-run/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_dc.ts'")
const tmp = path.join(process.cwd(), FN, 'coverage-run', '_tdc.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const act = async (body) => { const r = await handler(new Request('https://x/functions/v1/coverage-run', { method: 'POST', headers: { Authorization: 'Bearer ' + SVC, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return r.json() }
const names = (arr) => (arr || []).map((x) => x.name)
const K = (o) => ({ id: 'cv1', status: 'open', reason: 'calloff', client: 'Ruth Kay', client_axiscare_id: '500', shift_date: nextSat, shift_time: '07:00-11:00', asked: [], ...o })

const APPROVED = { dl_status: 'Approved Driver', cleared_to_drive: true, dl_expires: '2099-01-01', auto_ins_expires: '2099-01-01' }
const people = () => {
  APP.caregivers = [
    { first: 'Ann', last: 'Approved', phone: '4175550111', axiscare_id: '9011', active: true, ...APPROVED },
    { first: 'Bob', last: 'Pending', phone: '4175550112', axiscare_id: '9012', active: true, dl_status: 'Pending Verification', cleared_to_drive: false },
    { first: 'Nell', last: 'Nondriver', phone: '4175550113', axiscare_id: '9013', active: true, dl_status: 'Non-Driver', cleared_to_drive: false },
    { first: 'Sue', last: 'Suspended', phone: '4175550114', axiscare_id: '9014', active: true, dl_status: 'Suspended', cleared_to_drive: false },
    { first: 'Oz', last: 'Norecord', phone: '4175550115', axiscare_id: '9015', active: true },
    { first: 'Lee', last: 'Lapsed', phone: '4175550116', axiscare_id: '9016', active: true, ...APPROVED, auto_ins_expires: '2001-01-01' }]
  T.pay_tracks = []; T.job_applicants = []; APP.ops_settings.driver_schedule_gate_live = true }   // the Admin switch on (off is tested at the end)
const client500 = (value, layer = 'plan') => {
  T.person_source_id = [{ person_id: 'p500', system: 'axiscare', entity_type: 'client', source_id: '500', confidence: 'confirmed', needs_review: false }]
  T.journey_episode = [{ episode_id: 'e500', person_id: 'p500', state: 'open', created_at: '2026-10-01T00:00:00Z' }]
  T.client_fact_current = value ? [{ episode_id: 'e500', kind: 'need_transportation', layer, value }] : [] }
const listed = (out) => [...out.group0, ...out.group1, ...out.group2, ...out.prn_other, ...out.prn_ongoing].map((x) => x.name)
const whyOf = (out, n) => (out.excluded.find((x) => x.name === n) || {}).why || ''

/* a call-off for a client whose care plan says transportation is required */
reset(K()); people(); client500('required')
let out = await act({ action: 'candidates', case_id: 'cv1' })
ck('transport required: only the Approved Driver with current documents is listed', listed(out).join() === 'Ann Approved', listed(out))
ck('...Pending Verification cut, with the reason', /not cleared to drive clients, and this shift needs transportation \(Not an Approved Driver \(Pending Verification\)\)/.test(whyOf(out, 'Bob Pending')), out.excluded)
ck('...Non-Driver cut', /\(Not an Approved Driver \(Non-Driver\)\)/.test(whyOf(out, 'Nell Nondriver')))
ck('...Suspended cut', /\(Driving suspended\)/.test(whyOf(out, 'Sue Suspended')))
ck('...no driver record yet cut (no assumption)', /\(No driver record yet\)/.test(whyOf(out, 'Oz Norecord')))
ck('...an Approved Driver whose insurance date has passed (before the nightly suspend) cut', /\(License or insurance expired\)/.test(whyOf(out, 'Lee Lapsed')))
ck('...and the case says why (the care needs, plan layer)', out.meta?.transport?.level === 'required' && out.meta.transport.from.join() === 'the care needs (plan)', out.meta)

/* the same people, no transportation need: nobody cut for driving, and the order is exactly what it was */
reset(K()); people(); client500(null)
out = await act({ action: 'candidates', case_id: 'cv1' })
const base = listed(out)
ck('no transportation need: everyone listed, nobody cut for driving', base.length === 6 && !out.excluded.some((x) => /drive/.test(x.why)) && out.meta.transport.level === null, { base, ex: out.excluded })
reset(K()); people(); client500(null); APP.caregivers.forEach((c) => { delete c.dl_status; delete c.cleared_to_drive })
out = await act({ action: 'candidates', case_id: 'cv1' })
ck('...and the order is the same with or without driver records (the sort is untouched)', listed(out).join() === base.join(), [listed(out), base])

/* an intake answer counts (the safe side), the lead checklist counts, and 'no' on the plan layer overrides an intake 'required' */
reset(K()); people(); client500('required', 'intake')
out = await act({ action: 'candidates', case_id: 'cv1' })
ck('transport required at intake still keeps unqualified drivers off', listed(out).join() === 'Ann Approved', listed(out))
reset(K()); people(); client500(null); T.client_fact_current = [{ episode_id: 'e500', kind: 'need_transportation', layer: 'intake', value: 'required' }, { episode_id: 'e500', kind: 'need_transportation', layer: 'plan', value: 'no' }]
out = await act({ action: 'candidates', case_id: 'cv1' })
ck('the care plan saying no over an intake yes: not required (the latest layer wins)', listed(out).length === 6, listed(out))
reset(K()); people(); client500(null); APP.leads = [{ id: 'L5', axiscare_client_id: '500', client_attributes: { transportation: 'yes' } }]
out = await act({ action: 'candidates', case_id: 'cv1' })
ck('the lead checklist (transportation yes): required', listed(out).join() === 'Ann Approved' && out.meta.transport.from.includes('the lead checklist'), out.meta)

/* preferred: nobody cut; those not cleared after those who are, each with the reason */
reset(K()); people(); client500('preferred')
out = await act({ action: 'candidates', case_id: 'cv1' })
const pr = listed(out), annAt = pr.indexOf('Ann Approved'), lee = out.group2.find((x) => x.name === 'Lee Lapsed') || out.group1.find((x) => x.name === 'Lee Lapsed')
ck('transport preferred: nobody cut, the Approved Driver first, the rest ranked lower', pr.length === 6 && annAt === 0 && out.meta.transport.level === 'preferred', pr)
ck('...and the reason says ranked lower, not excluded', lee && /ranked lower, not excluded: License or insurance expired/.test(lee.drive_note) && !out.group2.find((x) => x.name === 'Ann Approved').drive_note, lee)
const rest = pr.filter((n) => n !== 'Ann Approved')
ck('...the others keep the order they had without the preference', rest.join() === base.filter((n) => n !== 'Ann Approved').join(), [rest, base])

/* the client cannot be identified: unknown = not required, and the case says it could not be determined */
reset(K({ client: 'Not identified (from call)', client_axiscare_id: undefined })); people(); T.client_fact_current = []
out = await act({ action: 'candidates', case_id: 'cv1' })
ck('a client not identified yet: transportation unknown = not required, and the case says so', !out.excluded.some((x) => /drive/.test(x.why)) && /not determined: the client is not identified/.test(out.meta.transport.rule), out.meta)

/* send_selected re-derives: a tampered list can't text a Pending driver about a transport shift */
reset(K()); people(); client500('required')
out = await act({ action: 'send_selected', case_id: 'cv1', recipients: ['Bob Pending', 'Ann Approved'], asked_by: 'Krystal Office' })
ck('send_selected: only the Approved Driver is texted; the Pending one is refused by the same rule', SENT.length === 1 && SENT[0].to === 'C:+14175550111' && out.sent.join() === 'Ann Approved' && out.refused_not_eligible.join() === 'bob pending', { out, SENT })

/* an open-hours plan with no client: the plan's needs are the only source */
const PLAN = { id: 'p1', client: '', open_hours: true, city: 'Nixa', zip: '65714', days: ['mon', 'sat'], needs: ['transportation'],
  slots: [{ k: 'am', label: 'Morning', start: '08:00', end: '12:00' }], cells: {} }
reset({ id: 'other', status: 'closed', asked: [] }); people(); APP.staffing_plans = [PLAN]
let r = await act({ action: 'open_hours', plan_id: 'p1' })
ck('open hours, no client, plan needs transportation: only the Approved Driver would get it; the rest counted with the reason', r.will_get === 1 && r.people[0].name === 'Ann Approved' && r.not_sent_why['not cleared to drive clients, and this shift needs transportation'] === 5, r)
reset({ id: 'other', status: 'closed', asked: [] }); people(); APP.staffing_plans = [{ ...PLAN, needs: ['hoyer_lift'] }]
r = await act({ action: 'open_hours', plan_id: 'p1' })
ck('open hours, plan without transportation: everyone would get it (unaffected)', r.will_get === 6, r)
reset({ id: 'other', status: 'closed', asked: [] }); people(); APP.staffing_plans = [PLAN]; APP.ops_settings.open_hours_live = true
r = await act({ action: 'open_hours', plan_id: 'p1', mode: 'send' })
ck('open hours send: only the Approved Driver is texted', SENT.length === 1, { r, SENT })


/* the Admin switch OFF (the default): nobody cut or moved; the note on the person and in meta */
reset(K()); people(); client500('required'); APP.ops_settings.driver_schedule_gate_live = false
out = await act({ action: 'candidates', case_id: 'cv1' })
ck('switch off, transport required: everyone listed, in the same order as with no need at all', listed(out).join() === base.join() && !out.excluded.some((x) => /drive/.test(x.why)), [listed(out), base])
const bob = [...out.group1, ...out.group2].find((x) => x.name === 'Bob Pending')
ck('...each person not cleared carries "Driver check (not enforced yet)"', bob && bob.drive_note === 'Driver check (not enforced yet): Not an Approved Driver (Pending Verification)' && !out.group2.find((x) => x.name === 'Ann Approved').drive_note, bob)
ck('...and meta says it is not enforced, with the notes', out.meta.transport.enforced === false && out.meta.transport.notes.length === 5 && /not enforced yet/.test(out.meta.transport.rule), out.meta.transport)
reset(K()); people(); client500('preferred'); delete APP.ops_settings.driver_schedule_gate_live
out = await act({ action: 'candidates', case_id: 'cv1' })
ck('switch unset, transport preferred: the order is exactly as before (nobody moved)', listed(out).join() === base.join(), [listed(out), base])
reset(K()); people(); client500('required'); APP.ops_settings.driver_schedule_gate_live = false
out = await act({ action: 'send_selected', case_id: 'cv1', recipients: ['Bob Pending'], asked_by: 'Krystal Office' })
ck('switch off: send_selected texts the Pending driver (never refused for driving)', SENT.length === 1 && out.sent.join() === 'Bob Pending', { out, SENT })
reset({ id: 'other', status: 'closed', asked: [] }); people(); APP.staffing_plans = [PLAN]; APP.ops_settings.driver_schedule_gate_live = false
r = await act({ action: 'open_hours', plan_id: 'p1' })
ck('switch off: open hours would go to everyone', r.will_get === 6, r)

let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
