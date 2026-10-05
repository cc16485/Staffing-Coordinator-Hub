// Today cockpit, Phase 3 · right person first, then escalate (_shared/duty.ts + work-route + timekeeper-watch +
// coverage-run). The REAL functions against a fake database, a fake AxisCare, a fake GoHighLevel and a controllable
// clock. Made-up people only; nothing leaves this machine. node duty_phase3_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1400)]);
const FN = 'supabase/functions';
let NOW = Date.parse('2026-10-06T15:00:00Z')          // Tue Oct 6, 10:00am Central (CDT)
const RealDate = Date
class FakeDate extends RealDate { constructor(...a) { if (!a.length) super(NOW); else super(...a) } static now() { return NOW } }
globalThis.Date = FakeDate
const at = (iso) => { NOW = RealDate.parse(iso) }


/* ── 1 · the rules on their own ── */
const D = await import(path.join(process.cwd(), FN, '_shared/duty.ts'))
at('2026-10-06T15:00:00Z')                                   // Tue 10:00am Central
const K = 'kry@mo-care.com', S = 'sam@mo-care.com'
const W = [{ area: 'staffing', person: K, recur: { days: [1, 2], from: '08:00', to: '14:00' }, active: true },
  { area: 'staffing', person: K, recur: { days: [3, 4, 5], from: '08:00', to: '11:00' }, active: true }]
ck('rule · Tuesday 10am: Krystal holds Staffing (from the schedule)', D.seatHolder(W, 'staffing', new Date(), {}, S).person === K && D.seatHolder(W, 'staffing', new Date(), {}, S).source === 'schedule')
at('2026-10-06T20:00:00Z')                                   // Tue 3pm
ck('rule · Tuesday 3pm: nobody scheduled, so the "when nobody is scheduled" person, else the first alert admin', D.seatHolder(W, 'staffing', new Date(), { duty_default_staffing: 'zach@mo-care.com' }, S).person === 'zach@mo-care.com'
  && D.seatHolder(W, 'staffing', new Date(), {}, S).person === S && D.seatHolder(W, 'staffing', new Date(), {}, S).source === 'fallback')
at('2026-10-07T15:30:00Z')                                   // Wed 10:30am
ck('rule · Wednesday 10:30: Krystal (Wed-Fri 8-11)', D.seatHolder(W, 'staffing', new Date(), {}, S).person === K)
ck('rule · a planned window never holds duty', D.seatHolder([{ ...W[1], status: 'planned' }], 'staffing', new Date(), {}, S).person === S)
ck('rule · a one-off beats the pattern', D.seatHolder([...W, { area: 'staffing', person: 'jess@mo-care.com', start: '2026-10-07T13:00:00Z', end: '2026-10-07T23:00:00Z' }], 'staffing', new Date(), {}, S).person === 'jess@mo-care.com')
const n0 = new Date()
const it = (o) => ({ id: 'x', status: 'open', created_at: new Date(NOW - 20 * 60000).toISOString(), ...o })
ck('rule · uncovered shift starting within 60 min, 5 min untaken: urgent', D.escalationDue(it({ kind: 'coverage', created_at: new Date(NOW - 6 * 60000).toISOString() }), n0, { minsToShift: 40, ownerFirst: 'Krystal' })?.level === 'urgent')
ck('rule · ...but not at 4 minutes, and not 2 hours out', !D.escalationDue(it({ kind: 'coverage', created_at: new Date(NOW - 4 * 60000).toISOString() }), n0, { minsToShift: 40 }) && !D.escalationDue(it({ kind: 'coverage' }), n0, { minsToShift: 120 }))
ck('rule · no clock-in, 15 min untaken: urgent ("Krystal hasn\'t taken it in 15 minutes")', D.escalationDue(it({ kind: 'staffing_issue', opened_by: 'timekeeper' }), n0, { ownerFirst: 'Krystal' })?.why === "Krystal hasn't taken it in 15 minutes")
ck('rule · taken (claimed) never escalates; parked with a wake-up never escalates', !D.escalationDue(it({ kind: 'staffing_issue', opened_by: 'timekeeper', claimed_by: K }), n0, {}) && !D.escalationDue(it({ due: '2026-10-01T00:00:00Z', sub_state: 'waiting', check_back: '2026-10-20' }), n0, {}))
ck('rule · normal work escalates once overdue', D.escalationDue(it({ kind: 'request', due: new Date(NOW - 3600000).toISOString() }), n0, {})?.level === 'overdue' && !D.escalationDue(it({ kind: 'request', due: new Date(NOW + 3600000).toISOString() }), n0, {}))
ck('rule · only job-made scheduling work is routed (not what a person placed)', D.routable(it({ kind: 'coverage', created_by: 'coverage-run' }), '') && !D.routable(it({ kind: 'coverage', created_by: 'jess@mo-care.com' }), '')
  && !D.routable(it({ kind: 'coverage', created_by: 'coverage-run', owner_history: [{ how: 'took' }] }), '') && !D.routable(it({ kind: 'request', created_by: 'x-run' }), ''))

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

const WR = await load('work-route'), TK = await load('timekeeper-watch')
const run = async (h, qs = '') => { const r = await h(new Request('https://x/fn' + qs, { method: 'POST', headers: { Authorization: 'Bearer eyJanon', 'x-cron-secret': JOBSEC } })); return r.json() }
const item = (id) => APP.ops_items.find((i) => i.id === id)
const seed = (live) => { reset(); at('2026-10-06T15:00:00Z')        // Tue 10am: Krystal on Staffing
  APP.ops_settings.routing_live = live; APP.ops_settings.routing_since = '2026-10-06T00:00:00Z'
  APP.duty_windows = W.map((w, i) => ({ id: 'dw' + i, ...w })); APP.positions = []
  T.persons = [{ person_id: 'p_s', primary_email: 'sam@mo-care.com', full_name: 'Samantha Troutman' }, { person_id: 'p_k', primary_email: 'kry@mo-care.com', full_name: 'Krystal Land' }]
  APP.coverage_cases = [{ id: 'cc1', status: 'open', shift_date: '2026-10-06', shift_time: '10:40-14:00', client: 'Ruth' }]
  const ago = (m) => new Date(NOW - m * 60000).toISOString()
  APP.ops_items = [
    { id: 'ops_cov_cc1', kind: 'coverage', coverage_case_id: 'cc1', status: 'open', domain: 'scheduling_coverage', owner: S, created_by: 'coverage-run', created_at: ago(7), title: 'Uncovered shift: Ruth' },
    { id: 'ops_tk_1', kind: 'staffing_issue', status: 'open', domain: 'scheduling_coverage', owner: S, opened_by: 'timekeeper', created_by: 'timekeeper-watch', created_at: ago(3), title: 'NO CLOCK-IN' },
    { id: 'mine', kind: 'request', status: 'open', owner: K, created_by: 'jess@mo-care.com', created_at: ago(600), due: ago(60), title: 'Krystal overdue' },
    { id: 'sams', kind: 'request', status: 'open', owner: S, created_at: ago(600), due: ago(60), title: 'Samantha overdue' },
    { id: 'taken', kind: 'staffing_issue', status: 'open', domain: 'scheduling_coverage', owner: K, opened_by: 'timekeeper', claimed_by: K, created_at: ago(40), created_by: 'timekeeper-watch', routed: { at: ago(40) } },
    { id: 'old', kind: 'coverage', status: 'open', domain: 'scheduling_coverage', owner: S, created_by: 'coverage-run', created_at: '2026-10-05T10:00:00Z' } ] }

seed(false); let before = JSON.stringify(APP.ops_items), r = await run(WR)
ck('off · it reports what it would route and escalate, and writes nothing', r.live === false && r.routed === 2 && r.escalated_urgent === 1 && r.escalated_overdue === 1 && JSON.stringify(APP.ops_items) === before && r.seats.staffing.first === 'Krystal' && r.seats.escalation.first === 'Samantha', r)
seed(true); r = await run(WR)
const cov = item('ops_cov_cc1'), tk = item('ops_tk_1')
ck('on · new job-made scheduling work goes to Krystal (on Staffing now), with the reason in its history', cov.owner === K && tk.owner === K && cov.routed?.seat === 'staffing' && cov.owner_history.at(-1).how === 'routed' && cov.history.some((h) => /Routed to Krystal Land \(on Staffing duty now\)/.test(h.text)), cov)
ck('on · work made before the switch is left where it is', item('old').owner === S && !item('old').routed)
ck('on · the shift starts in 40 min and nobody took it for 7 min: Samantha (Owner Escalation) is pulled in, Krystal keeps it', cov.escalation?.to === S && cov.escalation.level === 'urgent' && cov.owner === K && /Krystal hasn't taken it in 5 minutes/.test(cov.escalation.why), cov.escalation)
ck('on · the 3-minute-old no clock-in is not escalated yet', !tk.escalation)
ck('on · Krystal\'s overdue item: escalated as overdue (her Escalated list, not Act Now)', item('mine').escalation?.level === 'overdue' && item('mine').owner === K)
ck('on · Samantha is never escalated to herself; taken work never escalates', !item('sams').escalation && !item('taken').escalation)
at('2026-10-06T15:13:00Z'); r = await run(WR)
ck('on · 15 minutes on, the no clock-in escalates too', item('ops_tk_1').escalation?.level === 'urgent' && /15 minutes/.test(item('ops_tk_1').escalation.why))
const n1 = APP.ops_items.map((x) => (x.history || []).length).join(); r = await run(WR)
ck('on · running again adds nothing', APP.ops_items.map((x) => (x.history || []).length).join() === n1 && r.escalated_urgent === 0 && r.routed === 0, r)
item('ops_tk_1').claimed_by = K; r = await run(WR)
ck('on · Krystal takes it: the escalation is marked cleared ("taken")', item('ops_tk_1').escalation?.cleared_at && item('ops_tk_1').escalation?.cleared_why === 'taken', item('ops_tk_1').escalation)
ck('on · nothing texted or emailed by the routing job', SENT.length === 0, SENT)

/* ── 3 · missed clock-in texts: the person on Staffing first, then Owner Escalation after 15 minutes (daytime) ── */
const tkSeed = (live) => { reset(); APP.ops_settings.routing_live = live; at('2026-10-06T14:05:00Z')     // Tue 9:05am
  APP.duty_windows = W.map((w, i) => ({ id: 'dw' + i, ...w })); APP.positions = []
  VISITS = [{ id: 9401, caregiver: { id: 501, firstName: 'Maria', lastName: 'Lopez' }, client: { id: 701, firstName: 'Ruth', lastName: 'Adams' }, scheduledStartDate: '2026-10-06T09:00:00', scheduledEndDate: '2026-10-06T13:00:00', clockIn: null, clockOut: null }]
  APP.coordinator_staff = [{ email: 'sam@mo-care.com', name: 'Samantha T', phone: '4175550901' }, { email: 'kry@mo-care.com', name: 'Krystal L', phone: '4175550902' }]
  APP.ops_items = [] }
const toPh = (p) => SENT.filter((m) => String(m.to).replace(/\D/g, '').endsWith(p))
tkSeed(true); await run(TK)
ck('tk · routing on: the first admin text goes ONLY to Krystal (on Staffing now)', toPh('4175550902').length === 1 && toPh('4175550901').length === 0, SENT.map((m) => m.to))
at('2026-10-06T14:21:00Z'); await run(TK)
ck('tk · after 15 minutes nobody took it: Samantha (Owner Escalation) is texted too', toPh('4175550901').length >= 1 && toPh('4175550902').length >= 2, SENT.map((m) => m.to))
tkSeed(true); APP.ops_items = []; at('2026-10-06T14:05:00Z'); await run(TK); APP.ops_items.forEach((i) => { if (/^ops_tk_/.test(i.id)) i.claimed_by = 'kry@mo-care.com' })
at('2026-10-06T14:21:00Z'); await run(TK)
ck('tk · if Krystal took it, Samantha is not texted', toPh('4175550901').length === 0, SENT.map((m) => m.to))
tkSeed(false); await run(TK)
ck('tk · routing off: everyone on the alert list, exactly as before', toPh('4175550902').length === 1 && toPh('4175550901').length === 1, SENT.map((m) => m.to))

/* ── 4 · coverage-run keeps what people did to an Uncovered shift card ── */
const CRsrc = fs.readFileSync(`${FN}/coverage-run/index.ts`, 'utf8')
ck('coverage-run · rewriting the card keeps owner, who took it, history, routing and escalation', /const prevItem = items\.find/.test(CRsrc) && ['owner', 'claimed_by', 'owner_history', 'history', 'routed', 'escalation'].every((k) => CRsrc.includes(`'${k}'`)))
ck('source · the routing job never sends anything', !/ghlSend|conversations\/messages|textAdmin|fetch\(/.test(fs.readFileSync(`${FN}/work-route/index.ts`, 'utf8')))

for (const [n, ok, note] of res) console.log((ok ? 'PASS' : 'FAIL') + ' · ' + n + (ok ? '' : '  ' + note))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
process.exit(res.every((x) => x[1]) ? 0 : 1)
