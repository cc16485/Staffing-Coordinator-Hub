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



/* ── N2: flag concerning shift notes ── */
const now = Date.now(), hAgo = (h) => new Date(now - h * 3600e3).toISOString()
const V = {
  f: { id: 'f', client: { id: 501, firstName: 'Ruth', lastName: 'Test' }, caregiver: { id: 9, firstName: 'Cara', lastName: 'Giver' }, startDate: hAgo(5), clockOut: { time: hAgo(3), method: 'Mobile' }, careNote: 'Ruth slipped in the bathroom and hit her arm, says she is fine.', adls: [{ name: 'Bathing', status: 0, note: 'Refused' }] },
  n: { id: 'n', client: { id: 502, firstName: 'Nora', lastName: 'Fine' }, caregiver: { id: 8, firstName: 'Ben', lastName: 'Helper' }, startDate: hAgo(6), clockOut: { time: hAgo(4), method: 'Mobile' }, careNote: 'Nora was in good spirits, ate lunch, completed all tasks.', adls: [] },
  x: { id: 'x', client: { id: 503, firstName: 'Xena', lastName: 'Odd' }, caregiver: { id: 7, firstName: 'Al', lastName: 'Aide' }, startDate: hAgo(7), clockOut: { time: hAgo(5), method: 'Web' }, careNote: 'AIFAIL something odd', adls: [] },
  e: { id: 'e', client: { id: 504, firstName: 'Ed', lastName: 'Empty' }, caregiver: { id: 6, firstName: 'Di', lastName: 'Aide' }, startDate: hAgo(8), clockOut: { time: hAgo(6), method: 'Mobile' }, careNote: null, adls: [{ name: 'Meals', status: 1, note: '' }] },
  o: { id: 'o', client: { id: 505, firstName: 'Old', lastName: 'Visit' }, caregiver: { id: 5, firstName: 'Ola', lastName: 'Aide' }, startDate: hAgo(60), clockOut: { time: hAgo(58), method: 'Mobile' }, careNote: 'Fell down the stairs', adls: [] } }
let AX = [], AI = [], SLOW = false
const f0 = globalThis.fetch
globalThis.fetch = async (url, o) => { url = String(url)
  if (url.includes('axiscare.com')) { AX.push(url)
    if (url.includes('/api/visits?')) return new Response(JSON.stringify({ results: { visits: Object.values(V).map(({ careNote, adls, ...r }) => r) } }), { status: 200 })
    if (SLOW) return new Response('{}', { status: 429, headers: { 'retry-after': '1' } })
    const m = url.match(/\/api\/visits\/([^/?]+)$/); if (m && V[m[1]]) return new Response(JSON.stringify({ results: V[m[1]] }), { status: 200 })
    return new Response('{}', { status: 404 }) }
  if (url.includes('api.anthropic.com')) { const b = JSON.parse(o.body); const t = b.messages[0].content
    if (/KIND WORDS/.test(b.system)) return new Response(JSON.stringify({ content: [{ text: '{"kind":false,"quote":"","who":"the client"}' }] }), { status: 200 })   /* My Desk 6b's own question: tested in my_desk_466_test.mjs */
    AI.push(t)
    if (/AIFAIL/.test(t)) return new Response('{}', { status: 500 })
    const fall = /slipped|fell/i.test(t)
    return new Response(JSON.stringify({ content: [{ text: JSON.stringify(fall ? { concern: true, kind: 'a fall or injury', urgent: true, why: 'She slipped and hit her arm.', family_line: 'Ruth slipped in the bathroom and bumped her arm \u2014 she says she is okay.' } : { concern: false, kind: 'something else worth a look', urgent: false, why: 'A normal day.' }) }] }), { status: 200 }) }
  return f0(url, o) }
ENV.AXISCARE_TOKEN = 'axc_x'; ENV.AXISCARE_SITE = '16485'; ENV.ANTHROPIC_API_KEY = 'sk-ant-x'; ENV.CARE_NOTES_PAUSE_MS = '0'
let cn = await load('care-notes')
const run = (qs, headers) => post(cn, 'https://x/functions/v1/care-notes?' + qs, {}, headers)
const ANON = 'eyJ' + 'a'.repeat(120)
const CRON = { Authorization: 'Bearer ' + ANON, 'x-cron-secret': JOBSEC }, OWNER = { Authorization: 'Bearer ' + SVC }
const items = () => (APP.ops_items || []).filter((i) => i.kind === 'care_note')
reset(); APP.ops_settings = { care_notes_flag_live: false }
let r = await run('flag=1', CRON)
ck('N2 · switched off: the schedule\'s run does nothing (no AxisCare, no AI)', r.j && r.j.off === true && AX.length === 0 && AI.length === 0, r.j)
r = await run('flag=1', { Authorization: 'Bearer ' + ANON }); ck('N2 · the public key: refused', r.status === 401)
r = await run('flag=1&practice=1&hours=48', CRON); ck('N2 · a practice run needs the owner\'s key (not the schedule\'s)', r.status === 401)
AX = []; AI = []; r = await run('flag=1&practice=1&hours=48', OWNER); const pj = r.j
ck('N2 · practice (48 hours): reads, asks, counts; saves nothing', r.status === 200 && pj.practice === true && pj.days_with_words === 3 && pj.asked === 3 && pj.flagged === 2 && pj.urgent === 1 && pj.ai_could_not_read === 1 && pj.by_kind['a fall or injury'] === 1 && !items().length && !(APP.care_notes_state || []).length, pj)
ck('N2 · the practice answer is counts only: no words, no names', !/slipped|Ruth|Cara|spirits/.test(JSON.stringify(pj)), pj)
ck('N2 · the older shift (58 hours ago) is outside the window; a day with no words isn\'t asked about', !AI.some((t) => /stairs/.test(t)) && AI.length === 4 && AI.filter((t) => /AIFAIL/.test(t)).length === 2, AI)   /* the unreadable note is tried twice (2026-09-29 retry) */
APP.ops_settings = { care_notes_flag_live: true }; AX = []; AI = []
T.domains = [{ code: 'client_care', entity: 'cc_ihs', owner_person: 'p-kry' }]; T.persons.push({ person_id: 'p-kry', active: true, full_name: 'Krystal Land', primary_email: 'Krystal@mo-care.com' })
r = await run('flag=1', CRON); const it = items()
ck('N2 · live: the fall and the unreadable note become Needs Attention items; the normal day does not', r.j.items_made === 2 && it.length === 2 && !it.some((i) => /Nora/.test(i.about)), [r.j, it.map((i) => i.title)])
const fall = it.find((i) => /Ruth/.test(i.about))
ck('N2 · the item shows the caregiver\'s words, the not-done task, why, the client and a link to the profile', fall && /"Ruth slipped in the bathroom/.test(fall.detail) && /Bathing: not done \("Refused"\)/.test(fall.detail) && /Why it was flagged: She slipped/.test(fall.detail) && fall.client_ax === '501' && fall.caregiver === 'Cara Giver' && /a fall or injury/.test(fall.title), fall)
ck('468 · a new flag lands on whoever owns Client Care (not on nobody)', fall.owner === 'krystal@mo-care.com' && fall.owner_name === 'Krystal Land', [fall.owner, fall.owner_name])
ck('N3 · the item carries a suggested family sentence (no em dash)', fall.family_line === 'Ruth slipped in the bathroom and bumped her arm, she says she is okay.', fall.family_line)
ck('N2 · a fall is urgent: due in 4 hours; the unreadable one is normal, due in 24', fall.urgency === 'high' && (new Date(fall.due) - now) / 3600e3 < 4.1 && it.find((i) => /Xena/.test(i.about)).urgency === 'normal')
ck('N2 · it says it never contacts anyone, and nothing was sent', /never contacts anyone/.test(fall.detail) && SENT.length === 0, SENT)
ck('N2 · the last look is recorded, and a heartbeat', (APP.care_notes_state || [])[0] && (APP.automation_heartbeats || []).some((b) => b.automation === 'care-notes-flag'))
APP.care_notes_state = []; AI = []; r = await run('flag=1', CRON)
ck('N2 · the same shifts again: not flagged twice', r.j.already_flagged === 2 && items().length === 2 && AI.length === 1, [r.j, AI.length])
APP.care_notes_state = []; SLOW = true; r = await run('flag=1', CRON); SLOW = false
ck('N2 · if AxisCare says slow down, the run stops and the last look is NOT moved on (next run retries)', r.j.stopped_early === true && !(APP.care_notes_state || []).length, r.j)

/* 2026-09-29 · a failed read is retried once, and one that still fails gets its own label (not a "concern") */
{ const src = fs.readFileSync(`${FN}/care-notes/index.ts`, 'utf8')
  ck('N2 · the AI gets a larger answer allowance (the family sentence made answers longer)', /max_tokens: 400/.test(src))
  const itU = items().find((x) => /AI couldn't read it/.test(x.title))
  ck('N2 · a note the AI still can\'t read is titled "Please read ... (the AI couldn\'t read it)", not filed as "something else worth a look"', itU && /^Please read: /.test(itU.title) && !/something else worth a look/.test(itU.title) && /couldn't read this note \(twice\)/.test(itU.detail), itU)
  let calls = 0; const f1 = globalThis.fetch
  globalThis.fetch = async (url, o) => { if (String(url).includes('api.anthropic.com')) { calls++; if (calls === 1) return new Response('{}', { status: 529 })
      return new Response(JSON.stringify({ content: [{ text: '{"concern":false,"kind":"something else worth a look","urgent":false,"why":"A normal day."}' }] }), { status: 200 }) } return f1(url, o) }
  const tmp = path.join(process.cwd(), FN, 'care-notes', '_ask_t.ts')
  fs.writeFileSync(tmp, fs.readFileSync(`${FN}/care-notes/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'../_shared/job-auth.ts'", "'../_shared/_job-auth_t.ts'"))
  let M; try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
  const a = await M.askConcern('Care note: a normal day.', 0); globalThis.fetch = f1
  ck('N2 · a hiccup on the first try: the retry reads it properly (no flag)', calls === 2 && a.failed === false && a.concern === false, { calls, a }) }
for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
