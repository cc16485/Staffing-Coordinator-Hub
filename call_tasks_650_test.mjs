// 650 v7 · call follow-up cards, practice (her eight points, 2026-10-12). Under Node against the REAL call-tasks function and _shared/call-tasks.ts with a
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
    domains: [{ code: 'client_care', owner_person: 'pk', active: true }, { code: 'scheduling_coverage', owner_person: 'ps', active: true }, { code: 'money', owner_person: 'ps', active: true }, { code: 'payer_programs', owner_person: 'pa', active: true }, { code: 'family_enquiries', owner_person: 'pk', active: true }, { code: 'incidents', owner_person: 'ps', active: true }, { code: 'program_administration', owner_person: 'ps', active: true }],
    persons: [{ person_id: 'pk', full_name: 'Krystal Land', primary_email: 'krystal@cc.test' }, { person_id: 'ps', full_name: 'Samantha Troutman', primary_email: 'samantha@cc.test' }, { person_id: 'pa', full_name: 'Angiel Falig', primary_email: 'angiel@cc.test' }],
    client_journey_step_def: [{ key: 'intake.payer', def: { title: 'Identify the payer' }, active: true }], client_journey: [], client_journey_step: [],
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
      order(k, o) { ord = [k, o?.ascending !== false]; return p }, limit(n) { lim = n; return p }, maybeSingle() { single = true; return p }, not(k, op, v) { f.push((r) => r[k] !== null && r[k] !== undefined); return p },
      insert(row) { DB.writes.push(tb); if (tb === 'call_task_reading') { if (DB.call_task_reading.some((r) => r.message_id === row.message_id && r.version === row.version)) return Promise.resolve({ error: { message: 'duplicate key' } }); DB.call_task_reading.push({ id: ++rid, ...JSON.parse(JSON.stringify(row)) }) } return Promise.resolve({ error: null }) },
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
  if (FAILAI === 'refusal') return { stop_reason: 'refusal', stop_details: { category: 'general_harms' }, content: [] }
  if (FAILAI === 'throw') throw new Error('overloaded')
  if (FAILAI === 'textonce' && req.messages.length === 1) return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I think the cards are...' }] }
  if (FAILAI === 'textalways') return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'no tool' }] }
  if (globalThis.__EVAL_ANSWER) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_followups', input: globalThis.__EVAL_ANSWER(req) }] }
  const id = Object.keys(ANSWERS_V7).find((k) => req.messages[0].content.includes(k === 'ipoVD64wn8dUcDyPdjqW' ? 'calling to arrange a ride' : 'license expired'))
  const a = typeof ANSWERS_V7[id] === 'function' ? ANSWERS_V7[id](req) : ANSWERS_V7[id]
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
  ck('request: Claude Sonnet 5.5, effort medium, strict tool, tool_choice auto, refusal fallback on', req.model === 'claude-sonnet-5-5' && req.output_config.effort === 'medium' && req.tools[0].strict === true && req.tool_choice.type === 'auto' && req.fallbacks === 'default' && JSON.stringify(req.betas) === '["server-side-fallback-2026-07-01"]')
  ck('request: no thinking or sampling setting, one user message', !('thinking' in req) && !('temperature' in req) && req.messages.length === 1)
  const schemaTxt = JSON.stringify(lib.TOOL.input_schema)
  ck('the tool schema is strict-safe: every object closed, every field required, no length or count keywords', !/maxItems|maxLength|minLength|pattern|format/.test(schemaTxt) && (schemaTxt.match(/"additionalProperties":false/g) || []).length === 4)
  ck('v7 schema: summary, understood, promises told apart, every responsibility with a decision, urgency, reason', ['summary', 'understood', 'commitments', 'items', 'decision', 'urgency', 'reason', 'caller_considering', 'awaiting_confirmation', 'already_in_workflow', 'done_on_call', 'caller_owns'].every((w) => schemaTxt.includes(w)))
  ck('v7 prompt carries her eight points', [/several unrelated responsibilities/, /Tell promises apart/, /something the caller will do/, /caller considering, not a request/, /established workflows/, /Client Journey steps/, /do not create duplicate work or a way around it/,
    /Urgency is not routine/, /not by who answered the phone/, /less to remember/, /should not fill up with cards nobody needs/].every((re) => re.test(lib.SYSTEM)), lib.SYSTEM.slice(0, 300))
  ck('v8: a change in condition is client care (urgency today); an injury or immediate danger is an incident', /a change in a client's condition such as new confusion, not eating or new symptoms: urgency today/.test(lib.SYSTEM) && /a change in condition without an injury or immediate danger is client_care/.test(lib.SYSTEM))
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
  ck('the schedule runs it: both of Steve\'s calls read (oldest first), the error-stage and pre-start calls left alone', s === 200 && j.read === 2 && DB.call_task_reading.map((r) => r.message_id).join() === 'ipoVD64wn8dUcDyPdjqW,gMcTDQ5WoAXMHUmrCbdN', [s, j])
  const [vm, call] = DB.call_task_reading
  ck('the voicemail: one would-be card "Call Steve Algiere back...", urgency today, owner from the Staffing seat or the scheduling owner, practice mode', vm.mode === 'practice' && vm.tasks.length === 1 && /Call Steve Algiere back/.test(vm.tasks[0].title) && vm.tasks[0].urgency === 'today' && vm.tasks[0].owner.name === 'Samantha Troutman' && vm.tasks[0].voicemail === true, vm.tasks)
  ck('the call: matched by the identity layer; the summary, what was understood and the promises are kept (we agreed vs caller will)', call.who_name === 'Steve Algiere' && /DMV/.test(call.detail.summary) && call.detail.understood.length === 2
    && call.detail.commitments.map((x) => x.kind).join() === 'caller_will,we_agreed', call.detail)
  ck('the call: one card ("Schedule Angiel ... DMV trip"), due Fri Oct 16, this week, owner and why; the "wait for Steve" item kept as the caller\'s with no card; the junk item made safe', call.tasks.length === 2 && /^Schedule Angiel 2-3 hours with Steve this week/.test(call.tasks[0].title) && call.tasks[0].due === '2026-10-16'
    && call.tasks[0].urgency === 'this_week' && call.tasks[0].owner.name && call.detail.items.length === 3 && call.detail.items[1].decision === 'caller_owns', [call.tasks, call.detail.items])
  ck('the call answers the voicemail (a made-up one dropped)', JSON.stringify(call.resolves) === '[{"message_id":"ipoVD64wn8dUcDyPdjqW","task_index":0}]', call.resolves)
  ck('nothing is kept that it must not keep: no transcript lines, phone number or email in any reading', !/Speaker \d|take me to the DMV|help me get in|417|0467|example\.com/.test(JSON.stringify(DB.call_task_reading)), JSON.stringify(DB.call_task_reading).match(/.{30}(Speaker \d|417|0467|example\.com).{30}/g))
  ck('PRACTICE: nothing is written to Work (no ops_items), only the readings and a heartbeat', !DB.writes.includes('ops_items') && DB.writes.every((w) => ['call_task_reading', 'automation_heartbeats'].includes(w)), DB.writes)
  ck('every GoHighLevel request is a read, to its message, transcript and contact endpoints', GH.calls.length === 6 && GH.calls.every((u) => /services\.leadconnectorhq\.com\/(conversations\/messages\/|conversations\/locations\/loc1\/messages\/.*\/transcription|contacts\/)/.test(u)), GH.calls)
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
  reset(); delete GH.transcripts.gMcTDQ5WoAXMHUmrCbdN
  ;[s, j] = await run(h, 'cron')
  ck('no transcript yet: that call is left for the next run', j.no_transcript === 1 && DB.call_task_reading.length === 1, [s, j])
  reset()
  ;[s, j] = await run(h, 'owner', { message_ids: ['gMcTDQ5WoAXMHUmrCbdN'] })
  ck('the owner can name a call to read again', s === 200 && j.read === 1, [s, j])
  // the test bench
  reset(); globalThis.__EVAL_ANSWER = (r) => base({ caller_role: 'family', summary: 'eval', items: [item({ title: 'Add Saturday hours for Mrs Example', area: 'scheduling', urgency: 'this_week' })] })
  ;[s, j] = await run(h, 'owner', { eval: [{ id: 'e1', call_at: '2026-10-13T15:00:00Z', direction: 'in', seconds: 90, caller: 'Daughter', who: { match: 'none' }, transcript: 'we would like Saturdays', context: { leads: [] } }] })
  ck('the test bench (owner): a made-up call is read and answered; nothing is stored or read from GoHighLevel', s === 200 && j.results.length === 1 && j.results[0].reading.tasks[0].title === 'Add Saturday hours for Mrs Example' && j.results[0].reading.tasks[0].owner.name
    && !DB.call_task_reading.length && !GH.calls.length && !DB.writes.length, [s, j, DB.writes])
  ;[s, j] = await run(h, 'cron', { eval: [{ id: 'e1', call_at: '2026-10-13T15:00:00Z', transcript: 'x' }] })
  ck('the test bench is the owner\'s only (the schedule is refused)', s === 403, [s, j])
  globalThis.__EVAL_ANSWER = null
  const src = fs.readFileSync(path.join(F, 'call-tasks/index.ts'), 'utf8')
  ck('the function never sends: no POST to GoHighLevel, no Resend, no texts', !/method:\s*'POST'|resend|\/conversations\/messages'\s*,|sms/i.test(src.replace(/^\/\/.*$/gm, '')))
  ck('owners come from the Hub (domains, the Staffing seat), handed to clean(); the AI is never asked for a person', /staffingAt\(hub, s\.call_at\)/.test(src) && /from\('domains'\)/.test(src) && !/owner_name|assign to/i.test(JSON.stringify(lib.TOOL)))
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
  await db.exec(sq); await db.exec(sq); await db.exec(sq7); await db.exec(sq7)
  ck('PGLITE: 650 and v7 install, and install again', true)
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
  ck('PGLITE: one reading per call per version', (await tryQ(`insert into public.call_task_reading (message_id, version, mode, match, call_type, model) values ('msg0001','v1','practice','none','other','x')`)).startsWith('refused')
)
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
