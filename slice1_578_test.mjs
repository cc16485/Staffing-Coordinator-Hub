// 578 · PHASE 1, SLICE 1: one record. Under Node against the REAL code with a stand-in database: the events helper never
// invents an actor; the four office feeds answer office members only; every verb the code writes is in the vocabulary.
//   node slice1_578_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 500)])
const F = process.env.CR_ROOT || 'supabase/functions'
const SERVICE = 'service'.repeat(6), ANON = 'anon'.repeat(10)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON, REPORTS_OWNERS: 'owner@cc.test' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const USERS = {
  office: { id: 'u1', email: 'krystal@cc.test', app_metadata: { hub_access: ['care_coordinator'] } },
  training: { id: 'u7', email: 'trainer@cc.test', app_metadata: { hub_access: ['training'] } },
  caregiver: { id: 'u5', email: 'cg@cc.test', app_metadata: { hub_access: ['care_coordinator'] } },
  owner: { id: 'u9', email: 'owner@cc.test', app_metadata: { hub_access: ['care_coordinator'] } },
}
const DB = {
  auth_identities: [{ auth_user_id: 'u1', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p1' }, { auth_user_id: 'u5', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p5' }, { auth_user_id: 'u9', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p9' }],
  persons: [{ person_id: 'p1', full_name: 'Krystal', active: true }, { person_id: 'p5', full_name: 'Cg', active: true }, { person_id: 'p9', full_name: 'Samantha', active: true }],
  entity_memberships: [{ person_id: 'p1', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p5', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p9', entity: 'cc_ihs', active: true, ended_at: null }],
  staff_roles: [{ person_id: 'p1', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p5', entity: 'cc_ihs', role: 'caregiver' }, { person_id: 'p9', entity: 'cc_ihs', role: 'owner_admin' }],
  app_data: [], op_events: [],
}
const INSERTS = []
globalThis.__fakeCreateClient = () => ({
  auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: USERS[jwt] }, error: null } : { data: null, error: { message: 'bad jwt' } } },
  from: (tb) => { const f = []; let single = false
    const p = { select() { return p }, eq(k, v) { f.push((r) => String(r[k]) === String(v)); return p }, in() { return p }, order() { return p }, limit() { return p }, gt() { return p }, maybeSingle() { single = true; return p },
      insert(row) { INSERTS.push({ tb, row }); return Promise.resolve({ data: null, error: null }) },
      then(ok, bad) { const rows = (DB[tb] || []).filter((r) => f.every((fn) => fn(r))); return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null }).then(ok, bad) } }
    return p },
  rpc: async () => ({ data: null, error: null }),
})
globalThis.fetch = async () => new Response('{}', { status: 500 })
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_s1_'))
const rewrite = (src) => src.replace(/^import \{ createClient \} from ['"]https:\/\/esm\.sh\/@supabase\/supabase-js@2['"];?$/m, 'const createClient = globalThis.__fakeCreateClient;')
fs.mkdirSync(path.join(tmp, '_shared'))
for (const f of fs.readdirSync(path.join(F, '_shared'))) fs.writeFileSync(path.join(tmp, '_shared', f), rewrite(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))
async function load(fn) {
  fs.mkdirSync(path.join(tmp, fn), { recursive: true })
  const src = rewrite(fs.readFileSync(path.join(F, fn, 'index.ts'), 'utf8'))
  if (/from ['"]https:\/\//.test(src)) throw new Error(fn + ' still imports from the internet')
  fs.writeFileSync(path.join(tmp, fn, 'index.ts'), src); handler = null
  await import(path.join(tmp, fn, 'index.ts')); return handler
}
const call = async (h, who, body = {}) => { const H = { 'Content-Type': 'application/json' }; if (who) H.Authorization = 'Bearer ' + who
  const r = await h(new Request('https://x.supabase.co/functions/v1/fn', { method: 'POST', headers: H, body: JSON.stringify(body) })); let j = {}; try { j = await r.json() } catch { /* empty */ } return [r.status, j] }
try {
  // 1. the events helper
  const ev = await import(path.join(tmp, '_shared', 'events.ts'))
  const sb = globalThis.__fakeCreateClient()
  INSERTS.length = 0; await ev.opEvent(sb, { verb: 'item_created', summary: 'x', job: 'timekeeper-watch' })
  let row = INSERTS[0].row
  ck('a job writes as a job: kind job, id = the job name, no invented person name', row.actor_kind === 'job' && row.actor_id === 'timekeeper-watch' && row.actor_name === 'timekeeper-watch' && row.actor_email === '' && row.via === 'cron', row)
  ck('…and the area comes from the vocabulary when the caller did not say', row.area === 'work', row)
  INSERTS.length = 0; await ev.opEvent(sb, { verb: 'coverage_claimed', summary: 'x', actor_email: 'Krystal@cc.test', actor_name: 'Krystal', via: 'link' })
  row = INSERTS[0].row
  ck('a person writes as a person: kind person, email lower-cased, via kept', row.actor_kind === 'person' && row.actor_email === 'krystal@cc.test' && row.actor_name === 'Krystal' && row.via === 'link', row)
  INSERTS.length = 0; await ev.opEvent(sb, { verb: 'item_created', summary: 'x' })
  row = INSERTS[0].row
  ck("a row with no actor and no job is still a job, never 'Cara'", row.actor_kind === 'job' && row.actor_name !== 'Cara', row)
  INSERTS.length = 0; await ev.opEvent(sb, { verb: 'visit_changed', summary: 'x'.repeat(900), actor_email: 'a@b.c', actor_name: 'A', action: 'visit_change.change', request_id: 'r1', outcome: 'done', evidence: [{ kind: 'visit', id: '9' }], approval: { by_email: 'a@b.c', at: 't', seen: 'h' } })
  row = INSERTS[0].row
  ck('the contract fields travel: action, request id, outcome, evidence, approval; summary capped at 400', row.action === 'visit_change.change' && row.request_id === 'r1' && row.outcome === 'done' && row.evidence.length === 1 && row.approval.seen === 'h' && row.summary.length === 400, row)
  ck('actorOf is pure and the same every time', JSON.stringify(ev.actorOf({ verb: 'x', summary: '', job: 'j' })) === JSON.stringify(ev.actorOf({ verb: 'x', summary: '', job: 'j' })))
  // 2. the vocabulary covers every verb the code writes
  const V = globalThis.CC_VERBS
  ck('the vocabulary loaded with the helper', V && typeof V.known === 'function' && V.list().length > 60, V && V.list().length)
  const used = new Set()
  for (const p of fs.readdirSync(F)) { const ip = path.join(F, p, 'index.ts'); if (!fs.existsSync(ip)) continue; const s = fs.readFileSync(ip, 'utf8')
    for (const m of s.matchAll(/opEvent\(\w+, \{[^}]*?verb:\s*'([a-z_]+)'/gs)) used.add(m[1]) }
  for (const sh of ['routing.ts', 'ghl-call-bridge.ts']) { const s = fs.readFileSync(path.join(F, '_shared', sh), 'utf8'); for (const m of s.matchAll(/verb:\s*'([a-z_]+)'/g)) used.add(m[1]) }
  const hub = process.env.HUB_ROOT ? path.resolve(process.env.HUB_ROOT) : path.resolve(process.cwd(), '..', 'cc-hub-live')   // HUB_ROOT: a fresh copy of the Hub
  if (fs.existsSync(hub)) for (const f of fs.readdirSync(hub).filter((x) => x.endsWith('.js') || x === 'index.html')) { const s = fs.readFileSync(path.join(hub, f), 'utf8'); for (const m of s.matchAll(/opEvent\('([a-z_]+)'(?!\s*\+)/g)) used.add(m[1]) }  /* a verb built at runtime ('late_'+action) is not a spelling */
  const missing = [...used].filter((v) => !V.known(v))
  ck(`every verb the code writes is in the vocabulary (${used.size} verbs checked${fs.existsSync(hub) ? ', Hub included' : ', server only'})`, missing.length === 0, missing)
  ck('diagnostics are marked so "Since You Left" can skip them', V.isDiagnostic('routing_shadow') && V.isDiagnostic('record_started') && !V.isDiagnostic('item_created'))
  // 3. the four feeds
  let h = await load('calls-feed'); let s, b
  ;[s, b] = await call(h, null); ck('calls-feed: no sign-in refused (401)', s === 401, [s, b])
  ;[s, b] = await call(h, 'training'); ck('calls-feed: a Training-platform sign-in on the shared project is now refused (403); it used to get in', s === 403, [s, b])
  ;[s, b] = await call(h, 'caregiver'); ck('calls-feed: a caregiver account refused (403)', s === 403, [s, b])
  ;[s, b] = await call(h, 'office'); ck('calls-feed: an office member gets past the check (next stop: GoHighLevel not configured here)', s === 500 && /GoHighLevel/.test(b.error), [s, b])
  h = await load('interview-feed')
  ;[s, b] = await call(h, 'training'); ck('interview-feed: a Training-platform sign-in refused (403)', s === 403, [s, b])
  ;[s, b] = await call(h, 'office'); ck('interview-feed: an office member gets the (empty) calendar list', s === 200 && Array.isArray(b.calendars), [s, b])
  h = await load('ghl-thread')
  ;[s, b] = await call(h, null, { phone: '4175550100' }); ck('ghl-thread: no sign-in refused (401)', s === 401, [s, b])
  ;[s, b] = await call(h, 'training', { phone: '4175550100' }); ck('ghl-thread: a Training-platform sign-in refused (403)', s === 403, [s, b])
  ;[s, b] = await call(h, 'office', { phone: '4175550100' }); ck('ghl-thread: an office member gets past the check (next stop: GoHighLevel not connected here)', s === 503, [s, b])
  h = await load('reports-rollup')
  ;[s, b] = await call(h, 'office'); ck('reports-rollup: an office member who is not an owner is refused (403)', s === 403, [s, b])
  ;[s, b] = await call(h, 'owner'); ck('reports-rollup: an owner_admin on the owners list gets past the check', s !== 401 && s !== 403, [s, b])
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
