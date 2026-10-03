// 432 · CALLS TELL US "RUNNING LATE". Samantha 2026-10-03: "i thought it might have read my transcript from my call to
// mary to see that she said she is running late and will be to Aprils in 8 minutes", then "yes build it".
// The REAL late-watch, timekeeper-watch, clockin-alert and late-alert against one fake database, fake AxisCare, fake
// GoHighLevel (calls, transcripts, users), a fake AI and a controllable clock.   node call_late_432_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1600)]);
const FN = 'supabase/functions'
/* ── the clock: Friday 2026-10-02, Central is CDT (UTC-5) ── */
const RealDate = Date
let NOW = RealDate.parse('2026-10-02T16:00:00-05:00')
class FakeDate extends RealDate { constructor(...a) { if (!a.length) super(NOW); else super(...a) } static now() { return NOW } }
globalThis.Date = FakeDate
const at = (hm) => { NOW = RealDate.parse(`2026-10-02T${hm}:00-05:00`) }
const T_ = (hm) => RealDate.parse(`2026-10-02T${hm}:00-05:00`)
const iso = (t) => new RealDate(t).toISOString()
const hhmm = (t) => new RealDate(t).toLocaleString('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false })

/* ── the fake world ── */
let APP, T, SENT, VISITS, MSGS, TRANSCRIPTS, USERS, AI, NEXT, SEQ, CALLS, CONTACTS, STAFF = null
const reset = (st = {}) => {
  SEQ = 1; SENT = []; AI = []; CALLS = []; TRANSCRIPTS = {}; MSGS = {}; NEXT = null
  USERS = { uKry: { name: 'Krystal L', email: 'kry@mo-care.com' }, uSam: { name: 'Samantha T', email: 'sam@mo-care.com' } }
  APP = { ops_settings: { timekeeper_watch_live: true, timekeeper_text_live: true, timekeeper_admin_loop_live: true, coverage_alert_admins: ['sam@mo-care.com', 'kry@mo-care.com'], ...st },
    caregivers: [{ id: 1, first: 'Mary', last: 'Smith', phone: '4175550111', axiscare_id: '501', active: true }],
    coordinator_staff: [{ email: 'sam@mo-care.com', name: 'Samantha T', phone: '4175550901' }, { email: 'kry@mo-care.com', name: 'Krystal L', phone: '4175550902' }],
    timekeeper_cases: [], coverage_cases: [], ops_items: [], automation_log: [], late_watch_state: [], automation_heartbeats: [] }
  T = { late_notices: [], phone_index: [], contact_optout_current: [], op_events: [], contact_send_refusals: [], evv_sign: [], evv_submissions: [],
    care_circles: [{ id: 'k1', axiscare_client_id: '701', active: true }],
    circle_contacts: [{ circle_id: 'k1', name: 'Linda Jones', phone: '4175550200', sms_consent: true },
      { circle_id: 'k1', name: 'Tom Jones', phone: '4175550201', sms_consent: true, stopped_at: '2026-01-01' },
      { circle_id: 'k1', name: 'Sue Jones', phone: '4175550202', sms_consent: false },
      { circle_id: 'k1', name: 'Wes Jones', phone: '4175550203', sms_consent: true, wants_changes: false }] }
  CONTACTS = [{ id: 'gMary', firstName: 'Mary', lastName: 'Smith', phone: '+14175550111' }]
  VISITS = [{ id: 9001, caregiver: { id: 501, firstName: 'Mary', lastName: 'Smith' }, client: { id: 701, firstName: 'April', lastName: 'Jones' },
    scheduledStartDate: '2026-10-02T16:30:00', scheduledEndDate: '2026-10-02T20:30:00', clockIn: null, clockOut: null }]
}
/* a call in Mary's GoHighLevel conversation (office line). dir out = the office called her. */
const call = (id, hm, { dir = 'out', user = 'uKry', secs = 62, words = null, contact = 'gMary' } = {}) => {
  (MSGS[contact] ||= []).push({ id, direction: dir === 'out' ? 'outbound' : 'inbound', messageType: 'TYPE_CALL', dateAdded: iso(T_(hm)), ...(user ? { userId: user } : {}), meta: { call: { duration: secs } } })
  if (words) TRANSCRIPTS[id] = words
}
const text = (id, hm, body, contact = 'gMary') => { (MSGS[contact] ||= []).push({ id, direction: 'inbound', messageType: 'TYPE_SMS', body, dateAdded: iso(T_(hm)) }) }
/* the fake database (one for all four functions) */
const q = (t) => { const st = { f: [], inF: [], nn: [], gte: null, lt: null, op: null, val: null }; const b = new Proxy({
  select() { return b }, order() { return b }, limit() { return b }, neq() { return b }, not(c, op, v) { if (op === 'is' && v === null) st.nn.push(c); return b }, is() { return b }, contains() { return b }, or() { return b }, ilike() { return b }, lte() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF.push([c, v]); return b },
  gte(c, v) { st.gte = [c, v]; return b }, lt(c, v) { st.lt = [c, v]; return b },
  update(o) { st.op = 'update'; st.val = o; return b }, delete() { st.op = 'delete'; return b }, upsert(o) { st.op = 'insert'; st.val = o; return b },
  insert(o) { st.op = 'insert'; st.val = o; return b },
  rows() { if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return k in APP ? [{ key: k, data: JSON.parse(JSON.stringify(APP[k])) }] : [] }
    let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => String(x[c]) === String(v)); for (const [c, v] of st.inF) r = r.filter((x) => v.map(String).includes(String(x[c]))); for (const c of st.nn) r = r.filter((x) => x[c] != null)
    if (st.gte) r = r.filter((x) => String(x[st.gte[0]]) >= String(st.gte[1])); if (st.lt) r = r.filter((x) => String(x[st.lt[0]]) < String(st.lt[1])); return r },
  exec() {
    if (st.op === 'insert') { if (t === 'late_notices' && T.late_notices.some((x) => x.visit_id === st.val.visit_id)) return { error: { message: 'duplicate' } }
      const row = { id: SEQ++, created_at: iso(Date.now()), updated_at: iso(Date.now()), said: [], family: [], admin_rounds: [], would: [], sure: true, ...JSON.parse(JSON.stringify(st.val)) }; (T[t] ||= []).push(row); return [row] }
    if (st.op === 'update') { for (const x of b.rows()) Object.assign(x, JSON.parse(JSON.stringify(st.val))); return null }
    if (st.op === 'delete') { const kill = new Set(b.rows()); T[t] = (T[t] ?? []).filter((x) => !kill.has(x)); return null }
    return JSON.parse(JSON.stringify(b.rows())) },
  maybeSingle() { const r = b.exec(); return Promise.resolve(r?.error ? { data: null, error: r.error } : { data: (Array.isArray(r) ? r[0] : null) ?? null, error: null }) },
  single() { return b.maybeSingle() },
  then(ok, bad) { const r = b.exec(); return Promise.resolve(r?.error ? { data: null, error: r.error } : { data: r, error: null }).then(ok, bad) } },
  { get(o, k) { return k in o ? o[k] : (() => b) } }); return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const it = JSON.parse(JSON.stringify(a.item)); const i = arr.findIndex((x) => x.id === it.id); if (i >= 0) arr[i] = it; else arr.push(it) }
  return { data: null, error: null } }, auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) } }
/* the fake outside world */
const PHONE_OF = {}
globalThis.fetch = async (url, o) => {
  url = String(url); const m = o?.method || 'GET'; const body = o && o.body ? JSON.parse(o.body) : {}; CALLS.push({ m, url })
  if (url.includes('api.anthropic.com')) { const c = body.messages[0].content; AI.push(c)
    if (!NEXT) return new Response(JSON.stringify({ content: [{ text: '{"kind":"other","eta":"","sure":true,"quote":""}' }] }), { status: 200 })
    const a = { kind: NEXT.kind, eta: NEXT.eta == null ? '' : hhmm(NEXT.eta), sure: NEXT.sure !== false, quote: NEXT.quote ?? '' }
    return new Response(JSON.stringify({ content: [{ text: JSON.stringify(a) }] }), { status: 200 }) }
  if (/axiscare\.com\/api\/visits\?/.test(url)) return new Response(JSON.stringify({ results: { visits: JSON.parse(JSON.stringify(VISITS)), nextPage: null } }), { status: 200 })
  const vm = url.match(/axiscare\.com\/api\/visits\/(\d+)/); if (vm) return new Response(JSON.stringify({ results: VISITS.find((v) => String(v.id) === vm[1]) }), { status: 200 })
  if (/axiscare\.com\/api\/clients/.test(url)) return new Response(JSON.stringify({ results: { clients: [{ id: 701, homePhone: '4175558000' }] } }), { status: 200 })
  if (url.includes('/contacts/lookup')) return new Response('{}', { status: 404 })
  if (/leadconnectorhq\.com\/contacts\/\?/.test(url)) { const qq = decodeURIComponent(new URL(url).searchParams.get('query') || '')
    return new Response(JSON.stringify({ contacts: CONTACTS.filter((c) => String(c.phone).replace(/\D/g, '').endsWith(qq.replace(/\D/g, '')) && qq.replace(/\D/g, '').length >= 10) }), { status: 200 }) }
  if (url.includes('/contacts/upsert')) { const id = 'C:' + String(body.phone || body.email).replace(/\D/g, '').slice(-10); PHONE_OF[id] = id.slice(2); return new Response(JSON.stringify({ contact: { id, dnd: false } }), { status: 200 }) }
  if (url.includes('/conversations/search')) { const cid = new URL(url).searchParams.get('contactId'); return new Response(JSON.stringify({ conversations: MSGS[cid] ? [{ id: 'cv_' + cid }] : [] }), { status: 200 }) }
  const tm = url.match(/\/messages\/([^/]+)\/transcription/); if (tm) return TRANSCRIPTS[tm[1]] ? new Response(JSON.stringify(TRANSCRIPTS[tm[1]].map((w, i) => ({ sentenceIndex: i, transcript: w }))), { status: 200 }) : new Response('{}', { status: 404 })
  const cm = url.match(/\/conversations\/cv_([^/]+)\/messages/); if (cm) { const arr = (MSGS[cm[1]] || []).filter((x) => Date.parse(x.dateAdded) <= NOW).slice().sort((a, b) => Date.parse(b.dateAdded) - Date.parse(a.dateAdded)); return new Response(JSON.stringify({ messages: { messages: arr, nextPage: false } }), { status: 200 }) }
  const um = url.match(/leadconnectorhq\.com\/users\/([^/?]+)/); if (um) return USERS[um[1]] ? new Response(JSON.stringify(USERS[um[1]]), { status: 200 }) : new Response('{}', { status: 403 })
  if (url.endsWith('/conversations/messages') && m === 'POST') { SENT.push({ to: PHONE_OF[body.contactId] || body.contactId, msg: body.message || '' }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', ANTHROPIC_API_KEY: 'a',
  HUB_JOB_SECRET: 'x'.repeat(40), LATE_WATCH_PAUSE_MS: '0' }
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { globalThis.__h = h } }
fs.writeFileSync(`${FN}/_shared/_job-auth_432.ts`, "export const jobCaller = async (req) => req.headers.get('x-test') === 'cron' ? 'cron' : null\n")
fs.writeFileSync(`${FN}/_shared/_staff-auth_432.ts`, "export const OFFICE_ROLES = ['owner_admin']\nexport const requireStaff = async () => globalThis.__staff()\nexport const serverSecretOk = () => false\n")
process.on('exit', () => { for (const f of ['_job-auth_432.ts', '_staff-auth_432.ts']) try { fs.unlinkSync(`${FN}/_shared/${f}`) } catch { /* */ } })
globalThis.__staff = () => STAFF ?? { ok: false, status: 401, error: 'Sign in first.' }
const load = async (name) => {
  const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_432.ts'").replace(/(['"])\.\.\/_shared\/staff-auth\.ts\1/, "'../_shared/_staff-auth_432.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_t432.ts'); fs.writeFileSync(tmp, src)
  try { const M = await import(tmp + '?' + Math.random()); return { M, h: globalThis.__h } } finally { fs.unlinkSync(tmp) }
}
const LW = await load('late-watch'), TK = await load('timekeeper-watch'), CA = await load('clockin-alert'), LA = await load('late-alert')
const LN = await import(path.join(process.cwd(), FN, '_shared/late-links.ts'))
const HOLD = await import(path.join(process.cwd(), FN, '_shared/late-notice.ts'))
const lw = async () => { const r = await LW.h(new Request('https://x/functions/v1/late-watch', { method: 'POST', headers: { 'x-test': 'cron' }, body: '{}' })); return r.json() }
const tick = async () => { const r = await TK.h(new Request('https://x/functions/v1/timekeeper-watch', { method: 'POST', headers: { 'x-test': 'cron' } })); return r.json() }
const cpage = async (body) => { const r = await CA.h(new Request('https://x/functions/v1/clockin-alert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json().catch(() => null) } }
const lpage = async (body) => { const r = await LA.h(new Request('https://x/functions/v1/late-alert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json().catch(() => null) } }
const lateLink = async (id, email) => { const u = new URL(await LN.makeLink(ENV.HUB_JOB_SECRET, 'ln_' + id, email, LN.linkExpiry('2026-10-02'))); return Object.fromEntries(u.searchParams) }
const linkOf = (msg) => { const m = String(msg).match(/https:\/\/cc\.mo-care\.com\/clockin\.html\?c=([^&]+)&a=([0-9a-f]+)&e=(\d+)&t=([A-Za-z0-9_-]+)/); return m ? { c: decodeURIComponent(m[1]), a: m[2], e: Number(m[3]), t: m[4] } : null }
const lateLinkOf = (u) => Object.fromEntries(new URL(u).searchParams)
const to_ = (p) => SENT.filter((x) => String(x.to).endsWith(p))
const toCg = () => to_('4175550111'), toSam = () => to_('4175550901'), toKry = () => to_('4175550902'), toFam = () => SENT.filter((x) => /^41755502/.test(String(x.to))), toClient = () => to_('4175558000')
const notice = () => T.late_notices.find((x) => x.visit_id === '9001')
const lad = () => APP.timekeeper_cases.find((l) => l.visit_id === '9001')
const MARY_8 = ["Hi Mary, it's Krystal at Caring Companions, just checking on you for April's.", "Hi, yes, I'm running late, I'll be to April's in 8 minutes.", 'OK, thanks, drive safe.']

/* ════ 1 · her call to Mary: 4:31pm, "running late ... in 8 minutes", before the missed clock-in alert ════ */
reset(); call('call1', '16:31', { words: MARY_8 }); NEXT = { kind: 'late', eta: T_('16:39'), quote: "I'm running late, I'll be to April's in 8 minutes" }
at('16:33'); let j = await lw(); let n = notice()
ck('the office\'s OUTBOUND call is read (the gap that missed Mary): one AI read, marked as a phone call, both sides of the transcript', AI.length === 1 && /\(phone call\)/.test(AI[0]) && /in 8 minutes/.test(AI[0]) && /checking on you/.test(AI[0]), AI)
ck('a running-late notice: late, from a call, about 4:39pm, LIVE although the running-late notices are in practice (late_call_live unset = on)',
  n && n.kind === 'late' && n.source === 'call' && n.status === 'open' && hhmm(Date.parse(n.eta)) === '16:39' && n.eta_by === 'ai' && j.calls_live === true, [n, j])
ck('the call is recorded: when, which way, who in the office was on it, her own words (checked against the transcript)',
  n.call_at === iso(T_('16:31')) && n.call_direction === 'out' && n.call_by === 'Krystal L' && n.call_by_email === 'kry@mo-care.com' && n.call_quote === "I'm running late, I'll be to April's in 8 minutes" && n.call_message_id === 'call1', n)
ck('nothing is texted because of the call (no caregiver reply, no admin text, no family)', SENT.length === 0, SENT)
let card = APP.ops_items.find((i) => i.id === 'ops_late_' + n.id)
ck('Needs Attention: "Running late" card, in the words of the call', card && card.status === 'open' && card.title === "Running late: Mary Smith for April's 4:30pm shift, about 4:39pm"
  && card.detail.startsWith("Mary said on Krystal's 4:31pm call: running late, about 8 minutes (around 4:39pm). Word for word: \"I'm running late, I'll be to April's in 8 minutes\""), card)
ck('the line, as each person reads it', HOLD.callLine(n, 'kry@mo-care.com') === "Mary said on your 4:31pm call: running late, about 8 minutes (around 4:39pm)."
  && HOLD.callLine(n, 'sam@mo-care.com') === "Mary said on Krystal's 4:31pm call: running late, about 8 minutes (around 4:39pm).", [HOLD.callLine(n, 'kry@mo-care.com'), HOLD.callLine(n, 'sam@mo-care.com')])
at('16:35'); j = await tick()
ck('4:35 (5 min past start): HELD: no "we don\'t see a clock-in" text to Mary, no admin text, no alert opened', SENT.length === 0 && !lad() && j.held_running_late >= 1, [SENT, j.held_running_late, lad()])
let L = await lateLink(n.id, 'kry@mo-care.com'), r = await lpage({ ...L, action: 'view' })
ck('late.html for Krystal: "Mary said on your 4:31pm call: ...", her words, "from your call", the missed clock-in paused until 4:44pm',
  r.s === 200 && r.j.call.line === "Mary said on your 4:31pm call: running late, about 8 minutes (around 4:39pm)." && r.j.call.quote === "I'm running late, I'll be to April's in 8 minutes"
  && r.j.eta_by === 'from your call' && r.j.source === 'call' && r.j.call.missed_clockin_paused_until === '4:44pm' && r.j.practice === false, r.j)
ck('late.html: 9 minutes late, so the family can\'t be told (her 10-minute rule), and it says why', r.j.family.can === false && /under 10 minutes late/.test(r.j.family.why), r.j.family)
r = await lpage({ ...(await lateLink(n.id, 'sam@mo-care.com')), action: 'view' })
ck('late.html for Samantha: "on Krystal\'s 4:31pm call", "from Krystal\'s call"', r.j.call.line.startsWith("Mary said on Krystal's 4:31pm call:") && r.j.eta_by === "from Krystal's call", r.j)
at('16:40'); await tick(); at('16:43'); await tick()
ck('4:40 and 4:43: still held, nothing sent', SENT.length === 0 && !lad(), SENT)
at('16:44'); j = await tick()
ck('4:44 (ETA 4:39 + 5, still no clock-in): the alert opens; Mary gets the usual short text; both admins get the first text WITH the call',
  toCg().length === 1 && toSam().length === 1 && toKry().length === 1
  && /^No clock-in: Mary Smith for April's 4:30pm shift \(14 min past start\)\. Mary said on Krystal's 4:31pm call: running late, about 8 minutes \(around 4:39pm\)\. Tap Resolved to stop these texts: https:\/\/cc\.mo-care\.com\/clockin\.html\?/.test(toSam()[0].msg), SENT)
ck('those texts count toward the cap of 6 (1 each so far)', Object.values(lad().admin_loop.texts_to || {}).every((x) => x === 1) && Object.keys(lad().admin_loop.texts_to || {}).length === 2, lad().admin_loop)
at('16:46'); j = await lw()
let tkItem = APP.ops_items.find((i) => i.id === `ops_tk_${lad().id}`)
ck('the missed clock-in card in Needs Attention carries the call, and that the texts started again', tkItem && tkItem.status === 'open'
  && tkItem.late_call_note === "Mary said on Krystal's 4:31pm call: running late, about 8 minutes (around 4:39pm). \"I'm running late, I'll be to April's in 8 minutes\" The missed clock-in texts were paused until 4:44pm; still no clock-in, so they started again."
  && tkItem.late_notice_id === n.id && j.missed_clockin_notes === 1, tkItem)
const CL = linkOf(toSam()[0].msg); r = await cpage({ ...CL, action: 'view' })
ck('clockin.html for Samantha: the call, "on Krystal\'s 4:31pm call", the texts were paused until 4:44pm; the family can\'t be told (under 10)',
  r.s === 200 && r.j.late_call.line === "Mary said on Krystal's 4:31pm call: running late, about 8 minutes (around 4:39pm)." && r.j.late_call.resumed_after === '4:44pm' && !r.j.late_call.paused_until
  && r.j.late_call.family_ok === false && /under 10 minutes/.test(r.j.late_call.family_why) && r.j.late_call.kind === 'late', r.j.late_call)
r = await cpage({ ...linkOf(toKry()[0].msg), action: 'view' })
ck('clockin.html for Krystal: "Mary said on your 4:31pm call: running late, about 8 minutes (around 4:39pm)."', r.j.late_call.line === "Mary said on your 4:31pm call: running late, about 8 minutes (around 4:39pm).", r.j.late_call)
at('16:50'); await tick()
ck('4:50: the next reminder does not repeat the call', toSam().length === 2 && /^Still no clock-in: Mary Smith for April's 4:30pm shift \(20 min past start\)\. Tap Resolved/.test(toSam()[1].msg), toSam())
VISITS[0].clockIn = { time: '2026-10-02T16:52:00' }; at('16:53'); await tick(); await lw()
ck('she clocks in: the alert stops ("clocked in at 4:52pm"), the notice closes', /^Mary Smith clocked in at 4:52pm/.test(toSam().at(-1).msg) && notice().status === 'closed' && notice().closed_how === 'clocked_in', [toSam().at(-1), notice()])
ck('the client and the family were never texted', toClient().length === 0 && toFam().length === 0, SENT)

/* ════ 2 · the call comes while the alert is already texting: it pauses, then carries on (and counts) ════ */
reset(); at('16:35'); await tick()
ck('4:35: no call yet: the missed clock-in alert texts both admins', toSam().length === 1 && toKry().length === 1, SENT)
call('call2', '16:38', { words: ["Mary, it's Krystal, are you on your way to April's?", "Yes, I'm running late, I'll be there in 15 minutes, traffic is bad."] })
NEXT = { kind: 'late', eta: T_('16:53'), quote: "I'm running late, I'll be there in 15 minutes" }
at('16:40'); await lw(); n = notice()
ck('the call is read: late, about 4:53pm', n && n.status === 'open' && hhmm(Date.parse(n.eta)) === '16:53', n)
tkItem = APP.ops_items.find((i) => i.id === `ops_tk_${lad().id}`)
ck('the missed clock-in card says the texts are paused until 4:58pm', /The missed clock-in texts to the admins are paused until 4:58pm and start again then if there's still no clock-in\.$/.test(tkItem?.late_call_note || ''), tkItem)
const before2 = toSam().length
for (const hm of ['16:40', '16:45', '16:50', '16:55']) { at(hm); await tick() }
ck('4:40 to 4:55: paused, no admin text (and Mary gets nothing more)', toSam().length === before2 && toKry().length === before2 && toCg().length === 1, SENT)
ck('the pause is recorded on the alert (until 4:58pm)', lad().admin_loop.late_hold && hhmm(Date.parse(lad().admin_loop.late_hold.until)) === '16:58', lad().admin_loop)
r = await cpage({ ...linkOf(toSam()[0].msg), action: 'view' })
ck('clockin.html during the pause: "paused until 4:58pm"; 23 min late with a time, so "Tell the family" is offered as a link to Samantha\'s own running-late page',
  r.j.late_call.paused_until === '4:58pm' && r.j.late_call.family_ok === true && /^https:\/\/cc\.mo-care\.com\/late\.html\?c=ln_\d+&a=[0-9a-f]{16}&e=\d+&t=/.test(r.j.late_call.late_link || ''), r.j.late_call)
const FL = lateLinkOf(r.j.late_call.late_link); r = await lpage({ ...FL, action: 'view' })
ck('late.html: the exact text and who gets it, BEFORE anything is sent: Linda only (agreed to texts); not Tom (stopped), Sue (no consent), Wes (no change texts)',
  r.j.family.can === true && r.j.family.members === 1 && r.j.family.first_names.join() === 'Linda' && r.j.family.hours_ok === true
  && r.j.family.draft === "A quick update from Caring Companions. Mary is running a little late for April's 4:30pm visit today and expects to arrive around 4:53pm. We're sorry for the wait. Questions? Call us at (417) 234-8494.", r.j.family)
ck('nothing was sent by opening either page', toFam().length === 0, SENT)
r = await lpage({ ...FL, action: 'family', text: r.j.family.draft })
ck('Samantha taps "Send to the family": Linda only, "Hi Linda, ..."; never the client', r.j.ok && r.j.count === 1 && toFam().length === 1 && toFam()[0].to === '4175550200'
  && /^Hi Linda, A quick update from Caring Companions\. Mary is running a little late for April's 4:30pm visit/.test(toFam()[0].msg) && toClient().length === 0, [r.j, toFam()])
at('17:00'); await tick()
ck('5:00 (after 4:58, no clock-in): the texts start again, with the call once; they count toward the cap (2 each)', toSam().length === before2 + 1
  && /Mary said on Krystal's 4:38pm call: running late, about 15 minutes \(around 4:53pm\)\./.test(toSam().at(-1).msg) && Object.values(lad().admin_loop.texts_to).every((x) => x === 2), [toSam().at(-1), lad().admin_loop.texts_to])
at('17:05'); await tick(); ck('5:05: the call is not repeated', toSam().length === before2 + 2 && !/4:38pm call/.test(toSam().at(-1).msg), toSam().at(-1))

/* ════ 3 · the family hours: 9:10pm, the send is refused and the page says why ════ */
reset(); VISITS[0].scheduledStartDate = '2026-10-02T20:30:00'; VISITS[0].scheduledEndDate = '2026-10-02T23:30:00'
call('call3', '20:40', { words: ["I'm so sorry, running late, I'll be at April's at 9:15."] }); NEXT = { kind: 'late', eta: T_('21:15'), quote: "running late, I'll be at April's at 9:15" }
at('21:10'); await lw(); n = notice(); L = await lateLink(n.id, 'sam@mo-care.com'); r = await lpage({ ...L, action: 'view' })
ck('9:10pm: the page shows the text but says family texts go 6am to 9pm (no button to send)', r.j.family.can === true && r.j.family.hours_ok === false, r.j.family)
r = await lpage({ ...L, action: 'family', text: 'A quick update.' })
ck('...and a forced send is refused by the texting door', r.s === 409 && toFam().length === 0, r)

/* ════ 4 · no time given: never guess, no pause, no family ════ */
reset(); call('call4', '16:31', { words: ["Mary? It's Krystal.", "I'm running late, I'm not sure how long, the car won't start."] }); NEXT = { kind: 'late', eta: null, quote: "I'm running late, I'm not sure how long" }
at('16:33'); await lw(); n = notice()
ck('no time: the notice has no arrival time', n && n.kind === 'late' && !n.eta && n.status === 'open', n)
at('16:35'); await tick()
ck('no time: the missed clock-in is NOT paused (admins texted at 5 minutes, with what the call said)', toSam().length === 1 && /Mary said on Krystal's 4:31pm call: running late \(no arrival time given\)\./.test(toSam()[0].msg), toSam())
r = await lpage({ ...(await lateLink(n.id, 'kry@mo-care.com')), action: 'view' })
ck('no time: no family button, and it says "no arrival time yet"', r.j.family.can === false && /no arrival time yet/.test(r.j.family.why), r.j.family)

/* ════ 5 · "can't make it": the coverage button is offered, nothing opens by itself ════ */
reset(); call('call5', '16:20', { dir: 'in', user: null, words: ["Hi it's Mary, I can't make it to April's today, my son is sick."] }); NEXT = { kind: 'cant_make_it', eta: null, quote: "I can't make it to April's today" }
at('16:22'); await lw(); n = notice()
ck("Mary calls IN: can't make it, recorded as an inbound call with no office name known", n && n.kind === 'cant_make_it' && n.call_direction === 'in' && !n.call_by, n)
at('16:35'); await tick()
ck("can't make it: the missed clock-in alert still rings the admins (someone must cover), with the call in it", toSam().length === 1 && /Mary said on the 4:20pm call: can't make it to April's 4:30pm shift\./.test(toSam()[0].msg), toSam())
ck('...and NO coverage case was opened by itself', APP.coverage_cases.length === 0, APP.coverage_cases)
r = await cpage({ ...linkOf(toSam()[0].msg), action: 'view' })
ck("clockin.html: the call says can't make it, so the page offers Open coverage case (the button is the person's)", r.j.late_call.kind === 'cant_make_it' && r.j.open === true && r.j.late_call.family_ok === false, r.j.late_call)
r = await cpage({ ...linkOf(toSam()[0].msg), action: 'coverage', note: 'Said on the call' })
ck('one tap: the coverage case opens for that visit (the existing call-in flow)', r.j.ok && APP.coverage_cases.length === 1 && APP.coverage_cases[0].axiscare_visit_id === '9001' && APP.coverage_cases[0].calling_off === 'Mary Smith', [r.j, APP.coverage_cases])

/* ════ 6 · no transcript yet: tried again; never one: the run says so ════ */
reset(); call('call6', '16:31'); NEXT = { kind: 'late', eta: T_('16:45'), quote: "I'll be there by 4:45" }
at('16:33'); j = await lw()
ck('no transcript yet: nothing read, nothing recorded, "waiting"', AI.length === 0 && !notice() && j.calls_waiting_transcript === 1, j)
TRANSCRIPTS.call6 = ["Running behind, I'll be there by 4:45."]; NEXT.quote = "I'll be there by 4:45"; at('16:38'); j = await lw()
ck('the transcript arrives: read on the next run', AI.length === 1 && notice() && hhmm(Date.parse(notice().eta)) === '16:45', [j, notice()])
reset(); call('c7', '16:31'); call('c8', '16:36'); at('17:10'); j = await lw()
ck('two answered calls, still no transcript 30+ minutes later: left unread, and the run says call transcription may be off in GoHighLevel',
  AI.length === 0 && j.calls_no_transcript === 2 && /Call transcription may be off in GoHighLevel/.test(j.transcripts), j)
ck('...and a card says so in Needs Attention (NO SILENT FAILURES)', APP.ops_items.some((i) => i.id === 'ops_late_transcripts_2026-10-02' && /Call transcripts are not coming from GoHighLevel/.test(i.title)), APP.ops_items)
const tr0 = CALLS.filter((c) => /transcription/.test(c.url)).length; at('17:15'); await lw()
ck('...and those calls are not asked for again', CALLS.filter((c) => /transcription/.test(c.url)).length === tr0, CALLS.filter((c) => /transcription/.test(c.url)).length - tr0)
reset(); call('c9', '16:31', { dir: 'in', secs: 0 }); at('17:10'); j = await lw()
ck('a missed call (no talk time) never counts as a missing transcript', j.calls_no_transcript === 0 && !j.transcripts, j)
reset(); call('c10', '16:31', { secs: 0, words: ['ring ring'] }); at('16:35'); j = await lw()
ck('an unanswered call the office made is not read at all', AI.length === 0 && !CALLS.some((c) => /c10\/transcription/.test(c.url)), CALLS)

/* ════ 7 · who it is: by her phone number only, never a name ════ */
reset(); CONTACTS = [{ id: 'gOther', firstName: 'Mary', lastName: 'Smith', phone: '+14175559999' }]; call('call7', '16:31', { words: MARY_8, contact: 'gOther' }); NEXT = { kind: 'late', eta: T_('16:39'), quote: "I'm running late" }
at('16:33'); j = await lw()
ck('a GoHighLevel contact with HER NAME but another number: refused (nothing read, no notice)', AI.length === 0 && !notice() && j.not_in_ghl === 1, j)
reset(); APP.caregivers[0].phone = ''; call('call8', '16:31', { words: MARY_8 }); NEXT = { kind: 'late', eta: T_('16:39'), quote: "I'm running late" }
at('16:33'); j = await lw()
ck('no phone for her on the roster: nothing matched by name', AI.length === 0 && !notice() && j.no_phone === 1, j)

/* ════ 8 · her switch: calls off = practice (listed, nothing paused) ════ */
reset({ late_call_live: false }); call('call9', '16:31', { words: MARY_8 }); NEXT = { kind: 'late', eta: T_('16:39'), quote: "I'm running late, I'll be to April's in 8 minutes" }
at('16:33'); await lw(); at('16:35'); await tick()
ck('late_call_live off: the notice is practice, no card, and the admins are texted at 5 minutes as before', notice()?.status === 'practice' && !APP.ops_items.some((i) => i.kind === 'late_notice') && toSam().length === 1, [notice(), toSam()])
r = await lpage({ ...(await lateLink(notice().id, 'sam@mo-care.com')), action: 'family', text: 'x' })
ck('...and the family send is refused (practice)', r.s === 409 && toFam().length === 0, r)

/* ════ 9 · the AI may not put words in her mouth ════ */
reset(); call('call10', '16:31', { words: MARY_8 }); NEXT = { kind: 'late', eta: T_('16:39'), quote: 'I am so sorry, I overslept and will be 8 minutes late' }
at('16:33'); await lw()
ck('a "quote" that is not in the transcript is dropped (the line still shows; no made-up words)', notice() && notice().call_quote === null, notice())

/* ════ 10 · the rules, directly ════ */
const S = T_('16:30'), base = { visit_id: 'x', status: 'open', kind: 'late', call_at: iso(T_('16:31')), eta: iso(T_('16:39')) }
const opts = HOLD.holdOptsOf({})
ck('rule: notices in practice + a call with a time: hold until ETA + 5', HOLD.lateHold(base, S, T_('16:43'), opts) === 'hold' && HOLD.lateHold(base, S, T_('16:44'), opts) === 'none')
ck('rule: a call with no time, or can\'t make it, never holds while the notices are in practice', HOLD.lateHold({ ...base, eta: null }, S, T_('16:35'), opts) === 'none' && HOLD.lateHold({ ...base, kind: 'cant_make_it', eta: null }, S, T_('16:35'), opts) === 'none')
ck('rule: a TEXT notice never holds while the notices are in practice', HOLD.lateHold({ ...base, call_at: null }, S, T_('16:35'), opts) === 'none')
ck('rule: a call\'s pause never runs past 2 hours after the start (a misheard "9pm" can\'t silence the alert all evening)', HOLD.lateHold({ ...base, eta: iso(T_('21:00')) }, S, T_('18:29'), opts) === 'hold' && HOLD.lateHold({ ...base, eta: iso(T_('21:00')) }, S, T_('18:30'), opts) === 'none')
ck('rule: late_call_live off: no call hold', HOLD.lateHold(base, S, T_('16:35'), HOLD.holdOptsOf({ late_call_live: false })) === 'none')
ck('rule: with the notices live, the L1 rule is unchanged (no time holds to start + 20; can\'t make it skips)', HOLD.lateHold({ ...base, call_at: null, eta: null }, S, T_('16:49'), HOLD.holdOptsOf({ late_watch_live: true })) === 'hold'
  && HOLD.lateHold({ ...base, kind: 'cant_make_it' }, S, T_('16:35'), HOLD.holdOptsOf({ late_watch_live: true })) === 'skip')
const src = (f) => fs.readFileSync(`${FN}/${f}`, 'utf8')
ck('no automatic family text anywhere: late-watch never sends to a family; the family send is only late-alert behind a person (humanInitiated)',
  !/late_family_auto/.test(src('late-watch/index.ts') + src('late-alert/index.ts') + src('_shared/late-notice.ts') + src('timekeeper-watch/index.ts'))
  && !/audience: 'family'/.test(src('late-watch/index.ts')) && /audience: 'family', humanInitiated: true/.test(src('late-alert/index.ts')))
ck('no em dashes in any new wording', ![HOLD.callLine(base), HOLD.callLine({ ...base, kind: 'cant_make_it', client_first: 'April', shift_start: iso(S) }), ...SENT.map((x) => x.msg)].some((t) => /\u2014/.test(t))
  && !/\u2014/.test(src('_shared/late-notice.ts')) && !/\u2014/.test(fs.readFileSync('call_late_432.sql', 'utf8')))

for (const [nm, ok, note] of res) console.log((ok ? 'PASS' : 'FAIL') + ' · ' + nm + (ok ? '' : '\n       ' + note))
const pass = res.filter((x) => x[1]).length; console.log(`${pass}/${res.length}`); process.exit(pass === res.length ? 0 : 1)
