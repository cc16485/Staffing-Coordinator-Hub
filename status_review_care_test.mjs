// The AxisCare status review and PAST clients (2026-10-07, her proof 4): a past client AxisCare shows Active again gets ONE
// card saying we served them before (with their last episode) and nothing starts by itself; any other change for a past or
// deceased client opens nothing; a current client's change opens a card for HIS Care Coordinator. The nightly client sync
// never makes a past client active again. The REAL client-status-review and identity-backfill against fakes.
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
let T, RPC
const uid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16))
const today = new Date().toISOString()
const reset = () => { RPC = []; T = {
  app_data: [{ key: 'ops_settings', data: { client_status_live: true } }, { key: 'ops_items', data: [] }, { key: 'automation_log', data: [] },
    { key: 'client_status_log', data: [{ id: 'latest', map: { '296': 'Inactive', '410': 'Active', '411': 'Active', '412': 'Deceased' } },
      { id: 'tr_cur', axiscare_client_id: '296', old_status_label: 'Active', new_status_label: 'Inactive', observed_at: today },
      { id: 'tr_back', axiscare_client_id: '410', old_status_label: 'Inactive', new_status_label: 'Active', observed_at: today },
      { id: 'tr_dead_back', axiscare_client_id: '411', old_status_label: 'Deceased', new_status_label: 'Active', observed_at: today },
      { id: 'tr_past_dec', axiscare_client_id: '412', old_status_label: 'Inactive', new_status_label: 'Deceased', observed_at: today }] }],
  client_status_review: [],
  person_source_id: [['p-ed', '296'], ['p-old', '410'], ['p-gone', '411'], ['p-past2', '412']].map(([person_id, source_id]) => ({ person_id, source_id, system: 'axiscare', entity_type: 'client' })),
  person_role: [{ person_id: 'p-ed', role: 'client', status: 'active' }, { person_id: 'p-old', role: 'client', status: 'former', ended_at: '2025-03-01', end_reason: 'Moved out of our service area' },
    { person_id: 'p-gone', role: 'client', status: 'former', ended_at: '2026-01-02', end_reason: 'deceased' }, { person_id: 'p-past2', role: 'client', status: 'former', ended_at: '2024-06-01', end_reason: 'Inactive in AxisCare' }],
  person_identity: [{ id: 'p-ed', display_name: 'Edward Anderson' }, { id: 'p-old', display_name: 'Olive Past' }, { id: 'p-gone', display_name: 'Gil Gone' }, { id: 'p-past2', display_name: 'Pat Pastwo' }],
  persons: [{ person_id: 'p-sam', primary_email: 'sam@mo-care.com' }], domains: [{ code: 'client_care', owner_person: 'p-sam', entity: 'cc_ihs' }],
  client_journey: [{ axiscare_client_id: '296', assigned_cc: 'krystal@mo-care.com', created_at: '2026-10-01' }],
  journey_episode: [] } }
const clone = (x) => JSON.parse(JSON.stringify(x))
function q(t) {
  const st = { f: [], op: 'select', patch: null, row: null, single: false }
  const match = (r) => st.f.every(([k, v, how]) => how === 'in' ? v.map(String).includes(String(r[k])) : how === 'neq' ? r[k] !== v : how === 'notnull' ? r[k] != null : String(r[k]) === String(v))
  const run = () => { T[t] = T[t] || []
    if (st.op === 'insert') { const rows = (Array.isArray(st.row) ? st.row : [st.row]).map((r) => ({ ...r })); T[t].push(...rows); return { data: st.single ? rows[0] : rows, error: null } }
    if (st.op === 'update') { T[t].filter(match).forEach((r) => Object.assign(r, st.patch)); return { data: null, error: null } }
    const rows = T[t].filter(match); return { data: st.single ? (rows[0] ? clone(rows[0]) : null) : clone(rows), error: null } }
  const b = { select() { return b }, eq(k, v) { st.f.push([k, v]); return b }, neq(k, v) { st.f.push([k, v, 'neq']); return b }, in(k, v) { st.f.push([k, v, 'in']); return b }, not(k) { st.f.push([k, null, 'notnull']); return b },
    order() { return b }, limit() { return b }, insert(r) { st.op = 'insert'; st.row = r; return b }, update(p) { st.op = 'update'; st.patch = p; return b },
    single() { st.single = true; return Promise.resolve(run()) }, maybeSingle() { st.single = true; return Promise.resolve(run()) }, then(ok, ko) { return Promise.resolve(run()).then(ok, ko) } }
  return b
}
globalThis.__db = { from: q, rpc: async (fn, a) => { RPC.push(fn)
  if (fn === 'client_status_current_refresh') return { data: { rows: 4 }, error: null }
  if (fn === 'client_status_review_open') { const t = a.p_transition; const pid = T.person_source_id.find((x) => x.source_id === String(t.axiscare_client_id)).person_id
    T.client_status_review.push({ review_id: uid(), transition_ref: t.id, axiscare_client_id: String(t.axiscare_client_id), person_id: pid, old_label: t.old_status_label, new_label: t.new_status_label, observed_at: t.observed_at, status: 'open' })
    return { data: { outcome: 'opened' }, error: null } }
  if (fn === 'upsert_app_data_item') { const row = T.app_data.find((r) => r.key === a.target_key); const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = clone(a.item); else row.data.push(clone(a.item)); return { data: null, error: null } }
  return { data: null, error: null } } }
globalThis.fetch = async (u) => new Response(JSON.stringify(String(u).includes('client-admission-scan') ? { active: 2, unlinked: 0, results: [] } : {}), { status: 200 })
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', HUB_JOB_SECRET: 'j'.repeat(40) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_sr_'))
try {
  fs.writeFileSync(path.join(tmp, 'job-auth.ts'), "export async function jobCaller(req){ return req.headers.get('x-cron-secret') === '" + ENV.HUB_JOB_SECRET + "' ? 'cron' : null }")
  fs.writeFileSync(path.join(tmp, 'staff-auth.ts'), "export const OFFICE_ROLES = []; export async function requireStaff(){ return { ok: false, status: 401, error: 'no' } }")
  const src = fs.readFileSync(path.join(F, 'client-status-review/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace("'../_shared/job-auth.ts'", "'" + path.join(tmp, 'job-auth.ts') + "'").replace("'../_shared/staff-auth.ts'", "'" + path.join(tmp, 'staff-auth.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'sr.ts'), src); const SR = await import(path.join(tmp, 'sr.ts'))
  reset()
  const r = await handler(new Request('https://x', { method: 'POST', headers: { 'x-cron-secret': ENV.HUB_JOB_SECRET }, body: JSON.stringify({ action: 'run' }) })); const j = await r.json()
  const items = T.app_data.find((x) => x.key === 'ops_items').data
  const byAx = (ax) => items.find((x) => x.axiscare_client_id === ax)
  ck('a current client turned Inactive in AxisCare: ONE review card, for HIS Care Coordinator (Krystal); nothing ends by itself', byAx('296') && byAx('296').owner === 'krystal@mo-care.com' && T.person_role.find((x) => x.person_id === 'p-ed').status === 'active' && !RPC.includes('client_status_decide'), [byAx('296'), RPC])
  ck('4 · a PAST client AxisCare shows Active again: ONE card, "We served Olive Past before… resume care?", with her last episode', byAx('410') && /^We served Olive Past before.*resume care\?$/.test(byAx('410').title) && !/episode/i.test(byAx('410').title + byAx('410').next_action) && /care ended 2025-03-01 \(Moved out of our service area\)/.test(byAx('410').detail), byAx('410'))
  ck('4 · ...and nothing starts by itself: no new role, no episode, no journey', T.person_role.filter((x) => x.person_id === 'p-old').length === 1 && T.person_role.find((x) => x.person_id === 'p-old').status === 'former' && !T.journey_episode.length && !RPC.some((f) => /episode|return|decide/.test(f)), RPC)
  ck('a DECEASED client AxisCare shows Active again: no card at all (no reactivation prompts)', !byAx('411') && !T.client_status_review.some((x) => x.axiscare_client_id === '411'))
  ck('a past client turned Deceased in AxisCare: no card (no routine follow-up)', !byAx('412') && !T.client_status_review.some((x) => x.axiscare_client_id === '412'))
  ck('...the run says how many past or deceased changes it left quiet', j.past_quiet === 2, j)
  const ob = SR.reviewItem({ review_id: 'x', new_label: 'Active', old_label: 'Inactive', observed_at: '2026-10-08' }, 'Ida Imported', 'k@x', '2026-10-08', { ended_at: '2026-10-08', ended_date_basis: 'on_or_before', end_reason: null })
  ck('499 · an imported past client with no AxisCare end date: "care ended on or before 2026-10-08 (exact date not recorded in AxisCare)", never as exact', /care ended on or before 2026-10-08 \(exact date not recorded in AxisCare\)/.test(ob.detail), ob.detail)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
