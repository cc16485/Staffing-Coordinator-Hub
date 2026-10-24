// CARA PHASE 1 · the better list and "Cara recommends" (Samantha 2026-10-23). The pure rules (_shared/cara-list.ts) and the
// real coverage-run against a fake database, fake AxisCare and fake GoHighLevel, with the Hub's real match-rules.js.
// Proves: missing availability = Unknown (never a fit), the verified-skills rules cut with the rule's reason, weekly hours and
// overtime risk, overlapping yeses, the recommendation (interest, never an assignment), and that with the switch
// cara_list_live OFF the list and the sends are exactly as before. HUB=<care-coordinator-hub dir> node cara_p1_test.mjs
import fs from 'fs'; import path from 'path'; import vm from 'vm'; import crypto from 'crypto'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions'), HUB = process.env.HUB || path.join(ROOT, '../cc-hub-cara-p1')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1500)])
const RULES = fs.readFileSync(path.join(HUB, 'match-rules.js'), 'utf8'); vm.runInThisContext(RULES); const MR = globalThis.CCMatch
const ELIG = "globalThis.CCElig = { eligibility: (r) => r.elig || { state: 'eligible', summary: 'ok' } };"
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
const L = await import(path.join(FN, '_shared/cara-list.ts'))

/* ── 1. the pure rules ── */
const W = (days, times) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, days.includes(d) ? times : []]))
const SAT = '2026-10-31'   // a Saturday
ck('availability: nothing on file = Unknown, never a fit (her rule 2026-10-17)', L.availStatus({ shift_date: SAT, shift_time: '07:00-11:00' }, null).state === 'unknown'
  && L.availStatus({ shift_date: SAT, shift_time: '07:00-11:00' }, { windows: W([], []) }).state === 'unknown' && L.availStatus({ shift_date: SAT, shift_time: '07:00-11:00' }, null).why === L.UNKNOWN_WHY)
ck('availability: inside = fits; outside = outside with the reason; outside + said OK = outside_ok', L.availStatus({ shift_date: SAT, shift_time: '07:00-11:00' }, { windows: W(['sat'], ['morning']) }).state === 'fits'
  && L.availStatus({ shift_date: SAT, shift_time: '18:00-22:00' }, { windows: W(['sat'], ['morning']) }).why === 'outside their availability (not Saturdays evenings)'
  && L.availStatus({ shift_date: SAT, shift_time: '07:00-11:00' }, { windows: W(['sun'], ['morning']), outside_ok: true }).state === 'outside_ok')
ck('availability order: a stated fit, then Unknown, then outside', L.availRank('fits') < L.availRank('unknown') && L.availRank('unknown') < L.availRank('outside') && L.availRank('outside_ok') === 0)
ck('the work week: Monday to Sunday by default (her payroll week, 2026-10-23); another start when set', JSON.stringify(L.weekOf('2026-10-28')) === '["2026-10-26","2026-11-01"]' && JSON.stringify(L.weekOf('2026-11-01')) === '["2026-10-26","2026-11-01"]' && JSON.stringify(L.weekOf('2026-10-28', 'sun')) === '["2026-10-25","2026-10-31"]')
ck('hours: over 40 = overtime risk, from 36 = near 40, over their own target = said so, otherwise nothing', L.hoursFlag(38, 4, null).level === 'ot' && /38h already this week \+ 4h = 42h/.test(L.hoursFlag(38, 4, null).text)
  && L.hoursFlag(33, 4, null).level === 'near' && L.hoursFlag(20, 4, 20).level === 'over_target' && L.hoursFlag(10, 4, 30).level === null && L.shiftHours('22:00-06:00') === 8)
ck('overlapping spans, overnight included', L.spansOverlap('07:00-11:00', '10:00-12:00') && !L.spansOverlap('07:00-11:00', '11:00-12:00') && L.spansOverlap('22:00-06:00', '23:00-01:00') && !L.spansOverlap('22:00-06:00', '05:00-07:00'))
{ const plans = [{ id: 'p1', client: 'New Client', days: ['sat'], slots: [{ k: 'a', start: '08:00', end: '12:00' }], cells: { 'sat|a': { name: 'Fran Overlap', status: 'yes' } }, options: { 'sat|a': [{ name: 'Gus Two', cg_ax_id: '77', status: 'yes' }] } },
                 { id: 'p2', client: 'Sent', days: ['sat'], slots: [{ k: 'a', start: '08:00', end: '12:00' }], cells: { 'sat|a': { name: 'Hal Pushed', status: 'yes' } }, axiscare_push: { at: 'x' } }]
  const cases = [{ id: 'c2', status: 'open', client: 'Ida Other', shift_date: SAT, shift_time: '08:00-10:00', asked: [{ name: 'Fran Overlap', state: 'yes' }, { name: 'Joe No', state: 'no' }] }]
  const k = { id: 'c1', shift_date: SAT, shift_time: '07:00-11:00' }
  const f = L.overlapsFor(k, { name: 'Fran Overlap' }, cases, plans)
  ck('overlaps: a yes on another open shift then, and a yes on a planned regular shift then (not yet in AxisCare), both named', f.length === 2 && /another open shift then: Ida 08:00-10:00/.test(f[0]) && /New Client, 08:00-12:00/.test(f[1]), f)
  ck('overlaps: a 2nd choice in the plan counts (by AxisCare id); a no, a plan already in AxisCare, and the case itself do not', L.overlapsFor(k, { axiscare_id: '77', name: 'X' }, cases, plans).length === 1
    && !L.overlapsFor(k, { name: 'Joe No' }, cases, plans).length && !L.overlapsFor(k, { name: 'Hal Pushed' }, cases, plans).length && !L.overlapsFor(cases[0], { name: 'Fran Overlap' }, cases, []).length) }
ck('skills note: a lapsed check is a note, never a cut', !L.skillsNote({ group: 'ready', cleared_note: 'Not cleared to work: x' }).cut && L.skillsNote({ group: 'ready', cleared_note: 'Not cleared to work: x' }).cleared_note === 'Not cleared to work: x')
ck('skills note: not for this visit = a cut with the reason; one more step = a note; likely fit = a note', L.skillsNote({ group: 'not_for_visit', reason: 'Dementia training not complete' }).cut === 'Dementia training not complete'
  && /^One more step/.test(L.skillsNote({ group: 'one_more_step', reason: 'Lift: says yes' }).note) && !L.skillsNote({ group: 'ready' }).cut && !L.skillsNote({ group: 'ready' }).note)
ck('interest vs assigned: a yes is interest; confirmed but not read back is not "assigned"; only an AxisCare read-back is', L.fillState({ asked: [{ state: 'yes' }] }) === 'interest'
  && L.fillState({ covered_by: 'A', status: 'resolved', axiscare_assignment: { status: 'by_hand' } }) === 'confirmed_not_in_axiscare'
  && L.fillState({ covered_by: 'A', axiscare_assignment: { status: 'assigned', verified: true } }) === 'assigned' && L.fillState({ asked: [] }) === 'no_asks' && L.fillState({ asked: [{ state: 'waiting' }] }) === 'asking')

/* ── 2. the real coverage-run ── */
let T, APP, SENT, VISITS
const SVC = 'svc_' + 'k'.repeat(60)
const ymd = (d) => d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
const nextSat = (() => { const d = new Date(); d.setDate(d.getDate() + 3); while (d.getDay() !== 6) d.setDate(d.getDate() + 1); return ymd(d) })()
const facts = (req) => MR.SKILLS.map((s) => ({ episode_id: 'e1', kind: 'need_' + s.key, layer: 'plan', value: req.includes(s.key) ? 'required' : 'no' }))
const CG = [['9001', 'Amy', 'Fit'], ['9002', 'Ben', 'Unknown'], ['9003', 'Cal', 'Outside'], ['9004', 'Dee', 'Hours'], ['9005', 'Eve', 'Skills'], ['9006', 'Fran', 'Overlap'], ['9007', 'Hal', 'Lapsed']]
const reset = (kase, settings = {}) => {
  SENT = []
  /* Dee: 4 days of 12:00-21:30 that week (38h), never overlapping the 7-11am shift */
  const wk = L.weekOf(nextSat)
  VISITS = [0, 1, 2, 3].map((i) => { const d = new Date(wk[0] + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + i); const y = d.toISOString().slice(0, 10)
    return { caregiver: { id: 9004 }, client: { id: 600, firstName: 'Other' }, scheduledStartDate: y + 'T12:00:00', scheduledEndDate: y + 'T21:30:00' } })
  APP = {
    caregivers: CG.map(([id, f, l]) => ({ first: f, last: l, phone: '41755501' + id.slice(-2), axiscare_id: id, active: true, alz_date: id === '9005' ? null : '2025-01-01', ...(id === '9007' ? { elig: { state: 'lapsed', summary: 'OIG check over 30 days' } } : {}) })),
    caregiver_availability: [{ axiscare_id: '9001', windows: W(['sat'], ['morning']) }, { axiscare_id: '9003', windows: W(['sun'], ['morning']) },
      { axiscare_id: '9004', windows: W(['sat'], ['morning']) }, { axiscare_id: '9007', windows: W(['sat'], ['morning']) }, { axiscare_id: '9005', windows: W(['sat'], ['morning']) }, { axiscare_id: '9006', windows: W(['sat'], ['morning']) }],
    coverage_cases: [kase, { id: 'cv2', status: 'open', client: 'Ida Other', shift_date: nextSat, shift_time: '08:00-10:00', asked: [{ name: 'Fran Overlap', axiscare_id: '9006', state: 'yes' }] }],
    staffing_plans: [], caregiver_overlay: [], dnr_log: [],
    ops_settings: { coverage_send_live: true, coverage_quiet_from: 0, coverage_quiet_until: 0, ...settings }, responsibilities: [], nurse_staff: [], coverage_do_not_offer: [], client_checkins: [],
  }
  T = { domains: [], persons: [], contact_optout_current: [], circle_contacts: [], phone_index: [], client_callin_current: [], person_identity: [], pay_tracks: [], job_applicants: [],
    person_source_id: [{ person_id: 'p1', system: 'axiscare', entity_type: 'client', source_id: '500' }], journey_episode: [{ episode_id: 'e1', person_id: 'p1', state: 'established', created_at: '2026-01-01' }],
    client_fact_current: facts(['dementia_care']), step1_forms: [], reference_requests: [],
    rules_approved: [{ file: 'match-rules.js', sha256: sha(RULES) }, { file: 'eligibility-rules.js', sha256: sha(ELIG) }] }
}
const q = (t) => { const st = { f: [], inF: [], nn: [] }; const b = {
  select() { return b }, order() { return b }, limit() { return b }, gte() { return b }, lte() { return b }, lt() { return b }, gt() { return b }, ilike() { return b }, or() { return b }, contains() { return b }, range() { return b }, neq() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF.push([c, v]); return b }, is() { return b }, not(c, op, v) { if (op === 'is' && v === null) st.nn.push(c); return b },
  update() { return { eq: () => Promise.resolve({ data: null, error: null }) } }, upsert() { return Promise.resolve({ data: null, error: null }) }, insert() { return Promise.resolve({ data: null, error: null }) },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: null })) }, single() { return b.maybeSingle() },
  then(ok, bad) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok, bad) }
    let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); for (const c of st.nn) r = r.filter((x) => x[c] != null)
    for (const [c, v] of st.inF) r = r.filter((x) => v.includes(x[c])); return Promise.resolve({ data: r, error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) }
  if (fn === 'coverage_case_add_ask') { const c = (APP.coverage_cases || []).find((x) => x.id === a.p_id); if (!c) return { data: 'not_found', error: null }; c.asked = c.asked || []
    if (c.asked.some((x) => x.axiscare_id && x.axiscare_id === a.p_ask.axiscare_id)) return { data: 'already_asked', error: null }; c.asked.push(a.p_ask); return { data: 'added', error: null } }
  if (fn === 'coverage_case_remove_ask') { const c = (APP.coverage_cases || []).find((x) => x.id === a.p_id); if (c) c.asked = (c.asked || []).filter((x) => x.id !== a.p_ask_id); return { data: true, error: null } }
  return { data: null, error: null } }, auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) } }
globalThis.__dbFor = (key) => ({ from: () => { const b = { select() { return b }, limit() { return Promise.resolve(key === SVC ? { data: [], error: null } : { data: null, error: { message: 'denied' } }) } }; return b } })
let AXCALLS = []
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.startsWith('https://cc.mo-care.com/match-rules.js')) return new Response(RULES, { status: 200 })
  if (url.startsWith('https://cc.mo-care.com/eligibility-rules.js')) return new Response(ELIG, { status: 200 })
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, msg: body.message }); return new Response('{}', { status: 200 }) }
  if (url.includes('axiscare.com')) AXCALLS.push({ url, method: (o && o.method) || 'GET' })
  if (/axiscare\.com\/api\/caregivers(\?|$)/.test(url)) return new Response(JSON.stringify({ results: { caregivers: APP.caregivers.map((c) => ({ id: Number(c.axiscare_id), firstName: c.first, lastName: c.last, status: { active: true }, classes: [], mailingAddress: { city: 'Nixa', postalCode: '65714' } })) } }), { status: 200 })
  if (/axiscare\.com\/api\/clients\//.test(url)) return new Response(JSON.stringify({ results: { client: { firstName: 'Ruth', lastName: 'Kay', classes: [{ label: 'Private Pay' }], residentialAddress: { city: 'Nixa', postalCode: '65714' } } } }), { status: 200 })
  if (url.includes('axiscare.com')) return new Response(JSON.stringify({ results: { visits: VISITS }, nextPage: null }), { status: 200 })
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', HUB_JOB_SECRET: 'j'.repeat(64) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
{ const ja = fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)')
  fs.writeFileSync(`${FN}/_shared/_job-auth_cp1.ts`, ja) }
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_cp1.ts`) } catch { /* */ } })
const src = fs.readFileSync(`${FN}/coverage-run/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_cp1.ts'")
const tmp = path.join(FN, 'coverage-run', '_cp1.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const act = async (body) => { const r = await handler(new Request('https://x/functions/v1/coverage-run', { method: 'POST', headers: { Authorization: 'Bearer ' + SVC, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return r.json() }
const all = (j) => [...(j.group0 || []), ...(j.group1 || []), ...(j.group2 || []), ...(j.prn_other || [])]
const row = (j, n) => all(j).find((x) => x.name === n)
const K = (o) => ({ id: 'cv1', status: 'open', reason: 'calloff', client: 'Ruth Kay', client_axiscare_id: '500', shift_date: nextSat, shift_time: '07:00-11:00', asked: [], ...o })

/* switch OFF: exactly today's list */
reset(K()); let off = await act({ action: 'candidates', case_id: 'cv1' })
ck('switch off: the list is today\'s (no new fields, Eve still listed, meta says off)', off.meta?.cara_list?.on === false && !!row(off, 'Eve Skills') && row(off, 'Ben Unknown') && !('avail_state' in row(off, 'Ben Unknown')) && !('hours' in row(off, 'Dee Hours')), off)
let j = await act({ action: 'send_selected', case_id: 'cv1', recipients: ['Eve Skills'] })
ck('switch off: sending is exactly as today (Eve can still be asked)', j.sent?.length === 1, j)

/* the office's side-by-side preview, switch still off */
reset(K()); AXCALLS = []; j = await act({ action: 'candidates_v2', case_id: 'cv1' })
ck('preview: Ben (nothing on file) is Unknown, labeled, and listed after Amy (a stated fit)', row(j, 'Ben Unknown')?.avail_state === 'unknown' && row(j, 'Ben Unknown')?.avail_unknown === L.UNKNOWN_WHY && row(j, 'Amy Fit')?.avail_state === 'fits'
  && all(j).findIndex((x) => x.name === 'Amy Fit') < all(j).findIndex((x) => x.name === 'Ben Unknown'), all(j).map((x) => [x.name, x.avail_state]))
ck('preview: Cal (outside) is after Ben (unknown)', all(j).findIndex((x) => x.name === 'Ben Unknown') < all(j).findIndex((x) => x.name === 'Cal Outside'))
ck('preview: the skills rules cut Eve with the rule\'s own reason (dementia care required, training not complete)', !row(j, 'Eve Skills') && j.excluded.some((x) => x.name === 'Eve Skills' && x.why === 'Skills rules: Dementia training not complete'), j.excluded)
ck('preview: an expired clearance = Needs Verification: listed apart with the reason, never in an offerable group', !row(j, 'Hal Lapsed') && (j.needs_verification || []).some((x) => x.name === 'Hal Lapsed' && x.needs_verification === 'Needs Verification: OIG check over 30 days') && !j.excluded.some((x) => x.name === 'Hal Lapsed'), [j.needs_verification, j.excluded])
ck('preview: Dee is flagged overtime risk (38h + 4h = 42h)', row(j, 'Dee Hours')?.hours?.level === 'ot' && /= 42h/.test(row(j, 'Dee Hours').hours.text), row(j, 'Dee Hours'))
ck('preview: Fran is flagged for the yes she already gave on an overlapping open shift', (row(j, 'Fran Overlap')?.overlaps || []).some((o) => /another open shift then: Ida/.test(o)), row(j, 'Fran Overlap'))
ck('preview: meta says what was checked (skills rule version, the work week, the Unknown rule)', j.meta?.cara_list?.on === true && /checked with match-rules 1\./.test(j.meta.cara_list.skills) && /weekly hours counted/.test(j.meta.cara_list.hours), j.meta?.cara_list)
ck('preview: AxisCare is only read (no PATCH, POST or DELETE)', AXCALLS.length > 0 && AXCALLS.every((c) => c.method === 'GET'), AXCALLS)
ck('preview: nothing was texted and the case was not changed', !SENT.length && JSON.stringify(APP.coverage_cases[0].asked) === '[]')

/* the rules unreadable: nobody cut by a check that could not run, and it says so */
reset(K()); T.rules_approved = []; const realFetch = globalThis.fetch
globalThis.fetch = async (u, o) => String(u).includes('api.github.com') ? new Response('nope', { status: 503 }) : realFetch(u, o)
j = await act({ action: 'candidates_v2', case_id: 'cv1' }); globalThis.fetch = realFetch
ck('rules not checkable: nobody is cut for skills, the list says "skills not checked" with the reason', !!row(j, 'Eve Skills') && /^skills not checked: /.test(j.meta?.cara_list?.skills || ''), j.meta?.cara_list)

/* switch ON: the list and the server-side send re-check both follow it */
reset(K(), { cara_list_live: true }); j = await act({ action: 'candidates', case_id: 'cv1' })
ck('switch on: the normal list is the better list', j.meta?.cara_list?.on === true && !row(j, 'Eve Skills') && row(j, 'Ben Unknown')?.avail_state === 'unknown')
j = await act({ action: 'send_selected', case_id: 'cv1', recipients: ['Eve Skills'] })
ck('switch on: someone the skills rules rule out cannot be texted, even if the browser asks', !SENT.length && !(j.sent || []).length, j)
j = await act({ action: 'send_selected', case_id: 'cv1', recipients: ['Hal Lapsed'] })
ck('switch on: someone who Needs Verification cannot be texted a shift offer, even if the browser asks', !SENT.length && !(j.sent || []).length, j)
reset(K()); j = await act({ action: 'send_selected', case_id: 'cv1', recipients: ['Hal Lapsed'] })
ck('switch off: the list is as it is today (Needs Verification starts with the list switch)', (j.sent || []).length === 1, j)

/* Cara recommends: of the yeses, one, with reasons and concerns; interest only */
const yes = (n, id, at, extra = {}) => ({ id: 'a' + id, name: n, axiscare_id: id, state: 'yes', replied_at: at, ...extra })
reset(K({ asked: [yes('Ben Unknown', '9002', '2026-10-01T10:00:00Z'), yes('Amy Fit', '9001', '2026-10-01T10:05:00Z'), yes('Dee Hours', '9004', '2026-10-01T09:00:00Z'),
  yes('Fran Overlap', '9006', '2026-10-01T09:30:00Z'), yes('Eve Skills', '9005', '2026-10-01T09:10:00Z'), yes('Hal Lapsed', '9007', '2026-10-01T08:00:00Z'), yes('Ghost Person', '9999', '2026-10-01T09:20:00Z'),
  { id: 'aw', name: 'Cal Outside', axiscare_id: '9003', state: 'waiting' }] }))
AXCALLS = []; j = await act({ action: 'recommend', case_id: 'cv1' })
ck('recommend: Amy (inside her availability, no concerns) even though others said yes first', j.pick?.name === 'Amy Fit' && j.pick.reasons.some((r) => /inside their availability/.test(r)) && !j.pick.concerns.length, j)
ck('recommend: the others are listed with their concerns (Unknown, overtime, the overlapping yes)', (j.others || []).find((o) => o.name === 'Ben Unknown')?.concerns.includes(L.UNKNOWN_WHY)
  && (j.others || []).find((o) => o.name === 'Dee Hours')?.concerns.some((c) => /Overtime risk/.test(c)) && (j.others || []).find((o) => o.name === 'Fran Overlap')?.concerns.some((c) => /another open shift/.test(c)), j.others)
ck('recommend: a yes from someone who Needs Verification is never recommended, and says why', j.not_eligible?.some((x) => x.name === 'Hal Lapsed' && /^Needs Verification: OIG/.test(x.why)), j.not_eligible)
ck('recommend: a yes from someone the rules now rule out is never recommended, and says why', j.not_eligible?.some((x) => x.name === 'Eve Skills' && /Dementia training/.test(x.why)) && j.not_eligible?.some((x) => x.name === 'Ghost Person'), j.not_eligible)
ck('recommend: only people who said yes (a waiting ask is not in it)', ![j.pick, ...(j.others || [])].some((x) => x?.name === 'Cal Outside'))
ck('recommend: interest only: says nothing is assigned, writes nothing, texts nobody, only reads AxisCare', /Nothing is assigned until you confirm and AxisCare shows them/.test(j.note) && !SENT.length
  && AXCALLS.every((c) => c.method === 'GET') && APP.coverage_cases[0].status === 'open' && !APP.coverage_cases[0].covered_by)
reset(K({ asked: [{ id: 'x', name: 'Amy Fit', axiscare_id: '9001', state: 'waiting' }] })); j = await act({ action: 'recommend', case_id: 'cv1' })
ck('recommend: nobody said yes = no pick, said plainly', j.pick === null && j.note === 'Nobody has said yes yet.', j)
reset(K({ asked: [yes('Amy Fit', '9001', '2026-10-01T10:05:00Z', { condition: 'only until 10' })] })); j = await act({ action: 'recommend', case_id: 'cv1' })
ck('recommend: a yes with a condition is part of the shift: never the pick on its own, listed with its condition', j.pick === null && j.partial?.[0]?.concerns.includes('Said yes with a condition: only until 10') && /Only part-of-the-shift answers/.test(j.note), j)

/* THE RESPONSE BOARD (2026-10-24) */
reset(K({ asked: [yes('Amy Fit', '9001', '2026-10-01T10:05:00Z'), yes('Dee Hours', '9004', '2026-10-01T09:00:00Z'),
  yes('Ben Unknown', '9002', '2026-10-01T09:10:00Z', { answer_kind: 'part', offer_from: '07:00', offer_to: '09:00', answer_channel: 'page', answer_note: 'school pickup' }),
  { id: 'aq', name: 'Fran Overlap', axiscare_id: '9006', state: 'inquiry', reply: 'are there stairs?', replied_at: '2026-10-01T09:20:00Z' },
  { id: 'an', name: 'Cal Outside', axiscare_id: '9003', state: 'no', reply: 'sorry no', replied_at: '2026-10-01T09:30:00Z' },
  yes('Hal Lapsed', '9007', '2026-10-01T08:00:00Z'), { id: 'aw', name: 'Eve Skills', axiscare_id: '9005', state: 'waiting' }] }))
AXCALLS = []; j = await act({ action: 'board', case_id: 'cv1' })
const P = (n) => (j.people || []).find((p) => p.name === n)
ck('board: each person in their column: full, partial, question, no, Needs Verification, waiting', P('Amy Fit')?.column === 'full' && P('Dee Hours')?.column === 'full' && P('Ben Unknown')?.column === 'partial'
  && P('Fran Overlap')?.column === 'question' && P('Cal Outside')?.column === 'no' && P('Hal Lapsed')?.column === 'nv' && P('Eve Skills')?.column === 'waiting' && j.counts.full === 2, j.people?.map((p) => [p.name, p.column]))
ck('board: the exact answer, when, and how (text or shift page) for each person', P('Fran Overlap').reply === 'are there stairs?' && P('Fran Overlap').replied_at === '2026-10-01T09:20:00Z' && P('Ben Unknown').channel === 'shift page'
  && P('Ben Unknown').offer_from === '07:00' && P('Ben Unknown').note === 'school pickup', [P('Fran Overlap'), P('Ben Unknown')])
ck('board: Cara\'s pick says so; the others say why not (overtime ranks lower; part of the shift is never a pick alone)', P('Amy Fit').recommended && P('Amy Fit').why === 'Cara recommends them for this shift'
  && P('Dee Hours').why === 'Another yes ranks higher' && P('Dee Hours').concerns.some((c) => /Overtime risk/.test(c)) && /only part of the shift/.test(P('Ben Unknown').why))
ck('board: Needs Verification can never be confirmed, with the reason; only an eligible full yes can', P('Hal Lapsed').can_confirm === false && P('Hal Lapsed').eligibility.ok === false && /^Needs Verification: OIG/.test(P('Hal Lapsed').eligibility.why)
  && P('Amy Fit').can_confirm && !P('Ben Unknown').can_confirm && !P('Fran Overlap').can_confirm)
ck('board: the skills rules\' reason shows on someone they rule out', P('Eve Skills').eligibility.ok === false && /Skills rules: Dementia training/.test(P('Eve Skills').eligibility.why), P('Eve Skills'))
ck('board: read only (AxisCare only read, nothing texted, the case unchanged)', AXCALLS.every((c) => c.method === 'GET') && !SENT.length && APP.coverage_cases[0].status === 'open' && !APP.coverage_cases[0].covered_by)
ck('board: says the shift\'s time setting (Exact time by default, hand-off not allowed by default)', j.time_flex === 'exact' && j.handoff_ok === false)


/* TIME RULES (2026-10-24): separate settings, Exact time by default */
{ reset(K()); const pr = globalThis.__db.rpc; let patched = null
  globalThis.__db.rpc = async (fn, a) => { if (fn === 'coverage_case_patch') { patched = a; Object.assign(APP.coverage_cases[0], a.p_patch); return { data: { ok: true }, error: null } } return pr(fn, a) }
  let j2 = await act({ action: 'set_time_rules', case_id: 'cv1', time_flex: 'flexible_start', flex_minutes: 500, handoff_ok: true })
  ck('time rules: flexible start (capped at 3 hours) and hand-off are separate, saved with who and when', j2.ok && APP.coverage_cases[0].time_flex === 'flexible_start' && APP.coverage_cases[0].flex_minutes === 180 && APP.coverage_cases[0].handoff_ok === true && !!APP.coverage_cases[0].time_rules_at && patched.p_expect.status === 'open', [j2, APP.coverage_cases[0]])
  j2 = await act({ action: 'set_time_rules', case_id: 'cv1', handoff_ok: false })
  ck('time rules: anything else = exact time; hand-off off unless ticked', APP.coverage_cases[0].time_flex === 'exact' && APP.coverage_cases[0].flex_minutes === null && APP.coverage_cases[0].handoff_ok === false)
  ck('time rules: nothing touches AxisCare or texts anyone', !SENT.length)
  globalThis.__db.rpc = pr }

/* NEEDS VERIFICATION AT CONFIRM (2026-10-24): the server refuses, from any door */
{ const CF = await import(path.join(FN, '_shared/coverage-fill.ts') + '?cf')
  reset(K({ asked: [yes('Hal Lapsed', '9007', '2026-10-01T08:00:00Z'), yes('Amy Fit', '9001', '2026-10-01T09:00:00Z')] }), { cara_list_live: true })
  let o = await CF.confirmFill(globalThis.__db, { caseId: 'cv1', coveredBy: 'Hal Lapsed', byName: 'Sam' })
  ck('confirm, list switch on: someone who Needs Verification is refused with the reason, nothing changed', o.outcome === 'not_eligible' && /Hal Lapsed can't be confirmed: Needs Verification: OIG check over 30 days/.test(o.detail) && APP.coverage_cases[0].status === 'open' && !APP.coverage_cases[0].covered_by, o)
  o = await CF.confirmFill(globalThis.__db, { caseId: 'cv1', coveredBy: 'Amy Fit', byName: 'Sam' })
  ck('confirm, list switch on: an eligible person goes through to the usual confirm', o.outcome !== 'not_eligible', o)
  reset(K({ asked: [yes('Hal Lapsed', '9007', '2026-10-01T08:00:00Z')] }))
  o = await CF.confirmFill(globalThis.__db, { caseId: 'cv1', coveredBy: 'Hal Lapsed', byName: 'Sam' })
  ck('confirm, list switch off: as before (no eligibility check yet)', o.outcome !== 'not_eligible', o)
  reset(K({ asked: [yes('Hal Lapsed', '9007', '2026-10-01T08:00:00Z')] }), { cara_list_live: true }); T.rules_approved = []
  const rf = globalThis.fetch; globalThis.fetch = async (u, x) => String(u).includes('api.github.com') ? new Response('no', { status: 503 }) : rf(u, x)
  o = await CF.confirmFill(globalThis.__db, { caseId: 'cv1', coveredBy: 'Amy Fit', byName: 'Sam' }); globalThis.fetch = rf
  ck('confirm, list switch on, rules unreadable: fails closed, says so, nothing changed', o.outcome === 'not_eligible' && /could not be checked just now/.test(o.detail) && APP.coverage_cases[0].status === 'open', o)
  const ca = fs.readFileSync(path.join(FN, 'coverage-assign/index.ts'), 'utf8'), cl = fs.readFileSync(path.join(FN, 'callin-alert/index.ts'), 'utf8')
  ck('both confirm doors answer 409 with the reason (Hub board and the call-in link)', /out\.outcome === 'not_eligible'\) return json\(\{ error: out\.detail, \.\.\.out \}, 409\)/.test(ca) && /out\.outcome === 'not_eligible'\) return json\(\{ error: out\.detail \+ ' Nothing was changed\.' \}, 409\)/.test(cl)) }

/* ── 3. one case per real shift (_shared/cara-visit-match.ts) ── */
{ const VM = await import(path.join(FN, '_shared/cara-visit-match.ts'))
  const now = new Date('2026-10-31T08:00:00').getTime()
  const v = (id, cl, date, s, e, cg = 77, extra = {}) => ({ id, caregiver: { id: cg }, client: { id: cl, firstName: cl === 1 ? 'Ruth' : 'Joel', lastName: 'Kay' }, scheduledStartDate: `${date}T${s}:00`, scheduledEndDate: `${date}T${e}:00`, ...extra })
  const rows = [v('a', 1, '2026-10-31', '09:00', '13:00'), v('b', 2, '2026-11-01', '09:00', '13:00'), v('c', 1, '2026-10-29', '09:00', '13:00'), v('d', 1, '2026-11-03', '09:00', '13:00'),
    v('e', 1, '2026-10-31', '14:00', '16:00', 99), v('f', 1, '2026-10-31', '15:00', '17:00', 77, { removed: true })]
  const opts = VM.callerVisitOptions(rows, '77', now)
  ck('visit match: only this caregiver\'s visits from 2 hours ago to 36 hours ahead, never a removed one, soonest first', JSON.stringify(opts.map((o) => o.visit_id)) === '["a","b"]' && opts[0].client === 'Ruth Kay' && opts[0].shift_time === '09:00-13:00' && opts[0].starts_in_min === 60, opts)
  ck('visit match: one visit = attached', VM.pickVisit(opts.slice(0, 1), null, 'x').state === 'one')
  ck('visit match: several = the office picks, unless the message names the client', VM.pickVisit(opts, null, 'x').state === 'several' && VM.pickVisit(opts, 'Joel', 'x').chosen?.visit_id === 'b' && VM.pickVisit(opts, '(from text, confirm the client)', 'x').state === 'several')
  ck('visit match: none = said plainly', VM.pickVisit([], null, 'x').state === 'none' && /no visits/.test(VM.pickVisit([], null, 'x').why))
  const one = VM.pickVisit(opts.slice(0, 1), null, 'x'), f = VM.attachFields(one)
  ck('visit match: attached = the real client, AxisCare client id, date, time and visit id on the case', f.axiscare_visit_id === 'a' && f.client === 'Ruth Kay' && f.client_axiscare_id === '1' && f.shift_date === '2026-10-31' && f.shift_time === '09:00-13:00')
  ck('visit match: several = nothing guessed onto the case, the short list kept', !('axiscare_visit_id' in VM.attachFields(VM.pickVisit(opts, null, 'x'))) && VM.attachFields(VM.pickVisit(opts, null, 'x')).visit_match.options.length === 2)
  const cases = [{ id: 'cwf_1', status: 'flagged', axiscare_visit_id: 'a', note: 'I am sick', flag_source: 'text message', opened_at: 't0', calling_off: 'Amy Fit' }, { id: 'old', status: 'resolved', axiscare_visit_id: 'b' }]
  ck('one shift, one case: a flagged or open case for the visit is found; a closed one is not', VM.caseForVisit(cases, 'a')?.id === 'cwf_1' && VM.caseForVisit(cases, 'b') === null)
  const mg = VM.mergeFlagIntoWatch(cases[0], 'cw_a_g1', 'now')
  ck('one shift, one case: the AxisCare case carries what the caregiver said; the flag closes as merged into it', mg.watchExtra.caregiver_said.text === 'I am sick' && mg.watchExtra.merged_flag === 'cwf_1' && mg.flagClosed.status === 'merged' && mg.flagClosed.merged_into === 'cw_a_g1')
  let seen = ''; const m404 = await VM.matchCallerVisit(async (u) => { seen = String(u); return new Response('', { status: 404 }) }, { site: '16485', token: 't', version: 'v', cgAxId: '77', clientHint: null, now: new Date() })
  ck('visit match: asks AxisCare for this caregiver only; a 404 (AxisCare\'s "no visits") = none', /caregiverIds=77/.test(seen) && m404.state === 'none')
  const m500 = await VM.matchCallerVisit(async () => new Response('', { status: 500 }), { site: '16485', token: 't', version: 'v', cgAxId: '77', clientHint: null })
  ck('visit match: AxisCare down = unreadable, said so, nothing guessed', m500.state === 'unreadable' && /500/.test(m500.why)) }

/* ── 4. urgency (_shared/cara-urgency.ts) ── */
{ const U = await import(path.join(FN, '_shared/cara-urgency.ts'))
  const now = '2026-10-31T08:00', K2 = (t, d = '2026-10-31', o = {}) => ({ shift_date: d, shift_time: t, status: 'open', ...o })
  ck('urgency: within 3 hours = Critical', U.urgencyOf(K2('10:30-14:00'), now).level === 'critical' && U.urgencyOf(K2('10:30-14:00'), now).why === 'starts in 2h 30m')
  ck('urgency: started under an hour ago = still Critical; over an hour = past', U.urgencyOf(K2('07:20-11:00'), now).level === 'critical' && /started 40m ago/.test(U.urgencyOf(K2('07:20-11:00'), now).why) && U.urgencyOf(K2('06:30-11:00'), now).level === 'past')
  ck('urgency: within 24 hours = Today; later = Coming up', U.urgencyOf(K2('18:00-22:00'), now).level === 'today' && U.urgencyOf(K2('09:00-13:00', '2026-11-03'), now).level === 'coming_up')
  ck('urgency: a must-be-covered client within 24 hours = Critical, with the reason', U.urgencyOf(K2('18:00-22:00'), now, { must: true }).level === 'critical' && /must be covered/.test(U.urgencyOf(K2('18:00-22:00'), now, { must: true }).why))
  ck('urgency: a regular opening or interest check = planning; no time = unknown', U.urgencyOf({ kind: 'interest' }, now).level === 'planning' && U.urgencyOf({ reason: 'open' }, now).level === 'planning' && U.urgencyOf({ shift_date: '2026-10-31' }, now).level === 'unknown')
  ck('urgency: confirmed means a caregiver is confirmed or AxisCare shows them', U.confirmed({ status: 'open', covered_by: 'A' }) && U.confirmed({ status: 'open', axiscare_assignment: { status: 'assigned' } }) && !U.confirmed({ status: 'open', asked: [{ state: 'yes' }] }))
  const r1 = U.criticalRecipients({ staffing: { person: 'k@x' }, in_charge: { person: 'k@x' } }, [{ email: 's@x', phone: '+1' }], (e) => e === 'k@x' ? { email: 'k@x', phone: '+2' } : null)
  ck('critical goes to the person on duty (once, even holding two seats)', r1.to.length === 1 && r1.to[0].email === 'k@x' && r1.why === 'on duty now')
  const r2 = U.criticalRecipients({ staffing: { person: 'n@x' } }, [{ email: 's@x', phone: '+1' }, { email: 't@x', phone: null }], () => ({ email: 'n@x', phone: null }))
  ck('nobody on duty with a phone = everyone on the alert list who has one (never silent)', r2.to.length === 1 && r2.to[0].email === 's@x' && /nobody on duty/.test(r2.why))
  ck('the Critical text says where it stands', /CRITICAL open shift: Ruth Kay .*Nobody has been asked yet\. \{link\}/.test(U.criticalText({ client: 'Ruth Kay', asked: [] }, { why: 'starts in 2h' }, 'today 10am')) && /1 said yes, nobody confirmed yet/.test(U.criticalText({ client: 'R', asked: [{ state: 'yes' }, { state: 'no' }] }, { why: 'x' }, 'w'))) }

/* ── 5. the tick: urgency and the Critical text, switch off then on ── */
{ const chiIn = (min) => { const d = new Date(Date.now() + min * 60000); const t = d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }); return [t.slice(0, 10), t.slice(11, 16)] }
  const [d2, s2] = chiIn(120), [, e2] = chiIn(360)
  const tick = async () => handler(new Request('https://x/functions/v1/coverage-run?commit=1', { method: 'POST', headers: { 'x-cron-secret': 'j'.repeat(64), 'Content-Type': 'application/json' }, body: '{}' }))
  const crit = K({ id: 'cv9', shift_date: d2, shift_time: `${s2}-${e2}`, admin_alerted: new Date(Date.now() - 86400000).toISOString(), opened_at: new Date(Date.now() - 86400000).toISOString() })
  const setup = (live) => { reset(structuredClone(crit), { cara_urgency_live: live, coverage_alert_admins: ['sam@x.com'], duty_default_staffing: 'kay@x.com', duty_default_in_charge: 'kay@x.com' }); APP.coverage_cases = [APP.coverage_cases[0]]
    APP.coordinator_staff = [{ email: 'sam@x.com', name: 'Sam Owner', phone: '4175550900' }, { email: 'kay@x.com', name: 'Kay Duty', phone: '4175550901' }]; APP.duty_windows = []; APP.positions = [] }
  const patchRpc = globalThis.__db.rpc
  globalThis.__db.rpc = async (fn, a) => { if (fn === 'coverage_case_patch') { const c = APP.coverage_cases.find((x) => x.id === a.p_id); if (c && (!a.p_expect?.status || c.status === a.p_expect.status)) Object.assign(c, a.p_patch); return { data: { ok: true }, error: null } } return patchRpc(fn, a) }
  setup(false); await tick(); let c9 = APP.coverage_cases[0]
  ck('tick, switch off: the level is kept as practice, and what WOULD have gone (to the person on duty) is recorded, nothing texted', c9.urgency_practice?.level === 'critical' && c9.critical_alerted_practice?.practice === true
    && JSON.stringify(c9.critical_alerted_practice.to) === '["kay@x.com"]' && !c9.urgency && !c9.critical_alerted && !SENT.some((m) => /CRITICAL/.test(m.msg)), [c9, SENT])
  setup(true); await tick(); c9 = APP.coverage_cases[0]
  ck('tick, switch on: Critical texts the person on duty at once, with their link, and says so on the case', c9.urgency?.level === 'critical' && SENT.filter((m) => /CRITICAL open shift/.test(m.msg)).length === 1 && /Nobody has been asked yet/.test(SENT.find((m) => /CRITICAL/.test(m.msg)).msg)
    && JSON.stringify(c9.critical_alerted?.reached) === '["kay@x.com"]', [c9, SENT])
  SENT = []; await tick()
  ck('tick: once per case (the next run sends nothing more)', !SENT.some((m) => /CRITICAL/.test(m.msg)), SENT)
  setup(true); APP.coverage_cases[0] = { ...structuredClone(crit), admin_alerted: null }; await tick(); c9 = APP.coverage_cases[0]
  ck('tick: a case already Critical when first seen: the call-in alert list gets the call-in alert, the person on duty not on that list gets the Critical text, nobody gets two',
    c9.critical_alerted?.with_callin_alert === true && JSON.stringify(c9.critical_alerted.reached) === '["kay@x.com"]' && SENT.filter((m) => m.to === 'C:+14175550901').length === 1 && SENT.filter((m) => m.to === 'C:+14175550900').length === 1, [c9.critical_alerted, SENT])
  setup(true); APP.coverage_cases[0] = { ...structuredClone(crit), covered_by: 'Amy Fit' }; await tick()
  ck('tick: a shift with a caregiver confirmed is never Critical-texted', !SENT.some((m) => /CRITICAL/.test(m.msg)))
  globalThis.__db.rpc = patchRpc }


/* ── 6. understanding a reply (_shared/cara-reply.ts) ── */
{ const R = await import(path.join(FN, '_shared/cara-reply.ts'))
  const yesW = { isYes: true, isNo: false }, noW = { isYes: false, isNo: true }, qW = { isYes: false, isNo: false }
  const ai = (answer, condition = null) => ({ answer, condition, quote: 'q', failed: false })
  ck('reply: the AI not answering = the word rules, as today', R.settleReply(yesW, { failed: true }).state === 'yes' && R.settleReply(qW, null).state === 'inquiry' && R.settleReply(noW, null).by === 'words')
  ck('reply: "yes but only until 3" = a yes that carries the condition (interest, nobody assigned)', R.settleReply(qW, ai('yes_condition', 'only until 3pm')).state === 'yes' && R.settleReply(qW, ai('yes_condition', 'only until 3pm')).condition === 'only until 3pm')
  ck('reply: words and AI disagree = a person decides (a "can\'t" the AI read as yes; a clean yes the AI read as no)', R.settleReply(noW, ai('yes')).state === 'inquiry' && R.settleReply(yesW, ai('no')).state === 'inquiry' && /a person decides/.test(R.settleReply(yesW, ai('no')).why))
  ck('reply: about a different shift, or a question, or unclear = a person', R.settleReply(qW, ai('other_shift')).state === 'inquiry' && /different shift/.test(R.settleReply(qW, ai('other_shift')).why) && R.settleReply(qW, ai('question')).state === 'inquiry' && R.settleReply(qW, ai('unclear')).state === 'inquiry')
  ck('reply: a plain yes both ways = yes, read by words and AI', R.settleReply(yesW, ai('yes')).state === 'yes' && R.settleReply(yesW, ai('yes')).by === 'words and AI')
  const prevDeno = globalThis.Deno; globalThis.Deno = { env: { get: (k) => k === 'ANTHROPIC_API_KEY' ? 'k' : prevDeno.env.get(k) } }
  let sentBody = null
  const r1 = await R.readShiftReply('yes but only till 3', { client: 'Ruth Kay', shift_date: '2026-10-31', shift_time: '09:00-17:00' }, async (u, o) => { sentBody = JSON.parse(o.body); return new Response(JSON.stringify({ content: [{ text: '{"answer":"yes_condition","condition":"until 3pm","quote":"yes but only till 3"}' }] }), { status: 200 }) })
  ck('reply: the AI is told the client\'s FIRST name only, the day and time, and the reply', r1.answer === 'yes_condition' && r1.condition === 'until 3pm' && /Ruth, 2026-10-31 09:00-17:00/.test(sentBody.messages[0].content) && !/Kay/.test(sentBody.messages[0].content), [r1, sentBody?.messages])
  const r2 = await R.readShiftReply('maybe', {}, async () => new Response(JSON.stringify({ content: [{ text: '{"answer":"maybe"}' }] }), { status: 200 }))
  const r3 = await R.readShiftReply('yes', {}, async () => new Response('x', { status: 529 }))
  ck('reply: an answer outside the six, or the AI erroring = failed (the word rules decide)', r2.failed && r3.failed)
  globalThis.Deno = prevDeno
  const src2 = fs.readFileSync(path.join(FN, 'coverage-reply/index.ts'), 'utf8')
  ck('coverage-reply: cara_reply_ai_live = live, cara_reply_ai_practice = kept as ai_read_practice, off = no AI call at all; interest checks untouched; nothing texted from this step',
    /settings\.cara_reply_ai_live === true \? 'live' : settings\.cara_reply_ai_practice === true \? 'practice' : 'off'/.test(src2) && /a\.ai_read_practice = /.test(src2) && /if \(String\(c\.kind\) !== 'interest' && aiMode !== 'off'\) \{\n    const ai = await readShiftReply/.test(src2)) }

for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
