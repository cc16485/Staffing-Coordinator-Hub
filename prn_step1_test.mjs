// PRN STEP 1 (Samantha 2026-10-28): never text anyone working right now (working_now_live); the ask order familiar, then the PRN
// Teams, then everyone else (prn_order_live); the two approved PRN texts; the two team names. Switches off = no change.
// The pure rules (_shared/overlap.ts workingNow, _shared/cara-waves.ts groupFirst, prnStep1Template) and the real coverage-run
// against a fake database, fake AxisCare and fake GoHighLevel; nothing real is reached.
// HUB=<hub dir> node prn_step1_test.mjs
import fs from 'fs'; import path from 'path'; import vm from 'vm'; import crypto from 'crypto'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions'), HUB = process.env.HUB || path.join(ROOT, '../cc-hub-cara-p1')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1500)])
const RULES = fs.readFileSync(path.join(HUB, 'match-rules.js'), 'utf8'); vm.runInThisContext(RULES); const MR = globalThis.CCMatch
const ELIG = "globalThis.CCElig = { eligibility: (r) => r.elig || { state: 'eligible', summary: 'ok' } };"
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
const O = await import(path.join(FN, '_shared/overlap.ts'))
const W = await import(path.join(FN, '_shared/cara-waves.ts'))
const V = (id, cg, s, e, o = {}) => { const { client, ...rest } = o; return { id, caregiver: { id: cg, firstName: 'C' + cg }, client: { firstName: client || 'Edward' }, scheduledStartDate: s, scheduledEndDate: e, ...rest } }
/* ── 2. the real coverage-run ── */
let T, APP, SENT
const SVC = 'svc_' + 'k'.repeat(60)
const ymd = (d) => d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
const nextSat = (() => { const d = new Date(); d.setDate(d.getDate() + 3); while (d.getDay() !== 6) d.setDate(d.getDate() + 1); return ymd(d) })()
const facts = () => MR.SKILLS.map((s) => ({ episode_id: 'e1', kind: 'need_' + s.key, layer: 'plan', value: 'no' }))
/* 16 caregivers who can all be asked; Pat is on the PRN team list order is the server's own */
const NAMES = ['Amy', 'Ben', 'Cal', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jon', 'Kim', 'Lee', 'Max', 'Ned', 'Oli', 'Pam']
const CG = NAMES.map((f, i) => [String(9001 + i), f, 'Test'])
const reset = (kase, settings = {}) => {
  SENT = []
  APP = {
    caregivers: CG.map(([id, f, l]) => ({ first: f, last: l, phone: '41755501' + id.slice(-2), axiscare_id: id, active: true, alz_date: '2025-01-01' })),
    caregiver_availability: [], coverage_cases: [kase], staffing_plans: [], caregiver_overlay: [], dnr_log: [], ops_items: [],
    ops_settings: { coverage_send_live: true, coverage_quiet_from: 0, coverage_quiet_until: 0, office_quiet_start: 0, office_quiet_end: 0, coverage_alert_admins: ['sam@x.com'], ...settings },   /* no quiet hours, so the result never depends on the hour the test runs */
    coordinator_staff: [{ email: 'sam@x.com', name: 'Sam Owner', phone: '4175550900' }],
    responsibilities: [], nurse_staff: [], coverage_do_not_offer: [], client_checkins: [],
  }
  T = { domains: [], persons: [], contact_optout_current: [], circle_contacts: [], phone_index: [], client_callin_current: [], person_identity: [], pay_tracks: [], job_applicants: [],
    person_source_id: [{ person_id: 'p1', system: 'axiscare', entity_type: 'client', source_id: '500' }], journey_episode: [{ episode_id: 'e1', person_id: 'p1', state: 'established', created_at: '2026-01-01' }],
    client_fact_current: facts(), step1_forms: [], reference_requests: [], cara_run: [], cara_run_event: [], op_events: [],
    rules_approved: [{ file: 'match-rules.js', sha256: sha(RULES) }, { file: 'eligibility-rules.js', sha256: sha(ELIG) }] }
}
/* a small table fake: eq / in / or(lease) filters, update and insert that return the changed rows (one at a time, like Postgres) */
const q = (t) => { const st = { f: [], inF: [], or: null, op: 'select', patch: null, row: null, ret: false }; const b = {
  select() { if (st.op !== 'select') st.ret = true; return b }, order() { return b }, limit() { return b }, gte() { return b }, lte() { return b }, lt() { return b }, gt() { return b }, ilike() { return b }, contains() { return b }, range() { return b }, neq() { return b }, is() { return b }, not() { return b },
  or(s) { st.or = s; return b }, eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF.push([c, v]); return b },
  update(p) { st.op = 'update'; st.patch = p; return b }, insert(r) { st.op = 'insert'; st.row = r; return b }, upsert() { st.op = 'noop'; return b },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error ?? null })) }, single() { return b.maybeSingle() },
  then(ok, bad) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: st.op === 'select' && k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok, bad) }
    const tbl = (T[t] ||= [])
    if (st.op === 'insert') {
      if (t === 'cara_run' && tbl.some((x) => x.case_id === st.row.case_id)) return Promise.resolve({ data: null, error: { message: 'duplicate key' } }).then(ok, bad)
      const row = { version: 1, seen_yes: [], declined: [], wave: 0, wave_base: 0, run_no: 1, at: new Date().toISOString(), ...structuredClone(st.row) }; tbl.push(row)
      return Promise.resolve({ data: st.ret ? [structuredClone(row)] : null, error: null }).then(ok, bad)
    }
    const match = (x) => st.f.every(([c, v]) => x[c] === v) && st.inF.every(([c, v]) => v.includes(x[c]))
      && (!st.or || (x.lease_until == null || x.lease_until < st.or.split('lease_until.lt.')[1]))
    if (st.op === 'update') { const hit = tbl.filter(match); for (const x of hit) Object.assign(x, structuredClone(st.patch)); return Promise.resolve({ data: st.ret ? structuredClone(hit) : null, error: null }).then(ok, bad) }
    if (st.op === 'noop') return Promise.resolve({ data: null, error: null }).then(ok, bad)
    return Promise.resolve({ data: structuredClone(tbl.filter(match)), error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) }
  if (fn === 'coverage_case_add_ask') { const c = (APP.coverage_cases || []).find((x) => x.id === a.p_id); if (!c) return { data: 'not_found', error: null }; if (c.status !== 'open') return { data: 'not_open', error: null }; c.asked = c.asked || []
    const ph = (p) => String(p || '').replace(/\D/g, '').slice(-10)
    if (c.asked.some((x) => (x.axiscare_id && x.axiscare_id === a.p_ask.axiscare_id) || (ph(x.phone).length === 10 && ph(x.phone) === ph(a.p_ask.phone)))) return { data: 'already_asked', error: null }; c.asked.push(a.p_ask); return { data: 'added', error: null } }
  if (fn === 'coverage_case_remove_ask') { const c = (APP.coverage_cases || []).find((x) => x.id === a.p_id); if (c) c.asked = (c.asked || []).filter((x) => x.id !== a.p_ask_id); return { data: true, error: null } }
  if (fn === 'coverage_case_patch') { const c = (APP.coverage_cases || []).find((x) => x.id === a.p_id); if (c) Object.assign(c, a.p_patch); return { data: { outcome: 'ok', item: c }, error: null } }
  return { data: null, error: null } }, auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) } }
globalThis.__dbFor = (key) => ({ from: () => { const b = { select() { return b }, limit() { return Promise.resolve(key === SVC ? { data: [], error: null } : { data: null, error: { message: 'denied' } }) } }; return b } })
/* the office staff check: "Bearer staff:<name>:<role>" is a signed-in coordinator for this test */
globalThis.__staff = (req) => { const m = /^Bearer staff:([^:]+):(\w+)$/.exec(req.headers.get('authorization') || ''); return m ? { ok: true, person_id: 'x', name: m[1], email: m[1].toLowerCase().replace(/ /g, '') + '@x.com', roles: [m[2]] } : { ok: false, status: 401, error: 'sign in' } }
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.startsWith('https://cc.mo-care.com/match-rules.js')) return new Response(RULES, { status: 200 })
  if (url.startsWith('https://cc.mo-care.com/eligibility-rules.js')) return new Response(ELIG, { status: 200 })
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, msg: String(body.message ?? body.body ?? JSON.stringify(body)) }); return new Response('{}', { status: 200 }) }
  if (/axiscare\.com\/api\/caregivers(\?|$)/.test(url)) return new Response(JSON.stringify({ results: { caregivers: APP.caregivers.map((c) => ({ id: Number(c.axiscare_id), firstName: c.first, lastName: c.last, status: { active: true }, classes: [], mailingAddress: { city: 'Nixa', postalCode: '65714' } })) } }), { status: 200 })
  if (/axiscare\.com\/api\/clients\//.test(url)) return new Response(JSON.stringify({ results: { client: { firstName: 'Ruth', lastName: 'Kay', classes: [{ label: 'Private Pay' }], residentialAddress: { city: 'Nixa', postalCode: '65714' } } } }), { status: 200 })
  if (url.includes('axiscare.com')) return new Response(JSON.stringify({ results: { visits: [] }, nextPage: null }), { status: 200 })
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', HUB_JOB_SECRET: 'j'.repeat(64) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
{ const ja = fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)')
  fs.writeFileSync(`${FN}/_shared/_job-auth_p1.ts`, ja)
  fs.writeFileSync(`${FN}/_shared/_staff-auth_p1.ts`, "export const OFFICE_ROLES = ['owner_admin', 'care_coordinator', 'staffing_coordinator']\nexport async function requireStaff(_sb: unknown, req: Request) { return (globalThis as any).__staff(req) }\n") }
process.on('exit', () => { for (const f of ['_job-auth_p1.ts', '_staff-auth_p1.ts']) try { fs.unlinkSync(`${FN}/_shared/${f}`) } catch { /* */ } })
const src = fs.readFileSync(`${FN}/coverage-run/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_p1.ts'").replace(/(['"])\.\.\/_shared\/staff-auth\.ts\1/, "'../_shared/_staff-auth_p1.ts'")
const tmp = path.join(FN, 'coverage-run', '_p1.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const act = async (body, who = null) => { const r = await handler(new Request('https://x/functions/v1/coverage-run', { method: 'POST', headers: { Authorization: 'Bearer ' + (who ? `staff:${who}` : SVC), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return { status: r.status, ...(await r.json()) } }
const tick = async () => { const r = await handler(new Request('https://x/functions/v1/coverage-run?commit=1', { method: 'POST', headers: { Authorization: 'Bearer ' + SVC } })); return r.json() }
const K = (o) => ({ id: 'cv1', status: 'open', reason: 'calloff', client: 'Ruth Kay', client_axiscare_id: '500', client_city: 'Nixa', shift_date: nextSat, shift_time: '08:00-17:00', asked: [], ...o })
const run = () => T.cara_run.find((x) => x.case_id === 'cv1')
const ev = (kind) => T.cara_run_event.filter((e) => e.kind === kind)
const due = () => { run().next_wave_at = new Date(Date.now() - 60000).toISOString() }
const KAY = 'Kay Coord:care_coordinator', SAM = 'Sam Owner:owner_admin'
const caseOf = () => APP.coverage_cases[0]
/* texts to caregivers only (the office's own call-in alert texts go to 4175550900) */
const CG_SENT = () => SENT.filter((x) => /^C:\+?1?41755501/.test(String(x.to)))
const yes = (name, o = {}) => { const a = caseOf().asked.find((x) => x.name === name); Object.assign(a, { state: 'yes', replied_at: new Date().toISOString(), reply: 'yes', ...o }); return a }

/* ── 2. the real coverage-run ── */
let AX_VISITS = [], AX_FAIL = false
const AX_URLS = []
const realFetch3 = globalThis.fetch
globalThis.fetch = async (url, o) => { const u = String(url)
  if (/axiscare\.com\/api\/visits\?startDate=/.test(u) && !/clientIds=/.test(u)) { AX_URLS.push(u)
    if (AX_FAIL) return new Response('{"error":"down"}', { status: 503 })
    return new Response(JSON.stringify({ results: { visits: AX_VISITS }, nextPage: null }), { status: 200 }) }
  return realFetch3(url, o) }
const today = ymd(new Date())
const tomorrow = ymd(new Date(Date.now() + 86400000))
/* a shift tomorrow 10pm to 6am, and the visits that collide with it */

/* ── 1. the pure rules ── */
const now = (x) => O.wallMin(x)
let m = O.workingNow([V('1', 11, '2026-10-24T09:00:00', '2026-10-24T13:00:00', { client: 'Mary', clockIn: { time: '2026-10-24T09:01:00' } })], now('2026-10-24T10:30'))
ck('working right now: clocked in with Mary 9am to 1pm, it is 10:30am', m.size === 1 && m.get('11')[0].line === 'Working right now with Mary until 1pm', [...m.values()])
m = O.workingNow([V('2', 12, '2026-10-24T09:00:00', '2026-10-24T13:00:00')], now('2026-10-24T10:30'))
ck('scheduled now but not clocked in: not "working right now" (the overlap check covers the shift itself)', m.size === 0)
m = O.workingNow([V('3', 13, '2026-10-24T07:00:00', '2026-10-24T10:00:00', { clockIn: { time: '2026-10-24T07:00:00' }, clockOut: { time: '2026-10-24T10:02:00' } })], now('2026-10-24T10:30'))
ck('clocked out at 10:02am: back in their normal place at 10:30am', m.size === 0)
m = O.workingNow([V('4', 618, '2026-10-24T09:00:00', '2026-10-24T13:00:00', { clockIn: { time: '2026-10-24T09:00:00' } }), V('5', 15, '2026-10-24T09:00:00', '2026-10-24T13:00:00', { removed: true, clockIn: { time: '2026-10-24T09:00:00' } })], now('2026-10-24T10:30'))
ck('the "Canceled Shift" placeholder and removed visits never count', m.size === 0)
m = O.workingNow([V('6', 16, '2026-10-24T09:00:00', '2026-10-24T10:00:00', { clockIn: { time: '2026-10-24T09:00:00' } })], now('2026-10-24T10:30'))
ck('still clocked in past the scheduled end: working right now, no "until" time', m.size === 1 && m.get('16')[0].line === 'Working right now with Edward', [...m.values()])
const both = O.withWorkingNow(new Map([['11', [{ line: 'Scheduled 2pm to 6pm with Bob' }]]]), new Map([['11', [{ line: 'Working right now with Mary until 1pm' }]], ['12', [{ line: 'Working right now with Ann until noon' }]]]))
ck('an overlapping visit keeps its own reason; someone only working now is added, marked now_only', both.get('11')[0].line === 'Scheduled 2pm to 6pm with Bob' && !both.get('11')[0].now_only && both.get('12')[0].now_only === true)

/* the order */
const C = { shift_date: '2026-11-05', shift_time: '08:00-12:00' }   /* a Thursday morning */
const thuAM = { thu: ['morning'] }
const rows = [
  { name: 'Stranger Fits', axiscare_id: '1', windows: thuAM },
  { name: 'Familiar Unknown', axiscare_id: '2', windows: null, history: { visits: 4, last: '2026-08-12' } },
  { name: 'PRN Fits', axiscare_id: '3', windows: thuAM, prn_pref: { notice: 'same_day', team: 'cna' } },
  { name: 'PRN Unknown', axiscare_id: '4', windows: null, prn_pref: { notice: 'same_day', team: 'caregiver' } },
  { name: 'Familiar Fits', axiscare_id: '5', windows: thuAM, history: { visits: 1, last: '2026-09-30' } },
  { name: 'Favorite Unknown', axiscare_id: '6', windows: null, history: { visits: 1, last: '2026-07-01' }, this_client: { favorite: true } },
  { name: 'Stranger Unknown', axiscare_id: '7', windows: null },
  { name: 'Told us no', axiscare_id: '8', windows: { thu: ['evening'] }, outside_ok: false },
]
const order = (g) => W.judgeForWaves(rows, C, { minsToStart: 5000, ongoing: false, groupFirst: g })
const on = order(true)
ck('switch on: familiar first (favorite first), then the PRN Teams (fits, then Unknown), then everyone else',
  on.ordered.map((j) => j.row.name).join(', ') === 'Favorite Unknown, Familiar Fits, Familiar Unknown, PRN Fits, PRN Unknown, Stranger Fits, Stranger Unknown', on.ordered.map((j) => j.row.name))
ck('a familiar caregiver whose availability is Unknown is asked before a stranger whose availability fits', on.ordered.findIndex((j) => j.row.name === 'Familiar Unknown') < on.ordered.findIndex((j) => j.row.name === 'Stranger Fits'))
ck('only "explicitly unavailable" is left out: outside their stated times with outside-hours texts unticked', on.excluded.map((x) => x.name).join() === 'Told us no' && on.excluded[0].code === 'outside', on.excluded)
const off = order(false)
ck('switch off: the order is exactly as before (availability first)', off.ordered.map((j) => j.row.name).join(', ') === W.judgeForWaves(rows, C, { minsToStart: 5000, ongoing: false }).ordered.map((j) => j.row.name).join(', ')
  && off.ordered[0].row.name !== 'Favorite Unknown', off.ordered.map((j) => j.row.name))

/* the approved wording */
const thu = ymd(new Date(Date.now() + 5 * 86400000)), thuW = new Date(thu + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(/^(\w{3}), /, '$1 ')
const KS = { shift_date: thu, shift_time: '08:00-12:00', client_city: 'Springfield' }
const fill = (t) => t.replaceAll('{first_name}', 'Grace').replaceAll('{client}', 'Ruth').replaceAll('{care}', '')
ck('familiar PRN text, word for word as approved', fill(M.prnStep1Template({}, KS, '2026-10-12')) === `Hi Grace, it's Caring Companions. Ruth in Springfield needs someone ${thuW}, 8am to 12pm. You cared for Ruth in October, so you'd be a familiar face. Can you take it? Reply YES or NO. No pressure either way.`, fill(M.prnStep1Template({}, KS, '2026-10-12')))
const team = M.prnStep1Template({}, { ...KS, client_city: 'Nixa' }, null).replaceAll('{first_name}', 'Tasha').replaceAll('{client}', 'Mary').replaceAll('{care}', 'This visit needs CNA care (transfers). ')
ck('PRN Team text, word for word as approved', team === `Hi Tasha, it's Caring Companions. You're part of our care continuity team, and Mary in Nixa needs someone ${thuW}, 8am to 12pm. This visit needs CNA care (transfers). Can you take it? Reply YES or NO. No pressure either way.`, team)
ck('no town on the case: " in {town}" drops out whole', !/ in \{|in ,| in needs/.test(M.prnStep1Template({}, { ...KS, client_city: '' }, null)), M.prnStep1Template({}, { ...KS, client_city: '' }, null))
ck('edited wording in the Hub is used instead (coverage_msg_prn_team)', M.prnStep1Template({ coverage_msg_prn_team: 'Hey {first_name}, {client} {when}?' }, KS, null) === `Hey {first_name}, {client} ${thuW}, 8am to 12pm?`)
ck('no em dashes in either approved text', !/\u2014/.test(M.PRN_FAMILIAR_MSG + M.PRN_TEAM_MSG))

/* ── 2. the real coverage-run: working right now ── */
const chi = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T').slice(0, 16) + ':00'
const in3 = ymd(new Date(Date.now() + 3 * 86400000))
const setupNow = (settings = {}) => { reset(K({ shift_date: in3, shift_time: '08:00-12:00' }), { cara_run_live: true, cara_list_live: true, cara_wave_rules_live: true, ...settings }); AX_FAIL = false; AX_URLS.length = 0
  /* Amy is clocked in right now with Mary (started an hour ago, due out in two hours); the open shift is 3 days away, no overlap */
  AX_VISITS = [V('n1', 9001, chi(Date.now() - 3600000), chi(Date.now() + 7200000), { client: 'Mary', clockIn: { time: chi(Date.now() - 3600000) } })] }
setupNow()
let L = await act({ action: 'ask_list', case_id: 'cv1' }, KAY)
ck('switch off: Amy, working now on a visit that doesn\'t overlap, is ready to ask as before', (L.ready || []).some((x) => x.name === 'Amy Test'), L.dont?.map((x) => [x.name, x.why]))
setupNow({ working_now_live: true })
L = await act({ action: 'ask_list', case_id: 'cv1' }, KAY)
const amy = (L.dont || []).find((x) => x.name === 'Amy Test')
ck('switch on: Amy is under Not contacted, "Working right now with Mary until ..."', amy && /^Working right now with Mary until \d/.test(amy.why) && amy.label === 'Working right now', [amy, L.ready?.map((x) => x.name)])
ck('switch on: today was read from AxisCare too (the shift\'s own range doesn\'t cover today)', AX_URLS.some((u) => u.includes('startDate=' + today + '&endDate=' + today)), AX_URLS)
let j = await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
ck('switch on: Cara\'s wave texts 5, never Amy', CG_SENT().length === 5 && !caseOf().asked.some((a) => a.name === 'Amy Test'), caseOf().asked.map((a) => a.name))
setupNow({ working_now_live: true })
j = await act({ action: 'send_selected', case_id: 'cv1', recipients: ['Amy Test'] }, KAY)
ck('switch on: the coordinator\'s own send to Amy is refused', !(j.sent || []).length, j)
setupNow({ working_now_live: true }); AX_FAIL = true
L = await act({ action: 'ask_list', case_id: 'cv1' }, KAY)
ck('switch on, AxisCare down: nobody is ready to ask (fail closed)', !(L.ready || []).length, L.ready?.map((x) => x.name))
setupNow({ working_now_live: true }); AX_VISITS[0].clockOut = { time: chi(Date.now() - 60000) }
L = await act({ action: 'ask_list', case_id: 'cv1' }, KAY)
ck('switch on: once Amy clocks out she is back on the list', (L.ready || []).some((x) => x.name === 'Amy Test'), L.dont?.map((x) => [x.name, x.why]))

/* ── 3. the real coverage-run: the team names and the PRN Team text ── */
const prn = (settings) => { setupNow({ working_now_live: false, prn_order_live: true, ...settings }); AX_VISITS = []
  T.pay_tracks = [{ applicant_id: 'a2', axiscare_caregiver_id: '9002', track: 'prn_team', team: 'caregiver' }, { applicant_id: 'a3', axiscare_caregiver_id: '9003', track: 'prn_team', team: 'cna' }]
  T.job_applicants = [{ id: 'a2', prn: { notice: 'same_day' } }, { id: 'a3', prn: { notice: 'same_day' } }] }
prn()
L = await act({ action: 'ask_list', case_id: 'cv1' }, KAY)
const lab = (n) => ((L.ready || []).find((x) => x.name === n) || {}).label
ck('the ask list names each team', lab('Ben Test') === 'PRN Caregiver Team' && lab('Cal Test') === 'PRN CNA Team', (L.ready || []).map((x) => [x.name, x.label]))
ck('with nobody familiar, the PRN Teams are first in line', (L.ready || []).slice(0, 2).map((x) => x.name).sort().join() === 'Ben Test,Cal Test', (L.ready || []).map((x) => x.name))
j = await act({ action: 'ask_everyone', case_id: 'cv1', send: true, names: ['Ben Test'] }, KAY)
const benMsg = (CG_SENT()[0] || {}).msg || ''
ck('Ben gets the approved PRN Team text', /^Hi Ben, it's Caring Companions\. You're part of our care continuity team, and Ruth in Nixa needs someone \w{3} \w{3} \d+, 8am to 12pm\. Can you take it\? Reply YES or NO\. No pressure either way\.$/.test(benMsg), [benMsg, j])
prn({ prn_order_live: false })
j = await act({ action: 'ask_everyone', case_id: 'cv1', send: true, names: ['Ben Test'] }, KAY)
ck('switch off: the old "PRN opportunity" text, as before', /PRN opportunity/.test((CG_SENT()[0] || {}).msg || ''), CG_SENT())
globalThis.fetch = realFetch3


/* ── 4. covered PRN shifts are counted on their own (prn_count_live) ── */
{ const F = await import(path.join(FN, '_shared/coverage-fill.ts') + '?p1')
  const mk = (settings, tracks, fail) => { const log = []; const db = { from: (t) => { const st = { f: [] }; const b = {
    select() { return b }, eq(c, v) { st.f.push([c, v]); return b },
    maybeSingle() { if (t === 'app_data') return Promise.resolve({ data: { data: st.f[0][1] === 'ops_settings' ? settings : [] } })
      if (t === 'pay_tracks') return Promise.resolve({ data: tracks.find((x) => x.axiscare_caregiver_id === st.f[0][1]) ?? null }) },
    insert(row) { if (fail) return Promise.resolve({ error: { message: fail } }); if (log.some((x) => x.case_id === row.case_id && x.axiscare_caregiver_id === row.axiscare_caregiver_id)) return Promise.resolve({ error: { message: 'duplicate key value violates unique constraint' } }); log.push(row); return Promise.resolve({ error: null }) } }; return b } }; return { db, log } }
  const kase = { id: 'cv9', shift_date: '2026-11-05', asked: [{ name: 'Grace Lee', axiscare_id: '777' }, { name: 'Ann Roe', axiscare_id: '778' }] }
  const PRN = [{ axiscare_caregiver_id: '777', applicant_id: 'app7', track: 'prn_team' }]
  let x = mk({}, PRN); ck('switch off: nothing counted', await F.countPrnShift(x.db, kase, 'Grace Lee') === 'off' && !x.log.length)
  x = mk({ prn_count_live: true }, PRN)
  const r1 = await F.countPrnShift(x.db, kase, 'Grace Lee'), r2 = await F.countPrnShift(x.db, kase, 'Grace Lee')
  ck('switch on: Grace (PRN Team) covering is counted once, as confirmed, with the shift date', r1 === 'counted' && r2 === 'counted' && x.log.length === 1 && x.log[0].kind === 'confirmed' && x.log[0].shift_date === '2026-11-05' && x.log[0].applicant_id === 'app7', x.log)
  ck('switch on: Ann (not on a PRN Team) is not counted', await F.countPrnShift(x.db, kase, 'Ann Roe') === 'not_prn' && x.log.length === 1)
  x = mk({ prn_count_live: true }, PRN, 'connection reset')
  ck('a failed count never throws (the fill stands)', await F.countPrnShift(x.db, kase, 'Grace Lee') === 'error') }

for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
