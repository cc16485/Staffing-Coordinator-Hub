// PRN3 · coverage-run: the PRN CNA Team who fit a call-off or one-time shift are shown and asked first; a regular
// opening lists them apart and never waves them; the PRN wording goes only to PRN asks; nobody else's order changes.
// The real function against a fake database, fake AxisCare and fake GoHighLevel. node prn3_coverage_test.mjs
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
    coverage_cases: [kase], ops_settings: { coverage_send_live: true }, responsibilities: [], nurse_staff: [], coverage_do_not_offer: [], client_checkins: [],
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
  fs.writeFileSync(`${FN}/_shared/_job-auth_t3.ts`, ja) }
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_t3.ts`) } catch { /* */ } })
const src = fs.readFileSync(`${FN}/coverage-run/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_t3.ts'")
const tmp = path.join(process.cwd(), FN, 'coverage-run', '_t.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const act = async (body) => { const r = await handler(new Request('https://x/functions/v1/coverage-run', { method: 'POST', headers: { Authorization: 'Bearer ' + SVC, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return r.json() }
const names = (arr) => (arr || []).map((x) => x.name)
const K = (o) => ({ id: 'cv1', status: 'open', reason: 'calloff', client: 'Ruth Kay', client_axiscare_id: '500', shift_date: nextSat, shift_time: '07:00-11:00', asked: [], ...o })

/* ── the fit rules, directly ── */
const now = new Date(nextSat + 'T03:00:00')   // 4 hours before a 7am start
ck('fit: day, time of day and notice all fit', M.prnFit(K(), { notice: 'same_day', windows: W(['sat'], ['morning']) }, false, now).fit)
ck('fit: "a few hours" means 3+: 4 hours away fits; 2 hours away does not', M.prnFit(K(), { notice: 'few_hours', windows: W(['sat'], ['morning']) }, false, now).fit
   && M.prnFit(K(), { notice: 'few_hours', windows: W(['sat'], ['morning']) }, false, new Date(nextSat + 'T05:00:00')).why === "needs a few hours' notice")
ck('not a fit, said plainly: the day, the time of day, 24/48 hours\' notice, already working', M.prnFit(K(), { windows: W(['sun'], ['morning']) }, false, now).why === 'not available Saturdays'
   && M.prnFit(K({ shift_time: '18:00-22:00' }), { windows: W(['sat'], ['morning']) }, false, now).why === 'not available Saturdays evenings'
   && M.prnFit(K(), { notice: '24h', windows: W(['sat'], ['morning']) }, false, now).why === "needs 24 hours' notice"
   && M.prnFit(K(), { notice: 'same_day', windows: W(['sat'], ['morning']) }, true, now).why === 'already working then')
ck('time bands match the availability page (Daytime is stored as afternoon)', M.bandOf('06:00') === 'morning' && M.bandOf('12:00') === 'afternoon' && M.bandOf('17:30') === 'evening' && M.bandOf('23:00') === 'overnight' && M.bandOf('03:00') === 'overnight')
ck('which cases are regular openings', M.isOngoingCase({ shift_pattern: { kind: 'open_ongoing' } }) && M.isOngoingCase({ reason: 'open' }) && M.isOngoingCase({ kind: 'interest' })
   && !M.isOngoingCase({ reason: 'calloff' }) && !M.isOngoingCase({ shift_pattern: { kind: 'one_time' } }))
ck('the PRN wording: accept or decline, no pressure, and no pay in it', /No pressure either way/.test(M.PRN_DEFAULT_MSG) && !/\$|\/hr|pay|rate/i.test(M.PRN_DEFAULT_MSG))

/* ── the list the office sees ── */
/* tomorrow 7am: at least ~7 hours away (fits same day and "a few hours"), always under 48 */
const ALL = W(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], ['morning'])
reset(K({ shift_date: inDays(1) })); APP.caregiver_availability.forEach((a) => { a.windows = ALL }); let j = await act({ action: 'candidates', case_id: 'cv1' })
ck('a 7am call-off tomorrow: Sarah and Jess (PRN, fit) first; Maria (PRN, needs 48 hours) listed apart; Ann and Bob where they always were',
   JSON.stringify(names(j.group0).sort()) === JSON.stringify(['Jess Prn', 'Sarah Prn']) && JSON.stringify(names(j.prn_other)) === JSON.stringify(['Maria Prn'])
   && j.prn_other[0].prn.why === "needs 48 hours' notice" && JSON.stringify(names(j.group2).sort()) === JSON.stringify(['Ann Regular', 'Bob Regular']) && !j.prn_ongoing.length, j)
ck('an ongoing caregiver (moved off the PRN Team) is treated like everyone else', names(j.group2).includes('Ann Regular') && !names(j.group0).includes('Ann Regular'))
ck('the most recently confirmed availability leads the PRN group', j.group0[0].name === 'Sarah Prn', names(j.group0))
VISITS = [{ caregiver: { id: 9001 }, client: { firstName: 'Other' }, scheduledStartDate: nextSat + 'T06:00:00', scheduledEndDate: nextSat + 'T09:00:00' }]
APP.coverage_cases = [K()]; j = await act({ action: 'candidates', case_id: 'cv1' })
ck('a PRN member already working then is not in the fit group', !names(j.group0).includes('Sarah Prn') && j.prn_other.some((x) => x.name === 'Sarah Prn' && x.prn.why === 'already working then'), j)
reset(K({ reason: 'open', shift_pattern: { v: 2, kind: 'open_ongoing', weekday: 'Saturday' } })); j = await act({ action: 'candidates', case_id: 'cv1' })
ck('a regular opening: no PRN group; all three PRN listed apart ("would mean moving to ongoing"); the rest unchanged',
   !j.group0.length && !j.prn_other.length && names(j.prn_ongoing).length === 3 && /moving to ongoing at \$18/.test(j.meta.prn_case) && names(j.group2).includes('Bob Regular'), j)

/* ── what gets sent ── */
reset(K()); j = await act({ action: 'send_selected', case_id: 'cv1', recipients: ['Sarah Prn', 'Bob Regular'] })
const toS = SENT.find((m) => m.to === 'C:+14175550101' || /Sarah/.test(m.msg)), toB = SENT.find((m) => /Bob/.test(m.msg))
ck('staff send: Sarah gets the PRN wording, Bob the usual one; the ask is marked PRN', j.sent?.length === 2 && /PRN opportunity/.test(toS?.msg || '') && /No pressure either way/.test(toS?.msg || '')
   && !/PRN/.test(toB?.msg || '') && APP.coverage_cases[0].asked.find((a) => a.name === 'Sarah Prn')?.prn === true, [j, SENT])
ck('... and no pay anywhere in what was sent', !SENT.some((m) => /\$\d|\/hr/.test(m.msg)), SENT)
reset(K()); j = await act({ action: 'send_selected', case_id: 'cv1', recipients: ['Maria Prn'] })
ck('a PRN member who doesn\'t fit can still be asked on purpose (unticked, never automatic)', j.sent?.length === 1, j)
reset(K({ reason: 'open', shift_pattern: { v: 2, kind: 'open_ongoing' } })); j = await act({ action: 'send_selected', case_id: 'cv1', recipients: ['Jess Prn'] })
ck('a regular opening asked of a PRN member uses the ordinary ongoing ask, not the PRN wording', j.sent?.length === 1 && !/PRN opportunity/.test(SENT[0]?.msg || ''), [j, SENT])

/* ── the source: the waves ── */
const code = fs.readFileSync(`${FN}/coverage-run/index.ts`, 'utf8')
ck('automatic waves: PRN who fit get tier 0 (first); PRN who don\'t fit, or any PRN on a regular opening, are left out', /x\.tier = 0; x\.tier_why = 'PRN CNA Team, fits this shift'/.test(code)
   && /cands\.filter\(x => x\.may_autosend && !x\.prn_skip\)/.test(code) && /ongoingW \? 'PRN Team: a regular opening'/.test(code))
ck('nothing in coverage reads or writes pay', !/pay_rates|payRate|\.rate\b|\$20|\$18\b/.test(code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/moving to ongoing at \$18/g, '')))
for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
