// Quieter coverage-watch cards (Samantha 2026-10-22, _shared/quiet-cards.ts + coverage-watch). Same fakes as
// loops_phase2_test.mjs: the REAL function, a fake AxisCare, a fake database, a controllable clock. Made-up people only.
// node quiet_cards_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1400)]);
const FN = 'supabase/functions';
let NOW = Date.parse('2026-10-06T15:00:00Z')          // Tue Oct 6, 10:00am Central (CDT)
const RealDate = Date
class FakeDate extends RealDate { constructor(...a) { if (!a.length) super(NOW); else super(...a) } static now() { return NOW } }
globalThis.Date = FakeDate
const at = (iso) => { NOW = RealDate.parse(iso) }

/* ── the fake world ── */
let APP, T, SENT, VISITS
const reset = () => {
  APP = { ops_settings: { coverage_watch_live: true, timekeeper_watch_live: true, timekeeper_text_live: true, timekeeper_admin_loop_live: true,
      coverage_alert_admins: ['sam@mo-care.com', 'kry@mo-care.com'] },
    coverage_cases: [], ops_items: [], attendance_events: [], attendance_watch_state: [{ id: 'state', last_date: '2026-10-05' }], evv_daily_stats: [],
    caregivers: [{ id: 1, first: 'Maria', last: 'Lopez', phone: '4175550111', axiscare_id: '501', active: true }],
    coordinator_staff: [{ email: 'sam@mo-care.com', name: 'Samantha T', phone: '4175550901' }, { email: 'kry@mo-care.com', name: 'Krystal L', phone: '4175550902' }],
    timekeeper_cases: [], automation_log: [], automation_heartbeats: [] }
  T = { domains: [{ code: 'scheduling_coverage', entity: 'cc_ihs', owner_person: 'p_s' }, { code: 'caregiver_performance', entity: 'cc_ihs', owner_person: 'p_k' }],
    persons: [{ person_id: 'p_s', primary_email: 'sam@mo-care.com' }, { person_id: 'p_k', primary_email: 'kry@mo-care.com' }],
    phone_index: [], contact_optout_current: [], circle_contacts: [], op_events: [], contact_send_refusals: [] }
  SENT = []; VISITS = []
}
const q = (t) => { const st = { f: [] }; const b = {
  select() { return b; }, order() { return b; }, limit() { return b; }, contains() { return b; }, in() { return b; }, is() { return b; }, gte() { return b; }, lte() { return b; }, ilike() { return b; }, not() { return b; }, or() { return b; }, neq() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; },
  insert(row) { (T[t] ||= []).push(row); return Promise.resolve({ data: row, error: null }); },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: null })); },
  then(ok) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]
      return Promise.resolve({ data: k in APP ? [{ key: k, data: JSON.parse(JSON.stringify(APP[k])) }] : [], error: null }).then(ok) }
    let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v)
    return Promise.resolve({ data: rows, error: null }).then(ok);
  } }; return b; };
globalThis.__db = { from: q, auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) },
  rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); const it = JSON.parse(JSON.stringify(a.item)); if (i >= 0) arr[i] = it; else arr.push(it) } return { data: null, error: null } } }
const PHONE_OF = {}
globalThis.fetch = async (url, o) => { url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('axiscare.com/api/visits?')) { const u = new URL(url); const s = u.searchParams.get('startDate'), e = u.searchParams.get('endDate')
    const v = VISITS.filter((x) => { const d = String(x.scheduledStartDate).slice(0, 10); return (!s || d >= s) && (!e || d <= e) })
    return new Response(JSON.stringify({ results: { visits: JSON.parse(JSON.stringify(v)), nextPage: null } }), { status: 200 }) }
  if (url.includes('axiscare.com')) return new Response(JSON.stringify({ results: {} }), { status: 200 })
  if (url.includes('/contacts/upsert')) { const id = 'C:' + (body.phone || body.email); PHONE_OF[id] = body.phone || body.email; return new Response(JSON.stringify({ contact: { id, dnd: false } }), { status: 200 }) }
  if (url.includes('/conversations/messages')) { SENT.push({ to: PHONE_OF[body.contactId] || body.contactId, message: body.message || '' }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 }) }
const SVC = 'svc_' + 'k'.repeat(60), JOBSEC = 'j'.repeat(64)
const ENV = { HUB_JOB_SECRET: JOBSEC, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
globalThis.__dbFor = (key) => ({ from: (t) => { const bb = { select() { return bb; }, limit() { return Promise.resolve(t === 'identity_door_audit' && key !== SVC ? { data: null, error: { message: 'denied' } } : { data: [], error: null }); } }; return bb; } })
fs.writeFileSync(`${FN}/_shared/_job-auth_t.ts`, fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)'))
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_t.ts`) } catch { /* */ } })
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'../_shared/job-auth.ts'", "'../_shared/_job-auth_t.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); } return handler; };
const CW = await load('coverage-watch')
const run = async (h, qs = '') => { const r = await h(new Request('https://x/fn' + qs, { method: 'POST', headers: { Authorization: 'Bearer eyJanon', 'x-cron-secret': JOBSEC } })); return r.json() }
const item = (id) => APP.ops_items.find((i) => i.id === id), kase = (id) => APP.coverage_cases.find((c) => c.id === id)
const Q = await import(path.join(process.cwd(), FN, '_shared/quiet-cards.ts'))

/* ── 1 · the rules on their own ── */
ck('rule · on with the Tidier My Work switch (or quieter_cards_live), only when exactly true', !Q.quietOn({}) && !Q.quietOn({ quieter_cards_live: 'true' }) && !Q.quietOn({ mywork_tidy_live: 'true' }) && !Q.quietOn(null)
  && Q.quietOn({ mywork_tidy_live: true }) && Q.quietOn({ mywork_tidy_live: true }))
ck('rule · the Monday of the week', Q.mondayOf('2026-10-22') === '2026-10-19' && Q.mondayOf('2026-10-19') === '2026-10-19' && Q.mondayOf('2026-10-25') === '2026-10-19')
ck('rule · already suggested = old single cards and every weekly list, any status',
  [...Q.suggestedBefore([{ id: 'ops_regular_s11', status: 'done' }, { id: 'ops_regular_week_2026-10-12', status: 'resolved', sched_ids: ['12', '13'] }, { id: 'ops_x' }])].sort().join() === '11,12,13')
const s = (sched, caregiver, client, weekday) => ({ sched, caregiver, client, weekday })
const w1 = Q.weekCard(null, [s('21', 'Joyce Kim', 'Ruth A', 'Monday')], '2026-10-19', 'T1')
ck('rule · first suggestion makes the week card', w1.id === 'ops_regular_week_2026-10-19' && w1.status === 'open' && /^Make it official\? 1 schedule this week \(week of Oct 19\)$/.test(w1.title)
  && /• Joyce Kim has covered Ruth A's Monday slot 3 times running/.test(w1.detail) && w1.sched_ids.join() === '21', w1)
const w2 = Q.weekCard({ ...w1, owner: 'kry@mo-care.com', history: [1] }, [s('21', 'Joyce Kim', 'Ruth A', 'Monday'), s('22', 'Pat Long', 'Ted B', 'Friday')], '2026-10-19', 'T2')
ck('rule · a later run adds only the new one, keeps owner and history', w2.lines.length === 2 && w2.sched_ids.join() === '21,22' && /2 schedules/.test(w2.title) && w2.owner === 'kry@mo-care.com' && w2.history.length === 1 && w2.created_at === 'T1', w2)
ck('rule · nothing new = no change', Q.weekCard(w2, [s('22', 'Pat Long', 'Ted B', 'Friday')], '2026-10-19', 'T3') === null)
ck('rule · a list a person closed stays closed when one is added', Q.weekCard({ ...w1, status: 'done' }, [s('23', 'A B', 'C D', 'Tuesday')], '2026-10-19', 'T').status === 'done')
ck('rule · recheck only needs_outcome cases with an open card, in the window, with a visit', Q.recheckCases([
  { id: 'a', status: 'needs_outcome', shift_date: '2026-10-10', axiscare_visit_id: '1' }, { id: 'b', status: 'needs_outcome', shift_date: '2026-10-10', axiscare_visit_id: '2' },
  { id: 'c', status: 'needs_outcome', shift_date: '2026-09-01', axiscare_visit_id: '3' }, { id: 'd', status: 'needs_outcome', shift_date: '2026-10-10' },
  { id: 'e', status: 'resolved', shift_date: '2026-10-10', axiscare_visit_id: '5' }],
  [{ id: 'ops_covq_a', status: 'open' }, { id: 'ops_covq_b', status: 'done' }, { id: 'ops_covq_c', status: 'open' }, { id: 'ops_covq_d', status: 'open' }, { id: 'ops_covq_e', status: 'open' }], '2026-10-01').map((c) => c.id).join() === 'a')

/* ── 2 · "Was it covered?" closes itself when AxisCare later shows a clock-in ── */
const askedCase = () => ({ id: 'q1', status: 'needs_outcome', client: 'Ted B.', shift_date: '2026-10-05', shift_time: '14:00-16:00', axiscare_visit_id: '9102', calling_off: 'Ann Cole', calling_off_id: '502', asked: [] })
const askedCard = () => ({ id: 'ops_covq_q1', kind: 'coverage_outcome', case_id: 'q1', status: 'open', title: "Was Ted B.'s shift covered?" })
const clocked = () => [{ id: 9102, caregiver: { id: 601, firstName: 'Joyce', lastName: 'Kim' }, client: { id: 702, firstName: 'Ted' }, scheduledStartDate: '2026-10-05T14:00:00', scheduledEndDate: '2026-10-05T16:00:00', clockIn: { time: '2026-10-05T14:02:00' }, clockOut: { time: '2026-10-05T16:01:00' } }]
const seedQ = (settings) => { reset(); Object.assign(APP.ops_settings, settings); APP.coverage_cases = [askedCase()]; APP.ops_items = [askedCard()]; VISITS = clocked() }

seedQ({ loops_close_live: true })
let r = await run(CW)
ck('switch off · the case is not looked at again (as before)', kase('q1').status === 'needs_outcome' && item('ops_covq_q1').status === 'open' && r.quieter_cards?.on === false && r.quieter_cards.rechecked.length === 0, r.quieter_cards)

seedQ({ mywork_tidy_live: true })
r = await run(CW)
ck('on, loops off · it reports what it would close and changes nothing', r.quieter_cards.rechecked.map((x) => x.case).join() === 'q1' && r.quieter_cards.rechecked[0].how === 'covered'
  && kase('q1').status === 'needs_outcome' && item('ops_covq_q1').status === 'open', r.quieter_cards)

seedQ({ mywork_tidy_live: true, loops_close_live: true })
r = await run(CW)
const q1 = kase('q1'), qc = item('ops_covq_q1')
ck('on · AxisCare shows Joyce clocked in: case closed as covered by her, by Cara', q1.status === 'resolved' && q1.resolved_how === 'covered' && q1.covered_by === 'Joyce Kim' && q1.resolved_by === 'cara' && /Later, AxisCare showed it/.test(q1.note), q1)
ck('on · its "Was it covered?" card closes by itself and says why', qc.status === 'resolved' && qc.resolved_how === 'axiscare_later' && /Closed by itself; nothing was sent/.test(qc.close_note), qc)
ck('on · no family call card for a covered shift', !APP.ops_items.some((i) => /^ops_famcall_/.test(i.id)), APP.ops_items.map((i) => i.id))
ck('on · nothing was texted or emailed', SENT.length === 0, SENT)
const n2 = JSON.stringify(APP.ops_items); r = await run(CW)
ck('on · running again changes nothing', JSON.stringify(APP.ops_items) === n2 && r.quieter_cards.rechecked.length === 0, r.quieter_cards)

seedQ({ mywork_tidy_live: true, loops_close_live: true }); VISITS[0].clockIn = null; VISITS[0].clockOut = null
r = await run(CW)
ck('on · AxisCare still cannot say (no clock-in): the card stays for a person', kase('q1').status === 'needs_outcome' && item('ops_covq_q1').status === 'open' && r.quieter_cards.rechecked.length === 0)

seedQ({ mywork_tidy_live: true, loops_close_live: true }); APP.ops_items[0].status = 'done'
r = await run(CW)
ck('on · a card a person already answered is left alone', kase('q1').status === 'needs_outcome' && item('ops_covq_q1').status === 'done' && r.quieter_cards.rechecked.length === 0)

/* ── 3 · no Caregiver EVV Review card on Mondays ── */
const evvSeed = (settings) => { reset(); Object.assign(APP.ops_settings, settings); at('2026-10-19T05:10:00Z')    // Mon Oct 19, 12:10am Central
  APP.attendance_watch_state = [{ id: 'state', last_date: '2026-10-17' }]
  APP.evv_daily_stats = ['2026-10-12', '2026-10-13', '2026-10-14'].map((d) => ({ id: 'evvd_' + d, date: d, by: { 'Joyce Kim': [4, 2] } })) }
evvSeed({ loops_close_live: true })
r = await run(CW)
ck('switch off · Monday still makes the EVV review (as before)', APP.ops_items.some((i) => /^ops_evvrev_/.test(i.id)), APP.ops_items.map((i) => i.id))
evvSeed({ loops_close_live: true, mywork_tidy_live: true })
r = await run(CW)
ck('on · Monday makes no EVV review card', !APP.ops_items.some((i) => /^ops_evvrev_/.test(i.id)) && /EVV is retired/.test(JSON.stringify(r.evv_review)), [APP.ops_items.map((i) => i.id), r.evv_review])
r = await run(CW, '?evv_review=1')
ck('on · not even when asked for on demand', !APP.ops_items.some((i) => /^ops_evvrev_/.test(i.id)))

/* ── 4 · "Make it official?" as one weekly list ── */
at('2026-10-21T05:02:00Z')                                   // Wed Oct 21, 12:02am Central: the nightly sweep runs
const vis = (sched, day, cg) => ({ id: `s=${sched}:d=${day}`, caregiver: cg, client: { id: 7, firstName: 'Ruth', lastName: 'A' },
  scheduledStartDate: `${day}T09:00:00`, scheduledEndDate: `${day}T13:00:00`, clockIn: cg ? { time: `${day}T09:00:00` } : null, clockOut: cg ? { time: `${day}T13:00:00` } : null })
const JOY = { id: 601, firstName: 'Joyce', lastName: 'Kim' }, PAT = { id: 602, firstName: 'Pat', lastName: 'Long' }
const slot = (sched, cg, past, fut) => [...past.map((d) => vis(sched, d, cg)), ...fut.map((d) => vis(sched, d, null))]
const pastMon = ['2026-10-05', '2026-10-12', '2026-10-19'], futMon = ['2026-10-26', '2026-11-02']
const pastFri = ['2026-10-02', '2026-10-09', '2026-10-16'], futFri = ['2026-10-23', '2026-10-30']
const officialSeed = (settings) => { reset(); Object.assign(APP.ops_settings, settings); VISITS = [...slot('S1', JOY, pastMon, futMon), ...slot('S2', PAT, pastFri, futFri)] }

officialSeed({})
r = await run(CW, '?sweep=1')
const singles = APP.ops_items.filter((i) => /^ops_regular_s/.test(i.id))
ck('switch off · one card per schedule (as before)', singles.map((i) => i.id).sort().join() === 'ops_regular_sS1,ops_regular_sS2' && !APP.ops_items.some((i) => /^ops_regular_week_/.test(i.id)), APP.ops_items.map((i) => i.id))

officialSeed({ mywork_tidy_live: true })
r = await run(CW, '?sweep=1')
const wk = item('ops_regular_week_2026-10-19')
ck('on · ONE card for the week listing both', !APP.ops_items.some((i) => /^ops_regular_s/.test(i.id)) && wk?.status === 'open' && /^Make it official\? 2 schedules this week \(week of Oct 19\)$/.test(wk.title)
  && /Joyce Kim has covered Ruth A's Monday slot/.test(wk.detail) && /Pat Long has covered Ruth A's Friday slot/.test(wk.detail), APP.ops_items)
const wkBefore = JSON.stringify(wk); r = await run(CW, '?sweep=1')
ck('on · the next night adds nothing twice', JSON.stringify(item('ops_regular_week_2026-10-19')) === wkBefore && APP.ops_items.filter((i) => /^ops_regular_/.test(i.id)).length === 1)
at('2026-10-27T05:02:00Z')                                   // the next week
r = await run(CW, '?sweep=1')
ck('on · next week: no new list for schedules already suggested', !item('ops_regular_week_2026-10-26'), APP.ops_items.map((i) => i.id))
at('2026-10-21T05:02:00Z')

officialSeed({ mywork_tidy_live: true }); APP.ops_items = [{ id: 'ops_regular_sS1', status: 'done', title: 'old single card' }]
r = await run(CW, '?sweep=1')
ck('on · a schedule on an old single card is never put on the list', item('ops_regular_week_2026-10-19')?.sched_ids.join() === 'S2' && /1 schedule this week/.test(item('ops_regular_week_2026-10-19').title), APP.ops_items)

officialSeed({ mywork_tidy_live: true }); APP.ops_settings.coverage_watch_live = false
r = await run(CW, '?sweep=1')
ck('on, watcher off · it only reports the list', !item('ops_regular_week_2026-10-19') && r.quieter_cards.official_new === 2, r.quieter_cards)

const failed = res.filter(([, ok]) => !ok)
for (const [n, ok, note] of res) console.log((ok ? '  ok   ' : '  FAIL ') + n + (ok ? '' : '\n         ' + note))
console.log(`\n${res.length - failed.length}/${res.length} passed${failed.length ? '' : ' · ALL PASSED'}`)
process.exit(failed.length ? 1 : 0)
