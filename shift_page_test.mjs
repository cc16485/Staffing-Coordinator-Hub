// CARA'S SHIFT OPPORTUNITY PAGE (2026-10-24): the pure rules (_shared/shift-offer.ts, shift-links.ts) and the real shift-offer
// function against a fake database, fake GoHighLevel and fake AxisCare, with the Hub's real match-rules.js.
// Proves: switch off = caregiver links closed, office preview works; no code (her call 2026-10-24): the link opens the page;
// only office-approved details (no last name, street or address; the care needs only when the office ticked "share");
// the five answers saved onto that caregiver's own ask with the full history (a yes is interest only); a changed shift
// (AxisCare now, or while they looked) can't be answered; a filled, closed or taken-back link shows nothing; links are per
// person and can't be changed or reused after the shift day.
// HUB=<care-coordinator-hub dir> node shift_page_test.mjs
import fs from 'fs'; import path from 'path'; import vm from 'vm'; import crypto from 'crypto'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions'), HUB = process.env.HUB || path.join(ROOT, '../cc-hub-cara-p1')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1500)])
const RULES = fs.readFileSync(path.join(HUB, 'match-rules.js'), 'utf8'); vm.runInThisContext(RULES); const MR = globalThis.CCMatch
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
const SO = await import(path.join(FN, '_shared/shift-offer.ts'))
const SL = await import(path.join(FN, '_shared/shift-links.ts'))

/* ── 1. pure rules ── */
const KC = { id: 'cv1', status: 'open', client: 'Ruth Ann Kay', client_city: 'Nixa', client_street: '123 Main St', shift_date: '2026-10-31', shift_time: '08:00-17:00', care_note: 'Likes her coffee at 10' }
const AS = { id: 'ask_1', name: 'Maria Lane', phone: '4175550101', state: 'waiting' }
ck('state: open / closed (filled or closed) / ended (started) / gone (taken back)', SO.pageState(KC, AS, '2026-10-30T09:00') === 'open' && SO.pageState({ ...KC, covered_by: 'X' }, AS, '2026-10-30T09:00') === 'closed'
  && SO.pageState({ ...KC, status: 'done' }, AS, '2026-10-30T09:00') === 'closed' && SO.pageState(KC, AS, '2026-10-31T08:00') === 'ended' && SO.pageState(KC, { ...AS, link_revoked: true }, '2026-10-30T09:00') === 'gone' && SO.pageState(KC, null, 'x') === 'gone')
const pv = SO.preView(KC, AS, 'open')
ck('the shift basics: their first name, the day, the time, the hours, the town', pv.caregiver_first === 'Maria' && pv.day === 'Saturday, October 31' && pv.time === '8am to 5pm' && pv.hours === 9 && pv.town === 'Nixa', pv)
const dv = SO.detailsView(KC, AS, 'open', { about: 'Ruth is a retired teacher.', enjoys: ['Gardening', 'Old movies'], help: ['Companionship'], needs: ['Dementia care'], home: ['Cats in the home'], level: 2, care_line: KC.care_note })
ck('details: first name(s) only, never the last name, the street or an address; the shift key travels with it', dv.client_first === 'Ruth Ann' && !/Kay|Main St|123/.test(JSON.stringify(dv)) && dv.about === 'Ruth is a retired teacher.' && dv.scene === 'garden' && dv.shift_key === '2026-10-31|08:00-17:00', dv)
ck('time rules: Exact time unless the office set Flexible start; hand-off off unless allowed', dv.time_flex === 'exact' && dv.handoff_ok === false && SO.detailsView({ ...KC, time_flex: 'flexible_start', flex_minutes: 90, handoff_ok: true }, AS, 'open', {}).flex_minutes === 90)
const A = (b) => SO.checkAnswer(KC, b)
ck('answers: full, no; part inside the shift; different hours any time; a question needs words', A({ kind: 'full' }).ok && A({ kind: 'no' }).ok && A({ kind: 'part', from: '08:00', to: '12:00' }).ok && A({ kind: 'diff', from: '18:00', to: '21:00' }).ok
  && !A({ kind: 'question', question: '' }).ok && A({ kind: 'question', question: 'Are there stairs?' }).ok && !A({ kind: 'maybe' }).ok)
ck('answers: part outside the shift refused; under an hour refused; end before start refused; not on the quarter hour refused', /between 8am and 5pm/.test(A({ kind: 'part', from: '07:00', to: '12:00' }).error) && /at least an hour/.test(A({ kind: 'diff', from: '10:00', to: '10:45' }).error)
  && /after the start/.test(A({ kind: 'diff', from: '12:00', to: '10:00' }).error) && !A({ kind: 'diff', from: '10:10', to: '12:00' }).ok)
ck('answers: "part" that is the whole shift counts as a full yes', A({ kind: 'part', from: '08:00', to: '17:00' }).ans?.kind === 'full')
const ap = SO.applyAnswer({ ...AS, condition: 'old' }, { kind: 'part', from: '08:00', to: '12:00', note: 'school pickup' }, '2026-10-30T10:00:00Z')
ck('saved like a text reply (state yes, the words, when) plus exactly what they chose; a yes is interest only', ap.state === 'yes' && /part of it: 8am to 12pm \(note: school pickup\)/.test(ap.reply) && ap.answer_channel === 'page' && ap.answer_kind === 'part' && ap.offer_from === '08:00' && !('condition' in ap) && !ap.covered_by, ap)
const ap2 = SO.applyAnswer(ap, { kind: 'no', note: '' }, '2026-10-30T11:00:00Z')
ck('a changed answer keeps the earlier one in the history', ap2.state === 'no' && ap2.answer_history.length === 1 && ap2.answer_history[0].kind === 'part' && ap2.answer_history[0].channel === 'page')
{ const t1 = { ...AS, state: 'yes', reply: 'yes!', replied_at: '2026-10-30T09:00:00Z', offered_for: '2026-10-31|08:00-17:00' }
  const h = SO.withHistory(t1)
  ck('history: a text answer counts too (channel, words, when, the hours it was for)', h.length === 1 && h[0].channel === 'text' && h[0].reply === 'yes!' && h[0].for === '2026-10-31|08:00-17:00', h)
  ck('history: nothing to keep before any answer; at most 20 lines', SO.withHistory(AS).length === 0 && SO.withHistory({ ...t1, answer_history: Array(25).fill({}) }).length === 20) }
ck('visit now: same hours = same; other hours = changed; removed, or someone else on it = closed; the person who came off still on it = same',
  SO.visitMatches(KC, { scheduledStartDate: '2026-10-31T08:00:00', scheduledEndDate: '2026-10-31T17:00:00' }) === 'same'
  && SO.visitMatches(KC, { scheduledStartDate: '2026-10-31T09:00:00', scheduledEndDate: '2026-10-31T17:00:00' }) === 'changed'
  && SO.visitMatches(KC, { removed: true }) === 'closed'
  && SO.visitMatches(KC, { caregiver: { id: 77, firstName: 'New', lastName: 'Person' }, scheduledStartDate: '2026-10-31T08:00:00', scheduledEndDate: '2026-10-31T17:00:00' }) === 'closed'
  && SO.visitMatches({ ...KC, calling_off: 'Kyra Linde' }, { caregiver: { id: 5, firstName: 'Kyra', lastName: 'Linde' }, scheduledStartDate: '2026-10-31T08:00:00', scheduledEndDate: '2026-10-31T17:00:00' }) === 'same'
  && SO.visitMatches(KC, null) === 'unchecked')
{ const ON = { ...KC, shift_pattern: { v: 2, kind: 'open_ongoing', weekday: 'Saturday', open_dates: ['2026-11-07', '2026-11-14'] } }, ONE = { ...KC, shift_pattern: { v: 2, kind: 'one_time_cover', weekday: 'Saturday', regular_caregiver: 'Emma Daum' } }
  ck('one time or every week: open every Saturday says it could become theirs; a one-time cover says this week only (no other caregiver named)', SO.patternOf(ON).label === 'Open every Saturday' && /could become your regular shift/.test(SO.patternOf(ON).sub) && SO.patternOf(ON).upcoming === 2
    && SO.patternOf(ONE).label === 'This week only' && !/Emma/.test(JSON.stringify(SO.patternOf(ONE))) && SO.patternOf(KC) === null && SO.detailsView(ON, AS, 'open', {}).pattern.kind === 'ongoing')
  const r1 = SO.checkAnswer(ON, { kind: 'full', regular: true }), r2 = SO.checkAnswer(ONE, { kind: 'full', regular: true }), r3 = SO.checkAnswer(ON, { kind: 'no', regular: true })
  ck('"I\'d like this every week": kept only on an every-week shift and only with a yes', r1.ans.regular === true && !r2.ans.regular && !r3.ans.regular)
  const ar = SO.applyAnswer(AS, r1.ans, 'x')
  ck('... saved as a wish (wants_regular) in their words; nothing is scheduled', ar.wants_regular === true && /regular weekly shift/.test(ar.reply) && ar.state === 'yes') }
ck('a question is an inquiry with their words', SO.applyAnswer(AS, { kind: 'question', question: 'Stairs?' }, 'x').state === 'inquiry')
{ const sec = 'x'.repeat(40), exp = Math.floor(Date.now() / 1000) + 3600
  const L = await SL.makeShiftLink(sec, 'cv1', 'ask_1', exp), q = Object.fromEntries(new URL(L).searchParams)
  ck('links: one per person per shift, checked; another ask, a changed expiry, a wrong secret, an old link: refused', await SL.checkShiftLink(sec, q) && !(await SL.checkShiftLink(sec, { ...q, a: 'ask_2' })) && !(await SL.checkShiftLink(sec, { ...q, e: String(exp + 9) }))
    && !(await SL.checkShiftLink('y'.repeat(40), q)) && !(await SL.checkShiftLink(sec, q, exp + 1)) && /^https:\/\/cc\.mo-care\.com\/shift\.html\?c=cv1&a=ask_1&e=\d+&t=/.test(L), L)
  ck('links: expire at the end of the shift day (Central)', SL.shiftDayEnd('2026-10-31') === Date.parse('2026-11-01T05:00:00Z') / 1000) }

/* ── 2. the real function ── */
let T, APP, SENT, AXC, VISIT
const SVC = 'svc_' + 'k'.repeat(60), SECRET = 'j'.repeat(64)
const facts = (req, pref = []) => MR.SKILLS.map((s) => ({ episode_id: 'e1', kind: 'need_' + s.key, layer: 'plan', value: req.includes(s.key) ? 'required' : pref.includes(s.key) ? 'preferred' : 'no' }))
const future = (() => { const d = new Date(Date.now() + 3 * 86400000); return d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10) })()
const reset = (settings = { shift_page_live: true }, kase = {}, share = true) => {
  SENT = []; AXC = []; VISIT = { id: 'v1', scheduledStartDate: future + 'T08:00:00', scheduledEndDate: future + 'T17:00:00', caregiver: null }
  APP = { ops_settings: settings, coordinator_staff: [], ops_items: [],
    coverage_cases: [{ id: 'cv1', status: 'open', reason: 'call_off', client: 'Ruth Ann Kay', client_axiscare_id: '500', axiscare_visit_id: 'v1', client_city: 'Nixa', client_street: 'Main St', shift_date: future, shift_time: '08:00-17:00', care_note: 'Coffee at 10',
      asked: [{ id: 'ask_1', name: 'Maria Lane', phone: '4175550101', axiscare_id: '9001', state: 'waiting', at: new Date().toISOString(), offered_for: future + '|08:00-17:00' },
              { id: 'ask_2', name: 'Pat Prn', phone: '4175550102', axiscare_id: '9002', state: 'waiting', prn: true, at: new Date().toISOString() }], ...kase }] }
  T = { care_circles: [{ id: 'cc1', axiscare_client_id: '500', active: true, caregiver_about: 'Ruth is a retired teacher who loves a good laugh.', caregiver_enjoys: ['Gardening', 'Old movies'], caregiver_share_care: share }],
    person_source_id: [{ person_id: 'p1', system: 'axiscare', entity_type: 'client', source_id: '500' }], journey_episode: [{ episode_id: 'e1', person_id: 'p1', state: 'established', created_at: '2026-01-01' }],
    client_fact_current: [...facts(['dementia_care'], ['transportation']), { episode_id: 'e1', kind: 'home_cats', layer: 'plan', value: 'yes' }],
    rules_approved: [{ file: 'match-rules.js', sha256: sha(RULES) }], contact_optout_current: [], phone_index: [], persons: [], domains: [] }
}
const q = (t) => { const st = { f: [], inF: [] }; const b = {
  select() { return b }, order() { return b }, limit() { return b }, gte() { return b }, lte() { return b }, ilike() { return b }, or() { return b }, neq() { return b }, is() { return b }, not() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF.push([c, v]); return b },
  update() { return { eq: () => Promise.resolve({ data: null, error: null }) } }, insert() { return Promise.resolve({ data: null, error: null }) }, upsert() { return Promise.resolve({ data: null, error: null }) },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: null })) }, single() { return b.maybeSingle() },
  then(ok, bad) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok, bad) }
    let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); for (const [c, v] of st.inF) r = r.filter((x) => v.includes(x[c]))
    return Promise.resolve({ data: r, error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) }
  return { data: null, error: null } }, auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) } }
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.startsWith('https://cc.mo-care.com/match-rules.js')) return new Response(RULES, { status: 200 })
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + body.phone, dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, msg: body.message, from: body.fromNumber }); return new Response('{}', { status: 200 }) }
  if (url.includes('axiscare.com')) { AXC.push({ url, method: (o && o.method) || 'GET' })
    if (/\/api\/visits\//.test(url)) return VISIT === 'down' ? new Response('', { status: 503 }) : VISIT === 'gone' ? new Response('', { status: 404 }) : new Response(JSON.stringify({ results: { visit: VISIT } }), { status: 200 })
    return new Response(JSON.stringify({ results: { client: { firstName: 'Ruth Ann', lastName: 'Kay', classes: [{ label: 'Level 2' }], residentialAddress: { street1: '123 Main St', city: 'Nixa' } } } }), { status: 200 }) }
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', HUB_JOB_SECRET: SECRET }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
fs.writeFileSync(`${FN}/_shared/_staff_stub_sp.ts`, "export const OFFICE_ROLES = ['owner_admin']\nexport async function requireStaff(_sb: any, req: Request) { return req.headers.get('authorization') === 'Bearer staff' ? { ok: true, name: 'Kay Office', email: 'k@x', person_id: 'p', roles: ['owner_admin'] } : { ok: false, status: 401, error: 'Sign in to the Hub first.' } }\n")
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_staff_stub_sp.ts`) } catch { /* */ } })
const src = fs.readFileSync(`${FN}/shift-offer/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/staff-auth\.ts\1/, "'../_shared/_staff_stub_sp.ts'")
const tmp = path.join(FN, 'shift-offer', '_sp.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const post = async (body, auth) => { const r = await handler(new Request('https://x/functions/v1/shift-offer', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(body) })); return [r.status, await r.json()] }
const linkFor = async (ask) => { const L = await SL.makeShiftLink(SECRET, 'cv1', ask, SL.shiftDayEnd(future)); return Object.fromEntries(new URL(L).searchParams) }
const KEY = () => future + '|08:00-17:00'
const APPROVED = ['ok', 'checked', 'state', 'caregiver_first', 'prn', 'day', 'time', 'hours', 'town', 'answered', 'client_first', 'about', 'enjoys', 'help', 'needs', 'home', 'level', 'care_line', 'time_flex', 'flex_minutes', 'handoff_ok', 'scene', 'shift_from', 'shift_to', 'shift_key', 'pattern']

/* switch off */
reset({}); let L1 = await linkFor('ask_1'), s, j
;[s, j] = await post({ ...L1, action: 'view' })
ck('switch off: a caregiver\'s link says the page isn\'t open yet (nothing shown)', s === 403 && /isn't open yet/.test(j.error) && !j.caregiver_first, [s, j])
;[s, j] = await post({ action: 'preview', case_id: 'cv1', ask_id: 'ask_1' }, 'Bearer staff')
ck('switch off: the office preview shows exactly what Maria would see', s === 200 && j.preview && j.client_first === 'Ruth Ann' && j.about && j.enjoys.join() === 'Gardening,Old movies' && j.help.includes("Dementia or Alzheimer's care") && j.home.includes('Cats in the home') && j.care_line === 'Coffee at 10' && j.checked === 'same', [s, j])
ck('preview: no last name, no street, no address anywhere', !/Kay|Main St|123/.test(JSON.stringify(j)), j)
;[s, j] = await post({ action: 'preview', case_id: 'cv1', ask_id: 'ask_1' })
ck('preview needs a Hub sign-in', s === 401)
;[s, j] = await post({ action: 'preview_answer', case_id: 'cv1', ask_id: 'ask_1', kind: 'part', from: '08:00', to: '12:00' }, 'Bearer staff')
ck('preview answer: says what would be saved, saves nothing', s === 200 && /part of it: 8am to 12pm/.test(j.would_save) && APP.coverage_cases[0].asked[0].state === 'waiting', j)
;[s, j] = await post({ action: 'link', case_id: 'cv1', ask_id: 'ask_1' }, 'Bearer staff')
ck('switch off: no caregiver links are made (practice)', s === 409 && /practice/.test(j.error))

/* switch on: no code, the link opens it */
reset(); L1 = await linkFor('ask_1')
;[s, j] = await post({ ...L1, action: 'view' })
ck('no code (her call): the link opens the shift and the approved details straight away; nothing is texted', s === 200 && j.state === 'open' && j.client_first === 'Ruth Ann' && j.about && !SENT.length, [s, j])
ck('approved fields only: the answer has exactly the approved fields and nothing else', Object.keys(j).every((k) => APPROVED.includes(k)) && !/Kay|Main St|123|Ann Kay/.test(JSON.stringify(j)), Object.keys(j))
ck('AxisCare is only read (the visit, now)', AXC.length > 0 && AXC.every((x) => x.method === 'GET') && AXC.some((x) => /\/api\/visits\/v1/.test(x.url)))
reset({ shift_page_live: true }, {}, false); ;[s, j] = await post({ ...L1, action: 'view' })
ck('care needs not shared for this client: only the shift, the About and What they enjoy', s === 200 && j.about && j.enjoys.length === 2 && !j.help.length && !j.needs.length && !j.home.length && j.level === null, j)
reset(); ;[s, j] = await post({ ...L1, action: 'answer', shift_key: KEY(), kind: 'part', from: '08:00', to: '12:00', note: 'school pickup' })
let a1 = APP.coverage_cases[0].asked[0]
ck('answer: saved onto Maria\'s own ask with her hours, her note and the hours it was for; nobody assigned', s === 200 && a1.state === 'yes' && a1.answer_kind === 'part' && a1.offer_to === '12:00' && a1.answer_note === 'school pickup' && a1.answered_for === KEY() && !APP.coverage_cases[0].covered_by, [s, j, a1])
ck('answer: the office gets the usual "said yes" card for this shift', APP.ops_items.some((x) => x.id === 'ops_covfill_cv1'))
;[s, j] = await post({ ...L1, action: 'answer', shift_key: KEY(), kind: 'full' })
;[s, j] = await post({ ...L1, action: 'answer', shift_key: KEY(), kind: 'question', question: 'Are there stairs?' })
a1 = APP.coverage_cases[0].asked[0]
ck('changed answers: the latest stands (a question now); every earlier answer kept in order', a1.state === 'inquiry' && a1.answer_history.length === 2 && a1.answer_history[0].kind === 'part' && a1.answer_history[1].kind === 'full', a1.answer_history)
ck('Pat\'s ask is untouched by Maria\'s answers', APP.coverage_cases[0].asked[1].state === 'waiting')
;[s, j] = await post({ ...L1, action: 'answer', shift_key: KEY(), kind: 'part', from: '06:00', to: '12:00' })
ck('a bad answer: said plainly, nothing saved', s === 400 && /between 8am and 5pm/.test(j.error) && APP.coverage_cases[0].asked[0].state === 'inquiry')

/* the shift changed */
reset(); ;[s, j] = await post({ ...L1, action: 'answer', shift_key: future + '|07:00-17:00', kind: 'full' })
ck('the shift changed while they looked (another key): refused, asked to look again, nothing saved', s === 409 && j.changed && APP.coverage_cases[0].asked[0].state === 'waiting', [s, j])
reset(); VISIT.scheduledStartDate = future + 'T09:00:00'
;[s, j] = await post({ ...L1, action: 'view' })
ck('AxisCare now shows other hours: the page says it changed and shows nothing else', s === 200 && j.state === 'changed' && !j.client_first, j)
;[s, j] = await post({ ...L1, action: 'answer', shift_key: KEY(), kind: 'full' })
ck('... and an answer for the old hours is refused', j.state === 'changed' && APP.coverage_cases[0].asked[0].state === 'waiting')
reset(); VISIT = 'down'; ;[s, j] = await post({ ...L1, action: 'answer', shift_key: KEY(), kind: 'full' })
ck('AxisCare can\'t be read: the answer waits (never saved against hours nobody checked)', s === 503 && APP.coverage_cases[0].asked[0].state === 'waiting', [s, j])
reset(); VISIT.caregiver = { id: 77, firstName: 'New', lastName: 'Person' }; ;[s, j] = await post({ ...L1, action: 'view' })
ck('someone else is on the visit in AxisCare now: covered, nothing shown', j.state === 'closed' && !j.client_first)
reset(); VISIT = 'gone'; ;[s, j] = await post({ ...L1, action: 'view' })
ck('the visit was removed in AxisCare: closed', j.state === 'closed')

/* filled, closed, taken back, expiry */
reset({ shift_page_live: true }, { covered_by: 'Somebody Else', status: 'done' }); L1 = await linkFor('ask_1')
;[s, j] = await post({ ...L1, action: 'view' })
ck('filled: the page says so and shows nothing else', s === 200 && j.state === 'closed' && !j.caregiver_first && !j.client_first)
reset(); ;[s, j] = await post({ action: 'revoke', case_id: 'cv1', ask_id: 'ask_1' }, 'Bearer staff')
ck('take back a link: saved with who and when', s === 200 && APP.coverage_cases[0].asked[0].link_revoked === true && APP.coverage_cases[0].asked[0].link_revoked_by === 'Kay Office')
;[s, j] = await post({ ...L1, action: 'view' })
ck('a taken-back link: nothing shown', j.state === 'gone' && !j.client_first)
;[s, j] = await post({ ...L1, action: 'answer', shift_key: KEY(), kind: 'full' })
ck('a taken-back link: can\'t answer', j.state === 'gone' && APP.coverage_cases[0].asked[0].state === 'waiting')
;[s, j] = await post({ action: 'revoke', case_id: 'cv1', ask_id: 'ask_1' })
ck('taking a link back needs a Hub sign-in', s === 401)
;[s, j] = await post({ action: 'restore', case_id: 'cv1', ask_id: 'ask_1' }, 'Bearer staff'); ;[s, j] = await post({ ...L1, action: 'view' })
ck('give it back: it opens again', j.state === 'open' && j.client_first === 'Ruth Ann')
const old = { ...L1 }; old.e = String(Math.floor(Date.now() / 1000) - 10)
;[s, j] = await post({ ...old, action: 'view' })
ck('an expired link (past the shift day) is refused', s === 403)
reset(); APP.coverage_cases[0].asked = APP.coverage_cases[0].asked.filter((a) => a.id !== 'ask_1')
;[s, j] = await post({ ...L1, action: 'view' })
ck('the ask is gone from the case: nothing shown', s === 200 && j.state === 'gone' && !j.caregiver_first)
reset(); ;[s, j] = await post({ ...(await linkFor('ask_1')), t: 'A'.repeat(43), action: 'view' })
ck('a changed or made-up link: refused', s === 403)
;[s, j] = await post({ ...(await linkFor('ask_1')), a: 'ask_2', action: 'view' })
ck('Maria\'s link can\'t be turned into Pat\'s', s === 403)
;[s, j] = await post({ action: 'link', case_id: 'cv1', ask_id: 'ask_2' }, 'Bearer staff')
ck('switch on: the office can get Pat\'s own link (the PRN Team works the same way)', s === 200 && /shift\.html\?c=cv1&a=ask_2/.test(j.link))
;[s, j] = await post({ ...(await linkFor('ask_2')), action: 'view' })
ck('PRN: the page knows it is a PRN opportunity', s === 200 && j.prn === true)
const srcFn = fs.readFileSync(`${FN}/shift-offer/index.ts`, 'utf8')
ck('the function never writes AxisCare and texts nobody but the office (the first-yes alert)', !/method:\s*'(PATCH|POST|DELETE)'/.test(srcFn) && !/contactForOutbound|ghlSendChecked|send_code/.test(srcFn))

for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
