// Step 0 · 0b-3 · caregiver, applicant and HomeTogether senders go through the universal opt-out check.
// Real functions against a fake database and fake GoHighLevel/Resend where they can run outside production; the new
// saved-contact door tested directly; and a source scan of the heavy scheduled senders so no send can skip the door.
// node optout_0b3_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions';
const realTLS = Date.prototype.toLocaleString;
Date.prototype.toLocaleString = function (loc, o) {
  if (o && o.hour === '2-digit' && !o.minute) return '10'; if (o && o.weekday === 'short' && !o.hour) return 'Tue'; return realTLS.call(this, loc, o); };
const CLEAN_P = '4175550101', OPT_P = '4175550202', DND_P = '4175550303'
const CLEAN_E = 'clean@example.test', OPT_E = 'optout@example.test'
const E164 = (p) => '+1' + p
let T, APP, SENT, RESEND, REFUSED, DND
const reset = () => {
  APP = {}; SENT = []; RESEND = []; REFUSED = []; DND = new Set([E164(DND_P)])
  T = { contact_optout_current: [{ address: E164(OPT_P), channel: 'sms', opted_out: true, source: 'stop_text' }, { address: OPT_E, channel: 'email', opted_out: true, source: 'staff' }],
    circle_contacts: [], phone_index: [], interview_bookings: [], scheduling_settings: [{ id: 1, phone: '(417) 234-8494' }],
    job_applicants: [],
    auth_identities: [{ auth_user_id: 'u-owner', person_id: 'p-owner', project_ref: 'zngsgedlsxinbygwmxwn' }],
    persons: [{ person_id: 'p-owner', active: true, full_name: 'Olive Owner' }],
    entity_memberships: [{ person_id: 'p-owner', entity: 'cc_ihs', active: true, ended_at: null }],
    staff_roles: [{ person_id: 'p-owner', entity: 'cc_ihs', role: 'owner_admin' }] }
}
const q = (t) => { const st = { f: [], nn: null, inF: null }; const b = {
  select() { return b; }, order() { return b; }, limit() { return b; }, contains() { return b; }, range() { return b; }, or() { return b; }, is() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; }, in(c, v) { st.inF = [c, v]; return b; }, not(c) { st.nn = c; return b; },
  update() { return { eq: () => Promise.resolve({ data: null, error: null }) }; },
  insert(row) { (T[t] ||= []).push(row); return Promise.resolve({ data: row, error: null }); },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })); },
  single() { return b.maybeSingle(); },
  then(ok) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok); }
    let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v)
    if (st.inF) rows = rows.filter((r) => st.inF[1].includes(r[st.inF[0]])); if (st.nn && t !== 'job_applicants') rows = rows.filter((r) => r[st.nn] != null)
    return Promise.resolve({ data: rows, error: null }).then(ok);
  } }; return b; };
globalThis.__db = { from: q,
  rpc: async (fn, a) => { if (fn === 'contact_send_refusal_log') REFUSED.push({ sender: a.p_sender, reasons: a.p_reasons }); if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) } return { data: null, error: null } },
  auth: { getUser: async (jwt) => jwt === 'jwt-owner' ? { data: { user: { id: 'u-owner', email: 'owner@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } };
const STORED = { 'cg-clean': { id: 'cg-clean', phone: E164(CLEAN_P), dnd: false }, 'cg-opt': { id: 'cg-opt', phone: E164(OPT_P), dnd: false },
                 'cg-dnd': { id: 'cg-dnd', phone: E164(DND_P), dnd: true }, 'cg-nophone': { id: 'cg-nophone', dnd: false } }
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) { const key = body.phone || body.email; return new Response(JSON.stringify({ contact: { id: 'C:' + key, dnd: DND.has(key) } }), { status: 200 }) }
  const gm = url.match(/\/contacts\/([^/?]+)$/)
  if (gm && (!o || !o.method || o.method === 'GET')) { const c = STORED[decodeURIComponent(gm[1])]; return new Response(JSON.stringify(c ? { contact: c } : {}), { status: c ? 200 : 404 }) }
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, type: body.type }); return new Response('{}', { status: 200 }) }
  if (url.includes('api.resend.com')) { RESEND.push(body.to?.[0]); return new Response('{"id":"x"}', { status: 200 }) }
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HT_ORDER_TOKEN: 'H', HT_SUPPORT_TOKEN: 'H', RESEND_API_KEY: 'r' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); } return handler; };
const post = async (h, url, body, headers = {}) => { const r = await h(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) })); let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
const to = (x) => SENT.filter((m) => m.to === 'C:' + x || m.to === x).length

/* ── the saved-contact door (coverage texts to a caregiver's stored GHL contact) ── */
const O = await import(path.join(process.cwd(), FN, '_shared/optout.ts'))
const ghl = { token: 'g', locationId: 'loc' }
reset(); let id = await O.ghlStoredContactIfAllowed(globalThis.__db, ghl, 'coverage-run', { channel: 'sms', contactId: 'cg-clean' })
ck('saved-contact door · a clean caregiver contact comes back as sendable', id === 'cg-clean' && REFUSED.length === 0)
for (const [cid, label, why] of [['cg-opt', 'whose number replied STOP (Hub record)', /opted out/], ['cg-dnd', 'under GHL Do Not Disturb', /Do Not Disturb is on/],
                                 ['cg-missing', 'GHL cannot return', /could not return/], ['cg-nophone', 'with no phone on the GHL contact', /no usable phone/]]) {
  reset(); let told = false
  id = await O.ghlStoredContactIfAllowed(globalThis.__db, ghl, 'coverage-run', { channel: 'sms', contactId: cid, onOptOut: () => { told = true } })
  ck(`saved-contact door · a contact ${label}: refused and logged${why.source.includes('opted') || why.source.includes('Disturb') ? ', and the sender is told it is an opt-out' : ''}`,
     id === null && REFUSED.length === 1 && why.test(JSON.stringify(REFUSED[0].reasons)) && told === (cid === 'cg-opt' || cid === 'cg-dnd'), [id, REFUSED, told])
}
reset(); id = await O.ghlStoredContactIfAllowed(globalThis.__db, ghl, 'x', { channel: 'sms', contactId: '' })
ck('saved-contact door · no contact id: refused, nothing looked up', id === null && REFUSED.length === 1)

/* ── applicant-reengage: staff only now, and each channel through the door ── */
let h = await load('applicant-reengage')
const apps = () => [{ id: 'a1', first_name: 'Ann', phone: CLEAN_P, email: CLEAN_E, sms_consent: true },
                    { id: 'a2', first_name: 'Bo', phone: OPT_P, email: OPT_E, sms_consent: true }]
reset(); T.job_applicants = apps()
let r = await post(h, 'https://x/functions/v1/applicant-reengage', { ids: ['a1', 'a2'], message: 'we have a new opening' })
ck('applicant-reengage · nobody signed in: refused (401) before anything is read or sent (it trusted anyone before)', r.status === 401 && SENT.length === 0, r)
reset(); T.job_applicants = apps()
r = await post(h, 'https://x/functions/v1/applicant-reengage', { ids: ['a1', 'a2'], message: 'we have a new opening' }, { Authorization: 'Bearer jwt-owner' })
ck('applicant-reengage · signed-in office staff: the clean applicant gets text + email; the opted-out applicant gets nothing and is not counted',
   to(E164(CLEAN_P)) === 1 && to(CLEAN_E) === 1 && to(E164(OPT_P)) === 0 && to(OPT_E) === 0 && r.j?.sent === 1 && REFUSED.length === 2, [r, SENT, REFUSED])

/* ── ht-support: Resend (not GHL) ── */
h = await load('ht-support')
for (const [label, email, want] of [['clean', CLEAN_E, 1], ['opted out', OPT_E, 0]]) {
  reset(); r = await post(h, 'https://x/functions/v1/ht-support?token=H', { name: 'Hal', email, message: 'my TV will not connect' })
  ck(`ht-support · ${label}: ticket saved; confirmation ${want ? 'sent' : 'NOT sent, and the form gets the same answer'}`,
     r.status === 200 && r.j?.ok === true && !!r.j?.ticket_no && RESEND.length === want && (APP.ht_tickets || []).length === 1, [r, RESEND])
}

/* ── resend-relay ── */
h = await load('resend-relay')
for (const [label, addr, want] of [['clean', CLEAN_E, 1], ['opted out', OPT_E, 0]]) {
  reset(); r = await post(h, 'https://x/functions/v1/resend-relay', { token: 'H', from: 'HomeTogether <support@tryhometogether.com>', to: addr, subject: 'S', html: '<p>x</p>' })
  ck(`resend-relay · ${label}: ${want ? 'relayed' : 'not relayed, answered ok:false opted_out (not an error)'}`, RESEND.length === want && (want ? r.j?.ok === true : r.j?.opted_out === true && r.status === 200), [r, RESEND])
}

/* ── source scan: the heavy scheduled senders cannot skip the door ── */
const src = (f) => fs.readFileSync(`${FN}/${f}/index.ts`, 'utf8')
const cfoCalls = (s) => [...s.matchAll(/contactForOutbound\([\s\S]*?\{[^{}]*audience:[^{}]*\}\)/g)].map((m) => m[0])
for (const f of ['coverage-run', 'timekeeper-watch', 'shift-confirm', 'carematch-watch', 'caregiver-availability']) {
  const calls = cfoCalls(src(f)); const bad = calls.filter((c) => !/audience: 'staff'/.test(c) && !/channel: 'sms'/.test(c))
  ck(`scan · ${f}: every contactForOutbound call is a staff alert or names its channel (${calls.length} calls)`, calls.length > 0 && bad.length === 0, bad)
}
const cr = src('coverage-run'), crp = src('coverage-reply')
ck('scan · coverage-run: no text goes to a saved caregiver contact id directly (confirmed and closure texts use the saved-contact door)',
   !/type: 'SMS', contactId: (winner|a)\.ghl_contact_id/.test(cr) && (cr.match(/ghlStoredContactIfAllowed\(/g) || []).length === 2)
ck('scan · coverage-reply: the caregiver acknowledgment uses the saved-contact door', /ghlStoredContactIfAllowed\(sb/.test(crp) && !/await sms\(contactId \|\| a\.ghl_contact_id/.test(crp))
ck('scan · coverage-run: an opted-out caregiver is closed silently (Reopen restores it) and the case still completes',
   /a\.state = 'closed_silent'; a\.optout_skipped = true; optedOut\+\+/.test(cr) && /if \(told \|\| optedOut\)/.test(cr) && /!a\.confirm_optout/.test(cr))
const sw = src('stripe-webhook'), hl = src('ht-local')
ck('scan · stripe-webhook and ht-local: every non-staff email goes through the door (staff = @mo-care.com only)',
   /ghlContactIfAllowed\(supabaseHL/.test(sw) && /@mo-care\\\.com\$\/i\.test/.test(sw) && /ghlContactIfAllowed\(db, \{ token: ghlToken/.test(hl) && /@mo-care\\\.com\$\/i\.test/.test(hl))
const im = src('interview-messages'), rc = src('reference-chase')
ck('scan · interview-messages: all 7 applicant sends use the door; the 4 staff alerts keep their contact',
   (im.match(/await to\.(sms|email)\(/g) || []).length === 9 && (im.match(/= applicantDoor\(/g) || []).length === 4 && !/await sms\(contactId,[^\n]*\n[^\n]*interview/i.test(im))
ck('scan · reference-chase: references and applicants are reached only through the door', (rc.match(/await door\(/g) || []).length === 4 && !/contactFor\(/.test(rc))

console.log('\n0b-3 · CAREGIVER, APPLICANT AND HOMETOGETHER SENDERS · OPT-OUT TEST\n' + '='.repeat(60)); let all = true
for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
