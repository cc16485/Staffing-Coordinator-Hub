// 650 · call follow-up cards, practice. Under Node against the REAL call-tasks function and _shared/call-tasks.ts with a
// stand-in database, GoHighLevel and model: Steve's two calls of 2026-10-11 replayed; nothing written to Work; no
// transcript, phone or email kept; the request follows the current API (Sonnet 5.5, strict tool, auto choice, fallback).
//   node call_tasks_650_test.mjs
//   PGLITE=<path to @electric-sql/pglite/dist/index.js> node call_tasks_650_test.mjs   also runs the 650 SQL in a real Postgres
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const F = 'supabase/functions'
const SERVICE = 'service'.repeat(6)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE, GHL_TOKEN: 'ghl-tok', GHL_LOCATION_ID: 'loc1', ANTHROPIC_API_KEY: 'sk-test', HUB_JOB_SECRET: 'j'.repeat(40) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_ct_'))
const rewrite = (src) => src.replace(/^import \{ createClient \} from ['"]https:\/\/esm\.sh\/@supabase\/supabase-js@2['"];?$/m, 'const createClient = globalThis.__fakeCreateClient;')
  .replace(/^import Anthropic from ['"]npm:@anthropic-ai\/sdk['"];?$/m, 'const Anthropic = globalThis.__FakeAnthropic;')
fs.mkdirSync(path.join(tmp, '_shared'))
for (const f of fs.readdirSync(path.join(F, '_shared'))) fs.writeFileSync(path.join(tmp, '_shared', f), rewrite(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))

const STEVE = 'a4b036e3-587e-4b76-bdeb-27357b461a3c'
const VM = 'Speaker 1: Hi, this is Steve. I am calling to arrange a ride. Please call me back at 417 555 0467. Thank you.'
const CALL = 'Speaker 0: Caring Companions, this is Samantha.\nSpeaker 1: My license expired, I need a new one and a Real ID. I need someone to take me to the DMV and help me get in. Can Angiel fit a couple of hours this week?\nSpeaker 0: We will work it out.\nSpeaker 1: I will call you tomorrow to confirm. Email me at steve@example.com.'
let DB, AI, GH, FAILAI
function reset() {
  DB = {
    app_data: [{ key: 'ops_settings', data: { call_tasks_practice: true, call_tasks_since: '2026-10-09T00:00:00Z', call_pull_since: '2026-09-30T15:08:54Z' } },
      { key: 'ops_items', data: [{ id: 'ops_old', status: 'done', about: 'Steve Algiere', title: 'Uncovered shift: Steve Algiere' }, { id: 'ops_other', status: 'open', about: 'Iris Dorsey', title: 'Call Iris' }] }],
    call_pull_seen: [
      { message_id: 'ipoVD64wn8dUcDyPdjqW', call_at: '2026-10-11T23:36:00Z', direction: 'in', seconds: 20, caller: 'Steve A.', stage: 'done' },
      { message_id: 'gMcTDQ5WoAXMHUmrCbdN', call_at: '2026-10-11T23:37:00Z', direction: 'out', seconds: 136, caller: 'Steve A.', stage: 'done' },
      { message_id: 'oldcall0001', call_at: '2026-10-01T15:00:00Z', direction: 'in', seconds: 50, caller: 'Old C.', stage: 'done' },
      { message_id: 'notdone0001', call_at: '2026-10-11T20:00:00Z', direction: 'in', seconds: 50, caller: 'Err E.', stage: 'error' }],
    call_task_reading: [], heartbeats: [], writes: [],
  }
  AI = []; FAILAI = null
  GH = { transcripts: { ipoVD64wn8dUcDyPdjqW: VM, gMcTDQ5WoAXMHUmrCbdN: CALL }, msg: { ipoVD64wn8dUcDyPdjqW: 'c1', gMcTDQ5WoAXMHUmrCbdN: 'c1' }, contacts: { c1: { firstName: 'Steve', lastName: 'Algiere', phone: '+14175550467', email: 'steve@example.com' } }, calls: [] }
}
let rid = 0
globalThis.__fakeCreateClient = () => ({
  auth: { getUser: async () => ({ data: null, error: { message: 'no' } }) },
  rpc: async (fn, args) => {
    if (fn === 'upsert_app_data_item') { DB.heartbeats.push(args); DB.writes.push(args.target_key); return { data: null, error: null } }
    if (fn === 'call_who') return { data: String(args.p_phone).endsWith('0467') ? { match: 'one', person_id: STEVE, lead_id: null, name: 'Steve Algiere', roles: ['client'] } : { match: 'none' }, error: null }
    return { data: null, error: { message: 'unknown rpc ' + fn } }
  },
  from: (tb) => { const f = []; let single = false, ord = null, lim = null
    const p = { select() { return p }, eq(k, v) { f.push((r) => String(r[k]) === String(v)); return p }, in(k, v) { f.push((r) => v.map(String).includes(String(r[k]))); return p },
      gte(k, v) { f.push((r) => String(r[k]) >= String(v)); return p }, lt(k, v) { f.push((r) => String(r[k]) < String(v)); return p },
      order(k, o) { ord = [k, o?.ascending !== false]; return p }, limit(n) { lim = n; return p }, maybeSingle() { single = true; return p },
      insert(row) { DB.writes.push(tb); if (tb === 'call_task_reading') { if (DB.call_task_reading.some((r) => r.message_id === row.message_id && r.version === row.version)) return Promise.resolve({ error: { message: 'duplicate key' } }); DB.call_task_reading.push({ id: ++rid, ...JSON.parse(JSON.stringify(row)) }) } return Promise.resolve({ error: null }) },
      then(ok, bad) { let rows = (DB[tb] || []).filter((r) => f.every((fn) => fn(r))); if (ord) rows = rows.slice().sort((a, b) => (String(a[ord[0]]) < String(b[ord[0]]) ? -1 : 1) * (ord[1] ? 1 : -1)); if (lim) rows = rows.slice(0, lim)
        return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null }).then(ok, bad) } }
    return p },
})
const ANSWERS = {
  ipoVD64wn8dUcDyPdjqW: { call_type: 'client_or_family', is_voicemail: true, tasks: [{ title: 'Call Steve Algiere back about arranging a ride', why: 'Voicemail: Steve wants to arrange a ride and asked to be called back at 417-555-0467.', area: 'scheduling', due: '2026-10-12', add_to_card_id: '' }], resolves: [], no_task_reason: '' },
  gMcTDQ5WoAXMHUmrCbdN: (req) => ({ call_type: 'client_or_family', is_voicemail: false,
    tasks: [{ title: 'Schedule Angiel 2-3 hours with Steve this week: DMV trip for his new license', why: 'His license expired; he needs someone to go with him to the DMV. Asked for a couple of hours in Angiel\'s schedule this week; he will call Monday to confirm. Email steve@example.com.', area: 'scheduling', due: '2026-10-16', add_to_card_id: 'ops_made_up' },
      { title: 'x', why: '', area: 'nonsense', due: 'Friday', add_to_card_id: '' }],
    resolves: /message_id ipoVD64wn8dUcDyPdjqW, task_index 0/.test(req.messages[0].content) ? [{ message_id: 'ipoVD64wn8dUcDyPdjqW', task_index: 0 }, { message_id: 'bogus', task_index: 0 }] : [], no_task_reason: '' }),
}
globalThis.__FakeAnthropic = class { constructor(o) { this.key = o.apiKey; this.beta = { messages: { create: async (req) => { AI.push(req)
  if (FAILAI === 'refusal') return { stop_reason: 'refusal', stop_details: { category: 'general_harms' }, content: [] }
  if (FAILAI === 'throw') throw new Error('overloaded')
  const id = Object.keys(ANSWERS).find((k) => req.messages[0].content.includes(k === 'ipoVD64wn8dUcDyPdjqW' ? 'calling to arrange a ride' : 'license expired'))
  const a = typeof ANSWERS[id] === 'function' ? ANSWERS[id](req) : ANSWERS[id]
  return { stop_reason: 'tool_use', content: [{ type: 'text', text: '' }, { type: 'tool_use', name: 'submit_followups', input: a }] } } } } } }
globalThis.fetch = async (url) => { url = String(url); GH.calls.push(url)
  let m
  if ((m = url.match(/\/messages\/([^/]+)\/transcription$/))) return GH.transcripts[m[1]] ? new Response(JSON.stringify([{ sentenceIndex: 0, transcript: GH.transcripts[m[1]] }]), { status: 200 }) : new Response('{}', { status: 404 })
  if ((m = url.match(/\/conversations\/messages\/([^/?]+)$/))) return new Response(JSON.stringify({ message: { id: m[1], contactId: GH.msg[m[1]] } }), { status: 200 })
  if ((m = url.match(/\/contacts\/([^/?]+)$/))) return GH.contacts[m[1]] ? new Response(JSON.stringify({ contact: GH.contacts[m[1]] }), { status: 200 }) : new Response('{}', { status: 404 })
  return new Response('{}', { status: 404 }) }
async function load(fn) { fs.mkdirSync(path.join(tmp, fn), { recursive: true }); const src = rewrite(fs.readFileSync(path.join(F, fn, 'index.ts'), 'utf8'))
  if (/from ['"](https:|npm:)/.test(src)) throw new Error(fn + ' still imports from the internet'); fs.writeFileSync(path.join(tmp, fn, 'index.ts'), src); handler = null; await import(path.join(tmp, fn, 'index.ts')); return handler }
const run = async (h, auth = 'owner', body = {}) => { const H = { 'Content-Type': 'application/json' }; if (auth === 'owner') H.Authorization = 'Bearer ' + SERVICE; if (auth === 'cron') H['x-cron-secret'] = ENV.HUB_JOB_SECRET
  const r = await h(new Request('https://x.supabase.co/functions/v1/call-tasks', { method: 'POST', headers: H, body: JSON.stringify(body) })); return [r.status, await r.json().catch(() => ({}))] }

try {
  const lib = await import(path.join(tmp, '_shared', 'call-tasks.ts'))
  // ── 1. the request follows the current API ──
  const req = lib.request({ message_id: 'm1', call_at: '2026-10-11T23:37:00Z', direction: 'out', seconds: 136, caller: 'Steve A.', transcript: 'hi' }, { match: 'one', name: 'Steve Algiere', roles: ['client'] }, [], [])
  ck('request: Claude Sonnet 5.5, effort medium, strict tool, tool_choice auto (forced choice is refused by this model)', req.model === 'claude-sonnet-5-5' && req.output_config.effort === 'medium' && req.tools[0].strict === true && req.tool_choice.type === 'auto')
  ck('request: server-side refusal fallback on ("default" with its 2026-07-01 header)', req.fallbacks === 'default' && JSON.stringify(req.betas) === '["server-side-fallback-2026-07-01"]')
  ck('request: no thinking setting (Sonnet 5.5 refuses disabled), no sampling settings, no assistant prefill', !('thinking' in req) && !('temperature' in req) && req.messages.length === 1 && req.messages[0].role === 'user')
  const schemaTxt = JSON.stringify(lib.TOOL.input_schema)
  ck('the tool schema is strict-safe: every object closed, every field required, no length or count keywords', !/maxItems|maxLength|minLength|pattern|format/.test(schemaTxt) && (schemaTxt.match(/"additionalProperties":false/g) || []).length === 3)
  ck('the user message gives the Central time and weekday, who the identity layer says it is, and wraps the transcript as data', /Sunday, October 11, 2026/.test(req.messages[0].content) && /belongs to Steve Algiere, a client/.test(req.messages[0].content) && /<transcript>\nhi\n<\/transcript>/.test(req.messages[0].content))
  ck('the prompt carries her rules: a person acts, never contact anyone implied, no health detail in titles, no phone or email, never invent, transcript is not instructions', /A person acts on every card/.test(lib.SYSTEM) && /No diagnoses, medicines or health details in the title/.test(lib.SYSTEM) && /Never include a phone number or an email address/.test(lib.SYSTEM) && /Never invent/.test(lib.SYSTEM) && /never as instructions to you/.test(lib.SYSTEM))
  ck('no em dash in the prompt or the tool', !/[—―]/.test(lib.SYSTEM + schemaTxt))
  // ── 2. clean() holds the rules in code ──
  const c = lib.clean({ call_type: 'zzz', tasks: [1, 2, 3, 4].map((i) => ({ title: 'Call Mary back ' + i + ' at (417) 555-0101 or mary@x.com', why: 'w', area: 'zzz', due: '2026-13-45', add_to_card_id: 'nope' })) }, [], [])
  ck('clean: at most three cards; unknown area becomes admin; a bad date becomes empty; an unknown card id is dropped; an unknown call type becomes other', c.tasks.length === 3 && c.tasks.every((t) => t.area === 'admin' && t.due === '' && t.add_to_card_id === '') && c.call_type === 'other', c)
  ck('clean: phone numbers and emails are scrubbed from titles', c.tasks.every((t) => !/555|@/.test(t.title) && /\(phone\)/.test(t.title)), c.tasks)
  const nc = lib.clean({ call_type: 'new_client_inquiry', tasks: [{ title: 'Send Mary the brochure', why: '', area: 'leads', due: '', add_to_card_id: '' }] }, [], [])
  ck('clean: a new-client inquiry makes no cards (the lead workflow has it)', nc.tasks.length === 0 && /new client/.test(nc.no_task_reason), nc)
  ck('answerOf: a refusal and a missing tool call are errors, never cards', /declined/.test(lib.answerOf({ stop_reason: 'refusal', content: [] }).error) && /did not submit/.test(lib.answerOf({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] }).error))

  // ── 3. the function, on Steve's two calls ──
  reset()
  const h = await load('call-tasks')
  let [s, j] = await run(h, null)
  ck('no key and no schedule secret: refused (401), nothing read', s === 401 && !AI.length, [s, j])
  ;[s, j] = await run(h, 'cron')
  ck('the schedule runs it: both of Steve\'s calls read (oldest first), the error-stage and pre-start calls left alone', s === 200 && j.read === 2 && DB.call_task_reading.map((r) => r.message_id).join() === 'ipoVD64wn8dUcDyPdjqW,gMcTDQ5WoAXMHUmrCbdN', [s, j, DB.call_task_reading.map((r) => r.message_id)])
  const [vm, call] = DB.call_task_reading
  ck('the voicemail: one would-be card "Call Steve Algiere back about arranging a ride", marked voicemail, practice mode', vm.mode === 'practice' && vm.tasks.length === 1 && /Call Steve Algiere back/.test(vm.tasks[0].title) && vm.tasks[0].voicemail === true, vm)
  ck('the call: matched to Steve Algiere (client) by the identity layer, not by the AI', call.match === 'one' && call.person_id === STEVE && call.who_name === 'Steve Algiere' && JSON.stringify(call.who_roles) === '["client"]', call)
  ck('the call: one would-be card, "Schedule Angiel 2-3 hours with Steve this week: DMV trip...", due Friday Oct 16, scheduling; the junk second card dropped', call.tasks.length === 1 && /^Schedule Angiel 2-3 hours with Steve this week/.test(call.tasks[0].title) && call.tasks[0].due === '2026-10-16' && call.tasks[0].area === 'scheduling' && call.tasks[0].add_to_card_id === '', call.tasks)
  ck('the call answers the voicemail: resolves names the voicemail card (a made-up one dropped)', JSON.stringify(call.resolves) === '[{"message_id":"ipoVD64wn8dUcDyPdjqW","task_index":0}]', call.resolves)
  ck('the second reading was told about the first (earlier suggestions for this person)', /message_id ipoVD64wn8dUcDyPdjqW, task_index 0/.test(AI[1].messages[0].content))
  ck('the model was told about Steve\'s open cards only (his done card and other people\'s cards are not "open for this person")', /No open cards in Work for this person/.test(AI[1].messages[0].content), AI[1].messages[0].content.slice(0, 600))
  ck('nothing is kept that it must not keep: no transcript lines, phone number or email in any reading (the card reason is allowed)', !/Speaker \d|take me to the DMV|help me get in|417|0467|example\.com/.test(JSON.stringify(DB.call_task_reading)), JSON.stringify(DB.call_task_reading).match(/.{30}(Speaker \d|take me to the DMV|417|0467|example\.com).{30}/g))
  ck('PRACTICE: nothing is written to Work (no ops_items), only the readings and a heartbeat', !DB.writes.includes('ops_items') && DB.writes.filter((w) => w === 'call_task_reading').length === 2 && DB.writes.every((w) => ['call_task_reading', 'automation_heartbeats'].includes(w)), DB.writes)
  ck('every GoHighLevel request is a read (GET), to its message, transcript and contact endpoints', GH.calls.length === 6 && GH.calls.every((u) => /services\.leadconnectorhq\.com\/(conversations\/messages\/|conversations\/locations\/loc1\/messages\/.*\/transcription|contacts\/)/.test(u)), GH.calls)
  const ai0 = AI.length
  ;[s, j] = await run(h, 'cron')
  ck('the next run reads nothing twice', s === 200 && j.read === 0 && AI.length === ai0, [s, j])

  // ── 4. switches, failures, the owner's re-read ──
  reset(); DB.app_data[0].data.call_tasks_practice = false
  ;[s, j] = await run(h, 'cron')
  ck('practice switch off: reads nothing, says off', s === 200 && j.off === true && !AI.length && !DB.call_task_reading.length, [s, j])
  reset(); FAILAI = 'refusal'
  ;[s, j] = await run(h, 'cron')
  ck('the model declines: the reading records why, no cards, and it is not retried every 10 minutes', j.errors === 2 && DB.call_task_reading.every((r) => /declined/.test(r.error) && !r.tasks.length), DB.call_task_reading)
  reset(); FAILAI = 'throw'
  ;[s, j] = await run(h, 'cron')
  ck('the model is unreachable: recorded as an error, the run still finishes', s === 200 && j.errors === 2 && DB.call_task_reading.every((r) => /overloaded/.test(r.error)), [s, j])
  reset(); delete GH.transcripts.gMcTDQ5WoAXMHUmrCbdN
  ;[s, j] = await run(h, 'cron')
  ck('no transcript yet: that call is left for the next run (no reading row)', j.no_transcript === 1 && DB.call_task_reading.length === 1, [s, j])
  reset()
  ;[s, j] = await run(h, 'owner', { message_ids: ['gMcTDQ5WoAXMHUmrCbdN'] })
  ck('the owner can name a call to read (the replay the Desktop step uses)', s === 200 && j.read === 1 && DB.call_task_reading[0].message_id === 'gMcTDQ5WoAXMHUmrCbdN', [s, j])
  reset()
  ;[s, j] = await run(h, 'cron', { message_ids: ['oldcall0001'] })
  ck('the schedule cannot name calls (only the owner can)', DB.call_task_reading.every((r) => r.message_id !== 'oldcall0001'), DB.call_task_reading)
  // ── 5. v2: the Hub's own call-off and clock-in systems are given to the reader, and a duplicate card is dropped ──
  ck('v2: the reader version moved on, so every call is read again with the new rule', lib.VERSION === 'v2-2026-10-12')
  const OPS = [{ id: 'tk', about: 'Dixie Kuhn', status: 'done', created_by: 'timekeeper-watch', created_at: '2026-10-10T13:06:00Z', title: 'Resolved: Dixie Kuhn, LeeAnn 8am (missed clock-in)' },
    { id: 'cr', about: 'Dixie Kuhn', status: 'done', created_by: 'coverage-reply', created_at: '2026-10-10T13:09:00Z', title: 'Dixie Kuhn has a question about the Dan Probstfield callout' },
    { id: 'old', about: 'Dixie Kuhn', status: 'done', created_by: 'x', created_at: '2026-10-08T13:09:00Z', title: 'Too old' },
    { id: 'oth', about: 'Dixie Smith', status: 'open', created_by: 'x', created_at: '2026-10-10T13:00:00Z', title: 'Another Dixie' }]
  const TK = [{ caregiver: 'Dixie Kuhn', client_first: 'LeeAnn', shift_date: '2026-10-10', shift_time: '08:00', resolved_at: '2026-10-10T13:24:43Z', resolved_how: 'admin' },
    { caregiver: 'Dixie Kuhn', client_first: 'LeeAnn', shift_date: '2026-09-23', shift_time: '08:00', resolved_at: 'x', resolved_how: 'visit_gone' }]
  const COV = [{ client: 'Dan Probstfield', calling_off: '', shift_date: '2026-10-14', shift_time: '08:00-12:00', status: 'open' }, { client: 'Edward Anderson', calling_off: 'Dixie Kuhn', shift_date: '2026-10-11', shift_time: '09:00-14:00', status: 'open' }]
  const rel = lib.related('Dixie Kuhn', '2026-10-10T13:11:00Z', OPS, COV, TK)
  ck('related: the two Hub cards made minutes before the call (closed now), the missed clock-in case that day, and the call-off case she is calling off; nothing older, no other Dixie, no case for someone else',
    rel.length === 4 && rel.filter((r) => r.kind === 'card').map((r) => r.line).join('|').includes('the Hub (timekeeper-watch)') && rel.some((r) => r.kind === 'clockin_case' && /2026-10-10, resolved \(admin\)/.test(r.line))
    && rel.some((r) => r.kind === 'callout_case' && /Dixie Kuhn calling off/.test(r.line)) && !/Too old|Another Dixie|Probstfield's/.test(JSON.stringify(rel)), rel)
  ck('related: a first name alone never matches, and no name means nothing', lib.related('Dixie', '2026-10-10T13:11:00Z', OPS, COV, TK).length === 0 && lib.related('', '2026-10-10T13:11:00Z', OPS, COV, TK).length === 0)
  const um = lib.userMessage({ message_id: 'd1', call_at: '2026-10-10T13:11:00Z', direction: 'out', seconds: 90, caller: 'Dixie K.', transcript: 't' }, { match: 'one', name: 'Dixie Kuhn', roles: ['caregiver'] }, [], [], rel)
  ck('the reader is told what the Hub already has, and the prompt says call-offs, clock-ins and late caregivers are those systems\' work', /What the Hub's own systems already have for this person/.test(um) && /missed clock-in case: Dixie Kuhn at LeeAnn's 08:00 visit/.test(um)
    && /do not make a card to cover or fill the shift, find a replacement, or chase the clock-in/.test(lib.SYSTEM) && /Open a call-off case for/.test(lib.SYSTEM), um)
  const dixie = { call_type: 'caregiver', is_voicemail: false, no_task_reason: '', resolves: [], tasks: [
    { title: "Cover Dixie Kuhn's missed shift today; she called out", why: 'w', area: 'scheduling', due: '2026-10-10', add_to_card_id: '' },
    { title: 'Check office phone line after number transfer; calls not going through', why: 'w', area: 'admin', due: '2026-10-10', add_to_card_id: '' }] }
  let cd = lib.clean(dixie, [], [], rel)
  ck('clean: with the Hub\'s case listed, the "cover her shift" card is dropped (held in code) and the phone-line card stays', cd.tasks.length === 1 && /phone line/.test(cd.tasks[0].title), cd)
  cd = lib.clean({ ...dixie, tasks: [dixie.tasks[0]] }, [], [], rel)
  ck('clean: when that was the only card, the reading says the Hub\'s systems already have it', cd.tasks.length === 0 && /call-off and clock-in systems already have this/.test(cd.no_task_reason), cd)
  ck('clean: with no Hub case listed, a call-off card stays (it is the only way the call-off reaches anyone)', lib.clean(dixie, [], [], []).tasks.length === 2)
  ck('clean: "Open a call-off case for ..." is never dropped, and other cards are untouched', lib.clean({ ...dixie, tasks: [{ title: 'Open a call-off case for Dixie Kuhn, LeeAnn 8am', why: '', area: 'scheduling', due: '', add_to_card_id: '' }, { title: 'Call Steve back about a ride', why: '', area: 'scheduling', due: '', add_to_card_id: '' }] }, [], [], rel).tasks.length === 2)
  ck('the function hands the Hub\'s cards, call-off cases and clock-in cases to the reader', /relatedOf\(String\(who\.name \|\| ''\), s\.call_at, ops, byKey\.coverage_cases \|\| \[\], byKey\.timekeeper_cases \|\| \[\]\)/.test(fs.readFileSync(path.join(F, 'call-tasks/index.ts'), 'utf8'))
    && /clean\(got\.input, open, earlier, related\)/.test(fs.readFileSync(path.join(F, 'call-tasks/index.ts'), 'utf8')))
  const src = fs.readFileSync(path.join(F, 'call-tasks/index.ts'), 'utf8')
  ck('the function never sends: no POST to GoHighLevel, no Resend, no texts', !/method:\s*'POST'|resend|\/conversations\/messages'\s*,|sms/i.test(src.replace(/^\/\/.*$/gm, '')))
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }

// ── 5. the SQL in a real Postgres ──
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE)
  const db = new PGlite()
  await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; grant usage on schema auth to authenticated, anon, service_role; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table public.app_data (key text primary key, data jsonb);
create table public.call_pull_seen (message_id text primary key);
create table public.phone_index (phone text, person_id uuid);
create table public.person_identity (id uuid primary key, display_name text);
create table public.person_source_id (person_id uuid, entity_type text, needs_review boolean);
create function public.hub_office_ok() returns boolean language sql stable as $$ select auth.uid() is not null $$;
grant execute on function public.hub_office_ok() to authenticated;
insert into public.person_identity values ('${STEVE}', 'Steve Algiere'), ('00000000-0000-4000-8000-0000000000aa', 'Ann One'), ('00000000-0000-4000-8000-0000000000bb', 'Bob Two');
insert into public.phone_index values ('+14175550467', '${STEVE}'), ('+14175550999', '00000000-0000-4000-8000-0000000000aa'), ('+14175550999', '00000000-0000-4000-8000-0000000000bb');
insert into public.person_source_id values ('${STEVE}', 'client', false), ('${STEVE}', 'caregiver', true);
insert into public.app_data values ('leads', '[{"id":"L9","first_name":"Lena","last_name":"Lead","phone":"(417) 555-0123"},{"id":"L8","first_name":"Old","last_name":"Gone","phone":"4175550888","archived":true}]');`)
  const sq = fs.readFileSync('call_tasks_650.sql', 'utf8')
  await db.exec(sq); await db.exec(sq)
  ck('PGLITE: 650 installs, and installs again', true)
  const who = async (p) => (await db.query('select public.call_who($1) as w', [p])).rows[0].w
  let w = await who('+1 (417) 555-0467')
  ck('PGLITE: call_who: Steve\'s number is Steve Algiere, a client (a source still needing review is not counted)', w.match === 'one' && w.person_id === STEVE && w.name === 'Steve Algiere' && JSON.stringify(w.roles) === '["client"]', w)
  ck('PGLITE: call_who: a shared line is "several", never a guess; an unknown or short number is "none"', (await who('4175550999')).match === 'several' && (await who('4175551111')).match === 'none' && (await who('123')).match === 'none')
  w = await who('417-555-0123')
  ck('PGLITE: call_who: a lead\'s number is that lead (archived leads ignored)', w.match === 'one' && w.lead_id === 'L9' && w.name === 'Lena Lead' && JSON.stringify(w.roles) === '["lead"]' && (await who('4175550888')).match === 'none', w)
  const tryQ = async (q, setup = '') => { await db.exec('begin'); try { if (setup) await db.exec(setup); await db.exec(q); return 'ok' } catch (e) { return 'refused: ' + e.message } finally { await db.exec('rollback') } }
  await db.exec(`insert into public.call_task_reading (message_id, version, mode, match, call_type, model, tasks) values ('msg0001','v1','practice','none','other','x','[{"title":"Call Ann"}]')`)
  ck('PGLITE: readings are append-only (update, delete, truncate refused), even for the owner', (await tryQ(`update public.call_task_reading set call_type = 'x'`)).includes('append-only') && (await tryQ('delete from public.call_task_reading')).includes('append-only') && (await tryQ('truncate public.call_task_reading')).includes('append-only'))
  ck('PGLITE: one reading per call per version; at most three cards', (await tryQ(`insert into public.call_task_reading (message_id, version, mode, match, call_type, model) values ('msg0001','v1','practice','none','other','x')`)).startsWith('refused')
    && (await tryQ(`insert into public.call_task_reading (message_id, version, mode, match, call_type, model, tasks) values ('msg0002','v1','practice','none','other','x','[1,2,3,4]')`)).startsWith('refused'))
  ck('PGLITE: an office page can read; it cannot write; anon cannot read; pages cannot look up phone numbers', (await tryQ('select * from public.call_task_reading', "set local role authenticated; select set_config('test.uid', '00000000-0000-4000-8000-000000000001', true);")) === 'ok'
    && (await tryQ(`insert into public.call_task_reading (message_id, version, mode, match, call_type, model) values ('msg0003','v1','practice','none','other','x')`, 'set local role authenticated')).includes('permission denied')
    && (await tryQ('select * from public.call_task_reading', 'set local role anon')).includes('permission denied')
    && (await tryQ(`select public.call_who('4175550467')`, 'set local role authenticated')).includes('permission denied'))
  ck('PGLITE: the server can insert and read', (await tryQ(`insert into public.call_task_reading (message_id, version, mode, match, call_type, model) values ('msg0004','v1','practice','none','other','x')`, 'set local role service_role')) === 'ok')
  await db.exec(fs.readFileSync('call_tasks_650_rollback.sql', 'utf8'))
  ck('PGLITE: the rollback removes the table and the lookup', (await db.query(`select to_regclass('public.call_task_reading') is null as a, to_regprocedure('public.call_who(text)') is null as b`)).rows[0].a)
} else console.log('(PGLITE not set: the real-Postgres run of the SQL is skipped)')

const failed = res.filter((r) => !r[1])
for (const [n, ok, note] of res) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n      ' + note}`)
console.log(`\n${res.length - failed.length}/${res.length} passed${failed.length ? ' · FAIL' : ''}`)
process.exit(failed.length ? 1 : 0)
