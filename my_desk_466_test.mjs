// My Desk 6b (Desktop 466): kind words in shift notes become SUGGESTIONS waiting for a person's yes.
// The real care-notes function against a fake database, a fake AxisCare and a fake AI (harness from n2_flag_test.mjs).
// node my_desk_466_test.mjs
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
  k: { id: 'k', client: { id: 601, firstName: 'Ruth', lastName: 'Kind' }, caregiver: { id: 9, firstName: 'Cara', lastName: 'Giver' }, startDate: hAgo(5), clockOut: { time: hAgo(3) },
       careNote: 'Helped Ruth with her bath. Ruth told me "you are the best part of my week" and hugged me.', adls: [] },
  f: { id: 'f', client: { id: 602, firstName: 'Faye', lastName: 'Family' }, caregiver: { id: 8, firstName: 'Ben', lastName: 'Helper' }, startDate: hAgo(6), clockOut: { time: hAgo(4) },
       careNote: 'Her daughter called and said thank you so much for taking such good care of mom. Faye slipped in the kitchen.', adls: [] },
  m: { id: 'm', client: { id: 603, firstName: 'Mo', lastName: 'Made' }, caregiver: { id: 7, firstName: 'Al', lastName: 'Aide' }, startDate: hAgo(7), clockOut: { time: hAgo(5) },
       careNote: 'MADEUP Mo had a quiet day.', adls: [] },
  n: { id: 'n', client: { id: 604, firstName: 'Nora', lastName: 'Fine' }, caregiver: { id: 6, firstName: 'Di', lastName: 'Aide' }, startDate: hAgo(8), clockOut: { time: hAgo(6) },
       careNote: 'Nora was in good spirits, ate lunch.', adls: [] },
  x: { id: 'x', client: { id: 605, firstName: 'Xena', lastName: 'Odd' }, caregiver: { id: 5, firstName: 'Ola', lastName: 'Aide' }, startDate: hAgo(9), clockOut: { time: hAgo(7) },
       careNote: 'KINDFAIL a normal visit', adls: [] } }
let ASK = { concern: 0, kind: 0 }
const f0 = globalThis.fetch
globalThis.fetch = async (url, o) => { url = String(url)
  if (url.includes('axiscare.com')) {
    if (url.includes('/api/visits?')) return new Response(JSON.stringify({ results: { visits: Object.values(V).map(({ careNote, adls, ...r }) => r) } }), { status: 200 })
    const m = url.match(/\/api\/visits\/([^/?]+)$/); if (m && V[m[1]]) return new Response(JSON.stringify({ results: V[m[1]] }), { status: 200 })
    return new Response('{}', { status: 404 }) }
  if (url.includes('api.anthropic.com')) { const b = JSON.parse(o.body); const t = b.messages[0].content
    if (/KIND WORDS/.test(b.system)) { ASK.kind++
      if (/KINDFAIL/.test(t)) return new Response('{}', { status: 500 })
      if (/best part/.test(t)) return new Response(JSON.stringify({ content: [{ text: '{"kind":true,"quote":"you are the best part of my week","who":"the client"}' }] }), { status: 200 })
      if (/daughter/.test(t)) return new Response(JSON.stringify({ content: [{ text: '{"kind":true,"quote":"thank you so much for taking such good care of mom.","who":"a family member"}' }] }), { status: 200 })
      if (/MADEUP/.test(t)) return new Response(JSON.stringify({ content: [{ text: '{"kind":true,"quote":"Mo said Cara is a wonderful caregiver","who":"the client"}' }] }), { status: 200 })
      return new Response(JSON.stringify({ content: [{ text: '{"kind":false,"quote":"","who":"the client"}' }] }), { status: 200 }) }
    ASK.concern++
    const fall = /slipped/i.test(t)
    return new Response(JSON.stringify({ content: [{ text: JSON.stringify(fall ? { concern: true, kind: 'a fall or injury', urgent: true, why: 'A slip.', family_line: 'Faye slipped.' } : { concern: false, kind: 'something else worth a look', urgent: false, why: 'A normal day.' }) }] }), { status: 200 }) }
  return f0(url, o) }
ENV.AXISCARE_TOKEN = 'axc_x'; ENV.AXISCARE_SITE = '16485'; ENV.ANTHROPIC_API_KEY = 'sk-ant-x'; ENV.CARE_NOTES_PAUSE_MS = '0'
const cn = await load('care-notes')
const run = (qs, headers) => post(cn, 'https://x/functions/v1/care-notes?' + qs, {}, headers)
const ANON = 'eyJ' + 'a'.repeat(120)
const CRON = { Authorization: 'Bearer ' + ANON, 'x-cron-secret': JOBSEC }, OWNER = { Authorization: 'Bearer ' + SVC }
const KW = () => T.kind_words || []

reset(); T.kind_words = []; APP.ops_settings = { care_notes_flag_live: true }
let r = await run('flag=1', CRON)
ck('switch off (kind_words_suggest_live not set): the shift-note run never asks about kind words, saves none', r.j && r.j.kind_switch === false && ASK.kind === 0 && KW().length === 0 && r.j.items_made === 1, [r.j, ASK])
ck('...and the concern flags work exactly as before', (APP.ops_items || []).filter((i) => i.kind === 'care_note').length === 1)

reset(); T.kind_words = []; APP.ops_settings = { care_notes_flag_live: false }; ASK = { concern: 0, kind: 0 }
r = await run('flag=1&practice=1&hours=48', OWNER); const pj = r.j
ck('practice: asks about kind words even with both switches off; counts only', pj && pj.kind_asked === 5 && pj.kind_found === 2 && pj.kind_not_in_note === 1 && pj.kind_ai_failed === 1 && pj.kind_suggested === 0, pj)
ck('practice: nothing saved anywhere', KW().length === 0 && !(APP.ops_items || []).length && !(APP.care_notes_state || []).length)
ck('practice answer is counts only: no words, no names', !/best part|Ruth|Cara|daughter|Faye/.test(JSON.stringify(pj)), pj)

reset(); T.kind_words = []; APP.ops_settings = { care_notes_flag_live: true, kind_words_suggest_live: true }; ASK = { concern: 0, kind: 0 }
r = await run('flag=1', CRON); const lj = r.j
ck('switch on: two suggestions are made (the client\'s words, the daughter\'s words)', lj.kind_suggested === 2 && KW().length === 2, [lj, KW()])
const kr = KW().find((k) => /best part/.test(k.quote)), kf = KW().find((k) => /daughter|mom/.test(k.quote))
ck('...each is a SUGGESTION waiting for a person (never straight into the jar), from the shift-note reader', KW().every((k) => k.status === 'suggested' && k.suggested_by === 'care-notes' && k.source === 'shift_note' && !k.created_by && !k.decided_by), KW())
ck('...the client\'s own words, letter for letter, quotes taken off', kr && kr.quote === 'you are the best part of my week' && kr.who === 'Ruth', kr)
ck('...about the caregiver, with a paperclip to the client (so it goes to Client Care and the owners on a yes)', kr.about === 'Cara Giver' && kr.about_role === 'caregiver' && kr.link && kr.link.type === 'client' && kr.link.ax === '601' && kr.link.name === 'Ruth Kind', kr)
ck('...a family member\'s words say "Faye\'s family"; dated the visit day; one per caregiver-client-day', kf && kf.who === "Faye's family" && /^\d{4}-\d{2}-\d{2}$/.test(kf.said_on) && kf.source_ref === 'carenote:8|602|' + kf.said_on, kf)
ck('a quote the AI wrote itself (not in the note) is thrown away', !KW().some((k) => /wonderful/.test(k.quote)) && lj.kind_not_in_note === 1, lj)
ck('a note that has both a concern and kind words gets both (the fall is still flagged)', (APP.ops_items || []).some((i) => /Faye/.test(i.about)), APP.ops_items)
ck('nothing was texted or emailed', SENT.length === 0 && RESEND.length === 0)
ck('the heartbeat says how many kind words were suggested', (APP.automation_heartbeats || []).some((b) => /2 kind words suggested/.test(b.note)), APP.automation_heartbeats)
APP.care_notes_state = []; ASK = { concern: 0, kind: 0 }
r = await run('flag=1', CRON)
ck('the same shifts read again: no second suggestion, and the AI is not asked again for them', KW().length === 2 && r.j.kind_already === 2 && ASK.kind === 3, [r.j, ASK])

{ const src = fs.readFileSync(`${FN}/care-notes/index.ts`, 'utf8')
  const tmp = path.join(process.cwd(), FN, 'care-notes', '_q_t.ts')
  fs.writeFileSync(tmp, src.replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'../_shared/job-auth.ts'", "'../_shared/_job-auth_t.ts'"))
  let M; try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
  ck('quote check: curly quotes, spacing and capitals don\'t matter; a few letters are not enough; words not in the note are refused',
    M.quoteInNote('“You are the  best part”', 'she said you are the best part of my week') && !M.quoteInNote('so kind', 'so kind of her') && !M.quoteInNote('the best caregiver ever', 'a normal day'))
  ck('the kind-words question is its own: the concern question\'s words are unchanged', /When unsure, it IS '\s*\+ 'a concern/.test(src) && /When unsure, it is NOT/.test(src)) }

for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
process.exitCode = res.every((x) => x[1]) ? 0 : 1
