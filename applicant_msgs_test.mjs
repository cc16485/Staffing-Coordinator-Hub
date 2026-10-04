// 445 · "Not hiring" / "Candidate pool" messages (applicant-decision-msg) and the orientation day-before reminder
// (orientation-remind + _shared/orient-remind.ts), run for real against a fake database and a fake GoHighLevel.
// node applicant_msgs_test.mjs
import fs from 'fs'; import path from 'path'; import os from 'os'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
/* The shared messaging code holds applicant messages outside 8am–6pm Central, so its clock reads 10am on a Tuesday;
   the decision function's own hours check is stubbed through __hours. */
const realTLS = Date.prototype.toLocaleString
Date.prototype.toLocaleString = function (loc, o) { if (o && o.hour === '2-digit' && !o.minute) return '10'; if (o && o.weekday === 'short' && !o.hour) return 'Tue'; return realTLS.call(this, loc, o) }

/* ── a fake database: eq filters, update, insert, upsert (onConflict + ignoreDuplicates), select after write ── */
let T, SENT, CARDS
const reset = (extra = {}) => { SENT = []; CARDS = []
  T = { job_applicants: [{ id: '11111111-1111-1111-1111-111111111111', first_name: 'Dana', last_name: 'Doe', phone: '(417) 555-0101', email: 'dana@x.com', sms_consent: true,
    status: 'declined', decline_reason: 'SECRET REASON', decision_msg_at: null, decision_msg_kind: null, decision_msg_held_at: null }],
    contact_optout_current: [], circle_contacts: [], phone_index: [], app_data: [], orient_bookings: [], orient_reminders: [], orient_remind_runs: [], ...extra } }
let nextId = 1
const q = (t) => { const f = []; let op = 'select', patch = null, rowsIn = null, oc = null, sel = false
  const match = (r) => f.every(([c, v]) => r[c] === v)
  const b = { select() { sel = true; return b }, eq(c, v) { f.push([c, v]); return b }, in() { return b }, or() { return b }, not() { return b }, is() { return b }, ilike() { return b },
    limit() { return b }, order() { return b }, gte() { return b },
    update(p) { op = 'update'; patch = p; return b }, delete() { op = 'delete'; return b },
    insert(r) { op = 'insert'; rowsIn = Array.isArray(r) ? r : [r]; return b },
    upsert(r, o) { op = 'upsert'; rowsIn = Array.isArray(r) ? r : [r]; oc = (o?.onConflict || '').split(','); return b },
    maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })) }, single() { return b.maybeSingle() },
    then(ok, no) { let out
      if (globalThis.__dbFail === t) out = { data: null, error: { message: 'boom' } }
      else if (op === 'update') { (T[t] || []).filter(match).forEach((r) => Object.assign(r, patch)); out = { data: null, error: null } }
      else if (op === 'delete') { T[t] = (T[t] || []).filter((r) => !match(r)); out = { data: null, error: null } }
      else if (op === 'insert') { const ins = rowsIn.map((r) => ({ id: nextId++, ...r })); (T[t] ||= []).push(...ins); out = { data: sel ? ins : null, error: null } }
      else if (op === 'upsert') { const ins = []
        for (const r of rowsIn) { if ((T[t] ||= []).some((x) => oc.every((k) => String(x[k]) === String(r[k])))) continue; const n = { id: nextId++, ...r }; T[t].push(n); ins.push(n) }
        out = { data: sel ? ins : null, error: null } }
      else out = { data: (T[t] || []).filter(match), error: null }
      return Promise.resolve(out).then(ok, no) } }
  return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') CARDS.push(a.item); return { data: null, error: null } } }
globalThis.__ghlDown = false
globalThis.fetch = async (url, o) => { url = String(url); const body = o?.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/search/duplicate')) return new Response('{}', { status: 200 })
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { if (globalThis.__ghlDown) return new Response('{"message":"down"}', { status: 503 }); SENT.push(body); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 }) }
let handler
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' })[k] ?? '' }, serve: (h) => { handler = h } }
const load = async (rel, edits) => {
  let src = fs.readFileSync(path.join(FN, rel), 'utf8'); for (const [a, b] of edits) { const s = src; src = src.replace(a, b); if (s === src) throw new Error('test setup: no match for ' + a) }
  src = src.replace(/'\.\.\/_shared\//g, "'" + path.join(FN, '_shared') + '/')
  const tmp = path.join(os.tmpdir(), 'am445_' + process.pid + '_' + path.basename(path.dirname(rel)) + '.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
  return handler }

/* ═══ 1 · applicant-decision-msg ═══ */
globalThis.__staff = { ok: true, email: 'krystal@mo-care.com', name: 'Krystal' }; globalThis.__hours = { allowed: true, reason: 'ok' }
const D = await load('applicant-decision-msg/index.ts', [
  [/^import \{ createClient \} from .*$/m, 'const createClient = (..._a: any[]) => (globalThis as any).__db'],
  [/^import \{ contactForOutbound, maySend \} from (.*)$/m, "import { contactForOutbound } from $1\nconst maySend = (..._a: any[]) => (globalThis as any).__hours"],
  [/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, 'const OFFICE_ROLES: string[] = []; const requireStaff = async (..._a: any[]) => (globalThis as any).__staff'],
])
const ID = '11111111-1111-1111-1111-111111111111'
const call = async (h, body) => { const r = await h(new Request('https://x/f', { method: 'POST', body: JSON.stringify(body) })); return [r.status, await r.json()] }
const A = () => T.job_applicants[0]

reset(); globalThis.__staff = { ok: false, status: 401, error: 'Sign in first.' }
let [s, j] = await call(D, { action: 'send', id: ID, kind: 'declined' })
ck('someone not signed in as office staff is refused and nothing goes', s === 401 && SENT.length === 0, [s, j])
globalThis.__staff = { ok: true, email: 'krystal@mo-care.com', name: 'Krystal' }

reset(); [s, j] = await call(D, { action: 'preview', id: ID, kind: 'declined' })
ck('preview (Not hiring, said yes to texts): the approved text, with STOP, and no email', s === 200 && j.text === "Hi Dana, thank you for applying with Caring Companions and for your time. We've decided not to move forward right now. We wish you the very best. Reply STOP to opt out." && j.email === null, j)
ck('...the reason we wrote in the Hub is never in it', !JSON.stringify(j).includes('SECRET'), j)
ck('...preview sends nothing and changes nothing', SENT.length === 0 && !A().decision_msg_at && !A().decision_msg_held_at)

reset(); A().status = 'pool'; [s, j] = await call(D, { action: 'preview', id: ID, kind: 'pool' })
ck('preview (Candidate pool): the approved pool wording', j.text === "Hi Dana, thank you for applying with Caring Companions. We don't have the right opening for you today, but we've kept your application and will reach out when one comes up. Reply STOP to opt out.", j)

reset(); A().sms_consent = false; [s, j] = await call(D, { action: 'preview', id: ID, kind: 'declined' })
ck('no yes to texts: no text; the email goes instead, and it says why', j.text === null && j.email && j.email.subject === 'Your application with Caring Companions' && /not to move forward/.test(j.email.html) && !/STOP/.test(j.email.html) && /did not agree to texts/.test(j.no_text_why), j)

reset(); [s, j] = await call(D, { action: 'send', id: ID, kind: 'pool' })
ck('they must already be marked that way: a pool message to someone marked Not hiring is refused', s === 409 && SENT.length === 0, [s, j])
reset(); [s, j] = await call(D, { action: 'send', id: ID, kind: 'hired' })
ck('only the two messages exist', s === 400 && SENT.length === 0, [s, j])
reset(); [s, j] = await call(D, { action: 'send', id: ID, kind: 'declined', message: 'custom words' })
ck('send (in hours): one text through GoHighLevel, the fixed wording (the caller cannot supply words)', s === 200 && j.texted === true && SENT.length === 1 && SENT[0].type === 'SMS' && /not to move forward/.test(SENT[0].message) && !/custom/.test(SENT[0].message), [j, SENT])
ck('...stamped: when, which decision, who pressed Send', !!A().decision_msg_at && A().decision_msg_kind === 'declined' && A().decision_msg_by === 'Krystal')
;[s, j] = await call(D, { action: 'send', id: ID, kind: 'declined' })
ck('pressing Send again sends nothing more', j.already_sent === true && SENT.length === 1, j)
A().status = 'pool'; [s, j] = await call(D, { action: 'send', id: ID, kind: 'pool' })
ck('a later different decision (moved to the pool) can have its own message', j.texted === true && SENT.length === 2 && A().decision_msg_kind === 'pool', j)

reset(); A().sms_consent = false; [s, j] = await call(D, { action: 'send', id: ID, kind: 'declined' })
ck('no yes to texts: the email goes (and no text)', j.emailed === true && j.texted === false && SENT.length === 1 && SENT[0].type === 'Email', [j, SENT])
reset(); A().sms_consent = false; A().email = null; [s, j] = await call(D, { action: 'send', id: ID, kind: 'declined' })
ck('no text allowed and no email: nothing goes, and it says so', SENT.length === 0 && j.not_sent && j.not_sent.length === 1 && !A().decision_msg_at, j)

reset(); globalThis.__hours = { allowed: false, reason: 'outside' }; [s, j] = await call(D, { action: 'send', id: ID, kind: 'declined' })
ck('outside 8am–6pm: nothing goes; it waits and says how to send it after 8am', SENT.length === 0 && /8am to 6pm/.test(j.held) && /Send the not-hiring message/.test(j.held) && !!A().decision_msg_held_at && !A().decision_msg_at, j)
;[s, j] = await call(D, { action: 'skip', id: ID })
ck('"Don\'t send it" clears the waiting message', j.skipped === true && A().decision_msg_held_at === null && SENT.length === 0, j)
globalThis.__hours = { allowed: true, reason: 'ok' }

reset(); globalThis.__ghlDown = true; [s, j] = await call(D, { action: 'send', id: ID, kind: 'declined' })
ck('GoHighLevel refuses it: not marked as sent, it says so, and a "Didn\'t go through" card is raised for hiring', j.texted === false && !A().decision_msg_at && /did not accept/.test((j.not_sent || []).join()) && CARDS.some((c) => /candidate/.test(JSON.stringify(c))), [j, CARDS])
globalThis.__ghlDown = false

/* ═══ 2 · the orientation reminder: who is due ═══ */
const R = await import(path.join(FN, '_shared/orient-remind.ts'))
const sess = (id, date, bookings, extra = {}) => ({ id, date, time: '10:00', is_remote: 'no', video_link: '', bookings, ...extra })
const TODAY = '2026-10-05', TOM = '2026-10-06'
const old = '2026-10-01T15:00:00Z'
let P = R.plan([
  sess(7, TOM, [{ first: 'Ava', last: 'Smith', phone: '417-555-0111', booked_at: old, attend_status: null },
                { first: 'Ben', last: 'Cole', phone: '417-555-0112', booked_at: old, attend_status: 'canceled' },
                { first: 'Cy', last: 'Day', phone: '417-555-0113', booked_at: old, attend_status: 'rescheduled' },
                { first: 'Di', last: 'Eve', phone: '', booked_at: old },
                { first: 'Ed', last: 'Fox', phone: '417-555-0115', booked_at: '2026-10-05T15:00:00Z' }]),
  sess(8, '2026-10-07', [{ first: 'Far', last: 'Off', phone: '417-555-0199', booked_at: old }]),
  sess(9, TOM, [], { is_remote: 'yes', video_link: 'https://meet.google.com/abc' }),
], [{ session_id: '9', first: 'Gus', last: 'Hay', phone: '4175550116', booked_at: old, merged: false },
    { session_id: '7', first: 'Ava', last: 'Smith', phone: '(417) 555-0111', booked_at: old, merged: false },
    { session_id: '8', first: 'Far', last: 'Off', phone: '4175550198', booked_at: old, merged: false }], TODAY)
const dueNames = P.due.map((x) => x.who).sort().join(',')
ck('due: still booked on TOMORROW\'s sessions (not cancelled, not moved, not later days), plus a page booking not synced yet', dueNames === 'Ava S,Gus H', P)
ck('...the same person on the session list and the page list is reminded once', P.due.filter((x) => x.phone10 === '4175550111').length === 1)
ck('skipped and listed with why: no phone, and booked today (the confirmation covers it)', P.skipped.some((x) => x.who === 'Di E' && /no usable phone/.test(x.why)) && P.skipped.some((x) => x.who === 'Ed F' && /booked today/.test(x.why)), P.skipped)
const ava = P.due.find((x) => x.who === 'Ava S'), gus = P.due.find((x) => x.who === 'Gus H')
ck('the wording: tomorrow, day, time, the office address, what to bring, how to change it, STOP',
  ava.text === 'Hi Ava, a reminder that your in-person Caring Companions orientation at our office is tomorrow, Tuesday, October 6 at 10:00 AM. Location: 1331 N Stewart Ave Ste B, Springfield MO 65802. Please bring the original ID documents you uploaded in Viventium Step 2 (for example, your photo ID). Need to change it? Call or text us at (417) 234-8494. Reply STOP to opt out.', ava.text)
ck('a video session gives its link instead of the address', /orientation video call is tomorrow/.test(gus.text) && /This is a video call: https:\/\/meet\.google\.com\/abc\./.test(gus.text) && /Please have ready/.test(gus.text) && !/Stewart/.test(gus.text), gus.text)
ck('the date is worked out in Central time (11pm Central on the 4th is still the 4th)', R.central(new Date('2026-10-05T04:00:00Z')).date === '2026-10-04' && R.central(new Date('2026-10-05T15:30:00Z')).hour === 10)

/* ═══ 3 · the orientation reminder: the run ═══ */
const SESS = [sess(7, TOM, [{ first: 'Ava', last: 'Smith', phone: '417-555-0111', booked_at: old }, { first: 'Bo', last: 'Ng', phone: '417-555-0122', booked_at: old }, { first: 'Di', last: 'Eve', phone: '' }])]
const setup = (live) => { reset({ app_data: [{ key: 'orient_sessions', data: SESS }, { key: 'ops_settings', data: { orient_remind_live: live } }] }) }
const sends = []; const deps = { consent: async (p) => (/0122$/.test(p.replace(/\D/g, '')) ? { ok: false, why: 'they did not agree to texts on their application' } : { ok: true }),
  send: async (p) => { sends.push(p); return globalThis.__sendFail ? { sent: false, why: 'GoHighLevel did not accept it (a card is on Needs Attention)' } : { sent: true } } }
const at = (h) => new Date(`2026-10-05T${String(h + 5).padStart(2, '0')}:05:00Z`)   // CDT: Central hour h
setup(true); let out = await R.runJob(globalThis.__db, deps, { caller: 'cron', runId: 'r1', now: at(9) })
ck('before 10am Central: nothing is looked at or sent', out.waiting && sends.length === 0 && T.orient_reminders.length === 0, out)
setup(true); out = await R.runJob(globalThis.__db, deps, { caller: 'cron', runId: 'r1', now: at(18) })
ck('at 6pm or later: nothing', out.waiting && sends.length === 0, out)

setup(false); out = await R.runJob(globalThis.__db, deps, { caller: 'cron', runId: 'r1', now: at(10) })
ck('switch OFF (practice): nobody is texted; it lists who it would remind, with the words', sends.length === 0 && out.mode === 'practice' && out.would === 2
  && T.orient_reminders.filter((x) => x.result === 'would').length === 2 && T.orient_reminders.some((x) => x.result === 'skipped' && /no usable phone/.test(x.detail)), [out, T.orient_reminders])
out = await R.runJob(globalThis.__db, deps, { caller: 'cron', runId: 'r2', now: at(11) })
ck('...the next hour adds nothing new to the list', T.orient_reminders.length === 3 && out.would === 0, T.orient_reminders)
ck('...each check is recorded', T.orient_remind_runs.length === 2 && T.orient_remind_runs.every((r) => r.ok === true && r.mode === 'practice'))

setup(true); sends.length = 0; out = await R.runJob(globalThis.__db, deps, { caller: 'cron', runId: 'r1', now: at(10) })
ck('switch ON at 10am: Ava is texted; Bo (no to texts on the application) is not, and it says why', sends.length === 1 && sends[0].who === 'Ava S' && out.sent === 1 && out.not_sent === 1
  && T.orient_reminders.some((x) => x.who === 'Ava S' && x.result === 'sent' && x.sent_at) && T.orient_reminders.some((x) => x.who === 'Bo N' && x.result === 'not_sent' && /did not agree/.test(x.detail)), [out, T.orient_reminders])
out = await R.runJob(globalThis.__db, deps, { caller: 'cron', runId: 'r2', now: at(11) })
ck('...the 11am check sends nobody a second reminder', sends.length === 1 && out.sent === 0, out)
setup(true); sends.length = 0; await Promise.all([R.runJob(globalThis.__db, deps, { caller: 'cron', runId: 'a', now: at(12) }), R.runJob(globalThis.__db, deps, { caller: 'cron', runId: 'b', now: at(12) })])
ck('two checks at once still send each person one reminder', sends.length === 1, sends.map((x) => x.who))
setup(true); sends.length = 0; globalThis.__sendFail = true; out = await R.runJob(globalThis.__db, deps, { caller: 'cron', runId: 'r1', now: at(10) })
ck('GoHighLevel refuses it: recorded as failed (its card is raised by the send), never retried into a loop', out.failed === 1 && T.orient_reminders.some((x) => x.who === 'Ava S' && x.result === 'failed'), out)
out = await R.runJob(globalThis.__db, deps, { caller: 'cron', runId: 'r2', now: at(11) }); globalThis.__sendFail = false
ck('...and the next hour does not try again (no repeated cards)', sends.length === 1, sends.length)
setup(true); sends.length = 0; globalThis.__dbFail = 'orient_bookings'; out = await R.runJob(globalThis.__db, deps, { caller: 'cron', runId: 'r1', now: at(10) }); globalThis.__dbFail = null
ck('if the bookings cannot be read: nothing is sent, the run says why, and a Needs Attention card tells the office nobody was reminded', !out.ok && sends.length === 0 && T.orient_remind_runs.some((r) => r.ok === false) && CARDS.some((c) => c.id === R.FAILING_ID && /Orientation reminders did not go/.test(c.title)), [out, CARDS])
setup(false); out = await R.runJob(globalThis.__db, deps, { caller: 'owner', runId: 'd', dry: true, now: at(3) })
ck('a dry look (the Desktop step) counts only, at any hour, and writes nothing', out.dry && out.due === 2 && out.skipped === 1 && T.orient_reminders.length === 0 && T.orient_remind_runs.length === 0, out)

/* ═══ 4 · orientation-remind: only its schedule or the owner ═══ */
globalThis.__caller = null
const O = await load('orientation-remind/index.ts', [
  [/^import \{ createClient \} from .*$/m, 'const createClient = (..._a: any[]) => (globalThis as any).__db'],
  [/^import \{ jobCaller \} from .*$/m, 'const jobCaller = async (..._a: any[]) => (globalThis as any).__caller'],
])
reset(); [s, j] = await call(O, {})
ck('orientation-remind: anyone without its schedule\'s secret or the owner key is refused', s === 401, [s, j])
globalThis.__caller = 'cron'; reset({ app_data: [{ key: 'orient_sessions', data: SESS }] })
const r2 = await O(new Request('https://x/f?dry=1', { method: 'POST' })); ck('...its schedule cannot ask for a dry look (owner only)', r2.status === 401)

/* ═══ 5 · source checks ═══ */
const dm = fs.readFileSync(path.join(FN, 'applicant-decision-msg/index.ts'), 'utf8'), orr = fs.readFileSync(path.join(FN, 'orientation-remind/index.ts'), 'utf8'), lib = fs.readFileSync(path.join(FN, '_shared/orient-remind.ts'), 'utf8')
ck('both browser-called/edge functions answer CORS (decision) and use the shared opt-out door', /OPTIONS/.test(dm) && /contactForOutbound/.test(dm) && /contactForOutbound/.test(orr))
ck('the reminder checks the application\'s yes to texts', /latestTextConsent/.test(orr))
const sqlTxt = fs.readFileSync(path.join(ROOT, 'applicant_msgs_445.sql'), 'utf8')
ck('the database change adds only (no drop table, no delete, no update of rows)', !/drop table|delete from|update public\./i.test(sqlTxt))
ck('the new lists are readable by signed-in staff only, writable by the server only', /revoke all on public\.orient_reminders, public\.orient_remind_runs from public, anon, authenticated/.test(sqlTxt) && /grant select on public\.orient_reminders, public\.orient_remind_runs to authenticated/.test(sqlTxt))
const added = [dm, orr, lib, sqlTxt].join('\n')
ck('no em dashes in anything new', !/—/.test(added))

Date.prototype.toLocaleString = realTLS
const failed = res.filter((r) => !r[1])
for (const [n, ok, note] of res) console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '  ' + note))
console.log(`${res.length - failed.length}/${res.length} passed`)
process.exit(failed.length ? 1 : 0)
