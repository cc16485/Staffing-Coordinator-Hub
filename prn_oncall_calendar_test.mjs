// PRN CNA ON-CALL CALENDAR (Samantha 2026-10-29, decisions 22 to 27). The rules (_shared/prn-oncall.ts), the REAL prn-week and
// prn-page with the REAL staff check against a fake database, coverage-run's hold (its source), and the SQL on a throwaway
// Postgres when PGLITE is set. Nothing real is reached.
// node prn_oncall_calendar_test.mjs   (PGLITE=<path to @electric-sql/pglite/dist/index.js> for the SQL part)
import fs from 'fs'; import path from 'path'; import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions'
const O = await import(path.join(process.cwd(), F, '_shared/prn-oncall.ts'))
const PP = await import(path.join(process.cwd(), F, '_shared/prn-page.ts'))
const L = await import(path.join(process.cwd(), F, '_shared/prn-page-links.ts'))

/* ── 1. the rules ── */
const TODAY = '2026-10-29'   // a Thursday
const M = [{ applicant_id: 'g', name: 'Grace Hill', first: 'Grace', team: 'cna', axiscare_id: '11' }, { applicant_id: 'd', name: 'Denise Gough', first: 'Denise', team: 'cna', axiscare_id: '22' },
  { applicant_id: 't', name: 'Tasha Fox', first: 'Tasha', team: 'caregiver', axiscare_id: '33' }]
const C = (id, aid, date, shift, o = {}) => ({ id, kind: 'confirmed', applicant_id: aid, start_date: date, end_date: o.end || date, shift, cancelled_at: null, ...o })
const A = (id, aid, date, shift, o = {}) => ({ id, kind: 'asked', applicant_id: aid, start_date: date, end_date: date, shift, cancelled_at: null, ...o })
ck('the two shifts: daytime 7am to 5pm, overnight 5pm to 7am the next morning', JSON.stringify(O.slotWindow('2026-11-07', 'day')) === '["2026-11-07T07:00","2026-11-07T17:00"]'
  && JSON.stringify(O.slotWindow('2026-11-07', 'overnight')) === '["2026-11-07T17:00","2026-11-08T07:00"]')
ck('...a whole day, or an older row with no shift, is both shifts on every date in it', O.slotsOf(C(1, 'g', '2026-11-07', 'whole')).length === 2 && O.slotsOf(C(1, 'g', '2026-11-07', null, { end: '2026-11-08' })).length === 4)

const rows = [C(1, 'g', '2026-11-02', 'day'), C(2, 'd', '2026-11-02', 'overnight'), A(3, 'd', '2026-11-03', 'day'), A(4, 'g', '2026-11-03', 'day'),
  C(5, 'g', '2026-11-04', 'whole'), C(6, 'd', '2026-11-05', 'day', { cancelled_at: 'x' }), C(7, 'd', '2026-10-27', 'day')]
const marks = [{ applicant_id: 'd', oncall_id: 2, kind: 'no_answer', at: '2026-11-02T23:00' }]
const cal = O.calendar({ rows, marks, members: M, today: TODAY })
const day = (d) => cal.find((x) => x.date === d)
ck('22: the calendar starts Monday of this week and shows 4 weeks, every day', cal.length === 28 && cal[0].date === '2026-10-26' && cal[27].date === '2026-11-22', [cal[0].date, cal.length])
ck('...days before today are past, never gaps', day('2026-10-27').past && !day('2026-10-27').day.gap && day('2026-10-27').day.confirmed[0].name === 'Denise Gough')
ck('...a confirmed shift shows who', day('2026-11-02').day.confirmed.map((p) => p.name).join() === 'Grace Hill' && !day('2026-11-02').day.gap)
ck('...a missed shift shows it, and counts as a gap', day('2026-11-02').overnight.confirmed[0].missed === 'no_answer' && day('2026-11-02').overnight.gap)
ck('...asks wait on the shift, everyone who asked', day('2026-11-03').day.asked.map((p) => p.name).join() === 'Denise Gough,Grace Hill' && day('2026-11-03').day.gap)
ck('...a whole day fills both shifts', day('2026-11-04').day.confirmed[0].whole && day('2026-11-04').overnight.confirmed[0].name === 'Grace Hill')
ck('...a taken-back shift is gone (an open gap)', !day('2026-11-05').day.confirmed.length && day('2026-11-05').day.gap)

const NOW = '2026-10-29T10:00'
const ms = O.memberSlots({ rows, aid: 'd', today: TODAY, nowNaive: NOW })
const msd = (d) => ms.find((x) => x.date === d)
ck('23: their page shows today plus 4 weeks', ms.length === 28 && ms[0].date === TODAY)
ck('...mine / asked / taken / open, never another person\'s name', msd('2026-11-02').overnight.state === 'mine' && msd('2026-11-03').day.state === 'asked' && msd('2026-11-03').day.id === 3
  && msd('2026-11-02').day.state === 'taken' && msd('2026-11-05').day.state === 'open' && !/Grace|Hill/.test(JSON.stringify(ms)), [msd('2026-11-02'), msd('2026-11-03')])
ck('...a shift starting within 2 hours (or already started) can\'t be asked for', msd(TODAY).day.state === 'past' && O.memberSlots({ rows: [], aid: 'd', today: TODAY, nowNaive: '2026-10-29T15:30' })[0].overnight.state === 'past'
  && O.memberSlots({ rows: [], aid: 'd', today: TODAY, nowNaive: '2026-10-29T15:00' })[0].overnight.state === 'past' && O.memberSlots({ rows: [], aid: 'd', today: TODAY, nowNaive: '2026-10-29T14:59' })[0].overnight.state === 'open')
ck('27: their own shift can be given back (by calling) only 24 hours or more ahead', msd('2026-11-02').overnight.can_give_back === true
  && O.memberSlots({ rows: [C(9, 'd', '2026-10-30', 'day')], aid: 'd', today: TODAY, nowNaive: NOW })[1].day.can_give_back === false)

const ok = O.readAsks({ slots: [{ date: '2026-11-06', slot: 'day' }, { date: '2026-11-06', slot: 'overnight' }, { date: '2026-11-06', slot: 'day' }] }, { rows, aid: 'd', today: TODAY, nowNaive: NOW })
ck('...asks: open shifts, repeats ignored', ok.ok && ok.slots.length === 2, ok)
ck('...a taken shift is refused', /Someone just took/.test(O.readAsks({ slots: [{ date: '2026-11-02', slot: 'day' }] }, { rows, aid: 'd', today: TODAY, nowNaive: NOW }).error))
ck('...one they already have, too soon, beyond 4 weeks, a made-up shift: refused', !O.readAsks({ slots: [{ date: '2026-11-03', slot: 'day' }] }, { rows, aid: 'd', today: TODAY, nowNaive: NOW }).ok
  && /too soon/.test(O.readAsks({ slots: [{ date: TODAY, slot: 'day' }] }, { rows, aid: 'd', today: TODAY, nowNaive: NOW }).error)
  && /next 4 weeks/.test(O.readAsks({ slots: [{ date: '2026-12-30', slot: 'day' }] }, { rows, aid: 'd', today: TODAY, nowNaive: NOW }).error)
  && !O.readAsks({ slots: [{ date: '2026-11-06', slot: 'evening' }] }, { rows, aid: 'd', today: TODAY, nowNaive: NOW }).ok && !O.readAsks({}, { rows, aid: 'd', today: TODAY, nowNaive: NOW }).ok)
const many = Array.from({ length: 10 }, (_, i) => A(100 + i, 'd', O.addDays('2026-11-06', i), 'day'))
ck(`...at most ${O.MAX_OPEN_ASKS} waiting for the office at a time`, /up to 10/.test(O.readAsks({ slots: [{ date: '2026-11-20', slot: 'overnight' }] }, { rows: many, aid: 'd', today: TODAY, nowNaive: NOW }).error))

ck('24: the expectations are her approved words, all six points', O.TERMS_DEFAULT.startsWith('PRN CNA On-Call Expectations\nWhen you sign up for an on-call shift, families are counting on you.')
  && /5\. If you don't answer the office within 15 minutes, or you don't cover the shift, you won't be paid for that on-call shift, and you won't be able to sign up for on call again\./.test(O.TERMS_DEFAULT)
  && /6\. If something comes up, call the office at least 24 hours before your on-call shift starts\. To stop an every-week on-call shift, call the office at least 24 hours before the next one starts\.$/.test(O.TERMS_DEFAULT) && O.TERMS_DEFAULT.split('\n').length === 8 && !/—/.test(O.TERMS_DEFAULT))
const V = O.termsVersion(O.TERMS_DEFAULT)
ck('...a version from the exact words: the same words, the same version; any change, a new one', /^v[0-9a-f]{8}$/.test(V) && O.termsVersion(O.TERMS_DEFAULT + '\n') === V && O.termsVersion(O.TERMS_DEFAULT.replace('15 minutes', '10 minutes')) !== V
  && O.termsVersion(O.termsText({ prn_oncall_terms: 'Different words for the expectations.' })) !== V && O.termsText({}) === O.TERMS_DEFAULT)
ck('...signing: the box, the current version, their own full name', O.readSign({ agree: true, version: V, typed_name: ' Denise  Gough ' }, V, 'Denise', 'Gough').typed === 'Denise Gough'
  && /Check the box/.test(O.readSign({ version: V, typed_name: 'Denise Gough' }, V, 'Denise', 'Gough').error)
  && /changed while you were reading/.test(O.readSign({ agree: true, version: 'v00000000', typed_name: 'Denise Gough' }, V, 'Denise', 'Gough').error)
  && /first and last/.test(O.readSign({ agree: true, version: V, typed_name: 'Denise' }, V, 'Denise', 'Gough').error)
  && /your own full name/.test(O.readSign({ agree: true, version: V, typed_name: 'Mickey Mouse' }, V, 'Denise', 'Gough').error))
ck('...signed = this version signed', O.signedCurrent([{ applicant_id: 'd', version: V }], 'd', V) && !O.signedCurrent([{ applicant_id: 'd', version: 'v00000000' }], 'd', V))

ck('25: a miss blocks sign-up; an owner\'s "sign up again" lifts it; a later miss blocks again', O.blockOf(marks, 'd').blocked && O.blockOf(marks, 'd').miss.word === "Didn't answer our call"
  && !O.blockOf([...marks, { applicant_id: 'd', kind: 'lifted', at: '2026-11-03T09:00' }], 'd').blocked
  && O.blockOf([...marks, { applicant_id: 'd', kind: 'lifted', at: '2026-11-03T09:00' }, { applicant_id: 'd', oncall_id: 9, kind: 'not_covered', at: '2026-11-09T09:00' }], 'd').blocked
  && !O.blockOf(marks, 'g').blocked && !O.blockOf([{ applicant_id: 'g', kind: 'covering', oncall_id: 1, at: 'x' }], 'g').blocked)
const back = O.takeBackOnMiss([...rows, C(8, 'd', '2026-11-10', 'day'), A(10, 'd', '2026-11-11', 'overnight')], 'd', 2, TODAY).map((r) => r.id)
ck('...a miss takes back their other future shifts and asks, never the missed one, never the past or someone else\'s', back.join() === '3,8,10', back)

const pay = O.payMonth([...rows, C(11, 'g', '2026-11-04', 'day'), C(12, 'd', '2026-11-21', null, { end: '2026-11-22' }), C(13, 'd', '2026-11-14', 'day'), C(14, 'd', '2026-11-14', 'overnight')], marks, M, '2026-11')
ck('payroll: daytime, overnight, whole days (both on one date), older rows, and missed ones (not paid), counts only', JSON.stringify(pay) === JSON.stringify([
  { applicant_id: 'd', name: 'Denise Gough', day: 0, overnight: 0, whole: 1, not_recorded: 2, missed: 1 }, { applicant_id: 'g', name: 'Grace Hill', day: 1, overnight: 0, whole: 1, not_recorded: 0, missed: 0 }]) && !/\$/.test(JSON.stringify(pay)), pay)

/* decision 26 */
const K = (o = {}) => ({ id: 'cv1', status: 'open', client: 'Ruth Lane', shift_date: '2026-11-02', shift_time: '19:00-23:00', opened_at: '2026-11-02T23:50:00Z', ...o })
ck('26: the CNA on call when the shift starts', O.onCallNow({ c: K({ shift_time: '09:00-13:00' }), rows, marks: [], members: M })?.name === 'Grace Hill'
  && O.onCallNow({ c: K({ shift_time: '09:00-13:00' }), rows, marks: [], members: M }).slot === 'day')
ck('...an overnight covers the early morning of the next day', O.onCallNow({ c: K({ shift_date: '2026-11-03', shift_time: '06:30-10:00' }), rows, marks: [], members: M })?.name === 'Denise Gough'
  && !O.onCallNow({ c: K({ shift_date: '2026-11-03', shift_time: '07:00-10:00' }), rows, marks: [], members: M }))
ck('...not someone who already missed that on-call shift, not the person calling off, not a taken-back shift, not an ask',
  !O.onCallNow({ c: K(), rows, marks, members: M }) && !O.onCallNow({ c: K({ shift_time: '09:00-13:00', calling_off_id: '11' }), rows, marks: [], members: M })
  && !O.onCallNow({ c: K({ shift_date: '2026-11-05', shift_time: '09:00-13:00' }), rows, marks: [], members: M }) && !O.onCallNow({ c: K({ shift_date: '2026-11-03', shift_time: '09:00-13:00' }), rows, marks: [], members: M }))
ck('...no time on the case: nobody (nothing to match)', !O.onCallNow({ c: K({ shift_time: '' }), rows, marks: [], members: M }))
const n = O.onCallNow({ c: K({ shift_time: '09:00-13:00' }), rows, marks: [], members: M })
const opened = Date.parse('2026-11-02T14:00:00Z')
ck(`...the automatic texts wait until the office records the call, at most ${O.HOLD_MIN} minutes after the case opened`,
  O.holdFor({ c: K({ opened_at: new Date(opened).toISOString() }), now: n, marks: [], nowMs: opened + 5 * 60000 }).hold
  && O.holdFor({ c: K({ opened_at: new Date(opened).toISOString() }), now: n, marks: [], nowMs: opened + 5 * 60000 }).until === new Date(opened + 20 * 60000).toISOString()
  && !O.holdFor({ c: K({ opened_at: new Date(opened).toISOString() }), now: n, marks: [], nowMs: opened + 21 * 60000 }).hold
  && !O.holdFor({ c: K({ opened_at: new Date(opened).toISOString() }), now: n, marks: [{ case_id: 'cv1', kind: 'no_answer', at: 'x' }], nowMs: opened + 5 * 60000 }).hold
  && !O.holdFor({ c: K({ opened_at: '' }), now: n, marks: [], nowMs: opened }).hold && !O.holdFor({ c: K(), now: null, marks: [], nowMs: opened }).hold)
ck('...the latest outcome on a case wins (a yes, then a miss)', O.outcomeFor([{ case_id: 'cv1', kind: 'covering', at: '1' }, { case_id: 'cv1', kind: 'not_covered', at: '2' }, { case_id: 'cv2', kind: 'covering', at: '3' }], 'cv1').kind === 'not_covered')
const ask = O.onCallAsk({ id: 'a1', name: 'Grace Hill', phone: '4175550101', ax: '11', key: '2026-11-02|09:00-13:00', now: 'T', by: 'Krystal' })
ck('..."Covering it" is a Yes on the case, said on the phone, from on call (the board confirms it the usual way)', ask.state === 'yes' && ask.from_oncall === true && ask.axiscare_id === '11' && ask.offered_for === '2026-11-02|09:00-13:00' && ask.auto === false && ask.ghl_contact_id === null)

/* This week line from their page */
const pl = PP.pageLines({ members: [{ applicant_id: 'd', name: 'Denise Gough', first: 'Denise', team: 'cna' }], log: [{ id: 7, applicant_id: 'd', kind: 'oncall_ask', note: '2026-11-06 day, 2026-11-06 overnight', at: 'x' }], touches: [], today: TODAY })
ck('This week: "Denise asked for 2 on-call shifts", to the calendar', pl.length === 1 && pl[0].kind === 'oncall' && pl[0].title === 'Denise asked for 2 on-call shifts' && /On call calendar/.test(pl[0].detail), pl)

/* ── 2. the real prn-week and prn-page against a fake database ── */
const GRACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', DEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', TASHA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
let T, EVENTS, RPC, NID
const dayN = (k) => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const reset = (settings = {}) => { EVENTS = []; RPC = []; NID = 100; T = {
  app_data: [{ key: 'ops_settings', data: { prn_page_live: true, ...settings } }, { key: 'coverage_cases', data: [{ id: 'cv1', status: 'open', client: 'Ruth Lane', shift_date: dayN(3), shift_time: '09:00-13:00', opened_at: new Date().toISOString(), asked: [] }] }],
  pay_tracks: [{ applicant_id: GRACE, track: 'prn_team', team: 'cna', since: dayN(-60), axiscare_caregiver_id: '11' }, { applicant_id: DEN, track: 'prn_team', team: 'cna', since: dayN(-60), axiscare_caregiver_id: '22' },
    { applicant_id: TASHA, track: 'prn_team', team: 'caregiver', since: dayN(-5), axiscare_caregiver_id: null }],
  job_applicants: [{ id: GRACE, first_name: 'Grace', last_name: 'Hill', phone: '4175550101', prn: {} }, { id: DEN, first_name: 'Denise', last_name: 'Gough', phone: '4175550202', prn: {} }, { id: TASHA, first_name: 'Tasha', last_name: 'Fox', phone: '4175550303', prn: {} }],
  prn_shift_log: [], prn_touches: [], prn_oncall: [], prn_oncall_marks: [], prn_oncall_terms: [], prn_page_log: [], prn_monthly: [],
  auth_identities: [{ auth_user_id: 'u-kr', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-kr' }, { auth_user_id: 'u-sa', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-sa' }],
  persons: [{ person_id: 'p-kr', full_name: 'Krystal Office', active: true }, { person_id: 'p-sa', full_name: 'Samantha Owner', active: true }],
  entity_memberships: [{ person_id: 'p-kr', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-sa', entity: 'cc_ihs', active: true, ended_at: null }],
  staff_roles: [{ person_id: 'p-kr', entity: 'cc_ihs', role: 'staffing_coordinator' }, { person_id: 'p-sa', entity: 'cc_ihs', role: 'owner_admin' }], op_events: [] } }
const UNIQ = { prn_oncall_terms: (a, r) => a.applicant_id === r.applicant_id && a.version === r.version,
  prn_oncall_marks: (a, r) => (r.case_id && a.case_id === r.case_id && a.kind === r.kind) || (['no_answer', 'not_covered'].includes(r.kind) && ['no_answer', 'not_covered'].includes(a.kind) && a.oncall_id === r.oncall_id),
  prn_oncall: (a, r) => !a.cancelled_at && a.kind === r.kind && a.applicant_id === r.applicant_id && a.start_date === r.start_date && (a.shift || '') === (r.shift || '') && r.kind !== 'offer' }
const q = (t) => { const st = { f: [], inF: [], nul: [], gte: [], lte: [], upd: null }; const b = {
  select() { return b }, order() { return b }, limit() { return b }, not() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF.push([c, v]); return b }, is(c, v) { if (v === null) st.nul.push(c); return b },
  gte(c, v) { st.gte.push([c, v]); return b }, lte(c, v) { st.lte.push([c, v]); return b }, update(o) { st.upd = o; return b },
  insert(row) { if (t === 'op_events') { EVENTS.push(row); return Promise.resolve({ data: null, error: null }) }
    const arr = (T[t] ||= []); if (UNIQ[t] && arr.some((a) => UNIQ[t](a, row))) return Promise.resolve({ data: null, error: { message: 'duplicate key value violates unique constraint' } })
    arr.push({ id: NID++, at: new Date().toISOString(), agreed_at: new Date().toISOString(), cancelled_at: null, ...row }); return Promise.resolve({ data: null, error: null }) },
  rows() { if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return T.app_data.filter((x) => x.key === k) }
    let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); for (const [c, v] of st.inF) r = r.filter((x) => v.includes(x[c])); for (const c of st.nul) r = r.filter((x) => x[c] == null)
    for (const [c, v] of st.gte) r = r.filter((x) => String(x[c]) >= v); for (const [c, v] of st.lte) r = r.filter((x) => String(x[c]) <= v); return r },
  maybeSingle() { return Promise.resolve({ data: JSON.parse(JSON.stringify(b.rows()[0] ?? null)), error: null }) },
  then(ok, bad) { if (st.upd) { for (const x of b.rows()) Object.assign(x, st.upd); return Promise.resolve({ data: null, error: null }).then(ok, bad) }
    return Promise.resolve({ data: JSON.parse(JSON.stringify(b.rows())), error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { RPC.push([fn, a]); if (fn === 'coverage_case_add_ask') { const c = T.app_data.find((x) => x.key === 'coverage_cases').data.find((x) => x.id === a.p_id); if (!c || c.status !== 'open') return { data: 'not_open', error: null }; c.asked.push(a.p_ask); return { data: 'added', error: null } } return { data: null, error: null } },
  auth: { getUser: async (jwt) => jwt === 'kr' ? { data: { user: { id: 'u-kr', email: 'krystal@mo-care.com', app_metadata: {} } }, error: null }
    : jwt === 'sa' ? { data: { user: { id: 'u-sa', email: 'samantha@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
globalThis.fetch = async () => new Response('{}', { status: 404 })
const SECRET = 'S'.repeat(48)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: '', GHL_LOCATION_ID: '', HUB_JOB_SECRET: SECRET }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_oc_'))
const load = async (name) => { const src = fs.readFileSync(path.join(F, name, 'index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, name + '.ts'), src); await import(path.join(tmp, name + '.ts')); return handler }
try {
  const week = await load('prn-week'), page = await load('prn-page')
  const call = async (h, fn, body, jwt) => { const r = await h(new Request('https://x/functions/v1/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: JSON.stringify(body) }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
  const W = (body, jwt = 'kr') => call(week, 'prn-week', body, jwt)
  const link = async (aid) => Object.fromEntries(new URL(await L.makePageLink(SECRET, aid, L.pageExpiry(Math.floor(Date.now() / 1000)))).searchParams)
  const P = async (aid, body) => call(page, 'prn-page', { ...(await link(aid)), ...body })
  const d5 = dayN(5), d6 = dayN(6)

  /* the member side, switch off */
  reset(); let r = await P(DEN, { action: 'view' })
  ck('page, sign-up switch off: nothing new on their page', r.j.ok && r.j.oncall && !r.j.oncall.signup, r.j.oncall)
  r = await P(DEN, { action: 'oncall_ask', slots: [{ date: d5, slot: 'day' }] })
  ck('...and asking is refused, nothing saved', r.status === 409 && !T.prn_oncall.length)
  r = await call(page, 'prn-page', { action: 'preview', applicant_id: DEN }, 'kr')
  ck('...the office preview shows the sign-up anyway, marked waiting', r.j.oncall.signup?.ready && r.j.oncall.signup.waiting === true && r.j.oncall.signup.slots.length === 28 && r.j.oncall.signup.terms === O.TERMS_DEFAULT, r.j.oncall)

  /* switch on */
  reset({ prn_oncall_signup_live: true }); r = await P(DEN, { action: 'view' })
  const ver = r.j.oncall.signup.version
  ck('page, switch on: the calendar, the words to sign, not signed yet', r.j.oncall.signup.ready && !r.j.oncall.signup.signed && ver === V && r.j.oncall.signup.slots[5].day.state === 'open')
  r = await P(DEN, { action: 'oncall_ask', slots: [{ date: d5, slot: 'day' }] })
  ck('24: no sign-up before signing the expectations', r.status === 409 && r.j.sign === true && !T.prn_oncall.length, r.j)
  r = await P(DEN, { action: 'oncall_sign', agree: true, version: ver, typed_name: 'Denise Gough' })
  ck('...signing keeps the exact words, the version, the typed name', r.j.ok && T.prn_oncall_terms.length === 1 && T.prn_oncall_terms[0].body === O.TERMS_DEFAULT && T.prn_oncall_terms[0].version === V && T.prn_oncall_terms[0].typed_name === 'Denise Gough'
    && T.prn_page_log.some((x) => x.kind === 'oncall_signed'), [r.j, T.prn_oncall_terms])
  r = await P(DEN, { action: 'oncall_ask', slots: [{ date: d5, slot: 'day' }, { date: d6, slot: 'overnight' }] })
  ck('23: their asks land as "asked", one shift each, and This week hears of it', r.j.ok && T.prn_oncall.length === 2 && T.prn_oncall.every((x) => x.kind === 'asked' && x.start_date === x.end_date)
    && T.prn_page_log.some((x) => x.kind === 'oncall_ask' && /day/.test(x.note)) && /office will confirm them/.test(r.j.message), [r.j, T.prn_oncall])
  r = await P(TASHA, { action: 'oncall_ask', slots: [{ date: d5, slot: 'overnight' }] })
  ck('...the PRN Caregiver Team can\'t (CNA only for now)', r.status === 409)
  r = await P(DEN, { action: 'view' })
  ck('...their page shows them as asked', r.j.oncall.signup.signed && r.j.oncall.signup.slots.find((x) => x.date === d5).day.state === 'asked')
  const askD5 = T.prn_oncall.find((x) => x.start_date === d5), askD6 = T.prn_oncall.find((x) => x.start_date === d6)
  r = await P(GRACE, { action: 'oncall_withdraw', id: askD5.id })
  ck('...nobody can take back someone else\'s ask', r.status === 404 && !askD5.cancelled_at)

  /* the office */
  r = await W({ action: 'week' })
  const cd = r.j.oncall.calendar.find((x) => x.date === d5)
  ck('22: week returns the calendar with the ask, who signed, the switches', cd.day.asked[0].name === 'Denise Gough' && r.j.oncall.people.find((p) => p.applicant_id === DEN).signed === true
    && r.j.oncall.people.find((p) => p.applicant_id === GRACE).signed === false && r.j.oncall.signup_live === true && r.j.oncall.first_live === false && r.j.oncall.records_ready === true
    && r.j.oncall.terms_version === V && r.j.oncall.people.length === 2, r.j.oncall.people)
  r = await W({ action: 'oncall_confirm', ask_id: askD5.id })
  ck('23: one tap confirms the ask: a confirmed row from it, the ask off the waiting list', r.j.outcome === 'recorded' && T.prn_oncall.some((x) => x.kind === 'confirmed' && x.ask_id === askD5.id && x.shift === 'day' && x.start_date === d5)
    && /^Confirmed by Krystal/.test(askD5.cancelled_by) && EVENTS.some((e) => /as they asked/.test(e.summary)), [r.j, T.prn_oncall])
  r = await W({ action: 'oncall_confirm', ask_id: askD5.id })
  ck('...twice: refused, nothing doubled', r.status === 409 && T.prn_oncall.filter((x) => x.kind === 'confirmed').length === 1)
  r = await W({ action: 'oncall_confirm', applicant_id: GRACE, date: d5, shift: 'day' })
  ck('...one person per shift (Grace can\'t be put on Denise\'s shift), and Grace hasn\'t signed anyway', r.status === 409 && T.prn_oncall.filter((x) => x.kind === 'confirmed').length === 1, r.j)
  T.prn_oncall_terms.push({ applicant_id: GRACE, version: V, typed_name: 'Grace Hill', agreed_at: 'x' })
  r = await W({ action: 'oncall_confirm', applicant_id: GRACE, date: d5, shift: 'day' })
  ck('...even once she signed: "Denise Gough is already on call then"', r.status === 409 && /Denise Gough is already on call/.test(r.j.error), r.j)
  r = await W({ action: 'oncall_confirm', applicant_id: GRACE, date: d5, shift: 'whole' })
  ck('...a whole day clashes too', r.status === 409)
  r = await W({ action: 'oncall_confirm', applicant_id: GRACE, date: d5, shift: 'overnight' })
  ck('...the office can put a signed person on an open shift directly', r.j.outcome === 'recorded' && T.prn_oncall.some((x) => x.applicant_id === GRACE && x.shift === 'overnight'))
  r = await W({ action: 'oncall_confirm', applicant_id: GRACE, date: d6, shift: '' })
  ck('...a single date needs a shift', r.status === 400)
  r = await W({ action: 'oncall_decline', ask_id: askD6.id })
  ck('..."Not this one" on an ask: kept, marked', r.j.outcome === 'cancelled' && /^Not this one/.test(askD6.cancelled_by))

  /* decision 26: an open shift during Denise's on-call time */
  const kase = T.app_data.find((x) => x.key === 'coverage_cases').data[0]; kase.shift_date = d5; kase.shift_time = '09:00-13:00'
  r = await W({ action: 'oncall_now' })
  ck('26: oncall_now finds Denise for the open shift, with her phone; practice (no hold) while the switch is off', r.j.cases.length === 1 && r.j.cases[0].name === 'Denise Gough' && r.j.cases[0].phone === '+14175550202'
    && r.j.cases[0].hold_until === null && r.j.live === false, r.j)
  T.app_data[0].data.prn_oncall_first_live = true
  r = await W({ action: 'oncall_now' })
  ck('...switch on: the texts wait until a time', r.j.live && /^\d{4}-/.test(r.j.cases[0].hold_until), r.j)
  const dc = T.prn_oncall.find((x) => x.kind === 'confirmed' && x.applicant_id === DEN)
  r = await W({ action: 'oncall_mark', oncall_id: dc.id, kind: 'covering', case_id: 'cv1' })
  ck('..."Covering it": recorded, and her Yes is on the case for the board', r.j.outcome === 'covering' && r.j.on_case === 'added' && kase.asked.length === 1 && kase.asked[0].from_oncall === true && kase.asked[0].axiscare_id === '22'
    && T.prn_oncall_marks[0].kind === 'covering', [r.j, kase.asked])
  r = await W({ action: 'oncall_now' })
  ck('...then the texts don\'t wait any more, and the card shows how it went', r.j.cases[0].outcome.word === 'Covering it' && r.j.cases[0].hold_until === null)
  r = await W({ action: 'oncall_mark', oncall_id: dc.id, kind: 'covering', case_id: 'cv1' })
  ck('...twice: already', r.j.outcome === 'already' && kase.asked.length === 1)
  r = await W({ action: 'oncall_mark', oncall_id: dc.id, kind: 'covering' })
  ck('..."Covering it" needs the open shift', r.status === 400)

  /* decision 25: a miss */
  const p3 = T.prn_oncall.length
  T.prn_oncall.push({ id: 900, kind: 'confirmed', applicant_id: DEN, start_date: dayN(9), end_date: dayN(9), shift: 'overnight', cancelled_at: null }, { id: 901, kind: 'asked', applicant_id: DEN, start_date: dayN(10), end_date: dayN(10), shift: 'day', cancelled_at: null },
    { id: 902, kind: 'confirmed', applicant_id: DEN, start_date: dayN(-3), end_date: dayN(-3), shift: 'day', cancelled_at: null })
  r = await W({ action: 'oncall_mark', oncall_id: dc.id, kind: 'not_covered', case_id: 'cv1', note: 'Said yes, never came' })
  ck('25: a miss after a yes: recorded, her other future shifts and asks taken back (not the past one), listed back with her phone to call',
    r.j.outcome === 'missed' && r.j.taken_back.length === 2 && T.prn_oncall.find((x) => x.id === 900).cancelled_at && T.prn_oncall.find((x) => x.id === 901).cancelled_at
    && !T.prn_oncall.find((x) => x.id === 902).cancelled_at && !dc.cancelled_at && r.j.phone === '+14175550202' && EVENTS.some((e) => e.verb === 'prn_oncall_missed'), r.j)
  r = await W({ action: 'week' })
  ck('...the calendar and the people list show it (payroll counts misses: the rules above)', r.j.oncall.people.find((p) => p.applicant_id === DEN).blocked === true
    && r.j.oncall.calendar.find((x) => x.date === d5).day.confirmed[0].missed === 'not_covered' && Array.isArray(r.j.oncall.payroll), r.j.oncall)
  r = await P(DEN, { action: 'oncall_ask', slots: [{ date: dayN(12), slot: 'day' }] })
  ck('...she can\'t sign up again', r.status === 409 && /isn't open to you/.test(r.j.error))
  r = await W({ action: 'oncall_confirm', applicant_id: DEN, date: dayN(12), shift: 'day' })
  ck('...and the office can\'t put her on either', r.status === 409 && /missed an on-call shift/.test(r.j.error))
  r = await W({ action: 'oncall_lift', applicant_id: DEN, reason: 'Family emergency, talked it through' })
  ck('...only an owner lets her sign up again', r.status === 403)
  r = await W({ action: 'oncall_lift', applicant_id: DEN, reason: '' }, 'sa')
  ck('...with a reason', r.status === 400)
  r = await W({ action: 'oncall_lift', applicant_id: DEN, reason: 'Family emergency, talked it through' }, 'sa')
  ck('...then she can', r.j.outcome === 'lifted' && (await P(DEN, { action: 'oncall_ask', slots: [{ date: dayN(12), slot: 'day' }] })).j.ok)
  r = await W({ action: 'oncall_mark', oncall_id: 902, kind: 'no_answer' })
  ck('...a miss from the calendar (no case) works too', r.j.outcome === 'missed')
  void p3

  /* new words = sign again */
  T.app_data[0].data.prn_oncall_terms = O.TERMS_DEFAULT.replace('15 minutes', '10 minutes')
  r = await P(GRACE, { action: 'view' })
  ck('24: new wording: everyone signs again', r.j.oncall.signup.signed === false && r.j.oncall.signup.signed_before === true)
  r = await W({ action: 'week' })
  ck('...the office sees "signed an older version"', r.j.oncall.people.find((p) => p.applicant_id === GRACE).signed_old === true)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }

/* ── 3. coverage-run: the hold, from its source ── */
const cr = fs.readFileSync(path.join(F, 'coverage-run/index.ts'), 'utf8')
const sweep = cr.slice(cr.indexOf('const onCallHold ='), cr.indexOf('const onCallHold =') + 600)
ck('coverage-run: the sweep\'s waves wait for the on-call call (never a manual send)', /sendLive && !manualSelect && !planHold && !onCallHold && !hasYes/.test(cr) && /!manualSelect/.test(sweep))
ck('...Cara\'s waves wait too, logged once', /if \(step\.do === 'wave' && c\) \{\s*\/\*[^*]*\*\/\s*const och = await onCallHoldFor\(c, st\)/.test(cr) && /return 'held_oncall'/.test(cr))
const fnSrc = cr.slice(cr.indexOf('async function onCallHoldFor'), cr.indexOf('/* CI1 (2026-10-03): the caregiver night rule'))
ck('...only with prn_oncall_first_live on; any record it can\'t read = no hold', /prn_oncall_first_live !== true/.test(fnSrc) && /if \(oc\.error \|\| mk\.error \|\| tr\.error/.test(fnSrc) && /catch \{ return none \}/.test(fnSrc))
ck('no em dashes in anything people read', !/—/.test([fs.readFileSync(path.join(F, '_shared/prn-oncall.ts'), 'utf8'), fs.readFileSync(path.join(F, 'prn-week/index.ts'), 'utf8'), fs.readFileSync(path.join(F, 'prn-page/index.ts'), 'utf8')].join('').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').replace("/—/.test(message)", '')))

/* ── 4. the SQL ── */
if (process.env.PGLITE) {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE).href); const db = new PGlite()
  await db.exec(`create table public.job_applicants (id uuid primary key); insert into public.job_applicants values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');`)
  try { await db.exec(`do $$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $$;`) } catch { /* */ }
  for (const f of ['prn_week.sql', 'prn_oncall_shift.sql', 'prn_page.sql', 'prn_open_shifts.sql', 'prn_recognition.sql']) { try { await db.exec('begin;' + fs.readFileSync(f, 'utf8') + 'commit;') } catch (e) { await db.exec('rollback;').catch(() => {}); ck('SQL: ' + f + ' runs (setup)', false, e.message) } }
  const sql = fs.readFileSync('prn_oncall_calendar.sql', 'utf8')
  await db.exec('begin;' + sql + 'commit;'); await db.exec('begin;' + sql + 'commit;')
  const A1 = "'00000000-0000-0000-0000-000000000001'", A2 = "'00000000-0000-0000-0000-000000000002'"
  const tryQ = async (s) => { try { await db.query(s); return true } catch { return false } }
  const okAsk = await tryQ(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, shift, by_email) values (${A1}, 'asked', '2026-11-07', '2026-11-07', 'day', 'p')`)
  const dupAsk = await tryQ(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, shift, by_email) values (${A1}, 'asked', '2026-11-07', '2026-11-07', 'day', 'p')`)
  const wholeAsk = await tryQ(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, shift, by_email) values (${A1}, 'asked', '2026-11-08', '2026-11-08', 'whole', 'p')`)
  const longAsk = await tryQ(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, shift, by_email) values (${A1}, 'asked', '2026-11-08', '2026-11-09', 'day', 'p')`)
  const c1 = await tryQ(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, shift, by_email, ask_id) values (${A1}, 'confirmed', '2026-11-07', '2026-11-07', 'day', 'k', (select id from public.prn_oncall where kind = 'asked' limit 1))`)
  const c2 = await tryQ(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, shift, by_email) values (${A1}, 'confirmed', '2026-11-07', '2026-11-07', 'overnight', 'k')`)
  const clash = await tryQ(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, shift, by_email) values (${A2}, 'confirmed', '2026-11-07', '2026-11-07', 'day', 'k')`)
  ck('SQL: runs twice; asks are one day, one shift, once; day and overnight on one date for one person; never two people on one shift',
    okAsk && !dupAsk && !wholeAsk && !longAsk && c1 && c2 && !clash, { okAsk, dupAsk, wholeAsk, longAsk, c1, c2, clash })
  const id = (await db.query(`select id from public.prn_oncall where kind = 'confirmed' and shift = 'day'`)).rows[0].id
  const m1 = await tryQ(`insert into public.prn_oncall_marks (applicant_id, oncall_id, kind, case_id, by_email) values (${A1}, ${id}, 'covering', 'cv1', 'k')`)
  const m2 = await tryQ(`insert into public.prn_oncall_marks (applicant_id, oncall_id, kind, case_id, by_email) values (${A1}, ${id}, 'not_covered', 'cv1', 'k')`)
  const m3 = await tryQ(`insert into public.prn_oncall_marks (applicant_id, oncall_id, kind, by_email) values (${A1}, ${id}, 'no_answer', 'k')`)
  const lift0 = await tryQ(`insert into public.prn_oncall_marks (applicant_id, kind, by_email) values (${A1}, 'lifted', 'k')`)
  const lift = await tryQ(`insert into public.prn_oncall_marks (applicant_id, kind, note, by_email) values (${A1}, 'lifted', 'Talked it through', 'k')`)
  const edit = await tryQ(`update public.prn_oncall_marks set note = 'x'`)
  const sig = await tryQ(`insert into public.prn_oncall_terms (applicant_id, version, body, typed_name) values (${A1}, 'v0a1b2c3d', 'These are the on-call expectations.', 'Grace Hill')`)
  const sig2 = await tryQ(`insert into public.prn_oncall_terms (applicant_id, version, body, typed_name) values (${A1}, 'v0a1b2c3d', 'These are the on-call expectations.', 'Grace Hill')`)
  const sigEdit = await tryQ(`update public.prn_oncall_terms set typed_name = 'Someone Else'`), del = await tryQ(`delete from public.prn_oncall_terms`)
  const logOk = await tryQ(`insert into public.prn_page_log (applicant_id, kind) values (${A1}, 'oncall_ask')`)
  ck('SQL: a yes then a miss on one case; one miss per shift; "sign up again" needs a reason; marks and signatures are kept as written; the page log takes the new kinds',
    m1 && m2 && !m3 && !lift0 && lift && !edit && !del && sig && !sig2 && !sigEdit && logOk, { m1, m2, m3, lift0, lift, edit, del, sig, sig2, sigEdit, logOk })
} else ck('SQL on a throwaway Postgres (skipped: PGLITE not set)', true)

const fails = res.filter((r) => !r[1])
for (const [nm, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + nm + (okk ? '' : '  ' + note))
console.log(`\n${res.length - fails.length}/${res.length} passed`)
process.exit(fails.length ? 1 : 0)
