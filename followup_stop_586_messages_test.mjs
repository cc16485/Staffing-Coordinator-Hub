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
  eq(c, v) { st.f.push([c, v]); return b; }, in(c, v) { st.inF = [c, v]; return b; },
  is(c, v) { if (v === null) st.isNull.push(c); return b; }, not(c, op, v) { if (op === 'is' && v === null) st.nn.push(c); return b; },
  update(obj) { return { eq: (c, v) => { for (const r of T[t] ?? []) if (r[c] === v) Object.assign(r, obj); return Promise.resolve({ data: null, error: null }) },
                         in: () => Promise.resolve({ data: null, error: null }) } },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })); },
  then(ok) {
    let rows = T[t] ?? []
    for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v)
    for (const c of st.isNull) rows = rows.filter((r) => r[c] == null)
    for (const c of st.nn) rows = rows.filter((r) => r[c] != null)
    if (st.inF) rows = rows.filter((r) => st.inF[1].includes(r[st.inF[0]]))
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
const src586 = fs.readFileSync(`${FN}/interview-messages/index.ts`, 'utf8')
ck('no em dash in anything new', !/\u2014|—/.test(src586.split('586 (Samantha')[1].split('const step')[0]))

let pass = 0; for (const [nm, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + nm + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `${res.length - pass} OF ${res.length} FAILED`); process.exit(pass === res.length ? 0 : 1)
