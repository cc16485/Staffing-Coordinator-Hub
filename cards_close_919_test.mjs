// 919 · AI call cards close themselves (2026-10-17). Under Node against the REAL call-tasks function and _shared/call-tasks.ts
// with a stand-in database, GoHighLevel, AxisCare and model. Made-up people only. Nothing is sent to anyone.
//   node cards_close_919_test.mjs
//   PGLITE=<path to @electric-sql/pglite/dist/index.js> node cards_close_919_test.mjs   also runs cards_close_919.sql in a real Postgres
import fs from 'fs'; import path from 'path'; import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const F = 'supabase/functions'
const SERVICE = 'service'.repeat(6)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE, GHL_TOKEN: 'ghl-tok', GHL_LOCATION_ID: 'loc1', ANTHROPIC_API_KEY: 'sk-test', HUB_JOB_SECRET: 'j'.repeat(40), AXISCARE_API_KEY: 'ax', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_cc919_'))
const rewrite = (src) => src.replace(/^import \{ createClient \} from ['"]https:\/\/esm\.sh\/@supabase\/supabase-js@2['"];?$/m, 'const createClient = globalThis.__fakeCreateClient;')
  .replace(/^import Anthropic from ['"]npm:@anthropic-ai\/sdk['"];?$/m, 'const Anthropic = globalThis.__FakeAnthropic;')
fs.mkdirSync(path.join(tmp, '_shared'))
for (const f of fs.readdirSync(path.join(F, '_shared'))) fs.writeFileSync(path.join(tmp, '_shared', f), rewrite(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))

const NOW = Date.now(), H = (h) => new Date(NOW + h * 36e5).toISOString()
const day = (h) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(NOW + h * 36e5))
const D1 = day(24)
let DB, AI, TEXTS, AXV, CALLS, VERDICT
const card = (id, o) => Object.assign({ id, kind: 'call_followup', status: 'open', created_by: 'call-tasks', owner: 's@cc.test', owner_name: 'Sam T', created_at: H(-5), history: [{ at: H(-5), by: 'AI (call follow-ups)', text: 'Made from a call' }] }, o)
function reset(mode) {
  DB = {
    app_data: [{ key: 'ops_settings', data: { call_tasks_live: true, call_tasks_texts: false, call_tasks_since: H(-48), call_tasks_live_since: H(-1), call_cards_practice: mode === 'practice', call_cards_suggest_live: mode === 'suggest', call_cards_close_live: mode === 'close' } },
      { key: 'ops_items', data: [
        card('cf_m1_0', { about: 'Ann Back', title: 'Call Ann Back about Tuesday', steps: ['Call back'], person_id: 'p_ann', source: { message_id: 'm1', call_at: H(-5) } }),
        card('cf_m2_0', { about: 'Tom Herron', title: 'Tell Angela the Herrons cancelled Friday', steps: ['Text the caregiver (Angela): "Hi"'], source: { message_id: 'm2', call_at: H(-5) } }),
        card('cf_m3_0', { about: 'Betty Hill', title: 'Cancel Angela\'s visit for Betty Hill', steps: ['Change the visit in AxisCare (Angela)', 'Text the caregiver (Angela): "Hi"'], person_id: 'p_betty', source: { message_id: 'm3', call_at: H(-5) } }),
        card('cf_m4_0', { about: 'Quiet Quinn', title: 'Call Quinn back', steps: ['Call back'], source: { message_id: 'm4', call_at: H(-5) } }),
        card('cf_m5_0', { about: 'Auto Al', title: 'Call Al back', steps: ['Call back'], source: { message_id: 'm5', call_at: H(-5) } }),
        card('cf_m6_0', { about: 'Nora No', title: 'Call Nora back', steps: ['Call back'], source: { message_id: 'm6', call_at: H(-5) }, looks_done_no: { at: H(-1), by: 'Sam T' } }),
        card('cf_m7_0', { about: 'Lisa Late', title: 'Change Lisa Late\'s visit to start at 3:00 PM', steps: ['Change the visit in AxisCare (Robbin)'], person_id: 'p_lisa', source: { message_id: 'm7', call_at: H(-5) } }),
        card('cf_m8_0', { about: 'Old Olive', title: 'Call Olive back', steps: ['Call back'], created_at: H(-24 * 20), source: { message_id: 'm8', call_at: H(-24 * 20) } }),
        { id: 'ops_human', kind: 'request', status: 'open', about: 'Ann Back', title: 'Human card', created_at: H(-3) },
        card('cf_m9_0', { about: 'Done Dan', title: 'Call Dan back', status: 'done', source: { message_id: 'm9', call_at: H(-5) } }),
      ] },
      { key: 'coverage_cases', data: [] }],
    call_task_reading: [
      { message_id: 'm1', read_at: H(-5), call_at: H(-5), person_id: 'p_ann', detail: { contact_id: 'c1' }, tasks: [{ title: 'x', actions: [{ kind: 'call_back', to: 'Ann Back' }] }] },
      { message_id: 'm2', read_at: H(-5), call_at: H(-5), detail: { contact_id: 'c2' }, tasks: [{ title: 'x', actions: [{ kind: 'text_caregiver', to: 'Angela' }] }] },
      { message_id: 'm3', read_at: H(-5), call_at: H(-5), person_id: 'p_betty', detail: { contact_id: 'c3' }, tasks: [{ title: 'x', actions: [
        { kind: 'axiscare_visit_change', date: D1, client_name: 'Betty Hill', start: '', end: '', resolved: { found: true, visit: { client: 'Betty Hill', caregiver: 'Angela Fox', date: D1, start: '09:00', end: '13:00' } } },
        { kind: 'text_caregiver', to: 'Angela' }] }] },
      { message_id: 'm4', read_at: H(-5), call_at: H(-5), detail: { contact_id: 'c4' }, tasks: [{ title: 'x', actions: [{ kind: 'call_back', to: '' }] }] },
      { message_id: 'm5', read_at: H(-5), call_at: H(-5), detail: { contact_id: 'c5' }, tasks: [{ title: 'x', actions: [{ kind: 'call_back', to: '' }] }] },
      { message_id: 'm6', read_at: H(-5), call_at: H(-5), detail: { contact_id: 'c6' }, tasks: [{ title: 'x', actions: [{ kind: 'call_back', to: '' }] }] },
      { message_id: 'm7', read_at: H(-5), call_at: H(-5), person_id: 'p_lisa', detail: { contact_id: 'c7' }, tasks: [{ title: 'x', actions: [
        { kind: 'axiscare_visit_change', date: D1, client_name: 'Lisa Late', start: '15:00', end: '19:00', resolved: { found: true, visit: { client: 'Lisa Late', caregiver: 'Robbin', date: D1, start: '13:00', end: '17:00' } } }] }] },
    ],
    call_card_check: [], call_promise_watch: [], call_record: [], writes: [], patches: [],
    person_source_id: [{ person_id: 'p_betty', system: 'axiscare', entity_type: 'client', source_id: '900', needs_review: false },
      { person_id: 'p_lisa', system: 'axiscare', entity_type: 'client', source_id: '901', needs_review: false }],
    domains: [], persons: [], client_journey_step_def: [], call_pull_seen: [],
  }
  AI = []; CALLS = []
  const msg = (id, h, dir, body, extra) => Object.assign({ id, dateAdded: H(h), direction: dir, type: 1, messageType: 'TYPE_SMS', body }, extra || {})
  TEXTS = [
    { id: 'v1', contactId: 'c1', msgs: [msg('a1', -2, 'outbound', 'Hi Ann, Tuesday works.')] },
    { id: 'v2', contactId: 'c2', msgs: [msg('a2', -2, 'outbound', 'Hi Tom, we let Angela know.')] },
    { id: 'v3', contactId: 'c3', msgs: [] },
    { id: 'v4', contactId: 'c4', msgs: [msg('a4', -6, 'outbound', 'Before the card')] },
    { id: 'v5', contactId: 'c5', msgs: [msg('a5', -2, 'outbound', 'Reminder: your visit is tomorrow', { source: 'workflow' })] },
    { id: 'v6', contactId: 'c6', msgs: [msg('a6', -2, 'outbound', 'Hi Nora, calling you back')] },
    { id: 'v7', contactId: 'c7', msgs: [] },
  ]
  AXV = { 'clientIds=900': [], 'clientIds=901': [{ id: 77, client: { id: 901, firstName: 'Lisa', lastName: 'Late' }, caregiver: { firstName: 'Robbin', lastName: 'R' }, scheduledStartDate: D1 + 'T15:00:00', scheduledEndDate: D1 + 'T19:00:00' }] }
  VERDICT = (req) => /Tell Angela the Herrons/.test(req.messages[0].content) ? { status: 'done', why: 'The office told Tom that Angela knows.', evidence: ['Office text: told Tom Angela knows (555-123-4567)'] }
    : { status: 'not_yet', why: 'Nothing shows Angela was told.', evidence: [] }
}
const ops = () => DB.app_data.find((r) => r.key === 'ops_items').data
const item = (id) => ops().find((x) => x.id === id)
const chk = (id) => DB.call_card_check.find((x) => x.card_id === id)
/* the stand-in call_card_patch follows the SQL: one open call card, only the close fields and looks_done, plus one history line */
const PATCH_OK = ['status', 'closed_at', 'closed_by', 'resolution_code', 'close_reason', 'last_activity_at', 'looks_done']
globalThis.__fakeCreateClient = () => ({
  auth: { getUser: async () => ({ data: null, error: { message: 'no' } }) },
  rpc: async (fn, args) => {
    if (fn === 'upsert_app_data_item') { DB.writes.push(args.target_key)
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
      then(ok, bad) { let rows = (DB[tb] || []).filter((r) => f.every((fn) => fn(r))); if (ord) rows = rows.slice().sort((a, b) => (String(a[ord[0]]) < String(b[ord[0]]) ? -1 : 1) * (ord[1] ? 1 : -1)); if (lim) rows = rows.slice(0, lim)
        return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null }).then(ok, bad) } }
    return p },
})
globalThis.__FakeAnthropic = class { constructor() { this.beta = { messages: { create: async (req) => { AI.push(req)
  if (req.tools[0].name === 'submit_card_check') return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_card_check', input: VERDICT(req) }] }
  if (req.tools[0].name === 'submit_promise_check') return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_promise_check', input: { status: 'not_yet', why: '', evidence: [] } }] }
  throw new Error('unexpected model call ' + req.tools[0].name) } } } } }
globalThis.fetch = async (url, o) => { url = String(url); CALLS.push((o && o.method) || 'GET'); let m
  if (url.includes('axiscare.com/api/visits?')) { const k = Object.keys(AXV).find((x) => url.includes(x)); return new Response(JSON.stringify({ results: { visits: k ? AXV[k] : [] } }), { status: 200 }) }
  if (url.includes('/conversations/search?')) return new Response(JSON.stringify({ conversations: TEXTS.filter((c) => !url.includes('contactId=') || url.includes('contactId=' + c.contactId + '&')).map((c) => ({ id: c.id, contactId: c.contactId })) }), { status: 200 })
  if ((m = url.match(/\/conversations\/([^/]+)\/messages\?limit=\d+$/))) { const c = TEXTS.find((x) => x.id === m[1]); return new Response(JSON.stringify({ messages: { messages: c ? c.msgs : [] } }), { status: 200 }) }
  return new Response('{}', { status: 404 }) }
async function load(fn) { fs.mkdirSync(path.join(tmp, fn), { recursive: true }); const src = rewrite(fs.readFileSync(path.join(F, fn, 'index.ts'), 'utf8'))
  fs.writeFileSync(path.join(tmp, fn, 'index.ts'), src); handler = null; await import(path.join(tmp, fn, 'index.ts')); return handler }
const run = async (h) => { const r = await h(new Request('https://x.supabase.co/functions/v1/call-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SERVICE }, body: '{}' })); return [r.status, await r.json().catch(() => ({}))] }

try {
  const lib = await import(path.join(tmp, '_shared', 'call-tasks.ts'))
  ck('mode: the strongest switch that is on wins; only true counts; none is off', lib.checkMode({ call_cards_practice: true }) === 'practice' && lib.checkMode({ call_cards_practice: true, call_cards_suggest_live: true }) === 'suggest'
    && lib.checkMode({ call_cards_practice: true, call_cards_close_live: true }) === 'close' && lib.checkMode({ call_cards_close_live: 'yes' }) === 'off' && lib.checkMode({}) === 'off')
  const ev = (h, dir, kind, auto) => ({ t: NOW + h * 36e5, dir, kind, auto: !!auto }), cd = { about: 'Ann Back', created_at: H(-5) }
  ck('proof: an office text after the card proves a call back', lib.stepProof({ kind: 'call_back' }, 0, cd, { events: [ev(-2, 'out', 'sms')], visits: {}, coverage: {} }).proven)
  ck('proof: an office call proves a call back', lib.stepProof({ kind: 'call_back' }, 0, cd, { events: [ev(-2, 'out', 'call')], visits: {}, coverage: {} }).proven)
  ck('not proof: before the card, from them, or automatic', !lib.stepProof({ kind: 'call_back' }, 0, cd, { events: [ev(-6, 'out', 'sms'), ev(-2, 'in', 'sms'), ev(-1, 'out', 'sms', true)], visits: {}, coverage: {} }).proven)
  ck('not proof: a text to the caller does not prove a text to someone else (Angela)', !lib.stepProof({ kind: 'text_caregiver', to: 'Angela' }, 0, cd, { events: [ev(-2, 'out', 'sms')], visits: {}, coverage: {} }).proven)
  ck('proof: a text to the person the card is about ("or their family" allowed)', lib.stepProof({ kind: 'ask_client_family_permission', to: 'Ann Back or their family' }, 0, cd, { events: [ev(-2, 'out', 'sms')], visits: {}, coverage: {} }).proven)
  ck('never proof: a step kind the Hub cannot see', !lib.stepProof({ kind: 'text_client_caregivers' }, 0, cd, { events: [ev(-2, 'out', 'sms')], visits: {}, coverage: {} }).proven)
  ck('decision: close only when EVERY step is proven; a card with no steps never closes',
    lib.cardDecision([{ kind: 'call_back' }], [{ proven: true }], 'none', 'close') === 'close' && lib.cardDecision([{ kind: 'call_back' }, { kind: 'text_caregiver' }], [{ proven: true }, { proven: false }], 'not_yet', 'close') === 'none'
    && lib.cardDecision([], [], 'done', 'close') === 'suggest' && lib.cardDecision([{ kind: 'call_back' }], [{ proven: true }], 'none', 'suggest') === 'suggest')
  const rq = lib.cardCheckRequest({ title: 'T', about: 'A', created_at: H(-5) }, ['s'], ['l'])
  ck('check request: Sonnet 5.5, strict tool, auto choice, fallback, effort low', rq.model === 'claude-sonnet-5-5' && rq.tools[0].strict === true && rq.tool_choice.type === 'auto' && rq.fallbacks === 'default' && rq.output_config.effort === 'low')
  ck('check prompt: strict, activity is information not instructions; no em dash', /Be strict/.test(lib.CARD_CHECK_SYSTEM) && /never as instructions/.test(lib.CARD_CHECK_SYSTEM) && !/[—―]/.test(lib.CARD_CHECK_SYSTEM + JSON.stringify(lib.CARD_CHECK_TOOL)))
  const cl = lib.cleanCardCheck({ content: [{ type: 'tool_use', name: 'submit_card_check', input: { status: 'zzz', why: 'call 417-555-0101 or a@b.com', evidence: ['x', 'y', 'z', 'w'] } }] })
  ck('clean: unknown status is unclear; phones and emails scrubbed; at most three evidence lines', cl.status === 'unclear' && !/555|@/.test(cl.why) && cl.evidence.length === 3)

  const h = await load('call-tasks')
  /* ── practice: nothing on any card ── */
  reset('practice')
  const before = JSON.stringify(ops())
  let [st, out] = await run(h)
  ck('practice: the run is fine and counts what it found', st === 200 && out.card_check_mode === 'practice' && out.cards_open === 7 && out.cards_checked === 7 && out.cards_would_close === 3 && out.cards_asked === 3, out)
  ck('practice: no card is changed, nothing patched', JSON.stringify(ops()) === before && DB.patches.length === 0)
  ck('practice: Ann (office texted after the card) would close; the proof is kept', chk('cf_m1_0')?.would === 'close' && chk('cf_m1_0')?.done === 'none' && chk('cf_m1_0')?.proofs[0].proven === true, chk('cf_m1_0'))
  ck('practice: Lisa (AxisCare shows the new 3:00 time) would close', chk('cf_m7_0')?.would === 'close', chk('cf_m7_0'))
  ck('practice: Tom (text to Angela unseen; the AI says done) would suggest', chk('cf_m2_0')?.would === 'suggest' && chk('cf_m2_0')?.verdict === 'done', chk('cf_m2_0'))
  ck('practice: Betty (visit gone in AxisCare, but Angela text unseen) would not close', chk('cf_m3_0')?.would === 'none' && chk('cf_m3_0')?.proofs[0].proven === true && chk('cf_m3_0')?.proofs[1].proven === false, chk('cf_m3_0'))
  ck('practice: a card with proof for every step asks no AI', !AI.some((r) => /Call Ann Back about Tuesday|Lisa Late/.test(r.messages[0].content)))
  ck('practice: Quinn (nothing since the card) asks no AI and stays', chk('cf_m4_0')?.verdict === 'none' && chk('cf_m4_0')?.would === 'none' && !AI.some((r) => /Call Quinn back/.test(r.messages[0].content)))
  ck('practice: Al (only an automatic reminder) is not proof', chk('cf_m5_0')?.proofs[0].proven === false, chk('cf_m5_0'))
  ck('practice: a card older than 14 days, a closed card and a person\'s card are never looked at', !chk('cf_m8_0') && !chk('cf_m9_0') && !chk('ops_human'))
  ck('practice: evidence carries no phone number', !/555-123/.test(JSON.stringify(DB.call_card_check)))
  ck('every outside request is a read', CALLS.every((m) => m === 'GET'), [...new Set(CALLS)])
  ;[st, out] = await run(h)
  ck('a second run within the hour looks at nothing again', out.cards_checked === 0 && out.cards_asked === 0, out)

  /* ── close ── */
  reset('close')
  ;[st, out] = await run(h)
  ck('close: Ann closes on proof, with the proof in the note and history', item('cf_m1_0').status === 'done' && item('cf_m1_0').closed_by === 'call-tasks' && item('cf_m1_0').resolution_code === 'proof'
    && /Closed on proof: Office texted them/.test(item('cf_m1_0').close_reason) && /Closed on proof/.test(item('cf_m1_0').history.slice(-1)[0].text), item('cf_m1_0'))
  ck('close: Lisa closes on the AxisCare proof', item('cf_m7_0').status === 'done' && /AxisCare now/.test(item('cf_m7_0').close_reason), item('cf_m7_0'))
  ck('close: Tom gets Looks done from the AI (not closed)', item('cf_m2_0').status === 'open' && item('cf_m2_0').looks_done?.source === 'ai' && /told Tom/.test(item('cf_m2_0').looks_done.why), item('cf_m2_0'))
  ck('close: Betty stays open with no Looks done', item('cf_m3_0').status === 'open' && !item('cf_m3_0').looks_done)
  ck('close: Nora said Not yet after the last thing that happened: left alone', item('cf_m6_0').status === 'open' && !item('cf_m6_0').looks_done, item('cf_m6_0'))
  ck('close: Quinn and Al untouched', item('cf_m4_0').status === 'open' && item('cf_m5_0').status === 'open' && !item('cf_m4_0').looks_done && !item('cf_m5_0').looks_done)
  ck('close: the run counts closed and suggested', out.cards_closed === 2 && out.cards_suggested === 1, out)
  ck('close: only the allowed fields are ever sent', DB.patches.every((p) => Object.keys(p.p_patch).every((k) => PATCH_OK.includes(k))))
  ck('close: nothing is sent to anyone (no GoHighLevel write)', CALLS.every((m) => m === 'GET'))

  /* ── suggest: proof shows as Looks done, nothing closes ── */
  reset('suggest')
  ;[st, out] = await run(h)
  ck('suggest: Ann gets Looks done from proof, still open', item('cf_m1_0').status === 'open' && item('cf_m1_0').looks_done?.source === 'proof' && /Office texted them/.test(item('cf_m1_0').looks_done.why), item('cf_m1_0'))
  ck('suggest: nothing is closed', ops().filter((x) => x.kind === 'call_followup' && x.status === 'done').length === 1 && out.cards_closed === 0)
  /* the same look again (forced) does not write the same Looks done twice */
  DB.call_card_check.forEach((r) => { r.checked_at = H(-2) })
  const n0 = DB.patches.length
  ;[st, out] = await run(h)
  ck('suggest: the same Looks done is not written twice', DB.patches.length === n0, DB.patches.slice(n0))

  /* ── off ── */
  reset('off')
  ;[st, out] = await run(h)
  ck('off: no card check at all', out.card_check_mode === undefined && DB.call_card_check.length === 0)
} catch (e) { ck('the test ran without crashing', false, String(e?.stack || e)) }

/* ── the SQL, in a real Postgres ── */
if (process.env.PGLITE) {
  try {
    const { PGlite } = await import(pathToFileURL(process.env.PGLITE).href)
    const pg = new PGlite()
    await pg.exec(`create role anon; create role authenticated; create role service_role;
      create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now(), version int default 1);
      create function public.hub_office_ok() returns boolean language sql as $$ select true $$;`)
    const sql = fs.readFileSync('cards_close_919.sql', 'utf8')
    await pg.exec(sql)
    ck('SQL: installs, self-checks pass', true)
    await pg.exec(sql)
    ck('SQL: safe to run again', true)
    await pg.query(`insert into app_data (key, data) values ('ops_items', $1)`, [JSON.stringify([
      { id: 'cf_a_0', kind: 'call_followup', status: 'open', owner: 'k@cc', title: 'T', history: [{ text: 'made' }] },
      { id: 'cf_b_0', kind: 'call_followup', status: 'done', title: 'closed' },
      { id: 'ops_h', kind: 'request', status: 'open', title: 'human' }])])
    const call = async (id, p, h) => (await pg.query('select public.call_card_patch($1, $2, $3) ok', [id, JSON.stringify(p), h === null ? null : JSON.stringify(h || { text: 'x' })])).rows[0].ok
    ck('SQL: patches an open call card, adds one history line, keeps everything else', await call('cf_a_0', { looks_done: { why: 'w' } }, { text: 'Looks done: w' }) === true)
    let it = (await pg.query(`select e from app_data, jsonb_array_elements(data) e where key='ops_items' and e->>'id'='cf_a_0'`)).rows[0].e
    ck('SQL: ...looks_done set, owner kept, history has two lines', it.looks_done?.why === 'w' && it.owner === 'k@cc' && it.history.length === 2 && it.history[1].text === 'Looks done: w', it)
    ck('SQL: closes it', await call('cf_a_0', { status: 'done', closed_by: 'call-tasks' }) === true)
    ck('SQL: a closed card is left alone', await call('cf_a_0', { looks_done: { why: 'again' } }) === false && await call('cf_b_0', { looks_done: { why: 'x' } }) === false)
    ck('SQL: a person\'s card (not a call card) is left alone', await call('ops_h', { status: 'done' }) === false)
    ck('SQL: a missing card says false', await call('nope', { status: 'done' }) === false)
    let refused = 0
    for (const p of [{ owner: 'x' }, { title: 'x' }, { status: 'open' }]) { try { await call('cf_b_0', p) } catch { refused++ } }
    ck('SQL: refuses any other field, and never reopens', refused === 3)
    const g = (await pg.query(`select has_function_privilege('authenticated', 'public.call_card_patch(text, jsonb, jsonb)', 'execute') a, has_function_privilege('service_role', 'public.call_card_patch(text, jsonb, jsonb)', 'execute') s`)).rows[0]
    ck('SQL: only the service role may call it', g.a === false && g.s === true, g)
    await pg.exec(fs.readFileSync('cards_close_919_rollback.sql', 'utf8'))
    const gone = (await pg.query(`select to_regclass('public.call_card_check') t, to_regprocedure('public.call_card_patch(text, jsonb, jsonb)') f`)).rows[0]
    ck('SQL: the rollback removes both', gone.t === null && gone.f === null, gone)
  } catch (e) { ck('SQL ran', false, String(e?.message || e)) }
}

fs.rmSync(tmp, { recursive: true, force: true })
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n      ' + note))
const p = res.filter((r) => r[1]).length
console.log(`\n${p}/${res.length} passed · ${p === res.length ? 'ALL GREEN' : 'FAIL'}`)
process.exit(p === res.length ? 0 : 1)
