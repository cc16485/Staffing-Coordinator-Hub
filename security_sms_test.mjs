// Security slice (2026-09-27): send-candidate-message is no longer an open SMS relay. The REAL function against a fake
// database and fake GoHighLevel; every text is recorded, so "nothing was sent" is checked, not assumed.
// node security_sms_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions';
const CLEAN_P = '4175550101', OPT_P = '4175550202', VICTIM = '4175559999'
const E164 = (p) => '+1' + p
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString()
const future = new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10), past = new Date(Date.now() - 5 * 86400e3).toISOString().slice(0, 10)
let T, APP, SENT, REFUSED
const reset = () => {
  SENT = []; REFUSED = []
  APP = { orient_sessions: [{ id: 7, date: future, time: '10:00', is_remote: 'no' }, { id: 8, date: future, time: '14:30', is_remote: 'yes', video_link: 'https://meet.example/abc' }, { id: 3, date: past, time: '10:00', is_remote: 'no' }] }
  T = { orient_bookings: [], contact_optout_current: [{ address: E164(OPT_P), channel: 'sms', opted_out: true, source: 'stop_text' }], circle_contacts: [],
    auth_identities: [{ auth_user_id: 'u-staff', person_id: 'p1', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-norole', person_id: 'p2', project_ref: 'zngsgedlsxinbygwmxwn' }],
    persons: [{ person_id: 'p1', active: true, full_name: 'Stan Staff' }, { person_id: 'p2', active: true, full_name: 'Nora Norole' }],
    entity_memberships: [{ person_id: 'p1', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p2', entity: 'cc_ihs', active: true, ended_at: null }],
    staff_roles: [{ person_id: 'p1', entity: 'cc_ihs', role: 'staffing_coordinator' }] }
}
/* 2026-10-01: candidate texts only go 8am–6pm Central, so the clock is pinned to 10am Central */
const realTLS = Date.prototype.toLocaleString;
Date.prototype.toLocaleString = function (loc, o) { if (o && o.timeZone === 'America/Chicago' && o.hour === '2-digit' && !o.minute) return '10'; return realTLS.call(this, loc, o); };
const q = (t) => { const st = { f: [], gte: [], nn: null }; const b = {
  select() { return b; }, ilike() { return b; }, order() { return b; }, limit() { return b; }, in() { return b; }, contains() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; }, gte(c, v) { st.gte.push([c, v]); return b; }, not(c) { st.nn = c; return b; },
  update(patch) { return { eq: (c, v) => { for (const r of (T[t] || [])) if (r[c] === v) Object.assign(r, patch); return Promise.resolve({ data: null, error: null }) } } },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })); },
  then(ok) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok); }
    let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v)
    for (const [c, v] of st.gte) rows = rows.filter((r) => r[c] != null && r[c] >= v); if (st.nn) rows = rows.filter((r) => r[st.nn] != null)
    return Promise.resolve({ data: rows, error: null }).then(ok);
  } }; return b; };
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'contact_send_refusal_log') REFUSED.push(a); return { data: null, error: null } },
  auth: { getUser: async (jwt) => ({ 'jwt-staff': { id: 'u-staff', email: 's@mo-care.com', app_metadata: {} }, 'jwt-norole': { id: 'u-norole', email: 'n@mo-care.com', app_metadata: {} } })[jwt]
    ? { data: { user: { 'jwt-staff': { id: 'u-staff', email: 's@mo-care.com', app_metadata: {} }, 'jwt-norole': { id: 'u-norole', email: 'n@mo-care.com', app_metadata: {} } }[jwt] }, error: null }
    : { data: { user: null }, error: { message: 'bad' } } } };
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, text: body.message }); return new Response('{"messageId":"m1"}', { status: 200 }) }
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_API_KEY: 'g', GHL_LOCATION_ID: 'loc' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
const src = fs.readFileSync(`${FN}/send-candidate-message/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
const tmp = path.join(process.cwd(), FN, 'send-candidate-message', '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
const h = handler
const post = async (body, jwt) => { const hd = { 'Content-Type': 'application/json' }; if (jwt) hd.Authorization = 'Bearer ' + jwt
  const r = await h(new Request('https://x/functions/v1/send-candidate-message', { method: 'POST', headers: hd, body: JSON.stringify(body) })); let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
const book = (phone, session_id, msAgo = 60e3, extra = {}) => T.orient_bookings.push({ id: 'b' + T.orient_bookings.length, session_id: String(session_id), first: 'Cara', phone, booked_at: iso(msAgo), ...extra })
const EVIL = 'URGENT: your bank account is locked, verify at evil.example'

/* ── the relay is closed ── */
reset(); let r = await post({ phone: VICTIM, message: EVIL })
ck('free text, nobody signed in: refused (401), nothing sent (the open relay is closed)', r.status === 401 && SENT.length === 0, r)
reset(); r = await post({ phone: VICTIM, message: EVIL }, 'anon-public-key')
ck('free text with the public key: refused (401), nothing sent', r.status === 401 && SENT.length === 0, r)
reset(); r = await post({ phone: VICTIM, message: EVIL }, 'jwt-norole')
ck('free text from a signed-in account with no office role: refused (403), nothing sent', r.status === 403 && SENT.length === 0, r)
reset(); book(VICTIM, 7); r = await post({ kind: 'orientation_confirmation', phone: VICTIM, session_id: '7', first: 'Cara', message: EVIL })
ck('the public confirmation ignores any wording it is sent: the text is the fixed confirmation, never the attacker\'s', SENT.length === 1 && !SENT[0].text.includes('evil') && SENT[0].text.startsWith("You're all set, Cara!"), SENT)

/* ── staff door ── */
reset(); r = await post({ auth_check: true }, 'jwt-staff')
ck('staff check (a staffing coordinator): permitted, nothing sent', r.status === 200 && r.j?.authorized === true && SENT.length === 0, r)
reset(); r = await post({ first: 'Pat', phone: CLEAN_P, message: 'Your orientation invite' }, 'jwt-staff')
ck('staff message to a clean number: sent, same answer shape the Staffing Hub expects', r.j?.success === true && SENT.length === 1 && SENT[0].to === 'C:' + E164(CLEAN_P), r)
reset(); r = await post({ first: 'Oz', phone: OPT_P, message: 'Your orientation invite' }, 'jwt-staff')
ck('staff message to a number that replied STOP: not sent, and the Hub shows why', SENT.length === 0 && /opted out/.test(r.j?.error) && REFUSED.length === 1, r)

/* ── public booking confirmation: only for a real, fresh, upcoming booking ── */
reset(); book(CLEAN_P, 7); r = await post({ kind: 'orientation_confirmation', phone: CLEAN_P, session_id: '7', first: 'Cara' })
ck('a real booking made a minute ago for a real upcoming session: the fixed confirmation is sent with the Hub\'s date, time and address, and the booking is stamped',
   r.j?.sent === true && SENT.length === 1 && SENT[0].text.includes('10:00 AM') && SENT[0].text.includes('1331 N Stewart') && !!T.orient_bookings[0].confirm_sms_at, [r, SENT])
reset(); book(CLEAN_P, 8); r = await post({ kind: 'orientation_confirmation', phone: CLEAN_P, session_id: '8', first: 'Cara' })
ck('a video session: the text carries the Hub\'s video link', SENT.length === 1 && SENT[0].text.includes('https://meet.example/abc') && SENT[0].text.includes('2:30 PM'), SENT)
reset(); r = await post({ kind: 'orientation_confirmation', phone: VICTIM, session_id: '7', first: 'Cara' })
ck('no booking for that number: refused (404), nothing sent', r.status === 404 && SENT.length === 0, r)
reset(); book(CLEAN_P, 7, 20 * 60e3); r = await post({ kind: 'orientation_confirmation', phone: CLEAN_P, session_id: '7' })
ck('a booking older than 15 minutes: refused, nothing sent', r.status === 404 && SENT.length === 0, r)
reset(); book(CLEAN_P, 99); r = await post({ kind: 'orientation_confirmation', phone: CLEAN_P, session_id: '99' })
ck('a session that is not in the Hub\'s schedule: refused, nothing sent', r.status === 404 && SENT.length === 0, r)
reset(); book(CLEAN_P, 3); r = await post({ kind: 'orientation_confirmation', phone: CLEAN_P, session_id: '3' })
ck('a session in the past: refused, nothing sent', r.status === 404 && SENT.length === 0, r)
reset(); book(CLEAN_P, 7); await post({ kind: 'orientation_confirmation', phone: CLEAN_P, session_id: '7', first: 'Cara' }); r = await post({ kind: 'orientation_confirmation', phone: CLEAN_P, session_id: '7', first: 'Cara' })
ck('asking twice for the same booking: the second is refused (one confirmation per booking)', r.status === 404 && SENT.length === 1, r)
reset(); book(CLEAN_P, 7, 60e3, { confirm_sms_at: iso(3600e3) }); book(CLEAN_P, 8); r = await post({ kind: 'orientation_confirmation', phone: CLEAN_P, session_id: '8', first: 'Cara' })
ck('a second booking to the same number within 24 hours: no second text (so fake bookings cannot flood a phone)', r.j?.sent === false && SENT.length === 0, r)
reset(); book(OPT_P, 7); r = await post({ kind: 'orientation_confirmation', phone: OPT_P, session_id: '7' })
ck('a booking whose number replied STOP: not sent, not stamped, and the page gets the same answer as any other', SENT.length === 0 && !T.orient_bookings[0].confirm_sms_at && r.j?.sent === false && !JSON.stringify(r.j).includes('opted'), r)

/* ── candidate text rules (2026-10-01, Samantha "yes to both"): orientation invite + "not moving forward" ── */
reset(); r = await post({ first: 'Pat', phone: CLEAN_P, message: 'Your orientation invite' }, 'jwt-staff')
ck('rules · a staff text ends with "Reply STOP to opt out."', SENT.length === 1 && /Reply STOP to opt out\.$/.test(SENT[0].text), SENT)
reset(); r = await post({ first: 'Pat', phone: CLEAN_P, message: 'Reply STOP to stop these' }, 'jwt-staff')
ck('rules · a text that already says STOP is not given a second one', SENT.length === 1 && (SENT[0].text.match(/STOP/g) || []).length === 1, SENT)
reset(); T.job_applicants = [{ phone: '(417) 555-0101', sms_consent: false, created_at: '2026-09-30' }]
r = await post({ first: 'Pat', phone: CLEAN_P, message: 'Your orientation invite' }, 'jwt-staff')
ck("rules · their latest application said no to texts: not sent, and the office is told to call or email", r.status === 409 && SENT.length === 0 && /did not agree to texts/.test(r.j?.error), r)
reset(); T.job_applicants = [{ phone: '4175550101', sms_consent: true, created_at: '2026-09-30' }]
r = await post({ first: 'Pat', phone: CLEAN_P, message: 'Your orientation invite' }, 'jwt-staff'); ck('rules · they said yes: sent', SENT.length === 1, r)
reset(); { const keep = Date.prototype.toLocaleString; Date.prototype.toLocaleString = function (loc, o) { if (o && o.timeZone === 'America/Chicago' && o.hour === '2-digit' && !o.minute) return '19'; return realTLS.call(this, loc, o); }
  r = await post({ first: 'Pat', phone: CLEAN_P, message: 'Your orientation invite' }, 'jwt-staff'); Date.prototype.toLocaleString = keep }
ck('rules · 7pm Central: not sent, "send it after 8am"', r.status === 409 && SENT.length === 0 && /8am to 6pm/.test(r.j?.error), r)
reset(); book(CLEAN_P, 7); r = await post({ kind: 'orientation_confirmation', phone: CLEAN_P, session_id: '7', first: 'Cara' })
ck('rules · the "you\'re booked" confirmation also ends with the STOP line (and still goes right away)', SENT.length === 1 && /Reply STOP to opt out\.$/.test(SENT[0].text), SENT)

console.log('\nSECURITY SLICE · SEND-CANDIDATE-MESSAGE · TEST\n' + '='.repeat(60)); let all = true
for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
