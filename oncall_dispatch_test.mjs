// ON CALL FIRST, THEN THE PRN TEAMS (Samantha 2026-10-31: "when there is a call in we need to send it to the on-call person if
// there is on-call signed up for that day ... a clear way to send to PRN CNA team and/or PRN Caregiver team if there isn't an
// on-call ... record if the on-call person is not responsive"; her picks the same day). The rules (_shared/prn-oncall.ts,
// _shared/cara-waves.ts) and the real coverage-run against a fake database, fake AxisCare and fake GoHighLevel, with the Hub's
// real match-rules.js. HUB=<care-coordinator-hub dir> node oncall_dispatch_test.mjs
import fs from 'fs'; import path from 'path'; import vm from 'vm'; import crypto from 'crypto'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions'), HUB = process.env.HUB || path.join(ROOT, '../cc-hub-cara-p1')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1500)])
const RULES = fs.readFileSync(path.join(HUB, 'match-rules.js'), 'utf8'); vm.runInThisContext(RULES); const MR = globalThis.CCMatch
const ELIG = "globalThis.CCElig = { eligibility: (r) => r.elig || { state: 'eligible', summary: 'ok' } };"
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
const O = await import(path.join(FN, '_shared/prn-oncall.ts'))
const W = await import(path.join(FN, '_shared/cara-waves.ts'))

/* ── 1. the rules ── */
{
  const rows = [{ id: 1, kind: 'confirmed', applicant_id: 'A1', start_date: '2026-11-07', end_date: '2026-11-07', shift: 'day' }]
  const M = [{ applicant_id: 'A1', team: 'cna', axiscare_id: '11', name: 'Grace Hill', first: 'Grace' }]
  const C = (o) => ({ id: 'k1', shift_date: '2026-11-07', ...o })
  ck('a shift that starts before on call but runs into it (6am to 2pm, on call 7am to 7pm) goes to the on-call person', O.onCallNow({ c: C({ shift_time: '06:00-14:00' }), rows, marks: [], members: M })?.name === 'Grace Hill')
  ck('...a shift entirely outside their on-call time does not (7pm to 11pm)', !O.onCallNow({ c: C({ shift_time: '19:00-23:00' }), rows, marks: [], members: M }))
  ck('the person who called off is never their own cover: by AxisCare id either way, or by name', !O.onCallNow({ c: C({ shift_time: '09:00-13:00', calling_off_axiscare_id: '11' }), rows, marks: [], members: M })
    && !O.onCallNow({ c: C({ shift_time: '09:00-13:00', calling_off: 'grace hill' }), rows, marks: [], members: M }) && !O.onCallNow({ c: C({ shift_time: '09:00-13:00', calling_off_id: '11' }), rows, marks: [], members: M }))
  const t0 = Date.parse('2026-11-07T15:00:00Z'), n = O.onCallNow({ c: C({ shift_time: '09:00-13:00' }), rows, marks: [], members: M })
  const k = C({ shift_time: '09:00-13:00', opened_at: '2026-11-07T13:00:00Z', oncall_dispatch: { oncall_id: 1, texted_at: new Date(t0).toISOString() } })
  ck('the 15 minutes count from the text (not from when the case first opened)', O.HOLD_MIN === 15 && O.holdFor({ c: k, now: n, marks: [], nowMs: t0 + 10 * 60000 }).hold && !O.holdFor({ c: k, now: n, marks: [], nowMs: t0 + 16 * 60000 }).hold)
  ck('...a flagged text or call counts from when it was confirmed open', O.holdStart(C({ opened_at: '2026-11-07T10:00:00Z', flag_confirmed_at: '2026-11-07T14:00:00Z' })) === Date.parse('2026-11-07T14:00:00Z'))
  ck('at 15 minutes with no answer and nothing recorded: the office is asked', O.noAnswerDue({ c: k, now: n, marks: [], nowMs: t0 + 15 * 60000 }) && !O.noAnswerDue({ c: k, now: n, marks: [], nowMs: t0 + 14 * 60000 })
    && !O.noAnswerDue({ c: k, now: n, marks: [{ case_id: 'k1', kind: 'covering', at: 'x' }], nowMs: t0 + 20 * 60000 }))
  const yes = { ...k, asked: [{ from_oncall: true, oncall_id: 1, state: 'yes' }] }, no = { ...k, asked: [{ from_oncall: true, oncall_id: 1, state: 'no' }] }
  ck('their YES or NO to the text ends the wait (and no 15-minute question)', !O.holdFor({ c: yes, now: n, marks: [], nowMs: t0 + 60000 }).hold && !O.noAnswerDue({ c: no, now: n, marks: [], nowMs: t0 + 20 * 60000 })
    && O.askAnswer(O.oncallAskOf(yes, 1)) === 'yes' && O.askAnswer(O.oncallAskOf(no, 1)) === 'no')
  ck('someone AxisCare has working then (skipped) holds nothing', !O.holdFor({ c: { ...k, oncall_dispatch: { oncall_id: 1, skipped: 'working' } }, now: n, marks: [], nowMs: t0 + 60000 }).hold)
  const tx = O.oncallText(null, { first: 'Grace', client: 'Ruth', town: 'Nixa', when: 'Sat Nov 7 9am to 1pm' })
  ck('the text: her wording, first names only, the office number, reply YES', tx === "Hi Grace, it's Caring Companions. You're on call, and Ruth in Nixa needs someone Sat Nov 7 9am to 1pm. Please call the office now at (417) 234-8494, or reply YES if you can cover it.", tx)
  ck('...no em dash, no "AI", no pay', !/—|\bAI\b|\$/.test(tx + O.noAnswerText({ name: 'Grace Hill', client: 'Ruth', when: 'x' })))
  /* her decision 4: the PRN group by the client's level */
  const row = (name, team, prn = true) => ({ name, axiscare_id: name, windows: null, outside_ok: true, prn_pref: prn ? { team, notice: null } : null, history: {}, this_client: {} })
  const rows3 = [row('Other', null, false), row('CgTeam', 'caregiver'), row('CnaTeam', 'cna')]
  const order = (lv) => W.judgeForWaves(rows3, { shift_date: '2026-11-07', shift_time: '09:00-13:00' }, { minsToStart: 3000, ongoing: false, groupFirst: true, clientLevel: lv }).ordered.map((j) => j.row.name)
  ck('Level 3 client: the PRN CNA Team first; a PRN Caregiver Team member is asked with everyone else', order(3)[0] === 'CnaTeam' && order(3).indexOf('CgTeam') > 0, order(3))
  ck('Level 1 or 2: both PRN teams before everyone else', order(2).indexOf('Other') === 2, order(2))
}

/* ── 2. the real coverage-run ── */
let T, APP, SENT, VISITS = []
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
    client_fact_current: facts(), step1_forms: [], reference_requests: [], cara_run: [], cara_run_event: [], op_events: [], prn_oncall: [], prn_oncall_marks: [], oncall_invites: [],
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
  if (url.includes('axiscare.com')) return new Response(JSON.stringify({ results: { visits: VISITS }, nextPage: null }), { status: 200 })
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
const K = (o) => ({ id: 'cv1', status: 'open', reason: 'calloff', client: 'Ruth Kay', client_axiscare_id: '500', client_city: 'Nixa', shift_date: nextSat, shift_time: '09:00-13:00', asked: [], opened_at: new Date().toISOString(), ...o })
const kase = () => APP.coverage_cases.find((x) => x.id === 'cv1')
const ON = { prn_oncall_first_live: true, prn_oncall_text_live: true }
const onCall = (o = {}) => { T.pay_tracks = [{ applicant_id: 'A1', track: 'prn_team', team: 'cna', axiscare_caregiver_id: '9001' }, { applicant_id: 'A2', track: 'prn_team', team: 'caregiver', axiscare_caregiver_id: '9002' }, { applicant_id: 'A3', track: 'prn_team', team: 'cna', axiscare_caregiver_id: '9003' }]
  T.job_applicants = [{ id: 'A1', first_name: 'Amy', last_name: 'Test', phone: '4175550101', prn: {} }, { id: 'A2', first_name: 'Ben', last_name: 'Test', phone: '4175550102', prn: {} }, { id: 'A3', first_name: 'Cal', last_name: 'Test', phone: '4175550103', prn: {} }]
  T.prn_oncall = [{ id: 7, kind: 'confirmed', applicant_id: 'A1', start_date: nextSat, end_date: nextSat, shift: 'day', cancelled_at: null, ...o }] }
const toAmy = () => SENT.filter((s) => /You're on call/.test(s.msg))
const toAdmin = (re) => SENT.filter((s) => s.to === 'C:+14175550900' && re.test(s.msg))
try {
  reset(K(), ON); onCall(); VISITS = []
  await tick()
  ck('a call-in during her on-call time: Amy is texted at once, from the office line, in her words', toAmy().length === 1 && /Hi Amy, it's Caring Companions\. You're on call, and Ruth in Nixa needs someone/.test(toAmy()[0].msg) && !!kase().oncall_dispatch?.texted_at, [SENT, kase().oncall_dispatch])
  ck('...it is an ask on the case (her YES lands like any other reply)', kase().asked.some((a) => a.from_oncall === true && String(a.oncall_id) === '7' && a.axiscare_id === '9001' && a.state === 'waiting'), kase().asked)
  ck('...the office call-in text names her first', toAdmin(/On call: Amy Test \(texted\)\. Call them first\./).length === 1, SENT.filter((s) => s.to === 'C:+14175550900'))
  await tick(); ck('...never texted twice', toAmy().length === 1)
  kase().oncall_dispatch.texted_at = new Date(Date.now() - 16 * 60000).toISOString(); await tick()
  ck('15 minutes, no answer, nothing recorded: the admins get one text with their link to record it', toAdmin(/Amy Test \(on call\) hasn't answered about Ruth .* in 15 minutes\. Record it with one tap, then ask the PRN teams/).length === 1 && !!kase().oncall_dispatch.nudged_at, SENT.filter((s) => s.to === 'C:+14175550900'))
  await tick(); ck('...only once', toAdmin(/hasn't answered/).length === 1)

  reset(K(), ON); onCall(); VISITS = [{ id: 55, caregiver: { id: 9001, firstName: 'Amy', lastName: 'Test' }, client: { firstName: 'Edna' }, scheduledStartDate: `${nextSat}T08:00:00`, scheduledEndDate: `${nextSat}T12:00:00` }]
  await tick()
  ck('AxisCare has her working then: never texted (her top rule), skipped with the reason, the office told who', !toAmy().length && /AxisCare has them working then/.test(kase().oncall_dispatch?.skipped || '') && toAdmin(/On call: Amy Test, but AxisCare has them working then/).length === 1, [kase().oncall_dispatch, SENT])
  VISITS = []

  reset(K({ calling_off_axiscare_id: '9001', calling_off: 'Amy Test' }), ON); onCall(); await tick()
  ck('she is the one who called off: not her own cover, nobody texted as on call', !toAmy().length && !kase().oncall_dispatch)
  reset(K(), {}); onCall(); await tick()
  ck('switch off (prn_oncall_first_live): nobody texted as on call', !toAmy().length && !kase().oncall_dispatch)
  reset(K(), { prn_oncall_first_live: true }); onCall(); await tick()
  ck('the text has its own switch (prn_oncall_text_live, off): on call first alone texts nobody', !toAmy().length && !kase().oncall_dispatch)
  reset(K({ shift_time: '20:00-23:00' }), ON); onCall(); await tick()
  ck('a shift outside her on-call time: nobody texted as on call', !toAmy().length && !kase().oncall_dispatch)

  /* the PRN team buttons */
  reset(K(), {}); onCall()
  let r = await act({ action: 'send_prn', case_id: 'cv1', teams: ['cna'] }, 'Sam Owner:owner_admin')
  ck('Text PRN CNA Team, preview: only the PRN CNA Team (Amy, Cal), nothing sent', JSON.stringify(r.names?.map((x) => x.name).sort()) === '["Amy Test","Cal Test"]' && !SENT.length, r)
  r = await act({ action: 'send_prn', case_id: 'cv1', teams: ['caregiver'] }, 'Sam Owner:owner_admin')
  ck('Text PRN Caregiver Team, preview: only Ben', JSON.stringify(r.names?.map((x) => x.name)) === '["Ben Test"]', r)
  r = await act({ action: 'send_prn', case_id: 'cv1', teams: ['cna', 'caregiver'], send: true }, 'Sam Owner:owner_admin')
  ck('Both, send: all three texted once, each an ask on the case', r.sent?.length === 3 && kase().asked.length === 3 && SENT.length === 3, r)
  r = await act({ action: 'send_prn', case_id: 'cv1', teams: ['cna', 'caregiver'], send: true }, 'Sam Owner:owner_admin')
  ck('...again: nobody twice', (r.sent || []).length === 0 && SENT.length === 3, r)
  r = await handler(new Request('https://x/functions/v1/coverage-run', { method: 'POST', headers: { Authorization: 'Bearer someone-else', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send_prn', case_id: 'cv1', teams: ['cna'], send: true }) }))
  ck('...office sign-in only (a stranger is refused, nothing sent)', (r.status === 401 || r.status === 403) && SENT.length === 3, r.status)
  r = await act({ action: 'send_prn', case_id: 'cv1', teams: [] }, 'Sam Owner:owner_admin'); ck('...a team must be chosen', r.status === 400)
  reset(K(), { coverage_send_live: false }); onCall(); APP.ops_settings.coverage_send_live = false
  r = await act({ action: 'send_prn', case_id: 'cv1', teams: ['cna'], send: true }, 'Sam Owner:owner_admin'); ck('...sending switched off: refused, nothing sent', r.status === 409 && !SENT.length, r)
} catch (e) { ck('the run itself', false, String(e?.stack || e)) }

for (const [n, o, d] of res) console.log((o ? 'PASS ' : 'FAIL ') + n + (o ? '' : '  ' + d))
const f = res.filter((x) => !x[1]); console.log(`\n${res.length - f.length}/${res.length} passed`); process.exit(f.length ? 1 : 0)
