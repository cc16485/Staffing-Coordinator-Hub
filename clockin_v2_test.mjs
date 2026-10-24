// CARA PHASE 3 · missed clock-in version 2 (Samantha 2026-10-24). The rules (_shared/clockin-v2.ts, late-notice.ts) and the
// REAL timekeeper-watch, clockin-reply and clockin-alert against a fake AxisCare, database, GoHighLevel, AI and clock.
// Every switch OFF = exactly as before plus a record of what each piece WOULD do; each switch ON does its one thing.
// node clockin_v2_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1200)]);
const FN = 'supabase/functions';
/* ── the clock: NOW is UTC ms; Chicago is CDT (UTC-5) on these dates ── */
let NOW = Date.parse('2026-09-30T14:00:00Z')          // 9:00am Central
const RealDate = Date
class FakeDate extends RealDate { constructor(...a) { if (!a.length) super(NOW); else super(...a) } static now() { return NOW } }
globalThis.Date = FakeDate
const at = (hm, day = '2026-09-30') => { NOW = RealDate.parse(`${day}T${hm}:00-05:00`) }
/* ── the fake world ── */
let APP, T, SENT, VISITS, CLIENTS, READHOOK, AI = []
let GHLC = [], GHL_CALLS = []   // 431: fake GoHighLevel contacts the search can find, and every call made to GHL
const reset = () => {
  APP = { ops_settings: { timekeeper_watch_live: true, timekeeper_text_live: true, coverage_alert_admins: ['sam@mo-care.com', 'kry@mo-care.com'] },
    caregivers: [{ id: 1, first: 'Maria', last: 'Lopez', phone: '4175550111', axiscare_id: '501', active: true }],
    coordinator_staff: [{ email: 'sam@mo-care.com', name: 'Samantha T', phone: '4175550901' }, { email: 'kry@mo-care.com', name: 'Krystal L', phone: '4175550902' }],
    timekeeper_cases: [], coverage_cases: [], ops_items: [], automation_log: [] }
  T = { phone_index: [], contact_optout_current: [], circle_contacts: [], op_events: [], contact_send_refusals: [] }
  SENT = []; READHOOK = null
  VISITS = [{ id: 9001, caregiver: { id: 501, firstName: 'Maria', lastName: 'Lopez' }, client: { id: 701, firstName: 'Ruth', lastName: 'Adams' },
              scheduledStartDate: '2026-09-30T09:00:00', scheduledEndDate: '2026-09-30T13:00:00', clockIn: null, clockOut: null }]
  CLIENTS = [{ id: 701, firstName: 'Ruth', lastName: 'Adams', homePhone: '4175550777' }]
}
let tkReads = 0
const q = (t) => { const st = { f: [] }; const b = {
  select() { return b; }, order() { return b; }, limit() { return b; }, contains() { return b; }, in() { return b; }, is() { return b; }, gte() { return b; }, lte() { return b; }, ilike() { return b; }, not() { return b; }, or() { return b; }, neq() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; },
  insert(row) { (T[t] ||= []).push(row); return Promise.resolve({ data: row, error: null }); },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: null })); },
  then(ok) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]
      if (k === 'timekeeper_cases') { tkReads++; if (READHOOK) READHOOK(tkReads) }
      return Promise.resolve({ data: k in APP ? [{ key: k, data: JSON.parse(JSON.stringify(APP[k])) }] : [], error: null }).then(ok) }
    let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v)
    return Promise.resolve({ data: rows, error: null }).then(ok);
  } }; return b; };
globalThis.__db = { from: q, auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) },
  rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); const it = JSON.parse(JSON.stringify(a.item)); if (i >= 0) arr[i] = it; else arr.push(it) } return { data: null, error: null } } }
const PHONE_OF = {}
globalThis.fetch = async (url, o) => { url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('leadconnectorhq.com')) GHL_CALLS.push({ method: (o && o.method) || 'GET', url })
  if (/leadconnectorhq\.com\/contacts\/\?/.test(url)) { const qq = new URL(url).searchParams.get('query') || ''
    const hit = GHLC.filter((c) => (c.phone && String(c.phone).replace(/\D/g, '').endsWith(qq)) || (c.email && c.email.toLowerCase() === qq.toLowerCase()))
    return new Response(JSON.stringify({ contacts: hit }), { status: 200 }) }
  if (url.includes('axiscare.com/api/visits?')) return new Response(JSON.stringify({ results: { visits: JSON.parse(JSON.stringify(VISITS)), nextPage: null } }), { status: 200 })
  const vm = url.match(/axiscare\.com\/api\/visits\/(\d+)/); if (vm) return new Response(JSON.stringify({ results: VISITS.find((v) => String(v.id) === vm[1]) }), { status: 200 })
  if (url.includes('axiscare.com/api/clients?')) return new Response(JSON.stringify({ results: { clients: CLIENTS } }), { status: 200 })
  if (url.includes('/contacts/upsert')) { const id = 'C:' + (body.phone || body.email); PHONE_OF[id] = body.phone || body.email; return new Response(JSON.stringify({ contact: { id, dnd: false } }), { status: 200 }) }
  if (url.includes('/conversations/messages')) { SENT.push({ to: PHONE_OF[body.contactId] || body.contactId, type: body.type, message: body.message || '' }); return new Response('{}', { status: 200 }) }
  if (url.includes('api.anthropic.com')) { const t = String(body.messages?.[0]?.content || ''); AI.push(t); const kind = /app won|i'?m here/i.test(t) ? 'here' : /not sure/i.test(t) ? 'unsure' : /can'?t come|sick/i.test(t) ? 'cant' : /late|on my way/i.test(t) ? 'late' : 'other'
    return new Response(JSON.stringify({ content: [{ text: JSON.stringify({ kind, quote: (t.split('Reply: ')[1] || '').trim() }) }] }), { status: 200 }) }
  { const gm = url.match(/leadconnectorhq\.com\/contacts\/([^/?]+)$/); if (gm && (!o || !o.method || o.method === 'GET')) { const id = decodeURIComponent(gm[1]); return new Response(JSON.stringify({ contact: { id, phone: PHONE_OF[id] || '', dnd: false } }), { status: 200 }) } }
  if (/\/contacts\/[^/]+\/tags/.test(url)) return new Response('{}', { status: 200 })
  return new Response('{}', { status: 200 }) }
const SVC = 'svc_' + 'k'.repeat(60), JOBSEC = 'j'.repeat(64)
const ENV = { ANTHROPIC_API_KEY: 'ak', HUB_JOB_SECRET: JOBSEC, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
globalThis.__dbFor = (key) => ({ from: (t) => { const bb = { select() { return bb; }, limit() { return Promise.resolve(t === 'identity_door_audit' && key !== SVC ? { data: null, error: { message: 'denied' } } : { data: [], error: null }); } }; return bb; } })
fs.writeFileSync(`${FN}/_shared/_job-auth_t.ts`, fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)'))
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_t.ts`) } catch { /* */ } })
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'../_shared/job-auth.ts'", "'../_shared/_job-auth_t.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); } return handler; };
const TK = await load('timekeeper-watch'), CA = await load('clockin-alert'), CR = await load('clockin-reply')
ENV.CLOCKIN_REPLY_TOKEN = 'r'.repeat(40)
const tick = async () => { const r = await TK(new Request('https://x/functions/v1/timekeeper-watch', { method: 'POST', headers: { Authorization: 'Bearer eyJanon', 'x-cron-secret': JOBSEC } })); return r.json() }
const page = async (body) => { const r = await CA(new Request('https://x/functions/v1/clockin-alert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json().catch(() => null) } }
const to_ = (p) => SENT.filter((m) => String(m.to).replace(/\D/g, '').endsWith(p))
const toCg = () => to_('4175550111'), toSam = () => to_('4175550901'), toKry = () => to_('4175550902')
const linkOf = (msg) => { const m = String(msg).match(/https:\/\/cc\.mo-care\.com\/clockin\.html\?c=([^&]+)&a=([0-9a-f]+)&e=(\d+)&t=([A-Za-z0-9_-]+)/); return m ? { c: decodeURIComponent(m[1]), a: m[2], e: Number(m[3]), t: m[4] } : null }
const lad = () => APP.timekeeper_cases.find((l) => l.visit_id === '9001')
const live = () => { APP.ops_settings.timekeeper_admin_loop_live = true }


const L = await import(path.resolve(FN, '_shared/clockin-v2.ts')), LN = await import(path.resolve(FN, '_shared/late-notice.ts'))
const reply = async (message) => { const r = await CR(new Request('https://x/functions/v1/clockin-reply?token=' + 'r'.repeat(40), { method: 'POST', body: JSON.stringify({ phone: '4175550111', message }) })); return r.json() }
const card = () => APP.ops_items.find((i) => i.id === 'ops_tk_' + lad()?.id)

/* ── 1 · the rules ── */
ck('rules: the second text is due at 15 minutes only with no reply, no running-late word, and once', L.secondTextDue({ texted_at: 'x' }, 15, false) && !L.secondTextDue({ texted_at: 'x' }, 14, false)
  && !L.secondTextDue({ texted_at: 'x', replies: [{}] }, 20, false) && !L.secondTextDue({ texted_at: 'x' }, 20, true) && !L.secondTextDue({ texted_at: 'x', second_texted_at: 'y' }, 20, false) && !L.secondTextDue({}, 20, false))
ck('rules: at risk from 30 minutes', L.atRisk(30) && !L.atRisk(29))
ck('her approved second text, word for word', L.fillText(L.SECOND_TEXT, { first_name: 'Maria', time: '9am', client: 'Ruth' }) === "Hi Maria, it's Caring Companions again. We still don't see a clock-in for your 9am shift with Ruth. Please clock in, or reply or call (417) 234-8494 if something's wrong.")
ck('the hand-off text: "about N minutes" only when they gave a time; their name, never a pronoun', L.handoffText(L.HANDOFF_TEXT, { first: 'Dee', late_first: 'Maria', client: 'Ruth', minutes: 20 }) === 'Hi Dee, Maria is running about 20 minutes late for Ruth. Can you stay until Maria gets there? Reply YES or NO.'
  && L.handoffText(L.HANDOFF_TEXT, { first: 'Dee', late_first: 'Maria', client: 'Ruth', minutes: null }) === 'Hi Dee, Maria is running late for Ruth. Can you stay until Maria gets there? Reply YES or NO.')
{ const ms = (s) => Date.parse(s + 'Z'), V = (id, cg, s, e, ci, co, cl = 7) => ({ id, client: { id: cl }, caregiver: { id: cg, firstName: 'C' + cg }, scheduledStartDate: s, scheduledEndDate: e, clockIn: ci ? { time: ci } : null, clockOut: co ? { time: co } : null })
  const late = V('v2', 2, '2026-10-24T13:00:00', '2026-10-24T17:00:00', null, null)
  ck('hand-off: the caregiver on shift before (ends at the late start, clocked in, not out, same client) is found', L.handoffFrom([V('v1', 1, '2026-10-24T08:00:00', '2026-10-24T13:00:00', 'x', null), late], late, ms)?.id === 'v1')
  ck('hand-off: nobody when they clocked out, another client, or a gap over 20 minutes', !L.handoffFrom([V('v1', 1, '2026-10-24T08:00:00', '2026-10-24T13:00:00', 'x', 'y'), late], late, ms)
    && !L.handoffFrom([V('v1', 1, '2026-10-24T08:00:00', '2026-10-24T13:00:00', 'x', null, 8), late], late, ms) && !L.handoffFrom([V('v1', 1, '2026-10-24T08:00:00', '2026-10-24T12:30:00', 'x', null), late], late, ms)) }
ck('after a fix: closed only when AxisCare shows what was missing', L.fixedInAxis({ missing: 'in' }, { clockIn: { time: 'x' } }) && !L.fixedInAxis({ missing: 'both' }, { clockIn: { time: 'x' } }) && L.fixedInAxis({ missing: 'both' }, { clockIn: { time: 'x' }, clockOut: { time: 'y' } }) && !L.fixedInAxis({ missing: 'in' }, { clockIn: { time: 'x' }, removed: true }))
ck('the AxisCare note draft', /^Missed clock-in\. Times confirmed by phone with Ruth on \{date\}: Maria arrived \{time in\}, left \{time out\}\. Confirmed by \{your name\}\.$/.test(L.noteDraft({ missing: 'in', caregiver: 'Maria Lopez', client_first: 'Ruth' })))
ck('a case from their own words: a call-off case whose attendance waits for a person', (() => { const c = L.cantComeCase({ visit_id: '9001', client: 'Ruth', client_axiscare_id: '701', shift_date: 'd', shift_time: '09:00', caregiver: 'Maria Lopez', caregiver_axiscare_id: '501', quote: "can't come", source: 'reply', now: 'n' })
  return c.status === 'open' && c.attendance_confirm === true && c.opened_by === 'caregiver-words' && c.calling_off === 'Maria Lopez' && /Attendance waits for a person/.test(c.note) })())
{ const n = (sure) => ({ visit_id: 'v', kind: 'cant_make_it', eta: null, status: 'open', sure })
  ck('an UNSURE "can\'t make it" keeps the missed clock-in alarm going only with the switch on; a sure one always holds it', LN.lateHold(n(false), 0, 1, { callOnly: false, callHold: true, unsureAlarm: true }) === 'none'
    && LN.lateHold(n(false), 0, 1, { callOnly: false, callHold: true, unsureAlarm: false }) === 'skip' && LN.lateHold(n(true), 0, 1, { callOnly: false, callHold: true, unsureAlarm: true }) === 'skip'
    && LN.holdOptsOf({ late_watch_live: true, late_unsure_live: true }).unsureAlarm === true && LN.holdOptsOf({ late_watch_live: true }).unsureAlarm === false) }

/* ── 2 · replies, every switch OFF: read and recorded, nothing else ── */
reset(); live(); at('09:05'); await tick(); at('09:08')
let j = await reply("I'm here but the app won't open")
ck('off: a reply is read ("here") and kept on the alert as practice; the card is unchanged; nothing opened', j.read === 'here' && lad().reply_reads?.[0]?.kind === 'here' && lad().reply_reads[0].acted === false && /would/.test(JSON.stringify(lad().reply_reads[0])) && /^NO CLOCK-IN/.test(card().title) && !lad().here_claim, [lad(), card()?.title])
j = await reply("I'm sick, can't come")
ck('off: "can\'t come" is read, but no case opens', j.read === 'cant' && !APP.coverage_cases.length)

/* ── 3 · replies, switches ON ── */
reset(); live(); Object.assign(APP.ops_settings, { clockin_here_live: true, cant_come_case_live: true }); at('09:05'); await tick(); at('09:08')
j = await reply("I'm here, the app won't let me clock in")
ck('on: "I\'m here, the app won\'t work": the card becomes "Call Ruth to confirm Maria arrived", never marked arrived', /^Call Ruth to confirm Maria arrived/.test(card().title) && /a text is never arrival/.test(card().detail) && !lad().resolved_at && lad().here_claim, card())
j = await reply("I'm not sure I can make it")
ck('on: an UNSURE reply opens no case', j.read === 'unsure' && !APP.coverage_cases.length)
j = await reply("Sorry I'm sick and can't come")
const cc = APP.coverage_cases[0]
ck('on: "can\'t come" opens a call-off case at once, from their words, attendance waiting for a person', cc && cc.id === 'cwc_9001' && cc.attendance_confirm === true && cc.calling_off === 'Maria Lopez' && /own words/.test(cc.note) && lad().cant_case === 'cwc_9001', cc)
at('09:10'); await tick()
ck('...the missed clock-in alert then stops: the case owns the shift', lad().resolved_how === 'coverage_case', lad())
j = await reply("Sorry I'm sick and can't come")
ck('...a second "can\'t come" never opens a second case', APP.coverage_cases.length === 1)

/* ── 4 · 15 minutes, no reply: the second text (off = recorded only, on = sent once) ── */
reset(); live(); at('09:05'); await tick(); at('09:15'); await tick()
ck('off at 15 minutes: no second text, the would-text is recorded on the alert', toCg().length === 1 && !!lad().second_would_at && !lad().second_texted_at, [toCg(), lad()])
reset(); live(); APP.ops_settings.clockin_no_reply_live = true; at('09:05'); await tick(); at('09:14'); await tick()
ck('on: not before 15 minutes', toCg().length === 1)
at('09:15'); await tick()
ck('on at 15 minutes: ONE second text in her words', toCg().length === 2 && /^Hi Maria, it's Caring Companions again\. We still don't see a clock-in for your 9am shift with Ruth\./.test(toCg()[1].message) && !!lad().second_texted_at, toCg())
at('09:20'); await tick()
ck('...and the office text says "No clock-in, no reply"; never a third caregiver text', toCg().length === 2 && toSam().some((m) => /^No clock-in, no reply: Maria Lopez for Ruth's 9am shift/.test(m.message)), toSam().map((m) => m.message))
reset(); live(); APP.ops_settings.clockin_no_reply_live = true; at('09:05'); await tick(); at('09:08'); await reply("on my way, 10 min"); at('09:16'); await tick()
ck('on, but they replied: no second text', toCg().length === 1)

/* ── 5 · 30 minutes: at risk; a client who can't be left alone: urgent from the first alert, any hour ── */
reset(); live(); at('09:05'); await tick(); at('09:30'); await tick()
ck('off at 30 minutes: the card is unchanged, "would" recorded', !/^At risk/.test(card().title) && !!lad().at_risk_would_at)
reset(); live(); APP.ops_settings.clockin_at_risk_live = true; at('09:05'); await tick(); at('09:30'); await tick()
ck('on at 30 minutes: "At risk: Ruth may be without care ... call Ruth or open coverage", urgent', /^At risk: Ruth may be without care \(Maria, 9am\): call Ruth or open coverage/.test(card().title) && card().urgency === 'urgent', card())
reset(); live(); APP.ops_settings.clockin_at_risk_live = true; T.client_callin_current = [{ axiscare_client_id: '701', coverage_need: 'must_cover' }]; at('09:05'); await tick()
ck('on, the call-in plan says Ruth can\'t be left alone: URGENT from the first alert', /^URGENT, can't be left alone\. NO CLOCK-IN/.test(card().title) && card().urgency === 'urgent' && lad().must_cover === true, card())
reset(); live(); APP.ops_settings.clockin_at_risk_live = true; APP.ops_settings.missed_clockin_after_hours = false; T.client_callin_current = [{ axiscare_client_id: '701', coverage_need: 'must_cover' }]
VISITS[0].scheduledStartDate = '2026-09-30T21:00:00'; VISITS[0].scheduledEndDate = '2026-09-30T23:00:00'; at('21:06'); await tick()
ck('...and at night, with after-hours texts off, the office is still texted for her', toSam().length >= 1 && toKry().length >= 1, SENT)
reset(); live(); APP.ops_settings.missed_clockin_after_hours = false; T.client_callin_current = [{ axiscare_client_id: '701', coverage_need: 'must_cover' }]
VISITS[0].scheduledStartDate = '2026-09-30T21:00:00'; VISITS[0].scheduledEndDate = '2026-09-30T23:00:00'; at('21:06'); await tick()
ck('...switch off: the night quiet hours hold as before', toSam().length === 0)

/* ── 6 · the late hand-off ── */
const prev = () => { VISITS.unshift({ id: 9000, caregiver: { id: 502, firstName: 'Dee', lastName: 'Day' }, client: { id: 701, firstName: 'Ruth', lastName: 'Adams' },
  scheduledStartDate: '2026-09-30T05:00:00', scheduledEndDate: '2026-09-30T09:00:00', clockIn: { time: '2026-09-30T05:00:00' }, clockOut: null })
  APP.caregivers.push({ id: 2, first: 'Dee', last: 'Day', phone: '4175550222', axiscare_id: '502', active: true }) }
reset(); live(); prev(); at('09:05'); await tick(); at('09:07')
let lk = linkOf(toSam()[0].message), p = await page({ ...lk, action: 'view' })
ck('the alert page names who is on shift before (Dee) and says the hand-off is off', p.j.phase3?.handoff?.first === 'Dee' && p.j.phase3.handoff_live === false, p.j.phase3)
p = await page({ ...lk, action: 'ask_stay' })
ck('off: "can you stay?" is refused, nothing sent', p.s === 409 && !to_('4175550222').length)
APP.ops_settings.late_handoff_live = true; p = await page({ ...lk, action: 'ask_stay' })
ck('on: one tap texts Dee her approved words (no minutes: they gave no time), recorded with who asked', p.j.ok && to_('4175550222').length === 1 && to_('4175550222')[0].message === 'Hi Dee, Maria Lopez is running late for Ruth. Can you stay until Maria Lopez gets there? Reply YES or NO.'.replace(/Maria Lopez/g, 'Maria') && lad().handoff_asked?.by, [to_('4175550222'), lad().handoff_asked])
p = await page({ ...lk, action: 'ask_stay' })
ck('...a second tap does not text again', p.s === 409 && to_('4175550222').length === 1)

/* ── 7 · after a fix ── */
const cft = (o) => ({ id: 'ops_cft_9001', kind: 'confirm_times', status: 'open', visit_id: '9001', shift_date: '2026-09-30', missing: 'in', caregiver: 'Maria Lopez', client_first: 'Ruth', title: 'Call Ruth to confirm Maria\'s arrival time', ...o })
reset(); APP.ops_items = [cft()]; VISITS[0].clockIn = { time: '2026-09-30T09:12:00' }; at('13:30'); let out = await tick()
ck('off: AxisCare shows the corrected time; the card stays open, "would close" recorded', APP.ops_items[0].status === 'open' && out.phase3.would.some((w) => /would close/.test(w.step)), out.phase3)
reset(); APP.ops_settings.cft_autoclose_live = true; APP.ops_items = [cft()]; at('13:31'); out = await tick()
ck('on: AxisCare still shows nothing: the card stays open, with the note draft ready', APP.ops_items[0].status === 'open' && /^Missed clock-in\. Times confirmed by phone with Ruth/.test(APP.ops_items[0].note_draft || ''), APP.ops_items[0])
VISITS[0].clockIn = { time: '2026-09-30T09:12:00' }; at('13:40'); out = await tick()
const c7 = APP.ops_items.find((i) => i.id === 'ops_cft_9001')
ck('on: once AxisCare shows the time, the card closes itself, saying what AxisCare shows; what was missing is kept', c7.status === 'done' && c7.missing === 'in' && c7.axiscare_times_now?.clock_in === '09:12' && /AxisCare now shows a clock-in at 9:12am/.test(c7.auto_closed_reason) && c7.history?.length === 1, c7)

/* ── 8 · nothing changed with everything off ── */
reset(); live(); at('09:05'); await tick(); at('09:15'); await tick(); at('09:30'); await tick()
ck('all switches off: the caregiver got ONE text, the office texts read as before ("Still no clock-in")', toCg().length === 1 && toSam().some((m) => /^Still no clock-in/.test(m.message) || /^\d+ min and still not resolved/.test(m.message)) && !toSam().some((m) => /no reply/.test(m.message)), toSam().map((m) => m.message))

for (const [n, o, d] of res) console.log((o ? 'PASS · ' : 'FAIL · ') + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
