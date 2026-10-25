// CARA PHASE 2 PART A · "LET CARA RUN IT" (Samantha 2026-10-24). The pure rules (_shared/cara-run.ts) and the real
// coverage-run against a fake database, fake AxisCare and fake GoHighLevel, with the Hub's real match-rules.js.
// Proves: a coordinator authorizes each case (owners only, as practice, while the switch is off), waves of 5 at the
// right times, a pause on the first full-shift yes (case stays open, office told, nothing assigned), "Not this one" and
// no office answer both resume, part-shift offers kept and combined, quiet hours, take it back, keep searching, one
// controller at a time, never a duplicate text, the switch going off stops a live run, and the coordinator's own send is
// unchanged. HUB=<care-coordinator-hub dir> node cara_run_test.mjs
import fs from 'fs'; import path from 'path'; import vm from 'vm'; import crypto from 'crypto'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions'), HUB = process.env.HUB || path.join(ROOT, '../cc-hub-cara-p1')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1500)])
const RULES = fs.readFileSync(path.join(HUB, 'match-rules.js'), 'utf8'); vm.runInThisContext(RULES); const MR = globalThis.CCMatch
const ELIG = "globalThis.CCElig = { eligibility: (r) => r.elig || { state: 'eligible', summary: 'ok' } };"
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
const R = await import(path.join(FN, '_shared/cara-run.ts'))

/* ── 1. the pure rules ── */
{
  const r = R.runRules({}, 3 * 1440), s = R.runRules({}, 300)
  ck('rules: her numbers by default: 5 a wave, 20 minutes apart, 3 waves; within a day 10 minutes; stop 2 hours before', r.size === 5 && r.gap === 20 && r.maxWaves === 3 && s.gap === 10 && r.stopBefore === 120 && r.confirmWait === 20 && s.confirmWait === 10, [r, s])
  ck('rules: changeable in settings, kept inside safe limits', R.runRules({ cara_run_wave_size: 3, cara_run_gap_min: 30 }, 3000).size === 3 && R.runRules({ cara_run_gap_min: 30 }, 3000).gap === 30 && R.runRules({ cara_run_wave_size: 500 }, 3000).size === 5)
  const now = new Date('2026-10-26T15:00:00Z'), rules = R.runRules({}, 3000)
  const X = (o) => ({ now, caseOpen: true, minsToStart: 3000, fullYes: [], night: false, rules, ...o })
  const run = (o) => ({ status: 'running', wave: 0, wave_base: 0, next_wave_at: '2026-10-26T14:59:00Z', seen_yes: [], declined: [], ...o })
  ck('step: running and due = wave 1', JSON.stringify(R.nextStep(run(), X())) === '{"do":"wave","n":1}')
  ck('step: not due yet = wait', R.nextStep(run({ next_wave_at: '2026-10-26T15:10:00Z' }), X()).do === 'wait')
  ck('step: a full-shift yes that can be confirmed = pause, before anything else is sent', JSON.stringify(R.nextStep(run(), X({ fullYes: [{ ask_id: 'a1', name: 'Tara' }] }))) === '{"do":"pause","ask_id":"a1","name":"Tara"}')
  ck('step: a yes the office said "Not this one" to never pauses Cara', R.nextStep(run({ declined: [{ ask_id: 'a1' }] }), X({ fullYes: [{ ask_id: 'a1', name: 'Tara' }] })).do === 'wave')
  ck('step: a yes Cara already paused for (and the wait ran out) does not pause her again', R.nextStep(run({ seen_yes: ['a1'] }), X({ fullYes: [{ ask_id: 'a1', name: 'Tara' }] })).do === 'wave')
  /* her rule (2026-10-24): "DO NOT STOP with 2 hours" */
  { const ru = R.runRules({}, 100)
    ck('under 2 hours: faster and wider (10 a wave, 5 minutes apart), never handed back for the time alone', ru.urgent && ru.size === 10 && ru.gap === 5 && R.nextStep(run(), X({ minsToStart: 100, rules: ru })).do === 'urgent'
      && JSON.stringify(R.nextStep(run({ urgent_at: 'x' }), X({ minsToStart: 100, rules: ru }))) === '{"do":"wave","n":1}', [ru, R.nextStep(run(), X({ minsToStart: 100, rules: ru }))])
    ck('under 2 hours: no 3-wave limit (wave 7 still goes), but the shift ending hands it to the office',
      R.nextStep(run({ urgent_at: 'x', wave: 6 }), X({ minsToStart: 30, rules: ru })).do === 'wave' && R.nextStep(run({ urgent_at: 'x', wave: 6 }), X({ minsToStart: -500, minsToEnd: 0, rules: ru })).do === 'needs_office')
    ck('the shift has started but not ended: Cara keeps asking', R.nextStep(run({ urgent_at: 'x' }), X({ minsToStart: -30, minsToEnd: 450, rules: ru })).do === 'wave') }
  ck('step: 3 waves sent and no yes = the office takes it (never just dropped)', R.nextStep(run({ wave: 3 }), X()).do === 'needs_office' && /3 waves sent/.test(R.nextStep(run({ wave: 3 }), X()).why))
  ck('step: "Keep searching" after 3 waves gives 3 more, numbering carries on', JSON.stringify(R.nextStep(run({ wave: 3, wave_base: 3 }), X())) === '{"do":"wave","n":4}' && R.nextStep(run({ wave: 6, wave_base: 3 }), X()).do === 'needs_office')
  ck('step: quiet hours = hold the wave', R.nextStep(run(), X({ night: true })).do === 'hold_night')
  ck('step: the case closed = finish', R.nextStep(run(), X({ caseOpen: false })).do === 'finish' && R.nextStep({ ...run(), status: 'paused' }, X({ caseOpen: false })).do === 'finish')
  const paused = run({ status: 'paused', paused_ask_id: 'a1', paused_name: 'Tara', confirm_by: '2026-10-26T15:10:00Z' })
  ck('step: paused and the yes still stands = wait for the office', R.nextStep(paused, X({ fullYes: [{ ask_id: 'a1', name: 'Tara' }] })).do === 'wait')
  ck('step: paused, no office answer in time = resume and escalate', JSON.stringify(R.nextStep({ ...paused, confirm_by: '2026-10-26T14:50:00Z' }, X({ fullYes: [{ ask_id: 'a1', name: 'Tara' }] }))).includes('"escalate":true'))
  ck('step: paused and the yes changed (they said no now) = resume', R.nextStep(paused, X()).do === 'resume' && R.nextStep(paused, X()).escalate === false)
  ck('step: stopped or needs-office runs do nothing', R.nextStep(run({ status: 'stopped' }), X()).do === 'wait' && R.nextStep(run({ status: 'needs_office' }), X()).do === 'wait')
  const L = [{ name: 'A A', axiscare_id: '1' }, { name: 'B B', axiscare_id: '2', phone: '4175550002' }, { name: 'C C', axiscare_id: '3' }, { name: 'D D', axiscare_id: '4' }]
  ck('wave: never someone already asked (by name, phone or AxisCare id), at most the wave size, list order kept',
    JSON.stringify(R.pickWave(L, [{ name: 'a a' }, { phone: '(417) 555-0002' }, { axiscare_id: '4' }], 5).map((x) => x.name)) === '["C C"]' && R.pickWave(L, [], 2).length === 2 && R.pickWave(L, [], 2)[0].name === 'A A')
  ck('wave order: the better list\'s order, and only people the send gate allows', JSON.stringify(R.waveOrder(L, [{ name: 'D D' }, { name: 'Z Z' }, { name: 'B B' }]).map((x) => x.name)) === '["D D","B B"]' && R.waveOrder(L, null).length === 4)
  const P = (n, f, t, o) => ({ ask_id: n, name: n, column: 'partial', answer_kind: 'part', offer_from: f, offer_to: t, eligibility: { ok: true }, stale: false, ...o })
  const k9 = { shift_time: '08:00-17:00', handoff_ok: true }
  const cmb = R.combosOf(k9, [P('Jess', '08:00', '13:00'), P('Hal', '13:00', '17:00'), P('Ann', '14:00', '17:00')])
  ck('part shifts: 8am to 1pm + 1pm to 5pm shown together, hand-off at 1pm; one with a gap is not', cmb.length === 1 && cmb[0].first.name === 'Jess' && cmb[0].second.name === 'Hal' && cmb[0].handoff_at === '1pm' && cmb[0].handoff_ok === true, cmb)
  ck('part shifts: a shift set to one caregiver still shows the pair, marked no hand-off', /no hand-off/.test(R.combosOf({ shift_time: '08:00-17:00' }, [P('Jess', '08:00', '13:00'), P('Hal', '12:00', '17:00')])[0]?.note || ''))
  ck('part shifts: not eligible or answered for old hours = not combined; a part offer with no hours is still listed', !R.combosOf(k9, [P('Jess', '08:00', '13:00', { eligibility: { ok: false } }), P('Hal', '13:00', '17:00')]).length
    && !R.combosOf(k9, [P('Jess', '08:00', '13:00', { stale: true }), P('Hal', '13:00', '17:00')]).length && R.partsWithoutHours([P('Kim', null, null, { condition: 'mornings only' })])[0]?.said === 'mornings only')
  ck('night: held until 8am Chicago the next morning', R.nextMorning(new Date('2026-10-27T04:30:00Z')) === '2026-10-27T13:00:00.000Z' && R.nextMorning(new Date('2026-10-27T12:00:00Z')) === '2026-10-27T13:00:00.000Z', [R.nextMorning(new Date('2026-10-27T04:30:00Z'))])
  ck('needs the office: paused says confirm or Not this one; confirmed but not on AxisCare says so', /Confirm Tara in AxisCare, or tap "Not this one"/.test(R.needsLine({ status: 'paused', paused_name: 'Tara' }, {}))
    && /not checked on AxisCare/.test(R.needsLine({ status: 'done' }, { resolved_how: 'covered', covered_by: 'Tara', axiscare_assignment: { status: 'by_hand', detail: 'x' } })) && R.needsLine({ status: 'done' }, { resolved_how: 'covered', axiscare_assignment: { status: 'assigned' } }) === null)
}

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

/* switch OFF: only owners, and only as practice */
reset(K())
let j = await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
ck('switch off: a coordinator can\'t start it (owners only, as practice)', j.status === 403 && !run(), j)
j = await act({ action: 'cara_run_start', case_id: 'cv1' }, SAM)
ck('switch off: an owner\'s start is PRACTICE: the run is recorded with who and when', j.ok && run()?.practice === true && run()?.started_by === 'Sam Owner' && !!run()?.started_at && ev('started')[0]?.actor === 'Sam Owner' && /PRACTICE/.test(ev('started')[0]?.summary), [j, run()])
ck('practice: wave 1 is worked out and recorded as "would text" 5 names, nobody is texted, the case is unchanged, no office card',
  run()?.wave === 1 && ev('wave')[0]?.detail?.would_text?.length === 5 && /^Practice: wave 1 would text 5/.test(ev('wave')[0].summary) && !CG_SENT().length && !caseOf().asked.length && !APP.ops_items.length, [run(), ev('wave'), CG_SENT().length])
j = await act({ action: 'cara_run_get', case_id: 'cv1' }, KAY)
ck('the panel: who started it, the history, practice only, the rules', j.run?.started_by === 'Sam Owner' && j.events.length === 2 && j.practice_only === true && j.switch_on === false && j.rules?.size === 5 && j.run.lease_id === undefined, j)

/* switch ON: any office coordinator */
reset(K(), { cara_run_live: true })
j = await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
const w1 = caseOf().asked.map((a) => a.name)
ck('switch on: a coordinator starts it; wave 1 texts 5 at once', j.ok && j.practice === false && CG_SENT().length === 5 && w1.length === 5 && run()?.wave === 1 && run()?.started_by === 'Kay Coord', [j, CG_SENT().length])
ck('wave texts are the coordinator\'s own wording (same template) and each ask says Cara, which wave, who started it', caseOf().asked.every((a) => a.auto === true && a.cara_wave === 1 && a.picked_by_coordinator === false && a.asked_by === 'Cara (started by Kay Coord)' && a.offered_for === `${nextSat}|08:00-17:00`)
  && /open shift for Ruth/.test(SENT[0].msg), [caseOf().asked[0], SENT[0]])
ck('the history says who wave 1 went to', /^Wave 1 sent to 5: /.test(ev('wave')[0]?.summary || '') && ev('wave')[0].detail.sent.length === 5, ev('wave'))
j = await act({ action: 'cara_run_start', case_id: 'cv1' }, SAM)
ck('one run per case: starting again while it runs is refused and names who started it', j.status === 409 && /already running this \(started by Kay Coord\)/.test(j.error), j)
await tick()
ck('the 3-minute run before the gap: nothing more is sent', CG_SENT().length === 5 && run().wave === 1)
due(); await Promise.all([tick(), tick(), act({ action: 'cara_run_get', case_id: 'cv1' })])
const phones = new Set(caseOf().asked.map((a) => a.phone))
ck('two runs at the same moment: wave 2 goes once, to 5 new people (one controller at a time)', CG_SENT().length === 10 && run().wave === 2 && phones.size === 10 && caseOf().asked.filter((a) => a.cara_wave === 2).length === 5, [CG_SENT().length, run().wave])
ck('never a duplicate text: 10 texts, 10 different numbers', new Set(CG_SENT().map((s) => s.to)).size === 10)

/* a part-shift yes: kept, Cara keeps going */
yes(w1[0], { answer_kind: 'part', offer_from: '08:00', offer_to: '13:00', condition: 'until 1pm' })
yes(w1[1], { answer_kind: 'part', offer_from: '13:00', offer_to: '17:00', condition: 'from 1pm' })
j = await act({ action: 'board', case_id: 'cv1' }, KAY)
ck('part shifts stay on the board and the pair that fits is shown (8am to 1pm + 1pm to 5pm)', j.counts?.partial === 2 && j.combos?.length === 1 && j.combos[0].first.name === w1[0] && j.combos[0].second.name === w1[1] && j.combos[0].handoff_at === '1pm', [j.counts, j.combos])
due(); await tick()
ck('part-shift yeses don\'t pause Cara: wave 3 goes', run().status === 'running' && run().wave === 3 && CG_SENT().length === 15, [run().status, run().wave])

/* the first full-shift yes: pause, tell the office, case stays open */
const tara = yes(w1[2])
due(); await tick()
ck('a full-shift yes from an eligible caregiver PAUSES Cara (no more waves even when one is due)', run().status === 'paused' && run().paused_name === w1[2] && run().paused_ask_id === tara.id && CG_SENT().length === 15, run())
ck('the case stays OPEN; nothing is assigned', caseOf().status === 'open' && !caseOf().covered_by)
const item = APP.ops_items.find((i) => i.id === 'ops_cararun_cv1')
ck('the office is told: a card ("Confirm, or Not this one") and a text to the office', item?.status === 'open' && /said yes to the whole shift/.test(item.title) && SENT.some((s) => s.msg.startsWith(`Cara: ${w1[2]} said yes to the whole shift`)) && /told the office \(texted 1\)/.test(ev('paused')[0]?.summary || ''), [item, ev('paused')])
j = await act({ action: 'cara_run_get', case_id: 'cv1' }, KAY)
ck('what needs attention says it plainly', /^Confirm .* in AxisCare, or tap "Not this one"/.test(j.needs || ''), j.needs)

/* "Not this one": recorded, Cara resumes at once (wave 4 needs Keep searching, so she hands it back after 3) */
j = await act({ action: 'cara_run_not_this_one', case_id: 'cv1', ask_id: tara.id, why: 'too far' }, KAY)
ck('"Not this one": recorded with who and why; Cara goes back to asking', j.ok && ev('resumed').length === 0 && run().declined[0]?.name === w1[2] && run().declined[0]?.by === 'Kay Coord' && run().declined[0]?.why === 'too far' && /not .* for this shift \(too far\)\. Cara is asking again/.test(ev('not_this_one')[0]?.summary || ''), [j, run()])
ck('after 3 waves Cara hands it to the office instead of dropping it: card + text, reason given', run().status === 'needs_office' && /3 waves sent/.test(run().needs) && APP.ops_items.find((i) => i.id === 'ops_cararun_cv1')?.urgency === 'urgent' && SENT.some((s) => /^Cara stopped on/.test(s.msg)), [run(), j.did])
j = await act({ action: 'board', case_id: 'cv1' }, KAY)
ck('the declined yes stays on the board (still confirmable by a person) and is listed as "Not this one"', j.people.some((p) => p.ask_id === tara.id && p.column === 'full') && j.declined?.[0]?.ask_id === tara.id)

/* Keep searching: 3 more waves, numbering carries on, nobody asked twice */
j = await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
ck('"Keep searching": wave 4 goes to the last new person (16 on the list, 15 already asked), recorded as run 2', j.ok && run().wave === 4 && run().wave_base === 3 && run().run_no === 2 && caseOf().asked.length === 16 && /keep searching/.test(ev('started')[1]?.summary || ''), [j, run()])
due(); await tick()
ck('nobody left to ask: Cara stops and says so', run().status === 'needs_office' && /Nobody left/.test(run().needs), run())

/* no office answer in time: resume and escalate, the yes stays */
reset(K(), { cara_run_live: true })
await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
const ana = yes(caseOf().asked[0].name)
await tick()
ck('paused on a yes', run().status === 'paused')
run().confirm_by = new Date(Date.now() - 60000).toISOString(); SENT = []
await tick()
ck('no office answer in time: Cara resumes and sends the next wave; the office is told again; the yes stays', run().status === 'running' && run().wave === 2 && CG_SENT().length === 5 && SENT.some((s) => /nobody confirmed the yes/.test(s.msg)) && ev('resumed')[0]?.detail?.escalate === true && caseOf().asked.find((a) => a.id === ana.id).state === 'yes', [run(), ev('resumed')])
due(); await tick()
ck('...and the same yes does not pause her a second time', run().status === 'running' && run().wave === 3)

/* the office confirms: Cara finishes, the card closes */
caseOf().status = 'done'; caseOf().resolved_how = 'covered'; caseOf().covered_by = ana.name; caseOf().confirmed_by = 'Kay Coord'; caseOf().axiscare_assignment = { status: 'assigned', verified: true }
await tick()
ck('confirmed in AxisCare (checked): the run finishes, says who confirmed, the card closes', run().status === 'done' && /Covered: .* \(confirmed by Kay Coord\)/.test(run().end_why) && /On the AxisCare visit \(checked\)/.test(ev('finished')[0]?.summary || '') && APP.ops_items.find((i) => i.id === 'ops_cararun_cv1')?.status === 'done', [run(), ev('finished')])

/* take it back */
reset(K(), { cara_run_live: true })
await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
j = await act({ action: 'cara_run_stop', case_id: 'cv1', why: 'calling them myself' }, SAM)
due(); await tick()
ck('"Take it back": stopped with who and why; nothing more is sent', j.ok && run().status === 'stopped' && run().ended_by === 'Sam Owner' && /Taken back by Sam Owner: calling them myself/.test(run().end_why) && CG_SENT().length === 5, [run(), CG_SENT().length])

/* quiet hours */
reset(K(), { cara_run_live: true, coverage_quiet_from: 0, coverage_quiet_until: 24 })
j = await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
ck('quiet hours: no text goes, the wave waits for the morning and says so', !CG_SENT().length && run().wave === 0 && !!run().held_until && /Quiet hours: wave 1 waits until/.test(ev('night')[0]?.summary || ''), [run(), ev('night')])

/* the switch going off stops a live run */
reset(K(), { cara_run_live: true })
await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
APP.ops_settings.cara_run_live = false; due(); await tick()
ck('switch turned off: the live run stops and says why; nothing more is sent', run().status === 'stopped' && /switch was turned off/.test(run().end_why) && CG_SENT().length === 5, run())

/* refusals */
const soon = new Date(Date.now() + 90 * 60000); const soonT = soon.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(11, 16)
reset(K({ shift_date: ymd(soon), shift_time: `${soonT}-23:59` }), { cara_run_live: true })
j = await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
ck('under 2 hours to the shift: Cara STARTS (her rule: "DO NOT STOP with 2 hours"), tells the office once, and wave 1 asks 10', j.ok && run()?.urgent_at && ev('urgent').length === 1 && run()?.wave === 1 && caseOf().asked.length === 10, [j, ev('urgent')])
reset(K({ kind: 'interest' }), { cara_run_live: true })
j = await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
ck('interest checks: not Cara\'s to run', j.status === 409 && /open shifts only/.test(j.error))
reset(K(), { cara_run_live: true, coverage_send_live: false })
j = await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
ck('texting off (coverage_send_live): a coordinator can\'t start a live run', j.status === 403 && !CG_SENT().length)

/* the coordinator's own send is unchanged */
reset(K())
j = await act({ action: 'send_selected', case_id: 'cv1', recipients: ['Amy Test', 'Ben Test'] }, KAY)
ck('the coordinator\'s own send: same as before (picked by the coordinator, not marked Cara)', j.sent?.length === 2 && caseOf().asked.every((a) => a.picked_by_coordinator === true && a.auto === false && !a.cara_wave) && CG_SENT().length === 2, [j, caseOf().asked[0]])
j = await act({ action: 'send_selected', case_id: 'cv1', recipients: ['Amy Test'] }, KAY)
ck('the coordinator\'s own send: someone already asked is not texted again', !(j.sent || []).length && CG_SENT().length === 2, j)


/* ── ASK EVERYONE NOW and the LAST-MINUTE BONUS (Samantha 2026-10-24) ── */
reset(K({ shift_time: '08:00-16:00' }), { cara_run_live: true })
APP.caregiver_availability = [{ id: 'av4', axiscare_id: '9004', windows: { sun: ['morning'] } }]   // Dee: outside her availability
let ae = await act({ action: 'ask_everyone', case_id: 'cv1', preview: true }, KAY)
ck('ask everyone, preview: every eligible caregiver not yet asked (15), never Dee (outside her availability, with the reason); nothing sent',
  ae.names?.length === 15 && !ae.names.includes('Dee Test') && ae.left_out.some((x) => x.name === 'Dee Test' && /outside their availability/.test(x.why)) && !CG_SENT().length && !caseOf().asked.length, ae)
ae = await act({ action: 'ask_everyone', case_id: 'cv1', send: true, names: [...ae.names.slice(0, 12), 'Dee Test', 'Nobody Real'] }, KAY)
ck('ask everyone, send: only the confirmed names that are still eligible are texted (12); Dee and an unknown name are refused', ae.sent?.length === 12 && ae.refused === 2 && CG_SENT().length === 12 && caseOf().asked.length === 12, ae)
ae = await act({ action: 'ask_everyone', case_id: 'cv1', preview: true }, KAY)
ck('ask everyone again: only the 3 not yet asked are listed (nobody texted twice)', ae.names?.length === 3 && ae.already_asked === 12, ae)
ck('ask everyone: recorded with who did it', (T.op_events || []).some((e) => e.verb === 'ask_everyone' && e.actor_name === 'Kay Coord'), T.op_events)
APP.ops_settings.coverage_send_live = false
ae = await act({ action: 'ask_everyone', case_id: 'cv1', send: true, names: ae.names }, KAY)
ck('ask everyone with texting switched off: refused, nothing sent', ae.status === 409 && CG_SENT().length === 12, ae)

reset(K({ shift_time: '08:00-16:00' }), { cara_run_live: true })
let bz = await act({ action: 'set_bonus', case_id: 'cv1', amount: 600 }, KAY)
ck('bonus: more than $500 or not a whole amount is refused', bz.status === 400)
bz = await act({ action: 'set_bonus', case_id: 'cv1', amount: 25, note: 'last minute' }, KAY)
ck('bonus: set with who and when, kept in the history', bz.ok && caseOf().bonus?.amount === 25 && caseOf().bonus.by === 'Kay Coord' && caseOf().bonus_history.length === 1, caseOf())
await act({ action: 'send_selected', case_id: 'cv1', recipients: ['Amy Test'] }, KAY)
ck('bonus: the text says it plainly, before the question', /\$25 bonus for taking this shift\. Can you take it\?/.test(CG_SENT()[0]?.msg || ''), CG_SENT()[0])
ck('bonus: the ask records the amount (for payroll)', caseOf().asked[0]?.bonus === 25, caseOf().asked[0])
await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
ck('bonus: Cara\'s waves carry it too', CG_SENT().slice(1).every((x) => /\$25 bonus/.test(x.msg)) && CG_SENT().length > 1, CG_SENT().map((x) => x.msg.slice(0, 60)))
bz = await act({ action: 'set_bonus', case_id: 'cv1', amount: 0 }, KAY)
ck('bonus: taken off with 0 (history keeps both)', bz.ok && caseOf().bonus === null && caseOf().bonus_history.length === 2, caseOf())

for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
