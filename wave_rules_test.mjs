// HER WAVE RULES (Samantha 2026-10-24, _shared/cara-waves.ts): who "Let Cara run it" asks and in what order. The pure rules
// (overlapping schedules, overtime, PRN notice and the "Call-offs and same-day" conflict, whole-shift and partial availability,
// Unknown availability, familiar caregivers and client favorites before an unfamiliar PRN member, urgent same-day parts) and
// the real coverage-run with the switch off (waves as before, the new picks recorded) and on.
// HUB=<care-coordinator-hub dir> node wave_rules_test.mjs
import fs from 'fs'; import path from 'path'; import vm from 'vm'; import crypto from 'crypto'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions'), HUB = process.env.HUB || path.join(ROOT, '../cc-hub-cara-p1')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1500)])
const RULES = fs.readFileSync(path.join(HUB, 'match-rules.js'), 'utf8'); vm.runInThisContext(RULES); const MR = globalThis.CCMatch
const ELIG = "globalThis.CCElig = { eligibility: (r) => r.elig || { state: 'eligible', summary: 'ok' } };"
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
const R = await import(path.join(FN, '_shared/cara-run.ts'))

const W = await import(path.join(FN, '_shared/cara-waves.ts'))
/* ── 1. the rules ── */
const SAT = '2026-10-31', MON = '2026-10-26'   // a Saturday and a Monday
const C = (o) => ({ id: 'k', shift_date: SAT, shift_time: '08:00-16:00', ...o })
const P = (name, o = {}) => ({ name, axiscare_id: name, windows: { sat: ['morning', 'afternoon'] }, history: null, ...o })
const J = (rows, c = C(), m = 3000, ongoing = false) => W.judgeForWaves(rows, c, { minsToStart: m, ongoing })
const names = (r) => r.ordered.map((j) => j.row.name)
const outWhy = (r, n) => r.excluded.find((x) => x.name === n)?.why || ''

/* whole shift, not just its start */
ck('availability: 8am to 4pm touches mornings and daytime; both = whole shift', JSON.stringify(W.slotsOf(C()).map((s) => s.band)) === '["morning","afternoon"]' && W.shiftAvail(C(), { sat: ['morning', 'afternoon'] }).state === 'full')
ck('availability: only "mornings" for 8am to 4pm = PART of it (it used to count as a fit), and says what is missing', W.shiftAvail(C(), { sat: ['morning'] }).state === 'partial' && /not Saturday daytime/.test(W.shiftAvail(C(), { sat: ['morning'] }).why))
ck('availability: none of it = outside; nothing on file = Unknown', W.shiftAvail(C(), { sun: ['morning'] }).state === 'none' && W.shiftAvail(C(), null).state === 'unknown' && W.shiftAvail(C(), {}).state === 'unknown')
ck('availability: an overnight 10pm to 6am belongs to the evening it starts (Saturday overnight), and 8pm to 8am crosses evening, overnight and Sunday morning',
  JSON.stringify(W.slotsOf(C({ shift_time: '22:00-06:00' }))) === '[{"day":"sat","band":"overnight"}]'
  && JSON.stringify(W.slotsOf(C({ shift_time: '20:00-08:00' })).map((s) => s.day + ' ' + s.band)) === '["sat evening","sat overnight","sun morning"]', W.slotsOf(C({ shift_time: '20:00-08:00' })))
ck('availability: a shift ending exactly at noon is mornings only (no minutes in daytime)', JSON.stringify(W.slotsOf(C({ shift_time: '08:00-12:00' })).map((s) => s.band)) === '["morning"]')

/* hard exclusions */
let r = J([P('Ann'), P('Bea', { working_then: { count: 1, detail: 'Edward 8am-12pm' } }), P('Cy', { overlaps: ['Said yes to another open shift then: April 09:00-13:00'] }), P('Dot', { hours: { level: 'ot', text: 'Overtime risk: 36h already this week + 8h = 44h' } }),
  P('Eli', { windows: { sun: ['morning'] } }), P('Flo', { windows: { sun: ['morning'] }, outside_ok: true }), P('Gil', { needs_verification: 'Needs Verification: TB test expired' })])
ck('overlapping schedule: already scheduled in AxisCare then = left out, with the visit named', !names(r).includes('Bea') && /already scheduled in AxisCare then \(Edward 8am-12pm\)/.test(outWhy(r, 'Bea')))
ck('overlapping yes: a yes standing on another open shift then = left out', !names(r).includes('Cy') && /another open shift/.test(outWhy(r, 'Cy')))
ck('overtime: over 40 hours with this shift = left out (decision 1), with the hours', !names(r).includes('Dot') && /44h/.test(outWhy(r, 'Dot')))
ck('outside their availability = left out; outside but "text me about those" = asked', !names(r).includes('Eli') && /outside their availability/.test(outWhy(r, 'Eli')) && names(r).includes('Flo'))
ck('missing clearances = left out (Needs Verification)', !names(r).includes('Gil') && /TB test/.test(outWhy(r, 'Gil')))
r = J([P('Ann', { hours: { level: 'near', text: 'Near 40' } }), P('Bob')])
ck('near 40 hours is NOT left out, it only moves after someone with room', JSON.stringify(names(r)) === '["Bob","Ann"]', names(r))

/* PRN notice (decision 2) */
const PRN = (name, pref, o = {}) => P(name, { windows: null, prn_pref: { days: ['sat'], times: ['morning', 'daytime'], interests: [], ...pref }, ...o })
r = J([PRN('Pat48', { notice: '48h' }), PRN('Pam3', { notice: 'few_hours' }), PRN('Pip0', { notice: 'same_day' })], C(), 6 * 60)
ck('PRN notice: a shift 6 hours away: 48 hours\' notice = not asked; a few hours and same day = asked', !names(r).includes('Pat48') && /asked for 48 hours' notice/.test(outWhy(r, 'Pat48')) && names(r).includes('Pam3') && names(r).includes('Pip0'), r.excluded)
r = J([PRN('Pat48', { notice: '48h' })], C(), 3 * 1440)
ck('PRN notice: the same 48-hour person IS asked when the shift is 3 days away', names(r).includes('Pat48'))
r = J([PRN('Cat', { notice: '48h', interests: ['calloffs'] })], C(), 6 * 60)
ck('PRN conflict: "Call-offs and same-day" ticked but 48 hours\' notice asked = NOT asked, reason says to clarify (never silently overridden)', !names(r).includes('Cat') && /to clarify: picked "Call-offs and same-day" but asked for 48 hours' notice/.test(outWhy(r, 'Cat')) && r.conflicts.length === 1, r)
r = J([PRN('Cat', { notice: '48h', interests: ['calloffs'] })], C(), 4 * 1440)
ck('PRN conflict: still listed to clarify even on a shift far enough out (asked for that one)', names(r).includes('Cat') && r.conflicts[0]?.name === 'Cat')
r = J([PRN('Sue', { notice: '48h', interests: ['calloffs'], short_notice_ok: true })], C(), 6 * 60)
ck('PRN separate short-notice yes: asked on short notice, no conflict', names(r).includes('Sue') && !r.conflicts.length)
r = J([PRN('Pip', { notice: 'same_day' })], C(), 6 * 60, true)
ck('PRN on a regular ongoing opening: not asked (the office asks)', !names(r).includes('Pip') && /regular ongoing opening/.test(outWhy(r, 'Pip')))
r = J([PRN('Pip', { notice: 'same_day', days: ['sun'] })], C(), 6 * 60)
ck('PRN days and times from their application when the availability page is empty: Sundays only = not asked for a Saturday', !names(r).includes('Pip') && /PRN Team: outside their availability/.test(outWhy(r, 'Pip')), r.excluded)
r = J([PRN('Pip', { notice: 'same_day', times: ['morning'] })], C(), 6 * 60)
ck('PRN who can do part of it (mornings only): asked as part of it, not left out', r.ordered[0]?.avail.state === 'partial')

/* the order */
r = J([PRN('Pete', { notice: 'same_day' }), P('Fran', { history: { visits: 12, last: '2026-10-20' } })], C(), 6 * 60)
ck('familiar first: a caregiver who knows the client comes before a PRN member who has never met them', JSON.stringify(names(r)) === '["Fran","Pete"]', names(r))
r = J([P('Hal', { history: { visits: 30, last: '2026-10-01' } }), P('Fav', { history: { visits: 2, last: '2026-10-22' }, this_client: { favorite: true } })])
ck('the client\'s favorite first, even with fewer visits', names(r)[0] === 'Fav')
r = J([P('Old', { history: { visits: 5, last: '2026-09-01' } }), P('New', { history: { visits: 5, last: '2026-10-20' } })])
ck('same visits: the more recent visit first', names(r)[0] === 'New')
r = J([P('Zed', { miles: 2 }), PRN('Pete', { notice: 'same_day' })], C(), 6 * 60)
ck('among people who don\'t know the client: a PRN member who fits comes first', JSON.stringify(names(r)) === '["Pete","Zed"]', names(r))
r = J([PRN('Pa', { notice: 'same_day' }), PRN('Pw', { notice: 'same_day', interests: ['weekends'] })], C(), 6 * 60)
ck('PRN: one who picked this shift type (weekends) comes first', names(r)[0] === 'Pw')
r = J([P('Unk', { windows: null, history: { visits: 40 } }), P('Part', { windows: { sat: ['morning'] }, history: { visits: 40 } }), P('Whole')])
ck('whole shift, then Unknown, then part of it: availability comes before familiarity', JSON.stringify(names(r)) === '["Whole","Unk","Part"]', names(r))
ck('Unknown is still asked (decision 4), and says why', r.ordered.find((j) => j.row.name === 'Unk')?.note === 'no availability on file (Unknown)')
r = J([P('Far', { miles: 20 }), P('Near', { miles: 3 }), P('Chain', { miles: 15, chain: { detail: 'visit ends 7:45am nearby' } })])
ck('travel: a schedule that chains first, then distance', JSON.stringify(names(r)) === '["Chain","Near","Far"]', names(r))
r = J([P('A1'), P('N1', { new_hire: { need: 10 } }), P('R1', { rep: { favorites: 3 } })])
ck('then a new hire who needs hours, then rated well by other clients', JSON.stringify(names(r)) === '["N1","R1","A1"]', names(r))


/* SAME TIME OF DAY (her ask 2026-10-24, Dan's overnight) */
ck('time of day: a 10pm to 6am visit is overnight; 7am to 3pm is morning and daytime', JSON.stringify(W.bandsOfTimes('22:00', '06:00')) === '["overnight"]' && JSON.stringify(W.bandsOfTimes('07:00', '15:00')) === '["morning","afternoon"]')
ck('time of day: for an overnight case only overnight visits count; for a morning case any visit touching mornings',
  W.sameTimeOfDay(['overnight'], ['overnight']) && !W.sameTimeOfDay(['overnight'], ['evening']) && !W.sameTimeOfDay(['overnight'], ['morning']) && W.sameTimeOfDay(['morning'], ['morning', 'afternoon']) && !W.sameTimeOfDay(['morning'], ['evening']))
{ const N = (name, visits, same, o = {}) => P(name, { windows: { sat: ['evening', 'overnight'], sun: ['overnight', 'morning'] }, history: { visits, last: '2026-10-20', same_time: same }, ...o })
  const cN = C({ shift_time: '22:00-06:00' })
  const rows = [N('Day Dee', 30, 0), N('Night Nan', 3, 3), N('Fav Fay', 12, 0, { this_client: { favorite: true } }), PRN('Pete', { notice: 'same_day', days: ['sat', 'sun'], times: ['evening', 'overnight', 'morning'] })]
  const off = names(W.judgeForWaves(rows, cN, { minsToStart: 120, ongoing: false }))
  const on = names(W.judgeForWaves(rows, cN, { minsToStart: 120, ongoing: false, sameTime: true }))
  ck('switch off: the order is unchanged (favorite, then most visits, then the PRN member)', JSON.stringify(off) === '["Fav Fay","Day Dee","Night Nan","Pete"]', off)
  ck('switch on: the overnight regular comes first among those who know the client, ahead of the favorite and the 30-visit daytime caregiver', JSON.stringify(on) === '["Night Nan","Fav Fay","Day Dee","Pete"]', on)
  const on2 = names(W.judgeForWaves([N('Two', 9, 2), N('Six', 6, 6)], cN, { minsToStart: 120, ongoing: false, sameTime: true }))
  ck('switch on: among overnight regulars, more overnights first', JSON.stringify(on2) === '["Six","Two"]', on2)
  const on3 = names(W.judgeForWaves([N('Night Nan', 3, 3), N('Whole Wes', 0, 0, { history: null })], cN, { minsToStart: 120, ongoing: false, sameTime: true }))
  ck('switch on: availability still comes first (an overnight regular who can only do part of it is after a whole-shift person)',
    JSON.stringify(names(W.judgeForWaves([N('Night Nan', 3, 3, { windows: { sat: ['overnight'] } }), N('Whole Wes', 0, 0, { history: null })], C({ shift_time: '20:00-06:00' }), { minsToStart: 120, ongoing: false, sameTime: true }))) === '["Whole Wes","Night Nan"]') }

/* waves and urgent parts */
const many = (n, o) => Array.from({ length: n }, (_, i) => P(o.p + ' ' + 'abcdefghijklmnopqrstuvwxyz'[i], o))
const ord = (rows) => J(rows).ordered
let w = W.pickWaveV2(ord([...many(3, { p: 'W' }), ...many(4, { p: 'Q', windows: { sat: ['morning'] } })]), [], { size: 5, wavesLeft: 3, urgent: true })
ck('urgent same-day, only 3 whole-shift people for 3 waves: 2 places go to part-shift people in wave 1 (no waiting)', JSON.stringify(w.map((j) => j.row.name)) === '["W a","W b","W c","Q a","Q b"]', w.map((j) => j.row.name))
w = W.pickWaveV2(ord([...many(3, { p: 'W' }), ...many(4, { p: 'Q', windows: { sat: ['morning'] } })]), [], { size: 5, wavesLeft: 3, urgent: false })
ck('not urgent: whole-shift first; parts only fill places the whole-shift people can\'t', JSON.stringify(w.map((j) => j.row.name)) === '["W a","W b","W c","Q a","Q b"]')
w = W.pickWaveV2(ord([...many(8, { p: 'W' }), ...many(4, { p: 'Q', windows: { sat: ['morning'] } })]), [], { size: 5, wavesLeft: 3, urgent: false })
ck('not urgent with 8 whole-shift people: wave 1 is all whole-shift', w.every((j) => j.avail.state !== 'partial'))
w = W.pickWaveV2(ord([...many(8, { p: 'W' }), ...many(4, { p: 'Q', windows: { sat: ['morning'] } })]), [], { size: 5, wavesLeft: 3, urgent: true })
ck('urgent with 8 whole-shift people (fewer than 15 for 3 waves): 3 whole-shift + 2 part-shift', w.filter((j) => j.avail.state === 'partial').length === 2 && w.length === 5)
w = W.pickWaveV2(ord([...many(20, { p: 'W' }), ...many(4, { p: 'Q', windows: { sat: ['morning'] } })]), [], { size: 5, wavesLeft: 3, urgent: true })
ck('urgent with plenty of whole-shift people: no part-shift places taken', w.every((j) => j.avail.state !== 'partial'))
w = W.pickWaveV2(ord(many(6, { p: 'W' })), [{ name: 'W a' }, { axiscare_id: 'W b' }], { size: 5, wavesLeft: 3, urgent: false })
ck('never someone already asked (by name or AxisCare id)', !w.some((j) => ['W a', 'W b'].includes(j.row.name)) && w.length === 4)

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

/* ── 2. the real coverage-run, "Let Cara run it" ── */
const AV = (id, windows, o = {}) => ({ id: 'av' + id, axiscare_id: id, windows, ...o })
const setAvail = () => { APP.caregiver_availability = [
  AV('9001', { sat: ['morning'] }),                       // Amy: part of it
  AV('9003', { sat: ['morning', 'afternoon'] }),          // Cal: whole shift
  AV('9004', { sun: ['morning'] }),                       // Dee: outside
  ...CG.filter(([id]) => !['9001', '9002', '9003', '9004'].includes(id)).map(([id]) => AV(id, { sat: ['morning', 'afternoon'] })) ] }   // Ben (9002): nothing on file
/* switch off: waves as before, her picks recorded */
reset(K({ shift_time: '08:00-16:00' }), { cara_run_live: true, cara_list_live: true }); setAvail()
let j = await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
const e1 = ev('wave')[0]
ck('switch off: wave 1 goes the old way (5 texts) and the event records who her rules would have asked instead', j.ok && CG_SENT().length === 5 && Array.isArray(e1?.detail?.rules_would) && e1.detail.rules === 'before her wave rules (switch off)', e1)
ck('switch off: the record names who her rules leave out and why (Dee: outside her availability)', (e1.detail.left_out || []).some((x) => x.name === 'Dee Test' && /outside their availability/.test(x.why)), e1.detail.left_out)
/* switch on */
reset(K({ shift_time: '08:00-16:00' }), { cara_run_live: true, cara_list_live: true, cara_wave_rules_live: true }); setAvail()
j = await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
const asked1 = caseOf().asked.map((a) => a.name)
ck('switch on: wave 1 texts 5, never Dee (outside her availability)', j.ok && CG_SENT().length === 5 && asked1.length === 5 && !asked1.includes('Dee Test'), asked1)
ck('switch on: Amy (part of it) and Ben (Unknown) wait while whole-shift people are left', !asked1.includes('Amy Test') && !asked1.includes('Ben Test'), asked1)
due(); await tick(); due(); await tick()
const all = caseOf().asked.map((a) => a.name)
ck('switch on: over 3 waves, Ben (Unknown) comes before Amy (part of it), and Dee is never texted', all.length === 15 && all.includes('Ben Test') && all.indexOf('Ben Test') < (all.includes('Amy Test') ? all.indexOf('Amy Test') : 99) && !all.includes('Dee Test'), all)
ck('switch on: the wave record says her rules were used', ev('wave')[0]?.detail?.rules === 'her wave rules' && ev('wave')[0]?.detail?.rules_would === null)
/* urgent same-day: a shift starting in about 4 hours, 10 hours long (always more than one part of the day), at any hour */
{
  const nowC = new Date(new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T') + 'Z')
  const s0 = new Date(Math.ceil((nowC.getTime() + 4 * 3600e3) / 3600e3) * 3600e3)
  const day = s0.toISOString().slice(0, 10), hh = s0.getUTCHours()
  const time = String(hh).padStart(2, '0') + ':00-' + String((hh + 10) % 24).padStart(2, '0') + ':00'
  reset(K({ shift_date: day, shift_time: time }), { cara_run_live: true, cara_list_live: true, cara_wave_rules_live: true, coverage_quiet_from: 0, coverage_quiet_until: 0 })
  const sl = W.slotsOf({ shift_date: day, shift_time: time })
  const win = {}; for (const x of sl) (win[x.day] ||= []).push(x.band)
  const first = { [sl[0].day]: [sl[0].band] }
  APP.caregiver_availability = CG.map(([id], i) => AV(id, i < 2 ? win : first))   // Amy and Ben whole shift, everyone else part of it
  j = await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
  const a1 = caseOf().asked.map((a) => a.name)
  ck(`urgent same-day (${day} ${time}) with only 2 whole-shift people: wave 1 = those 2 + part-shift people, no waiting through 3 waves`, j.ok && a1.length === 5 && a1.includes('Amy Test') && a1.includes('Ben Test'), [j, a1])
}


/* SAME TIME OF DAY on the real server: Dan-like client, an overnight shift; Cal has 10 daytime visits, Amy 3 overnights */
{
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, o) => { const u = String(url)
    if (/axiscare\.com\/api\/visits\?/.test(u) && /clientIds=500/.test(u)) {
      const V = (id, d, s0, e0) => ({ id: Math.random(), caregiver: { id: Number(id) }, client: { id: 500 }, date: d, scheduledStartDate: d + 'T' + s0 + ':00', scheduledEndDate: d + 'T' + e0 + ':00' })
      const visits = [...Array.from({ length: 10 }, (_, i) => V('9003', '2026-10-' + String(10 + i).padStart(2, '0'), '08:00', '16:00')),
                      ...Array.from({ length: 3 }, (_, i) => V('9001', '2026-10-' + String(10 + i).padStart(2, '0'), '22:00', '06:00'))]
      return new Response(JSON.stringify({ results: { visits }, nextPage: null }), { status: 200 }) }
    return realFetch(url, o) }
  const night = () => { reset(K({ shift_time: '22:00-06:00' }), { cara_run_live: true, cara_list_live: true }); APP.caregiver_availability = CG.map(([id]) => AV(id, { sat: ['evening', 'overnight'] })) }
  night(); let L = await act({ action: 'candidates', case_id: 'cv1' }, KAY)
  ck('server, switch off: the list ranks Cal (10 daytime visits) above Amy (3 overnights), as today', L.group1?.[0]?.name === 'Cal Test' && L.group1?.[1]?.name === 'Amy Test' && !/overnight/.test(L.group1[0].why), L.group1)
  night(); APP.ops_settings.cara_same_time_live = true; L = await act({ action: 'candidates', case_id: 'cv1' }, KAY)
  ck('server, switch on: Amy (3 overnights with this client) comes first, and the reason says so', L.group1?.[0]?.name === 'Amy Test' && /3 visits with this client, 3 overnight/.test(L.group1[0].why) && /0 overnight/.test(L.group1[1].why), L.group1)
  night(); Object.assign(APP.ops_settings, { cara_same_time_live: true, cara_wave_rules_live: true }); await act({ action: 'cara_run_start', case_id: 'cv1' }, KAY)
  ck('server, switch on with her wave rules: Cara\'s wave 1 asks Amy first, then Cal', caseOf().asked[0]?.name === 'Amy Test' && caseOf().asked[1]?.name === 'Cal Test', caseOf().asked.map((a) => a.name))
  globalThis.fetch = realFetch
}

for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
