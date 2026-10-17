// HUB ACCESS, Springfield lead (2026-10-17, SOP ruling 9): the Springfield lead may invite, resend, remove and restore Hub
// access for anyone who is not an owner; an owner's access stays with owners; a plain Care Coordinator still cannot.
// Run for real against a fake Supabase Auth and database; nothing real is touched.   node hub_access_lead_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const SERVICE = 's'.repeat(40), ANON = 'a'.repeat(40)
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
let USERS = [], AUDIT = []
const DB = { auth_identities: [{ auth_user_id: 'u-sam', person_id: 'p-sam' }, { auth_user_id: 'u-kry', person_id: 'p-kry' }, { auth_user_id: 'u-cc', person_id: 'p-cc' }],
  staff_roles: [{ person_id: 'p-sam', role: 'owner_admin' }, { person_id: 'p-kry', role: 'care_coordinator' }, { person_id: 'p-kry', role: 'springfield_lead' }, { person_id: 'p-cc', role: 'care_coordinator' }] }
const TOK = { sam: 'u-sam', kry: 'u-kry', cc: 'u-cc' }
function table(name) {
  const q = (filters) => ({ eq: (k, v) => q([...filters, (r) => String(r[k]) === String(v)]), in: (k, vs) => q([...filters, (r) => vs.includes(r[k])]),
    then: (ok) => ok({ data: (DB[name] || []).filter((r) => filters.every((f) => f(r))), error: null }) })
  return { select: () => q([]) }
}
const admin = { from: table, rpc: async (n, a) => { if (n === 'upsert_app_data_item') AUDIT.push(a.item); return { error: null } },
  auth: { admin: {
    listUsers: async ({ page }) => ({ data: { users: page === 1 ? USERS.map((u) => ({ ...u, app_metadata: JSON.parse(JSON.stringify(u.app_metadata || {})) })) : [] }, error: null }),
    updateUserById: async (id, o) => { const u = USERS.find((x) => x.id === id); u.app_metadata = { ...(u.app_metadata || {}), ...o.app_metadata }; return { error: null } },
    inviteUserByEmail: async (email) => { const u = { id: 'u-' + email, email, app_metadata: {} }; USERS.push(u); return { data: { user: { ...u } }, error: null } } } } }
globalThis.__fakeCreateClient = (url, key, o) => key === SERVICE ? admin : { auth: { getUser: async () => { const t = (o?.global?.headers?.Authorization || '').replace('Bearer ', ''); const u = TOK[t]; return u ? { data: { user: { id: u, email: u.slice(2) + '@mo-care.com' } }, error: null } : { data: null, error: { message: 'bad' } } } } }
const TMP = path.join(ROOT, '.hub_access_lead_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(path.join(FN, 'hub-access'), TMP, { recursive: true })
const f = path.join(TMP, 'index.ts'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient'))
try { await import(f) } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const call = async (body, tok) => { const r = await handler(new Request('http://x/hub-access', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
const acc = (e) => USERS.find((u) => u.email === e)?.app_metadata?.hub_access
USERS = [
  { id: 'u-sam', email: 'sam@mo-care.com', email_confirmed_at: 'x', app_metadata: { hub_access: ['care_coordinator', 'team_hub'] } },
  { id: 'u-kry', email: 'kry@mo-care.com', email_confirmed_at: 'x', app_metadata: { hub_access: ['care_coordinator', 'staffing', 'team_hub'] } },
  { id: 'u-cc', email: 'cc@mo-care.com', email_confirmed_at: 'x', app_metadata: { hub_access: ['care_coordinator'] } } ]

let r = await call({ action: 'invite', target_email: 'angiel@mo-care.com', hubs: ['care_coordinator', 'staffing'] }, 'kry')
ck('the Springfield lead can invite a new office hire to both hubs', r.status === 200 && JSON.stringify(acc('angiel@mo-care.com')) === '["care_coordinator","staffing"]', r)
ck('the audit line says the lead did it', AUDIT.some((a) => a.by === 'kry@mo-care.com' && a.target === 'angiel@mo-care.com'))
r = await call({ action: 'status', target_email: 'sam@mo-care.com', hub: 'care_coordinator' }, 'kry')
ck('the lead can read anyone\'s status', r.status === 200 && r.j.state === 'active', r)
r = await call({ action: 'revoke', target_email: 'cc@mo-care.com', hub: 'care_coordinator' }, 'kry')
ck('the lead can remove a non-owner\'s access', r.status === 200 && JSON.stringify(acc('cc@mo-care.com')) === '[]', r)
r = await call({ action: 'restore', target_email: 'cc@mo-care.com', hub: 'care_coordinator' }, 'kry')
ck('...and restore it', r.status === 200 && JSON.stringify(acc('cc@mo-care.com')) === '["care_coordinator"]', r)
for (const action of ['revoke', 'restore', 'resend', 'invite']) {
  r = await call({ action, target_email: 'sam@mo-care.com', hub: 'team_hub' }, 'kry')
  ck(`the lead cannot ${action} an owner's access (403, nothing changed)`, r.status === 403 && /Only an owner/.test(r.j.error) && JSON.stringify(acc('sam@mo-care.com')) === '["care_coordinator","team_hub"]', r)
}
r = await call({ action: 'invite', target_email: 'x@mo-care.com', hub: 'care_coordinator' }, 'cc')
ck('a Care Coordinator without the lead role still cannot change access', r.status === 403 && !acc('x@mo-care.com'), r)
r = await call({ action: 'revoke', target_email: 'kry@mo-care.com', hub: 'team_hub' }, 'sam')
ck('an owner still can change anyone (including the lead)', r.status === 200 && !acc('kry@mo-care.com').includes('team_hub'), r)
const src = fs.readFileSync(path.join(FN, 'hub-access/index.ts'), 'utf8')
ck('no em dash in the lead lines', src.split('\n').filter((l) => /springfield|Springfield|isLead/.test(l)).every((l) => !/—/.test(l)))
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (note ? '  ' + note : ''))
console.log(`${res.filter((x) => x[1]).length}/${res.length} passed`); process.exit(res.every((x) => x[1]) ? 0 : 1)
