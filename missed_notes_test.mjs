// Missed shift notes M1–M3 · the real function against a fake database, fake AxisCare and fake GoHighLevel.
// node missed_notes_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1000)]);
const FN = 'supabase/functions'
let HOUR = null
const realTLS = Date.prototype.toLocaleString
Date.prototype.toLocaleString = function (loc, o) { if (HOUR != null && o && o.hour === '2-digit' && !o.minute && o.timeZone === 'America/Chicago') return String(HOUR); return realTLS.call(this, loc, o) }
const H = 3600e3, NOW = () => Date.now()
const chiDay = (t) => new Date(t).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
let T, APP, SENT, TAGS, VISITS, INBOX, PATCHES, AXCH, STAFF, PATCH_STATUS, SEQ
const V = (id, cg, cl, outAgoH, note, meth = 'Mobile', extra = {}) => ({ id, caregiver: { id: cg, firstName: 'C' + cg, lastName: 'Test' }, client: { id: cl, firstName: 'Cl' + cl, lastName: 'X' },
  startDate: new Date(NOW() - (outAgoH + 4) * H).toISOString(), clockIn: { method: meth }, clockOut: outAgoH == null ? null : { time: new Date(NOW() - outAgoH * H).toISOString(), method: meth },
  careNote: note, ...extra })
const reset = () => {
  SENT = []; TAGS = []; INBOX = {}; PATCHES = []; AXCH = []; PATCH_STATUS = 200; SEQ = 1; HOUR = 10
  STAFF = { ok: true, name: 'Krystal', email: 'k@mo-care.com', roles: ['staffing_coordinator'] }
  APP = { ops_settings: {}, caregivers: [1, 2, 3, 4, 5].map((i) => ({ first: 'C' + i, last: 'Test', phone: '41755500' + String(i).padStart(2, '0'), axiscare_id: String(i), active: true })),
    missed_notes_state: [], ops_items: [], discipline_actions: [], automation_heartbeats: [] }
  T = { missed_notes: [], contact_optout_current: [], circle_contacts: [], phone_index: [] }
  VISITS = [
    V('v1', 1, 100, 2, ''),                          // miss (app)
    V('v2', 2, 200, 2, 'Did great'),                 // has a note
    V('v3', 3, 300, 0.05, ''),                       // clocked out 3 minutes ago: texted right away (her correction)
    V('v4', 4, 400, 3, '', 'Web'),                   // miss (web, office)
    V('v5', 5, 500, null, ''),                       // still on the clock
    V('v6a', 1, 600, 5, ''), V('v6b', 1, 600, 2, ''),// two visits, same client and day: ONE obligation
    V('v7', 2, 700, 2, '', 'Telephony'),             // phone clock-out
  ]
}
const q = (t) => { const st = { f: [], isNull: [], nn: [], gte: null, lt: null, inF: null, op: null, val: null }; const b = {
  select() { return b }, order() { return b }, limit() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, is(c, v) { if (v === null) st.isNull.push(c); return b }, not(c, op, v) { if (op === 'is' && v === null) st.nn.push(c); return b },
  gte(c, v) { st.gte = [c, v]; return b }, lt(c, v) { st.lt = [c, v]; return b }, in(c, v) { st.inF = [c, v]; return b },
  update(o) { st.op = 'update'; st.val = o; return b }, delete() { st.op = 'delete'; return b },
  insert(o) { const arr = (T[t] ||= []); if (t === 'missed_notes' && arr.some((x) => x.axiscare_caregiver_id === o.axiscare_caregiver_id && x.axiscare_client_id === o.axiscare_client_id && x.shift_date === o.shift_date))
      return Promise.resolve({ data: null, error: { message: 'duplicate key' } }); arr.push({ id: SEQ++, created_at: new Date().toISOString(), counts: false, ...o }); return Promise.resolve({ data: null, error: null }) },
  rows() { if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return k in APP ? [{ key: k, data: APP[k] }] : [] }
    let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); for (const c of st.isNull) r = r.filter((x) => x[c] == null); for (const c of st.nn) r = r.filter((x) => x[c] != null)
    if (st.gte) r = r.filter((x) => String(x[st.gte[0]]) >= String(st.gte[1])); if (st.lt) r = r.filter((x) => String(x[st.lt[0]]) < String(st.lt[1])); if (st.inF) r = r.filter((x) => st.inF[1].includes(x[st.inF[0]])); return r },
  maybeSingle() { return Promise.resolve({ data: b.rows()[0] ?? null, error: null }) },
  then(ok, bad) {
    if (st.op === 'update') { for (const x of b.rows()) Object.assign(x, st.val); return Promise.resolve({ data: null, error: null }).then(ok, bad) }
    if (st.op === 'delete') { const kill = new Set(b.rows()); T[t] = (T[t] ?? []).filter((x) => !kill.has(x)); return Promise.resolve({ data: null, error: null }).then(ok, bad) }
    return Promise.resolve({ data: b.rows(), error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) }
  if (fn === 'axiscare_change_record') { AXCH.push(a); return { data: { outcome: 'recorded' }, error: null } }
  return { data: null, error: null } } }
globalThis.fetch = async (url, o) => {
  url = String(url); const m = o?.method || 'GET'; const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + body.phone, dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, msg: body.message }); return new Response('{}', { status: 200 }) }
  if (/\/contacts\/[^/]+\/tags/.test(url)) { TAGS.push(body.tags); return new Response('{}', { status: 200 }) }
  if (url.includes('/conversations/search')) { const cid = decodeURIComponent(url.match(/contactId=([^&]+)/)[1]); return new Response(JSON.stringify({ conversations: INBOX[cid] ? [{ id: 'cv:' + cid }] : [] }), { status: 200 }) }
  const cm = url.match(/\/conversations\/cv:([^/]+)\/messages/); if (cm) return new Response(JSON.stringify({ messages: { messages: INBOX[decodeURIComponent(cm[1])] || [] } }), { status: 200 })
  if (/axiscare\.com\/api\/visits\?/.test(url)) return new Response(JSON.stringify({ results: { visits: VISITS, nextPage: null } }), { status: 200 })
  const vm = url.match(/axiscare\.com\/api\/visits\/([^/?]+)$/)
  if (vm && m === 'GET') { const v = VISITS.find((x) => x.id === vm[1]); return new Response(JSON.stringify(v ? { results: v } : {}), { status: v ? 200 : 404 }) }
  if (vm && m === 'PATCH') { PATCHES.push({ id: vm[1], body }); if (PATCH_STATUS !== 200) return new Response('{}', { status: PATCH_STATUS })
    const v = VISITS.find((x) => x.id === vm[1]); if (v) v.careNote = body.careNote; return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', MISSED_NOTES_PAUSE_MS: '0' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
fs.writeFileSync(`${FN}/_shared/_job-auth_mn.ts`, "export const jobCaller = async (req) => req.headers.get('x-test') === 'cron' ? 'cron' : null\n")
fs.writeFileSync(`${FN}/_shared/_staff-auth_mn.ts`, "export const OFFICE_ROLES = ['owner_admin','care_coordinator','staffing_coordinator']\nexport const requireStaff = async () => globalThis.__staff()\n")
process.on('exit', () => { for (const f of ['_job-auth_mn.ts', '_staff-auth_mn.ts']) try { fs.unlinkSync(`${FN}/_shared/${f}`) } catch { /* */ } })
globalThis.__staff = () => STAFF.ok ? STAFF : { ok: false, status: 401, error: 'Sign in first.' }
const src = fs.readFileSync(`${FN}/missed-notes/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_mn.ts'").replace(/(['"])\.\.\/_shared\/staff-auth\.ts\1/, "'../_shared/_staff-auth_mn.ts'")
const tmp = path.join(process.cwd(), FN, 'missed-notes', '_t.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const run = async (qs = '', hdr = { 'x-test': 'cron' }) => { const r = await handler(new Request('https://x/functions/v1/missed-notes' + qs, { method: 'POST', headers: hdr, body: '{}' })); return { s: r.status, j: await r.json() } }
const staff = async (body) => { const r = await handler(new Request('https://x/functions/v1/missed-notes', { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json() } }
const row = (cg, cl) => T.missed_notes.find((x) => x.axiscare_caregiver_id === String(cg) && x.axiscare_client_id === String(cl))

reset(); let r = await run('', {}); ck('no schedule secret and no owner key: refused, nothing read', r.s === 401 && !T.missed_notes.length, r)
/* ── practice ── */
reset(); r = await run()
ck('practice (switch off): finds the misses (including one that clocked out 3 minutes ago), texts nobody', r.j.live === false && r.j.practice_found === 5 && !SENT.length
   && T.missed_notes.length === 5 && T.missed_notes.every((x) => x.status === 'practice' && !x.counts), [r, T.missed_notes])
ck('a shift with a note, and one still on the clock, are not misses; one that clocked out 3 minutes ago IS (no waiting)', !row(2, 200) && !!row(3, 300) && !row(5, 500))
ck('two visits for the same client that day are ONE obligation (read both, one row, the last clock-out)', row(1, 600)?.visit_count === 2 && row(1, 600)?.visit_id === 'v6b')
ck('web (office) clock-out is a miss too, recorded as web; phone recorded as phone', row(4, 400)?.clock_out_method === 'web' && row(2, 700)?.clock_out_method === 'phone')
r = await run(); ck('run again: nothing looked at twice, nothing new', r.j.groups_checked === 0 && T.missed_notes.length === 5, r)
reset(); r = await run('?dry=1'); ck('?dry=1: counts only, nothing recorded', r.j.practice_found === 5 && !T.missed_notes.length && !APP.missed_notes_state.length, r)
/* ── live ── */
reset(); APP.ops_settings = { missed_notes_live: true, missed_notes_live_since: new Date(NOW() - 30 * 864e5).toISOString() }
r = await run()
const msg1 = SENT.find((s) => s.to === 'C:+14175550001')?.msg || ''
ck('live: 5 misses open, each texted once right away (the two-visit day gets one text), tagged notes-asked', r.j.missed_found === 5 && r.j.texted === 5 && SENT.length === 5
   && T.missed_notes.every((x) => x.status === 'open' && x.texted_at) && TAGS.every((t) => t[0] === 'notes-asked'), [r, SENT])
ck('the text, her words: you did not put in a care note; text your shift note to the office ASAP so we can put it in your shift for you', /^Hi C1, this is Caring Companions\. You did not put in a care note for your shift with Cl(100|600) today\. Please text your shift note to the office as soon as possible so we can put it in your shift for you\.$/.test(msg1), msg1)
reset(); APP.ops_settings = { missed_notes_live: true }; HOUR = 22; r = await run()
ck('after 9pm: misses recorded, texts held until morning', r.j.missed_found === 5 && !SENT.length && r.j.held_hours === 5, r)
HOUR = 8; r = await run(); ck('... and sent at 8am', r.j.texted === 5, r)
/* reply */
const iso = (agoMin) => new Date(NOW() - agoMin * 60e3 + 60e3).toISOString()
INBOX['C:+14175550004'] = [{ direction: 'inbound', type: 1, dateAdded: iso(-1), body: 'Client was great, ate lunch, walked outside.' }]
INBOX['C:+14175550002'] = [{ direction: 'inbound', type: 1, dateAdded: iso(-1), body: 'Phone shift note' }]
r = await run()
const r4 = row(4, 400), r7 = row(2, 700), op4 = APP.ops_items.find((x) => x.id === 'ops_mnote_' + r4.id)
ck('a reply: recovered by text, and a Needs Attention item with their words for "Put it in AxisCare" (this one was a WEB clock-out, so it does NOT count: her ruling (b))', r4.status === 'recovered' && r4.counts === false && r4.reply_text === 'Client was great, ate lunch, walked outside.'
   && op4 && op4.kind === 'missed_note' && /Care note by text: C4 Test for Cl400/.test(op4.title) && op4.reply_text === r4.reply_text, [r4, op4])
ck('a phone clock-out that replied: recovered, and does NOT count (her rule)', r7.status === 'recovered' && r7.counts === false, r7)
reset(); APP.ops_settings = { missed_notes_live: true }; await run()
INBOX['C:+14175550001'] = [{ direction: 'inbound', type: 1, dateAdded: new Date(NOW() - 5 * H).toISOString(), body: 'something they sent this morning' },
                           { direction: 'outbound', type: 1, dateAdded: new Date(NOW() + 60e3).toISOString(), body: 'our own text' }]
r = await run()
ck('a message they sent BEFORE we asked (and our own texts) is not taken as their note', row(1, 100).status === 'open' && !row(1, 100).reply_text && r.j.replies === 0, [row(1, 100), r])
/* reminder + deadline */
reset(); APP.ops_settings = { missed_notes_live: true }; await run()
for (const x of T.missed_notes) x.texted_at = new Date(NOW() - 20 * H).toISOString()
T.missed_notes.forEach((x) => { x.texted_at = new Date(Date.parse(x.texted_at) - 864e5).toISOString() })   // texted yesterday
SENT = []; r = await run()
ck('the next morning: one reminder each (nobody replied), in her words', r.j.reminded === 5 && SENT.every((s) => /a reminder from Caring Companions: we still need your shift note .* so we can put it in your shift for you\./.test(s.msg)), [r, SENT.slice(0, 1)])
SENT = []; r = await run(); ck('... and only one reminder', r.j.reminded === 0 && !SENT.length, r)
for (const x of T.missed_notes) x.shift_date = chiDay(NOW() - 3 * 864e5)
r = await run()
const u1 = row(1, 100), opu = APP.ops_items.find((x) => x.id === 'ops_mnote_' + u1.id)
ck('no reply by 6pm the next day: unresolved, counts, and "No care note and no reply" in Needs Attention', u1.status === 'unresolved' && u1.counts === true && opu && /No care note and no reply/.test(opu.title), [u1, opu])
ck('a phone clock-out that never replied: unresolved, and it DOES count', row(2, 700).status === 'unresolved' && row(2, 700).counts === true)
{ const w = row(4, 400), opw = APP.ops_items.find((x) => x.id === 'ops_mnote_' + w.id)
  ck('a WEB clock-out that never replied: unresolved but does NOT count, and Needs Attention says why (her ruling (b))', w.clock_out_method === 'web' && w.status === 'unresolved' && w.counts === false
     && opw && /office clocked this shift out \(web\), so it does not count/.test(opw.detail), [w, opw])
  ck('an APP clock-out that never replied still counts', [1, 3].every((i) => { const x = T.missed_notes.find((m) => m.axiscare_caregiver_id === String(i) && m.status === 'unresolved'); return !x || x.counts === true }))
  ck('the web clock-out was still texted for its note', !!w.texted_at, w) }
/* 3 in 30 days → one draft */
reset(); APP.ops_settings = { missed_notes_live: true }
const mk = (cg, cl, d, status, meth = 'app') => T.missed_notes.push({ id: SEQ++, axiscare_caregiver_id: String(cg), axiscare_client_id: String(cl), shift_date: d, caregiver_name: 'C' + cg + ' Test', client_first: 'Cl' + cl,
  visit_id: 'x' + cl, status, counts: status !== 'open', clock_out_method: meth, created_at: new Date().toISOString(), draft_id: null })
VISITS = []
mk(9, 1, chiDay(NOW() - 20 * 864e5), 'recovered'); mk(9, 2, chiDay(NOW() - 10 * 864e5), 'unresolved', 'web'); r = await run()
ck('two counted misses: no draft yet', !APP.discipline_actions.length && r.j.drafts === 0)
mk(9, 3, chiDay(NOW() - 2 * 864e5), 'recovered'); r = await run()
const dw = APP.discipline_actions[0]
ck('the third: one DRAFT write-up, Verbal Warning, "Missed care notes: 3 in 30 days", for a person to review and send for approval', r.j.drafts === 1 && dw.status === 'draft'
   && dw.level === 'Verbal Warning' && dw.reason === 'Missed care notes: 3 in 30 days' && dw.caregiver === 'C9 Test' && dw.missed_note_ids.length === 3, dw)
ck('the draft lists each miss: recovered by text vs UNRESOLVED (more serious), and the web clock-out as the office\'s', /Recovered by text/.test(dw.body) && /UNRESOLVED: no reply/.test(dw.body)
   && /clocked out by the office \(web\)/.test(dw.body) && /Only Samantha or Zach can approve/.test(dw.body) && !/—/.test(dw.body), dw.body)
ck('those three are marked as drafted; running again drafts nothing more', T.missed_notes.filter((x) => x.draft_id === dw.id).length === 3 && (await run()).j.drafts === 0 && APP.discipline_actions.length === 1)
reset(); APP.ops_settings = { missed_notes_live: true }; VISITS = []
APP.discipline_actions = [{ id: 'old', caregiver: 'C9 Test', reason: 'Missed care notes: 3 in 30 days', status: 'issued', created_at: new Date(NOW() - 90 * 864e5).toISOString() }]
mk(9, 1, chiDay(NOW() - 5 * 864e5), 'recovered'); mk(9, 2, chiDay(NOW() - 4 * 864e5), 'recovered'); mk(9, 3, chiDay(NOW() - 3 * 864e5), 'recovered'); await run()
ck('a second time within a year: the next level (Written Warning)', APP.discipline_actions.find((a) => a.id !== 'old')?.level === 'Written Warning', APP.discipline_actions)
/* step 4 (2026-10-14): earlier warnings are matched by the AxisCare caregiver id when the write-up has one */
const three = () => { mk(9, 1, chiDay(NOW() - 5 * 864e5), 'recovered'); mk(9, 2, chiDay(NOW() - 4 * 864e5), 'recovered'); mk(9, 3, chiDay(NOW() - 3 * 864e5), 'recovered') }
const lvl = () => APP.discipline_actions.find((a) => !/^old/.test(a.id))?.level
const OLD = (extra) => ({ id: 'old', caregiver: 'C9 Test', reason: 'Missed care notes: 3 in 30 days', status: 'issued', created_at: new Date(NOW() - 90 * 864e5).toISOString(), ...extra })
reset(); APP.ops_settings = { missed_notes_live: true }; VISITS = []; APP.discipline_actions = [OLD({ axiscare_caregiver_id: '9' })]; three(); await run()
ck('step4 · an earlier warning with the same id counts (Written Warning)', lvl() === 'Written Warning', APP.discipline_actions)
reset(); APP.ops_settings = { missed_notes_live: true }; VISITS = []; APP.discipline_actions = [OLD({ caregiver: 'Someone Else', ax_caregiver_id: '9' })]; three(); await run()
ck('step4 · ...also by the older ax_caregiver_id field, even when the typed name differs', lvl() === 'Written Warning', APP.discipline_actions)
reset(); APP.ops_settings = { missed_notes_live: true }; VISITS = []; APP.discipline_actions = [OLD({ axiscare_caregiver_id: '77' }), OLD({ id: 'old2', ax_caregiver_id: '78' })]; three(); await run()
ck('step4 · a warning with another person\'s id never counts by name, even with the same name (stays Verbal Warning)', lvl() === 'Verbal Warning', APP.discipline_actions)
reset(); APP.ops_settings = { missed_notes_live: true }; VISITS = []; APP.discipline_actions = [OLD({ caregiver: 'Other Name' })]; three(); await run()
ck('step4 · a warning with no id and a different name does not count (as before)', lvl() === 'Verbal Warning', APP.discipline_actions)
reset(); APP.ops_settings = { missed_notes_live: true, missed_notes_live_since: new Date(NOW() - 3 * 864e5).toISOString() }; VISITS = []
mk(9, 1, chiDay(NOW() - 10 * 864e5), 'recovered'); mk(9, 2, chiDay(NOW() - 8 * 864e5), 'recovered'); mk(9, 3, chiDay(NOW() - 2 * 864e5), 'recovered'); await run()
ck('the count starts at go-live: misses from before the switch never count toward a draft', !APP.discipline_actions.length)
reset(); APP.ops_settings = { missed_notes_live: true }; VISITS = []
mk(9, 1, chiDay(NOW() - 45 * 864e5), 'recovered'); mk(9, 2, chiDay(NOW() - 8 * 864e5), 'recovered'); mk(9, 3, chiDay(NOW() - 2 * 864e5), 'recovered'); await run()
ck('only the last 30 days count', !APP.discipline_actions.length)
/* Put it in AxisCare */
reset(); APP.ops_settings = { missed_notes_live: true }; await run()
const target = row(1, 100)
STAFF.ok = false; r = await staff({ action: 'enter', id: target.id, note: 'x' }); ck('"Put it in AxisCare" needs signed-in office staff', r.s === 401, r)
STAFF.ok = true; r = await staff({ action: 'enter', id: target.id, note: 'Client was great.' })
ck('"Put it in AxisCare": the note written on the visit, read back, logged, and recorded who', r.j.outcome === 'entered' && PATCHES[0].id === 'v1' && PATCHES[0].body.careNote === 'Client was great.'
   && AXCH[0].p_kind === 'care_note' && AXCH[0].p_outcome === 'sent_confirmed' && row(1, 100).entered_by === 'Krystal', [r, PATCHES, AXCH])
r = await staff({ action: 'enter', id: target.id, note: 'again' }); ck('... and only once', r.j.outcome === 'already' && PATCHES.length === 1, r)
PATCH_STATUS = 403; r = await staff({ action: 'enter', id: row(4, 400).id, note: 'y' })
ck('AxisCare refuses: says so (enter it by hand), logged as refused, nothing recorded as entered', r.j.outcome === 'refused' && /Enter it in AxisCare by hand/.test(r.j.detail) && !row(4, 400).entered_at && AXCH.at(-1).p_outcome === 'refused', r)
reset(); await run(); r = await staff({ action: 'enter', id: row(1, 100).id, note: 'z' }); ck('a practice row can\'t be entered', r.s === 404, r)
/* overnight shifts split at midnight (her report, 2026-10-13) */
{
  const midnightOf = (day) => [5, 6].map((o) => Date.parse(day + 'T00:00:00Z') + o * H).find((t) => chiDay(t) === day && chiDay(t - 60e3) !== day)
  let MID = midnightOf(chiDay(NOW())); if (NOW() - MID < 2 * H) MID = midnightOf(chiDay(NOW() - 864e5))
  const iso2 = (t) => new Date(t).toISOString()
  const half = (id, cg, cl, from, to, note, extra = {}) => ({ id, caregiver: { id: cg, firstName: 'C' + cg, lastName: 'Test' }, client: { id: cl, firstName: 'Cl' + cl, lastName: 'X' },
    startDate: iso2(from), endDate: iso2(to), clockIn: { time: iso2(from), method: 'Mobile' }, clockOut: { time: iso2(to), method: 'Mobile' }, careNote: note, ...extra })
  const nightA = (note) => half('nA', 1, 900, MID - 4 * H, MID, note), nightB = (note) => half('nB', 1, 900, MID, MID + H, note)
  reset(); VISITS = [nightA('Slept well, up once at 2am.'), nightB('')]; r = await run()
  ck('overnight split at midnight, note on the first half: the after-midnight half is NOT a miss, nobody texted', !T.missed_notes.some((x) => x.axiscare_client_id === '900') && r.j.overnight_noted === 1, [r.j, T.missed_notes])
  reset(); APP.ops_settings = { missed_notes_live: true }; VISITS = [nightA('Slept well.'), nightB('')]; r = await run()
  ck('... and live: no text for it', !SENT.length && !T.missed_notes.length, [r.j, SENT])
  reset(); VISITS = [nightA(''), nightB('Note on the second half')]; r = await run()
  ck('note on the second half instead: the first half is not a miss either', !T.missed_notes.length, T.missed_notes)
  reset(); APP.ops_settings = { missed_notes_live: true }; VISITS = [nightA(''), nightB('')]; r = await run()
  const nights = T.missed_notes.filter((x) => x.axiscare_client_id === '900')
  ck('no note on either half: ONE miss and ONE text for the shift (on the after-midnight half, its clock-out)', nights.length === 1 && nights[0].visit_id === 'nB' && nights[0].shift_date === chiDay(MID) && SENT.length === 1, [nights, SENT])
  reset(); VISITS = [half('dA', 1, 900, MID - 10 * H, MID - 6 * H, 'Day note'), nightB('')]; r = await run()
  ck('a separate earlier shift (not joined at midnight) does not cover a later shift with no note', T.missed_notes.filter((x) => x.axiscare_client_id === '900').length === 1, T.missed_notes)
  reset(); VISITS = [nightA('Note'), half('nB', 2, 900, MID, MID + H, '')]; r = await run()
  ck('a different caregiver\'s half does not cover it', T.missed_notes.some((x) => x.axiscare_caregiver_id === '2' && x.axiscare_client_id === '900'), T.missed_notes)
  reset(); VISITS = [nightA('Note'), half('nB', 1, 900, MID, MID + H, '', { clockIn: { time: iso2(MID + 2 * 60e3), method: 'Mobile' }, startDate: iso2(MID + 60e3) })]; r = await run()
  ck('split times a minute or two apart still join', !T.missed_notes.length, T.missed_notes)
  /* rows recorded before the fix */
  reset(); APP.ops_settings = { missed_notes_live: true }; VISITS = [nightA('Slept well.'), nightB('')]
  APP.missed_notes_state = [{ id: 'state', checked: { [`1|900|${chiDay(MID)}`]: NOW() } }]
  T.missed_notes.push({ id: 77, axiscare_caregiver_id: '1', axiscare_client_id: '900', shift_date: chiDay(MID), caregiver_name: 'C1 Test', client_first: 'Cl900', visit_id: 'nB',
    status: 'unresolved', counts: true, clock_out_method: 'app', texted_at: iso2(MID + 2 * H), created_at: iso2(MID + 2 * H), draft_id: null })
  T.missed_notes.push({ id: 78, axiscare_caregiver_id: '3', axiscare_client_id: '300', shift_date: chiDay(MID), caregiver_name: 'C3 Test', client_first: 'Cl300', visit_id: 'zz',
    status: 'unresolved', counts: true, clock_out_method: 'app', created_at: iso2(MID), draft_id: null })
  APP.ops_items = [{ id: 'ops_mnote_77', kind: 'missed_note', status: 'open', title: 'No care note and no reply: C1 Test' }]
  r = await run()
  ck('a miss recorded before the fix for a noted overnight shift: removed (never counts), and its Needs Attention card closed saying why', !T.missed_notes.some((x) => x.id === 77)
     && APP.ops_items[0].status === 'done' && /after-midnight half of an overnight shift/.test(APP.ops_items[0].close_reason) && r.j.cleared_overnight === 1, [r.j, APP.ops_items])
  ck('... a real miss is left alone', T.missed_notes.some((x) => x.id === 78 && x.counts === true))
  r = await run(); ck('... and each row is looked at once', r.j.cleared_overnight === 0 && APP.missed_notes_state[0].rechecked['78'], r.j)
  reset(); VISITS = [nightA('Slept well.'), nightB('')]
  T.missed_notes.push({ id: 79, axiscare_caregiver_id: '1', axiscare_client_id: '900', shift_date: chiDay(MID), visit_id: 'nB', status: 'recovered', counts: true, draft_id: 'dw_x', created_at: iso2(MID) })
  APP.missed_notes_state = [{ id: 'state', checked: { [`1|900|${chiDay(MID)}`]: NOW() } }]; await run()
  ck('... one already in a write-up draft is left for a person', T.missed_notes.some((x) => x.id === 79))
}
/* the rules in the source */
const code = fs.readFileSync(`${FN}/missed-notes/index.ts`, 'utf8')
ck('caregivers only (the do-not-text door, audience caregiver); texts 8am–9pm; no waiting after clock-out; nothing about pay', /audience: 'caregiver'/.test(code) && /h >= 8 && h < 21/.test(code) && M.WAIT_MIN === 0 && !/pay_rates|\$\d/.test(code))
const tk = fs.readFileSync(`${FN}/timekeeper-watch/index.ts`, 'utf8')
ck('the missed clock-out text now also asks for their shift note (forgot or can\'t clock out)', /If you didn't put in your shift note, text it to the office now so we can put it in your shift for you\./.test(tk))
HOUR = null
ck('deadline is 6pm Central the next day (summer and winter time)', new Date(M.deadlineFor('2026-10-05')).toLocaleString('en-US', { timeZone: 'America/Chicago' }) === '10/6/2026, 6:00:00 PM'
   && new Date(M.deadlineFor('2026-12-05')).toLocaleString('en-US', { timeZone: 'America/Chicago' }) === '12/6/2026, 6:00:00 PM')
for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
