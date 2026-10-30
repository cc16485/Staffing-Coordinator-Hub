// CALMER SHIFT-NOTE FLAGS (2026-10-30, plan VGeWn63w7ue8WE7GS4ogJ6, her approval with all three recommendations). The real
// care-notes function against a fake database, AxisCare, AI and GoHighLevel (the 470 harness). Made-up people only.
//   node calm_flags_test.mjs
import fs from 'fs'; import path from 'path';
/* The visit fixtures are hours before "now" and atHour(h) moves Date.now by (h minus the real Chicago hour), so the run
   only lined up when the test ran near 10am Central (it was written 2026-10-06 around then). Pin the clock to 10:00
   Central that day; new Date() stays on the pinned clock and Date.now is still moved by atHour, as before. */
{ const RealDate = Date, FIXED = RealDate.parse('2026-10-06T15:00:00Z')
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [FIXED])) } static now() { return FIXED } } }
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
      if (/marked as usual for Patsy/.test(t) && /eating or drinking: /.test(t) && /ate a few bites/.test(t)) return LV({ level: 'none', kind: '', why: '', trigger: '', family_line: '' })
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


const lib = await import(path.join(process.cwd(), FN, '_shared', 'calm-flags.ts'))
const DAY = 864e5
ck('lib: only calm_flags_live === true counts', lib.calmOn({ calm_flags_live: true }) && !lib.calmOn({ calm_flags_live: 'yes' }) && !lib.calmOn({}))
ck('lib: a fall, neglect and medication never combine and can never be marked normal', !lib.combinable('a fall or injury') && !lib.combinable('signs of neglect or abuse') && !lib.combinable('medication') && lib.combinable('sleep'))
ck('lib: marks in force for one client; removed marks and a fall mark do not count', JSON.stringify(Object.keys(lib.normalsFor([{ client_ax: '1', kind: 'sleep', note: 'x' }, { client_ax: '1', kind: 'mood', removed_at: 'y' }, { client_ax: '1', kind: 'a fall or injury' }, { client_ax: '2', kind: 'sleep' }], '1'))) === '["sleep"]')
ck('lib: the reader is told the usual, and told to flag only worse or different', /marked as usual for Patsy:\n- sleep: up at night/.test(lib.usualBlock({ sleep: { note: 'up at night' } }, 'Patsy')) && /worse than usual or different from usual/.test(lib.usualBlock({ sleep: {} }, 'Patsy')) && lib.usualBlock({}, 'P') === '')
const base = { kind: 'care_note', status: 'open', client_ax: '9', about: 'Dan Test', flag_kind: 'sleep', level: 'yellow', urgency: 'normal' }
const c1 = { ...base, id: 'a', created_at: new Date(now - 2 * DAY).toISOString(), due: new Date(now + DAY).toISOString(), caregiver: 'Kim', visit_day: 'Sun, Oct 4', detail: 'Kim wrote after the visit:\n\n"Dan slept badly."\n\nWhy' }
ck('lib: an older card with no notes is one note, from its own words', lib.notesOf(c1).length === 1 && lib.notesOf(c1)[0].words === 'Dan slept badly.')
const n2 = { key: 'v2', at: new Date(now).toISOString(), day: 'Tue, Oct 6', caregiver: 'Bo', words: 'Dan was up all night.', level: 'yellow' }
const m = lib.addNote(c1, n2, { level: 'yellow', pattern: 0, why: 'Dan slept badly again.', nowMs: now })
ck('lib: a second note goes on the card, newest first; the title counts notes', m.notes.length === 2 && m.notes[0].key === 'v2' && m.title === 'Yellow flag: Dan, sleep: 2 notes since Oct 4' && /Bo wrote after the Tue, Oct 6 visit:\n"Dan was up all night\."/.test(m.detail), m.title)
ck('lib: the same visit twice is not added again', lib.addNote(m, n2, { level: 'yellow', pattern: 0, why: '', nowMs: now }) === null)
const m2 = lib.addNote(m, { ...n2, key: 'v3' }, { level: 'red', pattern: 3, why: 'Pattern', nowMs: now })
const m3 = lib.addNote(m2, { ...n2, key: 'v4' }, { level: 'yellow', pattern: 0, why: '', nowMs: now })
ck('lib: level only goes up (red stays red); turning red brings the due time to 4 hours', m2.level === 'red' && m2.urgency === 'urgent' && Date.parse(m2.due) <= now + 4 * 3600e3 && m3.level === 'red')
ck('lib: the pattern counts each note on a combined card', lib.recentNotes([m], '9', now).yellows === 2 && lib.recentNotes([m], '8', now).flags === 0)
const items = [
  { ...base, id: 's1', created_at: new Date(now - 2 * DAY).toISOString(), cn_actions: [{ what: 'called' }] },
  { ...base, id: 's2', created_at: new Date(now - 4 * DAY).toISOString(), level: 'red' },
  { ...base, id: 's3', created_at: new Date(now - 9 * DAY).toISOString() },
  { ...base, id: 'e1', flag_kind: 'eating or drinking', created_at: new Date(now - 10 * DAY).toISOString() },
  { ...base, id: 'f1', flag_kind: 'a fall or injury', level: 'red', created_at: new Date(now - 10 * DAY).toISOString() },
  { ...base, id: 'u1', level: 'unread', flag_kind: '', created_at: new Date(now - 10 * DAY).toISOString() },
  { ...base, id: 'd1', status: 'done', created_at: new Date(now - 3 * DAY).toISOString() } ]
const p = lib.cleanupPlan(items, now)
ck('cleanup: three sleep cards become one (the newest), red if any was red, every note and step kept', p.keep.length === 1 && p.keep[0].id === 's1' && p.keep[0].notes.length === 3 && p.keep[0].level === 'red' && p.keep[0].cn_actions.length === 1 && /3 notes since/.test(p.keep[0].title), p.keep[0] && p.keep[0].title)
ck('cleanup: the other two close as combined into it', JSON.stringify(p.combined.map((x) => x.card.id).sort()) === '["s2","s3"]' && lib.closedInto(items[1], 's1', now).resolution_code === 'combined' && lib.closedInto(items[1], 's1', now).combined_into === 's1')
ck('cleanup: a topic with no new note in 7 days closes as quiet for a week, and says how to reopen', p.quiet.length === 1 && p.quiet[0].id === 'e1' && p.quiet[0].status === 'done' && p.quiet[0].resolution_code === 'quiet_week' && /Reopen it/.test(p.quiet[0].close_note))
ck('cleanup: a fall, an unread note and done cards are never touched', p.before === 4 && ![...p.keep, ...p.quiet, ...p.combined.map((x) => x.card)].some((c) => ['f1', 'u1', 'd1'].includes(c.id)))

/* ── the real run ── */
const setupCalm = (extra) => { setup(); APP.ops_settings = Object.assign({ care_notes_flag_live: true, care_notes_levels_live: true, care_notes_red_text_live: true, calm_flags_live: true }, extra || {})
  APP.care_notes_state = [{ id: 'state', last_look: '', calm_cleanup_at: '2026-10-01T00:00:00Z' }]   /* cleanup already done unless a test clears it */
  APP.ops_items.push({ id: 'ops_carenote_patsy_prev', kind: 'care_note', status: 'open', level: 'yellow', flag_kind: 'eating or drinking', client_ax: '602', about: 'Patsy Lane', created_at: hAgo(30), due: hAgo(-10), owner: 'krystal@mo-care.com',
    caregiver: 'Al Aide', visit_day: 'Sun, Oct 4', title: "Yellow flag: Patsy's Sun, Oct 4 visit, eating or drinking", detail: 'Al Aide wrote after the visit:\n\n"Patsy skipped breakfast."\n\nWhy', history: [] }) }

setupCalm({ calm_flags_live: false }); atHour(10); let r = await run('flag=1', CRON); Date.now = realNow
ck('switch off: flags work as today (Patsy\'s eating note makes its own card; the pattern texts too)', r.j.calm_switch === false && card(602) && new Set(cards().filter((c) => c.client_ax === '602' && c.status === 'open').map((c) => c.id)).size === 2 && r.j.red_texts === 2, [r.j.calm_switch, r.j.red_texts])

setupCalm(); atHour(10); r = await run('flag=1', CRON); Date.now = realNow
const PP = cards().find((c) => c.id === 'ops_carenote_patsy_prev')
ck('on: Patsy\'s new eating note goes onto her open eating card, no second card', r.j.calm_switch === true && new Set(cards().filter((c) => c.client_ax === '602' && c.status === 'open').map((c) => c.id)).size === 1 && PP.notes.length === 2 && r.j.calm_added_to_card === 1, [r.j, PP && PP.notes])
ck('on: the card lists both notes, newest first, and counts them in the title', /^Yellow flag: Patsy, eating or drinking: 2 notes since Oct 4$/.test(PP.title) && PP.notes[0].words.startsWith('Good visit overall') && /Al Aide wrote after the Sun, Oct 4 visit/.test(PP.detail), PP.title)
ck('on: a fall still gets its own red card and still texts Krystal', card(601) && card(601).level === 'red' && card(601).texted_to === 'krystal@mo-care.com')
ck('on: the "3 in 2 weeks" pattern still turns Mo red, but never texts (decision 1)', card(603) && card(603).level === 'red' && card(603).pattern_count === 3 && !card(603).texted_to && r.j.red_texts === 1 && SENT.length === 1, [r.j.red_texts, SENT])
ck('on: a new card carries its note, so the next one can join it', card(605) && card(605).notes.length === 1 && card(605).notes[0].words === 'Wes had a sore on his heel.')

setupCalm(); APP.client_flag_normals = [{ id: 'n1', client_ax: '602', kind: 'eating or drinking', note: 'Patsy eats very little; usual for her', by: 'Krystal Land', at: hAgo(48) },
  { id: 'n2', client_ax: '601', kind: 'a fall or injury', note: 'should never apply' }]
atHour(10); r = await run('flag=1', CRON); Date.now = realNow
const PP2 = cards().find((c) => c.id === 'ops_carenote_patsy_prev')
ck('normal for Patsy: the reader is told, a usual note makes no card and joins nothing', PP2.notes === undefined && r.j.calm_added_to_card === 0 && r.j.calm_usual_marks >= 1 && r.j.normal_day >= 2, [r.j, PP2.notes])
ck('normal can never quiet a fall: Ruth\'s fall is still a red card', card(601) && card(601).level === 'red')

setupCalm(); APP.care_notes_state = [{ id: 'state', last_look: '' }]
APP.ops_items.push(
  { id: 'ops_carenote_dan_a', kind: 'care_note', status: 'open', level: 'yellow', flag_kind: 'sleep', client_ax: '700', about: 'Dan Test', created_at: hAgo(48), owner: 'krystal@mo-care.com', detail: 'X wrote:\n\n"Dan up at night."\n\nWhy' },
  { id: 'ops_carenote_dan_b', kind: 'care_note', status: 'open', level: 'yellow', flag_kind: 'sleep', client_ax: '700', about: 'Dan Test', created_at: hAgo(96), owner: 'krystal@mo-care.com', detail: 'Y wrote:\n\n"Dan restless."\n\nWhy' },
  { id: 'ops_carenote_dan_q', kind: 'care_note', status: 'open', level: 'yellow', flag_kind: 'mood', client_ax: '700', about: 'Dan Test', created_at: hAgo(24 * 10), owner: 'krystal@mo-care.com', detail: 'Z wrote:\n\n"Dan grumpy."\n\nWhy' },
  { id: 'ops_carenote_dan_f', kind: 'care_note', status: 'open', level: 'red', flag_kind: 'a fall or injury', client_ax: '700', about: 'Dan Test', created_at: hAgo(24 * 10), owner: 'krystal@mo-care.com', detail: '"Dan fell"' })
const beforeIds = JSON.stringify(cards().map((c) => [c.id, c.status]))
r = await post(cn, 'https://x/functions/v1/care-notes?calm_cleanup=1&practice=1', {}, OWNER)
ck('cleanup practice (owner key): counts only, changes nothing', r.j.practice === true && r.j.combined_away === 1 && r.j.quiet_closed === 1 && r.j.written === 0 && JSON.stringify(cards().map((c) => [c.id, c.status])) === beforeIds, r.j)
ck('cleanup: only the owner\'s key, and never live by request', (await post(cn, 'https://x/functions/v1/care-notes?calm_cleanup=1&practice=1', {}, CRON)).status === 401 && (await post(cn, 'https://x/functions/v1/care-notes?calm_cleanup=1', {}, OWNER)).status === 400)
atHour(10); r = await run('flag=1', CRON); Date.now = realNow
const byId = (id) => cards().find((c) => c.id === id)
ck('first live run with the switch on: the cleanup runs once', r.j.calm_cleanup && r.j.calm_cleanup.combined_away === 1 && r.j.calm_cleanup.quiet_closed === 1 && r.j.calm_cleanup.errors === 0 && !!(APP.care_notes_state.find((x) => x.id === 'state') || {}).calm_cleanup_at, r.j.calm_cleanup)
ck('...Dan\'s two sleep cards are one; the other closed as combined into it', byId('ops_carenote_dan_a').status === 'open' && byId('ops_carenote_dan_a').notes.length === 2 && byId('ops_carenote_dan_b').status === 'done' && byId('ops_carenote_dan_b').combined_into === 'ops_carenote_dan_a')
ck('...Dan\'s mood topic, quiet 10 days, closed as quiet for a week; his fall card untouched', byId('ops_carenote_dan_q').resolution_code === 'quiet_week' && byId('ops_carenote_dan_f').status === 'open' && !byId('ops_carenote_dan_f').notes)
ck('...the state keeps its last look too (the cleanup mark is not lost)', !!(APP.care_notes_state.find((x) => x.id === 'state') || {}).last_look && !!(APP.care_notes_state.find((x) => x.id === 'state') || {}).calm_cleanup_at)
r = await run('flag=1', CRON)
ck('the next run does not clean up again', r.j.calm_cleanup === null, r.j.calm_cleanup)
ck('nothing was emailed to anyone', !RESEND.length)

for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
process.exitCode = res.every((x) => x[1]) ? 0 : 1
