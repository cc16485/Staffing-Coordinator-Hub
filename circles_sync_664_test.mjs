// 664 · circles-sync: the nightly Family Circle sync in its own function. Runs the REAL circles-sync/index.ts under Node
// with a stand-in database and AxisCare. Proves: who may call (schedule, owner, office staff; nobody else), counts only for
// staff, dry run writes nothing, a real run writes only the circle tables and its heartbeat, never sets texting consent,
// never changes a contact typed in the office, skips past clients, marks (never deletes) people AxisCare no longer lists.
//   node circles_sync_664_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const F = 'supabase/functions'
const SERVICE = 'service'.repeat(6), SECRET = 'j'.repeat(40)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE, HUB_JOB_SECRET: SECRET, AXISCARE_API_KEY: 'ax', AXISCARE_SITE: '12345' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_cs_'))
const rewrite = (s) => s.replace(/^import \{ createClient \} from ['"]https:\/\/esm\.sh\/@supabase\/supabase-js@2['"];?$/m, 'const createClient = globalThis.__fakeCreateClient;')
fs.mkdirSync(path.join(tmp, '_shared')); fs.mkdirSync(path.join(tmp, 'circles-sync'))
for (const f of fs.readdirSync(path.join(F, '_shared'))) fs.writeFileSync(path.join(tmp, '_shared', f), rewrite(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))
const src = rewrite(fs.readFileSync(path.join(F, 'circles-sync', 'index.ts'), 'utf8'))
if (/from ['"](https:|npm:)/.test(src)) throw new Error('still imports from the internet')
fs.writeFileSync(path.join(tmp, 'circles-sync', 'index.ts'), src)

let DB, WRITES, RPC, AX
function reset() {
  DB = {
    person_source_id: [{ person_id: 'pA', source_id: '101', system: 'axiscare', entity_type: 'client' }, { person_id: 'pB', source_id: '102', system: 'axiscare', entity_type: 'client' }, { person_id: 'pP', source_id: '103', system: 'axiscare', entity_type: 'client' }],
    person_identity: [{ id: 'pA', display_name: 'Ann Able' }, { id: 'pB', display_name: 'Bob Baker' }, { id: 'pP', display_name: 'Pat Past' }],
    person_role: [{ person_id: 'pA', role: 'client', status: 'active' }, { person_id: 'pB', role: 'client', status: 'active' }, { person_id: 'pP', role: 'client', status: 'ended' }],
    care_circles: [{ id: 'c2', client_name: 'Bob Baker', active: true, axiscare_client_id: '102' }],
    circle_contacts: [
      { id: 'k1', circle_id: 'c2', name: 'Bea Baker', source: 'axiscare', relationship: 'Daughter', phone: '+14175550001', email: null, axiscare_list_number: 1, hipaa_authorized: true, can_make_medical_decisions: null, sms_consent: true },
      { id: 'k2', circle_id: 'c2', name: 'Office Typed', source: 'manual', relationship: 'Friend' },
      { id: 'k3', circle_id: 'c2', name: 'Gone Person', source: 'axiscare' }],
    family_circle_link_log: [], auth_identities: [{ auth_user_id: 'u1', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'staff1' }],
    persons: [{ person_id: 'staff1', full_name: 'Krystal Land', active: true }], entity_memberships: [{ person_id: 'staff1', entity: 'cc_ihs', active: true, ended_at: null }],
    staff_roles: [{ person_id: 'staff1', entity: 'cc_ihs', role: 'care_coordinator' }],
  }
  WRITES = []; RPC = []
  AX = { '101': [{ name: 'Al Able', relationship: 'Son', phones: [{ type: 'Mobile', number: '417-555-0101' }], email: 'al@x.test', listNumber: 1, hipaaDisclosureAuthorization: '1', canMakeMedicalDecisions: '' }],
    '102': [{ name: 'Bea Baker', relationship: 'Daughter', phones: [{ type: 'Home', number: '417-555-0002' }], listNumber: 1, hipaaDisclosureAuthorization: '1', canMakeMedicalDecisions: '0' }, { name: 'Office Typed', relationship: 'Neighbor' }],
    '103': [{ name: 'Past Family', relationship: 'Wife' }] }
}
let nid = 0
globalThis.__fakeCreateClient = () => ({
  auth: { getUser: async (jwt) => jwt === 'staffjwt' ? { data: { user: { id: 'u1', app_metadata: { hub_access: ['care_coordinator'] } } }, error: null } : jwt === 'otherjwt' ? { data: { user: { id: 'u9', app_metadata: {} } }, error: null } : { data: null, error: { message: 'bad' } } },
  rpc: async (fn, args) => { RPC.push([fn, args]); if (fn === 'family_circle_link') return { data: { outcome: 'linked' }, error: null }; return { data: null, error: null } },
  from: (tb) => { const f = []; let single = false, op = null, vals = null
    const run = () => { let rows = (DB[tb] || []).filter((r) => f.every((fn) => fn(r)))
      if (op === 'insert') { WRITES.push(['insert', tb]); const row = { id: 'n' + (++nid), ...vals }; (DB[tb] = DB[tb] || []).push(row); return { data: single ? row : [row], error: null } }
      if (op === 'update') { WRITES.push(['update', tb, vals]); rows.forEach((r) => Object.assign(r, vals)); return { data: null, error: null } }
      return { data: single ? (rows[0] || null) : rows, error: null } }
    const p = { select() { return p }, eq(k, v) { f.push((r) => String(r[k]) === String(v)); return p }, in(k, v) { f.push((r) => v.map(String).includes(String(r[k]))); return p },
      insert(v) { op = 'insert'; vals = v; return p }, update(v) { op = 'update'; vals = v; return p }, single() { single = true; return p }, maybeSingle() { single = true; return p },
      then(ok, bad) { return Promise.resolve(run()).then(ok, bad) } }
    return p },
})
const AXCALLS = []
globalThis.fetch = async (url, o) => { url = String(url); AXCALLS.push(url + ' ' + (o?.method || 'GET'))
  const m = url.match(/\/api\/clients\/(\d+)\/responsibleParties$/)
  if (m) return new Response(JSON.stringify({ results: { responsibleParties: AX[m[1]] || [] } }), { status: 200 })
  return new Response('{}', { status: 404 }) }
await import(path.join(tmp, 'circles-sync', 'index.ts'))
const run = async (auth, qs = '') => { const H = {}; if (auth === 'owner') H.Authorization = 'Bearer ' + SERVICE; else if (auth === 'cron') { H['x-cron-secret'] = SECRET; H.Authorization = 'Bearer anon' } else if (auth) H.Authorization = 'Bearer ' + auth
  const r = await handler(new Request('https://x.supabase.co/functions/v1/circles-sync' + qs, { method: 'POST', headers: H })); return [r.status, await r.json().catch(() => ({})), r.headers.get('Access-Control-Allow-Origin')] }

try {
  reset()
  let [s, j] = await run(null)
  ck('no key: refused, nothing read from AxisCare', s === 401 && !AXCALLS.length, [s, j])
  ;[s, j] = await run('otherjwt')
  ck('a signed-in person without Hub access: refused', s === 403 && !AXCALLS.length, [s, j])
  const pre = await handler(new Request('https://x.supabase.co/functions/v1/circles-sync', { method: 'OPTIONS' }))
  ck('the browser check (OPTIONS) is answered with CORS from day one', pre.status === 200 && pre.headers.get('Access-Control-Allow-Origin') === '*')
  ;[s, j] = await run('owner')
  ck('owner, no commit: a dry run that counts and shows a sample, and writes nothing', s === 200 && j.mode === 'DRY RUN' && j.circles_created === 1 && j.contacts_added === 1 && Array.isArray(j.sample) && j.sample.length === 1 && !WRITES.length && !RPC.length, [j, WRITES])
  reset()
  ;[s, j] = await run('staffjwt', '?commit=1')
  ck('office staff (the Hub\'s Sync button): a real run, counts only, no names', s === 200 && j.mode === 'COMMIT' && typeof j.sample === 'number' && !/Able|Baker|Typed|555/.test(JSON.stringify(j)), j)
  const circ = DB.care_circles.find((c) => c.axiscare_client_id === '101')
  const al = DB.circle_contacts.find((c) => c.name === 'Al Able')
  ck('a current client with family in AxisCare gets a circle, linked by AxisCare id, logged', circ && circ.link_how === 'sync_created' && DB.family_circle_link_log.length === 1, DB.care_circles)
  ck('a new contact comes in with tier, relationship, phone and both flags, and texting consent is NEVER set (false)', al && al.circle_id === circ.id && al.sms_consent === false && al.hipaa_authorized === true && al.can_make_medical_decisions === null && al.phone === '417-555-0101', al)
  const bea = DB.circle_contacts.find((c) => c.id === 'k1')
  ck('an AxisCare contact follows AxisCare (phone and flag updated) and keeps the texting consent a person recorded', bea.phone === '417-555-0002' && bea.can_make_medical_decisions === false && bea.sms_consent === true, bea)
  ck('a contact typed in the office is never changed', DB.circle_contacts.find((c) => c.id === 'k2').relationship === 'Friend' && j.manual_untouched === 1, j)
  ck('someone AxisCare no longer lists is marked, never deleted', !!DB.circle_contacts.find((c) => c.id === 'k3').axiscare_removed_at && j.contacts_marked_removed === 1)
  ck('a past client gets no circle and no contacts', j.skipped_past === 1 && !DB.care_circles.some((c) => c.client_name === 'Pat Past') && !DB.circle_contacts.some((c) => c.name === 'Past Family'), j)
  ck('a real run leaves the heartbeat hb_circles-sync (healthy)', RPC.some(([fn, a]) => fn === 'upsert_app_data_item' && a.target_key === 'automation_heartbeats' && a.item.id === 'hb_circles-sync' && a.item.ok === true))
  ck('it writes only the circle tables and its heartbeat: never app_data lists, the caregiver list or the identity layer', WRITES.every(([, tb]) => ['care_circles', 'circle_contacts', 'family_circle_link_log'].includes(tb)) && RPC.every(([fn, a]) => fn === 'upsert_app_data_item' ? a.target_key === 'automation_heartbeats' : fn === 'family_circle_link'), [WRITES, RPC.map((r) => r[0])])
  ck('AxisCare is only read (GET)', AXCALLS.every((u) => / GET$/.test(u)), AXCALLS)
  reset(); AXCALLS.length = 0
  ;[s, j] = await run('cron', '?commit=1')
  ck('the nightly schedule (the jobs\' secret) may run it; the answer is counts only', s === 200 && j.mode === 'COMMIT' && typeof j.sample === 'number', j)
  ;[s, j] = await run('cron', '?auth_check=1')
  ck('?auth_check=1 says who is calling and syncs nothing', s === 200 && j.caller === 'cron' && !AXCALLS.some((u) => u.includes('auth_check')), j)
  const code = fs.readFileSync(path.join(F, 'circles-sync', 'index.ts'), 'utf8'), old = fs.readFileSync(path.join(F, 'identity-backfill', 'index.ts'), 'utf8')
  /* 2026-10-12: the only change since the move is leaving not-clients (Office Staff) out; those two lines are set aside here */
  const body = (t) => t.slice(t.indexOf('async function syncCirclesFromAxisCare'), t.indexOf('Deno.serve(async (req) => {')).split('\n').filter((l) => !/loadNotClients\(sb\)|isNotClient\(ax\)/.test(l)).join('\n').trim()
  ck('the sync itself is the same code as before, unchanged', body(code) === body(old))
  ck('no em dash in the new code', !/[—―]/.test(code.slice(0, code.indexOf('/* ── FAMILY CIRCLES'))) && !/[—―]/.test(code.slice(code.indexOf('Deno.serve'))))
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
const failed = res.filter((r) => !r[1])
for (const [n, ok, note] of res) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n      ' + note}`)
console.log(`\n${res.length - failed.length}/${res.length} passed${failed.length ? ' · FAIL' : ''}`)
process.exit(failed.length ? 1 : 0)
