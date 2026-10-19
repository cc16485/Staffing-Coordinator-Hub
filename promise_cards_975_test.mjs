// 975 · Missed call promises become My Work cards (2026-10-18, item 6 of her 2026-10-14 plan). Under Node against the REAL
// call-tasks function and _shared/call-tasks.ts with a stand-in database, GoHighLevel and model. Made-up people only.
// Nothing is sent to anyone.
//   node promise_cards_975_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const F = 'supabase/functions'
const SERVICE = 'service'.repeat(6)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE, GHL_TOKEN: 'ghl-tok', GHL_LOCATION_ID: 'loc1', ANTHROPIC_API_KEY: 'sk-test', HUB_JOB_SECRET: 'j'.repeat(40) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_pc975_'))
const rewrite = (src) => src.replace(/^import \{ createClient \} from ['"]https:\/\/esm\.sh\/@supabase\/supabase-js@2['"];?$/m, 'const createClient = globalThis.__fakeCreateClient;')
  .replace(/^import Anthropic from ['"]npm:@anthropic-ai\/sdk['"];?$/m, 'const Anthropic = globalThis.__FakeAnthropic;')
fs.mkdirSync(path.join(tmp, '_shared'))
for (const f of fs.readdirSync(path.join(F, '_shared'))) fs.writeFileSync(path.join(tmp, '_shared', f), rewrite(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))

const NOW = Date.now(), H = (h) => new Date(NOW + h * 36e5).toISOString()
const day = (h) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(NOW + h * 36e5))
const DUE2 = day(-48), TODAY = day(0), DUE9 = day(-24 * 9)
let DB, AI, CALLS, FAIL_SAVE
let nid = 1
const pw = (message_id, o) => Object.assign({ id: nid++, message_id, idx: 0, version: 'v13-2026-10-12', channel: 'call', call_at: H(-24 * 3), person_id: null, lead_id: null,
  who_name: 'Ann Late', caller: 'Ann', what: 'Call Ann back about Tuesday', kind: 'we_agreed', area: 'scheduling', owner: { name: 'Angie Gone', via: 'old' }, due: DUE2,
  status: 'would_remind', why: 'Nothing with them since the promise: no call, text or card.', checks: 2, checked_at: null, last_activity_at: null, evidence: [], history: [{ at: H(-30), status: 'would_remind', why: 'late' }] }, o)
function reset(st) {
  nid = 1
  DB = {
    app_data: [{ key: 'ops_settings', data: Object.assign({ call_tasks_practice: true, call_tasks_texts: false, call_tasks_since: H(-24 * 13) }, st) },
      { key: 'ops_items', data: [
        { id: 'cf_me_0', kind: 'call_followup', status: 'open', created_by: 'call-tasks', about: 'Eve Same', title: 'Cancel Eve\'s Friday visit', created_at: H(-24 * 3), history: [{ at: H(-72), text: 'Made' }], source: { message_id: 'me' } },
        { id: 'cf_mc_0', kind: 'call_followup', status: 'done', created_by: 'call-tasks', about: 'Cal Closed', title: 'Cancel Cal\'s visit', created_at: H(-24 * 3), source: { message_id: 'mc' } },
        { id: 'cfp_mx_0', kind: 'call_followup', status: 'done', created_by: 'call-tasks', closed_by: 'Sam T', about: 'Xena Closed', title: 'Promise not kept yet: x', created_at: H(-24) },
        { id: 'cfp_pk_0', kind: 'call_followup', status: 'open', created_by: 'call-tasks', about: 'Kim Kept', title: 'Promise not kept yet: call Kim', created_at: H(-20), history: [] },
      ] },
      { key: 'coordinator_staff', data: [{ id: 1, name: 'Sam T', email: 'S@cc.test' }, { id: 2, name: 'Kris L', email: 'k@cc.test' }] }],
    domains: [{ code: 'scheduling_coverage', owner_person: 'p_s', active: true }, { code: 'program_administration', owner_person: 'p_s', active: true },
      { code: 'client_care', owner_person: 'p_a', backup_person: 'p_k', active: true }, { code: 'recruiting_orientation', owner_person: 'p_a', active: true },
      { code: 'money', owner_person: 'p_s', active: true }],
    persons: [{ person_id: 'p_s', full_name: 'Sam T', primary_email: 's@cc.test' }, { person_id: 'p_a', full_name: 'Angie Gone', primary_email: 'a@cc.test' },
      { person_id: 'p_k', full_name: 'Kris L', primary_email: 'k@cc.test' }],
    call_promise_watch: [
      pw('ma'),                                                                                          // Ann: a card, Sam (scheduling)
      pw('mb', { who_name: 'Bea Payer', what: 'Confirm the referral with the program', area: 'payer_programs' }),   // owner not on the team → backup Kris
      pw('mr', { who_name: 'Rae Recruit', what: 'Call Rae back about her interview', area: 'recruiting' }),       // no backup → Program Administration (Sam)
      pw('mv', { who_name: 'Val Evv', what: 'Text the EVV form to Val', area: 'evv_timekeeping' }),
      pw('mv2', { who_name: 'Vic Visit', what: 'Update EVV clock-in location for Vic\'s Friday visit', area: 'scheduling' }),
      pw('mi', { who_name: 'Ike If', what: 'Call the client if the caregiver reports he does not answer the door, then cancel the shift' }),
      pw('mk', { who_name: 'Ken Lead', what: 'Check whether a caregiver near Kimberling City is still active and call Ken back if there is a lead' }),   // "if" that is real work: a card
      pw('me', { who_name: 'Eve Same', what: 'Cancel Eve\'s Friday visit' }),                           // open card from the same call: a line on it
      pw('mc', { who_name: 'Cal Closed', what: 'Cancel Cal\'s visit' }),                                // same-call card closed by a person: nothing
      pw('mt', { who_name: 'Tia Today', due: TODAY }),                                                   // due today: not yet
      pw('m9', { who_name: 'Old Nine', due: DUE9, call_at: H(-24 * 10) }),                              // more than 7 days past due: never
      pw('mx', { who_name: 'Xena Closed' }),                                                             // its promise card a person closed: never again
      pw('mw', { who_name: 'Wes Waiting', status: 'waiting', due: day(48) }),                           // not due yet: nothing
      pw('mcv', { who_name: 'Cara Considering', kind: 'caller_considering' }),                           // not something the office owes
      pw('pk', { who_name: 'Kim Kept', what: 'Call Kim back about Monday', due: day(-30) }),             // its card is open and the office called: kept, the card closes
    ],
    call_task_reading: [], call_record: [], call_card_check: [], call_pull_seen: [], client_journey_step_def: [], person_source_id: [], writes: [], patches: [], beats: [],
  }
  AI = []; CALLS = []; FAIL_SAVE = false
}
const ops = () => DB.app_data.find((r) => r.key === 'ops_items').data
const item = (id) => ops().find((x) => x.id === id)
const row = (m) => DB.call_promise_watch.find((x) => x.message_id === m)
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
  /* the rules, on the real wording from the 51 late promises of 2026-10-18 */
  const sk = (what, area = 'scheduling', kind = 'we_agreed') => lib.promiseSkip({ what, area, kind })
  ck('skip: "only if something happens" promises never become cards',
    /only applies if/.test(sk('Call the client if the caregiver reports he does not answer the door, then cancel the shift'))
    && /only applies if/.test(sk('Call caregiver if not clocked out by 12:30 Friday, possibly extend to 13:30'))
    && /only applies if/.test(sk('Check back with the household if a clock-out is missing or looks wrong')))
  ck('skip: real work that says "if" still becomes a card',
    sk('Check whether a caregiver near Kimberling City is still active and call Allen back if there is a lead') === ''
    && sk('Look for a caregiver for Wanda\'s Thursdays (weekly or alternate) and tell Lacey if filled') === ''
    && sk('Add Susan to the schedule once Donnie confirms and she is in the app') === '')
  ck('skip: EVV work is retired (by area or by wording)', /EVV/.test(sk('Text the EVV form to Gina Wise', 'evv_timekeeping'))
    && /EVV/.test(sk('Update EVV clock-in location for Emily Stevens\' Friday visit to the rehab facility', 'scheduling'))
    && /EVV/.test(sk('Correct Friday\'s time in the system once the form is received', 'scheduling')))
  ck('skip: only the office\'s own promises', sk('x', 'scheduling', 'caller_considering') !== '' && sk('x', 'scheduling', 'caller_will') !== '' && sk('x', 'scheduling', 'awaiting_confirmation') === '')
  const ct = (iso) => Date.parse(iso)
  ck('time: not on the due day, not before 8 am the next morning, yes at 8 am', !lib.promiseCardTime('2026-10-20', ct('2026-10-20T22:00:00Z'))
    && !lib.promiseCardTime('2026-10-20', ct('2026-10-21T12:59:00Z')) && lib.promiseCardTime('2026-10-20', ct('2026-10-21T13:00:00Z')))
  ck('time: in winter time too (8 am CST = 14:00Z)', !lib.promiseCardTime('2026-12-01', ct('2026-12-02T13:30:00Z')) && lib.promiseCardTime('2026-12-01', ct('2026-12-02T14:00:00Z')))
  ck('time: any hour two days after; never more than 7 days after; never a bad date', lib.promiseCardTime('2026-10-20', ct('2026-10-22T06:00:00Z'))
    && lib.promiseCardTime('2026-10-20', ct('2026-10-27T15:00:00Z')) && !lib.promiseCardTime('2026-10-20', ct('2026-10-28T15:00:00Z')) && !lib.promiseCardTime('', NOW))
  const team = [{ name: 'Sam T', email: 's@cc.test' }, { name: 'Kris L', email: 'k@cc.test' }]
  const doms = { scheduling_coverage: 'Sam T', program_administration: 'Sam T', client_care: 'Angie Gone', recruiting_orientation: 'Angie Gone' }
  ck('owner: the area owner when on the team; the Staffing seat for scheduling', lib.promiseOwner('scheduling', { domains: doms, staffing: 'Kris L', team })?.email === 'k@cc.test'
    && lib.promiseOwner('scheduling', { domains: doms, team })?.name === 'Sam T')
  ck('owner: not on the team (not hired yet) → the backup', lib.promiseOwner('payer_programs', { domains: doms, backups: { client_care: 'Kris L' }, team })?.name === 'Kris L')
  ck('owner: no backup → Program Administration owner, saying why', /nobody on the team owns/.test(lib.promiseOwner('recruiting', { domains: doms, team })?.via || ''))
  ck('owner: nobody on the team at all → unassigned', lib.promiseOwner('recruiting', { domains: { recruiting_orientation: 'Angie Gone' }, team }) === null)
  const c = lib.promiseCard({ id: 7, message_id: 'sms:abc-1', idx: 2, channel: 'text', call_at: H(-48), who_name: 'Ann Late', what: 'Call Ann back.', kind: 'we_agreed', area: 'scheduling', due: DUE2, why: 'Nothing since.' }, { email: 's@cc.test', name: 'Sam T', via: 'owns scheduling' }, NOW)
  ck('card: one id per promise, a call card in Work, owned, due today, says what was promised', c.id === 'cfp_smsabc1_2' && c.kind === 'call_followup' && c.domain === 'scheduling_coverage'
    && c.owner === 's@cc.test' && c.urgency === 'today' && c.title === 'Promise not kept yet: Call Ann back' && /In texts with Ann Late/.test(c.detail) && /due/.test(c.detail) && c.source.type === 'call_promise', c)
  ck('card: no em dash anywhere', !/[—―]/.test(JSON.stringify(c) + JSON.stringify(lib.promiseCard({ kind: 'awaiting_confirmation', message_id: 'm', idx: 0, call_at: H(-1), due: DUE2 }, null, NOW))))

  const h = await load('call-tasks')
  /* ── practice (the switch off): counted and noted once, no card anywhere ── */
  reset({})
  const before = JSON.stringify(ops())
  let [st, out] = await run(h)
  ck('practice: the run is fine and says practice', st === 200 && out.promise_cards_mode === 'practice', out)
  ck('practice: no card made or changed', JSON.stringify(ops()) === before && !DB.writes.includes('ops_items'), DB.writes)
  ck('practice: counts what it would do (Ann, Bea, Rae, Ken, plus a line on Eve\'s card)', out.promise_cards_would === 5 && out.promise_cards === 0, out)
  ck('practice: each promise says what would happen, in its history', /would make a My Work card for Sam T/.test(JSON.stringify(row('ma').history)) && /would add this to the open card cf_me_0/.test(JSON.stringify(row('me').history)))
  ck('practice: skipped ones say why (EVV, only-if, same-call card closed)', /EVV/.test(JSON.stringify(row('mv').history)) && /EVV/.test(JSON.stringify(row('mv2').history))
    && /only applies if/.test(JSON.stringify(row('mi').history)) && /already closed/.test(JSON.stringify(row('mc').history)), [row('mv').history, row('mi').history])
  const n0 = JSON.stringify(DB.call_promise_watch.map((x) => x.history))
  ;[st, out] = await run(h)
  ck('practice: Kim\'s kept promise does not close her card (practice never touches Work)', item('cfp_pk_0').status === 'open' && out.promise_cards_closed === 0)
  ck('practice: a second run notes nothing twice', JSON.stringify(DB.call_promise_watch.map((x) => x.history)) === n0)

  /* ── live ── */
  reset({ call_promise_cards_live: true, call_tasks_live: true, call_cards_practice: true })
  ;[st, out] = await run(h)
  ck('live: the run is fine and counts cards', st === 200 && out.promise_cards_mode === 'live' && out.promise_cards === 4 && out.promise_cards_added === 1, out)
  ck('live: Ann gets a card owned by Sam (owner worked out again; the old Angie owner is ignored)', item('cfp_ma_0')?.owner === 's@cc.test' && item('cfp_ma_0')?.status === 'open', item('cfp_ma_0'))
  ck('live: Bea\'s owner is not on the team, so the backup Kris has it', item('cfp_mb_0')?.owner === 'k@cc.test' && /backs up client care/.test(JSON.stringify(item('cfp_mb_0').history)), item('cfp_mb_0'))
  ck('live: Rae (no backup) goes to the Program Administration owner', item('cfp_mr_0')?.owner_name === 'Sam T', item('cfp_mr_0'))
  ck('live: Ken\'s "if there is a lead" is real work and gets a card', !!item('cfp_mk_0'))
  ck('live: Eve gets one line on the open card from the same call, not a second card', !item('cfp_me_0') && item('cf_me_0').history.filter((x) => x.ref === 'promise:cfp_me_0').length === 1, item('cf_me_0'))
  ck('live: no card for EVV, only-if, closed same-call card, due today, 9 days late, not late, or the caller\'s own plan',
    ['mv', 'mv2', 'mi', 'mc', 'mt', 'm9', 'mw', 'mcv'].every((m) => !item('cfp_' + m + '_0')))
  ck('live: a promise card a person closed is never made again', item('cfp_mx_0').status === 'done' && ops().filter((x) => x.id === 'cfp_mx_0').length === 1)
  ck('live: Kim\'s promise was kept (office called), so her card closed with the reason', item('cfp_pk_0').status === 'done' && item('cfp_pk_0').resolution_code === 'promise_kept'
    && /The promise was kept/.test(item('cfp_pk_0').close_reason) && row('pk').status === 'kept_late' && out.promise_cards_closed === 1, [item('cfp_pk_0'), row('pk')])
  ck('live: each promise that got a card says so', /My Work card cfp_ma_0 made for Sam T/.test(JSON.stringify(row('ma').history)) && /added to the open card cf_me_0/.test(JSON.stringify(row('me').history)))
  ck('live: the card check leaves promise cards alone (the promise watch closes them)', !DB.call_card_check.some((x) => String(x.card_id).startsWith('cfp_')), DB.call_card_check.map((x) => x.card_id))
  ck('live: only the allowed fields are ever patched', DB.patches.every((p) => Object.keys(p.p_patch).every((k) => PATCH_OK.includes(k))))
  ck('live: nothing is sent to anyone (every outside request is a read)', CALLS.every((m) => m === 'GET'), [...new Set(CALLS)])
  ck('live: the heartbeat is fine', DB.beats.slice(-1)[0]?.ok === true, DB.beats.slice(-1)[0])
  const count = ops().length
  ;[st, out] = await run(h)
  ck('live: a second run makes nothing again and adds no second line', ops().length === count && out.promise_cards === 0 && out.promise_cards_added === 0
    && item('cf_me_0').history.filter((x) => x.ref === 'promise:cfp_me_0').length === 1, out)

  /* ── a card that cannot be saved is never quiet ── */
  reset({ call_promise_cards_live: true })
  FAIL_SAVE = true
  ;[st, out] = await run(h)
  ck('save fails: no card, and the heartbeat fails so the watchdog tells the office', !item('cfp_ma_0') && DB.beats.slice(-1)[0]?.ok === false && out.promise_errors > 0, [out, DB.beats.slice(-1)[0]])
  ck('save fails: the promise is not marked as carded, so the next run tries again', !/My Work card/.test(JSON.stringify(row('ma').history)))
} catch (e) { ck('the run did not crash', false, String(e?.stack || e)) }
finally { fs.rmSync(tmp, { recursive: true, force: true }) }
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n      ' + note : ''))
const passed = res.filter((r) => r[1]).length
console.log(`\n${passed}/${res.length} passed · ${passed === res.length ? 'ALL GREEN' : 'FAIL'}`)
process.exit(passed === res.length ? 0 : 1)
