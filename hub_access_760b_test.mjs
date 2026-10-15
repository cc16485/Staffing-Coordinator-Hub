// HUB ACCESS, 760b (2026-10-15): no hub list = no hub; one invite can give Staffing and Care Coordinator together (Samantha:
// "I want most to have access to both hubs staffing and care coordinator"); a hub list that fails to save is said out loud.
// Run for real against a fake Supabase Auth and database; nothing real is touched.   node hub_access_rn_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const SERVICE = 's'.repeat(40), ANON = 'a'.repeat(40)
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON }
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
let USERS = [], AUDIT = [], INVITES = []
const DB = { auth_identities: [{ auth_user_id: 'u-sam', person_id: 'p-sam' }, { auth_user_id: 'u-kat', person_id: 'p-kat' }], staff_roles: [{ person_id: 'p-sam', role: 'owner_admin' }, { person_id: 'p-kat', role: 'owner_admin' }] }
const TOK = { sam: 'u-sam', kry: 'u-kry' }
function table(name) {
  const q = (filters) => ({ eq: (k, v) => q([...filters, (r) => String(r[k]) === String(v)]), in: (k, vs) => q([...filters, (r) => vs.includes(r[k])]),
    then: (ok) => ok({ data: (DB[name] || []).filter((r) => filters.every((f) => f(r))), error: null }) })
  return { select: () => q([]) }
}
const admin = { from: table, rpc: async (n, a) => { if (n === 'upsert_app_data_item') AUDIT.push(a.item); return { error: null } },
  auth: { admin: {
    listUsers: async ({ page }) => ({ data: { users: page === 1 ? USERS.map((u) => ({ ...u, app_metadata: JSON.parse(JSON.stringify(u.app_metadata || {})) })) : [] }, error: null }),
    updateUserById: async (id, o) => { if (globalThis.__failUpdate) return { error: { message: 'auth down' } }; const u = USERS.find((x) => x.id === id); u.app_metadata = { ...(u.app_metadata || {}), ...o.app_metadata }; return { error: null } },
    inviteUserByEmail: async (email, o) => { const u = { id: 'u-' + email, email, app_metadata: {} }; USERS.push(u); INVITES.push({ email, redirectTo: o.redirectTo }); return { data: { user: { ...u } }, error: null } } } } }
globalThis.__fakeCreateClient = (url, key, o) => key === SERVICE ? admin : { auth: { getUser: async () => { const t = (o?.global?.headers?.Authorization || '').replace('Bearer ', ''); const u = TOK[t]; return u ? { data: { user: { id: u, email: u.slice(2) + '@mo-care.com' } }, error: null } : { data: null, error: { message: 'bad' } } } } }
const TMP = path.join(ROOT, '.hub_access_760b_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(path.join(FN, 'hub-access'), TMP, { recursive: true })
const f = path.join(TMP, 'index.ts'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient'))
try { await import(f) } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const call = async (body, tok = 'sam') => { const r = await handler(new Request('http://x/hub-access', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
const acc = (e) => USERS.find((u) => u.email === e)?.app_metadata?.hub_access
const reset = () => { USERS = [
  { id: 'u-sam', email: 'sam@mo-care.com', email_confirmed_at: 'x', app_metadata: { hub_access: ['care_coordinator', 'team_hub'] } },
  { id: 'u-kat', email: 'kat@mo-care.com', email_confirmed_at: 'x', app_metadata: { hub_access: ['care_coordinator', 'team_hub'] } },
  { id: 'u-cc', email: 'casey@mo-care.com', email_confirmed_at: 'x', app_metadata: { hub_access: ['care_coordinator'] } },
  { id: 'u-old', email: 'old@mo-care.com', email_confirmed_at: 'x', app_metadata: {} },
  { id: 'u-gone', email: 'gone@mo-care.com', email_confirmed_at: 'x', app_metadata: { hub_access: [] } } ]; AUDIT = []; INVITES = [] }

reset()
let r = await call({ action: 'invite', target_email: 'angiel@mo-care.com', hubs: ['care_coordinator', 'staffing'] })
ck('one invite gives both hubs', r.status === 200 && JSON.stringify(acc('angiel@mo-care.com')) === '["care_coordinator","staffing"]' && /Care Coordinator Hub and Staffing Hub/.test(r.j.hub_label), [r, acc('angiel@mo-care.com')])
ck('the audit line names both hubs and who did it', AUDIT.some((a) => JSON.stringify(a.hubs) === '["care_coordinator","staffing"]' && a.by === 'sam@mo-care.com'))
r = await call({ action: 'status', target_email: 'angiel@mo-care.com', hubs: ['care_coordinator', 'staffing'] })
ck('status for both hubs reads both', r.j.state === 'invited' && JSON.stringify(r.j.access) === '["care_coordinator","staffing"]', r.j)
r = await call({ action: 'restore', target_email: 'casey@mo-care.com', hubs: ['staffing', 'care_coordinator'] })
ck('restore can add the second hub, keeping the first', r.status === 200 && JSON.stringify(acc('casey@mo-care.com')) === '["care_coordinator","staffing"]', acc('casey@mo-care.com'))
r = await call({ action: 'restore', target_email: 'casey@mo-care.com', hubs: ['staffing', 'rn_review'] })
ck('RN review is never given together with another hub', r.status === 400 && JSON.stringify(acc('casey@mo-care.com')) === '["care_coordinator","staffing"]', r)
r = await call({ action: 'invite', target_email: 'q@mo-care.com', hubs: ['staffing', 'nurse_portal'] })
ck('an unknown hub in the list is refused, nothing invited', r.status === 400 && !acc('q@mo-care.com') && !INVITES.some((i) => i.email === 'q@mo-care.com'), r)
r = await call({ action: 'invite', target_email: 'one@mo-care.com', hub: 'staffing' })
ck('one hub at a time still works', r.status === 200 && JSON.stringify(acc('one@mo-care.com')) === '["staffing"]')
r = await call({ action: 'status', target_email: 'old@mo-care.com', hub: 'care_coordinator' })
ck('an account with no hub list now shows no hub (it used to show every hub)', r.j.state === 'revoked' && /no hub yet/.test(r.j.label) && JSON.stringify(r.j.access) === '[]', r.j)
r = await call({ action: 'revoke', target_email: 'old@mo-care.com', hub: 'staffing' })
ck('Remove access on an account with no list never turns into every other hub', r.status === 200 && JSON.stringify(acc('old@mo-care.com')) === '[]', acc('old@mo-care.com'))
globalThis.__failUpdate = true
r = await call({ action: 'invite', target_email: 'fail@mo-care.com', hubs: ['care_coordinator', 'staffing'] })
globalThis.__failUpdate = false
ck('a hub list that fails to save is said out loud (500, says they cannot open any hub, says what to press)', r.status === 500 && /cannot open any hub yet/.test(r.j.error) && /Restore access/.test(r.j.detail), r)
reset(); USERS.find((u) => u.id === 'u-kat').app_metadata = {}
r = await call({ action: 'revoke', target_email: 'sam@mo-care.com', hub: 'care_coordinator' })
ck('the last-owner guard no longer counts an owner with no list as able to get in', r.status === 409 && /nobody who can sign in/.test(r.j.error), r)
USERS.find((u) => u.id === 'u-kat').app_metadata = { hub_access: ['care_coordinator'] }
r = await call({ action: 'revoke', target_email: 'sam@mo-care.com', hub: 'care_coordinator' })
ck('...and lets it through when another owner really has the hub', r.status === 200, r)
const src = fs.readFileSync(path.join(FN, 'hub-access/index.ts'), 'utf8')
const added = src.split('\n').filter((l) => /760b|hubs|no hub|cannot open any hub|Restore access/.test(l))
ck('no em dash in the lines this change added', added.length > 8 && added.every((l) => !/\u2014/.test(l)), added.filter((l) => /\u2014/.test(l)))
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (note ? '  ' + note : ''))
console.log(`${res.filter((x) => x[1]).length}/${res.length} passed`); process.exit(res.every((x) => x[1]) ? 0 : 1)
