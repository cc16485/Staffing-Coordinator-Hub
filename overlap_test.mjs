// ALREADY WORKING THEN (Samantha 2026-10-25: "I do NOT want us texting caregivers to cover an open shift if they're already
// working or scheduled to work an overlapping shift with Caring Companions in AxisCare."). Her five questions, one by one:
// AxisCare read at every send (waves, Ask everyone now, the coordinator's send, follow-ups); the WHOLE shift, overnights
// included; scheduled AND clocked in now; a change after the list was built is caught at sending; AxisCare unreadable =
// nobody is texted. The pure rules (_shared/overlap.ts) and the real coverage-run. HUB=<hub dir> node overlap_test.mjs
import fs from 'fs'; import path from 'path'; import vm from 'vm'; import crypto from 'crypto'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions'), HUB = process.env.HUB || path.join(ROOT, '../cc-hub-cara-p1')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1500)])
const RULES = fs.readFileSync(path.join(HUB, 'match-rules.js'), 'utf8'); vm.runInThisContext(RULES); const MR = globalThis.CCMatch
const ELIG = "globalThis.CCElig = { eligibility: (r) => r.elig || { state: 'eligible', summary: 'ok' } };"
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
const R = await import(path.join(FN, '_shared/cara-run.ts'))

const O = await import(path.join(FN, '_shared/overlap.ts'))
/* ── 1. the rules ── */
const now = (s) => O.wallMin(s)
const V = (id, cg, s, e, o = {}) => { const { client, ...rest } = o; return { id, caregiver: { id: cg, firstName: 'C' + cg }, client: { firstName: client || 'Edward' }, scheduledStartDate: s, scheduledEndDate: e, ...rest } }
const ON = { shift_date: '2026-10-24', shift_time: '22:00-06:00' }
const ids = (m) => [...m.keys()].sort().join(',')
let m = O.conflictsFor([V('1', 11, '2026-10-24T21:00:00', '2026-10-25T01:00:00')], ON, now('2026-10-24T18:00'))
ck('overnight shift 10pm to 6am vs a visit 9pm to 1am: a conflict (the old check skipped overnights entirely)', ids(m) === '11' && m.get('11')[0].line === 'Scheduled 9pm to 1am with Edward', [...m.values()])
m = O.conflictsFor([V('2', 12, '2026-10-25T05:00:00', '2026-10-25T09:00:00', { client: 'Ruth' })], ON, now('2026-10-24T18:00'))
ck('overnight shift vs the next morning\'s 5am visit (overlaps 5 to 6am): a conflict, said with its day', ids(m) === '12' && m.get('12')[0].line === 'Scheduled Sun 5am to 9am with Ruth', [...m.values()])
m = O.conflictsFor([V('3', 13, '2026-10-24T18:00:00', '2026-10-24T22:00:00'), V('4', 14, '2026-10-25T06:00:00', '2026-10-25T10:00:00')], ON, now('2026-10-24T18:00'))
ck('back to back is fine: a visit ending at 10pm, and one starting at 6am', m.size === 0, [...m.entries()])
const DAYS = { shift_date: '2026-10-24', shift_time: '08:00-16:00' }
m = O.conflictsFor([V('5', 15, '2026-10-24T15:00:00', '2026-10-24T17:00:00')], DAYS, now('2026-10-24T06:00'))
ck('the WHOLE shift, not just its start: 8am to 4pm vs a 3pm to 5pm visit is a conflict', ids(m) === '15')
m = O.conflictsFor([V('6', 16, '2026-10-24T18:00:00', '2026-10-24T21:45:00', { clockIn: { time: '2026-10-24T18:02:00-05:00' } })], ON, now('2026-10-24T22:10'))
ck('clocked in now (since 6pm, due out 9:45pm, not clocked out at 10:10pm): busy for the 10pm shift', ids(m) === '16' && m.get('16')[0].clocked_in && /^Clocked in now with Edward \(scheduled 6pm to 9:45pm\)$/.test(m.get('16')[0].line), [...m.values()])
m = O.conflictsFor([V('7', 17, '2026-10-24T18:00:00', '2026-10-24T21:45:00', { clockIn: { time: '2026-10-24T18:02:00' }, clockOut: { time: '2026-10-24T21:40:00' } })], ON, now('2026-10-24T22:10'))
ck('clocked out at 9:40pm: free for the 10pm shift', m.size === 0)
m = O.conflictsFor([V('8', 18, '2026-10-24T07:00:00', '2026-10-24T09:00:00', { clockIn: { time: '2026-10-24T07:00:00' } })], ON, now('2026-10-24T22:10'))
ck('a forgotten clock-out from this morning is not "still working" tonight', m.size === 0)
m = O.conflictsFor([V('9', 19, '2026-10-24T21:00:00', '2026-10-25T01:00:00', { removed: true }), V('10', 618, '2026-10-24T21:00:00', '2026-10-25T01:00:00'), V('99', 20, '2026-10-24T22:00:00', '2026-10-25T06:00:00')], { ...ON, axiscare_visit_id: '99' }, now('2026-10-24T18:00'))
ck('removed visits, the "Canceled Shift" placeholder and the very visit being covered never count', m.size === 0, [...m.entries()])
ck('AxisCare is read from the day before to the day after', JSON.stringify(O.readRange(ON)) === '["2026-10-23","2026-10-25"]')

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
  fs.writeFileSync(`${FN}/_shared/_job-auth_cr.ts`, ja)
  fs.writeFileSync(`${FN}/_shared/_staff-auth_cr.ts`, "export const OFFICE_ROLES = ['owner_admin', 'care_coordinator', 'staffing_coordinator']\nexport async function requireStaff(_sb: unknown, req: Request) { return (globalThis as any).__staff(req) }\n") }
process.on('exit', () => { for (const f of ['_job-auth_cr.ts', '_staff-auth_cr.ts']) try { fs.unlinkSync(`${FN}/_shared/${f}`) } catch { /* */ } })
const src = fs.readFileSync(`${FN}/coverage-run/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_cr.ts'").replace(/(['"])\.\.\/_shared\/staff-auth\.ts\1/, "'../_shared/_staff-auth_cr.ts'")
const tmp = path.join(FN, 'coverage-run', '_cr.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
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
const setup = (settings = {}) => { reset(K({ shift_date: tomorrow, shift_time: '22:00-06:00' }), { cara_run_live: true, cara_list_live: true, cara_wave_rules_live: true, ...settings }); AX_VISITS = []; AX_FAIL = false; AX_URLS.length = 0 }
setup()
AX_VISITS = [V('a', 9001, tomorrow + 'T21:00:00', ymd(new Date(Date.now() + 2 * 86400000)) + 'T01:00:00', { client: 'Edward' })]   // Amy: 9pm to 1am, overlapping
let L = await act({ action: 'ask_list', case_id: 'cv1' }, KAY)
const amyDont = (L.dont || []).find((x) => x.name === 'Amy Test')
ck('real server: Amy, scheduled 9pm to 1am, is under Do not ask with her conflicting hours shown', amyDont && /^Already working then: Scheduled 9pm to 1am with Edward$/.test(amyDont.why) && amyDont.label === 'Working then', [amyDont, L.dont?.map((x) => x.name)])
ck('real server: AxisCare was read for the day before to the day after', AX_URLS.some((u) => u.includes('startDate=' + today) && u.includes('endDate=' + ymd(new Date(Date.now() + 2 * 86400000)))), AX_URLS)
ck('real server: the list says when AxisCare was read', !!L.meta?.schedule?.read_at && L.meta.schedule.checked === true && L.meta.schedule.held === null, L.meta?.schedule)
/* Cara's wave never texts her */
let j = await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
ck('Cara\'s wave: 5 texted, never Amy', CG_SENT().length === 5 && !caseOf().asked.some((a) => a.name === 'Amy Test'), caseOf().asked.map((a) => a.name))
/* Ask everyone now never lists or texts her */
j = await act({ action: 'ask_everyone', case_id: 'cv1', preview: true }, KAY)
ck('Ask everyone now: Amy is not on the list', !(j.names || []).includes('Amy Test'), j.names)
/* the coordinator's own send of Amy is refused */
j = await act({ action: 'send_selected', case_id: 'cv1', recipients: ['Amy Test'] }, KAY)
ck('the coordinator\'s own send to Amy is refused (re-checked on the server)', !(j.sent || []).length && (j.refused_not_eligible || []).includes('amy test'), j)

/* 4. AxisCare changes AFTER the list was built: caught at sending */
setup()
L = await act({ action: 'ask_list', case_id: 'cv1' }, KAY)
ck('before: Ben is ready to ask', (L.ready || []).some((x) => x.name === 'Ben Test'))
AX_VISITS = [V('b', 9002, tomorrow + 'T23:00:00', ymd(new Date(Date.now() + 2 * 86400000)) + 'T03:00:00', { client: 'Peggy' })]   // Ben gets scheduled meanwhile
j = await act({ action: 'send_selected', case_id: 'cv1', recipients: ['Ben Test'] }, KAY)
ck('after AxisCare changed: sending to Ben is refused, nothing texted', !(j.sent || []).length && !CG_SENT().length, j)
AX_VISITS = []
await act({ action: 'send_selected', case_id: 'cv1', recipients: ['Cal Test'] }, KAY)
AX_VISITS = [V('c', 9003, tomorrow + 'T22:00:00', ymd(new Date(Date.now() + 2 * 86400000)) + 'T06:00:00', { client: 'LeeAnn' })]
j = await act({ action: 'follow_up', case_id: 'cv1', ask_ids: caseOf().asked.map((a) => a.id), message: 'Hi {first_name}, still open. Reply YES or NO.' }, KAY)
ck('a follow-up skips someone scheduled elsewhere since they were asked, and says why', !(j.sent || []).length && (j.skipped || []).some((s) => /^Cal Test \(already working then: Scheduled 10pm to 6am with LeeAnn\)$/.test(s)) && CG_SENT().length === 1, j)

/* 5. AxisCare can't be read: nobody is texted */
setup()
AX_FAIL = true
L = await act({ action: 'ask_list', case_id: 'cv1' }, KAY)
ck('AxisCare down: nobody is Ready to ask; everyone held with the reason; the list says it could not be read', !(L.ready || []).length && (L.dont || []).every((x) => x.code === 'held') && /could not be read/.test(L.meta?.schedule?.held || ''), [L.ready?.length, L.meta?.schedule])
j = await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
ck('AxisCare down: Cara\'s wave texts nobody and hands it to the office', !CG_SENT().length && ['needs_office'].includes(run()?.status), [run(), CG_SENT().length])
j = await act({ action: 'ask_everyone', case_id: 'cv1', preview: true }, KAY)
ck('AxisCare down: Ask everyone now lists nobody', !(j.names || []).length, j)
j = await act({ action: 'send_selected', case_id: 'cv1', recipients: ['Ben Test'] }, KAY)
ck('AxisCare down: the coordinator\'s send is refused', !(j.sent || []).length && !CG_SENT().length, j)
reset(K({ shift_date: tomorrow, shift_time: '22:00-06:00', asked: [{ id: 'q1', name: 'Ben Test', axiscare_id: '9002', phone: '4175550102', state: 'waiting', auto: true, at: new Date().toISOString() }] }), { cara_run_live: true })
AX_FAIL = true
j = await act({ action: 'follow_up', case_id: 'cv1', ask_ids: ['q1'], message: 'Hi {first_name}, still open. Reply YES or NO.' }, KAY)
ck('AxisCare down: a follow-up is refused, nothing sent', j.status === 409 && /could not be read/.test(j.error || '') && !CG_SENT().length, j)

/* the older automatic waves (tick) use the same check */
setup({ cara_wave_rules_live: false })
AX_VISITS = [V('a', 9001, tomorrow + 'T21:00:00', ymd(new Date(Date.now() + 2 * 86400000)) + 'T01:00:00')]
await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
ck('the older wave order (her wave rules off) also never texts Amy', CG_SENT().length === 5 && !caseOf().asked.some((a) => a.name === 'Amy Test'), caseOf().asked.map((a) => a.name))
/* the read-only probe used on the real system (owner key only) */
setup()
AX_VISITS = [V('a', 9001, tomorrow + 'T21:00:00', ymd(new Date(Date.now() + 2 * 86400000)) + 'T01:00:00', { client: 'Edward' }),
             V('n', 9004, today + 'T18:00:00', today + 'T21:00:00', { client: 'Peggy', clockIn: { time: today + 'T18:01:00' } })]
j = await act({ action: 'overlap_probe', case_id: 'x', date: tomorrow, time: '22:00-06:00' }, KAY)
ck('probe: refused to office staff (owner key only)', j.status === 403, j)
j = await act({ action: 'overlap_probe', case_id: 'x', date: tomorrow, time: '22:00-06:00' })
ck('probe: lists Amy working then with her hours; the open case\'s Ready list holds nobody working then; nothing sent', j.read_only && j.working.some((w) => w.name === 'C9001' && /Scheduled 9pm to 1am with Edward/.test(w.conflicts[0]))
  && j.cases[0]?.working_in_ready?.length === 0 && j.cases[0].working_listed_as_do_not_ask.some((x) => /^Amy Test: Already working then/.test(x)) && !CG_SENT().length, j)
globalThis.fetch = realFetch3

for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
