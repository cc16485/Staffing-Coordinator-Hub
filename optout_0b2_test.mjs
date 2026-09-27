// Step 0 · 0b-2 · every family, client, inquiry and public-person sender goes through the universal opt-out check.
// The REAL functions against a fake database and a fake GoHighLevel. For each sender: a clean address is messaged; an
// address opted out in the Hub's record, or under GHL Do Not Disturb, is NOT messaged and the refusal is logged.
// node optout_0b2_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions';
const realTLS = Date.prototype.toLocaleString, realTLDS = Date.prototype.toLocaleDateString;
Date.prototype.toLocaleString = function (loc, o) {
  if (o && o.hour === '2-digit' && !o.minute) return '10'; if (o && o.weekday === 'short' && !o.hour) return 'Tue'; return realTLS.call(this, loc, o); };
Date.prototype.toLocaleDateString = function (loc, o) { return (loc === 'en-CA' && o && o.timeZone) ? '2026-01-03' : realTLDS.call(this, loc, o); };

const CLEAN_P = '4175550101', OPT_P = '4175550202', DND_P = '4175550303'
const CLEAN_E = 'clean@example.test', OPT_E = 'optout@example.test', DND_E = 'dnd@example.test'
const E164 = (p) => '+1' + p
let APP, T, SENT, REFUSED, DND
const reset = () => {
  APP = {}; SENT = []; REFUSED = []; DND = new Set([E164(DND_P), DND_E])
  T = {
    contact_optout_current: [{ address: E164(OPT_P), channel: 'sms', opted_out: true, source: 'stop_text' }, { address: OPT_E, channel: 'email', opted_out: true, source: 'staff' }],
    circle_contacts: [], care_circles: [], phone_index: [], circle_messages: [], caregiver_intro_log: [],
    caregiver_profiles: [{ id: 'prof1', first_name: 'Ashley', preferred_name: 'Ash', published: true, status: 'active' }],
    auth_identities: [{ auth_user_id: 'u-owner', person_id: 'p-owner', project_ref: 'zngsgedlsxinbygwmxwn' }],
    persons: [{ person_id: 'p-owner', active: true, full_name: 'Olive Owner' }],
    entity_memberships: [{ person_id: 'p-owner', entity: 'cc_ihs', active: true, ended_at: null }],
    staff_roles: [{ person_id: 'p-owner', entity: 'cc_ihs', role: 'owner_admin' }],
    applicant_alerts: [{ name: 'Office', phone: '4170000000', email: 'office@example.test', alert_on: ['lead'], active: true }],
  }
}
const q = (t) => { const st = { f: [], nn: null }; const b = {
  select() { return b; }, order() { return b; }, limit() { return b; }, in() { return b; }, contains() { return b; }, range() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; }, not(c) { st.nn = c; return b; },
  insert(row) { (T[t] ||= []).push(row); const r = Promise.resolve({ data: row, error: null }); r.select = () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }); return r; },
  update() { return b; }, upsert() { return Promise.resolve({ data: null, error: null }); },
  single() { return b.maybeSingle(); },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })); },
  then(ok) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok); }
    let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v); if (st.nn) rows = rows.filter((r) => r[st.nn] != null)
    return Promise.resolve({ data: rows, error: null }).then(ok);
  } }; return b; };
globalThis.__db = { from: q,
  rpc: async (fn, a) => {
    if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item); }
    if (fn === 'contact_send_refusal_log') REFUSED.push({ sender: a.p_sender, channel: a.p_channel, reasons: a.p_reasons })
    return { data: null, error: null } },
  auth: { getUser: async (jwt) => (jwt === undefined || jwt === 'jwt-owner') ? { data: { user: { id: 'u-owner', email: 'owner@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } };
const contactFor = (body) => { const key = body.phone || body.email; return { id: 'C:' + key, dnd: DND.has(key) } }
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: contactFor(body) }), { status: 200 })
  const gm = url.match(/\/contacts\/C%3A(.+)$/) || url.match(/\/contacts\/C:(.+)$/)
  if (gm && (!o || !o.method || o.method === 'GET')) { const key = decodeURIComponent(gm[1]); return new Response(JSON.stringify({ contact: { id: 'C:' + key, dnd: DND.has(key) } }), { status: 200 }) }
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, type: body.type }); return new Response('{}', { status: 200 }) }
  if (url.includes('/conversations/search')) return new Response(JSON.stringify({ conversations: [] }), { status: 200 })
  if (url.includes('library.json')) return new Response(JSON.stringify([{ key: 'jan1', aud: 'clients', when: 'Early January', subj: 'Hello', head: 'H', ac: '#1c3f63', banner: 'b', blocks: [], body: [] }]), { status: 200 })
  if (url.includes('axiscare.com')) return new Response(JSON.stringify({ clients: [
    { firstName: 'Cleo', lastName: 'Clean', personalEmail: CLEAN_E, status: 'Active' },
    { firstName: 'Otto', lastName: 'Opted', personalEmail: OPT_E, status: 'Active' },
    { firstName: 'Dina', lastName: 'Dnd', personalEmail: DND_E, status: 'Active' }] }), { status: 200 })
  return new Response('{}', { status: 200 })
}
const CRON = 'c'.repeat(48)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', SUPABASE_ANON_KEY: 'a', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc',
  LEAD_INTAKE_TOKEN: 'L', HT_ORDER_TOKEN: 'H', HT_SUPPORT_TOKEN: 'H', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', CAMPAIGN_CRON_SECRET: CRON }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); } return handler; };
const post = async (h, url, body, headers = {}) => { const r = await h(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) })); let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
const to = (x) => SENT.filter((m) => m.to === 'C:' + x).length
const tick = () => new Promise((r) => setTimeout(r, 30))
const refusedFor = (sender) => REFUSED.filter((r) => r.sender === sender)
const WEB = [{ channel: 'web', direction: 'in', outcome: 'inquiry', actor: 'family' }]
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString()

/* ── lead-intake: the instant acknowledgment (switch on for the test) ── */
let h = await load('lead-intake')
for (const [label, phone, email, wantSms, wantMail] of [
  ['clean phone and email: both acknowledged', CLEAN_P, CLEAN_E, 1, 1],
  ['phone opted out (STOP recorded): no text, the email still goes', OPT_P, CLEAN_E, 0, 1],
  ['phone under GHL Do Not Disturb, email opted out: nothing sent', DND_P, OPT_E, 0, 0]]) {
  reset(); APP.ops_settings = { inquiry_ack_live: true }
  const r = await post(h, 'https://x/functions/v1/lead-intake?token=L', { first_name: 'Fay', last_name: 'T', phone, email, interest_notes: 'Mom needs help', source: 'website' })
  const acked = to(E164(phone)) + to(email)
  ck(`lead-intake · ${label}`, r.status === 200 && to(E164(phone)) === wantSms && to(email) === wantMail
    && (wantSms + wantMail === 2 || refusedFor('lead-intake').length === 2 - wantSms - wantMail) && (r.j?.acked === (acked > 0)), [r, SENT, REFUSED])
}

/* ── lead-followup: the ack retry; an opt-out stops automation for that lead for good ── */
h = await load('lead-followup')
reset(); APP.ops_settings = { inquiry_ack_live: true, inquiry_followups_live: true }
APP.leads = [{ id: 'a', first_name: 'Ann', phone: CLEAN_P, status: 'New', created_at: ago(1), contact_events: WEB },
             { id: 'b', first_name: 'Bo', phone: OPT_P, status: 'New', created_at: ago(1), contact_events: WEB }]
let r = await post(h, 'https://x/functions/v1/lead-followup', {})
const bo = APP.leads.find((l) => l.id === 'b')
ck('lead-followup · a clean inquiry is acknowledged; an opted-out one is not, and is marked so automation stops asking',
   to(E164(CLEAN_P)) === 1 && to(E164(OPT_P)) === 0 && bo.auto_msgs_stopped_at && /opt-out/.test(bo.auto_msgs_stop_reason) && !bo.ack_sent_at, [r, SENT, bo])
const before = REFUSED.length; r = await post(h, 'https://x/functions/v1/lead-followup', {})
ck('lead-followup · the next run does not ask again for the stopped inquiry (no new refusal, nothing sent)', REFUSED.length === before && to(E164(OPT_P)) === 0, [REFUSED.length, before])

/* ── the live GoHighLevel check (server-only, yes/no answers, sends nothing) ── */
reset(); r = await post(h, 'https://x/functions/v1/lead-followup?probe_dnd=1', {})
ck('DND probe · refused without the server key', r.status === 401 && SENT.length === 0, r)
const jwt = (claims) => 'x.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.sig'
reset(); r = await post(h, 'https://x/functions/v1/lead-followup?probe_dnd=1', {}, { Authorization: 'Bearer ' + jwt({ role: 'authenticated', sub: 'u1' }) })
ck('DND probe · refused for a signed-in staff token or the public anon key (not the server role)', r.status === 401 && SENT.length === 0, r)
reset(); r = await post(h, 'https://x/functions/v1/lead-followup?probe_dnd=1', {}, { Authorization: 'Bearer ' + jwt({ role: 'anon' }) })
ck('DND probe · refused for the anon role', r.status === 401, r)
reset(); r = await post(h, 'https://x/functions/v1/lead-followup?probe_dnd=1', {}, { Authorization: 'Bearer ' + jwt({ role: 'service_role', iss: 'supabase' }) })
ck('DND probe · a server-role sign-in (verified by the platform) is accepted even when it is not the same string as the function\'s key', r.status === 200 && r.j?.probe === 'dnd', r)
reset(); r = await post(h, 'https://x/functions/v1/lead-followup?probe_dnd=1', {}, { Authorization: 'Bearer k' })
ck('DND probe · with the server key: answers yes/no only (no names, numbers or ids), sends nothing, runs no sweep',
   r.status === 200 && r.j?.upsert_has_dnd === true && r.j?.get_has_dnd === true && r.j?.check_reads_ok === true && SENT.length === 0 && !/417|C:|Office/.test(JSON.stringify(r.j)) && !APP.leads, r)

/* ── lead-nurture: a step to an opted-out lead stops that drip ── */
h = await load('lead-nurture')
reset(); APP.leads = [
  { id: 'n1', first_name: 'Nia', phone: CLEAN_P, email: CLEAN_E, status: 'Contacted', nurture_sequence: 'not_ready', nurture_step: 0, nurture_started_at: ago(24 * 4) },
  { id: 'n2', first_name: 'Ned', phone: DND_P, email: CLEAN_E, status: 'Contacted', nurture_sequence: 'not_ready', nurture_step: 0, nurture_started_at: ago(24 * 4) }]
r = await post(h, 'https://x/functions/v1/lead-nurture', {})
const n2 = APP.leads.find((l) => l.id === 'n2'), n1 = APP.leads.find((l) => l.id === 'n1')
ck('lead-nurture · the day-3 text reaches the clean lead (phone-keyed contact); the Do Not Disturb lead gets nothing and the drip stops',
   to(E164(CLEAN_P)) === 1 && n1.nurture_step === 1 && to(E164(DND_P)) === 0 && n2.nurture_stopped_at && /opted out/.test(n2.nurture_stop_reason) && r.j?.stopped_optout === 1, [r, SENT, n2])

/* ── campaign-auto: the scheduled run, active-client audience (switch on for the test) ── */
h = await load('campaign-auto')
reset(); APP.campaign_settings = [{ id: 'settings', enabled: true, aud_clients: true }]; APP.leads = [{ id: 'L9', email: DND_E }]
r = await post(h, 'https://x/functions/v1/campaign-auto', {}, { 'x-cron-secret': CRON })
ck('campaign-auto · the clean client is emailed; the opted-out and Do Not Disturb clients are not, and the log counts them',
   to(CLEAN_E) === 1 && to(OPT_E) === 0 && to(DND_E) === 0 && APP.campaign_log?.[0]?.not_sent_optout_or_unreachable === 2 && refusedFor('campaign-auto').length === 2, [r, SENT, APP.campaign_log])
ck('campaign-auto · a GHL Do Not Disturb is still copied onto the matching Hub inquiry', APP.leads[0].do_not_contact === true, APP.leads)

/* ── campaign-send: staff-pressed campaign ── */
h = await load('campaign-send')
reset(); r = await post(h, 'https://x/functions/v1/campaign-send', { subject: 'S', html: '<p>x</p>', tag: 'client',
  recipients: [{ email: CLEAN_E, name: 'C' }, { email: OPT_E, name: 'O' }, { email: DND_E, name: 'D' }] }, { Authorization: 'Bearer jwt-owner' })
ck('campaign-send · only the clean address is emailed; the other two come back "opted out (not sent)"',
   r.j?.sent === 1 && to(CLEAN_E) === 1 && r.j.results.filter((x) => x.err === 'opted out (not sent)').length === 2, r)

/* ── cc-booking: the family's own confirmation ── */
h = await load('cc-booking')
for (const [label, email, want] of [['clean email: confirmation sent', CLEAN_E, 1], ['opted-out email: no confirmation, the booking is still saved and the office still told', OPT_E, 0]]) {
  reset()
  const slots = await (await h(new Request('https://x/functions/v1/cc-booking?token=H&action=slots', { method: 'GET' }))).json()
  const start = slots.days?.flatMap((d) => d.slots)?.[0]?.iso
  r = await post(h, 'https://x/functions/v1/cc-booking?token=H', { name: 'Bea Booker', phone: CLEAN_P, email, type: 'phone', start })
  ck(`cc-booking · ${label}`, !!start && r.status === 200 && to(email) === want && r.j?.confirmed === (want === 1)
     && (APP.consult_bookings || []).length === 1 && to('samantha@mo-care.com') === 1, [r, SENT, start])
}

/* ── cc-memories: the new-video email to the family decision maker ── */
h = await load('cc-memories')
for (const [label, email, want] of [['clean', CLEAN_E, 1], ['opted out', OPT_E, 0]]) {
  reset(); APP.memory_players = [{ id: 'pl1', token: 'k1', name: 'Pat', clients: ['c1'], active: true }]
  APP.memory_clients = [{ id: 'c1', name: 'Mae Client', dm_email: email, decision_maker: 'Dee Maker', token: 't1' }]
  APP.memory_videos = [{ id: 'v1', player_id: 'pl1', client_id: 'c1', prompt: 'Q', status: 'uploading' }]
  r = await post(h, 'https://x/functions/v1/cc-memories?token=H', { action: 'player:complete', k: 'k1', id: 'v1', size: 10, seconds: 5 }); await tick()
  ck(`cc-memories · ${label} decision maker: ${want ? 'emailed' : 'not emailed, refusal logged'}`, r.status === 200 && to(email) === want && (want || refusedFor('cc-memories').length === 1), [r, SENT, REFUSED])
}

/* ── cc-corner: the reply notice to the person who posted ── */
h = await load('cc-corner')
for (const [label, email, want] of [['clean', CLEAN_E, 1], ['Do Not Disturb', DND_E, 0]]) {
  reset(); APP.corner_posts = [{ id: 'p1', name: 'Poe', email, title: 'T', replies: [{ id: 'r1', status: 'approved', body: 'hi', team: true }] }]
  r = await post(h, 'https://x/functions/v1/cc-corner?token=H', { action: 'notify', post_id: 'p1', reply_id: 'r1' })
  ck(`cc-corner · ${label} poster: ${want ? 'notified' : 'not notified, refusal logged'}`, to(email) === want && (want || refusedFor('cc-corner').length === 1), [r, SENT])
}

/* ── circle-send: each channel its own contact, each checked ── */
h = await load('circle-send')
reset(); T.care_circles = [{ id: 'circ1', client_name: 'Mae Client', axiscare_client_id: '99', active: true }]
T.circle_contacts = [
  { id: 1, circle_id: 'circ1', name: 'Cleo Clean', phone: CLEAN_P, email: OPT_E, sms_consent: true, wants_general: true },
  { id: 2, circle_id: 'circ1', name: 'Dina Dnd', phone: DND_P, email: CLEAN_E, sms_consent: true, wants_general: true }]
r = await post(h, 'https://x/functions/v1/circle-send', { circle_id: 'circ1', kind: 'update', body: 'Hello' }, { Authorization: 'Bearer jwt-owner' })
ck('circle-send · texts go only to the clean number, emails only to the clean address; the text contact is found by the phone alone',
   to(E164(CLEAN_P)) === 1 && to(OPT_E) === 0 && to(E164(DND_P)) === 0 && to(CLEAN_E) === 1 && r.j?.reached === 2 && r.j?.opted_out === 2, [r, SENT])

/* ── caregiver-intro ── */
h = await load('caregiver-intro')
reset(); r = await post(h, 'https://x/functions/v1/caregiver-intro', { profile_id: 'prof1', client_name: 'Mae Client',
  contacts: [{ name: 'Otto Opted', phone: OPT_P, email: CLEAN_E, sms_consent: true }] }, { Authorization: 'Bearer jwt-owner' })
ck('caregiver-intro · the opted-out number gets no text; the clean email still gets the introduction', to(E164(OPT_P)) === 0 && to(CLEAN_E) === 1 && r.j?.opted_out === 1, [r, SENT])

/* ── the caregiver-change text (coverage-run) ── */
const outreach = await import(path.join(process.cwd(), FN, '_shared/outreach.ts'))
const fam = await import(path.join(process.cwd(), FN, '_shared/family-change-text.ts'))
const CASE = { client: 'Mae Client', client_axiscare_id: '99', calling_off: 'Ashley A', covered_by: 'Bree B' }
const APPROVED = { family_caregiver_change_text_approved: { by: 'Samantha' } }
for (const [label, phones, outcome, count] of [
  ['one clean and one opted-out member: the clean one is texted', [CLEAN_P, OPT_P], 'sent', 1],
  ['every member opted out or Do Not Disturb: complete with "every_member_opted_out", not a retry loop', [OPT_P, DND_P], 'none', 0]]) {
  reset(); T.care_circles = [{ id: 'circ1', client_name: 'Mae Client', axiscare_client_id: '99', active: true }]
  T.circle_contacts = phones.map((p, i) => ({ id: i, circle_id: 'circ1', name: 'M' + i, phone: p, sms_consent: true, wants_changes: true }))
  const fr = await fam.notifyFamilyOfChange(globalThis.__db, { token: 'g', locationId: 'loc' }, CASE, APPROVED, { whenText: 'today' })
  ck(`caregiver-change text · ${label}`, fr.outcome === outcome && fr.count === count && (outcome === 'sent' || fr.reason === 'every_member_opted_out'), [fr, SENT])
}

/* ── the shared door itself: an unwired family send cannot slip through ── */
reset()
const miss = await outreach.contactForOutbound(globalThis.__db, { token: 'g', locationId: 'loc' }, { phone: CLEAN_P }, 'reactive_external', { audience: 'family', humanInitiated: true })
ck('contactForOutbound · a family send that does not name its channel is refused (so no family sender can skip the opt-out check)', miss === null)
const cg = await outreach.contactForOutbound(globalThis.__db, { token: 'g', locationId: 'loc' }, { phone: CLEAN_P }, 'urgent_internal', { audience: 'caregiver' })
ck('contactForOutbound · caregiver sends are unchanged in this slice (0b-3 moves them)', cg && cg.contactId === 'C:' + E164(CLEAN_P))

console.log('\n0b-2 · FAMILY, CLIENT AND INQUIRY SENDERS · OPT-OUT TEST\n' + '='.repeat(60)); let all = true
for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
