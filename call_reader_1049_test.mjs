// 1049 · the call reader stuck behind its oldest 80 calls (2026-10-22). Under Node against the REAL call-tasks function with the
// 650 test bench (a stand-in database and GoHighLevel, no AI needed: calls with no transcript): 85 old calls already read and
// 15 newer ones unread, which the old code never reached; the 14-day window; the "behind" alarm; no cards from a call read
// more than 2 days late.   node call_reader_1049_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const F = 'supabase/functions'
const SERVICE = 'service'.repeat(6)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE, GHL_TOKEN: 'ghl-tok', GHL_LOCATION_ID: 'loc1', ANTHROPIC_API_KEY: 'sk-test', HUB_JOB_SECRET: 'j'.repeat(40), AXISCARE_API_KEY: 'ax-tok', AXISCARE_SITE: '12345' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_ct_'))
const rewrite = (src) => src.replace(/^import \{ createClient \} from ['"]https:\/\/esm\.sh\/@supabase\/supabase-js@2['"];?$/m, 'const createClient = globalThis.__fakeCreateClient;')
  .replace(/^import Anthropic from ['"]npm:@anthropic-ai\/sdk['"];?$/m, 'const Anthropic = globalThis.__FakeAnthropic;')
fs.mkdirSync(path.join(tmp, '_shared'))
for (const f of fs.readdirSync(path.join(F, '_shared'))) fs.writeFileSync(path.join(tmp, '_shared', f), rewrite(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))

const STEVE = 'a4b036e3-587e-4b76-bdeb-27357b461a3c'
const VM = 'Speaker 1: Hi, this is Steve. I am calling to arrange a ride. Please call me back at 417 555 0467. Thank you.'
const CALL = 'Speaker 0: Caring Companions, this is Samantha.\nSpeaker 1: My license expired, I need a new one and a Real ID. I need someone to take me to the DMV and help me get in. Can Angiel fit a couple of hours this week?\nSpeaker 0: We will work it out.\nSpeaker 1: I will call you tomorrow to confirm. Email me at steve@example.com.'
let DB, AI, GH, FAILAI, TEXTS, AXV
function reset() {
  DB = {
    app_data: [{ key: 'ops_settings', data: { call_tasks_practice: true, call_tasks_since: '2026-10-09T00:00:00Z', call_pull_since: '2026-09-30T15:08:54Z' } },
      { key: 'ops_items', data: [{ id: 'ops_old', status: 'done', about: 'Steve Algiere', title: 'Uncovered shift: Steve Algiere' }, { id: 'ops_other', status: 'open', about: 'Iris Dorsey', title: 'Call Iris' }] }],
    call_pull_seen: [
      { message_id: 'ipoVD64wn8dUcDyPdjqW', call_at: '2026-10-11T23:36:00Z', direction: 'in', seconds: 20, caller: 'Steve A.', stage: 'done' },
      { message_id: 'gMcTDQ5WoAXMHUmrCbdN', call_at: '2026-10-11T23:37:00Z', direction: 'out', seconds: 136, caller: 'Steve A.', stage: 'done' },
      { message_id: 'oldcall0001', call_at: '2026-10-01T15:00:00Z', direction: 'in', seconds: 50, caller: 'Old C.', stage: 'done' },
      { message_id: 'notdone0001', call_at: '2026-10-11T20:00:00Z', direction: 'in', seconds: 50, caller: 'Err E.', stage: 'pending' }],
    call_task_reading: [], call_promise_watch: [], call_record: [], heartbeats: [], writes: [],
    domains: [{ code: 'client_care', owner_person: 'pk', active: true }, { code: 'scheduling_coverage', owner_person: 'ps', active: true }, { code: 'money', owner_person: 'ps', active: true }, { code: 'payer_programs', owner_person: 'pa', active: true }, { code: 'family_enquiries', owner_person: 'pk', active: true }, { code: 'incidents', owner_person: 'ps', active: true }, { code: 'program_administration', owner_person: 'ps', active: true }],
    persons: [{ person_id: 'pk', full_name: 'Krystal Land', primary_email: 'krystal@cc.test' }, { person_id: 'ps', full_name: 'Samantha Troutman', primary_email: 'samantha@cc.test' }, { person_id: 'pa', full_name: 'Angiel Falig', primary_email: 'angiel@cc.test' }],
    client_journey_step_def: [{ key: 'intake.payer', def: { title: 'Identify the payer' }, active: true }], client_journey: [], client_journey_step: [],
  }
  AI = []; FAILAI = null
  TEXTS = []; AXV = {}
  GH = { transcripts: { ipoVD64wn8dUcDyPdjqW: VM, gMcTDQ5WoAXMHUmrCbdN: CALL }, msg: { ipoVD64wn8dUcDyPdjqW: 'c1', gMcTDQ5WoAXMHUmrCbdN: 'c1' }, contacts: { c1: { firstName: 'Steve', lastName: 'Algiere', phone: '+14175550467', email: 'steve@example.com' } }, calls: [] }
}
let rid = 0
globalThis.__fakeCreateClient = () => ({
  auth: { getUser: async () => ({ data: null, error: { message: 'no' } }) },
  rpc: async (fn, args) => {
    if (fn === 'upsert_app_data_item') { DB.heartbeats.push(args); DB.writes.push(args.target_key)
      if (args.target_key === 'ops_items') { if (globalThis.__SAVEFAIL === 'ops_items') return { data: null, error: { message: 'down' } }
        const row = DB.app_data.find((r) => r.key === 'ops_items'); const it = JSON.parse(JSON.stringify(args.item)); const k = row.data.findIndex((x) => x.id === it.id); if (k >= 0) row.data[k] = it; else row.data.push(it) }
      return { data: null, error: null } }
    if (fn === 'call_who' && globalThis.__WHO) { const w = globalThis.__WHO(String(args.p_phone)); if (w) return { data: w, error: null } }
    if (fn === 'call_who') return { data: String(args.p_phone).endsWith('0467') ? { match: 'one', person_id: STEVE, lead_id: null, name: 'Steve Algiere', roles: ['client'] } : { match: 'none' }, error: null }
    return { data: null, error: { message: 'unknown rpc ' + fn } }
  },
  from: (tb) => { const f = []; let single = false, ord = null, lim = null
    const p = { select() { return p }, eq(k, v) { f.push((r) => String(r[k]) === String(v)); return p }, in(k, v) { f.push((r) => v.map(String).includes(String(r[k]))); return p },
      gte(k, v) { f.push((r) => String(r[k]) >= String(v)); return p }, lt(k, v) { f.push((r) => String(r[k]) < String(v)); return p }, gt(k, v) { f.push((r) => String(r[k]) > String(v)); return p },
      update(vals) { return { eq: (k, v) => { DB.writes.push(tb); if (globalThis.__SAVEFAIL === tb) return Promise.resolve({ error: { message: 'down' } }); for (const r of DB[tb] || []) if (String(r[k]) === String(v)) Object.assign(r, JSON.parse(JSON.stringify(vals))); return Promise.resolve({ error: null }) } } },
      order(k, o) { ord = [k, o?.ascending !== false]; return p }, limit(n) { lim = n; return p }, maybeSingle() { single = true; return p }, not(k, op, v) { f.push((r) => r[k] !== null && r[k] !== undefined); return p },
      insert(row) { DB.writes.push(tb); if (globalThis.__SAVEFAIL === tb) return Promise.resolve({ error: { message: 'database down' } })
        if (tb === 'call_task_reading') { if (DB.call_task_reading.some((r) => r.message_id === row.message_id && r.version === row.version && (r.attempt || 1) === (row.attempt || 1))) return Promise.resolve({ error: { message: 'duplicate key' } }); DB.call_task_reading.push({ id: ++rid, read_at: new Date().toISOString(), ...JSON.parse(JSON.stringify(row)) }) }
        else if (tb === 'call_promise_watch') { if (DB.call_promise_watch.some((r) => r.message_id === row.message_id && r.idx === row.idx)) return Promise.resolve({ error: { message: 'duplicate key' } }); DB.call_promise_watch.push({ id: ++rid, checks: 0, evidence: [], checked_at: null, last_activity_at: null, why: null, ...JSON.parse(JSON.stringify(row)) }) }
        return Promise.resolve({ error: null }) },
      then(ok, bad) { let rows = (DB[tb] || []).filter((r) => f.every((fn) => fn(r))); if (ord) rows = rows.slice().sort((a, b) => (String(a[ord[0]]) < String(b[ord[0]]) ? -1 : 1) * (ord[1] ? 1 : -1)); if (lim) rows = rows.slice(0, lim)
        return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null }).then(ok, bad) } }
    return p },
})
const item = (o) => Object.assign({ responsibility: o.title || 'r', decision: 'new_card', workflow: '', card_id: '', title: '', why: '', area: 'scheduling', urgency: 'routine', due: '', reason: 'r' }, o)
const base = (o) => Object.assign({ summary: 's', caller_role: 'client', about: '', understood: [], commitments: [], is_voicemail: false, items: [], resolves: [], no_task_reason: '' }, o)
const ANSWERS_V7 = {
  ipoVD64wn8dUcDyPdjqW: base({ summary: 'Steve left a voicemail asking to arrange a ride and asked to be called back at 417-555-0467.', is_voicemail: true, about: 'Steve Algiere, client',
    items: [item({ title: 'Call Steve Algiere back about arranging a ride', why: 'Voicemail: Steve wants to arrange a ride.', due: '2026-10-12', urgency: 'today', reason: 'He asked for a call back.' })] }),
  gMcTDQ5WoAXMHUmrCbdN: (req) => base({ summary: 'Steve needs someone to take him to the DMV for a new license and Real ID this week. Email steve@example.com.', about: 'Steve Algiere, client',
    understood: ['License expired', 'Wants Angiel for a couple of hours this week'],
    commitments: [{ what: 'Steve will call tomorrow to confirm the time', kind: 'caller_will', when: 'Monday' }, { what: 'We will work out a time with Angiel', kind: 'we_agreed', when: 'this week' }],
    items: [item({ title: 'Schedule Angiel 2-3 hours with Steve this week: DMV trip for his new license', why: 'His license expired; he will call Monday to confirm. Email steve@example.com.', due: '2026-10-16', urgency: 'this_week', reason: 'We agreed to arrange it and nobody has it.' }),
      item({ responsibility: 'Wait for Steve to confirm', decision: 'caller_owns', area: 'scheduling', reason: 'He said he will call.' }),
      item({ title: 'x', area: 'nonsense', due: 'Friday', decision: 'add_to_existing_card', card_id: 'ops_made_up' })],
    resolves: /message_id ipoVD64wn8dUcDyPdjqW, task_index 0/.test(req.messages[0].content) ? [{ message_id: 'ipoVD64wn8dUcDyPdjqW', task_index: 0 }, { message_id: 'bogus', task_index: 0 }] : [] }),
}
const ANSWERS = {
  ipoVD64wn8dUcDyPdjqW: { call_type: 'client_or_family', is_voicemail: true, tasks: [{ title: 'Call Steve Algiere back about arranging a ride', why: 'Voicemail: Steve wants to arrange a ride and asked to be called back at 417-555-0467.', area: 'scheduling', due: '2026-10-12', add_to_card_id: '' }], resolves: [], no_task_reason: '' },
  gMcTDQ5WoAXMHUmrCbdN: (req) => ({ call_type: 'client_or_family', is_voicemail: false,
    tasks: [{ title: 'Schedule Angiel 2-3 hours with Steve this week: DMV trip for his new license', why: 'His license expired; he needs someone to go with him to the DMV. Asked for a couple of hours in Angiel\'s schedule this week; he will call Monday to confirm. Email steve@example.com.', area: 'scheduling', due: '2026-10-16', add_to_card_id: 'ops_made_up' },
      { title: 'x', why: '', area: 'nonsense', due: 'Friday', add_to_card_id: '' }],
    resolves: /message_id ipoVD64wn8dUcDyPdjqW, task_index 0/.test(req.messages[0].content) ? [{ message_id: 'ipoVD64wn8dUcDyPdjqW', task_index: 0 }, { message_id: 'bogus', task_index: 0 }] : [], no_task_reason: '' }),
}
globalThis.__FakeAnthropic = class { constructor(o) { this.key = o.apiKey; this.beta = { messages: { create: async (req) => { AI.push(req)
  if (req.tools[0].name === 'submit_promise_check') { if (globalThis.__CHECK) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_promise_check', input: globalThis.__CHECK(req) }] }; return { stop_reason: 'end_turn', content: [] } }
  if (FAILAI === 'refusal') return { stop_reason: 'refusal', stop_details: { category: 'general_harms' }, content: [] }
  if (FAILAI === 'throw') throw new Error('overloaded')
  if (FAILAI === 'textonce' && req.messages.length === 1) return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I think the cards are...' }] }
  if (FAILAI === 'textalways') return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'no tool' }] }
  if (globalThis.__EVAL_ANSWER) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_followups', input: globalThis.__EVAL_ANSWER(req) }] }
  const id = Object.keys(ANSWERS_V7).find((k) => req.messages[0].content.includes(k === 'ipoVD64wn8dUcDyPdjqW' ? 'calling to arrange a ride' : 'license expired'))
  const a = typeof ANSWERS_V7[id] === 'function' ? ANSWERS_V7[id](req) : ANSWERS_V7[id]
  return { stop_reason: 'tool_use', content: [{ type: 'text', text: '' }, { type: 'tool_use', name: 'submit_followups', input: a }] } } } } } }
globalThis.fetch = async (url, o) => { url = String(url); GH.calls.push(url + (o && o.method && o.method !== 'GET' ? ' ' + o.method : ''))
  let m
  if (url.includes('axiscare.com/api/visits?')) { const k = Object.keys(AXV).find((x) => url.includes(x)); return new Response(JSON.stringify({ results: { visits: k ? AXV[k] : [] } }), { status: 200 }) }
  if (url.includes('/conversations/search?')) return new Response(JSON.stringify({ conversations: TEXTS.filter((c) => !url.includes('contactId=') || url.includes('contactId=' + c.contactId + '&')).map((c) => ({ id: c.id, contactId: c.contactId, phone: c.phone, fullName: c.name, lastMessageDate: Date.parse(c.msgs.at(-1).dateAdded) })) }), { status: 200 })
  if ((m = url.match(/\/conversations\/([^/]+)\/messages\?limit=\d+$/))) { const c = TEXTS.find((x) => x.id === m[1]); return new Response(JSON.stringify({ messages: { messages: c ? c.msgs : [] } }), { status: 200 }) }
  if ((m = url.match(/\/messages\/([^/]+)\/transcription$/))) return GH.transcripts[m[1]] ? new Response(JSON.stringify([{ sentenceIndex: 0, transcript: GH.transcripts[m[1]] }]), { status: 200 }) : new Response('{}', { status: 404 })
  if ((m = url.match(/\/conversations\/messages\/([^/?]+)$/))) return new Response(JSON.stringify({ message: { id: m[1], contactId: GH.msg[m[1]], userId: 'ghlUserKrystal' } }), { status: 200 })
  if ((m = url.match(/\/contacts\/([^/?]+)$/))) return GH.contacts[m[1]] ? new Response(JSON.stringify({ contact: GH.contacts[m[1]] }), { status: 200 }) : new Response('{}', { status: 404 })
  return new Response('{}', { status: 404 }) }
async function load(fn) { fs.mkdirSync(path.join(tmp, fn), { recursive: true }); const src = rewrite(fs.readFileSync(path.join(F, fn, 'index.ts'), 'utf8'))
  if (/from ['"](https:|npm:)/.test(src)) throw new Error(fn + ' still imports from the internet'); fs.writeFileSync(path.join(tmp, fn, 'index.ts'), src); handler = null; await import(path.join(tmp, fn, 'index.ts')); return handler }
const run = async (h, auth = 'owner', body = {}) => { const H = { 'Content-Type': 'application/json' }; if (auth === 'owner') H.Authorization = 'Bearer ' + SERVICE; if (auth === 'cron') H['x-cron-secret'] = ENV.HUB_JOB_SECRET
  const r = await h(new Request('https://x.supabase.co/functions/v1/call-tasks', { method: 'POST', headers: H, body: JSON.stringify(body) })); return [r.status, await r.json().catch(() => ({}))] }

const H = 3600e3, now = Date.now(), ago = (ms) => new Date(now - ms).toISOString()
const VERSION = 'v13-2026-10-12'
const beats = () => DB.heartbeats.filter((h) => h.target_key === 'automation_heartbeats').map((h) => h.item).filter((x) => x.id === 'hb_call-tasks')
function stuck() {
  reset()
  DB.app_data[0].data = { call_tasks_practice: true, call_tasks_since: ago(30 * 24 * H) }
  DB.call_pull_seen = []; DB.call_task_reading = []
  for (let i = 0; i < 100; i++) {
    const id = 'call' + String(i).padStart(3, '0'), at = ago(((100 - i) * 60 + 5) * 60e3)
    DB.call_pull_seen.push({ message_id: id, call_at: at, direction: 'in', seconds: 20, caller: 'C' + i, stage: 'done' })
    if (i < 85) DB.call_task_reading.push({ id: ++rid, message_id: id, version: VERSION, attempt: 1, error: null, call_at: at, read_at: at, channel: 'call', detail: {} })
  }
}
try {
  const h = await load('call-tasks')
  const lib = await import(path.join(tmp, 'call-tasks', 'index.ts'))
  const sh = await import(path.join(tmp, '_shared', 'call-tasks.ts'))

  /* ── the stuck case: the oldest 80 are all read ── */
  stuck()
  const oldFirst80 = DB.call_pull_seen.slice(0, 80).every((c) => DB.call_task_reading.some((r) => r.message_id === c.message_id))
  ck('the set-up matches 1049: the oldest 80 calls are all read, 15 newer ones are not', oldFirst80 && DB.call_pull_seen.length - DB.call_task_reading.length === 15)
  let [st, b] = await run(h, 'cron')
  const tried = DB.call_task_reading.filter((r) => !/^call0[0-7]|^call08[0-4]/.test(r.message_id)).map((r) => r.message_id).sort()
  ck('it now reaches past the 80: reads the 6 oldest unread calls (085 to 090)', st === 200 && JSON.stringify(tried) === JSON.stringify(['call085', 'call086', 'call087', 'call088', 'call089', 'call090']), [st, tried, b])
  ck('it counts what is left: 9 unread, 8 of them more than 2 hours old', b.unread === 9 && b.behind === 8 && b.behind_since === DB.call_pull_seen[91].call_at, b)
  let hb = beats().at(-1)
  ck('BEHIND: the run reports itself not ok, with the reason first', hb && hb.ok === false && /^BEHIND: 8 call\(s\) unread more than 2 hours/.test(hb.note), hb)
  ;[st, b] = await run(h, 'cron')
  ck('the next run carries on (091 to 096)', ['call091', 'call092', 'call093', 'call094', 'call095', 'call096'].every((id) => DB.call_task_reading.some((r) => r.message_id === id)) && b.behind === 2, b)
  ;[st, b] = await run(h, 'cron')
  hb = beats().at(-1)
  ck('caught up: the newest call (1 hour old, maybe still being transcribed) is waiting, nothing is behind, the run is ok again', b.behind === 0 && hb.ok === true && !/BEHIND/.test(hb.note), [b, hb])

  /* ── the window: never more than 14 days back ── */
  stuck(); DB.call_task_reading = DB.call_pull_seen.map((c) => ({ id: ++rid, message_id: c.message_id, version: VERSION, attempt: 1, error: null, call_at: c.call_at, read_at: c.call_at, channel: 'call', detail: {} }))
  DB.call_pull_seen.unshift({ message_id: 'ancient', call_at: ago(20 * 24 * H), direction: 'in', seconds: 300, caller: 'Old', stage: 'done' })
  ;[st, b] = await run(h, 'cron')
  ck('a call from 20 days ago is let go (outside the 14 days), and nothing is behind', !DB.call_task_reading.some((r) => r.message_id === 'ancient') && b.behind === 0 && b.read === 0, b)
  ck('windowStart: the start date, but never more than 14 days back', lib.windowStart('2026-10-09T00:00:00Z', Date.parse('2026-10-12T00:00:00Z')) === '2026-10-09T00:00:00.000Z' && lib.windowStart('2026-09-01T00:00:00Z', Date.parse('2026-10-22T00:00:00Z')) === '2026-10-08T00:00:00.000Z')
  ck('behindOf: only calls nobody tried, older than 2 hours', lib.behindOf([{ message_id: 'a', call_at: ago(3 * H) }, { message_id: 'b', call_at: ago(3 * H) }, { message_id: 'c', call_at: ago(H) }], new Map([['b', {}]]), now).behind === 1)

  /* ── no cards from a call read more than 2 days late ── */
  ck('readLate: read 3 days after the call is late; 1 day is not', sh.readLate(ago(4 * 24 * H), ago(24 * H)) && !sh.readLate(ago(2 * 24 * H), ago(24 * H)))
  const prom = { kind: 'we_will', area: 'scheduling', what: 'Call Jo back Friday', call_at: ago(5 * 24 * H), history: [{ at: ago(1 * H), status: 'waiting', why: 'promise found' }] }
  ck('promise from a call read late: no promise card, and it says why', /read more than 2 days after the call/.test(sh.promiseSkip(prom)), sh.promiseSkip(prom))
  ck('promise found the same day: as before', sh.promiseSkip({ ...prom, history: [{ at: ago(5 * 24 * H - H), why: 'promise found' }] }) === '' || !/read more than 2 days/.test(sh.promiseSkip({ ...prom, history: [{ at: ago(5 * 24 * H - H), why: 'promise found' }] })))
  ck('a call nobody could read, read late: no "Couldn\'t read" card', /read more than 2 days after the call/.test(sh.unreadSkip({ error: 'GoHighLevel has no transcript', detail: { failure: 'no_transcript' }, seconds: 300, channel: 'call', call_at: ago(4 * 24 * H), read_at: ago(H) })))
  ck('a call nobody could read, read on time: as before (a card)', sh.unreadSkip({ error: 'GoHighLevel has no transcript', detail: { failure: 'no_transcript' }, seconds: 300, channel: 'call', call_at: ago(3 * H), read_at: ago(H) }) === '')
  /* end to end: a 4-day-old 5-minute call with no transcript read now makes no card (practice "would" list stays empty) */
  stuck(); DB.app_data[0].data.call_unread_cards_live = false
  DB.call_task_reading = DB.call_pull_seen.map((c) => ({ id: ++rid, message_id: c.message_id, version: VERSION, attempt: 1, error: null, call_at: c.call_at, read_at: c.call_at, channel: 'call', detail: {} }))
  DB.call_pull_seen.push({ message_id: 'late5min', call_at: ago(4 * 24 * H), direction: 'in', seconds: 300, caller: 'Late L.', stage: 'done' })
  ;[st, b] = await run(h, 'cron')
  ck('end to end: the late call is read (kept), and makes no "Couldn\'t read" card', DB.call_task_reading.some((r) => r.message_id === 'late5min') && b.unread_cards_would === 0 && b.unread_skipped >= 1, b)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
const bad = res.filter((r) => !r[1])
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n      ' + note))
console.log(`\n${res.length - bad.length}/${res.length} passed` + (bad.length ? ' · FAIL' : ' · ALL GREEN'))
process.exit(bad.length ? 1 : 0)
