// CARA'S SHIFT OPPORTUNITY PAGE (2026-10-24): the pure rules (_shared/shift-offer.ts, shift-links.ts) and the real shift-offer
// function against a fake database, fake GoHighLevel and fake AxisCare, with the Hub's real match-rules.js.
// Proves: switch off = caregiver links closed, office preview works; before the code nothing about the client; a one-time
// code texted to the offer's phone (hashed, rate-limited, 5 tries then locked); after the code only office-approved details
// (no last name, no street or address); the five answers saved onto that caregiver's own ask (a yes is interest only);
// a filled or closed shift shows nothing; links are per person and can't be changed or reused after the shift day.
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
ck('before the code: their first name, the day, the time, the hours, the town; nothing about the client', pv.caregiver_first === 'Maria' && pv.day === 'Saturday, October 31' && pv.time === '8am to 5pm' && pv.hours === 9 && pv.town === 'Nixa'
  && !/Ruth|Kay|Main|coffee/.test(JSON.stringify(pv)), pv)
const dv = SO.detailsView(KC, AS, 'open', { about: 'Ruth is a retired teacher.', enjoys: ['Gardening', 'Old movies'], help: ['Companionship'], needs: ['Dementia care'], home: ['Cats in the home'], level: 2, care_line: KC.care_note })
ck('after the code: first name(s) only, never the last name, the street or an address', dv.client_first === 'Ruth Ann' && !/Kay|Main St|123/.test(JSON.stringify(dv)) && dv.about === 'Ruth is a retired teacher.' && dv.scene === 'garden', dv)
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
ck('a changed answer keeps the earlier one in the history', ap2.state === 'no' && ap2.answer_history.length === 1 && ap2.answer_history[0].kind === 'part')
ck('a question is an inquiry with their words', SO.applyAnswer(AS, { kind: 'question', question: 'Stairs?' }, 'x').state === 'inquiry')
{ const sec = 'x'.repeat(40), exp = Math.floor(Date.now() / 1000) + 3600
  const L = await SL.makeShiftLink(sec, 'cv1', 'ask_1', exp), q = Object.fromEntries(new URL(L).searchParams)
  ck('links: one per person per shift, checked; another ask, a changed expiry, a wrong secret, an old link: refused', await SL.checkShiftLink(sec, q) && !(await SL.checkShiftLink(sec, { ...q, a: 'ask_2' })) && !(await SL.checkShiftLink(sec, { ...q, e: String(exp + 9) }))
    && !(await SL.checkShiftLink('y'.repeat(40), q)) && !(await SL.checkShiftLink(sec, q, exp + 1)) && /^https:\/\/cc\.mo-care\.com\/shift\.html\?c=cv1&a=ask_1&e=\d+&t=/.test(L), L)
  ck('links: expire at the end of the shift day (Central)', SL.shiftDayEnd('2026-10-31') === Date.parse('2026-11-01T05:00:00Z') / 1000) }

/* ── 2. the real function ── */
let T, APP, SENT, AXC
const SVC = 'svc_' + 'k'.repeat(60), SECRET = 'j'.repeat(64)
const facts = (req, pref = []) => MR.SKILLS.map((s) => ({ episode_id: 'e1', kind: 'need_' + s.key, layer: 'plan', value: req.includes(s.key) ? 'required' : pref.includes(s.key) ? 'preferred' : 'no' }))
const future = (() => { const d = new Date(Date.now() + 3 * 86400000); return d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10) })()
const reset = (settings = { shift_page_live: true }, kase = {}) => {
  SENT = []; AXC = []
  APP = { ops_settings: settings, coordinator_staff: [], ops_items: [],
    coverage_cases: [{ id: 'cv1', status: 'open', reason: 'call_off', client: 'Ruth Ann Kay', client_axiscare_id: '500', client_city: 'Nixa', client_street: 'Main St', shift_date: future, shift_time: '08:00-17:00', care_note: 'Coffee at 10',
      asked: [{ id: 'ask_1', name: 'Maria Lane', phone: '4175550101', axiscare_id: '9001', state: 'waiting', at: new Date().toISOString() },
              { id: 'ask_2', name: 'Pat Prn', phone: '4175550102', axiscare_id: '9002', state: 'waiting', prn: true, at: new Date().toISOString() }], ...kase }] }
  T = { shift_offer_codes: [], care_circles: [{ id: 'cc1', axiscare_client_id: '500', active: true, caregiver_about: 'Ruth is a retired teacher who loves a good laugh.', caregiver_enjoys: ['Gardening', 'Old movies'] }],
    person_source_id: [{ person_id: 'p1', system: 'axiscare', entity_type: 'client', source_id: '500' }], journey_episode: [{ episode_id: 'e1', person_id: 'p1', state: 'established', created_at: '2026-01-01' }],
    client_fact_current: [...facts(['dementia_care'], ['transportation']), { episode_id: 'e1', kind: 'home_cats', layer: 'plan', value: 'yes' }],
    rules_approved: [{ file: 'match-rules.js', sha256: sha(RULES) }], contact_optout_current: [], phone_index: [], persons: [], domains: [] }
}
const q = (t) => { const st = { f: [], inF: [], up: null }; const b = {
  select() { return b }, order() { return b }, limit() { return b }, gte() { return b }, lte() { return b }, ilike() { return b }, or() { return b }, neq() { return b }, is() { return b }, not() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF.push([c, v]); return b },
  update() { return { eq: () => Promise.resolve({ data: null, error: null }) } }, insert() { return Promise.resolve({ data: null, error: null }) },
  upsert(row) { if (t === 'shift_offer_codes') { const i = T.shift_offer_codes.findIndex((x) => x.id === row.id); if (i >= 0) T.shift_offer_codes[i] = { ...T.shift_offer_codes[i], ...row }; else T.shift_offer_codes.push({ code_tries: 0, sends: [], ...row }) } return Promise.resolve({ data: null, error: null }) },
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
  if (url.includes('axiscare.com')) { AXC.push({ url, method: (o && o.method) || 'GET' }); return new Response(JSON.stringify({ results: { client: { firstName: 'Ruth Ann', lastName: 'Kay', classes: [{ label: 'Level 2' }], residentialAddress: { street1: '123 Main St', city: 'Nixa' } } } }), { status: 200 }) }
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

/* switch off */
reset({}); let L1 = await linkFor('ask_1'), s, j
;[s, j] = await post({ ...L1, action: 'view' })
ck('switch off: a caregiver\'s link says the page isn\'t open yet (nothing shown)', s === 403 && /isn't open yet/.test(j.error) && !j.caregiver_first, [s, j])
;[s, j] = await post({ action: 'preview', case_id: 'cv1', ask_id: 'ask_1' }, 'Bearer staff')
ck('switch off: the office preview shows exactly what Maria would see', s === 200 && j.preview && j.client_first === 'Ruth Ann' && j.about && j.enjoys.join() === 'Gardening,Old movies' && j.help.includes("Dementia or Alzheimer's care") && j.needs.includes("Dementia or Alzheimer's care") && j.home.includes('Cats in the home') && j.care_line === 'Coffee at 10', [s, j])
ck('preview: no last name, no street, no address anywhere', !/Kay|Main St|123/.test(JSON.stringify(j)), j)
;[s, j] = await post({ action: 'preview', case_id: 'cv1', ask_id: 'ask_1' })
ck('preview needs a Hub sign-in', s === 401)
;[s, j] = await post({ action: 'preview_answer', case_id: 'cv1', ask_id: 'ask_1', kind: 'part', from: '08:00', to: '12:00' }, 'Bearer staff')
ck('preview answer: says what would be saved, saves nothing', s === 200 && /part of it: 8am to 12pm/.test(j.would_save) && APP.coverage_cases[0].asked[0].state === 'waiting', j)
;[s, j] = await post({ action: 'link', case_id: 'cv1', ask_id: 'ask_1' }, 'Bearer staff')
ck('switch off: no caregiver links are made (practice)', s === 409 && /practice/.test(j.error))

/* switch on */
reset(); L1 = await linkFor('ask_1')
;[s, j] = await post({ ...L1, action: 'view' })
ck('view: their first name, day, time, hours, town; nothing about the client', s === 200 && j.state === 'open' && j.caregiver_first === 'Maria' && j.town === 'Nixa' && !/Ruth|Kay|Main|Coffee|teacher/.test(JSON.stringify(j)), j)
;[s, j] = await post({ ...L1, action: 'details', session: 'x'.repeat(43) })
ck('details without the code: refused, asks for the code', s === 401 && j.need_code)
;[s, j] = await post({ ...L1, action: 'answer', kind: 'full', session: '' })
ck('an answer without the code: refused, nothing saved', s === 401 && APP.coverage_cases[0].asked[0].state === 'waiting')
;[s, j] = await post({ ...L1, action: 'send_code' })
const code = (SENT[0]?.msg.match(/\b(\d{6})\b/) || [])[1]
ck('send code: a 6-digit code texted from the office line to the phone that got the offer', s === 200 && j.to_last4 === '0101' && SENT.length === 1 && SENT[0].to === 'C:+14175550101' && !!code && /works for 10 minutes/.test(SENT[0].msg), [s, j, SENT])
ck('send code: only a hash is stored, never the code', T.shift_offer_codes.length === 1 && !JSON.stringify(T.shift_offer_codes).includes(code), T.shift_offer_codes)
;[s, j] = await post({ ...L1, action: 'send_code' })
ck('send code: once a minute', s === 429 && SENT.length === 1)
;[s, j] = await post({ ...L1, action: 'verify', code: '000000' === code ? '111111' : '000000' })
ck('a wrong code: refused, says how many tries are left', s === 401 && /4 tries left/.test(j.error), j)
;[s, j] = await post({ ...L1, action: 'verify', code })
const session = j.session
ck('the right code: a session (2 hours), the code can\'t be used again', s === 200 && /^[A-Za-z0-9_-]{43}$/.test(session) && T.shift_offer_codes[0].code_hash === null && !!T.shift_offer_codes[0].session_exp, j)
;[s, j] = await post({ ...L1, action: 'verify', code })
ck('the same code twice: refused', s === 410)
;[s, j] = await post({ ...L1, action: 'details', session })
ck('details after the code: office-approved only, no last name or street; the level from AxisCare is read, nothing written', s === 200 && j.client_first === 'Ruth Ann' && j.enjoys.length === 2 && !/Kay|Main St|123/.test(JSON.stringify(j)) && AXC.every((x) => x.method === 'GET'), [s, j])
const L2 = await linkFor('ask_2')
;[s, j] = await post({ ...L2, action: 'details', session })
ck('a session is for one person\'s link only (Pat can\'t use Maria\'s)', s === 401)
;[s, j] = await post({ ...L1, action: 'answer', session, kind: 'part', from: '08:00', to: '12:00', note: 'school pickup' })
const a1 = APP.coverage_cases[0].asked[0]
ck('answer: saved onto Maria\'s own ask, like a text reply, with her hours and note; nobody assigned', s === 200 && a1.state === 'yes' && a1.answer_kind === 'part' && a1.offer_to === '12:00' && a1.answer_note === 'school pickup' && a1.answer_channel === 'page' && !APP.coverage_cases[0].covered_by && APP.coverage_cases[0].status === 'open', [s, j, a1])
ck('answer: the office gets the usual "said yes" card for this shift', APP.ops_items.some((x) => x.id === 'ops_covfill_cv1' && /Pick on the board/.test(x.title)), APP.ops_items)
;[s, j] = await post({ ...L1, action: 'answer', session, kind: 'question', question: 'Are there stairs?' })
ck('a question: an inquiry with her words, and a question card for the office', s === 200 && APP.coverage_cases[0].asked[0].state === 'inquiry' && /Are there stairs\?/.test(APP.coverage_cases[0].asked[0].reply) && APP.ops_items.some((x) => /has a question/.test(x.title)))
ck('Pat\'s ask is untouched by Maria\'s answers', APP.coverage_cases[0].asked[1].state === 'waiting')
;[s, j] = await post({ ...L1, action: 'answer', session, kind: 'part', from: '06:00', to: '12:00' })
ck('a bad answer: said plainly, nothing saved', s === 400 && /between 8am and 5pm/.test(j.error) && APP.coverage_cases[0].asked[0].state === 'inquiry')
/* five wrong codes lock it */
reset(); const L3 = await linkFor('ask_2'); await post({ ...L3, action: 'send_code' }); const c3 = (SENT[0].msg.match(/\b(\d{6})\b/) || [])[1]
for (let i = 0; i < 5; i++) [s, j] = await post({ ...L3, action: 'verify', code: c3 === '222222' ? '333333' : '222222' })
ck('five wrong codes: locked, says to call the office', s === 401 && /locked/.test(j.error) && !!T.shift_offer_codes[0].locked_at)
;[s, j] = await post({ ...L3, action: 'verify', code: c3 })
ck('locked: even the right code is refused', s === 423)
/* filled or closed */
reset({ shift_page_live: true }, { covered_by: 'Somebody Else', status: 'done' }); L1 = await linkFor('ask_1')
;[s, j] = await post({ ...L1, action: 'view' })
ck('filled: the page says so and shows nothing else', s === 200 && j.state === 'closed' && !j.caregiver_first)
;[s, j] = await post({ ...L1, action: 'send_code' })
ck('filled: no code is sent', s === 200 && j.state === 'closed' && !SENT.length)
reset(); APP.coverage_cases[0].asked = APP.coverage_cases[0].asked.filter((a) => a.id !== 'ask_1'); L1 = await linkFor('ask_1')
;[s, j] = await post({ ...L1, action: 'view' })
ck('taken back (the ask is gone): nothing shown', s === 200 && j.state === 'gone' && !j.caregiver_first)
/* links */
reset(); ;[s, j] = await post({ ...(await linkFor('ask_1')), t: 'A'.repeat(43), action: 'view' })
ck('a changed or made-up link: refused', s === 403)
;[s, j] = await post({ action: 'link', case_id: 'cv1', ask_id: 'ask_2' }, 'Bearer staff')
ck('switch on: the office can get Pat\'s own link (the PRN Team works the same way)', s === 200 && /shift\.html\?c=cv1&a=ask_2/.test(j.link))
;[s, j] = await post({ ...(await linkFor('ask_2')), action: 'view' })
ck('PRN: the page knows it is a PRN opportunity', s === 200 && j.prn === true)
const srcFn = fs.readFileSync(`${FN}/shift-offer/index.ts`, 'utf8')
ck('the function never writes AxisCare, never texts anyone but the caregiver (the code) and the office', !/method:\s*'(PATCH|POST|DELETE)'/.test(srcFn.replace(/conversations\/messages[\s\S]{0,80}/g, '')) && /audience: 'caregiver'/.test(srcFn) && !/audience: '(client|family)'/.test(srcFn))

for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
