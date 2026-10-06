// Red and yellow shift-note flags (Desktop 470). The real care-notes function against a fake database, AxisCare,
// AI and GoHighLevel (harness from n2_flag_test.mjs). node shift_note_levels_test.mjs
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
const SVC = 'svc_' + 'k'.repeat(60), JOBSEC = 'j'.repeat(64)
const ENV = { HUB_JOB_SECRET: JOBSEC, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HT_ORDER_TOKEN: 'H', HT_SUPPORT_TOKEN: 'H', RESEND_API_KEY: 'r', RELAY_SECRET: 's'.repeat(40) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
globalThis.__dbFor = (key) => ({ from: (t) => { const b = { select() { return b; }, limit() { return Promise.resolve(t === 'identity_door_audit' && key !== SVC ? { data: null, error: { message: 'permission denied' } } : { data: [], error: null }); } }; return b; } })
{ const ja = fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)')
  fs.writeFileSync(`${FN}/_shared/_job-auth_t.ts`, ja) }
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_t.ts`) } catch { /* */ } })
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'../_shared/job-auth.ts'", "'../_shared/_job-auth_t.ts'");
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); } return handler; };
const post = async (h, url, body, headers = {}) => { const r = await h(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) })); let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
const to = (x) => SENT.filter((m) => m.to === 'C:' + x || m.to === x).length




const now = Date.now(), hAgo = (h) => new Date(now - h * 3600e3).toISOString()
const V = {
  f: { id: 'f', client: { id: 601, firstName: 'Ruth', lastName: 'Barnes' }, caregiver: { id: 9, firstName: 'Kim', lastName: 'Aide' }, startDate: hAgo(5), clockOut: { time: hAgo(3) }, careNote: 'Helped with bath. Ruth slipped getting out and hit her arm on the sink, says she is fine.', adls: [] },
  y: { id: 'y', client: { id: 602, firstName: 'Patsy', lastName: 'Lane' }, caregiver: { id: 8, firstName: 'Di', lastName: 'Aide' }, startDate: hAgo(6), clockOut: { time: hAgo(4) }, careNote: 'Good visit overall. Only ate a few bites of lunch again, said she was not hungry.', adls: [] },
  n: { id: 'n', client: { id: 604, firstName: 'Nora', lastName: 'Fine' }, caregiver: { id: 6, firstName: 'Al', lastName: 'Aide' }, startDate: hAgo(7), clockOut: { time: hAgo(5) }, careNote: 'Nora was in good spirits, a quiet day.', adls: [] },
  p: { id: 'p', client: { id: 603, firstName: 'Mo', lastName: 'Pattern' }, caregiver: { id: 7, firstName: 'Bo', lastName: 'Aide' }, startDate: hAgo(8), clockOut: { time: hAgo(6) }, careNote: 'Mo seemed more confused today, asked the same question many times.', adls: [] },
  w: { id: 'w', client: { id: 605, firstName: 'Wes', lastName: 'Wrong' }, caregiver: { id: 5, firstName: 'Cy', lastName: 'Aide' }, startDate: hAgo(9), clockOut: { time: hAgo(7) }, careNote: 'Wes had a sore on his heel.', adls: [] },
  x: { id: 'x', client: { id: 606, firstName: 'Xena', lastName: 'Odd' }, caregiver: { id: 4, firstName: 'Ed', lastName: 'Aide' }, startDate: hAgo(10), clockOut: { time: hAgo(8) }, careNote: 'LEVELFAIL odd', adls: [] } }
let ASK = { level: 0, old: 0 }
const f0 = globalThis.fetch
const LV = (o) => new Response(JSON.stringify({ content: [{ text: JSON.stringify(o) }] }), { status: 200 })
globalThis.fetch = async (url, o) => { url = String(url)
  if (url.includes('axiscare.com')) {
    if (url.includes('/api/visits?')) return new Response(JSON.stringify({ results: { visits: Object.values(V).map(({ careNote, adls, ...r }) => r) } }), { status: 200 })
    const m = url.match(/\/api\/visits\/([^/?]+)$/); if (m && V[m[1]]) return new Response(JSON.stringify({ results: V[m[1]] }), { status: 200 })
    return new Response('{}', { status: 404 }) }
  if (url.includes('api.anthropic.com')) { const b = JSON.parse(o.body); const t = b.messages[0].content
    if (/KIND WORDS/.test(b.system)) return LV({ kind: false, quote: '', who: 'the client' })
    if (/how soon/.test(b.system)) { ASK.level++
      if (/LEVELFAIL/.test(t)) return new Response('{}', { status: 500 })
      if (/slipped/.test(t)) return LV({ level: 'red', kind: 'a fall or injury', why: 'Ruth slipped getting out of the bath and hit her arm.', trigger: 'Ruth slipped getting out and hit her arm on the sink', family_line: 'Ruth slipped after her bath and bumped her arm — she says she is okay.' })
      if (/ate a few bites/.test(t)) return LV({ level: 'yellow', kind: 'eating or drinking', why: 'Patsy ate very little for the second visit in a row.', trigger: 'Only ate a few bites of lunch again', family_line: 'Patsy did not eat much today.' })
      if (/confused/.test(t)) return LV({ level: 'yellow', kind: 'confusion or a change in behavior', why: 'Mo seemed more confused today.', trigger: 'seemed more confused today', family_line: 'Mo seemed a little more confused today.' })
      if (/sore on his heel/.test(t)) return LV({ level: 'yellow', kind: 'skin or a wound', why: 'Wes has a sore on his heel.', trigger: 'a pressure ulcer that is bleeding badly', family_line: '' })
      return LV({ level: 'none', kind: '', why: '', trigger: '', family_line: '' }) }
    ASK.old++
    return LV(/slipped|bites|confused|sore/.test(t) ? { concern: true, kind: 'something else worth a look', urgent: false, why: 'x' } : { concern: false, kind: 'something else worth a look', urgent: false, why: 'ok' }) }
  return f0(url, o) }
ENV.AXISCARE_TOKEN = 'axc_x'; ENV.AXISCARE_SITE = '16485'; ENV.ANTHROPIC_API_KEY = 'sk-ant-x'; ENV.CARE_NOTES_PAUSE_MS = '0'; ENV.GHL_TOKEN = 'g'
const cn = await load('care-notes')
const run = (qs, headers) => post(cn, 'https://x/functions/v1/care-notes?' + qs, {}, headers)
const ANON = 'eyJ' + 'a'.repeat(120)
const CRON = { Authorization: 'Bearer ' + ANON, 'x-cron-secret': JOBSEC }, OWNER = { Authorization: 'Bearer ' + SVC }
const cards = () => (APP.ops_items || []).filter((i) => i.kind === 'care_note')
const card = (ax) => cards().find((i) => i.client_ax === String(ax) && String(i.id).startsWith('ops_carenote_'))
const setup = () => { reset(); T.kind_words = []
  T.domains = [{ code: 'client_care', entity: 'cc_ihs', owner_person: 'p-kry' }, { code: 'incidents', entity: 'cc_ihs', owner_person: 'p-sam' }]
  T.persons.push({ person_id: 'p-kry', active: true, full_name: 'Krystal Land', primary_email: 'krystal@mo-care.com' }, { person_id: 'p-sam', active: true, full_name: 'Samantha Troutman', primary_email: 'samantha@mo-care.com' })
  APP.caregivers = [{ id: 1, first: 'Kim', last: 'Aide', axiscare_id: '9', phone: '4175550909' }]
  APP.coordinator_staff = [{ email: 'krystal@mo-care.com', name: 'Krystal Land', phone: '4175550123' }]
  APP.ops_items = [ { id: 'old1', kind: 'care_note', level: 'yellow', client_ax: '603', status: 'done', created_at: hAgo(24 * 3) }, { id: 'old2', kind: 'care_note', level: 'yellow', client_ax: '603', status: 'open', created_at: hAgo(24 * 9) }, { id: 'old3', kind: 'care_note', level: 'yellow', client_ax: '603', status: 'done', created_at: hAgo(24 * 20) } ]
  ASK = { level: 0, old: 0 } }
const realNow = Date.now; let SHIFT = 0
const atHour = (h) => { const d = new Date(); const chi = Number(d.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false })) % 24; const shift = (h - chi) * 3600e3; SHIFT = shift; Date.now = () => realNow() + shift }

setup(); APP.ops_settings = { care_notes_flag_live: true }
let r = await run('flag=1', CRON)
ck('levels switch off: the old yes/no question runs (as live today), no red/yellow', r.j.levels_switch === false && ASK.level === 0 && ASK.old > 0 && cards().every((c) => !c.level || c.id.startsWith('old')), [r.j, ASK])

setup(); APP.ops_settings = { care_notes_flag_live: false }
r = await run('flag=1&practice=1&hours=48', OWNER); const pj = r.j
ck('practice (switches off): counts reds, yellows and normal days, and the old yes/no to compare', pj.red === 2 && pj.yellow === 2 && pj.normal_day === 1 && pj.pattern_red === 1 && pj.ai_could_not_read === 1 && pj.flagged >= 4, pj)
ck('...and saves nothing, sends nothing; counts only', cards().length === 3 && !SENT.length && !/Ruth|slipped|Patsy/.test(JSON.stringify(pj)), pj)

setup(); APP.ops_settings = { care_notes_flag_live: true, care_notes_levels_live: true }
atHour(10); r = await run('flag=1', CRON); Date.now = realNow
const R = card(601), Y = card(602), P = card(603), W = card(605), X = card(606)
ck('a fall is a RED flag: title, level, why, due in 4 hours, urgent', R && R.level === 'red' && R.title === "Red flag: Ruth's " + R.visit_day + ' visit, a fall or injury' && R.why === 'Ruth slipped getting out of the bath and hit her arm.' && R.urgency === 'urgent' && Math.abs((Date.parse(R.due) - Date.parse(R.created_at) - SHIFT) / 3600e3 - 4) < 0.1, R)
ck("...the caregiver's own words that caused it are kept, to highlight", R.trigger === 'Ruth slipped getting out and hit her arm on the sink' && R.detail.includes('"Helped with bath. Ruth slipped'), R.trigger)
ck('...it goes to Client Care (Krystal) and also shows on the Incidents owner\'s My Work (Samantha)', R.owner === 'krystal@mo-care.com' && JSON.stringify(R.also_for) === '["samantha@mo-care.com"]', [R.owner, R.also_for])
ck("...it carries the caregiver's number (for Call the caregiver, from the office line) and the client", R.caregiver_phone === '4175550909' && R.caregiver === 'Kim Aide' && R.client_ax === '601' && R.flags_14d === 1)
ck('...the family sentence has no em dash', R.family_line === 'Ruth slipped after her bath and bumped her arm, she says she is okay.', R.family_line)
ck('eating less is a YELLOW flag: due in 24 hours, only Client Care', Y && Y.level === 'yellow' && /^Yellow flag: Patsy's .* visit, eating or drinking$/.test(Y.title) && !Y.also_for.length && Math.abs((Date.parse(Y.due) - Date.parse(Y.created_at) - SHIFT) / 3600e3 - 24) < 0.1, Y)
ck('a normal day makes no card at all', !card(604))
ck('the 3rd yellow for one client in 14 days becomes ONE red flag, saying it is a pattern', P && P.level === 'red' && P.pattern_count === 3 && /^Pattern: 3 concerns for Mo in 2 weeks\. /.test(P.why) && P.flags_14d === 3, P)
ck('words the AI made up are never highlighted (no trigger kept)', W && W.trigger === '', W && W.trigger)
ck("a note the AI can't read twice: \"Please read\", its own level", X && X.level === 'unread' && /^Please read: /.test(X.title))
ck('switch for texts off: no text', !SENT.length && r.j.red_texts === 0)

setup(); APP.ops_settings = { care_notes_flag_live: true, care_notes_levels_live: true, care_notes_red_text_live: true }
atHour(10); r = await run('flag=1', CRON); Date.now = realNow
ck('texts on, 10am: each RED flag texts Krystal once (2 reds), yellow ones never', r.j.red_texts === 2 && SENT.length === 2 && card(601).texted_to === 'krystal@mo-care.com' && !card(602).texted_to, [r.j.red_texts, SENT])
setup(); APP.ops_settings = { care_notes_flag_live: true, care_notes_levels_live: true, care_notes_red_text_live: true }
atHour(22); r = await run('flag=1', CRON); Date.now = realNow
ck('texts on, 10pm: no text at night (the card is still there)', r.j.red_texts === 0 && !SENT.length && card(601) && card(601).level === 'red', r.j)
ck('the heartbeat says red and yellow', (APP.automation_heartbeats || []).some((b) => /2 red, 2 yellow/.test(b.note)), APP.automation_heartbeats)
APP.care_notes_state = []; ASK = { level: 0, old: 0 }; r = await run('flag=1', CRON)
ck('the same shifts again: no second card, the AI is not asked again', r.j.already_flagged === 5 && ASK.level === 1, [r.j, ASK])

/* ── 472: re-read the open older flags ── */
setup(); APP.ops_settings = { care_notes_flag_live: true, care_notes_levels_live: true }
APP.ops_items.push(
  { id: 'ops_carenote_old_r', kind: 'care_note', status: 'open', client_ax: '601', about: 'Ruth Barnes', urgency: 'high', due: new Date(now + 20 * 3600e3).toISOString(), owner: 'krystal@mo-care.com', created_at: hAgo(12),
    title: "Possible concern on Ruth's Tue, Oct 6 visit: a fall or injury", detail: 'Kim Aide wrote after the Tue, Oct 6, 9:00 AM visit:\n\n"Helped with bath. Ruth slipped getting out and hit her arm on the sink, says she is fine."\n\nWhy it was flagged: x.\nRead it.', history: [] },
  { id: 'ops_carenote_old_n', kind: 'care_note', status: 'open', client_ax: '604', about: 'Nora Fine', created_at: hAgo(12), owner: 'krystal@mo-care.com',
    title: "Possible concern on Nora's Mon, Oct 5 visit: something else worth a look", detail: 'Al wrote after the visit:\n\n"Nora was in good spirits, a quiet day."\n\nWhy it was flagged: x.' },
  { id: 'ops_carenote_done', kind: 'care_note', status: 'done', about: 'Done One', detail: '"Ruth slipped getting out and hit her arm on the sink"' },
  { id: 'ops_carenote_new', kind: 'care_note', status: 'open', level: 'yellow', about: 'Already New', detail: '"x"' })
ASK = { level: 0, old: 0 }
r = await post(cn, 'https://x/functions/v1/care-notes?regrade=1&practice=1', {}, OWNER)
ck('472 · re-read practice: counts only, changes nothing', r.j.looked === 2 && r.j.red === 1 && r.j.normal_day === 1 && r.j.changed === 0 && !cards().find((c) => c.id === 'ops_carenote_old_r').level, r.j)
r = await post(cn, 'https://x/functions/v1/care-notes?regrade=1', {}, CRON)
ck('472 · only the owner\'s key can re-read (not the schedule\'s, not the public key)', r.status === 401)
r = await post(cn, 'https://x/functions/v1/care-notes?regrade=1', {}, OWNER)
const RR = cards().find((c) => c.id === 'ops_carenote_old_r'), NN = cards().find((c) => c.id === 'ops_carenote_old_n')
ck('472 · an older fall flag becomes a RED flag: level, why, the words, the Incidents owner, day kept in the title', RR.level === 'red' && RR.title === "Red flag: Ruth's Tue, Oct 6 visit, a fall or injury" && RR.why === 'Ruth slipped getting out of the bath and hit her arm.' && RR.trigger === 'Ruth slipped getting out and hit her arm on the sink' && JSON.stringify(RR.also_for) === '["samantha@mo-care.com"]' && RR.urgency === 'urgent', RR)
ck('472 · ...its due time only moves sooner (4 hours), and its history says it was re-read', (Date.parse(RR.due) - Date.now()) / 3600e3 < 4.1 && /Re-read with the new rules: red flag/.test(RR.history.at(-1).text))
ck('472 · an ordinary day is left open and unchanged, and listed for a person to close', NN.status === 'open' && !NN.level && r.j.cards.some((c) => c.client === 'Nora' && /ordinary day/.test(c.level)), [NN, r.j.cards])
ck('472 · done flags and flags that already have a level are not touched; nothing sent', r.j.looked === 2 && r.j.changed === 1 && cards().find((c) => c.id === 'ops_carenote_new').level === 'yellow' && !SENT.length, r.j)

for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
process.exitCode = res.every((x) => x[1]) ? 0 : 1
