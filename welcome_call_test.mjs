// Remote orientation slice 1a (Desktop 407): Orientation Video Call run for real against a fake database and GoHighLevel, plus
// scans of the SQL and the interview-messages reminders. node welcome_call_test.mjs
import fs from 'fs'; import path from 'path'
const FN = 'supabase/functions'; const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
let HOUR = '10'; const realTLS = Date.prototype.toLocaleString
Date.prototype.toLocaleString = function (loc, o) { if (o && o.hour === '2-digit' && !o.minute) return HOUR; return realTLS.call(this, loc, o) }
let T, SENT, CARDS
const reset = () => { SENT = []; CARDS = []
  T = { welcome_calls: [], coordinator_busy: [], job_applicants: [], scheduling_settings: [{ id: 1, welcome_meet_url: 'https://meet.google.com/yqj-nzuo-tgp' }],
    contact_optout_current: [], circle_contacts: [], phone_index: [], app_data: [] } }
let nextId = 1
const q = (t) => { const f = []; let op = 'select', patch = null, row = null, ret = false; const rows = () => (T[t] || []).filter((r) => f.every((fn) => fn(r)))
  const b = { select() { ret = true; return b }, eq(c, v) { f.push((r) => r[c] === v); return b }, neq(c, v) { f.push((r) => r[c] !== v); return b }, in(c, v) { f.push((r) => v.includes(r[c])); return b },
    lt(c, v) { f.push((r) => r[c] < v); return b }, gt(c, v) { f.push((r) => r[c] > v); return b }, ilike() { return b }, or() { return b }, not() { return b }, is() { return b }, order() { return b }, limit() { return b },
    update(p) { op = 'update'; patch = p; return b }, delete() { op = 'delete'; return b }, insert(r) { op = 'insert'; row = { id: '00000000-0000-4000-8000-00000000000' + (nextId++), status: 'invited', ...r }; return b },
    maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: null })) }, single() { return b.maybeSingle() },
    then(ok) { let out
      if (op === 'insert') { (T[t] ||= []).push(row); out = { data: [row], error: null } }
      else if (op === 'update') { rows().forEach((r) => Object.assign(r, patch)); out = { data: null, error: null } }
      else if (op === 'delete') { T[t] = (T[t] || []).filter((r) => !f.every((fn) => fn(r))); out = { data: null, error: null } }
      else out = { data: rows(), error: null }
      return Promise.resolve(out).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') CARDS.push(a.item); return { data: null, error: null } } }
globalThis.__staff = { ok: true, email: 'krystal@mo-care.com', name: 'Krystal' }
globalThis.fetch = async (url, o) => { url = String(url); const body = o?.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/search/duplicate')) return new Response('{}', { status: 200 })
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push(body); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 }) }
let handler; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' })[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/welcome-call/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, 'const OFFICE_ROLES = []; const requireStaff = async () => globalThis.__staff')
  .replace("from '../_shared/job-auth.ts'", "from '" + path.resolve('test_stubs/job-auth-by-role.mjs') + "'")   // Slice 4 (f255a2a) added the job-auth import (it loads supabase-js from esm.sh); the lock stand-in, as in covered_outside_harness.mjs
const tmp = path.join(process.cwd(), FN, 'welcome-call', '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
const call = async (body) => { const r = await handler(new Request('https://x/f', { method: 'POST', body: JSON.stringify(body) })); return [r.status, await r.json()] }
const CAND = { action: 'invite', candidate_id: '42', first: 'Dana', last: 'Doe', phone: '(417) 555-0101', email: 'dana@x.com' }
const texts = () => SENT.filter((m) => m.type === 'SMS'), emails = () => SENT.filter((m) => m.type === 'Email')

reset(); globalThis.__staff = { ok: false, status: 401, error: 'Sign in first.' }
let [s, j] = await call(CAND); ck('not signed-in office staff: refused, nothing sent', s === 401 && !SENT.length && !T.welcome_calls.length, j)
globalThis.__staff = { ok: true, email: 'krystal@mo-care.com', name: 'Krystal' }
reset(); ;[s, j] = await call({ action: 'preview', first: 'Dana' })
ck('preview: the invite text with the STOP line, nothing sent', /Hi Dana, great news from Caring Companions!.*15-minute Orientation Video Call/.test(j.text) && /Reply STOP to opt out\.$/.test(j.text) && !SENT.length, j)
reset(); ;[s, j] = await call(CAND)
const w = T.welcome_calls[0]
ck('invite: an invitation record, and a text + email with their own booking link', s === 200 && w && w.candidate_id === '42' && w.invited_by === 'Krystal' && texts().length === 1 && emails().length === 1 && texts()[0].message.includes('welcome.html?w=' + w.id) && j.texted && j.emailed, [j, T.welcome_calls])
;[s, j] = await call(CAND); ck('pressing Invite again re-sends the SAME invitation (no second record)', T.welcome_calls.length === 1 && j.reused === true, j)
reset(); T.job_applicants = [{ phone: '4175550101', sms_consent: false, created_at: '2026-09-01' }]; ;[s, j] = await call(CAND)
ck('their application said no to texts: email only, and the office is told why', !j.texted && j.emailed && /did not agree to texts/.test(j.not_sent.join(' ')), j)
reset(); HOUR = '19'; ;[s, j] = await call(CAND); HOUR = '10'
ck('7pm: no text (texts 8am-6pm), the email still goes, the office is told', !j.texted && j.emailed && /8am to 6pm/.test(j.not_sent.join(' ')), j)
// a booked call
reset(); await call(CAND); const id = T.welcome_calls[0].id; Object.assign(T.welcome_calls[0], { status: 'booked', starts_at: '2026-10-05T15:00:00Z', ends_at: '2026-10-05T15:15:00Z' })
T.coordinator_busy.push({ source: 'welcome_call', source_id: id, starts_at: '2026-10-05T15:00:00Z', ends_at: '2026-10-05T15:15:00Z' }); SENT = []
;[s, j] = await call({ action: 'reschedule', id, reason: 'step2' })
ck('reschedule (Step 2 not done): time freed, invitation open again, they are told to finish Step 2 and rebook', T.welcome_calls[0].status === 'invited' && !T.welcome_calls[0].starts_at && !T.coordinator_busy.length && /Viventium Step 2/.test(texts()[0]?.message) && /welcome\.html\?w=/.test(texts()[0]?.message), [j, T.welcome_calls[0], SENT])
SENT = []; ;[s, j] = await call({ action: 'noshow', id }); ck('did not show: marked, a rebook link goes', T.welcome_calls[0].status === 'noshow' && /we missed you/.test(texts()[0]?.message), SENT)
// call them now
SENT = []; T.coordinator_busy = [{ source: 'welcome_call', source_id: 'someone-else', starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: new Date(Date.now() + 10 * 60_000).toISOString() }]
;[s, j] = await call({ action: 'now', id }); ck('call them now while another Orientation Video Call is in the shared room: refused, nothing sent', s === 409 && !SENT.length, j)
T.coordinator_busy = []; ;[s, j] = await call({ action: 'now', id })
ck('call them now: "opening right now" text + email with the Meet link; their booking untouched', s === 200 && /opening right now/.test(texts()[0]?.message) && texts()[0].message.includes('meet.google.com/yqj-nzuo-tgp') && emails().length === 1 && T.welcome_calls[0].status === 'noshow', [j, SENT])
// done frees a later booked time
Object.assign(T.welcome_calls[0], { status: 'booked' }); T.coordinator_busy = [{ source: 'welcome_call', source_id: id, starts_at: '2026-10-09T15:00:00Z', ends_at: '2026-10-09T15:15:00Z' }]
;[s, j] = await call({ action: 'done', id }); ck('done: marked with who and when, and a later time they held goes back on offer', T.welcome_calls[0].status === 'done' && T.welcome_calls[0].done_by === 'Krystal' && !T.coordinator_busy.length, T.welcome_calls[0])

// 2026-10-13 (her ruling, 19 CSR 15-7.021(24)(B)5): on the NEW path, done needs the office's tick that Client Rights, the Code of
// Ethics and the HIPAA policy were explained and they confirmed they understand; it is stored with who and when, plus a readiness event
const newPath = () => { reset(); T.app_data = [{ key: 'candidates', data: [{ id: 42, offer_id: 'off-1' }] }, { key: 'caregivers', data: [] }]
  T.client_journey = [{ journey_id: 'j-1', subject: 'caregiver', status: 'open', offer_id: 'off-1' }]; T.client_journey_step = []; T.client_journey_event = []
  T.client_journey_step_def = [{ key: 'cg.welcome.call', def: { title: 'Orientation Video Call done' } }]
  T.welcome_calls = [{ id: '00000000-0000-4000-8000-0000000000aa', candidate_id: '42', first_name: 'Dana', status: 'booked', starts_at: '2026-10-09T15:00:00Z' }]
  T.coordinator_busy = [{ source: 'welcome_call', source_id: '00000000-0000-4000-8000-0000000000aa', starts_at: '2026-10-09T15:00:00Z', ends_at: '2026-10-09T15:15:00Z' }] }
const WID = '00000000-0000-4000-8000-0000000000aa'
newPath(); ;[s, j] = await call({ action: 'done', id: WID })
ck('new path, done WITHOUT the rights tick: refused with her words, nothing changed (still booked, time still held, no event)', s === 409 && j.needs === 'rights_explained' && /I went over the Client Rights, the Code of Ethics and the HIPAA policy with them, and they confirmed they understand/.test(j.error) && /Nothing was changed/.test(j.error) && T.welcome_calls[0].status === 'booked' && !T.welcome_calls[0].rights_explained_at && T.coordinator_busy.length === 1 && !T.client_journey_event.length, [s, j, T.welcome_calls[0]])
;[s, j] = await call({ action: 'done', id: WID, rights_explained: 'yes' })
ck('new path: only a real true counts as the tick (a string is refused)', s === 409 && T.welcome_calls[0].status === 'booked', j)
;[s, j] = await call({ action: 'done', id: WID, rights_explained: true })
const wr = T.welcome_calls[0], ev = T.client_journey_event[0] || {}
ck('new path, done WITH the tick: done, and the explanation stored: when, who (name + sign-in email), their confirmation', s === 200 && j.rights_explained === true && j.new_path === true && wr.status === 'done' && wr.rights_explained_at && wr.rights_explained_at === wr.done_at && wr.rights_explained_by === 'Krystal' && wr.rights_explained_by_email === 'krystal@mo-care.com' && wr.rights_ack_confirmed === true && !T.coordinator_busy.length, [j, wr])
ck('new path: one readiness event on the participant rights row with who, when and the three things explained', T.client_journey_event.length === 1 && ev.journey_id === 'j-1' && ev.step_key === 'cg.step2.participant_rights' && ev.kind === 'rights_explained' && ev.actor_name === 'Krystal' && ev.actor_email === 'krystal@mo-care.com' && ev.detail.acknowledged === true && ev.detail.explained.join() === 'client_rights,code_of_ethics,hipaa_privacy' && ev.detail.welcome_call_id === WID, ev)
const first = wr.rights_explained_at; globalThis.__staff = { ok: true, email: 'angiel@mo-care.com', name: 'Angie' }
;[s, j] = await call({ action: 'done', id: WID, rights_explained: true })
ck('pressing done again never rewrites the explanation (first record kept, no second event)', s === 200 && T.welcome_calls[0].rights_explained_at === first && T.welcome_calls[0].rights_explained_by === 'Krystal' && T.client_journey_event.length === 1, T.welcome_calls[0])
globalThis.__staff = { ok: true, email: 'krystal@mo-care.com', name: 'Krystal' }
reset(); T.welcome_calls = [{ id: WID, candidate_id: '77', status: 'booked' }]; ;[s, j] = await call({ action: 'done', id: WID })
ck('old path (no readiness card), done without the tick: unchanged, marked done', s === 200 && T.welcome_calls[0].status === 'done' && !T.welcome_calls[0].rights_explained_at && j.new_path === false, [j, T.welcome_calls[0]])
reset(); T.welcome_calls = [{ id: WID, candidate_id: '77', status: 'booked' }]; ;[s, j] = await call({ action: 'done', id: WID, rights_explained: true })
ck('old path with the tick: the explanation is still kept (no readiness card, so no event)', s === 200 && T.welcome_calls[0].rights_explained_by === 'Krystal' && T.welcome_calls[0].rights_ack_confirmed === true && !(T.client_journey_event || []).length, T.welcome_calls[0])
const rx = fs.readFileSync('supabase/welcome-rights-explained.sql', 'utf8'), rxb = fs.readFileSync('supabase/welcome-rights-explained-rollback.sql', 'utf8')
ck('SQL: the four columns, added if missing; only the server writes them; once recorded never changed; idempotent', ['rights_explained_at timestamptz', 'rights_explained_by text', 'rights_explained_by_email text', 'rights_ack_confirmed boolean not null default false'].every((c) => rx.includes('add column if not exists ' + c)) && /current_user in \('anon', 'authenticated'\)/.test(rx) && /A recorded explanation of rights never changes/.test(rx) && /drop trigger if exists welcome_rights_guard_t/.test(rx) && !/drop table|delete from|truncate/i.test(rx))
ck('SQL rollback: the guard goes; the columns go only when no explanation is recorded (nothing deleted)', /drop trigger if exists welcome_rights_guard_t/.test(rxb) && /if exists \(select 1 from public\.welcome_calls where rights_explained_at is not null\)/.test(rxb) && !/delete from|truncate/i.test(rxb))
const wsrc = fs.readFileSync(`${FN}/welcome-call/index.ts`, 'utf8')
ck('no em dash in the new words or the new SQL', !/\u2014/.test(wsrc.slice(wsrc.indexOf('export const RIGHTS_NEEDED'), wsrc.indexOf('export function inviteMessages')) + wsrc.slice(wsrc.indexOf("if (action === 'done')"), wsrc.indexOf("if (action === 'now')")) + rx + rxb))

const sq = fs.readFileSync('welcome_calls.sql', 'utf8'), im = fs.readFileSync(`${FN}/interview-messages/index.ts`, 'utf8')
ck('SQL: times are interview hours in 15-minute steps, never over an interview, an Orientation Video Call or an all-staff block', /av\.activity = 'interview'/.test(sq) && /interval '15 minutes'/.test(sq) && /cb\.coordinator_id is null or cb\.source in \('interview', 'welcome_call'\)/.test(sq))
ck('SQL: a booked call blocks everyone (coordinator_id null), so no interview can be booked over it', /insert into public\.coordinator_busy \(coordinator_id, starts_at, ends_at, source, source_id, label\)\s+values \(null,/.test(sq))
ck('SQL: the public page can only book, read and cancel its own invitation (anon has no table access)', /revoke all on public\.welcome_calls from anon/.test(sq) && /grant execute on function public\.welcome_book\(uuid, timestamptz\) to anon/.test(sq))
ck('reminders: confirmation, day-before, hour-before with the Meet link, 8am-6pm, yes-to-texts, STOP line', /welcome_calls'\)\.select\('\*'\)\.eq\('status', 'booked'\)/.test(im) && /withStop\(message\)/.test(im) && /latestTextConsent\(supabase, w\.phone\)/.test(im) && /!withinOutreachHours\(\)/.test(im))
let all = true; console.log('\nWELCOME CALLS · TEST\n' + '='.repeat(50)); for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
