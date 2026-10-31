// ON CALL 7AM TO 7PM, AND WHICH SHIFTS ARE OFFERED (Samantha 2026-10-30, after the 1215 report: "can we build it set for 7am-7pm
// and 7pm-7am on call, and just show the open shifts being Friday, Saturday, and Sunday 7am-7pm. Allow owners to click to open
// on-call shifts right on the on-call tab"; rules T1 to T4 in _shared/prn-oncall.ts). The rules and the REAL prn-week and prn-page
// against a fake database. Nothing real is reached.   node oncall_7to7_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions'
const O = await import(path.join(process.cwd(), F, '_shared/prn-oncall.ts'))
const L = await import(path.join(process.cwd(), F, '_shared/prn-page-links.ts'))

/* ── 1. the rules ── */
ck('T1: daytime 7am to 7pm, overnight 7pm to 7am the next morning', JSON.stringify(O.slotWindow('2026-11-07', 'day')) === '["2026-11-07T07:00","2026-11-07T19:00"]'
  && JSON.stringify(O.slotWindow('2026-11-07', 'overnight')) === '["2026-11-07T19:00","2026-11-08T07:00"]' && O.SLOT_WORD.day === 'Daytime, 7am to 7pm' && O.SLOT_WORD.overnight === 'Overnight, 7pm to 7am')
ck('T4: Rule 1 names the new times (a new version, signed again)', O.TERMS_DEFAULT.includes('1. On call comes in two shifts: daytime, 7am to 7pm, and overnight, 7pm to 7am.') && !/5pm/.test(O.TERMS_DEFAULT))
ck('T2: nothing set = Friday, Saturday and Sunday 7am to 7pm', JSON.stringify(O.offeredOf({})) === '{"fri:day":true,"sat:day":true,"sun:day":true}' && O.offeredWords(O.offeredOf({})) === 'Friday, Saturday and Sunday 7am to 7pm')
ck('...her setting wins, only real day and shift keys kept', JSON.stringify(O.offeredOf({ prn_oncall_offered: { 'sat:overnight': true, 'mon:day': false, 'xyz:day': true, 'fri:day': true } })) === '{"fri:day":true,"sat:overnight":true}'
  && O.offeredWords(O.offeredOf({ prn_oncall_offered: { 'sat:overnight': true, 'fri:day': true } })) === 'Friday 7am to 7pm; Saturday 7pm to 7am' && O.offeredWords(O.offeredOf({ prn_oncall_offered: {} })) === 'none right now')
const OFF = O.offeredOf({})
ck('...a date\'s shift is offered by its weekday (an overnight by the date it starts)', O.isOffered(OFF, '2026-11-06', 'day') && O.isOffered(OFF, '2026-11-08', 'day') && !O.isOffered(OFF, '2026-11-06', 'overnight') && !O.isOffered(OFF, '2026-11-04', 'day'))
const TODAY = '2026-10-29', NOW = '2026-10-29T08:00'   // a Thursday
const ms = O.memberSlots({ rows: [{ id: 1, kind: 'confirmed', applicant_id: 'd', start_date: '2026-11-04', end_date: '2026-11-04', shift: 'day', cancelled_at: null }], aid: 'd', today: TODAY, nowNaive: NOW, offered: OFF })
const at = (d) => ms.find((x) => x.date === d)
ck('T3: their page: Friday to Sunday daytime open; weekdays and overnights "closed"; their own shift on a closed day still shows', at('2026-10-30').day.state === 'open' && at('2026-10-31').day.state === 'open' && at('2026-11-01').day.state === 'open'
  && at('2026-10-30').overnight.state === 'closed' && at('2026-11-03').day.state === 'closed' && at('2026-11-04').day.state === 'mine', ms.slice(0, 7))
ck('...asking for a closed shift is refused, one time or every week; an offered one is fine', /isn't open for on-call sign-up/.test(O.readAsks({ slots: [{ date: '2026-11-03', slot: 'day' }] }, { rows: [], aid: 'd', today: TODAY, nowNaive: NOW, offered: OFF }).error)
  && /isn't open/.test(O.readAsks({ slots: [{ date: '2026-10-31', slot: 'overnight', weekly: true }] }, { rows: [], aid: 'd', today: TODAY, nowNaive: NOW, offered: OFF }).error)
  && O.readAsks({ slots: [{ date: '2026-10-31', slot: 'day', weekly: true }] }, { rows: [], aid: 'd', today: TODAY, nowNaive: NOW, offered: OFF }).ok)
const cal = O.calendar({ rows: [], marks: [], members: [], today: TODAY, offered: OFF })
const cd = (d) => cal.find((x) => x.date === d)
ck('...the office calendar: open gaps only on offered shifts; each shift says whether it is offered', cd('2026-10-31').day.gap === true && cd('2026-10-31').day.offered === true && cd('2026-10-31').overnight.gap === false && cd('2026-10-31').overnight.offered === false
  && cd('2026-11-03').day.gap === false && cal.reduce((n, d) => n + (d.day.gap ? 1 : 0) + (d.overnight.gap ? 1 : 0), 0) === 12, cal.slice(3, 7))
const M = [{ applicant_id: 'g', name: 'Grace Hill', team: 'cna', axiscare_id: '11' }]
const rowsN = [{ id: 7, kind: 'confirmed', applicant_id: 'g', start_date: '2026-10-31', end_date: '2026-10-31', shift: 'day', cancelled_at: null }]
ck('T1: "on call now": a 6pm shift is daytime now, a 7pm one is the overnight', O.onCallNow({ c: { shift_date: '2026-10-31', shift_time: '18:00-22:00' }, rows: rowsN, marks: [], members: M })?.slot === 'day'
  && !O.onCallNow({ c: { shift_date: '2026-10-31', shift_time: '19:00-23:00' }, rows: rowsN, marks: [], members: M }))
ck('every-week shifts keep filling if their shift is later closed (already confirmed)', O.fillPlan({ series: [{ id: 1, applicant_id: 'd', first_date: '2026-11-03', slot: 'day', status: 'confirmed' }], rows: [], today: TODAY }).add.length === 4)

/* ── 2. the real prn-week and prn-page against a fake database ── */
const GRACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', DEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
let T, EVENTS, NID
const dayN = (k) => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const V = O.termsVersion(O.TERMS_DEFAULT)
const reset = (settings = {}) => { EVENTS = []; NID = 100; T = {
  app_data: [{ key: 'ops_settings', data: { prn_page_live: true, prn_oncall_signup_live: true, ...settings } }, { key: 'coverage_cases', data: [] }],
  pay_tracks: [{ applicant_id: GRACE, track: 'prn_team', team: 'cna', since: dayN(-60), axiscare_caregiver_id: '11' }, { applicant_id: DEN, track: 'prn_team', team: 'cna', since: dayN(-60), axiscare_caregiver_id: '22' }],
  job_applicants: [{ id: GRACE, first_name: 'Grace', last_name: 'Hill', phone: '4175550101', prn: {} }, { id: DEN, first_name: 'Denise', last_name: 'Gough', phone: '4175550202', prn: {} }],
  prn_shift_log: [], prn_touches: [], prn_oncall: [], prn_oncall_series: [], prn_oncall_marks: [], prn_page_log: [], prn_monthly: [],
  prn_oncall_terms: [{ applicant_id: GRACE, version: V, typed_name: 'Grace Hill', agreed_at: 'x' }, { applicant_id: DEN, version: V, typed_name: 'Denise Gough', agreed_at: 'x' }],
  auth_identities: [{ auth_user_id: 'u-kr', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-kr' }], persons: [{ person_id: 'p-kr', full_name: 'Krystal Office', active: true }],
  entity_memberships: [{ person_id: 'p-kr', entity: 'cc_ihs', active: true, ended_at: null }], staff_roles: [{ person_id: 'p-kr', entity: 'cc_ihs', role: 'staffing_coordinator' }], op_events: [] } }
const UNIQ = { prn_oncall: (a, r) => !a.cancelled_at && a.kind === r.kind && a.applicant_id === r.applicant_id && a.start_date === r.start_date && (a.shift || '') === (r.shift || '') && r.kind !== 'offer',
  prn_oncall_series: (a, r) => ['asked', 'confirmed'].includes(a.status) && a.applicant_id === r.applicant_id && a.weekday === r.weekday && a.slot === r.slot }
const q = (t) => { const st = { f: [], inF: [], nul: [], gte: [], lte: [], upd: null }; const b = {
  select() { return b }, order() { return b }, limit() { return b }, not() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF.push([c, v]); return b }, is(c, v) { if (v === null) st.nul.push(c); return b },
  gte(c, v) { st.gte.push([c, v]); return b }, lte(c, v) { st.lte.push([c, v]); return b }, update(o) { st.upd = o; return b },
  insert(row) { let out
    if (t === 'op_events') { EVENTS.push(row); out = { data: null, error: null } }
    else { const arr = (T[t] ||= []); if (UNIQ[t] && arr.some((a) => UNIQ[t](a, row))) out = { data: null, error: { message: 'duplicate key value violates unique constraint' } }
      else { const nr = { id: NID++, at: new Date().toISOString(), cancelled_at: null, series_id: null, ...row }; arr.push(nr); out = { data: nr, error: null } } }
    const p = Promise.resolve({ data: null, error: out.error }); p.select = () => ({ maybeSingle: () => Promise.resolve({ data: out.data ? JSON.parse(JSON.stringify(out.data)) : null, error: out.error }) }); return p },
  rows() { if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return T.app_data.filter((x) => x.key === k) }
    let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); for (const [c, v] of st.inF) r = r.filter((x) => v.includes(x[c])); for (const c of st.nul) r = r.filter((x) => x[c] == null)
    for (const [c, v] of st.gte) r = r.filter((x) => String(x[c]) >= v); for (const [c, v] of st.lte) r = r.filter((x) => String(x[c]) <= v); return r },
  maybeSingle() { return Promise.resolve({ data: JSON.parse(JSON.stringify(b.rows()[0] ?? null)), error: null }) },
  then(ok, bad) { if (st.upd) { for (const x of b.rows()) Object.assign(x, st.upd); return Promise.resolve({ data: null, error: null }).then(ok, bad) }
    return Promise.resolve({ data: JSON.parse(JSON.stringify(b.rows())), error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async () => ({ data: null, error: null }),
  auth: { getUser: async (jwt) => jwt === 'kr' ? { data: { user: { id: 'u-kr', email: 'krystal@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
globalThis.fetch = async () => new Response('{}', { status: 404 })
const SECRET = 'S'.repeat(48)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: '', GHL_LOCATION_ID: '', HUB_JOB_SECRET: SECRET }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_ocw_'))
const load = async (name) => { const src = fs.readFileSync(path.join(F, name, 'index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, name + '.ts'), src); await import(path.join(tmp, name + '.ts')); return handler }
try {
  const week = await load('prn-week'), page = await load('prn-page')
  const call = async (h, url, body, headers = {}) => { const r = await h(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
  const W = (body) => call(week, 'https://x/functions/v1/prn-week', body, { Authorization: 'Bearer kr' })
  const link = async (aid) => Object.fromEntries(new URL(await L.makePageLink(SECRET, aid, L.pageExpiry(Math.floor(Date.now() / 1000)))).searchParams)
  const P = async (aid, body) => call(page, 'https://x/functions/v1/prn-page', { ...(await link(aid)), ...body })
  const d5 = dayN(5), d6 = dayN(6), live = (aid) => T.prn_oncall.filter((r) => r.applicant_id === aid && !r.cancelled_at)

  const nextDow = (dow) => { for (let k = 3; k < 12; k++) { const d = dayN(k); if (new Date(d + 'T12:00:00Z').getUTCDay() === dow) return d } }
  const sat = nextDow(6), tue = nextDow(2)
  reset()
  let r = await P(DEN, { action: 'view' })
  ck('their PRN Team page with nothing set: Saturday daytime open, Tuesday daytime "closed", the words for what is offered', r.j.oncall.signup.slots.find((x) => x.date === sat).day.state === 'open'
    && r.j.oncall.signup.slots.find((x) => x.date === tue).day.state === 'closed' && r.j.oncall.signup.offered_words === 'Friday, Saturday and Sunday 7am to 7pm', r.j.oncall.signup.offered_words)
  r = await P(DEN, { action: 'oncall_ask', slots: [{ date: tue, slot: 'day' }] })
  ck('...asking for Tuesday is refused, nothing saved', r.status === 409 && /isn't open/.test(r.j.error) && !T.prn_oncall.length)
  r = await P(DEN, { action: 'oncall_ask', slots: [{ date: sat, slot: 'day', weekly: true }] })
  ck('...Saturday daytime every week is fine', r.j?.ok && T.prn_oncall_series.length === 1)
  r = await W({ action: 'week' })
  ck('office: the week says what is offered (and that nothing is set yet), and gaps count only offered shifts', JSON.stringify(r.j.oncall.offered) === '{"fri:day":true,"sat:day":true,"sun:day":true}' && r.j.oncall.offered_set === false
    && r.j.oncall.calendar.find((x) => x.date === tue).day.offered === false && r.j.oncall.calendar.find((x) => x.date === tue).day.gap === false, r.j.oncall.offered)
  r = await W({ action: 'oncall_confirm', applicant_id: GRACE, date: tue, shift: 'day' })
  ck('...the office can still put someone on a closed shift by hand', r.j?.outcome === 'recorded', r.j)
  T.app_data[0].data.prn_oncall_offered = { 'tue:day': true }
  r = await P(DEN, { action: 'view' })
  ck('an owner opens Tuesday daytime: it opens on their page, and Saturday closes', r.j.oncall.signup.slots.find((x) => x.date === tue).day.state === 'taken' && r.j.oncall.signup.slots.find((x) => x.date === sat).day.state !== 'open'
    && r.j.oncall.signup.offered_words === 'Tuesday 7am to 7pm', r.j.oncall.signup.offered_words)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }

const fails = res.filter((r) => !r[1])
for (const [nm, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + nm + (okk ? '' : '  ' + note))
console.log(`\n${res.length - fails.length}/${res.length} passed`)
process.exit(fails.length ? 1 : 0)
