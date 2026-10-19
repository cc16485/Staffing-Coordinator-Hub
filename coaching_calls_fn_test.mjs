// Coaching by recorded phone call, part C1 · the rules, the hr-coach-call function and the Calls view's privacy, against
// fakes (no GoHighLevel, no database) · node coaching_calls_fn_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, d) => res.push([n, !!c, c ? '' : String(JSON.stringify(d ?? null)).slice(0, 700)])
const FN = 'supabase/functions'
const R = await import(path.join(process.cwd(), FN, '_shared/coaching-calls.ts'))
const T0 = Date.parse('2026-10-20T15:00:00Z')
const mk = (id, dt, sec, status, user, dir = 'out') => ({ id, at: T0 + dt, seconds: sec, status, userId: user, direction: dir, contactId: 'C1' })

// ---- the rules ----
const calls = [mk('m0', -5 * 60e3, 300, 'completed', 'U1'), mk('m1', 2 * 60e3, 240, 'completed', 'U2'), mk('m2', 3 * 60e3, 200, 'completed', 'U1'), mk('m3', 4 * 60e3, 400, 'completed', 'U1'), mk('m4', 12 * 60e3, 400, 'completed', 'U1')]
ck('after a tap: the MANAGER\'s first call from a minute before to 10 minutes after (not someone else\'s, not before, not later)', R.matchAfterTap(calls, T0, 'U1', new Set())?.id === 'm2')
ck('...one call counts for one record: an already-linked call is passed over', R.matchAfterTap(calls, T0, 'U1', new Set(['m2']))?.id === 'm3')
ck('...nothing when the manager placed no call in the window', R.matchAfterTap(calls, T0, 'U3', new Set()) === null && R.matchAfterTap(calls, T0, '', new Set()) === null)
const pl = R.pickList(calls, 'U1', new Set(['m3']), T0 + 20 * 60e3)
ck('the pick list: only the manager\'s own calls, newest first, never a linked one', pl.map((c) => c.id).join() === 'm4,m2,m0', pl)
ck('qualifies: completed, 3 minutes or more, with its recording', R.qualify({ status: 'completed', seconds: 180 }, true, 180).ok)
ck('...a voicemail never counts (967: voicemails have recordings)', R.qualify({ status: 'voicemail', seconds: 33 }, true, 180).reason === 'It went to voicemail.')
ck('...no answer never counts', /Nobody answered/.test(R.qualify({ status: 'no-answer', seconds: 0 }, false, 180).reason))
ck('...a 2-second "completed" call never counts (967: they have recordings)', /too short \(2 seconds/.test(R.qualify({ status: 'completed', seconds: 2 }, true, 180).reason))
ck('...no recording, no count', /no recording/.test(R.qualify({ status: 'completed', seconds: 400 }, false, 180).reason) && !R.qualify({ status: 'completed', seconds: 400 }, null, 180).ok)
ck('minimum: 3 minutes unless set between 1 and 30 minutes', R.minSeconds({}) === 180 && R.minSeconds({ coaching_call_min_seconds: 300 }) === 300 && R.minSeconds({ coaching_call_min_seconds: 5 }) === 180)
const skip = R.skipRule([{ ghl_message_id: 'mX' }, { ghl_contact_id: 'C1', phone_digits: '4175550100', tap_at: new Date(T0).toISOString() }])
ck('private: a linked call by its id', skip({ id: 'mX' }) && !skip({ id: 'mY' }))
ck('private: any call with that contact from a minute before the tap to an hour after (even before it is linked)', skip({ contactId: 'C1', at: T0 + 30 * 60e3 }) && skip({ phone: '(417) 555-0100', at: T0 + 5 * 60e3 }) && !skip({ contactId: 'C1', at: T0 + 2 * 3600e3 }) && !skip({ contactId: 'C1', at: T0 - 10 * 60e3 }))
ck('...other people\'s calls stay as they are', !skip({ contactId: 'C2', at: T0 }) && !skip({ phone: '4175550199', at: T0 }))
ck('a GoHighLevel message reads as a call (text messages do not)', R.asCall({ messageType: 'TYPE_CALL', id: 'a', dateAdded: '2026-10-20T15:00:00Z', userId: 'U', meta: { call: { duration: 90, status: 'Completed' } } }).status === 'completed' && R.asCall({ messageType: 'TYPE_SMS', id: 'b' }) === null)

// ---- the function ----
let T, APP, GHLCALLS, REC, BRIDGE, OPENS, WHO, OWNERKEY, NOW
const reset = (o = {}) => {
  APP = { ops_settings: { hr_coaching_calls_live: !!o.live, ghl_user_ids: { 'krystal@mo-care.com': 'UK', 'zach@mo-care.com': 'UZ' } }, caregivers: [{ first: 'Jordan', last: 'Miller', axiscare_id: '77', phone: '4175550100' }] }
  T = { hr_coaching: [{ id: '11111111-1111-4111-8111-111111111111', axiscare_caregiver_id: '77', caregiver: 'Jordan Miller', kind: 'coaching', status: 'open', assigned_to: 'krystal@mo-care.com' }], hr_coaching_call: [] }
  GHLCALLS = []; REC = {}; BRIDGE = []; OPENS = []; WHO = o.who || 'zach'; OWNERKEY = false; NOW = Date.now()
}
let n = 0; const uuid = () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0')
const q = (t) => { const st = { f: [], op: 'select', neq: [] }; const rows = () => (T[t] || []).filter((x) => st.f.every(([c, v, k]) => k === 'gte' ? x[c] >= v : k === 'lt' ? x[c] < v : x[c] === v) && st.neq.every((c) => x[c] != null))
  const fin = () => {
    if (t === 'app_data') { const k = st.f.find(([c]) => c === 'key')[1]; return { data: k in APP ? { data: APP[k] } : null, error: null } }
    if (st.op === 'insert') { if (st.row.ghl_message_id && T[t].some((x) => x.ghl_message_id === st.row.ghl_message_id)) return { data: null, error: { message: 'duplicate key' } }
      const r = { id: uuid(), created_at: new Date().toISOString(), ...st.row }; T[t].push(r); return { data: r, error: null } }
    if (st.op === 'update') { const hit = rows(); if (st.row.ghl_message_id && T[t].some((x) => x.ghl_message_id === st.row.ghl_message_id && !hit.includes(x))) return { data: null, error: { message: 'duplicate key value violates unique' } }
      for (const x of hit) Object.assign(x, st.row); return { data: hit, error: null } }
    return { data: rows(), error: null } }
  const b = { select() { return b }, eq(c, v) { st.f.push([c, v]); return b }, gte(c, v) { st.f.push([c, v, 'gte']); return b }, lt(c, v) { st.f.push([c, v, 'lt']); return b },
    not(c) { st.neq.push(c); return b }, order() { return b }, limit() { return b },
    insert(row) { st.op = 'insert'; st.row = row; return b }, update(row) { st.op = 'update'; st.row = row; return b },
    single() { const r = fin(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] : r.data, error: r.error }) },
    maybeSingle() { const r = fin(); return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error }) },
    then(ok) { return Promise.resolve(fin()).then(ok) } }; return b }
globalThis.__db = { from: q, storage: { from: () => ({ upload: (p) => { globalThis.__up = p; return Promise.resolve({ error: null }) }, download: () => Promise.resolve({ data: new Blob(['x'], { type: 'audio/x-wav' }), error: null }) }) } }
const stubs = {
  '_cc_auth.ts': "export const requireStaff = async () => { const w = globalThis.__WHO(); if (!w) return { ok: false, status: 401, error: 'Sign in' }; return { ok: true, person_id: 'p', name: w, email: w + '@mo-care.com', roles: w === 'krystal' || w === 'angiel' ? ['care_coordinator'] : ['owner_admin'] } }\n",
  '_cc_job.ts': "export const jobCaller = async () => globalThis.__OWNERKEY() ? 'owner' : null\n",
  '_cc_bridge.ts': "export const ghlCallBridge = async (db, ghl, ops, caller, who) => { globalThis.__BRIDGE(caller, who); return { ok: true, ringing: 'you', contact_id: 'C1', name: 'Jordan', app_url: '', web_url: '' } }\nexport const ghlUserFor = async (db, ghl, ops, email) => ({ id: (ops.ghl_user_ids || {})[email] || '', via: 'settings', api: 'not_asked' })\n",
  '_cc_log.ts': "export const logOpen = async (db, r) => { globalThis.__OPEN(r); return true }\nexport const ipOf = () => ''\n",
}
for (const [f, c] of Object.entries(stubs)) fs.writeFileSync(`${FN}/_shared/${f}`, c)
process.on('exit', () => { for (const f of Object.keys(stubs)) try { fs.unlinkSync(`${FN}/_shared/${f}`) } catch { /* */ } })
globalThis.__WHO = () => WHO; globalThis.__OWNERKEY = () => OWNERKEY; globalThis.__BRIDGE = (c, w) => BRIDGE.push([c, w]); globalThis.__OPEN = (r) => OPENS.push(r)
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'L' }
globalThis.fetch = async (url) => { const u = String(url)
  if (u.includes('/conversations/search')) return new Response(JSON.stringify({ conversations: [{ id: 'conv1' }] }), { status: 200 })
  if (u.includes('/conversations/conv1/messages')) return new Response(JSON.stringify({ messages: { messages: GHLCALLS } }), { status: 200 })
  const m = u.match(/messages\/([^/]+)\/locations\/L\/recording/); if (m) return REC[m[1]] ? new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/x-wav' } }) : new Response('', { status: 404 })
  if (u.includes('/contacts/?')) return new Response(JSON.stringify({ contacts: [{ id: 'C1', phone: '+14175550100' }] }), { status: 200 })
  throw new Error('unexpected fetch ' + u) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/hr-coach-call/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace("'../_shared/staff-auth.ts'", "'../_shared/_cc_auth.ts'").replace("'../_shared/job-auth.ts'", "'../_shared/_cc_job.ts'")
  .replace("'../_shared/ghl-call-bridge.ts'", "'../_shared/_cc_bridge.ts'").replace("'../_shared/doc-log.ts'", "'../_shared/_cc_log.ts'")
const tmp = path.join(process.cwd(), FN, 'hr-coach-call', '_t.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const call = async (body) => { const r = await handler(new Request('https://x/functions/v1/hr-coach-call', { method: 'POST', body: JSON.stringify(body) })); const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = { raw: t } } return { s: r.status, j } }
const CID = '11111111-1111-4111-8111-111111111111'
const msg = (id, minsAfter, sec, status, user) => ({ messageType: 'TYPE_CALL', id, contactId: 'C1', userId: user, direction: 'outbound', dateAdded: new Date(Date.now() + minsAfter * 60e3).toISOString(), meta: { call: { duration: sec, status } } })

reset({ who: 'krystal' }); let r = await call({ action: 'tap', coaching_id: CID })
ck('switched off: a coordinator can\'t use it yet', r.s === 403 && !BRIDGE.length)
reset(); r = await call({ action: 'tap', coaching_id: CID })
ck('switched off, Zach (practice): Call now rings him through the office bridge with the employee\'s phone', r.j.ok && BRIDGE.length === 1 && BRIDGE[0][1].phone === '+14175550100' && r.j.practice === true, r.j)
ck('...the tap is kept (practice) with the contact, his GoHighLevel user and the time; it starts waiting', T.hr_coaching_call[0].state === 'waiting' && T.hr_coaching_call[0].ghl_contact_id === 'C1' && T.hr_coaching_call[0].ghl_user_id === 'UZ' && T.hr_coaching_call[0].practice === true)
ck('...and it says to start with the recording line', /being recorded for our coaching records/.test(r.j.say_first))
const callId = T.hr_coaching_call[0].id
GHLCALLS = [msg('g1', 1, 240, 'completed', 'UK'), msg('g2', 1.5, 30, 'voicemail', 'UZ'), msg('g3', 3, 260, 'completed', 'UZ')]
r = await call({ action: 'find', call_id: callId })
ck('find: his FIRST call after the tap (a voicemail), not Krystal\'s; it is an attempt with the reason', T.hr_coaching_call[0].ghl_message_id === 'g2' && T.hr_coaching_call[0].state === 'attempt' && /voicemail/.test(T.hr_coaching_call[0].reason), T.hr_coaching_call[0])
r = await call({ action: 'confirm', call_id: callId }); ck('an attempt cannot be confirmed', r.s === 409)
REC.g3 = true; r = await call({ action: 'tap', coaching_id: CID }); const c2 = T.hr_coaching_call[1].id
r = await call({ action: 'find', call_id: c2 })
ck('call again: the next unlinked call qualifies (completed, over 3 minutes, recording back)', T.hr_coaching_call[1].ghl_message_id === 'g3' && T.hr_coaching_call[1].state === 'qualifies' && T.hr_coaching_call[1].recording_ok === true, T.hr_coaching_call[1])
r = await call({ action: 'confirm', call_id: c2 }); ck('Zach confirms he spoke with them: confirmed (practice keeps no audio copy)', r.j.state === 'confirmed' && T.hr_coaching_call[1].audio_path === null && T.hr_coaching_call[1].confirmed_by === 'zach@mo-care.com', r.j)
r = await call({ action: 'list', coaching_id: CID }); ck('list: the calls, without the audio path', r.j.calls.length === 2 && !('audio_path' in r.j.calls[0]) && r.j.min_seconds === 180)
r = await call({ action: 'play', call_id: c2 }); ck('play: the audio, and the play is logged', r.s === 200 && OPENS.length === 1 && OPENS[0].doc === 'coaching_call')

reset({ live: true, who: 'krystal' }); REC.k1 = true; GHLCALLS = [msg('k1', 2, 200, 'completed', 'UK')]
r = await call({ action: 'tap', coaching_id: CID }); const k = T.hr_coaching_call[0].id
ck('live: the assigned coordinator can call; it is not practice', r.j.ok && T.hr_coaching_call[0].practice === false && T.hr_coaching_call[0].ghl_user_id === 'UK')
r = await call({ action: 'find', call_id: k }); ck('...her call is found and qualifies', T.hr_coaching_call[0].state === 'qualifies', T.hr_coaching_call[0])
WHO = 'zach'; r = await call({ action: 'confirm', call_id: k }); ck('...Zach can confirm it as an owner', r.j.state === 'confirmed' && !!globalThis.__up, r.j)
reset({ live: true, who: 'angiel' }); r = await call({ action: 'tap', coaching_id: CID }); ck('live: another coordinator cannot call on Krystal\'s record', r.s === 403)
reset({ live: true, who: 'angiel' }); T.hr_coaching_call.push({ id: '22222222-2222-4222-8222-222222222222', coaching_id: CID, ghl_message_id: 'z', state: 'confirmed', tapped_by: 'krystal@mo-care.com', audio_path: 'coaching/x.wav' })
r = await call({ action: 'play', call_id: '22222222-2222-4222-8222-222222222222' }); ck('...nor play its recording', r.s === 403 && !OPENS.length)

reset({ live: true, who: 'krystal' }); GHLCALLS = [msg('p1', -60, 300, 'completed', 'UK'), msg('p2', -30, 250, 'completed', 'UZ'), msg('p3', -10, 400, 'completed', 'UK')]; REC.p1 = true
r = await call({ action: 'candidates', coaching_id: CID }); ck('the pick list: only her own calls with them, newest first', r.j.calls.map((c) => c.message_id).join() === 'p3,p1', r.j)
r = await call({ action: 'pick', coaching_id: CID, message_id: 'p2' }); ck('she cannot pick someone else\'s call', !r.j.ok)
r = await call({ action: 'pick', coaching_id: CID, message_id: 'p3' }); ck('picking a call with no recording: an attempt, with why', r.j.state === 'attempt' && /no recording/.test(r.j.reason), r.j)
WHO = 'krystal'; r = await call({ action: 'exception', call_id: T.hr_coaching_call[0].id, reason: 'GoHighLevel recording outage on Oct 20' }); ck('only Zach or Samantha can excuse a missing recording', r.s === 403)
WHO = 'zach'; r = await call({ action: 'exception', call_id: T.hr_coaching_call[0].id, reason: 'short' }); ck('...with a real reason', r.s === 400)
r = await call({ action: 'exception', call_id: T.hr_coaching_call[0].id, reason: 'GoHighLevel recording outage on Oct 20' }); ck('...then it counts as an exception, with his name and reason', T.hr_coaching_call[0].state === 'exception' && T.hr_coaching_call[0].exception_by === 'zach@mo-care.com')
WHO = 'krystal'; r = await call({ action: 'pick', coaching_id: CID, message_id: 'p3' }); ck('one call, one record: a linked call is no longer in the list', !r.j.ok)
reset({ live: true, who: 'krystal' }); GHLCALLS = [msg('v1', 1, 33, 'voicemail', 'UK')]; REC.v1 = true; await call({ action: 'tap', coaching_id: CID }); await call({ action: 'find', call_id: T.hr_coaching_call[0].id })
WHO = 'zach'; r = await call({ action: 'exception', call_id: T.hr_coaching_call[0].id, reason: 'GoHighLevel recording outage on Oct 20' }); ck('a voicemail can never be excused', r.s === 409)

reset(); T.hr_coaching_call.push({ id: '33333333-3333-4333-8333-333333333333', coaching_id: CID, state: 'waiting', tap_at: new Date(Date.now() - 50 * 60e3).toISOString(), ghl_contact_id: 'C1', ghl_user_id: 'UZ' },
  { id: '44444444-4444-4444-8444-444444444444', coaching_id: CID, state: 'waiting', tap_at: new Date(Date.now() - 2 * 60e3).toISOString(), ghl_contact_id: 'C1', ghl_user_id: 'UZ' })
GHLCALLS = [msg('s1', -1, 300, 'completed', 'UZ')]; REC.s1 = true
WHO = null; r = await call({ action: 'sweep' }); ck('the schedule needs the job key', r.s === 401)
OWNERKEY = true; r = await call({ action: 'sweep' })
ck('the schedule: a recent tap gets its call; one older than 30 minutes is given up with the pick-list hint', T.hr_coaching_call[1].state === 'qualifies' && T.hr_coaching_call[0].state === 'no_call' && /pick the call/.test(T.hr_coaching_call[0].reason), T.hr_coaching_call)

reset({ live: true, who: 'zach' }); APP.coordinator_staff = [{ email: 'krystal@mo-care.com', name: 'Krystal Test', phone: '4175550111' }]
T.hr_coaching = [{ id: '55555555-5555-4555-8555-555555555555', subject_type: 'office', subject_email: 'krystal@mo-care.com', caregiver: 'Krystal Test', kind: 'coaching', status: 'open', assigned_to: 'zach@mo-care.com' }]
r = await call({ action: 'tap', coaching_id: '55555555-5555-4555-8555-555555555555' })
ck('office coaching: Call now dials the office employee from the staff list', r.j.ok && BRIDGE[0][1].phone === '+14175550111', r.j)
WHO = 'krystal'; r = await call({ action: 'list', coaching_id: '55555555-5555-4555-8555-555555555555' })
ck('...and a coordinator can never open an office coaching record', r.s === 403)
const body = ['hr-coach-call/index.ts', '_shared/coaching-calls.ts'].map((f) => fs.readFileSync(`${FN}/${f}`, 'utf8')).join('')
ck('no em dashes', !/—/.test(body))
ck('the four places that would show a coaching call all check it', ['calls-feed', 'call-pull', 'call-tasks', 'call-disposition'].every((f) => /loadSkip\(/.test(fs.readFileSync(`${FN}/${f}/index.ts`, 'utf8'))))
ck('...the Calls view filters its list (fresh, cached and stale) and refuses the audio', (() => { const s = fs.readFileSync(`${FN}/calls-feed/index.ts`, 'utf8'); return (s.match(/notCoaching\(/g) || []).length === 3 && /if \(isCoaching\(\{ id: body\.recording \}\)\) return json\(\{ error: 'This call is private\.' \}, 403\)/.test(s) })())
ck('...each fails closed (cannot check = nothing shown, read or sent)', ['calls-feed', 'call-pull', 'call-tasks', 'call-disposition'].every((f) => /try \{ (const )?isCoaching = await loadSkip\([a-z]+\)/.test(fs.readFileSync(`${FN}/${f}/index.ts`, 'utf8')) && /catch/.test(fs.readFileSync(`${FN}/${f}/index.ts`, 'utf8'))))
let f = 0; for (const [nm, ok, d] of res) { console.log((ok ? 'PASS' : 'FAIL') + ' · ' + nm + (ok ? '' : '  ' + d)); if (!ok) f++ }
console.log((res.length - f) + '/' + res.length); process.exit(f ? 1 : 0)
