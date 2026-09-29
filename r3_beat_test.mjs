// R3 · the nightly Family Circle sync leaves a heartbeat (committed runs only); the watchdog expects it but stays quiet
// before its first night. Real functions, fake database / AxisCare.
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const FN = 'supabase/functions'
let APP = {}, AXFAIL = false
const q = (t) => { const st = { f: [] }; const b = {
  select() { return b }, eq(c, v) { st.f.push([c, v]); return b }, in() { return b }, order() { return b }, limit() { return b }, is() { return b }, not() { return b }, range() { return b },
  insert() { return Promise.resolve({ data: null, error: null }) }, update() { return { eq: () => Promise.resolve({ data: null, error: null }) } },
  maybeSingle() { return b.then((x) => ({ data: (x.data || [])[0] ?? null, error: null })) }, single() { return b.maybeSingle() },
  then(ok) { if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok) }
    if (t === 'person_source_id') return Promise.resolve({ data: [{ person_id: 'p1', source_id: '501' }], error: null }).then(ok)
    if (t === 'person_identity') return Promise.resolve({ data: [{ id: 'p1', display_name: 'Ruth Test' }], error: null }).then(ok)
    return Promise.resolve({ data: [], error: null }).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) } return { data: null, error: null } } }
globalThis.fetch = async (url) => { url = String(url)
  if (url.includes('axiscare.com')) return AXFAIL ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ results: { clients: [{ id: 501, firstName: 'Ruth', lastName: 'Test', status: { active: true } }], responsibleParties: [] } }), { status: 200 })
  return new Response('{}', { status: 200 }) }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(40), AXISCARE_TOKEN: 'axc_x', AXISCARE_SITE: '16485', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'l' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'data:text/javascript,export const jobCaller=async()=>\\'cron\\';export const ownerCaller=async()=>false'") /* J1: these checks start where the schedule is let in; j1_job_locks_test.mjs tests the lock */
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) } return handler }
const call = async (h, qs) => { const r = await h(new Request('https://x/functions/v1/f?' + qs, { method: 'POST', body: '{}' })); return { s: r.status, j: await r.json().catch(() => null) } }
const beat = () => (APP.automation_heartbeats || []).find((x) => x.automation === 'circles-sync')
let ib = await load('identity-backfill')
APP = {}; await call(ib, 'circles=1')
ck('a practice run (no commit) leaves no heartbeat', !beat())
APP = {}; let r = await call(ib, 'circles=1&commit=1')
ck('a real run leaves a heartbeat: ok, "synced", counts only', r.s === 200 && beat() && beat().ok === true && beat().note === 'synced', [r, APP])
APP = {}; AXFAIL = true; r = await call(ib, 'circles=1&commit=1'); AXFAIL = false
ck('a run that fails still leaves a heartbeat, marked failed', beat() && beat().ok === false, APP)
let wd = await load('automation-watchdog')
APP = {}; r = await call(wd, 'dry=1')
ck('watchdog: before its first night, the sync is not reported as "never ran"', !JSON.stringify(r.j).includes('circles-sync has never'), r.j)
APP = { automation_heartbeats: [{ id: 'hb_circles-sync', automation: 'circles-sync', at: new Date(Date.now() - 40 * 3600e3).toISOString(), ok: true }] }; r = await call(wd, 'dry=1')
ck('watchdog: a sync that hasn\'t run for 40 hours is flagged', JSON.stringify(r.j).includes('circles-sync last ran'), r.j)
APP = { automation_heartbeats: [{ id: 'hb_circles-sync', automation: 'circles-sync', at: new Date().toISOString(), ok: false, note: 'AxisCare responded 500' }] }; r = await call(wd, 'dry=1')
ck('watchdog: a failed last run is flagged', JSON.stringify(r.j).includes('circles-sync is running but failing'), r.j)
APP = { automation_heartbeats: [{ id: 'hb_circles-sync', automation: 'circles-sync', at: new Date().toISOString(), ok: true }] }; r = await call(wd, 'dry=1')
ck('watchdog: a fresh good run raises nothing about it', !JSON.stringify(r.j).includes('circles-sync'), r.j)
for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
