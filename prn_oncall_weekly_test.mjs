// PRN CNA ON CALL, EVERY WEEK (Samantha 2026-10-30, "Yes to all 7 recommendations", rules W1 to W7 in _shared/prn-oncall.ts).
// The rules, the REAL prn-week and prn-page with the REAL staff check against a fake database, and the SQL on a throwaway
// Postgres when PGLITE is set. Nothing real is reached.
// node prn_oncall_weekly_test.mjs   (PGLITE=<path to @electric-sql/pglite/dist/index.js> for the SQL part)
import fs from 'fs'; import path from 'path'; import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions'
const O = await import(path.join(process.cwd(), F, '_shared/prn-oncall.ts'))
const L = await import(path.join(process.cwd(), F, '_shared/prn-page-links.ts'))

/* ── 1. the rules ── */
const TODAY = '2026-10-29'   // a Thursday
const M = [{ applicant_id: 'g', name: 'Grace Hill', first: 'Grace', team: 'cna' }, { applicant_id: 'd', name: 'Denise Gough', first: 'Denise', team: 'cna' }]
const C = (id, aid, date, shift, o = {}) => ({ id, kind: 'confirmed', applicant_id: aid, start_date: date, end_date: date, shift, cancelled_at: null, series_id: null, ...o })
const A = (id, aid, date, shift, o = {}) => ({ id, kind: 'asked', applicant_id: aid, start_date: date, end_date: date, shift, cancelled_at: null, series_id: null, ...o })
const SR = (id, aid, first, slot, status = 'confirmed') => ({ id, applicant_id: aid, first_date: first, slot, status })

ck('words: "Saturdays, daytime" / "Tuesdays, overnight"', O.seriesWord({ first_date: '2026-10-31', slot: 'day' }) === 'Saturdays, daytime' && O.seriesWord({ first_date: '2026-11-03', slot: 'overnight' }) === 'Tuesdays, overnight')
ck('W1: its dates, every 7 days, from its first date, inside the 4 weeks from today',
  O.seriesDates(SR(1, 'd', '2026-10-31', 'day'), TODAY).join() === '2026-10-31,2026-11-07,2026-11-14,2026-11-21'
  && O.seriesDates(SR(1, 'd', '2026-10-17', 'day'), TODAY).join() === '2026-10-31,2026-11-07,2026-11-14,2026-11-21'
  && O.seriesDates(SR(1, 'd', '2026-11-14', 'day'), TODAY).join() === '2026-11-14,2026-11-21' && O.seriesDates({ first_date: 'x' }, TODAY).length === 0)

const s1 = SR(1, 'd', '2026-10-31', 'day')
const rows = [C(10, 'd', '2026-10-31', 'day', { series_id: 1 }), C(11, 'g', '2026-11-14', 'day'), C(12, 'd', '2026-11-21', 'day', { series_id: 1, cancelled_at: 'x' })]
const p1 = O.fillPlan({ series: [s1], rows, today: TODAY, nowNaive: '2026-10-29T10:00' })
ck('W1: the weeks it doesn\'t have yet are added (already confirmed)', p1.add.map((k) => k.date).join() === '2026-11-07' && p1.add[0].series_id === 1 && p1.add[0].applicant_id === 'd' && p1.add[0].slot === 'day', p1)
ck('W2: a week someone else holds is skipped, that week only', p1.skipped.length === 1 && p1.skipped[0].date === '2026-11-14' && p1.skipped[0].held_by === 'g')
ck('...a week given back or taken back is never added again', !p1.add.some((k) => k.date === '2026-11-21'))
ck('...a week they hold some other way is left as it is', O.fillPlan({ series: [s1], rows: [C(20, 'd', '2026-11-07', 'day')], today: TODAY }).add.every((k) => k.date !== '2026-11-07'))
ck('...a week that already started is not added', O.fillPlan({ series: [s1], rows: [], today: '2026-10-31', nowNaive: '2026-10-31T08:00' }).add.every((k) => k.date !== '2026-10-31')
  && O.fillPlan({ series: [s1], rows: [], today: '2026-10-31', nowNaive: '2026-10-31T06:59' }).add.some((k) => k.date === '2026-10-31'))
ck('...only confirmed every-week shifts fill (an ask waits for the office, an ended one stops)', !O.fillPlan({ series: [SR(2, 'd', '2026-10-31', 'day', 'asked'), SR(3, 'd', '2026-10-31', 'overnight', 'ended')], rows: [], today: TODAY }).add.length)
ck('...the overnight one fills the overnight shift', O.fillPlan({ series: [SR(4, 'd', '2026-11-03', 'overnight')], rows: [C(30, 'g', '2026-11-03', 'day')], today: TODAY }).add.length === 4)

const e1 = O.endPlan({ seriesId: 1, rows: [C(40, 'd', '2026-10-31', 'day', { series_id: 1 }), C(41, 'd', '2026-11-07', 'day', { series_id: 1 }), C(42, 'd', '2026-11-14', 'day', { series_id: 1, cancelled_at: 'x' }), C(43, 'g', '2026-11-07', 'overnight')], nowNaive: '2026-10-30T09:00' })
ck('W4: ending it takes back the weeks 24 hours or more away; the one starting sooner stays theirs', e1.cancel.map((r) => r.id).join() === '41' && e1.kept.map((r) => r.id).join() === '40', e1)
ck('...exactly 24 hours ahead can still be stopped', O.endPlan({ seriesId: 1, rows: [C(40, 'd', '2026-10-31', 'day', { series_id: 1 })], nowNaive: '2026-10-30T07:00' }).cancel.length === 1)

const allRows = [...rows, A(13, 'd', '2026-11-03', 'overnight', { series_id: 5 })]
const ms = O.memberSlots({ rows: allRows, aid: 'd', today: TODAY, nowNaive: '2026-10-29T10:00', series: [s1, SR(5, 'd', '2026-11-03', 'overnight', 'asked')] })
const at = (d) => ms.find((x) => x.date === d)
ck('their page: their every-week shift says so, their every-week ask too', at('2026-10-31').day.state === 'mine' && at('2026-10-31').day.weekly === true && at('2026-11-03').overnight.state === 'asked' && at('2026-11-03').overnight.weekly === true)
ck('...the skipped week says "someone else has it" (skip), never who', at('2026-11-14').day.state === 'taken' && at('2026-11-14').day.skip === true && !/Grace/.test(JSON.stringify(ms)))
ck('...someone else\'s shift that isn\'t in their series is plain taken', O.memberSlots({ rows: allRows, aid: 'd', today: TODAY, nowNaive: '2026-10-29T10:00' }).find((x) => x.date === '2026-11-14').day.skip !== true)

const cal = O.calendar({ rows: allRows, marks: [], members: M, today: TODAY, series: [s1] })
const cd = (d) => cal.find((x) => x.date === d)
ck('office calendar: every-week shifts and asks are marked, skipped weeks show who missed out', cd('2026-10-31').day.confirmed[0].weekly === true && cd('2026-11-14').day.confirmed[0].weekly === false
  && cd('2026-11-03').overnight.asked[0].weekly === true && cd('2026-11-14').day.skipped[0].name === 'Denise Gough' && cd('2026-11-07').day.skipped.length === 0)

const NOW = '2026-10-29T10:00'
const rA = O.readAsks({ slots: [{ date: '2026-11-06', slot: 'day', weekly: true }, { date: '2026-11-07', slot: 'day' }] }, { rows: [], aid: 'd', today: TODAY, nowNaive: NOW, series: [] })
ck('asks: one time or every week, per shift', rA.ok && rA.slots[0].weekly === true && rA.slots[1].weekly === false)
ck('...an every-week shift they already have (or asked for) is refused', /already have this shift every week/.test(O.readAsks({ slots: [{ date: '2026-11-07', slot: 'day', weekly: true }] }, { rows: [], aid: 'd', today: TODAY, nowNaive: NOW, series: [s1] }).error)
  && O.readAsks({ slots: [{ date: '2026-11-07', slot: 'overnight', weekly: true }] }, { rows: [], aid: 'd', today: TODAY, nowNaive: NOW, series: [s1] }).ok
  && O.readAsks({ slots: [{ date: '2026-11-07', slot: 'day', weekly: true }] }, { rows: [], aid: 'g', today: TODAY, nowNaive: NOW, series: [s1] }).ok)
ck('...the same weekday and shift twice in one go: once', /once/.test(O.readAsks({ slots: [{ date: '2026-11-06', slot: 'day', weekly: true }, { date: '2026-11-13', slot: 'day', weekly: true }] }, { rows: [], aid: 'd', today: TODAY, nowNaive: NOW, series: [] }).error))
const many = Array.from({ length: 9 }, (_, i) => A(100 + i, 'd', O.addDays('2026-11-06', i), 'day'))
ck('W7: an every-week ask is one of the 10 waiting asks', O.readAsks({ slots: [{ date: '2026-11-20', slot: 'overnight', weekly: true }] }, { rows: many, aid: 'd', today: TODAY, nowNaive: NOW }).ok
  && /up to 10/.test(O.readAsks({ slots: [{ date: '2026-11-20', slot: 'overnight', weekly: true }, { date: '2026-11-21', slot: 'overnight' }] }, { rows: many, aid: 'd', today: TODAY, nowNaive: NOW }).error))
ck('W6: rule 6 gains her sentence (a new version, so everyone signs again)', O.TERMS_DEFAULT.endsWith('6. If something comes up, call the office at least 24 hours before your on-call shift starts. To stop an every-week on-call shift, call the office at least 24 hours before the next one starts.')
  && O.TERMS_DEFAULT.split('\n').length === 8 && !/—/.test(O.TERMS_DEFAULT))
const sv = O.seriesView([SR(7, 'd', '2026-11-03', 'overnight'), s1, SR(8, 'd', '2026-11-02', 'day', 'ended')], M)
ck('W3: the list of their every-week shifts (live only, by weekday), for the check-in and the office', sv.length === 2 && sv[0].word === 'Tuesdays, overnight' && sv[1].word === 'Saturdays, daytime' && sv[1].name === 'Denise Gough' && sv[0].since === '2026-11-03')

/* ── 2. the real prn-week and prn-page against a fake database ── */
const GRACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', DEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
let T, EVENTS, NID
const dayN = (k) => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const V = O.termsVersion(O.TERMS_DEFAULT)
const reset = (settings = {}) => { EVENTS = []; NID = 100; T = {
  app_data: [{ key: 'ops_settings', data: { prn_page_live: true, prn_oncall_signup_live: true, prn_oncall_offered: Object.fromEntries(['sun','mon','tue','wed','thu','fri','sat'].flatMap((d) => [[d + ':day', true], [d + ':overnight', true]])), ...settings } }, { key: 'coverage_cases', data: [] }],
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

  reset()
  let r = await P(DEN, { action: 'oncall_ask', slots: [{ date: d5, slot: 'day', weekly: true }, { date: d6, slot: 'overnight' }] })
  const ser = T.prn_oncall_series[0]
  ck('page: an every-week ask is a series waiting for the office plus its first week as an ask, a one-time ask beside it', r.j?.ok && T.prn_oncall_series.length === 1 && ser.status === 'asked' && ser.slot === 'day' && ser.first_date === d5
    && ser.weekday === new Date(d5 + 'T12:00:00Z').getUTCDay() && T.prn_oncall.length === 2 && T.prn_oncall.find((x) => x.start_date === d5).series_id === ser.id && T.prn_oncall.find((x) => x.start_date === d6).series_id == null
    && /repeats on its own/.test(r.j.message) && T.prn_page_log.some((x) => x.kind === 'oncall_ask' && /every week/.test(x.note)), [r.j, T.prn_oncall_series, T.prn_oncall])
  r = await P(DEN, { action: 'oncall_ask', slots: [{ date: dayN(12), slot: 'day', weekly: true }] })
  ck('...the same weekday and shift every week again: refused', r.status === 409 && /already have this shift every week/.test(r.j.error) && T.prn_oncall_series.length === 1)
  r = await P(DEN, { action: 'view' })
  ck('...their page shows it waiting, every week, and lists it', r.j.oncall.signup.slots.find((x) => x.date === d5).day.state === 'asked' && r.j.oncall.signup.slots.find((x) => x.date === d5).day.weekly === true
    && r.j.oncall.signup.weekly.length === 1 && r.j.oncall.signup.weekly[0].status === 'asked' && r.j.oncall.signup.weekly_ready === true, r.j.oncall.signup.weekly)

  /* Grace already holds the third week */
  T.prn_oncall.push({ id: 900, kind: 'confirmed', applicant_id: GRACE, start_date: O.addDays(d5, 14), end_date: O.addDays(d5, 14), shift: 'day', cancelled_at: null, series_id: null })
  r = await W({ action: 'week' })
  ck('office: the calendar marks the every-week ask, and lists the every-week shifts', r.j.oncall.calendar.find((x) => x.date === d5).day.asked[0].weekly === true && r.j.oncall.series.length === 1 && r.j.oncall.series[0].word === O.seriesWord({ first_date: d5, slot: 'day' })
    && r.j.oncall.weekly_ready === true && r.j.oncall.fill.ok, r.j.oncall.series)
  const askId = T.prn_oncall.find((x) => x.start_date === d5 && x.kind === 'asked').id
  r = await W({ action: 'oncall_confirm', ask_id: askId })
  const dRows = live(DEN).filter((x) => x.kind === 'confirmed' && x.series_id === ser.id).map((x) => x.start_date).sort()
  ck('W1: one OK confirms the series; its weeks in the next 4 weeks are added, already confirmed', r.j.outcome === 'recorded' && r.j.every_week === true && T.prn_oncall_series[0].status === 'confirmed' && T.prn_oncall_series[0].confirmed_by === 'Krystal Office'
    && dRows.join() === [d5, O.addDays(d5, 7), O.addDays(d5, 21)].filter((d) => d <= dayN(27)).join() && EVENTS.some((e) => /every week/.test(e.summary)), [r.j, dRows])
  ck('W2: the week Grace holds is skipped, and only that week', !dRows.includes(O.addDays(d5, 14)) && T.prn_oncall.find((x) => x.id === 900).cancelled_at === null)
  r = await P(DEN, { action: 'view' })
  ck('...Denise\'s page: "every week" on her shifts, the skipped week as someone else has it', r.j.oncall.signup.slots.find((x) => x.date === d5).day.weekly === true && r.j.oncall.signup.slots.find((x) => x.date === O.addDays(d5, 14)).day.skip === true
    && r.j.oncall.signup.weekly[0].status === 'confirmed')
  r = await W({ action: 'week' })
  ck('...the office sees the skipped week, with who missed out', r.j.oncall.calendar.find((x) => x.date === O.addDays(d5, 14)).day.skipped[0].name === 'Denise Gough')
  const n0 = T.prn_oncall.length
  r = await W({ action: 'oncall_fill' })
  ck('the fill again: nothing new (it never doubles)', r.j.ok && r.j.added === 0 && T.prn_oncall.length === n0, r.j)
  const lastWk = T.prn_oncall.find((x) => x.series_id === ser.id && x.start_date === O.addDays(d5, 21))
  if (lastWk) { await W({ action: 'oncall_cancel', id: lastWk.id }); r = await W({ action: 'oncall_fill' }) }
  ck('...a week the office took back (they called about that one week) stays taken back, the series goes on', !lastWk || (lastWk.cancelled_at && r.j.added === 0 && T.prn_oncall_series[0].status === 'confirmed'))

  r = await call(week, 'https://x/functions/v1/prn-week?fill=1', {})
  ck('the daily fill: refused without its schedule\'s secret', r.status === 401)
  r = await call(week, 'https://x/functions/v1/prn-week?fill=1', {}, { 'x-cron-secret': SECRET })
  ck('...with it: runs, says what it did', r.status === 200 && r.j.caller === 'cron' && r.j.ok === true && r.j.added === 0, r.j)
  r = await call(week, 'https://x/functions/v1/prn-week?fill=1', {}, { Authorization: 'Bearer kr' })
  ck('...an office sign-in is not the schedule (it uses oncall_fill)', r.status === 401)

  /* W4: Denise calls to stop it */
  r = await W({ action: 'oncall_series_end', series_id: ser.id, note: 'New job on Saturdays' })
  const after = live(DEN).filter((x) => x.series_id === ser.id).map((x) => x.start_date)
  ck('W4: ended: the weeks 24 hours or more away are taken back (d5 is 5 days away, so all of them), recorded with the reason', r.j.outcome === 'ended' && after.length === 0 && T.prn_oncall_series[0].status === 'ended'
    && /New job/.test(T.prn_oncall_series[0].end_why) && T.prn_oncall_series[0].ended_by === 'Krystal Office' && EVENTS.some((e) => e.verb === 'prn_oncall_series_ended'), [r.j, after])
  r = await W({ action: 'oncall_fill' })
  ck('...and nothing is added again', r.j.added === 0 && live(DEN).filter((x) => x.series_id === ser.id).length === 0)
  r = await W({ action: 'oncall_series_end', series_id: ser.id })
  ck('...twice: already', r.j.outcome === 'already')

  /* the office puts Grace on overnights every week */
  r = await W({ action: 'oncall_confirm', applicant_id: GRACE, date: d6, shift: 'whole', every_week: true })
  ck('office, every week: one shift only (not the whole day)', r.status === 400 && !T.prn_oncall_series.some((x) => x.applicant_id === GRACE))
  r = await W({ action: 'oncall_confirm', applicant_id: GRACE, date: d6, shift: 'overnight', every_week: true })
  const gs = T.prn_oncall_series.find((x) => x.applicant_id === GRACE)
  ck('...overnight every week: confirmed at once, its weeks added', r.j.outcome === 'recorded' && gs.status === 'confirmed' && live(GRACE).filter((x) => x.series_id === gs.id).length >= 3, [r.j, gs])
  r = await W({ action: 'oncall_confirm', applicant_id: GRACE, date: O.addDays(d6, 7), shift: 'overnight', every_week: true })
  ck('...the same again: "already has it every week"', r.status === 409 || r.j.outcome === 'already')

  /* W5: a miss ends it */
  const gFirst = live(GRACE).find((x) => x.series_id === gs.id && x.start_date === d6)
  r = await W({ action: 'oncall_mark', oncall_id: gFirst.id, kind: 'no_answer' })
  ck('W5: a miss ends every every-week shift of theirs, and its future weeks are taken back', r.j.outcome === 'missed' && gs.status === 'ended' && /missed/.test(gs.end_why)
    && live(GRACE).filter((x) => x.series_id === gs.id && x.id !== gFirst.id).length === 0, [r.j, gs])

  /* "Not this one", and taking the ask back */
  reset()
  await P(DEN, { action: 'oncall_ask', slots: [{ date: d5, slot: 'overnight', weekly: true }] })
  r = await W({ action: 'oncall_decline', ask_id: T.prn_oncall[0].id })
  ck('"Not this one" on an every-week ask ends it', r.j.outcome === 'cancelled' && T.prn_oncall_series[0].status === 'ended' && T.prn_oncall_series[0].end_why === 'Not this one')
  await P(DEN, { action: 'oncall_ask', slots: [{ date: d6, slot: 'overnight', weekly: true }] })
  const a2 = T.prn_oncall.find((x) => x.start_date === d6)
  r = await P(DEN, { action: 'oncall_withdraw', id: a2.id })
  ck('...and so does taking the ask back on their page', r.j.ok && T.prn_oncall_series.find((x) => x.id === a2.series_id).status === 'ended')

  /* the every-week table not set up yet: one-time asks still work, every week waits */
  reset(); delete T.prn_oncall_series
  const realFrom = globalThis.__db.from; globalThis.__db.from = (t) => t === 'prn_oncall_series' ? { select() { return this }, eq() { return this }, in() { return this }, then(ok) { return Promise.resolve({ data: null, error: { message: 'relation does not exist' } }).then(ok) } } : realFrom(t)
  r = await P(DEN, { action: 'oncall_ask', slots: [{ date: d5, slot: 'day', weekly: true }] })
  ck('before the SQL runs: every week says it isn\'t ready, nothing saved', r.status === 409 && /isn't ready yet/.test(r.j.error) && !T.prn_oncall.length)
  r = await P(DEN, { action: 'oncall_ask', slots: [{ date: d5, slot: 'day' }] })
  ck('...one time still works', r.j?.ok && T.prn_oncall.length === 1)
  r = await W({ action: 'week' })
  ck('...the office calendar still loads', r.j?.ok && r.j.oncall.weekly_ready === false && r.j.oncall.fill.ok === false)
  globalThis.__db.from = realFrom
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }

ck('no em dashes in anything people read', !/—/.test([fs.readFileSync(path.join(F, '_shared/prn-oncall.ts'), 'utf8'), fs.readFileSync(path.join(F, 'prn-week/index.ts'), 'utf8'), fs.readFileSync(path.join(F, 'prn-page/index.ts'), 'utf8')].join('').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').replace("/—/.test(message)", '')))

/* ── 3. the SQL ── */
if (process.env.PGLITE) {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE).href); const db = new PGlite()
  await db.exec(`create table public.job_applicants (id uuid primary key); insert into public.job_applicants values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');`)
  try { await db.exec(`do $$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $$;`) } catch { /* */ }
  for (const f of ['prn_week.sql', 'prn_oncall_shift.sql', 'prn_page.sql', 'prn_open_shifts.sql', 'prn_recognition.sql', 'prn_oncall_calendar.sql']) { try { await db.exec('begin;' + fs.readFileSync(f, 'utf8') + 'commit;') } catch (e) { await db.exec('rollback;').catch(() => {}); ck('SQL: ' + f + ' runs (setup)', false, e.message) } }
  const sql = fs.readFileSync('prn_oncall_weekly.sql', 'utf8')
  let twice = true; try { await db.exec('begin;' + sql + 'commit;'); await db.exec('begin;' + sql + 'commit;') } catch (e) { twice = false; ck('SQL runs', false, e.message) }
  const A1 = "'00000000-0000-0000-0000-000000000001'"
  const tryQ = async (s) => { try { await db.query(s); return true } catch { return false } }
  const ins = (wd, first, slot, status = "'asked'", extra = '') => `insert into public.prn_oncall_series (applicant_id, slot, weekday, first_date, status, by_email${extra ? ', ' + extra.split('|')[0] : ''}) values (${A1}, '${slot}', ${wd}, '${first}', ${status}, 'p'${extra ? ', ' + extra.split('|')[1] : ''})`
  const s1q = await tryQ(ins(6, '2026-10-31', 'day'))
  const dup = await tryQ(ins(6, '2026-11-07', 'day'))
  const otherSlot = await tryQ(ins(6, '2026-11-07', 'overnight'))
  const badWd = await tryQ(ins(5, '2026-11-14', 'day'))
  const badSlot = await tryQ(ins(2, '2026-11-03', 'whole'))
  const confNoAt = await tryQ(ins(1, '2026-11-02', 'day', "'confirmed'"))
  const endNoAt = await tryQ(ins(1, '2026-11-02', 'day', "'ended'"))
  const ended = await tryQ(`update public.prn_oncall_series set status = 'ended', ended_at = now(), end_why = 'They called to stop it' where weekday = 6 and slot = 'day'`)
  const again = await tryQ(ins(6, '2026-11-07', 'day'))
  const sid = (await db.query(`select id from public.prn_oncall_series where status = 'asked' and slot = 'day' limit 1`)).rows[0]?.id
  const row = await tryQ(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, shift, by_email, series_id) values (${A1}, 'asked', '2026-11-07', '2026-11-07', 'day', 'p', ${sid})`)
  const badRef = await tryQ(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, shift, by_email, series_id) values (${A1}, 'asked', '2026-11-14', '2026-11-14', 'day', 'p', 999999)`)
  const anonRead = (await db.query(`select has_table_privilege('anon', 'public.prn_oncall_series', 'select') as a, has_table_privilege('authenticated', 'public.prn_oncall_series', 'insert') as i`)).rows[0]
  ck('SQL: runs twice; one live every-week shift per person, weekday and shift (again once the old one ended); the weekday matches its first date; day or overnight only; confirmed and ended carry their times; each week points to a real series; the public can\'t read it, office staff can\'t write it',
    twice && s1q && !dup && otherSlot && !badWd && !badSlot && !confNoAt && !endNoAt && ended && again && row && !badRef && !anonRead.a && !anonRead.i,
    { twice, s1q, dup, otherSlot, badWd, badSlot, confNoAt, endNoAt, ended, again, row, badRef, anonRead })
} else ck('SQL on a throwaway Postgres (skipped: PGLITE not set)', true)

const fails = res.filter((r) => !r[1])
for (const [nm, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + nm + (okk ? '' : '  ' + note))
console.log(`\n${res.length - fails.length}/${res.length} passed`)
process.exit(fails.length ? 1 : 0)
