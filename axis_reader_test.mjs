// A · the shared AxisCare reader (_shared/axis-reader.ts). The REAL reader against a fake AxisCare and a fake database whose
// gate copies axis_reader_A.sql (window limit, urgent reserve, AxisCare's wait after a 429). Made-up data only.
// node axis_reader_test.mjs
import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const R = await import(path.join(process.cwd(), 'supabase/functions/_shared/axis-reader.ts'))

/* ── a controllable clock for copy ages (sleeps stay real and short) ── */
let SHIFT = 0; const realNow = Date.now.bind(Date); Date.now = () => realNow() + SHIFT

/* ── the fake database ── */
let DB
const fresh = (settings = {}) => {
  DB = { settings: { axis_shared_reader_live: true, ...settings }, log: [], cache: {}, gate: { window_start: 0, used: 0, backoff_until: 0, n429: 0 },
    win: 1000, max: 3, reserve: 1, gateDown: false, rpcCalls: [] }
  R.__axisReset(); SHIFT = 0
}
const gateTake = (pr) => {
  const g = DB.gate, t = Date.now()
  if (g.backoff_until > t) return { ok: false, wait_ms: g.backoff_until - t, why: 'axiscare_asked_to_wait' }
  if (!g.window_start || t >= g.window_start + DB.win) { g.window_start = t; g.used = 0 }
  const cap = pr === 'urgent' ? DB.max : pr === 'low' ? Math.max(1, Math.floor((DB.max - DB.reserve) / 2)) : Math.max(1, DB.max - DB.reserve)
  if (g.used >= cap) return { ok: false, wait_ms: Math.max(50, g.window_start + DB.win - t), why: 'hub_limit' }
  g.used++; return { ok: true }
}
const gateReport = (st, ra) => {
  const g = DB.gate
  if (st === 429) { g.n429++; const w = ra > 0 ? Math.min(ra, 900) : Math.min(60, 2 * 2 ** (g.n429 - 1)); g.backoff_until = Math.max(g.backoff_until, Date.now() + w * 1000) }
  else if (st >= 200 && st < 400) g.n429 = 0
  return { wait_s: 0 }
}
const db = {
  from(t) { const f = {}; const b = {
    select() { return b }, eq(c, v) { f[c] = v; return b },
    insert(row) { if (t === 'axis_read_log') DB.log.push({ ...row, at: Date.now() }); return Promise.resolve({ error: null }) },
    maybeSingle() {
      if (t === 'app_data') return Promise.resolve({ data: f.key === 'ops_settings' ? { data: DB.settings } : null, error: null })
      if (t === 'axis_cache') { const c = DB.cache[f.key]; return Promise.resolve({ data: c && c.body != null ? { body: c.body, status: c.status, fetched_at: new Date(c.fetched_at).toISOString() } : null, error: null }) }
      return Promise.resolve({ data: null, error: null })
    } }; return b },
  async rpc(fn, a) {
    DB.rpcCalls.push(fn)
    if (fn.startsWith('axis_gate') && DB.gateDown) throw new Error('database busy')
    if (fn === 'axis_gate_take') return { data: gateTake(a.p_priority), error: null }
    if (fn === 'axis_gate_report') return { data: gateReport(a.p_status, a.p_retry_after_s), error: null }
    if (fn === 'axis_cache_lease') { const c = (DB.cache[a.p_key] ||= {}); if (!c.lease_until || c.lease_until < Date.now() || c.lease_owner === a.p_owner) { c.lease_owner = a.p_owner; c.lease_until = Date.now() + a.p_ttl_s * 1000; return { data: true } } return { data: false } }
    if (fn === 'axis_cache_put') { DB.cache[a.p_key] = { body: a.p_body, status: a.p_status, fetched_at: Date.now() }; return { data: null } }
    if (fn === 'axis_cache_release') { const c = DB.cache[a.p_key]; if (c && c.lease_owner === a.p_owner) { c.lease_owner = null; c.lease_until = 0 } return { data: null } }
    return { data: null }
  },
}

/* ── the fake AxisCare: a queue of answers per URL path, otherwise 200 with one visit ── */
let CALLS, PLAN
const ax = (p) => `https://16485.axiscare.com${p}`
const ok = (obj = { results: { visits: [{ id: 's=1:d=2026-10-29' }], nextPage: null } }) => () => new Response(JSON.stringify(obj), { status: 200 })
const st = (s, h = {}, body = '{"error":"x"}') => () => new Response(body, { status: s, headers: h })
globalThis.fetch = async (u, init) => {
  u = String(u); CALLS.push({ u, method: init?.method || 'GET', at: Date.now() })
  if (!u.includes('axiscare.com')) return new Response('{"other":true}', { status: 200 })
  await new Promise((r) => setTimeout(r, 20))
  const k = u.replace(/^https:\/\/[^/]+/, ''); const q = PLAN[k]
  const f = q && q.length ? q.shift() : ok(); if (f === 'throw') throw new TypeError('network down'); return f()
}
const go = () => { CALLS = []; PLAN = {} }
const today = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
const V = `/api/visits?startDate=${today}&endDate=2099-12-31`
const reader = (tier, job = 'test', extra = {}) => R.axisReader(db, { job, tier, ...extra })

/* ── 0 · the small rules ── */
ck('rule · what a URL reads', R.sourceOf(ax('/api/visits?startDate=1')) === 'visits' && R.sourceOf(ax('/api/visits/s=1:d=2')) === 'visit'
  && R.sourceOf(ax('/api/visits/modification-reasons')) === 'reasons' && R.sourceOf(ax('/api/caregivers')) === 'caregivers'
  && R.sourceOf(ax('/api/clients/9')) === 'clients' && R.sourceOf(ax('/api/schedules?x=1')) === 'schedules')
ck('rule · fresh (Cara) never uses a copy for visits, schedules, caregivers; clients 15 min, reasons 60 min',
  R.maxAgeMs('fresh', ax(V)) === 0 && R.maxAgeMs('fresh', ax('/api/schedules?a=1')) === 0 && R.maxAgeMs('fresh', ax('/api/caregivers')) === 0
  && R.maxAgeMs('fresh', ax('/api/visits/s=1:d=2')) === 0 && R.maxAgeMs('fresh', ax('/api/clients/1')) === 900000 && R.maxAgeMs('fresh', ax('/api/visits/modification-reasons')) === 3600000)
ck('rule · live: visits 60 s; display: today 2 min, past days 10 min, caregiver list 15 min',
  R.maxAgeMs('live', ax(V)) === 60000 && R.maxAgeMs('display', ax(V)) === 120000
  && R.maxAgeMs('display', ax('/api/visits?startDate=2026-01-01&endDate=2026-01-02')) === 600000 && R.maxAgeMs('display', ax('/api/caregivers')) === 900000)
ck('rule · Retry-After as seconds or a date', R.retryAfterS('7') === 7 && R.retryAfterS('') === null && R.retryAfterS('soon') === null
  && R.retryAfterS(new Date(realNow() + 30000).toUTCString(), realNow()) >= 29)

/* ── 1 · switch off = exactly as before (rollback) ── */
fresh({ axis_shared_reader_live: false }); go()
PLAN[V] = [st(429, { 'retry-after': '5' })]
let r = await reader('fresh')(ax(V))
ck('off · a 429 comes straight back, no retry, no gate, no copy', r.status === 429 && CALLS.length === 1 && !DB.rpcCalls.some((f) => f.startsWith('axis_')) && !Object.keys(DB.cache).length)
ck('off · but it is counted (job, source, status, Retry-After, live=false)', DB.log.length === 1 && DB.log[0].job === 'test' && DB.log[0].source === 'visits' && DB.log[0].status === 429 && DB.log[0].retry_after_s === 5 && DB.log[0].live === false, DB.log)
go(); await reader('display')(ax(V)); await reader('display')(ax(V))
ck('off · no copies: two reads are two calls', CALLS.length === 2)
go(); PLAN[V] = ['throw']; let threw = false
try { await reader('display')(ax(V)) } catch { threw = true }
ck('off · no answer still throws as before, and is counted', threw && DB.log.at(-1).status === null && /network down/.test(DB.log.at(-1).error))
go(); r = await reader('display')('https://example.com/x')
ck('off and on · non-AxisCare calls pass straight through, not counted', r.status === 200 && DB.log.length === 4)

/* ── 2 · retry rules ── */
fresh(); go()
PLAN[V] = [st(429, { 'retry-after': '1' }), ok()]
let t0 = Date.now(); r = await reader('fresh')(ax(V))
ck('429 · waits as long as AxisCare asks, then tries again (urgent)', r.status === 200 && CALLS.length === 2 && CALLS[1].at - CALLS[0].at >= 950, CALLS.map((c) => c.at - t0))
ck('429 · both calls are in the log, with the Retry-After', DB.log.filter((l) => !l.from_cache).map((l) => `${l.status}:${l.attempt}`).join() === '429:1,200:2' && DB.log[0].retry_after_s === 1, DB.log)
fresh(); go(); PLAN[V] = [st(429, { 'retry-after': '1' })]
r = await reader('display')(ax(V))
go(); r = await reader('display', 'cj', { budgetMs: 300 })(ax('/api/visits?startDate=2026-01-05&endDate=2026-01-05'))
ck('429 · while AxisCare says wait, nobody calls: a low-priority read is held, not sent', r.status === 429 && r.headers.get('x-axis-hub-held') === '1' && CALLS.length === 0 && DB.log.at(-1).held === true, DB.log.at(-1))
ck('429 · held answer says why in words', /AxisCare asked the Hub to wait/.test(await r.text()))
await new Promise((ok_) => setTimeout(ok_, 1100))
fresh(); go(); PLAN[V] = [st(429), st(429), st(429)]; DB.gate.n429 = 0
r = await reader('fresh', 'cr', { budgetMs: 4000 })(ax(V))
ck('429 · no Retry-After: 2 s, then 4 s ...; when the wait is longer than the run allows, the 429 goes back to the job', r.status === 429 && CALLS.length === 2, CALLS.length)
fresh(); go(); PLAN[V] = [st(503), ok()]
r = await reader('live')(ax(V))
ck('5xx · one more try after a short pause', r.status === 200 && CALLS.length === 2)
fresh(); go(); PLAN[V] = [st(404)]
r = await reader('fresh')(ax(V))
ck('4xx (not 429) · never retried', r.status === 404 && CALLS.length === 1)
fresh(); go(); PLAN[V] = ['throw', ok()]
r = await reader('live')(ax(V))
ck('no answer · tried again, then fine', r.status === 200 && CALLS.length === 2 && DB.log[0].status === null)

/* ── 3 · partial or broken answers ── */
fresh(); go(); PLAN[V] = [() => new Response('{"results":{"visits":[{"id":1},', { status: 200 }), () => new Response('{"results":{"visits":[', { status: 200 })]
r = await reader('live')(ax(V))
ck('partial · a cut-off 200 is a failed read (502), never an empty list', r.status === 502 && /could not read/.test(await r.text()) && CALLS.length === 2)
ck('partial · not kept as a copy', !DB.cache[V]?.body)
ck('partial · logged as a failure', DB.log.filter((l) => !l.ok).length === 2 && DB.log.every((l) => /cut off/.test(l.error || '')))

/* ── 4 · the global limit and urgent first ── */
fresh(); go(); DB.max = 3; DB.reserve = 1; DB.win = 600
const urls = [1, 2, 3].map((i) => ax(`/api/visits/s=${i}:d=2026-10-29`))
t0 = Date.now()
await Promise.all(urls.map((u) => reader('live', 'tk')(u)))
const late = CALLS.filter((c) => c.at - t0 >= 500).length
ck('limit · normal reads leave the urgent reserve free: 2 now, the 3rd waits for the next window', CALLS.length === 3 && late === 1, CALLS.map((c) => c.at - t0))
fresh(); go(); DB.max = 3; DB.reserve = 1; DB.win = 600
await Promise.all([reader('live')(ax('/api/visits/s=1:d=1')), reader('live')(ax('/api/visits/s=2:d=1'))])
t0 = Date.now(); await reader('fresh', 'coverage-run')(ax('/api/visits/s=9:d=1'))
ck('limit · urgent (Cara) still goes when normal reads have filled their share', Date.now() - t0 < 300 && CALLS.length === 3)
fresh(); go(); DB.max = 1; DB.reserve = 0; DB.win = 5000
await reader('display')(ax('/api/visits/s=1:d=1'))
r = await reader('display', 'cj', { budgetMs: 300 })(ax('/api/visits/s=2:d=1'))
ck('limit · a read that would wait past its run budget is held and says so', r.status === 429 && /limit was full/.test(await r.text()) && CALLS.length === 1)
fresh(); go(); DB.gateDown = true
r = await reader('fresh')(ax(V))
ck('limit · if the database cannot be asked, the read still goes (a hiccup never blocks AxisCare)', r.status === 200 && CALLS.length === 1)

/* ── 5 · copies and combining ── */
fresh(); go()
await reader('display', 'cj')(ax(V)); r = await reader('display', 'cj')(ax(V))
ck('copy · display: the second read within 2 min is a copy, no AxisCare call', CALLS.length === 1 && r.status === 200 && DB.log.at(-1).from_cache === true)
SHIFT = 121000; await reader('display', 'cj')(ax(V)); globalThis.__dbg = DB.log.slice(-2)
ck('copy · after 2 min it expires and AxisCare is asked again', CALLS.length === 2, globalThis.__dbg)
fresh(); go()
await reader('fresh', 'coverage-run')(ax(V)); await reader('fresh', 'coverage-run')(ax(V))
ck('copy · Cara (fresh) never gets a copy of visits: two reads, two calls', CALLS.length === 2)
go(); await reader('fresh')(ax('/api/clients/7')); await reader('fresh')(ax('/api/clients/7'))
ck('copy · a client record is shared even for Cara (not schedule information)', CALLS.length === 1)
fresh(); go()
await reader('live', 'tk')(ax(V)); SHIFT = 61000; await reader('live', 'tk')(ax(V))
ck('copy · live: older than 60 s is never used', CALLS.length === 2)
fresh(); go()
await reader('display', 'job-a')(ax(V)); R.__axisReset(); r = await reader('display', 'job-b')(ax(V))
ck('copy · another job (another server instance) uses the shared copy', CALLS.length === 1 && DB.log.at(-1).job === 'job-b' && DB.log.at(-1).from_cache === true)
fresh(); go()
await Promise.all([1, 2, 3].map(() => reader('display')(ax(V))))
ck('combine · three identical reads at once make one call', CALLS.length === 1 && DB.log.filter((l) => l.coalesced).length === 2)
fresh(); go()
await Promise.all([reader('fresh', 'coverage-run')(ax(V)), reader('fresh', 'coverage-watch')(ax(V))])
ck('combine · Cara\'s identical reads started together share one call (seconds apart, still fresh)', CALLS.length === 1)
fresh(); go(); DB.cache[V] = { lease_owner: 'someone-else', lease_until: Date.now() + 10000 }
setTimeout(() => { DB.cache[V] = { body: JSON.stringify({ results: { visits: [{ id: 'theirs' }] } }), status: 200, fetched_at: Date.now() } }, 600)
r = await reader('display')(ax(V))
ck('combine · across jobs: waits for the job already reading it and uses its answer', CALLS.length === 0 && /theirs/.test(await r.text()) && DB.log.at(-1).coalesced === true)
fresh(); go(); PLAN[V] = [st(500), st(500)]
r = await reader('display', 'cj', { priority: 'normal' })(ax(V))
ck('copy · a failed read is never kept, and its claim is given back', r.status === 500 && !DB.cache[V]?.body && !DB.cache[V]?.lease_owner, DB.cache[V])

/* ── 6 · writes ── */
fresh(); go(); PLAN['/api/visits/s=1:d=1'] = [st(500)]
r = await reader('fresh')(ax('/api/visits/s=1:d=1'), { method: 'PATCH', body: '{}' })
ck('write · never retried, never copied, still counted', r.status === 500 && CALLS.length === 1 && DB.log.at(-1).method === 'PATCH' && !Object.values(DB.cache).some((c) => c.body))

/* ── 7 · rollback: switch turned off while running ── */
fresh(); go(); await reader('display')(ax(V))
DB.settings.axis_shared_reader_live = false; SHIFT = 61000; go()
await reader('display')(ax(V)); await reader('display')(ax(V))
ck('rollback · within a minute of the switch going off, reads are plain again (no copies, no gate)', CALLS.length === 2 && DB.log.at(-1).live === false)

const failed = res.filter((x) => !x[1])
for (const [n, okk, note] of res) console.log(`${okk ? 'PASS' : 'FAIL'}  ${n}${okk ? '' : '\n      ' + note}`)
console.log(failed.length ? `${failed.length} FAILED of ${res.length}` : `ALL PASSED (${res.length})`)
process.exit(failed.length ? 1 : 0)
