// 587 · interview-messages with the new messages switched on (ops_settings.applicant_msgs_v2_live), and off.
// Harness copied from followup_stop_586_messages_test.mjs.
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
let T, SENT, TAGS = []
const reset = (apps, { roles = true } = {}) => {
  SENT = []
  T = { contact_optout_current: [], circle_contacts: [], phone_index: [], interview_bookings: [], applicant_alerts: [{ name: 'Office', phone: '4175550999', active: true }],
    scheduling_settings: [{ id: 1, phone: '(417) 234-8494', location_line1: '1331 N Stewart Ave', location_name: 'Caring Companions' }],
    job_positions: roles ? [{ key: 'caregiver', track: null }, { key: 'prn_cna', track: 'prn' }] : [],
    job_applicants: apps, app_data: [{ key: 'ops_settings', data: { applicant_msgs_v2_live: V2ON, applicant_msgs_krystal_named: KNAMED } }],
    coordinators: [{ id: 'co-s', name: 'Samantha Troutman' }, { id: 'co-k', name: 'Krystal Smith' }] }
  T.scheduling_settings[0].photo_url = PHOTO; T.scheduling_settings[0].note = 'Park out front, first-floor door on the left'
  TAGS = []
}
let V2ON = true, KNAMED = false, PHOTO = 'https://x/door.jpg'
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
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, type: body.type, msg: body.message || body.html, subject: body.subject, attachments: body.attachments }); return new Response('{}', { status: 200 }) }
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

// ---- switch OFF: exactly as before
V2ON = false; reset([C('Off1', { completed_at: ago(170), created_at: ago(180) })]); await run()
ck('switch off: the old 2-hour follow-up, old words', sms('Off1').length === 1 && /You are one step from an in-person interview/.test(sms('Off1')[0]), SENT)
V2ON = true

// ---- finished, didn't book
reset([C('Fin1', { created_at: ago(30), completed_at: ago(15), email: 'fin1@example.com' })]); await run()
ck('10 minutes after finishing: the warm first invite (text)', sms('Fin1').length === 1 && sms('Fin1')[0].startsWith("Hi Fin1, it's the Caring Companions Team. Thank you for applying!") && sms('Fin1')[0].endsWith('Reply STOP to opt out.'), sms('Fin1'))
ck('...and the branded email with the button', mails().length === 1 && /Pick my interview time/.test(mails()[0].msg) && /cc-logo\.png/.test(mails()[0].msg), mails())
await run(); ck('...only once', sms('Fin1').length === 1)
reset([C('Fin5', { created_at: ago(8), completed_at: ago(5) })]); await run()
ck('5 minutes after finishing: nothing yet (they may still be picking a time)', toThem().length === 0)
reset([C('Fin2', { created_at: ago(60 * 26), completed_at: ago(60 * 25), nudge_1_at: ago(60 * 25) })]); await run()
ck('next day: the check-in', sms('Fin2').length === 1 && /the Caring Companions Team again/.test(sms('Fin2')[0]), sms('Fin2'))
reset([C('Fin3', { created_at: ago(60 * 74), completed_at: ago(60 * 73), nudge_1_at: ago(1), nudge_2_at: ago(1) })]); await run()
ck('day 3: "if this week got busy"', sms('Fin3').length === 1 && /if this week got busy/.test(sms('Fin3')[0]), sms('Fin3'))
reset([C('Fin4', { created_at: ago(60 * 146), completed_at: ago(60 * 145), nudge_1_at: ago(1), nudge_2_at: ago(1), nudge_3_at: ago(1) })]); await run()
ck('day 6: the last note', sms('Fin4').length === 1 && /this is our last note/.test(sms('Fin4')[0]), sms('Fin4'))
reset([C('Fin6', { created_at: ago(60 * 170), completed_at: ago(60 * 169), nudge_1_at: ago(1), nudge_2_at: ago(1), nudge_3_at: ago(1), nudge_4_at: ago(1) })]); await run()
ck('a week after finishing: nothing more, marked finished trying', toThem().length === 0 && !!T.job_applicants[0].gave_up_at)
KNAMED = true; reset([C('Kn1', { created_at: ago(30), completed_at: ago(15) })]); await run()
ck("once Krystal agrees: \"it's Krystal at Caring Companions\"", /it's Krystal at Caring Companions/.test(sms('Kn1')[0] || ''), sms('Kn1')); KNAMED = false

// ---- didn't finish
reset([C('Unf1', { status: 'partial', created_at: ago(40), completed_at: null, email: 'unf1@example.com' })]); await run()
ck('30 minutes after stopping: "finish your application" (text + email)', sms('Unf1').length === 1 && /didn't get finished/.test(sms('Unf1')[0]) && mails().length === 1 && /Finish my application/.test(mails()[0].msg), SENT)
reset([C('Unf2', { status: 'partial', created_at: ago(60 * 25), completed_at: null, finish_nudge_1_at: ago(60 * 24) })]); await run()
ck('the next day: one reminder to finish', sms('Unf2').length === 1 && /almost done/.test(sms('Unf2')[0]), sms('Unf2'))
reset([C('Unf3', { status: 'partial', created_at: ago(60 * 50), completed_at: null, finish_nudge_1_at: ago(1), finish_nudge_2_at: ago(1) })]); await run()
ck('after the two: nothing more', toThem().length === 0)
reset([C('Unf4', { status: 'partial', created_at: ago(60 * 30), completed_at: null, nudge_1_at: ago(60 * 28) })]); await run()
ck('someone the old follow-ups already wrote to: no "finish" message on top', toThem().length === 0)
reset([C('Unf5', { status: 'partial', created_at: ago(60 * 80), completed_at: null })]); await run()
ck('an old unfinished start (over 3 days): left alone', toThem().length === 0)

// ---- booked
HOUR = '21'; reset([C('Bk1', { status: 'new' })]); T.interview_bookings = [BK('Bk1', { starts_at: soon(72) })]; await run()
ck('booked at 9pm: the confirmation email goes right away', mails().length === 1 && /You're booked/.test(mails()[0].subject), SENT)
ck('...the text waits for 8am', sms('Bk1').length === 0 && !T.interview_bookings[0].confirmed_at)
HOUR = '10'; await run()
ck('at 8am+: the confirmation text, naming the interviewer, no YES/NO (3 days ahead)', sms('Bk1').length === 1 && /Your interview with Samantha is/.test(sms('Bk1')[0]) && !/Reply YES/.test(sms('Bk1')[0]), sms('Bk1'))
ck('...and no second email', mails().length === 1)
reset([C('Bk2', { status: 'new' })]); T.interview_bookings = [BK('Bk2', { starts_at: soon(20), coordinator_id: 'co-k' })]; await run()
ck('booked for tomorrow: the confirmation asks YES / NO (it is the day-before notice)', sms('Bk2').length === 1 && /Reply YES so we know you're coming, or NO if you can't make it/.test(sms('Bk2')[0]) && !!T.interview_bookings[0].reminded_day_at, sms('Bk2'))
ck('...Krystal not named until she agrees ("our team")', /Your interview with our team is/.test(sms('Bk2')[0] || ''), sms('Bk2'))
ck('...and their contact is tagged so a reply reaches interview-reply', TAGS.some((t) => (t.tags || []).includes('interview-asked')), TAGS)
await run(); ck('...no separate day-before after it', sms('Bk2').length === 1)
reset([C('Two1', { status: 'new' })]); T.interview_bookings = [BK('Two1', { starts_at: soon(45), created_at: ago(60 * 80), confirmed_at: ago(60 * 79) })]; await run()
ck('booked days ahead: "looking forward to meeting you" 2 days before', sms('Two1').length === 1 && /looking forward to meeting you/.test(sms('Two1')[0]), sms('Two1'))
reset([C('Two2', { status: 'new' })]); T.interview_bookings = [BK('Two2', { starts_at: soon(45), created_at: ago(60 * 10), confirmed_at: ago(60 * 9) })]; await run()
ck('booked only 2 days ahead: no extra 2-day note', sms('Two2').length === 0)
reset([C('Day1', { status: 'new' })]); T.interview_bookings = [BK('Day1', { starts_at: soon(25), confirmed_at: ago(60 * 40), reminded_2day_at: ago(60 * 20) })]; await run()
ck('day before: YES / NO, address and door note, tagged', sms('Day1').length === 1 && /see you tomorrow/.test(sms('Day1')[0]) && /Park out front/.test(sms('Day1')[0]) && /or NO if you can't make it/.test(sms('Day1')[0]) && TAGS.length === 1, [sms('Day1'), TAGS])
reset([C('Hr1', { status: 'new' })]); T.interview_bookings = [BK('Hr1', { starts_at: soon(1), confirmed_at: ago(600), reminded_day_at: ago(300), reminded_2day_at: ago(900) })]; await run()
const hr = texts('Hr1')
ck('hour before: a picture text with the entrance photo', hr.length === 1 && (hr[0].attachments || [])[0] === 'https://x/door.jpg' && /Photo above/.test(hr[0].msg), hr)
ck('...the only picture text (all others plain)', SENT.filter((m) => m.attachments).length === 1)
PHOTO = null; reset([C('Hr2', { status: 'new' })]); T.interview_bookings = [BK('Hr2', { starts_at: soon(1), confirmed_at: ago(600), reminded_day_at: ago(300) })]; await run()
ck('no photo loaded: a plain text, no "photo above"', texts('Hr2').length === 1 && !texts('Hr2')[0].attachments && !/Photo/.test(texts('Hr2')[0].msg), texts('Hr2')); PHOTO = 'https://x/door.jpg'
reset([C('Hr3', { status: 'new' })]); T.interview_bookings = [BK('Hr3', { starts_at: soon(1), confirmed_at: ago(600), reminded_day_at: ago(300), job_applicants: { first_name: 'Hr3', last_name: 'T', phone: '4175550111', email: 'hr3@example.com', sms_consent: false } })]; await run()
ck('no yes to texts: the hour-before comes by email instead', toThem().filter((m) => m.type === 'SMS').length === 0 && mails().length === 1 && /See you at/.test(mails()[0].subject), SENT)

// ---- cancelled: the words follow the reason
for (const [kind, bye] of [['found_job', true], ['not_interested', true], ['schedule', false], ['replied_no', false], [null, false]]) {
  reset([C('Cx' + (kind || 'none'), { status: 'new' })])
  T.interview_bookings = [BK('Cx' + (kind || 'none'), { status: 'cancelled', cancelled_by: 'applicant', cancelled_at: ago(5), cancel_notified_at: null, cancel_kind: kind })]
  STOP = { ['Cx' + (kind || 'none')]: 'withdrew (cancelled their interview)' }
  await run(); const t = sms('Cx' + (kind || 'none'))
  ck(`cancelled (${kind || 'no reason'}): ${bye ? 'a goodbye, no rebook link' : 'their link to a new time'}`,
    t.length === 1 && (bye ? (/always welcome to apply again/.test(t[0]) && !/book=/.test(t[0])) : /pick one here: https:\/\/mo-care\.com\/apply\?book=/.test(t[0])), t)
}
STOP = {}
// ---- duplicates
reset([C('Dup9', { status: 'new' })]); T.interview_bookings = [BK('Dup9', { starts_at: soon(72) })]; await Promise.all([run(), run()])
ck('two runs at once: one confirmation text and one email', sms('Dup9').length === 1 && mails().length === 1, SENT)
reset([C('Dup8', { created_at: ago(30), completed_at: ago(15) })]); await Promise.all([run(), run()])
ck('two runs at once: one first invite', sms('Dup8').length === 1)
// ---- quiet hours / consent
HOUR = '19'; reset([C('Late1', { created_at: ago(30), completed_at: ago(15) })]); await run()
ck('7pm: no follow-up text or email, nothing marked (goes after 8am)', toThem().length === 0 && !T.job_applicants[0].nudge_1_at); HOUR = '10'
reset([C('NoTx', { created_at: ago(30), completed_at: ago(15), sms_consent: false, email: 'notx@example.com' })]); await run()
ck('no yes to texts: email only', texts('NoTx').length === 0 && mails().length === 1)
const added = (await import('child_process')).execSync('git diff origin/main -- ' + FN + '/interview-messages/index.ts').toString().split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
ck('no em dash in any line 587 adds', added.length > 0 && !added.some((l) => l.includes('—')), added.filter((l) => l.includes('—')))

let pass = 0; for (const [nm, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + nm + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `${res.length - pass} OF ${res.length} FAILED`); process.exit(pass === res.length ? 0 : 1)
