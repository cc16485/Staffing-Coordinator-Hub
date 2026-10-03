// C1 · missed clock-ins: the short caregiver text at 5 minutes (no EVV form), every admin texted every 5 minutes
// until someone resolves it on the link page, and how it stops. The REAL timekeeper-watch and clockin-alert against a
// fake AxisCare, a fake database, fake GoHighLevel and a controllable clock. node c1_missed_clockin_test.mjs
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
let APP, T, SENT, VISITS, CLIENTS, READHOOK
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
  if (url.includes('axiscare.com/api/visits?')) return new Response(JSON.stringify({ results: { visits: JSON.parse(JSON.stringify(VISITS)), nextPage: null } }), { status: 200 })
  const vm = url.match(/axiscare\.com\/api\/visits\/(\d+)/); if (vm) return new Response(JSON.stringify({ results: VISITS.find((v) => String(v.id) === vm[1]) }), { status: 200 })
  if (url.includes('axiscare.com/api/clients?')) return new Response(JSON.stringify({ results: { clients: CLIENTS } }), { status: 200 })
  if (url.includes('/contacts/upsert')) { const id = 'C:' + (body.phone || body.email); PHONE_OF[id] = body.phone || body.email; return new Response(JSON.stringify({ contact: { id, dnd: false } }), { status: 200 }) }
  if (url.includes('/conversations/messages')) { SENT.push({ to: PHONE_OF[body.contactId] || body.contactId, type: body.type, message: body.message || '' }); return new Response('{}', { status: 200 }) }
  if (/\/contacts\/[^/]+\/tags/.test(url)) return new Response('{}', { status: 200 })
  return new Response('{}', { status: 200 }) }
const SVC = 'svc_' + 'k'.repeat(60), JOBSEC = 'j'.repeat(64)
const ENV = { HUB_JOB_SECRET: JOBSEC, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' }
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

/* ── 1 · practice mode (C1 as installed): caregiver text at 5 min, admins recorded, not texted ── */
reset(); at('09:04'); await tick()
ck('C1 · at 4 minutes nothing goes out', SENT.length === 0 && !lad(), SENT)
at('09:05'); let r = await tick()
ck('C1 · at 5 minutes the caregiver gets ONE short text', toCg().length === 1, SENT)
const cgMsg = toCg()[0]?.message || ''
ck('C1 · the caregiver text: short, the time, the client, clock in now; no EVV form, no manual changes, no "if something\'s come up"',
   /^Hi Maria, this is Caring Companions\. We don't see a clock-in yet for your 9am shift with Ruth\. Please clock in now in the AxisCare app\.$/.test(cgMsg)
   && !/evv|correction|manual|come up/i.test(cgMsg), cgMsg)
ck('C1 · practice: no admin text is sent', toSam().length === 0 && toKry().length === 0, SENT)
ck('C1 · practice: the admin texts that WOULD have gone are recorded on the alert (2 admins, "first")', lad()?.admin_loop?.sends?.[0]?.stage === 'first' && lad().admin_loop.sends[0].admins === 2 && lad().admin_loop.sends[0].practice === true, lad()?.admin_loop)
ck('C1 · the NO CLOCK-IN item opens in Needs Attention at 5 minutes', APP.ops_items.some((i) => i.id === `ops_tk_${lad().id}` && i.status === 'open'), APP.ops_items)
at('09:07'); await tick(); ck('C1 · the caregiver is never texted twice', toCg().length === 1, SENT)

/* ── 2 · live: first text, repeats every 5, the 30-minute wording, clock-in stops it ── */
reset(); live(); at('09:05'); await tick()
ck('C1 · live: both admins get the first text at 5 minutes, each with their own link', toSam().length === 1 && toKry().length === 1
   && /^No clock-in: Maria Lopez for Ruth's 9am shift \(5 min past start\)\. Tap Resolved to stop these texts: https:\/\/cc\.mo-care\.com\/clockin\.html\?/.test(toSam()[0].message)
   && linkOf(toSam()[0].message)?.a !== linkOf(toKry()[0].message)?.a, SENT)
at('09:07'); await tick(); ck('C1 · 2 minutes later: no repeat yet', toSam().length === 1, toSam())
at('09:10'); await tick(); ck('C1 · 5 minutes later: "Still no clock-in ... Tap Resolved to stop these texts"', toSam().length === 2 && /^Still no clock-in: Maria Lopez for Ruth's 9am shift \(10 min past start\)\. Tap Resolved to stop these texts: https/.test(toSam()[1].message), toSam())
at('09:15'); await tick(); at('09:20'); await tick(); at('09:25'); await tick(); at('09:30'); await tick()
ck('C1 · at 30 minutes the text says the client may be without care (and, as the 6th text, that it is the last)', /^30 min and still not resolved: no clock-in from Maria Lopez for Ruth's 9am shift\. Ruth may be without care\. This is the last text about it \(it stays open in Needs Attention\)\. Tap Resolved when it's handled: https/.test(toSam().at(-1).message), toSam().at(-1))
VISITS[0].clockIn = { time: '2026-09-30T09:32:00', method: 'Mobile' }; at('09:33'); const before = toSam().length; await tick()
ck('C1 · she clocks in: every admin gets one last text and it stops', toSam().length === before + 1 && /^Maria Lopez clocked in at 9:32am \(32 min late\) for Ruth's 9am shift\. No more reminders\.$/.test(toSam().at(-1).message) && toKry().at(-1).message === toSam().at(-1).message, toSam().at(-1))
at('09:40'); await tick(); ck('C1 · nothing more after the clock-in', toSam().length === before + 1, toSam().length)
ck('C1 · the Needs Attention item closed itself', APP.ops_items.find((i) => i.id === `ops_tk_${lad().id}`)?.status === 'resolved')

/* ── 3 · the link page ── */
reset(); live(); at('09:05'); await tick()
const L = linkOf(toSam()[0].message), LK = linkOf(toKry()[0].message)
let p = await page({ ...L, t: L.t.slice(0, -1) + (L.t.endsWith('A') ? 'B' : 'A'), action: 'view' }); ck('page · a forged link is refused', p.s === 401, p)
p = await page({ ...L, e: L.e + 60, action: 'view' }); ck('page · a link with its expiry changed is refused', p.s === 401, p)
p = await page({ ...L, a: LK.a, action: 'view' }); ck('page · one admin\'s code with another admin\'s seal is refused', p.s === 401, p)
p = await page({ action: 'view' }); ck('page · no link at all is refused', p.s === 401, p)
{ const g = await CA(new Request('https://x/functions/v1/clockin-alert?' + new URLSearchParams(L), { method: 'GET' })); ck('page · a plain GET (a link preview) changes nothing and is refused', g.status === 405 && !lad().resolved_at) }
at('09:08'); p = await page({ ...L, action: 'view' })
ck('page · view: first names, the time, minutes past start, numbers to call', p.s === 200 && p.j.caregiver_first === 'Maria' && p.j.client_first === 'Ruth' && p.j.shift_time === '9am' && p.j.minutes_past_start === 8
   && p.j.caregiver_phone && p.j.client_phone && p.j.open === true && p.j.me === 'Samantha', p.j)
ck('page · view changed nothing', !lad().resolved_at && !lad().evv_sent_at)
p = await page({ ...L, action: 'snooze' }); ck('page · snooze: 10 minutes for Samantha only', p.s === 200 && p.j.snoozed_until, p)
at('09:10'); const s0 = toSam().length, k0 = toKry().length; await tick()
ck('C1 · a snoozed admin is skipped; the other still gets the repeat', toSam().length === s0 && toKry().length === k0 + 1, { s: toSam().length - s0, k: toKry().length - k0 })
at('09:20'); await tick(); ck('C1 · after the snooze ends she gets them again', toSam().length === s0 + 1, toSam().length - s0)
p = await page({ ...L, action: 'evv' })
const evv = toCg().at(-1)?.message || ''
ck('page · "Text Maria the EVV form": one text, the form link, signed by the client, no manual changes', p.s === 200 && p.j.evv_sent_at
   && /^Hi Maria, to change your clock-in time we need the EVV correction form, filled out and signed by Ruth: https:\/\/sc\.mo-care\.com\/evv-correction-form\.html\?t=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\. We can't make any manual changes without it\.$/.test(evv), evv)   // 427: pre-filled link, token only
p = await page({ ...L, action: 'evv' }); ck('page · a second tap does not send it again', p.j?.already_sent === true && toCg().filter((m) => /evv-correction/.test(m.message)).length === 1, p)
p = await page({ ...L, action: 'resolve', reason: 'nope' }); ck('page · resolve needs a known reason', p.s === 400, p)
const k1 = toKry().length
p = await page({ ...L, action: 'resolve', reason: 'on_the_way', note: 'called her, 5 min out' })
ck('page · resolve: stops it, records who and why, closes the Needs Attention item', p.s === 200 && lad().resolved_by === 'sam@mo-care.com' && lad().resolved_reason === 'on_the_way' && lad().resolved_note === 'called her, 5 min out'
   && APP.ops_items.find((i) => i.id === `ops_tk_${lad().id}`)?.status === 'resolved', { p, lad: lad() })
ck('page · the other admin gets one "Resolved by" text', toKry().length === k1 + 1 && /^Resolved by Samantha \(Maria, Ruth's 9am shift\): on her way\. called her, 5 min out\. No more reminders\.$/.test(toKry().at(-1).message), toKry().at(-1))
at('09:30'); const s2 = toSam().length, k2 = toKry().length; await tick()
ck('C1 · after it is resolved: silence', toSam().length === s2 && toKry().length === k2)
p = await page({ ...LK, action: 'resolve', reason: 'other' }); ck('page · a second admin resolving it just hears it is already resolved (first wins)', p.j?.already === true && lad().resolved_by === 'sam@mo-care.com', p)
APP.ops_settings.coverage_alert_admins = ['kry@mo-care.com']
p = await page({ ...L, action: 'view' }); ck('page · an admin taken off the list is refused', p.s === 403, p)

/* ── 4 · coverage ── */
reset(); live(); at('09:05'); await tick(); const L4 = linkOf(toSam()[0].message)
at('09:09'); p = await page({ ...L4, action: 'coverage', note: 'sick' })
const cc = APP.coverage_cases[0]
ck('page · "calling off": opens a coverage case for the shift with who called off, and resolves', p.s === 200 && cc && cc.status === 'open' && cc.axiscare_visit_id === '9001' && cc.calling_off === 'Maria Lopez'
   && cc.calling_off_id === '501' && cc.shift_time === '09:00-13:00' && cc.client === 'Ruth Adams' && cc.reason === 'call_off' && lad().resolved_how === 'coverage_case', { cc, lad: lad() })
reset(); live(); at('09:05'); await tick()
APP.coverage_cases.push({ id: 'cov1', status: 'open', axiscare_visit_id: '9001' }); at('09:10'); const s4 = toSam().length; await tick()
ck('C1 · a coverage case opened elsewhere: one last text, then it stops', toSam().length === s4 + 1 && /^Coverage case opened for Ruth's 9am shift \(Maria Lopez\)\. No more reminders\.$/.test(toSam().at(-1).message) && lad().resolved_how === 'coverage_case', toSam().at(-1))
reset(); live(); APP.coverage_cases.push({ id: 'cov2', status: 'open', client_axiscare_id: '701', shift_date: '2026-09-30', calling_off_id: '501' }); at('09:05'); await tick()
ck('C1 · she already called off (coverage case exists): no clock-in text, no admin alarm', SENT.length === 0 && !lad(), SENT)

/* ── 5 · after the shift's end: every 30 minutes; and it survives midnight ── */
reset(); live(); at('12:50'); VISITS[0].scheduledStartDate = '2026-09-30T12:45:00'; VISITS[0].scheduledEndDate = '2026-09-30T13:00:00'; await tick()
at('13:05'); await tick(); const a5 = toSam().length
ck('C1 · after the shift ends the text says so', /^Ruth's 12:45pm shift has ended and the missed clock-in for Maria Lopez is still not resolved\. Tap Resolved to stop these texts: https/.test(toSam().at(-1).message), toSam().at(-1))
at('13:15'); await tick(); ck('C1 · after the end it slows down (no text 10 minutes later)', toSam().length === a5, toSam().length)
at('13:36'); await tick(); ck('C1 · ... and repeats every 30 minutes', toSam().length === a5 + 1, toSam().length)
VISITS = []; at('00:10', '2026-10-01'); await tick()
ck('C1 · at midnight an unresolved alert is not dropped (it keeps reminding until someone resolves it)', !lad().resolved_at, lad())

/* ── 6 · a resolution made while a run is going is never overwritten ── */
reset(); live(); at('09:05'); await tick(); at('09:10')
tkReads = 0; READHOOK = (n) => { if (n === 1) { const l = APP.timekeeper_cases[0]; Object.assign(l, { resolved_at: 'x', resolved_by: 'sam@mo-care.com', resolved_how: 'admin', resolved_reason: 'on_the_way' }) } }
const s6 = toSam().length; await tick(); READHOOK = null
ck('C1 · resolved on the page mid-run: no reminder goes, and the resolution stays', toSam().length === s6 && lad().resolved_by === 'sam@mo-care.com' && lad().resolved_how === 'admin', { sent: toSam().length - s6, lad: lad() })

/* ── 6b · C3: her reply to the clock-in text reaches the admins ── */
const reply = async (body, tok = 'r'.repeat(40)) => { const r = await CR(new Request('https://x/functions/v1/clockin-reply?token=' + tok, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })); return { s: r.status, j: await r.json().catch(() => null) } }
reset(); live(); at('09:05'); await tick()
let rr = await reply({ id: 'C1', phone: '4175550111', name: 'Maria', message: 'x' }, 'wrong'.repeat(8)); ck('C3 · a wrong link code is refused', rr.s === 401, rr)
at('09:06'); rr = await reply('{"id":"C1","phone":"(417) 555-0111","name":"Maria","message":"stuck in traffic, "10 min" out"}')
ck('C3 · her reply (even with raw quotes, as GoHighLevel sends it) is attached to her open missed clock-in', rr.j?.outcome === 'attached' && lad().replies?.[0]?.text === 'stuck in traffic, "10 min" out', { rr, rep: lad().replies })
at('09:10'); const s7 = toSam().length; await tick()
ck('C3 · the next admin reminder carries it', toSam().length === s7 + 1 && /^Still no clock-in: Maria Lopez for Ruth's 9am shift \(10 min past start\)\. Maria replied: "stuck in traffic, "10 min" out"\. Tap Resolved to stop these texts: https/.test(toSam().at(-1).message), toSam().at(-1))
at('09:15'); await tick(); ck('C3 · ... once (the round after does not repeat it)', !/replied/.test(toSam().at(-1).message), toSam().at(-1))
{ const L7 = linkOf(toSam()[0].message); const pv = await page({ ...L7, action: 'view' }); ck('C3 · the link page shows what she said', pv.j?.replies?.[0]?.text === 'stuck in traffic, "10 min" out', pv.j) }
rr = await reply({ id: 'C9', phone: '4175559999', name: 'Nobody', message: 'hi' }); ck('C3 · a number not on the roster is ignored', rr.j?.outcome === 'ignored', rr)
tkReads = 0; READHOOK = (n) => { if (n === 2) { const l = APP.timekeeper_cases[0]; l.replies = [...(l.replies || []), { at: new Date(NOW).toISOString(), text: 'here now' }] } }
at('09:20'); await tick(); READHOOK = null
ck('C3 · a reply that arrives while a run is going is not lost', lad().replies.some((x) => x.text === 'here now'), lad().replies)
lad().resolved_at = 'x'; rr = await reply({ id: 'C1', phone: '4175550111', name: 'Maria', message: 'later text' }); ck('C3 · with no open missed clock-in, a later text is ignored', rr.j?.outcome === 'no open missed clock-in', rr)

/* ── 7 · source checks ── */
{ const tk = fs.readFileSync(`${FN}/timekeeper-watch/index.ts`, 'utf8')
  ck('source · the clock-out reminder keeps the EVV form (they have left)', /msgOutTmpl[\s\S]{0,400}evv-correction-form/.test(tk))
  ck('source · the old office-phone path is gone (it was never set)', !/timekeeper_alert_phones/.test(tk.replace(/^\/\/.*$/gm, '')))
  const ca = fs.readFileSync(`${FN}/clockin-alert/index.ts`, 'utf8')
  ck('source · the page never texts a client or family', !/audience: 'client'|audience: 'family'/.test(ca) && (ca.match(/conversations\/messages/g) || []).length === 1) }

for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
