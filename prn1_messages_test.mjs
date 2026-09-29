// PRN1 · interview-messages: a cleared PRN CNA Team application gets the calendar text ten minutes after it is
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
globalThis.__db = { from: q, rpc: async () => ({ data: null, error: null }) }
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

reset([A('Sarah')]); let j = await run()
let m = texts('Sarah')
ck('a cleared PRN application, finished 12 minutes ago: the calendar text goes now, in the PRN CNA Team words', m.length === 1
   && m[0].msg === "Hi Sarah! Thanks for applying for Caring Companions' PRN CNA Team. Based on your Priority Application, we'd like to meet you. Choose an interview time here: https://mo-care.com/apply?book=Sarah"
   && T.job_applicants[0].nudge_1_at, [m, j])
j = await run(); ck('... and only once', texts('Sarah').length === 1, SENT)
reset([A('Sarah', { completed_at: ago(4), created_at: ago(6) })]); await run()
ck('finished 4 minutes ago (maybe still choosing a time): not yet', texts('Sarah').length === 0, SENT)
for (const [lab, o] of [['still filling it in', { status: 'partial', completed_at: null, screen_grade: null, created_at: ago(300) }],
                        ['needs a look', { screen_grade: 'review', created_at: ago(300) }],
                        ['applied before', { screen_grade: 'duplicate', created_at: ago(300) }]]) {
  reset([A('Mia', o)]); await run()
  ck(`a PRN application ${lab}: no booking link, even hours later`, texts('Mia').length === 0, SENT)
}
reset([A('Sarah', { nudge_1_at: ago(49 * 60), created_at: ago(50 * 60) })]); await run()
m = texts('Sarah'); ck('the later reminders are the existing ones (two days on)', m.length === 1 && m[0].msg.startsWith('Hi Sarah, we still have interview times open this week'), m)
reset([A('Sarah', { sms_consent: false })]); await run()
ck('no texting consent: no text (the existing rule)', texts('Sarah').length === 0)
HOUR = '21'; reset([A('Sarah')]); await run()
ck('after 6pm: held (nothing stamped), goes out after 8am', texts('Sarah').length === 0 && !T.job_applicants[0].nudge_1_at); HOUR = '10'
// other roles exactly as before
reset([A('Ann', { position: 'caregiver', created_at: ago(90), completed_at: ago(80) })]); await run()
ck('a caregiver application at 90 minutes: nothing yet (the two-hour rule is unchanged)', texts('Ann').length === 0)
reset([A('Ann', { position: 'caregiver', created_at: ago(130), completed_at: null, status: 'partial', screen_grade: null })]); await run()
m = texts('Ann'); ck('a caregiver application at two hours, even unfinished: the existing first nudge, word for word', m.length === 1
   && m[0].msg === 'Hi Ann, thanks for applying to Caring Companions. You are one step from an interview, and you can pick a time that suits you here: https://mo-care.com/apply?book=Ann', m)
reset([A('Sarah', { created_at: ago(300) })], { roles: false }); await run()
m = texts('Sarah'); ck('before the database step (no PRN roles found): everyone is treated exactly as today', m.length === 1 && m[0].msg.startsWith('Hi Sarah, thanks for applying to Caring Companions.'), m)
// the office alert
reset([A('Sarah', { office_alerted_at: null })]); await run()
const office = SENT.filter((x) => x.type === 'SMS' && String(x.to).includes('4175550999'))
ck('the office hears "applied for the PRN CNA Team and cleared the screen"', office.length === 1 && /Sarah Test just applied for the PRN CNA Team and cleared the screen/.test(office[0].msg), office)
reset([A('Ann', { position: 'caregiver', office_alerted_at: null })]); await run()
const off2 = SENT.filter((x) => x.type === 'SMS' && String(x.to).includes('4175550999'))
ck('... and a caregiver alert reads exactly as before', off2.length === 1 && /^Ann Test just applied and cleared the screen/.test(off2[0].msg), off2)
reset([A('Sarah')]); j = await run(true)
ck('a practice run lists it and sends nothing', SENT.length === 0 && (j.would?.nudge || []).some((x) => /PRN/.test(x)), j)
for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
