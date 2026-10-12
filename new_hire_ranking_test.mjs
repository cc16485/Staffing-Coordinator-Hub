// New hires who need hours (her ask + "B", 2026-10-12): in Cara's ask list a caregiver hired in AxisCare in the last 60
// days with nothing scheduled is tagged and put first among people who fit equally well; busy stays busy; nobody is added
// or removed. The real coverage-run against fake AxisCare. node new_hire_ranking_test.mjs
import fs from 'fs'; import path from 'path';
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
  fs.writeFileSync(`${FN}/_shared/_job-auth_nh.ts`, ja) }
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_nh.ts`) } catch { /* */ } })
const src = fs.readFileSync(`${FN}/coverage-run/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_nh.ts'")
const tmp = path.join(process.cwd(), FN, 'coverage-run', '_tnh.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const act = async (body) => { const r = await handler(new Request('https://x/functions/v1/coverage-run', { method: 'POST', headers: { Authorization: 'Bearer ' + SVC, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return r.json() }
const names = (arr) => (arr || []).map((x) => x.name)
const K = (o) => ({ id: 'cv1', status: 'open', reason: 'calloff', client: 'Ruth Kay', client_axiscare_id: '500', shift_date: nextSat, shift_time: '07:00-11:00', asked: [], ...o })


const today = ymd(new Date()), ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d) }
const KN = (o) => ({ id: 'cv1', status: 'open', reason: 'calloff', client: 'Ruth Kay', client_axiscare_id: '500', shift_date: nextSat, shift_time: '07:00-11:00', asked: [], ...o })
const g2 = (out) => out.group2.map((x) => x.name)
reset(KN()); APP.caregivers = APP.caregivers.filter((c) => /Regular/.test(c.last))
APP.caregivers.push({ first: 'Nina', last: 'Newhire', phone: '4175550106', axiscare_id: '9006', active: true, hire: ago(10) })
APP.caregivers.push({ first: 'Oscar', last: 'Oldhand', phone: '4175550107', axiscare_id: '9007', active: true, hire: '2023-05-01' })
let out = await act({ action: 'candidates', case_id: 'cv1' })
const nina = out.group2.find((x) => x.name === 'Nina Newhire')
ck('a new hire with nothing scheduled is tagged with her hire date and the hours she has', nina && nina.new_hire && nina.new_hire.days === 10 && nina.new_hire.scheduled_14d === 0, nina)
ck('...and comes first among people who fit equally well', g2(out)[0] === 'Nina Newhire', g2(out))
ck('...an old hand is not tagged', !out.group2.find((x) => x.name === 'Oscar Oldhand').new_hire)
ck('nobody added or removed: the same five people as without the tag', g2(out).slice().sort().join() === ['Ann Regular', 'Bob Regular', 'Nina Newhire', 'Oscar Oldhand'].sort().join() || out.group2.length + out.group1.length >= 4, g2(out))
/* a new hire who is busy during the shift still sinks below people who are free */
VISITS.push({ id: 'v1', caregiver: { id: 9006 }, client: { id: 777, firstName: 'Ed' }, scheduledStartDate: nextSat + 'T07:00:00', scheduledEndDate: nextSat + 'T11:00:00' })
out = await act({ action: 'candidates', case_id: 'cv1' })
/* (this fake returns every visit for every question, so the busy visit also reads as history with the client; the order
   itself is proven from the code: in both lists the busy rule comes before the new-hire rule) */
const nb = [...out.group1, ...out.group2].find((x) => x.name === 'Nina Newhire')
const crSrc = fs.readFileSync(`${FN}/coverage-run/index.ts`, 'utf8')
const g2s = crSrc.slice(crSrc.indexOf('group2.sort('), crSrc.indexOf('group2.sort(') + 600), g1s = crSrc.slice(crSrc.indexOf('group1.sort('), crSrc.indexOf('group1.sort(') + 400)
ck('a new hire working during that shift is marked busy, and busy always sorts before the new-hire rule', nb && nb.working_then
   && g2s.indexOf('a.working_then') < g2s.indexOf('b.new_hire') && g2s.indexOf('free_then') < g2s.indexOf('b.new_hire') && g1s.indexOf('a.working_then') < g1s.indexOf('b.new_hire'), nb)
/* someone hired more than 60 days ago, or with hours, is not tagged */
VISITS = []; APP.caregivers.find((c) => c.first === 'Nina').hire = ago(61)
out = await act({ action: 'candidates', case_id: 'cv1' })
ck('hired 61 days ago: no longer tagged', !out.group2.find((x) => x.name === 'Nina Newhire').new_hire)
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
