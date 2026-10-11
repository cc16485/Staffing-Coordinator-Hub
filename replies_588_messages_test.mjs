// 588 · interview-messages reads replies to the YES / NO question from GoHighLevel itself (no workflow).
// Harness from applicant_msgs_587_messages_test.mjs (587 · interview-messages with the new messages switched on (ops_settings.applicant_msgs_v2_live), and off.
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
let T, SENT, TAGS = [], INBOX = {}, READS = 0, GHL_DOWN = false
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
const RPCLOG = []
globalThis.__db = { from: q, rpc: async (fn, a) => (RPCLOG.push([fn, a]), fn === 'interview_cancel_by_reply')
  ? (() => { const b = T.interview_bookings.find((x) => x.id === a.p_booking); if (!b || b.status !== 'booked') return { data: { cancelled: false }, error: null }
      Object.assign(b, { status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: 'applicant', cancel_kind: 'replied_no', cancel_notified_at: null, reply_kind: 'no', reply_text: a.p_words }); return { data: { cancelled: true }, error: null } })()
  : fn === 'interview_record_reply' ? (() => { const b = T.interview_bookings.find((x) => x.id === a.p_booking); if (b) Object.assign(b, { reply_kind: a.p_kind, reply_text: a.p_words, reply_at: new Date().toISOString() }); return { data: null, error: null } })()
  : fn === 'applicant_followup_stop'
  ? (STOP_ERR ? { data: null, error: { message: 'function does not exist' } } : { data: STOP[a.p] ?? null, error: null })
  : ({ data: fn === 'applicant_review_reason' ? (RV[a.p] || null) : fn === 'applicant_needs_review' ? !!RV[a.p] : fn === 'applicant_person_booked_elsewhere' ? (EL[a.p] ?? false) : null, error: null }) }
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, type: body.type, msg: body.message || body.html, subject: body.subject, attachments: body.attachments }); return new Response('{}', { status: 200 }) }
  if (url.includes('/contacts/lookup')) { const ph = new URL(url).searchParams.get('phone'); return new Response(JSON.stringify(INBOX[ph] ? { contacts: [{ id: 'gc-' + ph, phone: '+1' + ph }] } : { contacts: [] }), { status: 200 }) }
  if (url.includes('/conversations/search')) { READS++; const cid = new URL(url).searchParams.get('contactId'); return new Response(JSON.stringify({ conversations: [{ id: 'cv-' + cid }] }), { status: 200 }) }
  if (/\/conversations\/cv-gc-\d+\/messages/.test(url)) { if (GHL_DOWN) return new Response('{}', { status: 500 }); const ph = url.match(/cv-gc-(\d+)/)[1]; return new Response(JSON.stringify({ messages: { messages: INBOX[ph] || [] } }), { status: 200 }) }
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


const C = (id, o) => A(id, { position: 'caregiver', created_at: ago(600), completed_at: ago(590), screen_grade: 'qualified', status: 'new', ...o })
const soon = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
const PH = (id) => '41755501' + String(id.length).padStart(2, '0')
const BK = (id, o) => ({ id: 'bk-' + id, applicant_id: id, coordinator_id: 'co-s', status: 'booked', starts_at: soon(18), created_at: ago(60 * 30), confirmed_at: ago(60 * 29),
  confirm_email_at: null, reminded_day_at: ago(60), reminded_2day_at: ago(600), reminded_hour_at: null, reply_at: null,
  job_applicants: { first_name: id, last_name: 'Test', phone: PH(id), email: null, sms_consent: true }, ...o })
const msg = (body, minsAgo) => ({ type: 1, direction: 'inbound', body, dateAdded: ago(minsAgo) })
const toThem = (id) => SENT.filter((m) => String(m.to).includes(PH(id)))
const items = () => RPCLOG.filter(([f, a]) => f === 'upsert_app_data_item' && a.target_key === 'ops_items').map(([, a]) => a.item)
const go = async (id, inbox, o = {}) => { RPCLOG.length = 0; READS = 0; reset([C(id)]); T.interview_bookings = [BK(id, o)]; INBOX = { [PH(id)]: inbox }; await run() }

await go('No1', [msg("No, I can't make it", 20)])
ck('a clear NO after the reminder: that interview is cancelled', T.interview_bookings[0].status === 'cancelled' && T.interview_bookings[0].cancel_kind === 'replied_no', T.interview_bookings[0])
ck('...the cancellation text goes in the same run, with their link to a new time', toThem('No1').some((m) => m.type === 'SMS' && /is cancelled/.test(m.msg) && /apply\?book=No1/.test(m.msg)), toThem('No1'))
ck('...nothing for the office to answer', items().length === 0)
await go('Np1', [msg('No problem, see you then', 20)])
ck('"No problem, see you then": nothing cancelled, the office gets their words', T.interview_bookings[0].status === 'booked' && items().length === 1 && /No problem, see you then/.test(items()[0].detail) && T.interview_bookings[0].reply_kind === 'other', [T.interview_bookings[0], items()])
await go('Yes1', [msg('Yes!', 20)])
ck('YES: kept on the booking, nothing cancelled, no office item', T.interview_bookings[0].status === 'booked' && T.interview_bookings[0].reply_kind === 'yes' && items().length === 0)
await go('Yn1', [msg('Yes', 50), msg("Actually I can't make it", 10)])
ck('YES then a later NO: the latest clear answer wins (cancelled)', T.interview_bookings[0].status === 'cancelled')
await go('Old1', [msg('No', 120)])
ck('a NO sent before the question was asked: ignored', T.interview_bookings[0].status === 'booked' && items().length === 0)
await go('Seen1', [msg('No', 30)], { reply_at: ago(15), reply_kind: 'yes' })
ck('a reply we already acted on is not read again', T.interview_bookings[0].status === 'booked')
await go('Ask0', [msg('No', 5)], { reminded_day_at: null, starts_at: soon(33) })
ck('an interview that was never asked: nothing read, nothing cancelled', T.interview_bookings[0].status === 'booked' && READS === 0)
await go('Far1', [msg('No', 5)], { starts_at: soon(60) })
ck('an interview days away: not read', T.interview_bookings[0].status === 'booked' && READS === 0)
GHL_DOWN = true; await go('Down1', [msg('No', 5)])
ck("GoHighLevel can't be read: nothing changes", T.interview_bookings[0].status === 'booked' && items().length === 0); GHL_DOWN = false
V2ON = false; await go('Off1', [msg('No', 5)])
ck('switch off: replies are not read at all', T.interview_bookings[0].status === 'booked' && READS === 0); V2ON = true
HOUR = '22'; await go('Night1', [msg('No', 5)])
ck('at night: the NO still frees the time right away...', T.interview_bookings[0].status === 'cancelled')
ck('...and the cancellation text waits for 8am', !toThem('Night1').some((m) => /is cancelled/.test(m.msg))); HOUR = '10'
RPCLOG.length = 0; reset([C('Dry1')]); T.interview_bookings = [BK('Dry1')]; INBOX = { [PH('Dry1')]: [msg('No', 5)] }
const dj = await run(true)
ck('a practice run lists the reply and changes nothing', T.interview_bookings[0].status === 'booked' && JSON.stringify(dj.would.replies) === '["Dry1: no"]', dj.would)
await go('Two1', [msg('no', 6)]); INBOX = { [PH('Two1')]: [msg('no', 6)] }; await run()
ck('two runs: cancelled once, one cancellation text', T.interview_bookings[0].status === 'cancelled' && toThem('Two1').filter((m) => /is cancelled/.test(m.msg)).length === 1, toThem('Two1'))
const added = (await import('child_process')).execSync('git diff origin/main -- ' + FN + '/interview-messages/index.ts ' + FN + '/_shared/ghl-inbox.ts ' + FN + '/_shared/reply-classify.ts').toString().split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
ck('no em dash in anything 588 adds', !added.some((l) => l.includes('—')))
ck('reading replies never sends anything by itself (the only send is the usual cancellation text)', !/ghlSendChecked|conversations\/messages', \{ method: 'POST'/.test(require_src()))
function require_src() { return (globalThis.__src588 ||= String(fs.readFileSync(`${FN}/_shared/ghl-inbox.ts`, 'utf8'))) }

let pass = 0; for (const [nm, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + nm + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `${res.length - pass} OF ${res.length} FAILED`); process.exit(pass === res.length ? 0 : 1)
