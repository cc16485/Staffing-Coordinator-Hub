// 991 · Calls nobody could read become My Work cards (2026-10-18, no silent failures). Under Node against the REAL
// call-tasks function and _shared/call-tasks.ts with a stand-in database, GoHighLevel and model. Made-up people only.
// Nothing is sent to anyone.
//   node unread_cards_991_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const F = 'supabase/functions'
const SERVICE = 'service'.repeat(6)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE, GHL_TOKEN: 'ghl-tok', GHL_LOCATION_ID: 'loc1', ANTHROPIC_API_KEY: 'sk-test', HUB_JOB_SECRET: 'j'.repeat(40) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_uc991_'))
const rewrite = (src) => src.replace(/^import \{ createClient \} from ['"]https:\/\/esm\.sh\/@supabase\/supabase-js@2['"];?$/m, 'const createClient = globalThis.__fakeCreateClient;')
  .replace(/^import Anthropic from ['"]npm:@anthropic-ai\/sdk['"];?$/m, 'const Anthropic = globalThis.__FakeAnthropic;')
fs.mkdirSync(path.join(tmp, '_shared'))
for (const f of fs.readdirSync(path.join(F, '_shared'))) fs.writeFileSync(path.join(tmp, '_shared', f), rewrite(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))

const NOW = Date.now(), H = (h) => new Date(NOW + h * 36e5).toISOString()
const day = (h) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(NOW + h * 36e5))
const DUE2 = day(-48), TODAY = day(0), DUE9 = day(-24 * 9)
let DB, AI, CALLS, FAIL_SAVE
const rd = (message_id, o) => Object.assign({ message_id, version: 'v13-2026-10-12', mode: 'live', channel: 'call', call_at: H(-30), direction: 'in', seconds: 95, caller: 'Ann', who_name: 'Ann Talk', person_id: null, lead_id: null,
  error: 'the model did not submit its answer', attempt: 3, detail: { contact_id: 'c_' + message_id }, tasks: [], resolves: [], read_at: H(-29) }, o)
function reset(st) {
  DB = {
    app_data: [{ key: 'ops_settings', data: Object.assign({ call_tasks_practice: true, call_tasks_texts: false, call_tasks_since: H(-24 * 13) }, st) },
      { key: 'ops_items', data: [
        { id: 'cfu_mx', kind: 'call_followup', status: 'done', created_by: 'call-tasks', closed_by: 'Sam T', about: 'Xena', title: "Couldn't read a call with Xena", created_at: H(-20) },
        { id: 'cfu_mlater', kind: 'call_followup', status: 'open', created_by: 'call-tasks', about: 'Lou Later', title: "Couldn't read a call with Lou Later", created_at: H(-20), history: [] },
      ] },
      { key: 'coordinator_staff', data: [{ id: 1, name: 'Sam T', email: 'S@cc.test' }, { id: 2, name: 'Kris L', email: 'k@cc.test' }] }],
    domains: [{ code: 'scheduling_coverage', owner_person: 'p_s', active: true }, { code: 'program_administration', owner_person: 'p_s', active: true }],
    persons: [{ person_id: 'p_s', full_name: 'Sam T', primary_email: 's@cc.test' }],
    call_task_reading: [
      rd('ma'),                                                                                       // AI failed 3 times on a real call: a card
      rd('mn', { who_name: null, caller: 'Nia', seconds: 140, error: 'GoHighLevel has no transcript for this call (140 seconds). Listen to the recording.', detail: { contact_id: 'c_mn', failure: 'no_transcript' } }),   // long call, no transcript: a card
      rd('mh', { who_name: null, caller: 'Hal', seconds: 5, error: 'GoHighLevel has no transcript for this call (5 seconds). Listen to the recording.', detail: { failure: 'no_transcript' } }),   // hang-up: nothing
      rd('mr', { who_name: 'Rita Retry', attempt: 1 }),                                               // still being tried again: nothing yet
      rd('sms:t1', { channel: 'text', seconds: 0, who_name: 'Tess Text' }),                           // texts the AI could not read: a card
      rd('mo', { who_name: 'Old Olga', call_at: H(-24 * 9), read_at: H(-24 * 9) }),                   // older than 7 days: never
      rd('mx', { who_name: 'Xena' }),                                                                 // its card a person closed: never again
      rd('mlater', { who_name: 'Lou Later', read_at: H(-28) }), rd('mlater', { who_name: 'Lou Later', error: null, attempt: 1, read_at: H(-2) }),   // a later try worked: its card closes
      rd('mok', { who_name: 'Okay Oz', error: null, attempt: 1 }),                                    // read fine: nothing
    ],
    call_promise_watch: [], call_record: [], call_card_check: [], call_pull_seen: [], client_journey_step_def: [], person_source_id: [], writes: [], patches: [], beats: [],
  }
  AI = []; CALLS = []; FAIL_SAVE = false
}
const ops = () => DB.app_data.find((r) => r.key === 'ops_items').data
const item = (id) => ops().find((x) => x.id === id)
const PATCH_OK = ['status', 'closed_at', 'closed_by', 'resolution_code', 'close_reason', 'last_activity_at', 'looks_done']
globalThis.__fakeCreateClient = () => ({
  auth: { getUser: async () => ({ data: null, error: { message: 'no' } }) },
  rpc: async (fn, args) => {
    if (fn === 'upsert_app_data_item') {
      if (args.target_key === 'automation_heartbeats') { DB.beats.push(args.item); return { data: null, error: null } }
      if (FAIL_SAVE && args.target_key === 'ops_items') return { data: null, error: { message: 'could not save' } }
      DB.writes.push(args.target_key)
      if (args.target_key === 'ops_items') { const it = JSON.parse(JSON.stringify(args.item)); const k = ops().findIndex((x) => x.id === it.id); if (k >= 0) ops()[k] = it; else ops().push(it) }
      return { data: null, error: null } }
    if (fn === 'call_card_patch') { DB.patches.push(args)
      if (Object.keys(args.p_patch).some((k) => !PATCH_OK.includes(k))) return { data: null, error: { message: 'cannot be changed this way' } }
      const it = item(args.p_id); if (!it || it.kind !== 'call_followup' || it.status !== 'open') return { data: false, error: null }
      Object.assign(it, JSON.parse(JSON.stringify(args.p_patch))); it.history = [...(it.history || []), args.p_history]; return { data: true, error: null } }
    if (fn === 'call_who') return { data: { match: 'none' }, error: null }
    return { data: null, error: { message: 'unknown rpc ' + fn } }
  },
  from: (tb) => { const f = []; let single = false, ord = null, lim = null
    const p = { select() { return p }, eq(k, v) { f.push((r) => String(r[k]) === String(v)); return p }, in(k, v) { f.push((r) => v.map(String).includes(String(r[k]))); return p },
      gte(k, v) { f.push((r) => String(r[k]) >= String(v)); return p }, lt(k, v) { f.push((r) => String(r[k]) < String(v)); return p }, gt(k, v) { f.push((r) => String(r[k]) > String(v)); return p },
      not() { return p }, order(k, o) { ord = [k, o?.ascending !== false]; return p }, limit(n) { lim = n; return p }, maybeSingle() { single = true; return p },
      update(vals) { return { eq: (k, v) => { DB.writes.push(tb); for (const r of DB[tb] || []) if (String(r[k]) === String(v)) Object.assign(r, JSON.parse(JSON.stringify(vals))); return Promise.resolve({ error: null }) } } },
      insert(row) { DB.writes.push(tb); (DB[tb] = DB[tb] || []).push(JSON.parse(JSON.stringify(row))); return Promise.resolve({ error: null }) },
      upsert(row, o) { DB.writes.push(tb); const k = (o && o.onConflict) || 'id'; const arr = (DB[tb] = DB[tb] || []); const i = arr.findIndex((r) => r[k] === row[k])
        if (i >= 0) Object.assign(arr[i], JSON.parse(JSON.stringify(row))); else arr.push(JSON.parse(JSON.stringify(row))); return Promise.resolve({ error: null }) },
      then(ok, bad) { let rows = (DB[tb] || []).filter((r) => f.every((fn) => fn(r))); if (ord) rows = rows.slice().sort((a, b) => (String(a[ord[0]]) < String(b[ord[0]]) ? -1 : 1) * (ord[1] ? 1 : -1)); if (lim) rows = rows.slice(0, lim)
        return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null }).then(ok, bad) } }
    return p },
})
globalThis.__FakeAnthropic = class { constructor() { this.beta = { messages: { create: async (req) => { AI.push(req)
  if (req.tools[0].name === 'submit_promise_check') return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_promise_check',
    input: /Kim/.test(req.messages[0].content) ? { status: 'kept', why: 'The office called Kim back on Saturday.', evidence: ['Office call Sat'] } : { status: 'not_yet', why: 'Nothing shows it.', evidence: [] } }] }
  if (req.tools[0].name === 'submit_card_check') return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_card_check', input: { status: 'not_yet', why: '', evidence: [] } }] }
  throw new Error('unexpected model call ' + req.tools[0].name) } } } } }
globalThis.fetch = async (url, o) => { url = String(url); CALLS.push((o && o.method) || 'GET'); let m
  if ((m = url.match(/\/conversations\/messages\/([^/?]+)$/))) return m[1] === 'pk' ? new Response(JSON.stringify({ message: { contactId: 'c_kim' } }), { status: 200 }) : new Response('{}', { status: 404 })
  if (url.includes('/conversations/search?')) return new Response(JSON.stringify({ conversations: url.includes('contactId=c_kim&') ? [{ id: 'v_kim', contactId: 'c_kim' }] : [] }), { status: 200 })
  if (url.includes('/conversations/v_kim/messages')) return new Response(JSON.stringify({ messages: { messages: [{ id: 'k1', dateAdded: H(-10), direction: 'outbound', type: 2, messageType: 'TYPE_CALL' }] } }), { status: 200 })
  return new Response('{}', { status: 404 }) }
async function load(fn) { fs.mkdirSync(path.join(tmp, fn), { recursive: true }); fs.writeFileSync(path.join(tmp, fn, 'index.ts'), rewrite(fs.readFileSync(path.join(F, fn, 'index.ts'), 'utf8')))
  handler = null; await import(path.join(tmp, fn, 'index.ts')); return handler }
const run = async (h) => { const r = await h(new Request('https://x.supabase.co/functions/v1/call-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SERVICE }, body: '{}' })); return [r.status, await r.json().catch(() => ({}))] }

try {
  const lib = await import(path.join(tmp, '_shared', 'call-tasks.ts'))
  ck('final: no transcript, or three failed tries; one failed try is still being retried', lib.unreadFinal({ error: 'x', detail: { failure: 'no_transcript' }, attempt: 1 })
    && lib.unreadFinal({ error: 'x', attempt: 3 }) && !lib.unreadFinal({ error: 'x', attempt: 1 }) && !lib.unreadFinal({ error: null, attempt: 3 }))
  ck('skip: a short call with no transcript is a hang-up; 30 seconds and up is real', /hang-up/.test(lib.unreadSkip({ error: 'no transcript', seconds: 12, channel: 'call', detail: { failure: 'no_transcript' } }))
    && lib.unreadSkip({ error: 'no transcript', seconds: 30, channel: 'call', detail: { failure: 'no_transcript' } }) === '' && lib.unreadSkip({ error: 'model failed', seconds: 5, channel: 'call' }) === '')
  ck('skip: the shortest length is a setting', lib.unreadSkip({ error: 'no transcript', seconds: 40, channel: 'call', detail: { failure: 'no_transcript' } }, 60) !== '')
  const c = lib.unreadCard({ message_id: 'sms:ab-1', channel: 'call', call_at: H(-3), seconds: 95, who_name: 'Ann Talk', error: 'boom', detail: { contact_id: 'c1' } }, { email: 's@cc.test', name: 'Sam T', via: 'held the phones' }, NOW)
  ck('card: one id per call, a call card in Work, owned, says listen in GoHighLevel and how long', c.id === 'cfu_smsab1' && c.kind === 'call_followup' && c.owner === 's@cc.test' && /listen to it in GoHighLevel/.test(c.title)
    && /1 min 35 sec call/.test(c.detail) && /three times/.test(c.detail) && c.ghl_contact_id === 'c1' && c.source.type === 'call_unread', c)
  ck('card: no em dash anywhere', !/[—―]/.test(JSON.stringify(c) + JSON.stringify(lib.unreadCard({ message_id: 'm', channel: 'text', call_at: H(-1), detail: { failure: 'no_transcript' } }, null, NOW))))

  const h = await load('call-tasks')
  reset({})
  const before = JSON.stringify(ops())
  let [st, out] = await run(h)
  ck('practice: the run is fine and says practice', st === 200 && out.unread_cards_mode === 'practice', out)
  ck('practice: no card made or changed', JSON.stringify(ops()) === before && !DB.writes.includes('ops_items'), DB.writes)
  ck('practice: lists what it would make (Ann, Nia, Tess) and skips the hang-up', out.unread_cards_would === 3 && out.unread_skipped === 1 && out.unread_would_list.map((x) => x.who).sort().join() === 'Ann Talk,Nia,Tess Text', out)
  ck('practice: the card a later try fixed stays open (practice never touches Work)', item('cfu_mlater').status === 'open' && out.unread_closed === 0)

  reset({ call_unread_cards_live: true, call_tasks_live: true, call_cards_practice: true })
  ;[st, out] = await run(h)
  ck('live: three cards made', st === 200 && out.unread_cards_mode === 'live' && out.unread_cards === 3, out)
  ck('live: Ann (AI failed three times) has a card owned by the phones (Sam)', item('cfu_ma')?.owner === 's@cc.test' && item('cfu_ma')?.status === 'open', item('cfu_ma'))
  ck('live: Nia (2 min 20 sec, no transcript) has a card saying GoHighLevel never transcribed it', /never made a transcript/.test(item('cfu_mn')?.detail || ''), item('cfu_mn'))
  ck('live: Tess\'s texts have a card saying read them', /read them in GoHighLevel/.test(item('cfu_smst1')?.title || ''), item('cfu_smst1'))
  ck('live: no card for the hang-up, the one still being retried, the 9-day-old one, or a call read fine', ['cfu_mh', 'cfu_mr', 'cfu_mo', 'cfu_mok'].every((id) => !item(id)))
  ck('live: a card a person closed is never made again', item('cfu_mx').status === 'done' && ops().filter((x) => x.id === 'cfu_mx').length === 1)
  ck('live: Lou\'s call was read on a later try, so its card closed with the reason', item('cfu_mlater').status === 'done' && item('cfu_mlater').resolution_code === 'read_later' && out.unread_closed === 1, item('cfu_mlater'))
  ck('live: the card check leaves these cards alone', !DB.call_card_check.some((x) => String(x.card_id).startsWith('cfu_')), DB.call_card_check.map((x) => x.card_id))
  ck('live: only allowed fields patched; nothing sent; heartbeat fine', DB.patches.every((p) => Object.keys(p.p_patch).every((k) => PATCH_OK.includes(k))) && CALLS.every((m) => m === 'GET') && DB.beats.slice(-1)[0]?.ok === true, DB.beats.slice(-1)[0])
  const count = ops().length
  ;[st, out] = await run(h)
  ck('live: a second run makes nothing again', ops().length === count && out.unread_cards === 0, out)

  reset({ call_unread_cards_live: true, call_unread_min_seconds: 200 })
  ;[st, out] = await run(h)
  ck('setting: with 200 seconds as the shortest, Nia\'s 140-second call makes no card', !item('cfu_mn') && !!item('cfu_ma'), out)

  reset({ call_unread_cards_live: true })
  FAIL_SAVE = true
  ;[st, out] = await run(h)
  ck('save fails: no card, and the heartbeat fails so the watchdog tells the office', !item('cfu_ma') && DB.beats.slice(-1)[0]?.ok === false, [out, DB.beats.slice(-1)[0]])
} catch (e) { ck('the run did not crash', false, String(e?.stack || e)) }
finally { fs.rmSync(tmp, { recursive: true, force: true }) }
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n      ' + note : ''))
const passed = res.filter((r) => r[1]).length
console.log(`\n${passed}/${res.length} passed · ${passed === res.length ? 'ALL GREEN' : 'FAIL'}`)
process.exit(passed === res.length ? 0 : 1)
