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
let RV = {}, EL = {}
globalThis.__db = { from: q, rpc: async (fn, a) => ({ data: fn === 'applicant_review_reason' ? (RV[a.p] || null) : fn === 'applicant_needs_review' ? !!RV[a.p] : fn === 'applicant_person_booked_elsewhere' ? (EL[a.p] ?? false) : null, error: null }) }
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
// 1. booked under another application: no booking link
RV = {}; EL = { Shak2: true }
reset([C('Shak2', { screen_grade: 'duplicate', duplicate_of: 'Shak1' })]); let j = await run()
ck('461: a repeat application of someone already booked under another application gets no "pick a time" text', texts('Shak2').length === 0 && !T.job_applicants[0].nudge_1_at && j.held?.some?.((x) => /already booked under another application/.test(x)) !== false, [SENT, j])
// 2. applied again after "not moving forward": held + the office is told once
RV = { Dee2: 'declined' }; EL = {}
reset([C('Dee2', { screen_grade: 'duplicate', duplicate_of: 'Dee1' })]); j = await run()
const office = SENT.filter((x) => String(x.to).includes('4175550999'))
ck('461: applied again after not moving forward: no booking link to her', texts('Dee2').length === 0 && !T.job_applicants[0].nudge_1_at, SENT)
ck('461: the office is told, in her words, once', office.length === 1 && office[0].msg === 'Dee2 Test applied again. You chose not to move forward with them before, so they cannot book an interview until you review it. It is in the hub under Applicants, Everyone: press "Approve, let them book" if you want to see them.' && !!T.job_applicants[0].office_alerted_at, office)
SENT = []; await run(); ck('...and only once', SENT.filter((x) => String(x.to).includes('4175550999')).length === 0)
HOUR = '21'; reset([C('Dee2', { screen_grade: 'duplicate', duplicate_of: 'Dee1' })]); await run()
ck('461: at night the office alert waits (nothing stamped)', SENT.filter((x) => String(x.to).includes('4175550999')).length === 0 && !T.job_applicants[0].office_alerted_at); HOUR = '10'
// 3. a repeat application with no booking elsewhere and no decline: unchanged (gets the nudge)
RV = {}; EL = {}
reset([C('Ann2', { screen_grade: 'duplicate', duplicate_of: 'Ann1' })]); await run()
ck('a repeat application with nothing booked and no "not moving forward": unchanged, gets the usual first nudge', texts('Ann2').length === 1)
// 4. once the office approved (review false): the nudge goes
RV = { Dee2: null }; reset([C('Dee2', { screen_grade: 'duplicate', duplicate_of: 'Dee1', review_cleared_at: ago(5) })]); await run()
ck('after the office approves: the usual first nudge goes', texts('Dee2').length === 1)
// 5. Amanda Peak (2026-10-05): on the do-not-rehire list, FIRST application here (grade review): held, and the office is told what it is
RV = { Amy1: 'dnr' }; EL = {}
reset([C('Amy1', { screen_grade: 'review' }), C('Rayna1', { screen_grade: 'review' })]); j = await run()
const off5 = SENT.filter((x) => String(x.to).includes('4175550999')).map((x) => x.msg)
ck('do-not-rehire: no booking link to her, even on a first application', texts('Amy1').length === 0 && !T.job_applicants[0].nudge_1_at, SENT)
ck('...the office gets the do-not-rehire alert once, not "just applied, needs a look"', off5.filter((m) => /^Amy1 Test/.test(m)).length === 1
  && off5.includes('Amy1 Test applied. They are on your do-not-rehire list, so they cannot book an interview and get no booking reminders. Nothing was sent to them. If that has changed, take them off the list in the hub (Recruit, Do not rehire).'), off5)
ck('...someone else who simply needs a look is unchanged (usual alert and nudge)', off5.some((m) => /^Rayna1 Test just applied and needs a look/.test(m)) && texts('Rayna1').length === 1, off5)
const fsrc = fs.readFileSync(`${FN}/interview-messages/index.ts`, 'utf8')
ck('no em dash in anything new', !/[—―]/.test(fsrc.slice(fsrc.indexOf('461 (2026-10-05, Shakira'), fsrc.indexOf('461 (2026-10-05, Shakira') + 900) + fsrc.slice(fsrc.indexOf('applied again after "not moving forward" -'), fsrc.indexOf('---------------- cancellations'))))
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `${res.length - pass} OF ${res.length} FAILED`); process.exit(pass === res.length ? 0 : 1)
