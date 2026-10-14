// 650 v7 · call follow-up cards, practice (her eight points, 2026-10-12). Under Node against the REAL call-tasks function and _shared/call-tasks.ts with a
// stand-in database, GoHighLevel and model: Steve's two calls of 2026-10-11 replayed; nothing written to Work; no
// transcript, phone or email kept; the request follows the current API (Sonnet 5.5, strict tool, auto choice, fallback).
//   node call_tasks_650_test.mjs
//   PGLITE=<path to @electric-sql/pglite/dist/index.js> node call_tasks_650_test.mjs   also runs the 650 SQL in a real Postgres
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
  ck('request: Claude Sonnet 5.5, effort medium, strict tool, tool_choice auto, refusal fallback on', req.model === 'claude-sonnet-5-5' && req.output_config.effort === 'medium' && req.tools[0].strict === true && req.tool_choice.type === 'auto' && req.fallbacks === 'default' && JSON.stringify(req.betas) === '["server-side-fallback-2026-07-01"]')
  ck('request: no thinking or sampling setting, one user message', !('thinking' in req) && !('temperature' in req) && req.messages.length === 1)
  const schemaTxt = JSON.stringify(lib.TOOL.input_schema)
  ck('the tool schema is strict-safe: every object closed, every field required, no length or count keywords', !/maxItems|maxLength|minLength|pattern|format/.test(schemaTxt) && (schemaTxt.match(/"additionalProperties":false/g) || []).length === 5)
  ck('v7 schema: summary, understood, promises told apart, every responsibility with a decision, urgency, reason', ['summary', 'understood', 'commitments', 'items', 'decision', 'urgency', 'reason', 'caller_considering', 'awaiting_confirmation', 'already_in_workflow', 'done_on_call', 'caller_owns'].every((w) => schemaTxt.includes(w)))
  ck('v7 prompt carries her eight points', [/several unrelated responsibilities/, /Tell promises apart/, /something the caller will do/, /caller considering, not a request/, /established workflows/, /Client Journey steps/, /do not create duplicate work or a way around it/,
    /Urgency is not routine/, /not by who answered the phone/, /less to remember/, /should not fill up with cards nobody needs/].every((re) => re.test(lib.SYSTEM)), lib.SYSTEM.slice(0, 300))
  ck('v8: a change in condition is client care (urgency today); an injury or immediate danger is an incident', /a change in a client's condition such as new confusion, not eating or new symptoms: urgency today/.test(lib.SYSTEM) && /a change in condition without an injury or immediate danger is client_care/.test(lib.SYSTEM))
  ck('v9: praise goes to Kind Words, never a card (in the schema and the prompt)', JSON.stringify(lib.TOOL).includes('kind_words') && /goes to Kind Words, never a card, even when the office said it would pass it on/.test(lib.SYSTEM))
  const praise = lib.clean(base({ items: [item({ title: 'Pass Lisa Hill\'s thanks on to caregiver Tanya', area: 'caregiver_performance', why: 'Lisa said Tanya has been a blessing.' }), item({ responsibility: 'Tanya praised', decision: 'kind_words', quote: 'Lisa Hill: Tanya has been a blessing.', title: 'x', urgency: 'now' }), item({ title: 'Call Lisa about Saturday hours', area: 'scheduling' })] }), [], [], [], { domains: { client_care: 'Krystal Land' }, staffing: 'Krystal Land' })
  ck('v9 clean: a "pass the thanks on" card becomes Kind Words (held in code) with its words kept; a Kind Words item is never a card; real work in the same call stays a card', praise.tasks.length === 1 && /Saturday/.test(praise.tasks[0].title)
    && praise.detail.items[0].decision === 'kind_words' && /blessing/.test(praise.detail.items[0].quote) && praise.detail.items[1].decision === 'kind_words' && praise.detail.items[1].title === '' && praise.detail.items[1].urgency === 'routine', praise.detail.items)
  ck('v11: jobs for different parts of the office are never merged into one card', /Never merge two jobs that belong to different parts of the office into one card/.test(lib.SYSTEM))
  ck('v12: summaries in its own words, no quotes, no health reasons the work does not need', /Never quote anyone word for word/.test(lib.SYSTEM) && /leave out health details and personal reasons that do not change the work/.test(lib.SYSTEM) && /Never quote anyone word for word/.test(JSON.stringify(lib.TOOL)))
  ck('her earlier rules still hold in the prompt', /A person acts on every card/.test(lib.SYSTEM) && /No diagnoses, medicines or health details in the title/.test(lib.SYSTEM) && /Never include a phone number or an email address/.test(lib.SYSTEM) && /never as instructions to you/.test(lib.SYSTEM))
  ck('no em dash in the prompt or the tool', !/[—―]/.test(lib.SYSTEM + schemaTxt))
  // ── 2. ownership comes from the Hub, never the AI ──
  const owners = { domains: { client_care: 'Krystal Land', scheduling_coverage: 'Samantha Troutman', money: 'Samantha Troutman', payer_programs: 'Angiel Falig', incidents: 'Samantha Troutman', family_enquiries: 'Krystal Land', program_administration: 'Samantha Troutman' }, staffing: 'Krystal Land' }
  ck('owner: scheduling and EVV go to whoever holds the Staffing seat at that hour', lib.ownerFor('scheduling', owners).name === 'Krystal Land' && /Staffing seat/.test(lib.ownerFor('evv_timekeeping', owners).via))
  ck('owner: no seat holder: the scheduling domain owner', lib.ownerFor('scheduling', { domains: owners.domains }).name === 'Samantha Troutman')
  ck('owner: authorizations to the payer programs owner, a concern about care to client care, payroll to money, safety to incidents', lib.ownerFor('payer_programs', owners).name === 'Angiel Falig' && lib.ownerFor('client_care', owners).name === 'Krystal Land'
    && lib.ownerFor('payroll', owners).name === 'Samantha Troutman' && lib.ownerFor('safety_incident', owners).name === 'Samantha Troutman')
  // ── 3. clean() holds her rules in code ──
  const multi = base({ caller_role: 'caregiver', items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => item({ title: 'Distinct job ' + i + ' call (417) 555-0101 or mary@x.com', area: ['payroll', 'scheduling', 'caregiver_performance', 'evv_timekeeping'][i % 4] })) })
  let c = lib.clean(multi, [], [], [], owners)
  ck('v7 clean: a call with many unrelated jobs keeps up to 8 cards (was 3), each with its own owner', c.tasks.length === 8 && c.tasks.every((t) => t.owner && t.owner.name) && new Set(c.tasks.map((t) => t.area)).size === 4, c.tasks.map((t) => [t.area, t.owner && t.owner.name]))
  ck('clean: phone numbers and emails are scrubbed', c.tasks.every((t) => !/555|@/.test(t.title)))
  const bad = lib.clean(base({ caller_role: 'zzz', items: [item({ title: 'Call Mary', area: 'zzz', urgency: 'zzz', due: '2026-13-45', decision: 'zzz' })] }), [], [], [], owners)
  ck('clean: unknown role, area, urgency, decision and dates are made safe (a bad decision is not a card)', bad.call_type === 'other' && bad.detail.items[0].area === 'office_admin' && bad.detail.items[0].urgency === 'routine' && bad.detail.items[0].decision === 'not_needed' && bad.tasks.length === 0, bad)
  const nc = lib.clean(base({ caller_role: 'new_client_inquiry', items: [item({ title: 'Send Mary the brochure', area: 'family_enquiries' }), item({ title: 'Tell Iris her check came', area: 'payroll' })] }), [], [], [], owners)
  ck('clean: a new client inquiry goes to the lead workflow, but separate work in the same call still gets its card', nc.tasks.length === 1 && /check came/.test(nc.tasks[0].title) && nc.detail.items[0].decision === 'already_in_workflow' && /lead/.test(nc.detail.items[0].workflow), nc.detail.items)
  const keepAll = lib.clean(base({ items: [item({ title: 'Call Ann', decision: 'new_card' }), item({ responsibility: 'Change her Tuesday', decision: 'done_on_call', reason: 'Changed on the call' }), item({ responsibility: 'Caller will bring the form', decision: 'caller_owns' })] }), [], [], [], owners)
  ck('v7 clean: every responsibility is kept with its decision and reason (only new cards become cards)', keepAll.detail.items.length === 3 && keepAll.tasks.length === 1 && keepAll.detail.items[1].decision === 'done_on_call' && keepAll.detail.items[1].reason === 'Changed on the call')
  const addTo = lib.clean(base({ items: [item({ title: 'Add Saturday', decision: 'add_to_existing_card', card_id: 'ops_x' }), item({ title: 'Add Sunday', decision: 'add_to_existing_card', card_id: 'not_open' })] }), [{ id: 'ops_x', title: 'Steve hours' }], [], [], owners)
  ck('v7 clean: "add to an existing card" only for a card that is really open; otherwise it becomes a new card', addTo.detail.items[0].decision === 'add_to_existing_card' && addTo.detail.items[0].card_id === 'ops_x' && addTo.detail.items[1].decision === 'new_card' && addTo.tasks.length === 1)
  const prom = lib.clean(base({ commitments: [{ what: 'We will call Monday', kind: 'we_agreed', when: 'Monday' }, { what: 'Maybe Saturdays', kind: 'caller_considering', when: '' }, { what: 'x', kind: 'zzz', when: '' }] }), [], [], [], owners)
  ck('v7 clean: promises keep their kind (we agreed / caller considering); an unknown kind becomes awaiting confirmation', prom.detail.commitments.map((x) => x.kind).join() === 'we_agreed,caller_considering,awaiting_confirmation')
  ck('answerOf: a refusal and a missing tool call are errors, never cards', /declined/.test(lib.answerOf({ stop_reason: 'refusal', content: [] }).error) && /did not submit/.test(lib.answerOf({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] }).error))
  // ── 4. the Hub's workflows ──
  const OPS = [{ id: 'tk', about: 'Dixie Kuhn', status: 'done', created_by: 'timekeeper-watch', created_at: '2026-10-10T13:06:00Z', title: 'Resolved: Dixie Kuhn, LeeAnn 8am (missed clock-in)' }]
  const TK = [{ caregiver: 'Dixie Kuhn', client_first: 'LeeAnn', shift_date: '2026-10-10', shift_time: '08:00', opened_at: '2026-10-10T13:05:00Z', resolved_at: '2026-10-10T13:24:43Z', resolved_how: 'admin' }]
  const rel = lib.related('Dixie Kuhn', '2026-10-10T13:11:00Z', OPS, [], TK)
  const dixie = base({ caller_role: 'caregiver', items: [item({ title: "Cover Dixie Kuhn's missed shift today; she called out", urgency: 'now' }), item({ title: 'Check office phone line after number transfer', area: 'office_admin' })] })
  c = lib.clean(dixie, [], [], rel, owners)
  ck('clean: with the Hub\'s case listed, "cover her shift" becomes already in the workflow (shown with why, not a card); the phone-line card stays', c.tasks.length === 1 && /phone line/.test(c.tasks[0].title)
    && c.detail.items[0].decision === 'already_in_workflow' && /call-off or missed clock-in case/.test(c.detail.items[0].reason), c.detail.items)
  ck('clean: with no Hub case, a call-off still becomes a card (and keeps its urgency now)', lib.clean(dixie, [], [], [], owners).tasks.length === 2 && lib.clean(dixie, [], [], [], owners).tasks[0].urgency === 'now')
  const wf = lib.workflows('Steve Algiere', '2026-10-11T23:37:00Z', { lead: { first_name: 'Mary', last_name: 'Lead', status: 'Contacted', follow_up_due: '2026-10-14', follow_up_branch: 'family-decision' },
    journeys: [{ journey_id: 'j1', client_name: 'Steve Algiere', status: 'open', target_start: '2026-10-20' }], steps: [{ journey_id: 'j1', step_key: 'intake.payer', state: 'open', waiting_on: 'family' }, { journey_id: 'j1', step_key: 'done.one', state: 'complete' }],
    stepTitles: { 'intake.payer': 'Identify the payer' }, staffing: [{ client: 'Steve Algiere', status: 'searching', days: 'Mon, Wed' }], leads: [{ first_name: 'Nora', last_name: 'New', referral_source_name: 'Mercy Home Health', status: 'New', created_at: '2026-10-11T23:40:00Z' }, { first_name: 'Old', created_at: '2026-10-01T00:00:00Z' }] })
  ck('v7 workflows: the lead and its follow-up, the open Client Journey steps (by their titles), the staffing plan, and a lead created around the call (a referral)', wf.length === 4 && /lead follow-up: Mary Lead is a lead, status Contacted, follow-up due 2026-10-14/.test(wf[0].line)
    && /Client Journey for Steve Algiere .*open steps Identify the payer \(waiting on family\)/.test(wf[1].line) && !/done\.one/.test(wf[1].line) && /staffing plan for Steve Algiere: searching/.test(wf[2].line) && /referred by Mercy Home Health/.test(wf[3].line), wf)
  const um = lib.userMessage({ message_id: 'x', call_at: '2026-10-11T23:37:00Z', direction: 'out', seconds: 60, caller: 'S', transcript: 't' }, { match: 'one', name: 'Steve Algiere', roles: ['client'] }, [], [], [...rel, ...wf])
  ck('the reader is told the Hub\'s workflows before it decides', /What the Hub's own systems and workflows already have/.test(um) && /Client Journey for Steve Algiere/.test(um) && /missed clock-in case/.test(um))

  // ── 5. the function, on Steve's two calls ──
  reset()
  const h = await load('call-tasks')
  let [s, j] = await run(h, null)
  ck('no key and no schedule secret: refused (401), nothing read', s === 401 && !AI.length, [s, j])
  ;[s, j] = await run(h, 'cron')
  ck('the schedule runs it: both of Steve\'s calls read (oldest first), a call call-pull is still working on and pre-start calls left alone', s === 200 && j.read === 2 && DB.call_task_reading.map((r) => r.message_id).join() === 'ipoVD64wn8dUcDyPdjqW,gMcTDQ5WoAXMHUmrCbdN', [s, j])
  const [vm, call] = DB.call_task_reading
  ck('the voicemail: one would-be card "Call Steve Algiere back...", urgency today, owner from the Staffing seat or the scheduling owner, practice mode', vm.mode === 'practice' && vm.tasks.length === 1 && /Call Steve Algiere back/.test(vm.tasks[0].title) && vm.tasks[0].urgency === 'today' && vm.tasks[0].owner.name === 'Samantha Troutman' && vm.tasks[0].voicemail === true, vm.tasks)
  ck('the call: matched by the identity layer; the summary, what was understood and the promises are kept (we agreed vs caller will)', call.who_name === 'Steve Algiere' && /DMV/.test(call.detail.summary) && call.detail.understood.length === 2
    && call.detail.commitments.map((x) => x.kind).join() === 'caller_will,we_agreed', call.detail)
  ck('the call: one card ("Schedule Angiel ... DMV trip"), due Fri Oct 16, this week, owner and why; the "wait for Steve" item kept as the caller\'s with no card; the junk item made safe', call.tasks.length === 2 && /^Schedule Angiel 2-3 hours with Steve this week/.test(call.tasks[0].title) && call.tasks[0].due === '2026-10-16'
    && call.tasks[0].urgency === 'this_week' && call.tasks[0].owner.name && call.detail.items.length === 3 && call.detail.items[1].decision === 'caller_owns', [call.tasks, call.detail.items])
  ck('the call answers the voicemail (a made-up one dropped)', JSON.stringify(call.resolves) === '[{"message_id":"ipoVD64wn8dUcDyPdjqW","task_index":0}]', call.resolves)
  ck('nothing is kept that it must not keep: no transcript lines, phone number or email in any reading', !/Speaker \d|take me to the DMV|help me get in|417|0467|example\.com/.test(JSON.stringify(DB.call_task_reading)), JSON.stringify(DB.call_task_reading).match(/.{30}(Speaker \d|417|0467|example\.com).{30}/g))
  ck('PRACTICE: nothing is written to Work (no ops_items), only the readings and a heartbeat', !DB.writes.includes('ops_items') && DB.writes.every((w) => ['call_task_reading', 'call_promise_watch', 'automation_heartbeats'].includes(w)), DB.writes)
  ck('every GoHighLevel request is a read (GET), to its message, transcript, contact and conversation endpoints', GH.calls.length === 8 && GH.calls.every((u) => !/ (POST|PUT|PATCH|DELETE)$/.test(u) && /services\.leadconnectorhq\.com\/(conversations\/messages\/|conversations\/locations\/loc1\/messages\/.*\/transcription|contacts\/|conversations\/search)/.test(u)), GH.calls)
  const ai0 = AI.length
  ;[s, j] = await run(h, 'cron')
  ck('the next run reads nothing twice', s === 200 && j.read === 0 && AI.length === ai0, [s, j])
  // ── 6. switches, failures, retries, the owner's tools ──
  reset(); DB.app_data[0].data.call_tasks_practice = false
  ;[s, j] = await run(h, 'cron')
  ck('practice switch off: reads nothing, says off', s === 200 && j.off === true && !AI.length, [s, j])
  reset(); FAILAI = 'refusal'
  ;[s, j] = await run(h, 'cron')
  ck('the model declines: recorded once, no cards', j.errors === 2 && DB.call_task_reading.every((r) => /declined/.test(r.error) && !r.tasks.length), DB.call_task_reading)
  reset(); FAILAI = 'throw'
  ;[s, j] = await run(h, 'cron')
  ck('the model is unreachable: recorded as an error, the run still finishes', s === 200 && j.errors === 2, [s, j])
  reset(); FAILAI = 'textonce'
  ;[s, j] = await run(h, 'cron')
  ck('the model answers in text once: one retry and both calls get their reading', j.read === 2 && j.errors === 0 && AI.filter((r) => r.messages.length === 3).length === 2, [j, AI.map((r) => r.messages.length)])
  reset(); delete GH.transcripts.gMcTDQ5WoAXMHUmrCbdN; DB.call_pull_seen[1].call_at = new Date(Date.now() - 20 * 60e3).toISOString()
  ;[s, j] = await run(h, 'cron')
  ck('no transcript yet (a call 20 minutes old): that call is left for the next run', j.no_transcript === 1 && DB.call_task_reading.length === 1, [s, j])
  // ── v13: no silent failures ──
  reset(); delete GH.transcripts.gMcTDQ5WoAXMHUmrCbdN
  ;[s, j] = await run(h, 'cron')
  const nt = DB.call_task_reading.find((r) => r.message_id === 'gMcTDQ5WoAXMHUmrCbdN')
  ck('v13: a call with still no transcript after 2 hours gets a reading saying so (never quietly missing), final, no AI asked about it', nt && /no transcript for this call \(136 seconds\)\. Listen to the recording/.test(nt.error) && nt.attempt === 3 && nt.model === 'none' && j.failed === 1 && AI.length === 1, [j, nt])
  ;[s, j] = await run(h, 'cron')
  ck('v13: and it is not read again', j.read === 0, j)
  reset(); DB.call_pull_seen[3].stage = 'no_transcript'; DB.call_pull_seen[3].call_at = new Date(Date.now() - 30 * 60e3).toISOString(); DB.call_pull_seen[3].message_id = 'nott0000001'
  ;[s, j] = await run(h, 'cron')
  ck('v13: a call call-pull marked "no transcript" gets its reading too', DB.call_task_reading.some((r) => r.message_id === 'nott0000001' && /no transcript/.test(r.error)), DB.call_task_reading.map((r) => [r.message_id, r.error]))
  reset(); DB.call_pull_seen[3].stage = 'error'; DB.call_pull_seen[3].message_id = 'gMcTDQ5WoAXMHUmrCbdN'; DB.call_pull_seen.splice(1, 1)
  ;[s, j] = await run(h, 'cron')
  ck('v13: a call the lead reader failed on (call-pull "error") is still read for follow-up work', DB.call_task_reading.some((r) => r.message_id === 'gMcTDQ5WoAXMHUmrCbdN' && !r.error && r.tasks.length), DB.call_task_reading.map((r) => [r.message_id, r.error]))
  reset(); FAILAI = 'throw'
  ;[s, j] = await run(h, 'cron')
  ck('v13: a reading that fails is kept as try 1, and the run does not fail (heartbeat healthy)', DB.call_task_reading.length === 2 && DB.call_task_reading.every((r) => r.attempt === 1 && /overloaded/.test(r.error)) && j.could_not_read === 2 && j.failed === 0 && DB.heartbeats.at(-1).item.ok === true, [j, DB.heartbeats.at(-1)])
  ;[s, j] = await run(h, 'cron')
  ck('v13: it is not tried again within 30 minutes', j.read === 0, j)
  FAILAI = null; for (const r of DB.call_task_reading) r.read_at = new Date(Date.now() - 31 * 60e3).toISOString()
  ;[s, j] = await run(h, 'cron')
  ck('v13: 30 minutes later it is tried again (try 2), works, and every try is kept', j.read === 2 && DB.call_task_reading.length === 4 && DB.call_task_reading.filter((r) => r.attempt === 2 && !r.error).length === 2, DB.call_task_reading.map((r) => [r.message_id, r.attempt, r.error]))
  ;[s, j] = await run(h, 'cron')
  ck('v13: once one try worked, it is never read again', j.read === 0, j)
  reset(); FAILAI = 'throw'
  for (let k = 0; k < 4; k++) { ;[s, j] = await run(h, 'cron'); for (const r of DB.call_task_reading) r.read_at = new Date(Date.now() - 31 * 60e3).toISOString() }
  ck('v13: after 3 failed tries it stops (counted as failed, shown on the Practice tab), never a 4th', DB.call_task_reading.length === 6 && Math.max(...DB.call_task_reading.map((r) => r.attempt)) === 3, DB.call_task_reading.map((r) => [r.message_id, r.attempt]))
  reset(); globalThis.__SAVEFAIL = 'call_task_reading'
  ;[s, j] = await run(h, 'cron')
  globalThis.__SAVEFAIL = null
  ck('v13: when a reading cannot be saved, the heartbeat fails, so the watchdog tells the office', DB.heartbeats.at(-1).item.ok === false && j.save_failed === 2, [j, DB.heartbeats.at(-1)])
  reset()
  ;[s, j] = await run(h, 'owner', { message_ids: ['gMcTDQ5WoAXMHUmrCbdN'] })
  ck('the owner can name a call to read again', s === 200 && j.read === 1, [s, j])
  // ── v13: the promise watch ──
  ck('v13 dueFor: a promise the office made with no time said is due the next business day (a Sunday call: Monday; a Friday call: Monday)', lib.dueFor({ kind: 'we_agreed', when: '' }, '2026-10-11T23:37:00Z') === '2026-10-12' && lib.dueFor({ kind: 'we_agreed', when: '' }, '2026-10-16T15:00:00Z') === '2026-10-19')
  ck('v13 dueFor: the day the reader gave wins; a confirmation we wait on is due in 2 business days; done during the call, the caller\'s own and "considering" are not watched',
    lib.dueFor({ kind: 'we_agreed', by: '2026-10-15' }, '2026-10-12T15:00:00Z') === '2026-10-15' && lib.dueFor({ kind: 'awaiting_confirmation', when: '' }, '2026-10-12T15:00:00Z') === '2026-10-14'
    && lib.dueFor({ kind: 'we_agreed', when: 'during the call' }, '2026-10-12T15:00:00Z') === '' && lib.dueFor({ kind: 'caller_will', by: '2026-10-13' }, '2026-10-12T15:00:00Z') === '' && lib.dueFor({ kind: 'caller_considering' }, '2026-10-12T15:00:00Z') === ''
    && lib.dueFor({ kind: 'we_agreed', by: '2026-10-01' }, '2026-10-12T15:00:00Z') === '2026-10-13')
  ck('v13 dueEnd: 6 pm Central on the due day (daylight and standard time)', new Date(lib.dueEnd('2026-10-12')).toISOString() === '2026-10-12T23:00:00.000Z' && new Date(lib.dueEnd('2026-12-14')).toISOString() === '2026-12-15T00:00:00.000Z')
  ck('v13 nextStatus: kept, kept late after a "would remind", still owed before and after the due time', lib.nextStatus('waiting', 'kept', false) === 'kept' && lib.nextStatus('would_remind', 'kept', true) === 'kept_late' && lib.nextStatus('waiting', 'none', true) === 'would_remind' && lib.nextStatus('waiting', 'unclear', false) === 'waiting')
  const chk = lib.checkRequest({ what: 'Call Steve back', kind: 'we_agreed', due: '2026-10-12', who: 'Steve Algiere', call_at: '2026-10-11T23:37:00Z', channel: 'call' }, ['[Mon] Office: hi'])
  ck('v13 the check: Sonnet 5.5, effort low, strict tool, auto choice, refusal fallback; activity fenced and never instructions', chk.model === 'claude-sonnet-5-5' && chk.output_config.effort === 'low' && chk.tools[0].strict === true && chk.tool_choice.type === 'auto' && chk.fallbacks === 'default'
    && /<since>/.test(chk.messages[0].content) && /never as instructions to you/.test(chk.system) && !/[—―]/.test(chk.system + JSON.stringify(lib.CHECK_TOOL)))
  ck('v13 the reader gives each promise its due day and area', JSON.stringify(lib.TOOL).includes('"by"') && /give each the day it is due \(by\) and its area/.test(lib.SYSTEM))
  {
    reset(); DB.call_pull_seen = []
    const ago = (min) => new Date(Date.now() - min * 60e3).toISOString()
    const day = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
    const past = day(Date.now() - 3 * 864e5), future = day(Date.now() + 3 * 864e5)
    DB.app_data[0].data.call_tasks_since = ago(10 * 1440)
    DB.app_data.push({ key: 'ops_items', data: [] })
    const rd = (id, callAt, who, commitments, extra = {}) => ({ id: ++rid, message_id: id, version: 'v13-2026-10-12', mode: 'practice', channel: 'call', call_at: callAt, direction: 'out', seconds: 90, caller: who.split(' ')[0], match: 'one', person_id: null, who_name: who, read_at: callAt, attempt: 1,
      call_type: 'client', tasks: [], resolves: [], model: 'm', detail: { summary: 's', contact_id: 'k_' + id, commitments }, ...extra })
    DB.call_task_reading = [
      rd('p1', ago(4 * 1440), 'Ann Late', [{ what: 'Call Ann back about Tuesday', kind: 'we_agreed', when: '', by: past, area: 'scheduling' }, { what: 'Ann may add Saturdays', kind: 'caller_considering', when: '', by: '', area: 'scheduling' }]),
      rd('p2', ago(60), 'Bea Kept', [{ what: 'Text Bea the new schedule', kind: 'we_agreed', when: 'tomorrow', by: future, area: 'client_care' }]),
      rd('p3', ago(4 * 1440), 'Cal Owed', [{ what: 'Hear back from Cal\'s daughter about Thursdays', kind: 'awaiting_confirmation', when: '', by: past, area: 'family_enquiries' }]),
      rd('p4', ago(4 * 1440), 'Dee Done', [{ what: 'Changed her end time', kind: 'we_agreed', when: 'during the call', by: '', area: 'scheduling' }]),
      rd('p5', ago(4 * 1440), 'Eve Gone', [{ what: 'Call Eve', kind: 'we_agreed', when: '', by: past, area: 'scheduling' }]),
      { ...rd('p6', ago(30), 'Fay Error', [{ what: 'x', kind: 'we_agreed', when: '', by: future, area: 'scheduling' }]), error: 'overloaded' }]
    TEXTS = [{ id: 'cvB', contactId: 'k_p2', phone: '', name: 'Bea Kept', msgs: [{ id: 'b1', direction: 'outbound', type: 1, messageType: 'TYPE_SMS', body: 'Hi Bea! Your new schedule: Mon and Wed 9 to 1. Call 417-555-0100 with questions.', dateAdded: ago(20) }] },
      { id: 'cvC', contactId: 'k_p3', phone: '', name: 'Cal Owed', msgs: [{ id: 'c1', direction: 'outbound', type: 1, messageType: 'TYPE_SMS', body: 'Reminder: your visit is tomorrow at 9.', source: 'workflow', dateAdded: ago(2000) }] }]
    const asked = []
    globalThis.__CHECK = (req) => { asked.push(req.messages[0].content); return /Bea/.test(req.messages[0].content) ? { status: 'kept', why: 'The office texted Bea her new schedule.', evidence: ['Office text: new schedule sent, call 417-555-0100'] } : { status: 'not_yet', why: 'Only an automatic reminder since.', evidence: [] } }
    const h2 = h
    ;[s, j] = await run(h2, 'cron')
    const W = (id) => DB.call_promise_watch.filter((w) => w.message_id === id)
    ck('v13 watch: every promise the office made gets a row with its due day and owner from the Hub; "considering", finished-on-the-call and failed readings get none',
      W('p1').length === 1 && W('p1')[0].due === past && W('p1')[0].owner.name && W('p2').length === 1 && W('p4').length === 0 && W('p6').length === 0 && W('p2')[0].owner.name === 'Krystal Land', DB.call_promise_watch.map((w) => [w.message_id, w.idx, w.due, w.status, w.owner]))
    ck('v13 watch: past due with nothing since: would remind (no AI needed), saying why', W('p1')[0].status === 'would_remind' && /Nothing with them since the promise/.test(W('p1')[0].why) && !asked.some((a) => /Ann/.test(a)), W('p1')[0])
    ck('v13 watch: the office texted after the promise: the check says kept (before it was even due), with evidence and no phone number kept', W('p2')[0].status === 'kept' && W('p2')[0].evidence.length === 1 && !/417|555/.test(JSON.stringify(DB.call_promise_watch)), W('p2')[0])
    ck('v13 watch: only an automatic reminder since: the check is told it was automatic, and it stays owed (would remind)', W('p3')[0].status === 'would_remind' && asked.some((a) => /Office \(automatic\): Reminder/.test(a)), [W('p3')[0], asked])
    ck('v13 watch: every status change is in the history; the run counts what it found', W('p1')[0].history.at(-1).status === 'would_remind' && W('p2')[0].history.map((x) => x.status).join() === 'waiting,kept' && j.promises >= 3 && j.promises_kept === 1 && j.would_remind === 3, [j, W('p2')[0].history])
    const n0 = asked.length, c0 = W('p3')[0].checks
    ck('v13 watch: Eve\'s promise is watched', W('p5').length === 1 && W('p5')[0].status === 'would_remind', W('p5'))
    DB.call_task_reading.push({ ...rd('p5', ago(4 * 1440), 'Eve Gone', []), version: 'v14-x', read_at: ago(1) })
    ;[s, j] = await run(h2, 'cron')
    ck('v13 watch: a newer reading without the promise drops it, with the change in its history', W('p5')[0].status === 'dropped' && /no longer has this promise/.test(W('p5')[0].history.at(-1).why), W('p5'))
    ck('v13 watch: checked at most hourly; nothing new, no new AI question', asked.length === n0 && W('p3')[0].checks === c0, [asked.length, W('p3')[0].checks])
    W('p3')[0].checked_at = ago(61)
    TEXTS[1].msgs.push({ id: 'c2', direction: 'inbound', type: 1, messageType: 'TYPE_SMS', body: 'Thursdays are fine', dateAdded: ago(10) })
    globalThis.__CHECK = () => ({ status: 'kept', why: 'The daughter confirmed Thursdays.', evidence: ['Their text: Thursdays fine'] })
    ;[s, j] = await run(h2, 'cron')
    ck('v13 watch: an answer after it was due: kept late', W('p3')[0].status === 'kept_late' && W('p3')[0].history.map((x) => x.status).join() === 'waiting,would_remind,kept_late', W('p3')[0])
    ck('v13 watch: practice only: nothing written to Work, nothing sent', !DB.writes.includes('ops_items') && GH.calls.every((u) => !/ (POST|PUT|PATCH|DELETE)$/.test(u)), DB.writes)
    W('p1')[0].checked_at = ago(61); globalThis.__SAVEFAIL = 'call_promise_watch'
    ;[s, j] = await run(h2, 'cron')
    globalThis.__SAVEFAIL = null
    ck('v13 watch: if the watch cannot save, the heartbeat fails (the watchdog tells the office)', DB.heartbeats.at(-1).item.ok === false, DB.heartbeats.at(-1))
    globalThis.__CHECK = null
  }
  // ── v10: GoHighLevel texts, and prepared steps with the visit from AxisCare ──
  const DIXIE = '11111111-0000-4000-8000-00000000d1x1'.replace('x', '0')
  reset(); DB.call_pull_seen = []
  const ago = (min) => new Date(Date.now() - min * 60e3).toISOString()
  const tmw = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 864e5))
  DB.app_data[0].data.call_tasks_since = ago(600)
  TEXTS = [
    { id: 'cvD', contactId: 'cD', phone: '+14175550990', name: 'Dixie Kuhn', msgs: [
      { id: 'm0', direction: 'outbound', type: 1, messageType: 'TYPE_SMS', body: 'Hi Dixie, thank you for covering.', dateAdded: ago(300) },
      { id: 'm1', direction: 'inbound', type: 1, messageType: 'TYPE_SMS', body: 'Can I move my shift tomorrow with LeeAnn to 7-11am? Call me at 417-555-0990', dateAdded: ago(40) },
      { id: 'm2', direction: 'inbound', type: 1, messageType: 'TYPE_SMS', body: 'If not thats ok', dateAdded: ago(38) }] },
    { id: 'cvA', contactId: 'cA', phone: '+14175550991', name: 'Amy Ack', msgs: [{ id: 'a1', direction: 'inbound', type: 1, messageType: 'TYPE_SMS', body: 'Ok thanks!', dateAdded: ago(30) }] },
    { id: 'cvT', contactId: 'cT', phone: '+14175550992', name: 'Tom Typing', msgs: [{ id: 't1', direction: 'inbound', type: 1, messageType: 'TYPE_SMS', body: 'Hey I need to ask about', dateAdded: ago(3) }] }]
  globalThis.__WHO = (ph) => ph.endsWith('0990') ? { match: 'one', person_id: DIXIE, name: 'Dixie Kuhn', roles: ['caregiver'] } : null
  DB.person_source_id = [{ person_id: DIXIE, system: 'axiscare', entity_type: 'caregiver', source_id: '777', needs_review: false }]
  AXV = { 'caregiverIds=777': [{ id: 9001, client: { id: 55, firstName: 'LeeAnn', lastName: 'Walker' }, caregiver: { id: 777, firstName: 'Dixie', lastName: 'Kuhn' }, scheduledStartDate: tmw + 'T08:00:00', scheduledEndDate: tmw + 'T12:00:00' }],
    'clientIds=55': [{ id: 9001, client: { id: 55 }, caregiver: { id: 777, firstName: 'Dixie', lastName: 'Kuhn' }, scheduledStartDate: tmw + 'T08:00:00' }, { id: 9002, client: { id: 55 }, caregiver: { id: 778, firstName: 'Tanya', lastName: 'Brooks' }, scheduledStartDate: tmw + 'T13:00:00' }] }
  globalThis.__EVAL_ANSWER = (r) => base({ caller_role: 'caregiver', summary: 'Dixie asks to move tomorrow with LeeAnn to 7-11.', items: [item({ title: "Move Dixie's visit with LeeAnn tomorrow to 7-11", area: 'scheduling', urgency: 'today',
    actions: [{ kind: 'axiscare_visit_change', step: 1, to: 'AxisCare', draft: '', date: tmw, start: '07:00', end: '11:00', client_name: 'LeeAnn', waits_for_yes: false },
      { kind: 'text_caregiver', step: 2, to: 'Dixie Kuhn', draft: 'All set, tomorrow with LeeAnn is 7-11. Call 417-555-0101 with questions.', date: '', start: '', end: '', client_name: '', waits_for_yes: false },
      { kind: 'text_client_caregivers', step: 3, to: "LeeAnn's caregivers", draft: 'FYI LeeAnn tomorrow is 7-11.', date: '', start: '', end: '', client_name: 'LeeAnn', waits_for_yes: false }] })] })
  const h10 = h
  ;[s, j] = await run(h10, 'cron')
  const tx = DB.call_task_reading.filter((r) => r.channel === 'text')
  ck('v10 texts: Dixie\'s burst is read (after 10 quiet minutes), "Ok thanks!" needs no reading, and someone still typing is left for later', s === 200 && j.texts_read === 2 && j.text_skipped === 1 && tx.length === 2
    && tx.some((r) => r.message_id === 'sms:m2' && r.who_name === 'Dixie Kuhn') && tx.some((r) => r.message_id === 'sms:a1' && r.model === 'none' && /acknowledgement/.test(r.no_task_reason)) && !tx.some((r) => r.message_id === 'sms:t1'), [j, tx.map((r) => r.message_id)])
  const tAI = AI.find((r) => /Text conversation/.test(r.messages[0].content))
  ck('v10 texts: the reader gets the thread oldest first, Them and Office, as a conversation (not a call)', tAI && /<conversation>/.test(tAI.messages[0].content) && /Office: Hi Dixie, thank you for covering\./.test(tAI.messages[0].content) && /Them: Can I move my shift tomorrow with LeeAnn to 7-11am\?/.test(tAI.messages[0].content), tAI && tAI.messages[0].content.slice(0, 700))
  const dx = tx.find((r) => r.message_id === 'sms:m2'), acts = dx.tasks[0].actions
  ck('v10 her rule, held in code: a caregiver\'s visit change starts by asking LeeAnn or her family, and the change and the texts wait for their yes', acts.map((a) => a.kind).join() === 'ask_client_family_permission,axiscare_visit_change,text_caregiver,text_client_caregivers'
    && acts[0].waits_for_yes === false && acts.slice(1).every((a) => a.waits_for_yes) && /LeeAnn/.test(acts[0].to), acts)
  ck('v10: the Hub finds the real visit in AxisCare (Dixie with LeeAnn Walker tomorrow 08:00-12:00) and shows the change to 07:00-11:00', acts[1].resolved && acts[1].resolved.found === true && acts[1].resolved.visit.client === 'LeeAnn Walker' && acts[1].resolved.visit.start === '08:00' && acts[1].resolved.after.start === '07:00' && acts[1].resolved.after.end === '11:00', acts[1])
  ck('v10: "text LeeAnn\'s caregivers" lists the caregivers on her schedule from AxisCare', JSON.stringify(acts[3].resolved && acts[3].resolved.caregivers) === '["Dixie Kuhn","Tanya Brooks"]', acts[3])
  ck('v10: no text body, phone number or email is kept; drafts are scrubbed', !/Can I move my shift|If not thats ok|417-555|0990|0101/.test(JSON.stringify(tx)), JSON.stringify(tx).match(/.{30}(417-555|0990|0101|Can I move).{30}/g))
  ck('v10: AxisCare is only read; GoHighLevel only read; nothing written to Work', GH.calls.filter((u) => u.includes('axiscare.com')).every((u) => /\/api\/visits\?/.test(u) && !/ (POST|PATCH|PUT)$/.test(u)) && GH.calls.every((u) => !/ (POST|PUT|PATCH|DELETE)$/.test(u)) && !DB.writes.includes('ops_items'), GH.calls)
  const rr2 = AI.length; [s, j] = await run(h10, 'cron')
  ck('v10: the next run reads no text twice', j.texts_read === 0 && AI.length === rr2, j)
  globalThis.__WHO = null; globalThis.__EVAL_ANSWER = null
  const fam = lib.cleanActions([{ kind: 'axiscare_visit_change', step: 1, date: '2026-10-14', start: '09:00', end: '13:00', client_name: 'Margaret', to: '', draft: '', waits_for_yes: false }], 'family')
  ck('v10: when the client or family asked for the change themselves, no permission step is added', fam.length === 1 && fam[0].kind === 'axiscare_visit_change' && fam[0].waits_for_yes === false, fam)
  ck('v10: steps are limited to five, kinds and times made safe', lib.cleanActions(Array.from({ length: 8 }, () => ({ kind: 'zzz', start: '25:99' })), 'client').length === 5 && lib.cleanActions([{ kind: 'zzz', start: '25:99' }], 'client')[0].kind === 'call_back' && lib.cleanActions([{ kind: 'zzz', start: '25:99' }], 'client')[0].start === '')
  ck('v10: a short acknowledgement or opt-out word is recognized; a real request is not', ['ok', 'Ok thanks!', 'yes', 'STOP', '👍'].every((x) => lib.ACK.test(x)) && !lib.ACK.test('ok can I switch Friday to Saturday?'))
  // the test bench
  reset(); globalThis.__EVAL_ANSWER = (r) => base({ caller_role: 'family', summary: 'eval', items: [item({ title: 'Add Saturday hours for Mrs Example', area: 'scheduling', urgency: 'this_week' })] })
  ;[s, j] = await run(h, 'owner', { eval: [{ id: 'e1', call_at: '2026-10-13T15:00:00Z', direction: 'in', seconds: 90, caller: 'Daughter', who: { match: 'none' }, transcript: 'we would like Saturdays', context: { leads: [] } }] })
  ck('the test bench (owner): a made-up call is read and answered; nothing is stored or read from GoHighLevel', s === 200 && j.results.length === 1 && j.results[0].reading.tasks[0].title === 'Add Saturday hours for Mrs Example' && j.results[0].reading.tasks[0].owner.name
    && !DB.call_task_reading.length && !GH.calls.length && !DB.writes.length, [s, j, DB.writes])
  ;[s, j] = await run(h, 'cron', { eval: [{ id: 'e1', call_at: '2026-10-13T15:00:00Z', transcript: 'x' }] })
  ck('the test bench is the owner\'s only (the schedule is refused)', s === 403, [s, j])
  globalThis.__EVAL_ANSWER = null
  const src = fs.readFileSync(path.join(F, 'call-tasks/index.ts'), 'utf8')
  ck('the function never sends: no POST to GoHighLevel, no Resend, no texts', !/method:\s*'(POST|PUT|PATCH|DELETE)'|resend|\/messages\/send/i.test(src.replace(/^\/\/.*$/gm, '')))
  ck('owners come from the Hub (domains, the Staffing seat), handed to clean(); the AI is never asked for a person', /staffingAt\(hub, s\.call_at\)/.test(src) && /from\('domains'\)/.test(src) && !/owner_name|assign to/i.test(JSON.stringify(lib.TOOL)))

  // ── LIVE CARDS (2026-10-13, her "Let's stop practicing and go for it!") ──
  const agoL = (m) => new Date(Date.now() - m * 60e3).toISOString()
  const liveReset = () => { reset(); Object.assign(DB.app_data[0].data, { call_tasks_practice: false, call_tasks_live: true, call_tasks_since: agoL(600), call_tasks_live_since: agoL(300) })
    DB.call_pull_seen[0].call_at = agoL(120); DB.call_pull_seen[1].call_at = agoL(119) }
  liveReset()
  ;[s, j] = await run(h, 'cron')
  const opsL = () => DB.app_data.find((r) => r.key === 'ops_items').data
  const cfL = () => opsL().filter((x) => x.kind === 'call_followup')
  const vmId = lib.cardIdFor('ipoVD64wn8dUcDyPdjqW', 0), dmvId = lib.cardIdFor('gMcTDQ5WoAXMHUmrCbdN', 0)
  ck('LIVE: practice off and live on still reads; readings are marked live', s === 200 && j.read === 2 && DB.call_task_reading.every((r) => r.mode === 'live'), [s, j])
  ck('LIVE: each follow-up becomes a Work card (kind call_followup) with the call\'s id, so it is made once', cfL().length === 3 && cfL().some((x) => x.id === vmId) && cfL().some((x) => x.id === dmvId) && j.live_cards === 3, [j, cfL().map((x) => x.id)])
  const dmvC = cfL().find((x) => x.id === dmvId)
  ck('LIVE: the card says who, what, why, when, and is owned by the Hub\'s owner for the area (sign-in email), open, Scheduling and coverage', dmvC.status === 'open' && dmvC.about === 'Steve Algiere' && /DMV/.test(dmvC.title) && /license expired/.test(dmvC.detail)
    && dmvC.owner === 'samantha@cc.test' && dmvC.owner_name === 'Samantha Troutman' && dmvC.domain === 'scheduling_coverage' && dmvC.urgency === 'normal' && Date.parse(dmvC.due) > Date.now() && dmvC.created_by === 'call-tasks'
    && dmvC.source.message_id === 'gMcTDQ5WoAXMHUmrCbdN' && dmvC.history.length === 1 && /Made from a call with Steve Algiere/.test(dmvC.history[0].text), dmvC)
  ck('LIVE: no phone number or email reaches a card', !/417|0467|example\.com|@example/.test(JSON.stringify(cfL())), JSON.stringify(cfL()).slice(0, 600))
  const vmcL = cfL().find((x) => x.id === vmId)
  ck('LIVE: the voicemail\'s callback card is closed because the later call took care of it, with a note', vmcL.status === 'done' && vmcL.closed_by === 'call-tasks' && /later call/.test(vmcL.close_reason) && j.live_closed === 1, vmcL)
  const n0L = cfL().length, w0L = DB.writes.filter((w) => w === 'ops_items').length
  ;[s, j] = await run(h, 'cron')
  ck('LIVE: the next run makes no second card and writes nothing to Work', cfL().length === n0L && DB.writes.filter((w) => w === 'ops_items').length === w0L && j.live_cards === 0, j)
  opsL().find((x) => x.id === dmvId).status = 'done'
  opsL().splice(opsL().findIndex((x) => x.id === lib.cardIdFor('gMcTDQ5WoAXMHUmrCbdN', 1)), 1, { ...opsL().find((x) => x.id === lib.cardIdFor('gMcTDQ5WoAXMHUmrCbdN', 1)), status: 'dismissed' })
  ;[s, j] = await run(h, 'cron')
  ck('LIVE: a card a person closed never comes back', opsL().find((x) => x.id === dmvId).status === 'done' && j.live_cards === 0, j)
  // add to an open card, once; a reading from before the switch makes nothing; an unknown owner leaves the card unassigned
  liveReset(); DB.call_pull_seen.length = 0
  const rdL = (o) => Object.assign({ version: lib.VERSION, mode: 'live', channel: 'call', direction: 'in', seconds: 60, caller: 'Iris D.', who_name: 'Iris Dorsey', person_id: 'pi', lead_id: null, tasks: [], resolves: [], detail: { items: [] }, error: null, read_at: agoL(1), attempt: 1 }, o)
  DB.call_task_reading.push(rdL({ message_id: 'addto1', call_at: agoL(30), detail: { items: [{ decision: 'add_to_existing_card', card_id: 'ops_other', why: 'She also wants Friday mornings.' }] } }),
    rdL({ message_id: 'old1', call_at: agoL(400), tasks: [{ title: 'Old work', why: 'w', area: 'client_care', due: '', urgency: 'today', owner: { name: 'Krystal Land', via: 'owns client care' } }] }),
    rdL({ message_id: 'sms:t1', channel: 'text', call_at: agoL(20), tasks: [{ title: 'Send Iris the form', why: 'She asked by text.', area: 'office_admin', due: '', urgency: 'now', owner: { name: 'Nobody Known', via: 'x' } }] }),
    rdL({ message_id: 'bad1', call_at: agoL(10), error: 'declined', tasks: [{ title: 'Should not exist', why: 'w', area: 'client_care', owner: { name: 'Krystal Land' } }] }))
  ;[s, j] = await run(h, 'cron')
  const otherL = opsL().find((x) => x.id === 'ops_other')
  ck('LIVE: the reader\'s "add to this open card" goes on that card\'s history', (otherL.history || []).length === 1 && /Friday mornings/.test(otherL.history[0].text) && j.live_added === 1, [otherL, j])
  ck('LIVE: a call from before the switch went on makes no card; a reading that failed makes no card', !opsL().some((x) => /Old work|Should not exist/.test(x.title || '')), opsL())
  const txc = opsL().find((x) => x.id === lib.cardIdFor('sms:t1', 0))
  ck('LIVE: texts make cards too; an owner the Hub cannot find leaves it unassigned (Work offers Take it); now is urgent', txc && txc.owner === '' && txc.urgency === 'urgent' && /Made from texts with Iris Dorsey/.test(txc.history[0].text) && j.live_unassigned === 1, [txc, j])
  ;[s, j] = await run(h, 'cron')
  ck('LIVE: the same addition is never added twice', opsL().find((x) => x.id === 'ops_other').history.length === 1 && j.live_added === 0, j)
  liveReset(); globalThis.__SAVEFAIL = 'ops_items'
  ;[s, j] = await run(h, 'cron')
  globalThis.__SAVEFAIL = null
  ck('LIVE: a card that could not be saved fails the heartbeat (the watchdog tells the office), never quietly', j.live_errors > 0 && DB.heartbeats.some((x) => x.item && x.item.id === 'hb_call-tasks' && x.item.ok === false), j)
  liveReset(); DB.app_data[0].data.call_tasks_live = false; DB.app_data[0].data.call_tasks_practice = true
  ;[s, j] = await run(h, 'cron')
  ck('LIVE switch off: practice as before, nothing written to Work', !DB.writes.includes('ops_items') && !('live_cards' in j) && DB.call_task_reading.every((r) => r.mode === 'practice'), j)
  ck('LIVE helpers: urgency and due words', lib.urgencyFor('now') === 'urgent' && lib.urgencyFor('today') === 'today' && lib.urgencyFor('routine') === 'normal' && lib.domainFor('evv_timekeeping') === 'scheduling_coverage' && lib.domainFor('payroll') === 'money'
    && Math.abs(Date.parse(lib.liveDue({ urgency: 'now' })) - Date.now() - 3600e3) < 5000 && lib.stepLines([{ kind: 'text_family_update', to: 'Barbara', draft: 'Hi Barbara', waits_for_yes: false }])[0] === 'Text the family an update (Barbara): "Hi Barbara"')

  // ── WHICH OFFICE LINE (2026-10-13) ──
  ck('LINE: the office end is "to" on an inbound message and "from" on an outbound one, written (417) 234-8494', lib.lineOf({ direction: 'inbound', from: '+14175550467', to: '+14172348494' }, '+14175550467') === '(417) 234-8494'
    && lib.lineOf({ direction: 'outbound', from: '+14178156423', to: '+14175550467' }) === '(417) 815-6423' && lib.lineOf({ direction: 'inbound', meta: { call: { to: '4172348494' } } }) === '(417) 234-8494')
  ck('LINE: never the caller\'s own number; nothing said is an empty line', lib.lineOf({ direction: 'inbound', to: '+14175550467' }, '+1 (417) 555-0467') === '' && lib.lineOf({}) === '' && lib.lineOf(null) === '')
  liveReset(); DB.app_data[0].data.call_tasks_live = false; DB.app_data[0].data.call_tasks_practice = true
  ;[s, j] = await run(h, 'cron')
  ck('LINE: every reading keeps a line field in its detail (no new column)', DB.call_task_reading.length === 2 && DB.call_task_reading.every((r) => 'line' in (r.detail || {}) && !('line' in r)), DB.call_task_reading.map((r) => r.detail))
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
  const sq = fs.readFileSync('call_tasks_650.sql', 'utf8'), sq7 = fs.readFileSync('call_tasks_650_v7.sql', 'utf8')
  const sq10 = fs.readFileSync('call_tasks_650_v10.sql', 'utf8'), sq13 = fs.readFileSync('call_tasks_650_v13.sql', 'utf8')
  await db.exec(sq); await db.exec(sq); await db.exec(sq7); await db.exec(sq7); await db.exec(sq10); await db.exec(sq13); await db.exec(sq13)
  ck('PGLITE: 650, v7, v10 and v13 install, and install again', true)
  const who = async (p) => (await db.query('select public.call_who($1) as w', [p])).rows[0].w
  let w = await who('+1 (417) 555-0467')
  ck('PGLITE: call_who: Steve\'s number is Steve Algiere, a client (a source still needing review is not counted)', w.match === 'one' && w.person_id === STEVE && w.name === 'Steve Algiere' && JSON.stringify(w.roles) === '["client"]', w)
  ck('PGLITE: call_who: a shared line is "several", never a guess; an unknown or short number is "none"', (await who('4175550999')).match === 'several' && (await who('4175551111')).match === 'none' && (await who('123')).match === 'none')
  w = await who('417-555-0123')
  ck('PGLITE: call_who: a lead\'s number is that lead (archived leads ignored)', w.match === 'one' && w.lead_id === 'L9' && w.name === 'Lena Lead' && JSON.stringify(w.roles) === '["lead"]' && (await who('4175550888')).match === 'none', w)
  const tryQ = async (q, setup = '') => { await db.exec('begin'); try { if (setup) await db.exec(setup); await db.exec(q); return 'ok' } catch (e) { return 'refused: ' + e.message } finally { await db.exec('rollback') } }
  await db.exec(`insert into public.call_task_reading (message_id, version, mode, match, call_type, model, tasks) values ('msg0001','v1','practice','none','other','x','[{"title":"Call Ann"}]')`)
  ck('PGLITE: readings are append-only (update, delete, truncate refused), even for the owner', (await tryQ(`update public.call_task_reading set call_type = 'x'`)).includes('append-only') && (await tryQ('delete from public.call_task_reading')).includes('append-only') && (await tryQ('truncate public.call_task_reading')).includes('append-only'))
  ck('PGLITE v7: up to 8 cards fit, 9 do not; detail must be an object', (await tryQ(`insert into public.call_task_reading (message_id, version, mode, match, call_type, model, tasks, detail) values ('msg0008','v1','practice','none','other','x','[1,2,3,4,5,6,7,8]','{"summary":"s"}')`)) === 'ok' && (await tryQ(`insert into public.call_task_reading (message_id, version, mode, match, call_type, model, tasks) values ('msg0009','v1','practice','none','other','x','[1,2,3,4,5,6,7,8,9]')`)).startsWith('refused') && (await tryQ(`insert into public.call_task_reading (message_id, version, mode, match, call_type, model, detail) values ('msg0010','v1','practice','none','other','x','[1]')`)).startsWith('refused'))
  ck('PGLITE v13: one reading per call per version per try; a second try fits; tries go 1 to 5', (await tryQ(`insert into public.call_task_reading (message_id, version, mode, match, call_type, model) values ('msg0001','v1','practice','none','other','x')`)).startsWith('refused')
    && (await tryQ(`insert into public.call_task_reading (message_id, version, mode, match, call_type, model, attempt) values ('msg0001','v1','practice','none','other','x',2)`)) === 'ok'
    && (await tryQ(`insert into public.call_task_reading (message_id, version, mode, match, call_type, model, attempt) values ('msg0001','v1','practice','none','other','x',6)`)).startsWith('refused'))
  const pw = `insert into public.call_promise_watch (message_id, idx, version, call_at, what, kind, area, due) values ('msg0001', 0, 'v13', now(), 'Call Steve Monday', 'we_agreed', 'scheduling', '2026-10-12')`
  ck('PGLITE v13: the promise watch keeps we-agreed and awaiting-confirmation promises only, one row per promise', (await tryQ(pw, 'set local role service_role')) === 'ok'
    && (await tryQ(pw.replace("'we_agreed'", "'caller_considering'"), 'set local role service_role')).startsWith('refused')
    && (await tryQ(pw + '; ' + pw, 'set local role service_role')).startsWith('refused'))
  ck('PGLITE v13: the server can insert and update promises but never delete them; an office page can read, not write; anon cannot read',
    (await tryQ(`update public.call_promise_watch set status = 'kept'`, pw + '; set local role service_role')) === 'ok'
    && (await tryQ('delete from public.call_promise_watch', pw + '; set local role service_role')).includes('permission denied')
    && (await tryQ('select * from public.call_promise_watch', 'set local role authenticated')) === 'ok'
    && (await tryQ(`update public.call_promise_watch set status = 'kept'`, 'set local role authenticated')).includes('permission denied')
    && (await tryQ('select * from public.call_promise_watch', 'set local role anon')).includes('permission denied'))
  ck('PGLITE v13: a status outside waiting, kept, kept late, would remind, dropped is refused', (await tryQ(pw.replace("'2026-10-12')", "'2026-10-12'); update public.call_promise_watch set status = 'reminded'"), 'set local role service_role')).startsWith('refused'))
  const rb13 = fs.readFileSync('call_tasks_650_v13_rollback.sql', 'utf8').replace(/^begin;|commit;\s*$/gm, '')
  ck('PGLITE v13: the v13 rollback refuses while a message has two tries', (await tryQ(rb13, `insert into public.call_task_reading (message_id, version, mode, match, call_type, model, attempt) values ('msg0001','v1','practice','none','other','x',2)`)).includes('rollback refused'))
  await db.exec(fs.readFileSync('call_tasks_650_v13_rollback.sql', 'utf8'))
  ck('PGLITE v13: otherwise the rollback removes the promise watch and the try number', (await db.query(`select to_regclass('public.call_promise_watch') is null as a, not exists (select 1 from information_schema.columns where table_name = 'call_task_reading' and column_name = 'attempt') as b`)).rows.every((r) => r.a && r.b))
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
