// HUB ACCESS, "RN review only" (2026-10-14, RN review follow-up): the hub-access function may now give the slug rn_review, and
// only ALONE: never on top of another hub, never to an owner, and no other hub is ever added to an RN review only account.
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
    updateUserById: async (id, o) => { const u = USERS.find((x) => x.id === id); u.app_metadata = { ...(u.app_metadata || {}), ...o.app_metadata }; return { error: null } },
    inviteUserByEmail: async (email, o) => { const u = { id: 'u-' + email, email, app_metadata: {} }; USERS.push(u); INVITES.push({ email, redirectTo: o.redirectTo }); return { data: { user: { ...u } }, error: null } } } } }
globalThis.__fakeCreateClient = (url, key, o) => key === SERVICE ? admin : { auth: { getUser: async () => { const t = (o?.global?.headers?.Authorization || '').replace('Bearer ', ''); const u = TOK[t]; return u ? { data: { user: { id: u, email: u.slice(2) + '@mo-care.com' } }, error: null } : { data: null, error: { message: 'bad' } } } } }
const TMP = path.join(ROOT, '.hub_access_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(path.join(FN, 'hub-access'), TMP, { recursive: true })
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
let r = await call({ action: 'invite', target_email: 'natasha@mo-care.com', hub: 'rn_review' })
ck('a new account invited for RN review only: exactly ["rn_review"], the invitation opens rn.html, audited', r.status === 200 && JSON.stringify(acc('natasha@mo-care.com')) === '["rn_review"]' && INVITES[0].redirectTo === 'https://cc.mo-care.com/rn.html' && AUDIT.some((a) => a.hub === 'rn_review' && a.by === 'sam@mo-care.com'), [r, acc('natasha@mo-care.com')])
r = await call({ action: 'status', target_email: 'natasha@mo-care.com', hub: 'rn_review' })
ck('status for RN review reads the slug (invited, not accepted yet)', r.status === 200 && r.j.state === 'invited' && JSON.stringify(r.j.access) === '["rn_review"]', r.j)
USERS.find((u) => u.email === 'natasha@mo-care.com').email_confirmed_at = 'x'
for (const hub of ['care_coordinator', 'team_hub', 'staffing']) {
  r = await call({ action: 'restore', target_email: 'natasha@mo-care.com', hub })
  ck(`an RN review only account cannot be given ${hub} as well (409), nothing changes`, r.status === 409 && /RN review only/.test(r.j.error) && JSON.stringify(acc('natasha@mo-care.com')) === '["rn_review"]', r)
}
r = await call({ action: 'invite', target_email: 'natasha@mo-care.com', hub: 'care_coordinator' })
ck('...nor through invite', r.status === 409 && JSON.stringify(acc('natasha@mo-care.com')) === '["rn_review"]', r)
r = await call({ action: 'restore', target_email: 'casey@mo-care.com', hub: 'rn_review' })
ck('a Care Coordinator Hub account cannot be made RN review on top (409, says remove the other access first)', r.status === 409 && /already has Care Coordinator Hub/.test(r.j.error) && /Remove that access first/.test(r.j.detail) && JSON.stringify(acc('casey@mo-care.com')) === '["care_coordinator"]', r)
r = await call({ action: 'status', target_email: 'old@mo-care.com', hub: 'rn_review' })
ck('an account with no hub list has no hub (760b), so its RN review status says no access', r.j.state === 'revoked' && /no hub yet/.test(r.j.label), r.j)
r = await call({ action: 'revoke', target_email: 'old@mo-care.com', hub: 'staffing' })
ck('removing a hub from an account with no list hands it nothing (760b: no list = no hub)', r.status === 200 && JSON.stringify(acc('old@mo-care.com')) === '[]', acc('old@mo-care.com'))
r = await call({ action: 'restore', target_email: 'old@mo-care.com', hub: 'rn_review' })
ck('an account with no hubs can be given RN review only', r.status === 200 && JSON.stringify(acc('old@mo-care.com')) === '["rn_review"]', r)
USERS.push({ id: 'u-kat2', email: 'owner2@mo-care.com', email_confirmed_at: 'x', app_metadata: { hub_access: [] } }); DB.auth_identities.push({ auth_user_id: 'u-kat2', person_id: 'p-kat' })
r = await call({ action: 'restore', target_email: 'owner2@mo-care.com', hub: 'rn_review' })
ck('an owner cannot be made RN review only', r.status === 409 && /owner/.test(r.j.error) && JSON.stringify(acc('owner2@mo-care.com')) === '[]', r)
r = await call({ action: 'restore', target_email: 'gone@mo-care.com', hub: 'rn_review' })
ck('an account with no hubs left can be given RN review only', r.status === 200 && JSON.stringify(acc('gone@mo-care.com')) === '["rn_review"]', r)
r = await call({ action: 'revoke', target_email: 'natasha@mo-care.com', hub: 'rn_review' })
ck('RN review is removed like any hub (nothing left)', r.status === 200 && JSON.stringify(acc('natasha@mo-care.com')) === '[]', r)
r = await call({ action: 'restore', target_email: 'natasha@mo-care.com', hub: 'care_coordinator' })
ck('once RN review is removed, another hub may be given (on purpose, by an owner)', r.status === 200 && JSON.stringify(acc('natasha@mo-care.com')) === '["care_coordinator"]', r)
r = await call({ action: 'invite', target_email: 'x@mo-care.com', hub: 'rn_review' }, 'kry')
ck('only an owner may give RN review (anyone else: 403)', r.status === 403 && !acc('x@mo-care.com'), r)
r = await call({ action: 'invite', target_email: 'y@mo-care.com', hub: 'nurse_portal' })
ck('an unknown hub is still refused', r.status === 400)
r = await call({ action: 'invite', target_email: 'z@mo-care.com', hub: 'care_coordinator' })
ck('ordinary invitations are unchanged (the Hub home page)', r.status === 200 && JSON.stringify(acc('z@mo-care.com')) === '["care_coordinator"]' && INVITES.at(-1).redirectTo === 'https://cc.mo-care.com/')
const src = fs.readFileSync(path.join(FN, 'hub-access/index.ts'), 'utf8')
const added = src.split('\n').filter((l) => /rn_review|EXCLUSIVE_HUB|RN review/.test(l))
ck('no em dash in the lines this change added', added.length > 5 && added.every((l) => !/\u2014/.test(l)), added.filter((l) => /\u2014/.test(l)))
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (note ? '  ' + note : ''))
console.log(`${res.filter((x) => x[1]).length}/${res.length} passed`); process.exit(res.every((x) => x[1]) ? 0 : 1)
