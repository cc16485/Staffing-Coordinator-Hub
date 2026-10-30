// B · axis-health: one card per kind of AxisCare information that cannot be read, closing itself when reads work again,
// and the old "holding callouts" alarms closing once the caregiver list reads. The REAL function and its pure plan(),
// with a fake database. Made-up data only.   node axis_health_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const FN = 'supabase/functions'
const NOW = Date.parse('2026-10-29T19:30:00Z')            // 2:30 PM Central
const ago = (min) => new Date(NOW - min * 60000).toISOString()

/* load the real function with fakes (the same way the other job tests do) */
let APP, CONN, RPCS
const db = {
  from(t) { const f = {}; const b = { select() { return b }, eq(c, v) { f[c] = v; return b }, limit() { return b }, in() { return b },
    maybeSingle() { return Promise.resolve({ data: t === 'app_data' && f.key in APP ? { data: JSON.parse(JSON.stringify(APP[f.key])) } : null, error: null }) },
    then(ok) { return Promise.resolve({ data: [], error: null }).then(ok) } }; return b },
  async rpc(fn, a) { RPCS.push(fn)
    if (fn === 'axis_connection') return CONN ? { data: CONN, error: null } : { data: null, error: { message: 'down' } }
    if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) }
    return { data: null, error: null } },
}
const JOBSEC = 'j'.repeat(64)
const ENV = { HUB_JOB_SECRET: JOBSEC, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc_' + 'k'.repeat(60) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
globalThis.__dbFor = () => ({ from: () => { const bb = { select() { return bb }, limit() { return Promise.resolve({ data: null, error: { message: 'denied' } }) } }; return bb } })
fs.writeFileSync(`${FN}/_shared/_job-auth_ah.ts`, fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)'))
const src = fs.readFileSync(`${FN}/axis-health/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__axDb')
  .replace("'../_shared/job-auth.ts'", "'../_shared/_job-auth_ah.ts'")
const tmp = path.join(process.cwd(), FN, 'axis-health', '_t.ts'); fs.writeFileSync(tmp, src)
globalThis.__axDb = db
let H
try { H = await import(tmp) } finally { fs.unlinkSync(tmp); fs.unlinkSync(`${FN}/_shared/_job-auth_ah.ts`) }
const run = async (qs = '') => (await handler(new Request('https://x/fn' + qs, { method: 'POST', headers: { 'x-cron-secret': JOBSEC } }))).json()
const reset = (settings = {}) => { APP = { ops_settings: { coverage_alert_admins: ['sam@mo-care.com'], ...settings }, ops_items: [], automation_heartbeats: [] }; RPCS = [] }
const src_ = (o) => ({ calls: 0, failed: 0, r429: 0, held: 0, shared: 0, last_try_ok: true, last_ok_at: ago(2), ...o })

/* ── 1 · the rules ── */
ck('rule · down: tried in 15 min, all failed, last good read older than 15 min', H.stateOf(src_({ calls: 4, failed: 4, r429: 3, last_try_ok: false, last_ok_at: ago(40) }), NOW) === 'down')
ck('rule · down: never read well (no last good read)', H.stateOf(src_({ calls: 2, failed: 2, last_try_ok: false, last_ok_at: null }), NOW) === 'down')
ck('rule · down: only held back counts too', H.stateOf(src_({ calls: 0, held: 3, last_try_ok: false, last_ok_at: ago(20) }), NOW) === 'down')
ck('rule · one failure with a good read 3 minutes ago is not down', H.stateOf(src_({ calls: 3, failed: 1, last_try_ok: false, last_ok_at: ago(3) }), NOW) === 'quiet')
ck('rule · back: last try worked, good read in 15 min', H.stateOf(src_({ calls: 3 }), NOW) === 'back')
ck('rule · nothing tried and no recent read = quiet (says nothing, never "healthy")', H.stateOf(src_({ last_ok_at: ago(90) }), NOW) === 'quiet')
ck('rule · times read like a person writes them', H.when(ago(16), NOW) === '2:14 PM' && /^Oct 2[78], /.test(H.when(ago(60 * 30), NOW)))

/* ── 2 · one card per kind: a good caregiver read never hides failing visits ── */
const conn = { scheduling_current: false, sources: { caregivers: src_({ calls: 2 }), visits: src_({ calls: 5, failed: 5, r429: 4, last_try_ok: false, last_ok_at: ago(16), last_error: 'AxisCare answered 429' }) } }
let p = H.plan(conn, [], NOW, 'sam@mo-care.com')
ck('plan · visits down opens its own card, caregivers fine opens none', p.upsert.length === 1 && p.upsert[0].id === 'ops_axis_down_visits', p)
const c = p.upsert[0]
ck('plan · the card says since when, how many failed, how many were 429s, and what may be out of date',
  c.title === 'AxisCare: visit lists could not be read since 2:14 PM' && /since 2:14 PM/.test(c.detail) && /5 reads failed \(4 of them AxisCare saying "too many requests"\)/.test(c.detail)
  && /Shift, clock-in and coverage cards may be out of date/.test(c.detail) && /closes by itself/.test(c.detail) && c.urgency === 'high' && c.owner === 'sam@mo-care.com', c)
ck('plan · no em dashes in anything a person reads', !/[—–]/.test(c.title + c.detail))
p = H.plan(conn, [{ ...c }], NOW)
ck('plan · same state next run: no rewrite (no extra database writes)', p.upsert.length === 0 && p.close.length === 0)
const conn2 = { ...conn, sources: { ...conn.sources, visits: { ...conn.sources.visits, failed: 7, calls: 7 } } }
p = H.plan(conn2, [{ ...c, owner: 'kry@mo-care.com' }], NOW)
ck('plan · counts change: the card updates, keeps its owner and when it started', p.upsert.length === 1 && /7 reads failed/.test(p.upsert[0].detail) && p.upsert[0].owner === 'kry@mo-care.com' && p.upsert[0].down_since === c.down_since)
const back = { sources: { visits: src_({ calls: 2, last_ok_at: ago(1) }) } }
p = H.plan(back, [{ ...c }], NOW)
ck('plan · AxisCare reads again: the card closes itself and says from when to when', p.close.length === 1 && p.close[0].status === 'resolved' && p.close[0].resolved_how === 'axiscare_back'
  && /read again at 2:29 PM\. It could not be read from 2:14 PM to 2:29 PM\. Closed by itself\./.test(p.close[0].close_note), p.close[0])

/* ── 3 · the old holding alarms ── */
const alarm = (day, made) => ({ id: `ops_cov_censusdown_${day}`, status: 'open', created_at: made, title: 'Cara is HOLDING all callouts' })
p = H.plan({ sources: { caregivers: src_({ calls: 1, last_ok_at: ago(5) }) } }, [alarm('2026-10-27', '2026-10-27T09:00:06Z'), alarm('2026-10-29', ago(2))], NOW)
ck('alarm · closes once the caregiver list read after it was made, and says so', p.close.length === 1 && p.close[0].id === 'ops_cov_censusdown_2026-10-27'
  && /read the AxisCare caregiver list again at 2:25 PM, so callouts were no longer held/.test(p.close[0].close_note), p.close)
ck('alarm · one made after the last good read stays open (callouts still held)', p.report.some((r) => r.card === 'ops_cov_censusdown_2026-10-29' && r.state === 'still_held'))
p = H.plan({ sources: {} }, [alarm('2026-10-27', '2026-10-27T09:00:06Z')], NOW)
ck('alarm · no caregiver read logged yet: stays open', p.close.length === 0)

/* ── 4 · the job: switch off = practice, switch on = cards ── */
reset(); APP.ops_items = [alarm('2026-10-27', '2026-10-27T09:00:06Z')]
CONN = { scheduling_current: false, sources: { visits: conn.sources.visits, caregivers: src_({ calls: 1, last_ok_at: ago(5) }) } }
const realNow = Date.now; Date.now = () => NOW
let r = await run()
ck('off · practice: says what it would do, changes no card', r.mode === 'practice' && r.opened_or_updated.join() === 'ops_axis_down_visits' && r.closed.join() === 'ops_cov_censusdown_2026-10-27'
  && APP.ops_items.length === 1 && APP.ops_items[0].status === 'open', r)
ck('off · the heartbeat says scheduling is NOT current', /practice: 1 card\(s\) would open or update, 1 would close; scheduling NOT current/.test(APP.automation_heartbeats[0]?.note), APP.automation_heartbeats)
reset({ axis_failure_cards_live: true }); APP.ops_items = [alarm('2026-10-27', '2026-10-27T09:00:06Z')]
r = await run()
ck('on · opens the visits card and closes the stale alarm', r.mode === 'live' && APP.ops_items.find((i) => i.id === 'ops_axis_down_visits')?.status === 'open'
  && APP.ops_items.find((i) => i.id === 'ops_cov_censusdown_2026-10-27')?.status === 'resolved', APP.ops_items)
reset({ axis_failure_cards_live: true }); r = await run('?dry=1')
ck('on · ?dry=1 is always practice', r.mode === 'practice' && !APP.ops_items.length)
reset({ axis_failure_cards_live: true }); CONN = null
r = await run()
ck('the log cannot be read: says so on the heartbeat (not silent), changes nothing', r.ok === false && APP.automation_heartbeats[0]?.ok === false && !APP.ops_items.length)
r = await handler(new Request('https://x/fn', { method: 'POST' }))
ck('a stranger is refused', r.status === 401)
ck('nothing here calls AxisCare or sends a message', !/axiscare\.com|leadconnector|sendText|send-candidate|conversations\/messages/i.test(fs.readFileSync(`${FN}/axis-health/index.ts`, 'utf8')))
Date.now = realNow

const failed = res.filter((x) => !x[1])
for (const [n, okk, note] of res) console.log(`${okk ? 'PASS' : 'FAIL'}  ${n}${okk ? '' : '\n      ' + note}`)
console.log(failed.length ? `${failed.length} FAILED of ${res.length}` : `ALL PASSED (${res.length})`)
process.exit(failed.length ? 1 : 0)
