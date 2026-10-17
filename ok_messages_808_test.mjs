// 808 · interview-messages for Caring Companions Oklahoma applicants: video interview by a standing Zoom/Meet link, from the
// Oklahoma number, behind ops_settings.ok_applicant_auto_msgs_live. Harness from applicant_msgs_587_messages_test.mjs.
// The real function against a fake database and fake GoHighLevel; nothing real is reached. node ok_messages_808_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions';
let HOUR = '10'
const realTLS = Date.prototype.toLocaleString;
Date.prototype.toLocaleString = function (loc, o) { if (o && o.hour === '2-digit' && !o.minute) return HOUR; return realTLS.call(this, loc, o); };
const ago = (mins) => new Date(Date.now() - mins * 60_000).toISOString()
let T, SENT, TAGS = [], CARDS = []
const reset = (apps, { roles = true } = {}) => {
  SENT = []
  T = { contact_optout_current: [], circle_contacts: [], phone_index: [], interview_bookings: [], applicant_alerts: [{ name: 'Office', phone: '4175550999', active: true }],
    scheduling_settings: [{ id: 1, phone: '(417) 234-8494', location_line1: '1331 N Stewart Ave', location_name: 'Caring Companions' }],
    job_positions: roles ? [{ key: 'caregiver', track: null }, { key: 'prn_cna', track: 'prn' }] : [],
    job_applicants: apps, app_data: [{ key: 'ops_settings', data: { applicant_msgs_v2_live: V2ON, applicant_msgs_krystal_named: KNAMED, ...OPSX } }],
    coordinators: [{ id: 'co-s', name: 'Samantha Troutman' }, { id: 'co-k', name: 'Krystal Smith' }] }
  T.scheduling_settings[0].photo_url = PHOTO; T.scheduling_settings[0].note = 'Park out front, first-floor door on the left'
  TAGS = []; CARDS = []
}
let OPSX = {}; let V2ON = true, KNAMED = false, PHOTO = 'https://x/door.jpg'
const q = (t) => { const st = { f: [], isNull: [], inF: null, nn: [] }; const b = {
  select() { return b; }, order() { return b; }, limit() { return b; }, gte() { return b; }, lte() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; }, ilike(c, p) { st.like = [c, String(p).replace(/%/g, '')]; return b; }, in(c, v) { st.inF = [c, v]; return b; },
  is(c, v) { if (v === null) st.isNull.push(c); return b; }, not(c, op, v) { if (op === 'is' && v === null) st.nn.push(c); return b; },
  /* 586: updates chain (.eq / .is(col, null) / .select) like supabase-js, so a claim-before-send only wins when the stamp is still empty */
  update(obj) { const f = [], nul = []; let skip = false; const u = {
    eq(c, v) { f.push([c, v]); return u; }, is(c, v) { if (v === null) nul.push(c); return u; }, in() { skip = true; return u; }, select() { return u; },
    then(ok) { const hit = []; if (!skip) for (const r of T[t] ?? []) if (f.every(([c, v]) => r[c] === v) && nul.every((c) => r[c] == null)) { Object.assign(r, obj); hit.push({ id: r.id }); }
      return Promise.resolve({ data: hit, error: null }).then(ok); } }; return u; },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })); },
  then(ok) {
    let rows = T[t] ?? []
    for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v)
    for (const c of st.isNull) rows = rows.filter((r) => r[c] == null)
    for (const c of st.nn) rows = rows.filter((r) => r[c] != null)
    if (st.inF) rows = rows.filter((r) => st.inF[1].includes(r[st.inF[0]]))
    if (st.like) rows = rows.filter((r) => String(r[st.like[0]] ?? '').includes(st.like[1]))
    return Promise.resolve({ data: rows, error: null }).then(ok);
  } }; return b; };
let RV = {}, EL = {}, STOP = {}, STOP_ERR = false
let HOLD = new Set()
globalThis.__db = { from: q, rpc: async (fn, a) => fn === 'ok_applicant_hold' ? { data: HOLD.has(String(a.p_phone || a.p_email)), error: null } : fn === 'upsert_app_data_item' ? (CARDS.push(a.item), { data: null, error: null }) : fn === 'applicant_followup_stop'
  ? (STOP_ERR ? { data: null, error: { message: 'function does not exist' } } : { data: STOP[a.p] ?? null, error: null })
  : ({ data: fn === 'applicant_review_reason' ? (RV[a.p] || null) : fn === 'applicant_needs_review' ? !!RV[a.p] : fn === 'applicant_person_booked_elsewhere' ? (EL[a.p] ?? false) : null, error: null }) }
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, type: body.type, msg: body.message || body.html, subject: body.subject, attachments: body.attachments, from: body.fromNumber }); return new Response('{}', { status: 200 }) }
  if (url.includes('/tags')) { TAGS.push({ url, tags: body.tags }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
fs.writeFileSync(`${FN}/_shared/_job-auth_stub.ts`, "export const jobCaller = async () => 'owner'\n")
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_stub.ts`) } catch { /* */ } })
const src = fs.readFileSync(`${FN}/interview-messages/index.ts`, 'utf8')
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_stub.ts'")
const tmp = path.join(process.cwd(), FN, 'interview-messages', '_t.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const run = async (dry = false) => { const r = await handler(new Request('https://x/functions/v1/interview-messages' + (dry ? '?dry=1' : ''), { method: 'POST', body: '{}' })); return r.json() }
const A = (id, o) => ({ id, first_name: id, last_name: 'Test', phone: '41755501' + String(id.length).padStart(2, '0'), email: null, sms_consent: true,
  status: 'new', created_at: ago(15), completed_at: ago(12), position: 'prn_cna', screen_grade: 'qualified', decline_reason: null, gave_up_at: null, ...o })
const texts = (id) => SENT.filter((m) => m.type === 'SMS' && String(m.to).includes('41755501' + String(id.length).padStart(2, '0')))


const C = (id, o) => A(id, { position: 'caregiver', created_at: ago(180), completed_at: ago(170), screen_grade: 'qualified', ...o })
const soon = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
const BK = (id, o) => ({ id: 'bk-' + id, applicant_id: id, coordinator_id: 'co-s', status: 'booked', starts_at: soon(72), created_at: ago(5), confirmed_at: null, confirm_email_at: null,
  reminded_day_at: null, reminded_2day_at: null, reminded_hour_at: null,
  job_applicants: { first_name: id, last_name: 'Test', phone: '41755501' + String(id.length).padStart(2, '0'), email: id + '@example.com', sms_consent: true }, ...o })
const toThem = () => SENT.filter((m) => !String(m.to).includes('4175550999'))
const sms = (id) => texts(id).map((m) => m.msg)
const mails = () => toThem().filter((m) => m.type === 'Email')
let j

// ================= 808: Caring Companions Oklahoma interview messages =================
const LINK = 'https://us06web.zoom.us/j/1234567890?pwd=abc'
const OKON = { ok_applicant_auto_msgs_live: true, ok_from_number: '+14055001758', ok_interview_link: LINK }
const O = (id, o) => C(id, { office: 'OK', position: 'companion', ...o })
const OBK = (id, o) => BK(id, { job_applicants: { first_name: id, last_name: 'Test', phone: '41755501' + String(id.length).padStart(2, '0'), email: id + '@example.com', sms_consent: true, office: 'OK' }, ...o })
const oksms = (id) => texts(id)
/* an interview tomorrow (Central), mid-morning, whatever time the test runs */
const tomorrowAt = () => { const d = new Date(Date.now() + 86_400_000); const ymd = d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); return new Date(ymd + 'T16:00:00Z').toISOString() }
const bad = (s) => /Springfield|Stewart|mo-care\.com|417|—|Park out front|apply\?book/.test(s)

OPSX = {}; reset([O('Ok1')]); T.interview_bookings = [OBK('Ok1', { starts_at: soon(72) })]; await run()
ck('switch off: an Oklahoma interview gets nothing (held), not even a claim', toThem().length === 0 && !T.interview_bookings[0].confirmed_at, SENT)

OPSX = OKON; reset([O('Ok2')]); T.interview_bookings = [OBK('Ok2', { starts_at: soon(72) })]; await run()
const c2 = oksms('Ok2')
ck('switch on: the Oklahoma confirmation text, FROM the Oklahoma number', c2.length === 1 && c2[0].from === '+14055001758', c2)
ck('...a video interview with the interviewer, the link, the 405 number, STOP', /Your video interview with Samantha is/.test(c2[0]?.msg) && c2[0]?.msg.includes(LINK) && /\(405\) 500-1758/.test(c2[0]?.msg) && c2[0]?.msg.endsWith('Reply STOP to opt out.'), c2)
ck('...nothing Missouri in it (no Springfield, address, mo-care.com, 417, booking link), no em dash', !bad(c2[0]?.msg || ''), c2)
const m2 = mails()
ck('...and the email: Join button with the link, Oklahoma footer, nothing Missouri', m2.length === 1 && m2[0].msg.includes('Join the video interview') && m2[0].msg.includes(LINK) && /Caring Companions Oklahoma/.test(m2[0].msg) && !/Springfield|Stewart|mo-care\.com\/apply|Where to come/.test(m2[0].msg), m2)
await run(); ck('...only once', oksms('Ok2').length === 1)
reset([O('Ok3')]); T.interview_bookings = [OBK('Ok3', { starts_at: new Date(Date.parse(tomorrowAt()) + 86_400_000).toISOString(), confirmed_at: ago(60 * 30) })]; await run()
ck('2 days ahead: no 2-days note for Oklahoma', oksms('Ok3').length === 0)
// tomorrow: an interview tomorrow at (now + 24h) in Central time
reset([O('Ok4')]); T.interview_bookings = [OBK('Ok4', { starts_at: tomorrowAt(), confirmed_at: ago(60 * 30) })]; await run()
const c4 = oksms('Ok4')
ck('the day before: "see you tomorrow" with the link and YES / NO, from 405, tagged for replies', c4.length === 1 && /see you tomorrow at/.test(c4[0].msg) && c4[0].msg.includes(LINK) && /Reply YES/.test(c4[0].msg) && c4[0].from === '+14055001758' && TAGS.some((t) => (t.tags || []).includes('interview-asked')), [c4, TAGS])
reset([O('Ok5')]); T.interview_bookings = [OBK('Ok5', { starts_at: soon(1), confirmed_at: ago(600), reminded_day_at: ago(300) })]; await run()
ck('an hour before: nothing for Oklahoma (no entrance photo, no address)', oksms('Ok5').length === 0)
reset([O('Ok6')]); T.interview_bookings = [OBK('Ok6', { starts_at: tomorrowAt() })]; await run()
ck('booked for tomorrow: the confirmation also counts as the day-before notice', oksms('Ok6').length === 1 && !!T.interview_bookings[0].reminded_day_at, oksms('Ok6'))

OPSX = { ...OKON, ok_interview_link: '' }; reset([O('Ok7')]); T.interview_bookings = [OBK('Ok7', { starts_at: soon(72) })]; await run()
ck('no video link set: nothing sent, not claimed, a Needs Attention card says why', toThem().length === 0 && !T.interview_bookings[0].confirmed_at && CARDS.some((c) => /video interview link/.test(JSON.stringify(c))), [SENT, CARDS])
OPSX = { ...OKON, ok_interview_link: 'https://example.com/meet' }; reset([O('Ok7b')]); T.interview_bookings = [OBK('Ok7b', { starts_at: soon(72) })]; await run()
ck('a link that is not Zoom or Google Meet: treated as missing', toThem().length === 0)
OPSX = { ...OKON, ok_interview_link: 'https://meet.google.com/abc-defg-hij' }; reset([O('Ok7c')]); T.interview_bookings = [OBK('Ok7c', { starts_at: soon(72) })]; await run()
ck('a Google Meet link works too', oksms('Ok7c').length === 1 && oksms('Ok7c')[0].msg.includes('https://meet.google.com/abc-defg-hij'))
OPSX = { ...OKON, ok_from_number: '' }; reset([O('Ok8')]); T.interview_bookings = [OBK('Ok8', { starts_at: soon(72) })]; await run()
ck('no Oklahoma number set: nothing sent (never from 417), a card says why', toThem().length === 0 && CARDS.some((c) => /Oklahoma sending number/.test(JSON.stringify(c))), [SENT, CARDS])

// the door still holds when the database says so (another sender class, or the switch off on the server side)
OPSX = OKON; reset([O('Ok9')]); HOLD = new Set(['+14175550103']); T.interview_bookings = [OBK('Ok9', { starts_at: soon(72) })]; await run()
ck('the send door still has the last word (held there: no text)', oksms('Ok9').length === 0, SENT); HOLD = new Set()

// cancellations
OPSX = OKON; reset([O('Ok10')]); T.interview_bookings = [OBK('Ok10', { status: 'cancelled', cancelled_at: ago(10), cancelled_by: 'office', starts_at: soon(48) })]; await run()
const c10 = oksms('Ok10')
ck('cancelled: the Oklahoma notice from 405, call or text us, no booking link', c10.length === 1 && /video interview on .* is cancelled/.test(c10[0].msg) && /\(405\) 500-1758/.test(c10[0].msg) && c10[0].from === '+14055001758' && !bad(c10[0].msg), c10)
OPSX = {}; reset([O('Ok11')]); T.interview_bookings = [OBK('Ok11', { status: 'cancelled', cancelled_at: ago(10), cancelled_by: 'office', starts_at: soon(48) })]; await run()
ck('cancelled with the switch off: held, not stamped (it can go once she turns it on)', toThem().length === 0 && !T.interview_bookings[0].cancel_notified_at)

// Missouri untouched
OPSX = OKON; reset([C('Mo1', { status: 'new' })]); T.interview_bookings = [BK('Mo1', { starts_at: soon(72) })]; await run()
ck('Missouri with the Oklahoma switch on: its own words, from the office line (417) 234-8494 (887)', sms('Mo1').length === 1 && /Your interview with Samantha is/.test(sms('Mo1')[0]) && texts('Mo1')[0].from === '+14172348494', texts('Mo1'))
reset([O('Ok12', { created_at: ago(30), completed_at: ago(15) })]); STOP = { Ok12: 'Oklahoma applicant: the recruiter calls (no automatic follow-ups)' }; await run()
ck('no "pick a time" or "finish" nudges for Oklahoma (the database stop)', toThem().length === 0); STOP = {}

let pass = 0; for (const [nm, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + nm + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `${res.length - pass} OF ${res.length} FAILED`); process.exit(pass === res.length ? 0 : 1)
