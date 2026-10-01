// NO SILENT FAILURES, slice 2 (2026-10-01) · hiring senders: reference-send, applicant-reengage, applicant-invite,
// send-candidate-message. The REAL functions against a fake database and a fake GoHighLevel that can refuse a text or an
// email. Proves: a refused send never comes back as full success, a partial send says which channel failed, and where
// nobody is watching (or the failure would otherwise be hidden) a Needs Attention card is raised.
// node nsf2_hiring_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions';
const realTLS = Date.prototype.toLocaleString;
Date.prototype.toLocaleString = function (loc, o) {   // 10am on a Tuesday, Central: inside every hours rule
  if (o && o.hour === '2-digit' && !o.minute) return '10'; if (o && o.weekday === 'short' && !o.hour) return 'Tue'; return realTLS.call(this, loc, o); };
const P1 = '4175550101', P2 = '4175550111', E1 = 'ann@example.test', E2 = 'bo@example.test'
const E164 = (p) => '+1' + p
const REF_ID = '11111111-2222-3333-4444-555555555555'
const future = new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10)
let T, APP, SENT, REFUSE
const reset = () => {
  APP = { orient_sessions: [{ id: 7, date: future, time: '10:00', is_remote: 'no' }] }; SENT = []; REFUSE = new Set()
  T = { contact_optout_current: [], circle_contacts: [], phone_index: [], interview_bookings: [], scheduling_settings: [{ id: 1, phone: '(417) 234-8494' }],
    job_applicants: [], applicant_invites: [], orient_bookings: [],
    job_positions: [{ key: 'caregiver', label: 'Caregiver', active: true }], job_postings: [],
    reference_requests: [{ id: REF_ID, candidate_name: 'Cara Candidate', ref_name: 'Rita Ref', ref_email: E1, ref_phone: P1, sms_ok_at: '2026-10-01T10:00:00Z' }],
    auth_identities: [{ auth_user_id: 'u-owner', person_id: 'p-owner', project_ref: 'zngsgedlsxinbygwmxwn' }],
    persons: [{ person_id: 'p-owner', active: true, full_name: 'Olive Owner' }],
    entity_memberships: [{ person_id: 'p-owner', entity: 'cc_ihs', active: true, ended_at: null }],
    staff_roles: [{ person_id: 'p-owner', entity: 'cc_ihs', role: 'owner_admin' }] }
}
const q = (t) => { const st = { f: [], gte: [], inF: null, nn: null }; const b = {
  select() { return b; }, order() { return b; }, limit() { return b; }, contains() { return b; }, range() { return b; }, or() { return b; }, is() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; }, gte(c, v) { st.gte.push([c, v]); return b; }, in(c, v) { st.inF = [c, v]; return b; }, not(c) { st.nn = c; return b; },
  update(patch) { const u = { eq: (c, v) => { for (const r of (T[t] || [])) if (r[c] === v) Object.assign(r, patch); return u }, is: () => u,
    then: (ok) => Promise.resolve({ data: null, error: null }).then(ok) }; return u },
  insert(row) { const r = { id: (T[t] ||= []).length + 1, ...row }; T[t].push(r); const ins = { select: () => ({ single: () => Promise.resolve({ data: r, error: null }) }),
    then: (ok) => Promise.resolve({ data: r, error: null }).then(ok) }; return ins },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })); },
  single() { return b.maybeSingle(); },
  then(ok) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok); }
    let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v)
    for (const [c, v] of st.gte) rows = rows.filter((r) => r[c] != null && r[c] >= v)
    if (st.inF) rows = rows.filter((r) => st.inF[1].includes(r[st.inF[0]])); if (st.nn && t !== 'job_applicants') rows = rows.filter((r) => r[st.nn] != null)
    return Promise.resolve({ data: rows, error: null }).then(ok);
  } }; return b; };
globalThis.__db = { from: q,
  rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) } return { data: null, error: null } },
  auth: { getUser: async (jwt) => jwt === 'jwt-owner' ? { data: { user: { id: 'u-owner', email: 'owner@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } };
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) { const key = body.phone || body.email; return new Response(JSON.stringify({ contact: { id: 'C:' + key, dnd: false } }), { status: 200 }) }
  if (url.includes('/conversations/messages')) {
    if (REFUSE.has(body.type)) return new Response('{"message":"GHL said no"}', { status: 422 })
    SENT.push({ to: body.contactId, type: body.type }); return new Response('{"messageId":"m1"}', { status: 200 }) }
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); } return handler; };
const post = async (h, url, body, jwt) => { const hd = { 'Content-Type': 'application/json' }; if (jwt) hd.Authorization = 'Bearer ' + jwt
  const r = await h(new Request(url, { method: 'POST', headers: hd, body: JSON.stringify(body ?? {}) })); let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
const cards = (sender) => (APP.ops_items || []).filter((x) => x.kind === 'send_problem' && x.sender.startsWith(sender))
const OWNER = 'jwt-owner'

/* ── applicant-reengage (bulk, a person chose the list) ── */
let h = await load('applicant-reengage')
const apps = () => [{ id: 'a1', first_name: 'Ann', last_name: 'Able', phone: P1, email: E1, sms_consent: true },
                    { id: 'a2', first_name: 'Bo', phone: P2, email: E2, sms_consent: true }]
reset(); T.job_applicants = apps()
let r = await post(h, 'https://x/functions/v1/applicant-reengage', { ids: ['a1', 'a2'], message: 'new opening' }, OWNER)
ck('applicant-reengage · everything goes: ok, sent 2, no cards', r.j?.ok === true && r.j?.sent === 2 && SENT.length === 4 && cards('applicant-reengage').length === 0, [r, APP.ops_items])
reset(); T.job_applicants = apps(); REFUSE.add('SMS')
r = await post(h, 'https://x/functions/v1/applicant-reengage', { ids: ['a1', 'a2'], message: 'new opening' }, OWNER)
ck('applicant-reengage · texts refused, emails went: NOT reported as full success (ok:false, says which texts failed)',
   r.j?.ok === false && r.j?.sent === 2 && (r.j?.not_sent || []).filter((x) => /text refused/.test(x)).length === 2 && /did not go out/.test(r.j?.error || ''), r)
ck('applicant-reengage · ...and each refused text is a Needs Attention card with the person\'s name and number',
   cards('applicant-reengage').length === 2 && cards('applicant-reengage').every((c) => c.channel === 'sms' && c.problem === 'failed') &&
   cards('applicant-reengage').some((c) => c.who === 'Ann Able' && c.phone === E164(P1)), APP.ops_items)
reset(); T.job_applicants = apps(); REFUSE.add('SMS'); REFUSE.add('Email')
r = await post(h, 'https://x/functions/v1/applicant-reengage', { ids: ['a1', 'a2'], message: 'new opening' }, OWNER)
ck('applicant-reengage · everything refused: sent 0, ok:false, 4 cards (2 texts + 2 emails), nobody stamped as reached',
   r.j?.ok === false && r.j?.sent === 0 && cards('applicant-reengage').length === 4 && T.job_applicants.every((p) => !p.reengaged_at), [r, T.job_applicants])
reset(); T.job_applicants = apps(); REFUSE.add('SMS')
r = await post(h, 'https://x/functions/v1/applicant-reengage', { ids: ['a1', 'a2'], message: 'new opening', dry: true }, OWNER)
ck('applicant-reengage · a dry run sends nothing and raises no card', r.j?.dry === true && SENT.length === 0 && cards('applicant-reengage').length === 0, r)

/* ── applicant-invite (one person, staff pressed Send) ── */
h = await load('applicant-invite')
const inv = { action: 'send', first_name: 'Ivy', last_name: 'Inman', phone: P1, email: E1, position: 'caregiver', sms_asked: true }
reset(); REFUSE.add('SMS')
r = await post(h, 'https://x/functions/v1/applicant-invite', inv, OWNER)
const row = T.applicant_invites[0] || {}
ck('applicant-invite · text refused, email went: the answer says texted:false + why (not full success)',
   r.j?.texted === false && r.j?.emailed === true && (r.j?.not_sent || []).some((x) => /^text: the texting service refused it \(422\)/.test(x)), r)
ck('applicant-invite · ...and the invite row records which channel failed', row.texted === false && row.emailed === true && (row.not_sent || []).some((x) => /^text:/.test(x)), row)
reset(); REFUSE.add('SMS'); REFUSE.add('Email')
r = await post(h, 'https://x/functions/v1/applicant-invite', inv, OWNER)
ck('applicant-invite · both refused: ok:false, "Nothing was sent", both reasons listed', r.j?.ok === false && /Nothing was sent/.test(r.j?.error || '') && (r.j?.not_sent || []).length === 2, r)

/* ── reference-send (one reference, staff pressed Send) ── */
h = await load('reference-send')
for (const [action, type] of [['email', 'Email'], ['text', 'SMS']]) {
  reset(); REFUSE.add(type)
  r = await post(h, 'https://x/functions/v1/reference-send', { action, id: REF_ID }, OWNER)
  const ref = T.reference_requests[0]
  ck(`reference-send · ${action} refused: ok:false with the reason, and not stamped as sent`,
     r.j?.ok === false && /refused it \(422\)/.test(r.j?.error || '') && !ref.sent_at && !ref.office_emailed_at && !ref.office_texted_at, [r, ref])
}

/* ── send-candidate-message ── */
h = await load('send-candidate-message')
reset(); REFUSE.add('SMS'); T.orient_bookings.push({ id: 'b0', session_id: '7', first: 'Cara', last: 'Cole', phone: P1, booked_at: new Date(Date.now() - 60e3).toISOString() })
r = await post(h, 'https://x/functions/v1/send-candidate-message', { kind: 'orientation_confirmation', phone: P1, session_id: '7', first: 'Cara' })
ck('send-candidate-message · booking confirmation refused (nobody watching): a Needs Attention card, booking not stamped, page told nothing',
   cards('send-candidate-message').length === 1 && cards('send-candidate-message')[0].who === 'Cara Cole' && cards('send-candidate-message')[0].problem === 'failed' &&
   !T.orient_bookings[0].confirm_sms_at && r.j?.sent === false && !JSON.stringify(r.j).includes('422'), [r, APP.ops_items])
reset(); REFUSE.add('SMS')
r = await post(h, 'https://x/functions/v1/send-candidate-message', { first: 'Cara', phone: P1, message: 'hello' }, OWNER)
ck('send-candidate-message · staff text refused: the answer is an error with the status (never success); no card (they see it)',
   !r.j?.success && /failed \(422\)/.test(r.j?.error || '') && cards('send-candidate-message').length === 0, r)
reset()
r = await post(h, 'https://x/functions/v1/send-candidate-message', { first: 'Cara', phone: P1, message: 'hello' }, OWNER)
ck('send-candidate-message · staff text accepted: success with the message id', r.j?.success === true && r.j?.message_id === 'm1' && SENT.length === 1, r)

/* ── scan: no send in these four files goes unchecked ── */
for (const f of ['reference-send', 'applicant-reengage', 'applicant-invite', 'send-candidate-message']) {
  const s = fs.readFileSync(`${FN}/${f}/index.ts`, 'utf8')
  const raw = [...s.matchAll(/fetch\('https:\/\/services\.leadconnectorhq\.com\/conversations\/messages'[\s\S]{0,700}/g)].map((m) => m[0])
  const unchecked = raw.filter((x) => !/\.ok\b/.test(x))
  ck(`scan · NO SILENT FAILURES: ${f} checks every GoHighLevel send it makes`, unchecked.length === 0 && !/api\.resend\.com/.test(s), unchecked)
}

console.log(res.map(([n, ok, note]) => (ok ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n      ' + note : '')).join('\n'))
console.log('='.repeat(60)); const bad = res.filter((x) => !x[1]).length
console.log(bad ? `${bad} OF ${res.length} CHECKS FAIL` : `ALL ${res.length} CHECKS PASS`); process.exit(bad ? 1 : 0)
