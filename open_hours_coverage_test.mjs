// coverage-run · open hours (2026-10-12): preview, the switch, the 9am-6pm window, the wording check, batches of 20,
// everyone eligible (busy too) minus nurses / No shift texts, asked once only, and the tick never texts it.
// The real function against a fake database, fake AxisCare and fake GoHighLevel, with the clock pinned. node open_hours_coverage_test.mjs
import fs from 'fs'; import path from 'path';
/* pin the clock: tomorrow 10:00 Central (15:00 UTC in October) unless the test moves it */
const RealDate = Date; let FIXED = (() => { const d = new RealDate(Date.now() + 86400e3); return RealDate.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 15, 0) })()
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
  if (/axiscare\.com\/api\/caregivers(\?|$)/.test(url)) return new Response(JSON.stringify({ results: { caregivers: APP.caregivers.map((c) => ({ id: Number(c.axiscare_id), status: { active: true }, classes: [], mailingAddress: { city: 'Nixa', postalCode: '65714' } })) } }), { status: 200 })
  if (/axiscare\.com\/api\/clients\//.test(url)) return new Response(JSON.stringify({ results: { client: { classes: [], residentialAddress: { city: 'Nixa', postalCode: '65714' } } } }), { status: 200 })
  if (url.includes('axiscare.com')) return new Response(JSON.stringify({ results: { visits: VISITS }, nextPage: null }), { status: 200 })
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', HUB_JOB_SECRET: 'j'.repeat(64) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
{ const ja = fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)')
  fs.writeFileSync(`${FN}/_shared/_job-auth_oh.ts`, ja) }
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_oh.ts`) } catch { /* */ } })
const src = fs.readFileSync(`${FN}/coverage-run/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_oh.ts'")
const tmp = path.join(process.cwd(), FN, 'coverage-run', '_toh.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const act = async (body) => { const r = await handler(new Request('https://x/functions/v1/coverage-run', { method: 'POST', headers: { Authorization: 'Bearer ' + SVC, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return r.json() }
const names = (arr) => (arr || []).map((x) => x.name)
const K = (o) => ({ id: 'cv1', status: 'open', reason: 'calloff', client: 'Ruth Kay', client_axiscare_id: '500', shift_date: nextSat, shift_time: '07:00-11:00', asked: [], ...o })


const PLAN = { id: 'p1', client: '', open_hours: true, city: 'Nixa', zip: '65714', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
  slots: [{ k: 'am', label: 'Morning', start: '08:00', end: '12:00' }, { k: 'pm', label: 'Afternoon', start: '12:00', end: '17:00' }], cells: {} }
const fresh = (o = {}) => { reset({ id: 'other', status: 'closed', asked: [] }); APP.staffing_plans = [PLAN]; Object.assign(APP.ops_settings, o) }
const C = () => (APP.coverage_cases || []).find((x) => x.id === 'cwh_p1')

fresh(); let r = await act({ action: 'open_hours', plan_id: 'p1' })
ck('preview: her wording with the town, days and both halves; nothing saved, nothing sent', r.ok && /regular hours open in Nixa: Monday to Saturday, 8am to noon and noon to 5pm/.test(r.text) && !C() && SENT.length === 0, r)
ck('...everyone eligible would get it (5), the PRN Team too', r.will_get === 5 && r.offered.length === 12 && r.live === false, r)
APP.coverage_do_not_offer = [{ name: 'Bob Regular', until: '2099-01-01' }]; APP.nurse_staff = [{ axiscare_id: '9004', name: 'Ann Regular', active: true }]
r = await act({ action: 'open_hours', plan_id: 'p1' })
ck('...No shift texts and nurses are left out, with the reasons counted', r.will_get === 3 && !r.people.some((p) => /Bob|Ann/.test(p.name)) && r.not_sent >= 2, r)

fresh(); r = await act({ action: 'open_hours', plan_id: 'p1', mode: 'send' })
ck('switch off: refused, nothing sent, nothing saved', /switched off/.test(r.error) && SENT.length === 0 && !C(), r)

fresh({ open_hours_live: true }); FIXED = FIXED + 9 * 3600e3   // 7pm
r = await act({ action: 'open_hours', plan_id: 'p1', mode: 'send' })
ck('7pm: held (9am to 6pm), nothing sent', r.held_window === true && SENT.length === 0, r)
FIXED = FIXED - 9 * 3600e3

fresh({ open_hours_live: true }); r = await act({ action: 'open_hours', plan_id: 'p1', mode: 'send', message: 'Hi {first_name} — hours in {town}' })
ck('an em dash or a blank left in the office\'s text: refused, nothing sent', /em dash/.test(r.error) && SENT.length === 0, r)

fresh({ open_hours_live: true }); r = await act({ action: 'open_hours', plan_id: 'p1', mode: 'send' })
ck('sent to all 5, each with their own first name', r.ok && r.sent.length === 5 && SENT.length === 5 && SENT.some((s) => /^Hi Sarah, it's Caring Companions\. We have regular hours open in Nixa/.test(s.msg)) && SENT.every((s) => !/\{/.test(s.msg)), [r, SENT.map((s) => s.msg.slice(0, 40))])
const c = C()
ck('one ask on the plan, open hours, every person recorded (who asked, the squares offered)', c && c.open_hours === true && c.plan_id === 'p1' && c.kind === 'interest' && c.asked.length === 5 && c.asked.every((a) => a.open_hours && a.picked_by_coordinator && a.state === 'waiting') && c.offered.length === 12 && c.shift_date === '', c)
r = await act({ action: 'open_hours', plan_id: 'p1', mode: 'send' })
ck('pressing again texts nobody twice', r.sent.length === 0 && SENT.length === 5, r)

fresh({ open_hours_live: true, coverage_manual_select: false }); r = await act({ action: 'open_hours', plan_id: 'p1', mode: 'send' })
const before = SENT.length; r = await act({})
ck('Cara\'s automatic rounds never text from an open-hours ask', SENT.length === before && C().asked.length === 5, [SENT.length, before])

fresh({ open_hours_live: true }); for (let i = 0; i < 22; i++) APP.caregivers.push({ first: 'Extra' + String.fromCharCode(97 + i) + 'x', last: 'Team', phone: '41755502' + String(i).padStart(2, '0'), axiscare_id: String(9100 + i), active: true })
r = await act({ action: 'open_hours', plan_id: 'p1', mode: 'send' })
ck('27 people: the first press texts 20 and says 7 are left', r.sent.length === 20 && r.remaining === 7, r)
r = await act({ action: 'open_hours', plan_id: 'p1', mode: 'send' })
ck('...the next press texts the other 7', r.sent.length === 7 && r.remaining === 0 && SENT.length === 27, r)

fresh({ open_hours_live: true }); APP.staffing_plans = [{ ...PLAN, city: '' }]; r = await act({ action: 'open_hours', plan_id: 'p1', mode: 'send' })
ck('no town on the plan: refused (the text names the town)', /add the town/.test(r.error) && SENT.length === 0, r)

let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
