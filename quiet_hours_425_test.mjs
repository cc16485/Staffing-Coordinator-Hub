// 425 · OFFICE QUIET HOURS (Samantha, 2026-10-03, after the missed clock-in admin loop texted coordinators at 3am:
// "NO TEXTS that are informational about evv to the office number or admin at this hour").   node quiet_hours_425_test.mjs
// 1) _shared/quiet-hours.ts on a fake clock: 3am, 6:59, 7:00, 7:05, 19:59, 20:00, daylight saving (both changes),
//    January, the ops_settings override, a bad override, "off".
// 2) the staff backstop in contactForOutbound: a staff text at 3am is held (no send, no "didn't go through" card),
//    the must-cover emergency still goes, a caregiver's text is not touched, an email is not touched.
// 3) the REAL timekeeper-watch and clockin-alert against a fake AxisCare, database and GoHighLevel: a 3am missed
//    clock-in opens the Needs Attention item, the caregiver still gets her own text, no admin is texted all night,
//    at 7:05 ONE text per admin (not a backlog), then normal; the 6-text cap; the stop wording; the final text only
//    to admins who were texted, never at night; resolving at night texts nobody; practice runs follow the hours;
//    the Saturday office EVV nudge never goes at night.
// 4) the REAL ops-escalate: a missed call at 2am is never texted (not at 2:20, not at 7:05), one at 7:10 is.
// 5) source scans: every internal text path checks the quiet hours.
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1400)]);
const FN = 'supabase/functions';
const RealDate = Date
let NOW = RealDate.parse('2026-10-03T08:00:00Z')
class FakeDate extends RealDate { constructor(...a) { if (!a.length) super(NOW); else super(...a) } static now() { return NOW } }
globalThis.Date = FakeDate
/* Central wall time → NOW (CDT, UTC-5, on October dates) */
const at = (hm, day = '2026-10-03', off = '-05:00') => { NOW = RealDate.parse(`${day}T${hm}:00${off}`) }

/* ════ 1 · quiet-hours.ts ════ */
const QH = await import(path.join(process.cwd(), FN, '_shared/quiet-hours.ts'))
const Q = (iso, s) => QH.officeQuiet(new RealDate(iso), s)
const cases = [
  ['2026-10-03T08:00:00Z', true, '3:00am (the night it happened)'], ['2026-10-03T11:59:00Z', true, '6:59am'],
  ['2026-10-03T12:00:00Z', false, '7:00am, the first allowed minute'], ['2026-10-03T12:05:00Z', false, '7:05am'],
  ['2026-10-04T00:59:00Z', false, '7:59pm'], ['2026-10-04T00:59:59Z', false, '7:59:59pm'], ['2026-10-04T01:00:00Z', true, '8:00pm, quiet starts'],
  ['2026-10-03T05:00:00Z', true, 'midnight (hour 0, never 24)'], ['2026-10-03T17:00:00Z', false, 'noon'],
  /* spring forward, Sun 2026-03-08: 2am CST becomes 3am CDT */
  ['2026-03-08T08:30:00Z', true, 'spring-forward night 3:30am CDT'], ['2026-03-08T11:59:00Z', true, 'spring-forward 6:59am CDT'],
  ['2026-03-08T12:00:00Z', false, 'spring-forward 7:00am CDT (12:00 UTC, not 13:00)'], ['2026-03-07T13:00:00Z', false, 'day before, 7:00am CST (13:00 UTC)'],
  ['2026-03-07T12:59:00Z', true, 'day before, 6:59am CST'],
  /* fall back, Sun 2026-11-01: 2am CDT becomes 1am CST */
  ['2026-11-01T06:30:00Z', true, 'fall-back night 1:30am CDT'], ['2026-11-01T07:30:00Z', true, 'fall-back night 1:30am CST (the repeated hour)'],
  ['2026-11-01T12:59:00Z', true, 'fall-back 6:59am CST'], ['2026-11-01T13:00:00Z', false, 'fall-back 7:00am CST (13:00 UTC, not 12:00)'],
  ['2026-11-01T12:00:00Z', true, 'fall-back 6:00am CST (12:00 UTC is still quiet)'], ['2026-11-02T01:59:00Z', false, 'fall-back 7:59pm CST'],
  ['2026-11-02T02:00:00Z', true, 'fall-back 8:00pm CST'],
  ['2026-01-15T13:00:00Z', false, 'January 7:00am CST'], ['2026-01-16T02:00:00Z', true, 'January 8:00pm CST'],
]
for (const [iso, want, label] of cases) ck(`hours · ${label}: ${want ? 'QUIET' : 'texts allowed'}`, Q(iso) === want, { iso, got: Q(iso) })
ck('hours · default words "8pm to 7am"', QH.quietWords() === '8pm to 7am' && QH.OFFICE_QUIET_START === 20 && QH.OFFICE_QUIET_END === 7)
ck('hours · ops_settings override (9pm to 6am): 8:30pm allowed, 9pm quiet, 6am allowed',
  !Q('2026-10-04T01:30:00Z', { office_quiet_start: 21, office_quiet_end: 6 }) && Q('2026-10-04T02:00:00Z', { office_quiet_start: 21, office_quiet_end: 6 })
  && !Q('2026-10-03T11:00:00Z', { office_quiet_start: 21, office_quiet_end: 6 }) && QH.quietWords({ office_quiet_start: 21, office_quiet_end: 6 }) === '9pm to 6am')
ck('hours · override as text numbers ("22", "6") works', Q('2026-10-04T03:30:00Z', { office_quiet_start: '22', office_quiet_end: '6' }) && !Q('2026-10-04T02:30:00Z', { office_quiet_start: '22', office_quiet_end: '6' }))
ck('hours · a bad override (25, "x", only one half) falls back to 8pm to 7am, never to "no quiet hours"',
  Q('2026-10-03T08:00:00Z', { office_quiet_start: 25, office_quiet_end: 7 }) && Q('2026-10-03T08:00:00Z', { office_quiet_start: 'x', office_quiet_end: 'y' })
  && Q('2026-10-03T08:00:00Z', { office_quiet_start: 21 }) && Q('2026-10-04T01:30:00Z', { office_quiet_start: 21 }))
ck('hours · the same hour for both turns quiet hours off (only she would set that)', !Q('2026-10-03T08:00:00Z', { office_quiet_start: 7, office_quiet_end: 7 }) && QH.quietWords({ office_quiet_start: 7, office_quiet_end: 7 }) === 'off')
ck('hours · a daytime window (13 to 14) works too', Q('2026-10-03T18:30:00Z', { office_quiet_start: 13, office_quiet_end: 14 }) && !Q('2026-10-03T19:00:00Z', { office_quiet_start: 13, office_quiet_end: 14 }))
ck('hours · officeQuietBetween: 7:30pm to 7:30am crosses the night; 7:05am to 7:30am does not',
  QH.officeQuietBetween(RealDate.parse('2026-10-03T00:30:00Z'), RealDate.parse('2026-10-03T12:30:00Z')) && !QH.officeQuietBetween(RealDate.parse('2026-10-03T12:05:00Z'), RealDate.parse('2026-10-03T12:30:00Z')))
{ let read = 0; const sbQ = (st) => ({ from: () => ({ select() { return this }, eq() { return this }, maybeSingle: async () => { read++; return { data: { data: st } } } }) })
  const a = await QH.officeQuietNow(sbQ({ office_quiet_start: 21, office_quiet_end: 6 }), new RealDate('2026-10-04T01:30:00Z'))
  const b = await QH.officeQuietNow({ from: () => { throw new Error('down') } }, new RealDate('2026-10-03T08:00:00Z'))
  ck('hours · officeQuietNow reads ops_settings; a failed read uses the defaults (3am still quiet)', a === false && b === true && read === 1, { a, b, read }) }

/* ════ the fake world (shared by 2, 3 and 4) ════ */
let APP, T, SENT, VISITS, CLIENTS, CALLS
const reset = () => {
  APP = { ops_settings: { timekeeper_watch_live: true, timekeeper_text_live: true, coverage_alert_admins: ['sam@mo-care.com', 'kry@mo-care.com'] },
    caregivers: [{ id: 1, first: 'Maria', last: 'Lopez', phone: '4175550111', axiscare_id: '501', active: true }],
    coordinator_staff: [{ email: 'sam@mo-care.com', name: 'Samantha T', phone: '4175550901' }, { email: 'kry@mo-care.com', name: 'Krystal L', phone: '4175550902' }],
    timekeeper_cases: [], coverage_cases: [], ops_items: [], automation_log: [], evv_chase_state: [] }
  T = { phone_index: [], contact_optout_current: [], circle_contacts: [], op_events: [], contact_send_refusals: [], evv_submissions: [] }
  SENT = []; CALLS = []
  VISITS = [{ id: 9001, caregiver: { id: 501, firstName: 'Maria', lastName: 'Lopez' }, client: { id: 701, firstName: 'Ruth', lastName: 'Adams' },
              scheduledStartDate: '2026-10-03T03:00:00', scheduledEndDate: '2026-10-03T06:00:00', clockIn: null, clockOut: null }]
  CLIENTS = [{ id: 701, firstName: 'Ruth', lastName: 'Adams', homePhone: '4175550777' }]
}
reset()
const q = (t) => { const st = { f: [] }; const b = {
  select() { return b; }, order() { return b; }, limit() { return b; }, contains() { return b; }, in() { return b; }, is() { return b; }, gte() { return b; }, lte() { return b; }, ilike() { return b; }, not() { return b; }, or() { return b; }, neq() { return b; }, lt() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; },
  insert(row) { (T[t] ||= []).push(row); return Promise.resolve({ data: row, error: null }); },
  update() { return b; }, delete() { return b; },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: null })); },
  then(ok) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]
      return Promise.resolve({ data: k in APP ? [{ key: k, data: JSON.parse(JSON.stringify(APP[k])) }] : [], error: null }).then(ok) }
    let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v)
    return Promise.resolve({ data: rows, error: null }).then(ok);
  } }; return b; };
const DB = { from: q, auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) },
  rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); const it = JSON.parse(JSON.stringify(a.item)); if (i >= 0) arr[i] = it; else arr.push(it) } return { data: null, error: null } } }
globalThis.__db = DB
const PHONE_OF = {}
globalThis.fetch = async (url, o) => { url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('axiscare.com/api/visits?')) return new Response(JSON.stringify({ results: { visits: JSON.parse(JSON.stringify(VISITS)), nextPage: null } }), { status: 200 })
  const vm = url.match(/axiscare\.com\/api\/visits\/(\d+)/); if (vm) return new Response(JSON.stringify({ results: VISITS.find((v) => String(v.id) === vm[1]) }), { status: 200 })
  if (url.includes('axiscare.com/api/clients?')) return new Response(JSON.stringify({ results: { clients: CLIENTS } }), { status: 200 })
  if (url.includes('/conversations/search')) return new Response(JSON.stringify({ conversations: [{ id: 'cv1', contactId: 'k1', fullName: 'Pat Caller' }] }), { status: 200 })
  if (/\/conversations\/cv1\/messages/.test(url)) return new Response(JSON.stringify({ messages: { messages: CALLS } }), { status: 200 })
  if (url.includes('/contacts/search/duplicate')) return new Response(JSON.stringify({ contact: null }), { status: 200 })
  if (url.includes('/contacts/upsert')) { const id = 'C:' + (body.phone || body.email); PHONE_OF[id] = body.phone || body.email; return new Response(JSON.stringify({ contact: { id, dnd: false } }), { status: 200 }) }
  if (url.includes('/conversations/messages')) { SENT.push({ to: PHONE_OF[body.contactId] || body.contactId, type: body.type, message: body.message || '', at: new RealDate(NOW).toISOString() }); return new Response('{}', { status: 200 }) }
  if (/\/contacts\/[^/]+\/tags/.test(url)) return new Response('{}', { status: 200 })
  return new Response('{}', { status: 200 }) }

/* ════ 2 · the staff backstop in contactForOutbound ════ */
{
  const O = await import(path.join(process.cwd(), FN, '_shared/outreach.ts'))
  const ghl = { token: 'g', locationId: 'loc' }
  reset(); const night = new RealDate('2026-10-03T08:00:00Z'), day = new RealDate('2026-10-03T15:00:00Z')
  const a = await O.contactForOutbound(DB, ghl, { phone: '4175550901', firstName: 'Sam' }, 'urgent_internal', { selfSupplied: true, audience: 'staff', now: night })
  ck('backstop · a staff text at 3am is held (no contact, so nothing can be sent)', a === null)
  ck('backstop · ... and it is a hold, not a failure: no "didn\'t go through" card', !(APP.ops_items || []).some((i) => i.kind === 'send_problem'), APP.ops_items)
  const b = await O.contactForOutbound(DB, ghl, { phone: '4175550901', firstName: 'Sam' }, 'urgent_internal', { selfSupplied: true, audience: 'staff', now: day })
  ck('backstop · the same staff text at 10am goes', b && b.contactId, b)
  const c = await O.contactForOutbound(DB, ghl, { phone: '4175550901', firstName: 'Sam' }, 'urgent_internal', { selfSupplied: true, audience: 'staff', emergency: true, now: night })
  ck('backstop · the "must be covered" emergency still goes at 3am', c && c.contactId, c)
  const d = await O.contactForOutbound(DB, ghl, { phone: '4175550111', firstName: 'Maria' }, 'urgent_internal', { audience: 'caregiver', channel: 'sms', sender: 't', now: night })
  ck('backstop · a caregiver\'s own shift text at 3am is NOT touched', d && d.contactId, d)
  const e = await O.contactForOutbound(DB, ghl, { email: 'sam@mo-care.com', firstName: 'Sam' }, 'urgent_internal', { selfSupplied: true, audience: 'staff', now: night })
  ck('backstop · a staff EMAIL at 3am is not held (an email wakes nobody)', e && e.contactId, e)
  APP.ops_settings.office_quiet_start = 7; APP.ops_settings.office_quiet_end = 7
  const f = await O.contactForOutbound(DB, ghl, { phone: '4175550901', firstName: 'Sam' }, 'urgent_internal', { selfSupplied: true, audience: 'staff', now: night })
  ck('backstop · reads ops_settings (quiet hours switched off there: 3am goes)', f && f.contactId, f)
}

/* ════ 3 · the real timekeeper-watch and clockin-alert ════ */
const SVC = 'svc_' + 'k'.repeat(60), JOBSEC = 'j'.repeat(64)
const ENV = { HUB_JOB_SECRET: JOBSEC, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', OPS_ESCALATE_TOKEN: 'o'.repeat(40) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
globalThis.__dbFor = (key) => ({ from: (t) => { const bb = { select() { return bb; }, limit() { return Promise.resolve(t === 'identity_door_audit' && key !== SVC ? { data: null, error: { message: 'denied' } } : { data: [], error: null }); } }; return bb; } })
fs.writeFileSync(`${FN}/_shared/_job-auth_q.ts`, fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)'))
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_q.ts`) } catch { /* */ } })
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'../_shared/job-auth.ts'", "'../_shared/_job-auth_q.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_q.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); } return handler; };
const TK = await load('timekeeper-watch'), CA = await load('clockin-alert'), OE = await load('ops-escalate')
const tick = async () => { const r = await TK(new Request('https://x/functions/v1/timekeeper-watch', { method: 'POST', headers: { Authorization: 'Bearer eyJanon', 'x-cron-secret': JOBSEC } })); return r.json() }
const page = async (body) => { const r = await CA(new Request('https://x/functions/v1/clockin-alert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json().catch(() => null) } }
const to_ = (p) => SENT.filter((m) => String(m.to).replace(/\D/g, '').endsWith(p))
const toCg = () => to_('4175550111'), toSam = () => to_('4175550901'), toKry = () => to_('4175550902'), toAdm = () => [...toSam(), ...toKry()]
const linkOf = (msg) => { const m = String(msg).match(/https:\/\/cc\.mo-care\.com\/clockin\.html\?c=([^&]+)&a=([0-9a-f]+)&e=(\d+)&t=([A-Za-z0-9_-]+)/); return m ? { c: decodeURIComponent(m[1]), a: m[2], e: Number(m[3]), t: m[4] } : null }
const lad = () => APP.timekeeper_cases.find((l) => l.visit_id === '9001')
const live = () => { APP.ops_settings.timekeeper_admin_loop_live = true }
const item = () => APP.ops_items.find((i) => i.id === `ops_tk_${lad()?.id}`)

/* A · the night it happened: a 3:00am shift, no clock-in, admin loop LIVE */
reset(); live(); at('03:05'); let r = await tick()
ck('3am · the caregiver still gets her own short clock-in text (not changed)', toCg().length === 1 && /^Hi Maria, this is Caring Companions\. We don't see a clock-in yet for your 3am shift with Ruth\./.test(toCg()[0].message), SENT)
ck('3am · NO admin is texted', toAdm().length === 0, SENT)
ck('3am · the NO CLOCK-IN item opens in Needs Attention and says why nobody was texted', item()?.status === 'open' && /quiet hours \(no office texts 8pm to 7am\), so nobody was texted; it waits here/.test(item()?.detail || ''), item())
ck('3am · the alert is marked opened in quiet hours, with no admin rounds recorded (nothing queued)', lad()?.admin_loop?.opened_in_quiet === true && (lad().admin_loop.sends || []).length === 0, lad()?.admin_loop)
ck('3am · the run says why (quiet hours, held)', r.admin_loop?.quiet_hours?.now === true && r.admin_loop.quiet_hours.hours === '8pm to 7am' && r.admin_loop.held_for_quiet_hours >= 1 && r.admin_loop.texts === 0, r.admin_loop)
for (const hm of ['03:10', '03:15', '04:00', '05:30', '06:55', '06:59']) { at(hm); await tick() }
ck('3am-6:59 · all night: still no admin text, no rounds stacked up', toAdm().length === 0 && (lad().admin_loop.sends || []).length === 0, { sent: toAdm(), sends: lad().admin_loop.sends })
VISITS = []   // after midnight the next day's list no longer has it? (same day here; the visit list is still today's)
VISITS = [{ id: 9001, caregiver: { id: 501, firstName: 'Maria', lastName: 'Lopez' }, client: { id: 701, firstName: 'Ruth', lastName: 'Adams' },
            scheduledStartDate: '2026-10-03T03:00:00', scheduledEndDate: '2026-10-03T06:00:00', clockIn: null, clockOut: null }]
at('07:05'); await tick()
ck('7:05 · still open: ONE text to each admin (not a backlog of the night\'s rounds)', toSam().length === 1 && toKry().length === 1, toAdm())
ck('7:05 · the morning text says the shift has ended, and how to stop the texts', /^Ruth's 3am shift has ended and the missed clock-in for Maria Lopez is still not resolved\. Tap Resolved to stop these texts: https:\/\/cc\.mo-care\.com\/clockin\.html\?/.test(toSam()[0]?.message), toSam()[0])
at('07:07'); await tick(); ck('7:07 · no second text 2 minutes later', toSam().length === 1)
at('07:36'); await tick(); ck('7:36 · after the shift end it carries on every 30 minutes, as normal', toSam().length === 2, toSam().length)
ck('no em dashes in any admin text', !SENT.some((m) => /—/.test(m.message)), SENT.filter((m) => /—/.test(m.message)))

/* B · it is resolved at night: nobody is texted (not now, not at 7am) */
reset(); live(); at('19:50', '2026-10-02'); VISITS[0].scheduledStartDate = '2026-10-02T19:45:00'; VISITS[0].scheduledEndDate = '2026-10-02T23:00:00'
await tick(); ck('7:50pm · before quiet hours the admins are texted as normal', toSam().length === 1 && toKry().length === 1, toAdm())
at('19:55', '2026-10-02'); await tick(); ck('7:55pm · and again 5 minutes later', toSam().length === 2)
at('20:00', '2026-10-02'); await tick(); ck('8:00pm · quiet hours start: no text', toSam().length === 2 && toKry().length === 2, toAdm())
at('21:00', '2026-10-02'); await tick(); ck('9pm · no text', toSam().length === 2)
VISITS[0].clockIn = { time: '2026-10-02T21:10:00', method: 'Mobile' }; at('21:12', '2026-10-02'); await tick()
ck('9:12pm · she clocks in: it closes, but the "clocked in" text does NOT go at night', lad().resolved_how === 'clocked_in' && toSam().length === 2 && toKry().length === 2 && item()?.status === 'resolved', { sent: toAdm(), lad: lad() })
at('07:05', '2026-10-03'); VISITS = []; await tick(); ck('7:05 next morning · nothing for a resolved alert', toSam().length === 2 && toKry().length === 2)

/* C · resolving on the link page at night texts nobody */
reset(); live(); at('19:58', '2026-10-02'); VISITS[0].scheduledStartDate = '2026-10-02T19:50:00'; VISITS[0].scheduledEndDate = '2026-10-02T23:00:00'
await tick(); const L = linkOf(toSam()[0]?.message); at('22:30', '2026-10-02')
let p = await page({ ...L, action: 'resolve', reason: 'on_the_way' })
ck('10:30pm · Samantha resolves it on her link: recorded, the item closes', p.s === 200 && lad().resolved_by === 'sam@mo-care.com' && item()?.status === 'resolved', p)
ck('10:30pm · Krystal is NOT texted "Resolved by" at night (the page says why)', toKry().length === 1 && p.j?.others_told === 0 && p.j?.others_not_texted === 'office quiet hours', { kry: toKry(), j: p.j })
reset(); live(); at('09:05', '2026-10-02'); VISITS[0].scheduledStartDate = '2026-10-02T09:00:00'; VISITS[0].scheduledEndDate = '2026-10-02T13:00:00'
await tick(); const L2 = linkOf(toSam()[0]?.message); at('09:08', '2026-10-02'); p = await page({ ...L2, action: 'resolve', reason: 'on_the_way' })
ck('daytime · the other admin still hears "Resolved by" as before', toKry().length === 2 && /^Resolved by Samantha/.test(toKry().at(-1)?.message), toKry())

/* D · the cap: at most 6 texts each, the 6th says it is the last; it stays open in Needs Attention */
reset(); live(); at('09:05', '2026-10-02'); VISITS[0].scheduledStartDate = '2026-10-02T09:00:00'; VISITS[0].scheduledEndDate = '2026-10-02T17:00:00'
for (const hm of ['09:05', '09:10', '09:15', '09:20', '09:25', '09:30', '09:35', '09:40', '10:00', '11:00']) { at(hm, '2026-10-02'); await tick() }
ck('cap · each admin got exactly 6 texts', toSam().length === 6 && toKry().length === 6, { s: toSam().length, k: toKry().length })
ck('cap · every text but the last says "Tap Resolved to stop these texts"', toSam().slice(0, 5).every((m) => /Tap Resolved to stop these texts: https/.test(m.message)), toSam().map((m) => m.message))
ck('cap · the 6th says it is the last and that it stays open in Needs Attention', /This is the last text about it \(it stays open in Needs Attention\)\. Tap Resolved when it's handled: https/.test(toSam()[5]?.message), toSam()[5])
ck('cap · it is still open (Needs Attention item open, alert not resolved) and nothing more is recorded each round', !lad().resolved_at && item()?.status === 'open' && lad().admin_loop.capped_at && lad().admin_loop.sends.length === 6, lad().admin_loop)
VISITS[0].clockIn = { time: '2026-10-02T11:10:00', method: 'Mobile' }; at('11:12', '2026-10-02'); await tick()
ck('cap · the final "clocked in" text still reaches the admins who were texted (not counted in the cap)', toSam().length === 7 && /clocked in at 11:10am/.test(toSam().at(-1)?.message), toSam().at(-1))
reset(); live(); APP.ops_settings.timekeeper_admin_max_texts = 2; at('09:05', '2026-10-02'); VISITS[0].scheduledStartDate = '2026-10-02T09:00:00'
for (const hm of ['09:05', '09:10', '09:15', '09:20']) { at(hm, '2026-10-02'); await tick() }
ck('cap · ops_settings.timekeeper_admin_max_texts (2) is followed', toSam().length === 2 && /This is the last text/.test(toSam()[1]?.message), toSam().map((m) => m.message))

/* E · a snoozed admin who was never texted gets no "final" text */
reset(); live(); APP.coordinator_staff[1].phone = ''; at('09:05', '2026-10-02'); VISITS[0].scheduledStartDate = '2026-10-02T09:00:00'; await tick()
APP.coordinator_staff[1].phone = '4175550902'; VISITS[0].clockIn = { time: '2026-10-02T09:07:00', method: 'Mobile' }; at('09:08', '2026-10-02'); await tick()
ck('final · only admins who were texted about it get "No more reminders"', toSam().length === 2 && toKry().length === 0, { s: toSam().length, k: toKry() })

/* F · practice mode follows the same hours (it records what live WOULD do) */
reset(); at('03:05'); await tick()
ck('practice 3am · nothing recorded as a would-be admin text', (lad()?.admin_loop?.sends || []).length === 0 && toAdm().length === 0, lad()?.admin_loop)
at('07:05'); await tick()
ck('practice 7:05 · one would-be round recorded (practice), nothing sent', (lad().admin_loop.sends || []).length === 1 && lad().admin_loop.sends[0].practice === true && toAdm().length === 0, lad().admin_loop.sends)

/* G · the Saturday office EVV nudge never goes at night (and goes at 3pm) */
reset(); APP.ops_settings.evv_chase_live = true; APP.ops_settings.coverage_alert_phones = ['4175550999']; T.evv_submissions = [{ id: 1, processed: false }]; VISITS = []
at('20:30', '2026-10-03'); await tick()
ck('Saturday 8:30pm · no office EVV nudge, and it is not marked done', to_('4175550999').length === 0 && !APP.evv_chase_state.some((x) => String(x.id).startsWith('satnudge_')), { sent: SENT, st: APP.evv_chase_state })
at('15:05', '2026-10-03'); await tick()
ck('Saturday 3:05pm · the office EVV nudge goes as before', to_('4175550999').length === 1, SENT)

/* ════ 4 · the real ops-escalate (missed calls) ════ */
const sweep = async () => { const r = await OE(new Request('https://x/functions/v1/ops-escalate?token=' + 'o'.repeat(40), { method: 'POST' })); return r.json() }
const missed = (id, hm, day = '2026-10-03') => ({ id, messageType: 'TYPE_CALL', direction: 'inbound', from: '+14175550333', contactId: 'k1', meta: { call: { duration: 0, status: 'no-answer' } }, dateAdded: new RealDate(RealDate.parse(`${day}T${hm}:00-05:00`)).toISOString() })
reset(); APP.ops_settings = { live: true, levels: [{ after_min: 15, to: 'owner' }, { after_min: 45, to: 'fallback' }], fallback_phone: '+14175550944' }
APP.ops_items = []; CALLS = [missed('call1', '02:00')]
at('02:20'); let o = await sweep()
ck('ops-escalate 2:20am · the missed call is in Needs Attention, nobody is texted', APP.ops_items.some((i) => i.id === 'ops_call1' && i.status === 'open') && SENT.length === 0 && o.held_for_quiet_hours >= 1 && o.office_quiet_hours === '8pm to 7am', { o, SENT })
at('07:05'); o = await sweep(); at('07:30'); await sweep()
ck('ops-escalate 7:05 and 7:30 · a step that came due overnight is never texted (no morning backlog)', SENT.length === 0, SENT)
CALLS = [missed('call1', '02:00'), missed('call2', '07:10')]
at('07:26'); o = await sweep()
ck('ops-escalate 7:26 · a call missed at 7:10 is texted at its 15 minutes, as before', SENT.length === 1 && /Missed call from Pat Caller/.test(SENT[0].message), { o, SENT })

/* ════ 5 · source scans: every internal (office, admin, coordinator) text path checks the quiet hours ════ */
const src = (f) => fs.readFileSync(`${FN}/${f}`, 'utf8')
const PATHS = [
  ['timekeeper-watch/index.ts', /const quietNow = officeQuiet\(new Date\(\), settings\)/, /if \(quietNow\) \{ quietHeld\+\+; return 0 \}/, /if \(quietNow\) \{ quietHeld\+\+; continue \}/, /chiHourE >= 15 && !forceDry && !quietNow/],
  ['clockin-alert/index.ts', /const quiet = officeQuiet\(new Date\(\), settings\)/, /loopLive && !quiet &&/],
  ['late-watch/index.ts', /const quiet = officeQuiet\(new Date\(now\), st\)/, /if \(!n\.seen_at && !quiet\)/, /final && adminLive && !quiet/],
  ['late-alert/index.ts', /if \(officeQuiet\(new Date\(\), st\)\) return 0/],
  ['coverage-run/index.ts', /const smsOk = mustA \|\| \(!officeQuiet\(new Date\(\), settings\)/, /emergency: mustA/, /soonQ && sendLive && !claimActiveQ && !quietQ/, /const smsAllowed = !officeQuiet\(new Date\(\), settings\)/],
  ['coverage-reply/index.ts', /if \(officeQuiet\(new Date\(\), settings\)\) \{ console\.log\('\[coverage-reply\] staff alert held: office quiet hours'\); return \}/],
  ['ops-escalate/index.ts', /officeQuietBetween\(Date\.parse\(it\.created_at \|\| ''\) \+ rule\.after_min \* 60000, now, cfg\)/],
  ['automation-watchdog/index.ts', /const quiet = await officeQuietNow\(supabase\)/, /if \(t\.phone && !quiet\)/],
  ['lead-intake/index.ts', /const quietStaff = await officeQuietNow\(supabase\)/, /if \(p\.phone && !quietStaff\)/],
  ['lead-followup/index.ts', /const quietStaff = await officeQuietNow\(supabase\)/, /if \(t\.phone && !quietStaff\)/, /else if \(quietStaff\)/],
  ['_shared/outreach.ts', /String\(opts\.audience \?\? ''\) === 'staff' && !opts\.emergency && await officeQuietNow\(sb, opts\.now \?\? new Date\(\)\)/],
]
for (const [f, ...res_] of PATHS) { const s = src(f); ck(`scan · ${f}: imports quiet-hours.ts and checks it at every office text`, /from '\.\.?\/(_shared\/)?quiet-hours\.ts'/.test(s) && res_.every((re) => re.test(s)), res_.filter((re) => !re.test(s)).map(String)) }
{ const s = src('interview-messages/index.ts')
  ck('scan · interview-messages: its office texts (new applicant, applicant cancelled) already only go 8am to 6pm',
    (s.match(/if \(!withinOutreachHours\(\)\) continue/g) || []).length >= 2 && /const withinOutreachHours = \(\) => \{ const h = TZ_HOUR\(\); return h >= 8 && h < 18 \}/.test(s)) }
/* every file that texts a staff member (staff-alert over sms, textAdmin, ghlStaffContact for sms, a staff contactForOutbound) is on the list above */
const KNOWN = new Set([...PATHS.map(([f]) => f.split('/')[0]), 'interview-messages', '_shared'])
const offenders = []
for (const d of fs.readdirSync(FN)) {
  const f = `${FN}/${d}/index.ts`; if (!fs.existsSync(f)) continue
  const s = fs.readFileSync(f, 'utf8')
  const texts = /'staff-alert', \{ channel: 'sms'/.test(s) || /textAdmin\(/.test(s) || /ghlStaffContact\([^)]*channel: 'sms'/.test(s) || /staffContact\(t, 'sms'\)/.test(s) || /audience: 'staff'/.test(s)
    || (/sms\(cid, msg, \{ sender: 'staff-alert'/.test(s))
  if (texts && !KNOWN.has(d)) offenders.push(d)
}
ck('scan · no other function texts the office without being on the quiet-hours list', offenders.length === 0, offenders)
ck('scan · quiet-hours.ts: 8pm to 7am Central, overridable, no em dashes', /OFFICE_QUIET_START = 20/.test(src('_shared/quiet-hours.ts')) && /OFFICE_QUIET_END = 7/.test(src('_shared/quiet-hours.ts'))
  && /office_quiet_start/.test(src('_shared/quiet-hours.ts')) && !/—/.test(src('_shared/quiet-hours.ts')))
{ const tk = src('timekeeper-watch/index.ts'); const added = tk.slice(tk.indexOf('OFFICE QUIET HOURS'), tk.indexOf('OFFICE QUIET HOURS') + 1200)
  ck('wording · the new admin texts and card words have no em dashes', !/—/.test(added) && !/—/.test(tk.slice(tk.indexOf('const stop = (last'), tk.indexOf('loopSent += await toAdmins')))) }

for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
process.exitCode = res.every((x) => x[1]) ? 0 : 1
