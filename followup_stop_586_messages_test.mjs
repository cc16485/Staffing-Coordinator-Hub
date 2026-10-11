// 586 · interview-messages: the 'pick a time' follow-ups stop on the database's stop rule (applicant_followup_stop).
// Harness copied from one_booking_461_messages_test.mjs. Original header follows.
// 461 · interview-messages: a repeat application is not invited to book when the person already holds an interview under
// another application, or applied again after 'not moving forward' (held for the office's review, which is alerted once).
// Based on prn1_messages_test.mjs: a cleared PRN CNA Team application gets the calendar text ten minutes after it is
// finished, in the team's words; any other PRN application gets no booking link; every other role is unchanged.
// The real function against a fake database and fake GoHighLevel; nothing real is reached. node prn1_messages_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions';
let HOUR = '10'
const realTLS = Date.prototype.toLocaleString;
Date.prototype.toLocaleString = function (loc, o) { if (o && o.hour === '2-digit' && !o.minute) return HOUR; return realTLS.call(this, loc, o); };
const ago = (mins) => new Date(Date.now() - mins * 60_000).toISOString()
let T, SENT
const reset = (apps, { roles = true } = {}) => {
  SENT = []
  T = { contact_optout_current: [], circle_contacts: [], phone_index: [], interview_bookings: [], applicant_alerts: [{ name: 'Office', phone: '4175550999', active: true }],
    scheduling_settings: [{ id: 1, phone: '(417) 234-8494', location_line1: '1331 N Stewart Ave', location_name: 'Caring Companions' }],
    job_positions: roles ? [{ key: 'caregiver', track: null }, { key: 'prn_cna', track: 'prn' }] : [],
    job_applicants: apps }
}
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
globalThis.__db = { from: q, rpc: async (fn, a) => fn === 'applicant_followup_stop'
  ? (STOP_ERR ? { data: null, error: { message: 'function does not exist' } } : { data: STOP[a.p] ?? null, error: null })
  : ({ data: fn === 'applicant_review_reason' ? (RV[a.p] || null) : fn === 'applicant_needs_review' ? !!RV[a.p] : fn === 'applicant_person_booked_elsewhere' ? (EL[a.p] ?? false) : null, error: null }) }
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, type: body.type, msg: body.message || body.html, subject: body.subject }); return new Response('{}', { status: 200 }) }
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
let j
const toThem = () => SENT.filter((m) => !String(m.to).includes('4175550999'))   // the office's own 'just applied' alert is not a follow-up
reset([C('Open1')]); j = await run()
ck('nothing stops it: the first follow-up goes as before', texts('Open1').length === 1 && !!T.job_applicants[0].nudge_1_at, SENT)
for (const why of ['booked', 'withdrew (cancelled their interview)', 'the office cancelled their interview', 'ineligible', 'closed']) {
  STOP = { Stop1: why }; reset([C('Stop1')]); const dj = await run(true); j = await run()
  ck(`stop rule says "${why}": no text, no email, nothing stamped, and a practice run says why`,
    toThem().length === 0 && !T.job_applicants[0].nudge_1_at && JSON.stringify(dj).includes(why), [SENT, dj])
}
STOP = {}; STOP_ERR = true; reset([C('Err1')]); const de = await run(true); j = await run()
ck('the stop rule cannot be read: nothing goes (fails closed), and a practice run says so',
  toThem().length === 0 && !T.job_applicants[0].nudge_1_at && JSON.stringify(de).includes('could not be read'), [SENT, de])
STOP_ERR = false
reset([C('Later1', { created_at: ago(60 * 50), nudge_1_at: ago(60 * 48) })]); STOP = { Later1: 'booked' }; await run()
ck('a later follow-up (the 2-day one) stops too', toThem().length === 0 && !T.job_applicants[0].nudge_2_at, SENT)
import('child_process').then(() => {})
const added = (await import('child_process')).execSync('git diff origin/main -- ' + FN + '/interview-messages/index.ts').toString().split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
ck('no em dash in any line 586 adds', added.length > 0 && !added.some((l) => l.includes('\u2014')), added.filter((l) => l.includes('\u2014')))

// ---- 586: duplicates, consent, cancellations
const soon = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
const BK = (id, o) => ({ id: 'bk-' + id, applicant_id: id, status: 'booked', starts_at: soon(48), confirmed_at: null, reminded_day_at: null, reminded_hour_at: null,
  job_applicants: { first_name: id, last_name: 'Test', phone: '41755501' + String(id.length).padStart(2, '0'), email: id + '@example.com', sms_consent: true }, ...o })
STOP = {}
reset([C('Dup1', { status: 'new' })]); T.interview_bookings = [BK('Dup1')]; await run()
const first1 = toThem().length; await run()
ck('a booking confirmation goes once (text + email), and a second run sends nothing more', first1 === 2 && toThem().length === 2 && !!T.interview_bookings[0].confirmed_at, SENT)
reset([C('Race1', { status: 'new' })]); T.interview_bookings = [BK('Race1')]; await Promise.all([run(), run()])
ck('two runs at the same moment: the confirmation still goes once', toThem().length === 2, SENT)
reset([C('Nudge2x')]); await Promise.all([run(), run()])
ck('two runs at the same moment: a follow-up still goes once', texts('Nudge2x').length === 1, SENT)
reset([C('Later2', { status: 'new' })]); T.interview_bookings = [BK('Later2', { confirmed_at: soon(-1) })]
T.job_applicants.push({ ...T.job_applicants[0], id: 'Later2-new', created_at: ago(5), sms_consent: false })
await run()
ck('consent: a later application that said no to texts wins (no text; the email still goes)',
  toThem().filter((m) => m.type === 'SMS').length === 0, SENT)
reset([C('NoTxt', { sms_consent: false })]); await run()
ck('consent: no yes to texts on the application, no follow-up text', texts('NoTxt').length === 0, SENT)
HOUR = '19'; reset([C('Night1')]); T.interview_bookings = []; await run()
ck('quiet hours: nothing goes at 7pm, and nothing is marked sent (it goes after 8am)', toThem().length === 0 && !T.job_applicants[0].nudge_1_at, SENT)
HOUR = '10'
// they cancel: no reminders for that appointment, one cancel notice with a way to rebook, no restart of the follow-ups
reset([C('Cx1', { status: 'new', nudge_1_at: null })])
T.interview_bookings = [BK('Cx1', { status: 'cancelled', cancelled_by: 'applicant', cancelled_at: ago(10), cancel_notified_at: null, confirmed_at: ago(600) })]
STOP = { Cx1: 'withdrew (cancelled their interview)' }
await run(); await run()
const cxTexts = texts('Cx1')
ck('they cancel: one cancellation notice, with their link to pick a new time', cxTexts.length === 1 && /cancelled/.test(cxTexts[0].msg) && /apply\?book=Cx1/.test(cxTexts[0].msg), cxTexts)
ck('...no reminders for the cancelled appointment', !T.interview_bookings[0].reminded_day_at && !T.interview_bookings[0].reminded_hour_at)
ck('...and the "pick a time" follow-ups do not start again', !T.job_applicants[0].nudge_1_at && !cxTexts.some((m) => /one step from/.test(m.msg)), cxTexts)
STOP = {}

let pass = 0; for (const [nm, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + nm + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `${res.length - pass} OF ${res.length} FAILED`); process.exit(pass === res.length ? 0 : 1)
