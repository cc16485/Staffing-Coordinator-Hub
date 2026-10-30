// QUIETER CALL READER (2026-10-29, plan M2yJiaLMGCekNzZrL6WdT6, her approval with all three recommendations). Under Node against
// the REAL call-tasks function and _shared/call-tasks.ts with a stand-in database, GoHighLevel, AxisCare and model (the 919
// harness). Made-up people only. Checks: a call card whose day ended more than 2 days ago closes by itself ("Closed: the day
// has passed") only while ops_settings.quiet_calls_live is on; promise, could-not-read, care-at-risk, reopened and undated
// cards never do; nothing is sent to anyone.
//   node quiet_calls_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const F = 'supabase/functions'
const SERVICE = 'service'.repeat(6)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE, GHL_TOKEN: 'ghl-tok', GHL_LOCATION_ID: 'loc1', ANTHROPIC_API_KEY: 'sk-test', HUB_JOB_SECRET: 'j'.repeat(40), AXISCARE_API_KEY: 'ax', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_qc_'))
const rewrite = (src) => src.replace(/^import \{ createClient \} from ['"]https:\/\/esm\.sh\/@supabase\/supabase-js@2['"];?$/m, 'const createClient = globalThis.__fakeCreateClient;')
  .replace(/^import Anthropic from ['"]npm:@anthropic-ai\/sdk['"];?$/m, 'const Anthropic = globalThis.__FakeAnthropic;')
fs.mkdirSync(path.join(tmp, '_shared'))
for (const f of fs.readdirSync(path.join(F, '_shared'))) fs.writeFileSync(path.join(tmp, '_shared', f), rewrite(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))

const NOW = Date.now(), H = (h) => new Date(NOW + h * 36e5).toISOString()
const day = (h) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(NOW + h * 36e5))
const OLD = day(-24 * 5), RECENT = day(-24), FUTURE = day(48)
let DB, AI, TEXTS, AXV, CALLS, VERDICT
const card = (id, o) => Object.assign({ id, kind: 'call_followup', status: 'open', created_by: 'call-tasks', owner: 's@cc.test', owner_name: 'Sam T', urgency: 'normal', domain: 'scheduling_coverage',
  created_at: H(-24 * 6), history: [{ at: H(-24 * 6), by: 'AI (call follow-ups)', text: 'Made from a call' }] }, o)
function reset(on) {
  DB = {
    app_data: [{ key: 'ops_settings', data: { call_tasks_live: true, call_tasks_texts: false, call_tasks_since: H(-48), call_tasks_live_since: H(-1), ...(on ? { quiet_calls_live: true } : {}) } },
      { key: 'ops_items', data: [
        card('cf_m1_0', { title: 'Confirm Karen\'s visit Monday', source: { message_id: 'm1', day: OLD } }),
        card('cf_m2_0', { title: 'Put Mary on April\'s visits', source: { message_id: 'm2' } }),               // day from the reading
        card('cf_m3_0', { title: 'Change Kyra\'s shift', source: { message_id: 'm3', day: RECENT } }),          // ended 1 day ago: stays
        card('cf_m4_0', { title: 'Schedule Rhonda for Friday', source: { message_id: 'm4', day: FUTURE } }),   // not yet
        card('cf_m5_0', { title: 'Update Kyra\'s file', source: { message_id: 'm5' } }),                        // no day at all
        card('cfp_m6_0', { title: 'Promise not kept yet: call back', urgency: 'today', source: { message_id: 'm6', day: OLD } }),
        card('cfu_m7_0', { title: 'A call nobody could read', source: { message_id: 'm7', day: OLD } }),
        card('cf_m8_0', { title: 'Record Dan\'s head bump', domain: 'incidents', urgency: 'today', source: { message_id: 'm8', day: OLD } }),
        card('cf_m9_0', { title: 'Check on Carol\'s new confusion', domain: 'client_care', urgency: 'today', source: { message_id: 'm9', day: OLD } }),
        card('cf_m10_0', { title: 'Find a caregiver for today', urgency: 'urgent', source: { message_id: 'm10', day: OLD } }),
        card('cf_m11_0', { title: 'Reopened by Sam', keep_open: true, source: { message_id: 'm11', day: OLD } }),
        card('cf_m12_0', { title: 'Client care, normal', domain: 'client_care', urgency: 'normal', source: { message_id: 'm12', day: OLD } }),
        card('cf_m13_0', { title: 'Already done', status: 'done', source: { message_id: 'm13', day: OLD } }),
        card('cf_m14_0', { title: 'Watch for the insurance quote', domain: 'money', source: { message_id: 'm14' } }),             // a deadline, not a visit day
        card('cf_m15_0', { title: 'Send the referral, then move her visit', domain: 'program_administration', source: { message_id: 'm15' } }),  // its visit step has a day
        { id: 'ops_human', kind: 'request', status: 'open', title: 'Human card', created_at: H(-24 * 6), source: { day: OLD } },
      ] },
      { key: 'coverage_cases', data: [] }],
    call_task_reading: [
      { message_id: 'm2', read_at: H(-24 * 6), call_at: H(-24 * 6), detail: {}, tasks: [{ title: 'x', due: OLD, actions: [] }] },
      { message_id: 'm5', read_at: H(-24 * 6), call_at: H(-24 * 6), detail: {}, tasks: [{ title: 'x', due: '', actions: [] }] },
      { message_id: 'm14', read_at: H(-24 * 6), call_at: H(-24 * 6), detail: {}, tasks: [{ title: 'x', due: OLD, actions: [] }] },
      { message_id: 'm15', read_at: H(-24 * 6), call_at: H(-24 * 6), detail: {}, tasks: [{ title: 'x', due: FUTURE, actions: [{ kind: 'axiscare_visit_change', date: OLD }] }] },
    ],
    call_card_check: [], call_promise_watch: [], call_record: [], writes: [], patches: [],
    person_source_id: [], domains: [], persons: [], client_journey_step_def: [], call_pull_seen: [],
  }
  AI = []; CALLS = []; TEXTS = []; AXV = {}
  VERDICT = () => ({ status: 'not_yet', why: 'Nothing yet.', evidence: [] })
}
const ops = () => DB.app_data.find((r) => r.key === 'ops_items').data
const item = (id) => ops().find((x) => x.id === id)
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
      insert(row) { DB.writes.push(tb)
        /* like Postgres: call_card_check's key is card_id */
        if (tb === 'call_card_check' && (DB[tb] || []).some((r) => r.card_id === row.card_id)) return Promise.resolve({ error: { message: 'duplicate key value violates unique constraint "call_card_check_pkey"' } })
        ;(DB[tb] = DB[tb] || []).push(JSON.parse(JSON.stringify(row))); return Promise.resolve({ error: null }) },
      upsert(row, o) { DB.writes.push(tb); const k = (o && o.onConflict) || 'id'; const arr = (DB[tb] = DB[tb] || []); const i = arr.findIndex((r) => r[k] === row[k])
        if (i >= 0) Object.assign(arr[i], JSON.parse(JSON.stringify(row))); else arr.push(JSON.parse(JSON.stringify(row))); return Promise.resolve({ error: null }) },
      then(ok, bad) { let rows = (DB[tb] || []).filter((r) => f.every((fn) => fn(r))); if (ord) rows = rows.slice().sort((a, b) => (String(a[ord[0]]) < String(b[ord[0]]) ? -1 : 1) * (ord[1] ? 1 : -1)); if (lim) rows = rows.slice(0, lim)
        return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null }).then(ok, bad) } }
    return p },
})
globalThis.__FakeAnthropic = class { constructor() { this.beta = { messages: { create: async (req) => { AI.push(req)
  if (req.tools[0].name === 'submit_card_check') return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_card_check', input: VERDICT(req) }] }
  if (req.tools[0].name === 'submit_promise_check') return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_promise_check', input: { status: 'not_yet', why: '', evidence: [] } }] }
  throw new Error('unexpected model call ' + req.tools[0].name) } } } } }
globalThis.fetch = async (url, o) => { url = String(url); CALLS.push((o && o.method) || 'GET'); let m
  if (url.includes('axiscare.com/api/visits?') && url.includes('clientIds=912')) return new Response('{}', { status: 500 })
  if (url.includes('axiscare.com/api/visits?')) { const k = Object.keys(AXV).find((x) => url.includes(x)); return new Response(JSON.stringify({ results: { visits: k ? AXV[k] : [] } }), { status: 200 }) }
  if (url.includes('/conversations/search?')) return new Response(JSON.stringify({ conversations: TEXTS.filter((c) => !url.includes('contactId=') || url.includes('contactId=' + c.contactId + '&')).map((c) => ({ id: c.id, contactId: c.contactId })) }), { status: 200 })
  if ((m = url.match(/\/conversations\/([^/]+)\/messages\?limit=\d+$/))) { const c = TEXTS.find((x) => x.id === m[1]); return new Response(JSON.stringify({ messages: { messages: c ? c.msgs : [] } }), { status: 200 }) }
  return new Response('{}', { status: 404 }) }
async function load(fn) { fs.mkdirSync(path.join(tmp, fn), { recursive: true }); const src = rewrite(fs.readFileSync(path.join(F, fn, 'index.ts'), 'utf8'))
  fs.writeFileSync(path.join(tmp, fn, 'index.ts'), src); handler = null; await import(path.join(tmp, fn, 'index.ts')); return handler }
const run = async (h) => { const r = await h(new Request('https://x.supabase.co/functions/v1/call-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SERVICE }, body: '{}' })); return [r.status, await r.json().catch(() => ({}))] }

try {
  const lib = await import(path.join(tmp, '_shared', 'call-tasks.ts'))
  ck('switch: only quiet_calls_live === true counts', lib.quietOn({ quiet_calls_live: true }) && !lib.quietOn({ quiet_calls_live: 'yes' }) && !lib.quietOn({}) && !lib.quietOn(null))
  ck('kept: promise and could-not-read cards', lib.callKept({ id: 'cfp_a_0' }) && lib.callKept({ id: 'cfu_a_0' }))
  ck('kept: urgent, an incident, client care for today (her decision 3)', lib.callKept({ id: 'cf_a_0', urgency: 'urgent' }) && lib.callKept({ id: 'cf_a_0', domain: 'incidents' }) && lib.callKept({ id: 'cf_a_0', domain: 'client_care', urgency: 'today' }))
  ck('not kept: ordinary scheduling, client care with no rush', !lib.callKept({ id: 'cf_a_0', domain: 'scheduling_coverage', urgency: 'today' }) && !lib.callKept({ id: 'cf_a_0', domain: 'client_care', urgency: 'normal' }))
  ck('day: from the card first, else the reading\'s follow-up by its place, else none', lib.cardDay({ id: 'cf_a_1', source: { day: '2026-10-19' } }) === '2026-10-19'
    && lib.cardDay({ id: 'cf_a_1', domain: 'scheduling_coverage' }, { tasks: [{ due: '2026-01-01' }, { due: '2026-10-20' }] }) === '2026-10-20' && lib.cardDay({ id: 'cf_a_0', domain: 'scheduling_coverage' }, { tasks: [{ due: 'soon' }] }) === '' && lib.cardDay({ id: 'cf_a_0' }) === '')
  ck('day: only a visit or shift day counts; a deadline on other work is never "the day has passed"', lib.visitDay({ due: '2026-10-20' }, 'money') === '' && lib.visitDay({ due: '2026-10-20' }, 'program_administration') === ''
    && lib.visitDay({ due: '2026-10-20' }, 'scheduling_coverage') === '2026-10-20')
  ck('day: a visit-change or call-off step\'s date wins (the latest one), on any kind of work', lib.visitDay({ due: '2026-11-30', actions: [{ kind: 'axiscare_visit_change', date: '2026-10-19' }, { kind: 'open_calloff_case', date: '2026-10-21' }, { kind: 'call_back', date: '2026-12-01' }] }, 'money') === '2026-10-21')
  ck('day passed: more than 2 days after 6 pm Central on that day, not before', lib.dayPassed('2026-10-19', Date.parse('2026-10-22T00:00:00Z')) && !lib.dayPassed('2026-10-19', Date.parse('2026-10-21T22:00:00Z')) && !lib.dayPassed('', NOW))
  ck('words: a short day', lib.dayWords('2026-10-19') === 'Mon, Oct 19', lib.dayWords('2026-10-19'))
  const lc0 = lib.liveCard({ message_id: 'mx', call_at: H(-1), who_name: 'Ann' }, { title: 'T', why: 'W', area: 'scheduling', due: '2026-11-02', urgency: 'routine', actions: [] }, 0, null, NOW)
  const lc1 = lib.liveCard({ message_id: 'my', call_at: H(-1), who_name: 'Ann' }, { title: 'T', why: 'W', area: 'scheduling', due: '', urgency: 'routine', actions: [] }, 0, null, NOW)
  const lc2 = lib.liveCard({ message_id: 'mz', call_at: H(-1), who_name: 'Ann' }, { title: 'T', why: 'W', area: 'payroll', due: '2026-11-02', urgency: 'routine', actions: [] }, 0, null, NOW)
  ck('new cards carry the visit or shift day they are about; undated and non-visit work carry none', lc0.source.day === '2026-11-02' && !('day' in lc1.source) && !('day' in lc2.source), [lc0.source, lc1.source, lc2.source])

  const h = await load('call-tasks')
  reset(false)
  const before = JSON.stringify(ops())
  let [st, out] = await run(h)
  ck('switch off: the run is fine and nothing closes for its day', st === 200 && !('day_passed_closed' in out) && JSON.stringify(ops()) === before && !DB.patches.some((p) => p.p_patch.resolution_code === 'day_passed'), out)

  reset(true)
  ;[st, out] = await run(h)
  const closed = ops().filter((x) => x.resolution_code === 'day_passed').map((x) => x.id).sort()
  ck('switch on: the run is fine; exactly the four past-day cards close (dated on the card, by its reading, by its visit step, client care with no rush)', st === 200 && out.day_passed_closed === 4 && JSON.stringify(closed) === JSON.stringify(['cf_m12_0', 'cf_m15_0', 'cf_m1_0', 'cf_m2_0']), [out.day_passed_closed, closed])
  ck('switch on: the closed card says why and how to undo it, closed by call-tasks', item('cf_m1_0').status === 'done' && item('cf_m1_0').closed_by === 'call-tasks' && /day has passed/.test(item('cf_m1_0').close_reason)
    && /Reopen it/.test(item('cf_m1_0').close_reason) && /Closed: the day has passed/.test(item('cf_m1_0').history.at(-1).text), item('cf_m1_0'))
  ck('stays open: a day that ended only 1 day ago, a future day, no day', ['cf_m3_0', 'cf_m4_0', 'cf_m5_0'].every((id) => item(id).status === 'open'))
  ck('stays open: promise, could-not-read, incident, condition change, urgent', ['cfp_m6_0', 'cfu_m7_0', 'cf_m8_0', 'cf_m9_0', 'cf_m10_0'].every((id) => item(id).status === 'open'))
  ck('stays open: a card a person reopened', item('cf_m11_0').status === 'open')
  ck('stays open: a deadline on other work (money) whose day passed', item('cf_m14_0').status === 'open')
  ck('closes: client care with no rush is not care at risk', item('cf_m12_0').status === 'open' ? false : true, item('cf_m12_0'))
  ck('untouched: a done card and a person\'s card', item('cf_m13_0').status === 'done' && !item('cf_m13_0').resolution_code && item('ops_human').status === 'open')
  ck('only through call_card_patch, only the close fields', DB.patches.filter((p) => p.p_patch.resolution_code === 'day_passed').every((p) => Object.keys(p.p_patch).every((k) => ['status', 'closed_at', 'closed_by', 'resolution_code', 'close_reason', 'last_activity_at'].includes(k))))
  ck('nothing sent: no GoHighLevel, AxisCare or model call for the day rule', !CALLS.some((m) => m === 'POST') && AI.every((r) => r.tools[0].name !== 'submit_followups'), CALLS)
  ;[st, out] = await run(h)
  ck('a second run closes nothing more', out.day_passed_closed === 0, out)
} catch (e) { ck('ran without crashing', false, String(e && e.stack || e)) }
fs.rmSync(tmp, { recursive: true, force: true })
const failed = res.filter((r) => !r[1])
for (const [n, ok, note] of res) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n      ' + note}`)
console.log(`\n${res.length - failed.length}/${res.length} passed${failed.length ? ' · FAIL' : ' · ALL GREEN'}`)
process.exit(failed.length ? 1 : 0)
