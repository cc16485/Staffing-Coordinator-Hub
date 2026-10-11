// 582 · PHASE 1, SLICE 3: the door. Under Node against the REAL wrapper and the REAL client-fact and call-place, with a
// stand-in database: who may call comes from the authority table; undeclared fields are refused; one started row and
// one outcome row per change with the real person; a repeated request id does nothing twice; reads record nothing;
// no value ever reaches the record. With PGLITE set, the 582 SQL also runs in a real Postgres.
//   node slice3_582_test.mjs
//   PGLITE=<path to @electric-sql/pglite/dist/index.js> node slice3_582_test.mjs
import fs from 'fs'; import path from 'path'; import vm from 'vm'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 600)])
const F = 'supabase/functions'
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service'.repeat(6) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const USERS = {
  office: { id: 'u1', email: 'Krystal@CC.test', app_metadata: { hub_access: ['care_coordinator'] } },
  owner: { id: 'u9', email: 'owner@cc.test', app_metadata: { hub_access: ['care_coordinator'] } },
  caregiver: { id: 'u5', email: 'cg@cc.test', app_metadata: { hub_access: ['care_coordinator'] } },
}
const OFFICE = ['owner_admin', 'care_coordinator', 'staffing_coordinator']
const ACTIONS = ['client_fact.record', 'client_fact.record_person', 'client_fact.care_began', 'call_place.place']
let DB, RPC, RPCS, FAIL
function reset() {
  DB = {
    auth_identities: [{ auth_user_id: 'u1', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p1' }, { auth_user_id: 'u5', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p5' }, { auth_user_id: 'u9', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p9' }],
    persons: [{ person_id: 'p1', full_name: 'Krystal Example', active: true }, { person_id: 'p5', full_name: 'Cg', active: true }, { person_id: 'p9', full_name: 'Samantha', active: true }],
    entity_memberships: ['p1', 'p5', 'p9'].map((p) => ({ person_id: p, entity: 'cc_ihs', active: true, ended_at: null })),
    staff_roles: [{ person_id: 'p1', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p5', entity: 'cc_ihs', role: 'caregiver' }, { person_id: 'p9', entity: 'cc_ihs', role: 'owner_admin' }],
    action_authority: ACTIONS.flatMap((a) => [{ action: a, actor_kind: 'person', actor_id: '', level: 'allowed', roles: [...OFFICE] }, { action: a, actor_kind: 'job', actor_id: '', level: 'never', roles: [] }, { action: a, actor_kind: 'employee', actor_id: '', level: 'never', roles: [] }]),
    op_events: [],
  }
  RPCS = []; FAIL = {}
  RPC = {
    client_fact_record: () => ({ data: { outcome: 'recorded', fact_id: 'f-111' }, error: null }),
    people_on_journey_record: () => ({ data: { outcome: 'recorded', person_key: 'k-1', row_id: 'r-1' }, error: null }),
    care_began_for_episode: () => ({ data: { began: true, on: '2026-10-01', basis: 'recorded' }, error: null }),
    call_record_place: () => ({ data: { outcome: 'placed', lines: 2 }, error: null }),
  }
}
let opId = 0
globalThis.__fakeCreateClient = () => ({
  auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: USERS[jwt] }, error: null } : { data: null, error: { message: 'bad jwt' } } },
  from: (tb) => { const f = []; let single = false
    const p = { select() { return p }, eq(k, v) { f.push((r) => String(r[k]) === String(v)); return p }, in() { return p }, order() { return p }, limit() { return p }, maybeSingle() { single = true; return p },
      insert(row) {
        if (tb === 'op_events') {
          if (FAIL.insert) return Promise.resolve({ data: null, error: { code: '42501', message: 'nope' } })
          if (row.outcome === 'started' && row.request_id && DB.op_events.some((r) => r.request_id === row.request_id && r.outcome === 'started'))
            return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "op_events_request_started_uq"' } })
          DB.op_events.push({ id: ++opId, ...JSON.parse(JSON.stringify(row)) })
        }
        return Promise.resolve({ data: null, error: null }) },
      then(ok, bad) {
        if (tb === 'action_authority' && FAIL.authority) return Promise.resolve({ data: null, error: { message: 'down' } }).then(ok, bad)
        const rows = (DB[tb] || []).filter((r) => f.every((fn) => fn(r))); return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null }).then(ok, bad) } }
    return p },
  rpc: async (fn, args) => { RPCS.push({ fn, args }); if (FAIL.rpc) return { data: null, error: { message: 'db down' } }; await new Promise((r) => setTimeout(r, 5)); return RPC[fn](args) },
})
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_s3_'))
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
const call = async (h, who, body = {}, extra = {}) => { const H = { 'Content-Type': 'application/json', ...extra }; if (who) H.Authorization = 'Bearer ' + who
  const r = await h(new Request('https://x.supabase.co/functions/v1/fn', { method: 'POST', headers: H, body: JSON.stringify(body) })); let j = {}; try { j = await r.json() } catch { /* empty */ } return [r.status, j] }
const EP = '11111111-2222-4333-8444-555555555555'
const FACT = { action: 'record', episode_id: EP, kind: 'allergies', layer: 'intake', value: 'SECRETVALUE peanuts', certainty: 'reported', change_kind: 'first', supersedes_fact_id: null,
  said_by: 'Daughter Name', said_by_relationship: 'daughter', said_how: 'call', said_at: '2026-10-11T15:00:00.000Z' }
const PERSON = { action: 'record_person', episode_id: EP, is_caller: false, change_kind: 'first', person_key: null, supersedes_row_id: null, reason: null, name: 'Jane SECRETNAME',
  relationship: 'daughter', organization: null, roles: ['family_contact'], phone: '4175550199', email: 'jane@secret.test', reach_way: 'call', reach_time: 'evenings', permission: 'yes',
  permission_asked_by: 'Krystal', permission_asked_at: '2026-10-11T12:00:00.000Z' }
const rid = (n) => 'r-test-' + String(n).padStart(4, '0') + '-abcdef'
const rows = () => DB.op_events
const reg = () => { const g = {}; vm.runInNewContext(fs.readFileSync(path.join(F, '_shared/registry.js'), 'utf8'), g); return g.CC_REGISTRY }

try {
  // ── 0. the vocabulary and the registry ──
  const V = {}; vm.runInNewContext(fs.readFileSync(path.join(F, '_shared/verbs.js'), 'utf8'), V)
  ck('vocabulary: the door\'s verbs are listed; started, refused and failed are background detail (hidden from Since You Left)', ['fact_recorded', 'person_recorded', 'call_placed', 'authority_changed'].every((v) => V.CC_VERBS.known(v) && !V.CC_VERBS.isDiagnostic(v))
    && ['record_started', 'action_refused', 'action_failed'].every((v) => V.CC_VERBS.isDiagnostic(v)))
  const R = reg(), sqlTxt = fs.readFileSync('action_authority_582.sql', 'utf8')
  const seed = [...sqlTxt.matchAll(/\('([a-z_]+\.[a-z_]+)',\s*'([a-z-]+)',\s*'([^']+)',\s*'([a-z]+)',\s*'([a-z]+)',\s*(true|false)\)/g)].map((m) => [m[1], m[2], m[3], m[4], m[5], m[6] === 'true'])
  ck('registry: the 582 SQL seeds exactly the actions in registry.js, field for field', seed.length === R.list().length && seed.every(([a, c, l, ar, au, mu]) => { const x = R.get(a); return x && x.contract === c && x.label === l && x.area === ar && x.audience === au && x.mutating === mu }), seed)
  const hubVerbs = '../cc-hub-live-verbs.js'
  if (fs.existsSync(process.env.HUB_VERBS || hubVerbs)) ck('the Hub\'s copy of verbs.js is identical to the server\'s', fs.readFileSync(process.env.HUB_VERBS || hubVerbs, 'utf8') === fs.readFileSync(path.join(F, '_shared/verbs.js'), 'utf8'))

  reset()
  const cf = await load('client-fact'), cp = await load('call-place')

  // ── 1. a fact, the whole way ──
  let [s, j] = await call(cf, 'office', { ...FACT, request_id: rid(1) })
  const r1 = rows()
  ck('a fact: the same answer as before (recorded, the fact id), plus the request id', s === 200 && j.outcome === 'recorded' && j.fact_id === 'f-111' && j.request_id === rid(1), [s, j])
  ck('a fact: the database door got the same arguments as before, the recorder from the sign-in (lower-cased), never the request', RPCS.length === 1 && RPCS[0].fn === 'client_fact_record' && RPCS[0].args.p_recorded_by === 'krystal@cc.test'
    && RPCS[0].args.p_episode_id === EP && RPCS[0].args.p_value === 'SECRETVALUE peanuts' && RPCS[0].args.p_kind === 'allergies', RPCS)
  ck('a fact: exactly two rows, started then done, same request id, action client_fact.record', r1.length === 2 && r1[0].outcome === 'started' && r1[0].verb === 'record_started' && r1[1].outcome === 'done' && r1[1].verb === 'fact_recorded'
    && r1.every((r) => r.request_id === rid(1) && r.action === 'client_fact.record'), r1)
  ck('a fact: both rows carry the real person (email, name, kind person, person id, via hub)', r1.every((r) => r.actor_email === 'krystal@cc.test' && r.actor_name === 'Krystal Example' && r.actor_kind === 'person' && r.actor_id === 'p1' && r.via === 'hub'), r1)
  ck('a fact: the outcome row points at the episode and the fact (evidence ids), item = the episode', r1[1].item_id === EP && JSON.stringify(r1[1].evidence) === JSON.stringify([{ kind: 'episode', id: EP }, { kind: 'fact', id: 'f-111' }]), r1[1])
  ck('a fact: the record never holds the value, who said it, or the words (category and field names only)', !/SECRETVALUE|peanuts|Daughter Name/.test(JSON.stringify(r1)) && r1[1].data.kind === 'allergies', r1)
  ck('a fact: the summary reads as a person would ("Krystal recorded a fact")', r1[1].summary === 'Krystal recorded a fact', r1[1].summary)

  // ── 2. once only ──
  ;[s, j] = await call(cf, 'office', { ...FACT, request_id: rid(1) })
  ck('the same request id again: the first answer, already: true, the database door NOT called again, nothing more recorded', s === 200 && j.already === true && j.fact_id === 'f-111' && j.outcome === 'recorded' && RPCS.length === 1 && rows().length === 2, [s, j, RPCS.length, rows().length])
  const two = await Promise.all([call(cf, 'office', { ...FACT, request_id: rid(2) }), call(cf, 'office', { ...FACT, request_id: rid(2) })])
  ck('two presses at the same moment with the same id: exactly one runs', RPCS.length === 2 && rows().filter((r) => r.request_id === rid(2) && r.outcome === 'started').length === 1
    && two.filter(([, x]) => x.already).length === 1, [RPCS.length, two])
  reset()
  ;[s, j] = await call(cf, 'office', { ...FACT })
  ck('an older open page that sends no request id still saves (the server makes one and says so in the record)', s === 200 && j.outcome === 'recorded' && /^srv-/.test(j.request_id) && rows()[0].data.request_id_made_by_server === true, [s, j, rows()])
  ;[s, j] = await call(cf, 'office', { ...FACT, request_id: 'x' })
  ck('a request id of the wrong shape is refused, nothing run', s === 400 && j.reason === 'bad_field' && j.field === 'request_id' && RPCS.length === 1, [s, j])

  // ── 3. undeclared and wrong fields ──
  reset()
  ;[s, j] = await call(cf, 'office', { ...FACT, request_id: rid(3), recorded_by: 'someone@else.test' })
  ck('an undeclared field is refused by name (here a try at naming the recorder), before anything is run or recorded', s === 400 && j.outcome === 'refused' && j.reason === 'unknown_field' && j.field === 'recorded_by' && j.error === 'unknown field: recorded_by' && !RPCS.length && !rows().length, [s, j])
  ;[s, j] = await call(cf, 'office', { ...PERSON, request_id: rid(4), is_caller: 'yes' })
  ck('a declared field with the wrong kind of value is refused by name', s === 400 && j.reason === 'bad_field' && j.field === 'is_caller' && !RPCS.length, [s, j])
  ;[s, j] = await call(cf, 'office', { ...FACT, request_id: rid(5), episode_id: 'not-an-id' })
  ck('an id that is not an id is refused', s === 400 && j.field === 'episode_id' && !RPCS.length, [s, j])

  // ── 4. who may ──
  ;[s, j] = await call(cf, null, { ...FACT, request_id: rid(6) })
  ck('no sign-in: refused (401), nothing run or recorded', s === 401 && !RPCS.length && !rows().length, [s, j])
  ;[s, j] = await call(cf, 'caregiver', { ...FACT, request_id: rid(7) })
  ck('a caregiver account: refused (403)', s === 403 && /role/.test(j.error) && !RPCS.length, [s, j])
  ;[s, j] = await call(cf, 'office', { ...FACT, request_id: rid(8) }, { 'x-cc-employee': 'office-awareness' })
  ck('anything claiming to be an AI employee: refused (403), no authority', s === 403 && j.reason === 'no_authority' && /AI employees/.test(j.error) && !RPCS.length, [s, j])
  DB.action_authority.find((r) => r.action === 'client_fact.record' && r.actor_kind === 'person').roles = ['owner_admin']
  ;[s, j] = await call(cf, 'office', { ...FACT, request_id: rid(9) })
  const [s2, j2] = await call(cf, 'owner', { ...FACT, request_id: rid(10) })
  ck('the authority table decides: narrowed to owners, a care coordinator is refused and the owner gets in', s === 403 && s2 === 200 && j2.outcome === 'recorded' && RPCS.length === 1, [s, j, s2, j2])
  DB.action_authority.find((r) => r.action === 'client_fact.record' && r.actor_kind === 'person').level = 'never'
  ;[s, j] = await call(cf, 'owner', { ...FACT, request_id: rid(11) })
  ck('a person row at never: refused for everyone ("not open to anyone yet")', s === 403 && j.reason === 'no_authority' && /not open/.test(j.error), [s, j])
  DB.action_authority = DB.action_authority.filter((r) => r.action !== 'client_fact.record')
  ;[s, j] = await call(cf, 'owner', { ...FACT, request_id: rid(12) })
  ck('no authority row at all: refused (fails closed)', s === 403 && j.reason === 'no_authority', [s, j])
  reset(); FAIL.authority = true
  ;[s, j] = await call(cf, 'office', { ...FACT, request_id: rid(13) })
  ck('the authority table cannot be read: refused (500), nothing run', s === 500 && /who may/.test(j.error) && !RPCS.length, [s, j])

  // ── 5. refusals and failures are recorded as such ──
  reset(); RPC.client_fact_record = () => ({ data: { outcome: 'refused', reason: 'stale', message: 'someone changed this after you opened it; look at their change first' }, error: null })
  ;[s, j] = await call(cf, 'office', { ...FACT, request_id: rid(14) })
  ck('a stale save: the same answer as before (200, refused, stale, the message)', s === 200 && j.outcome === 'refused' && j.reason === 'stale' && /someone changed/.test(j.message), [s, j])
  ck('a stale save: recorded as refused (background detail), with the reason, no evidence', rows().length === 2 && rows()[1].outcome === 'refused' && rows()[1].verb === 'action_refused' && rows()[1].data.answer.reason === 'stale' && !rows()[1].evidence.length, rows())
  reset(); FAIL.rpc = true
  ;[s, j] = await call(cf, 'office', { ...FACT, request_id: rid(15) })
  ck('the database door errors: the same 500 as before, recorded as failed', s === 500 && /not recorded/.test(j.error) && rows()[1].outcome === 'failed' && rows()[1].verb === 'action_failed', [s, j, rows()])
  reset(); FAIL.insert = true
  ;[s, j] = await call(cf, 'office', { ...FACT, request_id: rid(16) })
  ck('the record cannot be written: NOTHING is done (503), the fact is not saved', s === 503 && j.outcome === 'failed' && !RPCS.length, [s, j])

  // ── 6. a read records nothing; a person on the Journey ──
  reset()
  ;[s, j] = await call(cf, 'office', { action: 'care_began', episode_id: EP })
  ck('has care begun (a read): the same answer as before, nothing recorded', s === 200 && j.began === true && j.on === '2026-10-01' && !rows().length && RPCS[0].fn === 'care_began_for_episode', [s, j, rows()])
  ;[s, j] = await call(cf, 'office', { action: 'care_began' })
  ck('has care begun without an episode: the same refusal as before', s === 400 && j.error === 'episode_id is required', [s, j])
  ;[s, j] = await call(cf, 'office', { ...PERSON, request_id: rid(17) }, { 'x-cc-via': 'phone' })
  ck('a person on the Journey: same answer, same arguments, recorder from the sign-in', s === 200 && j.row_id === 'r-1' && RPCS[1].fn === 'people_on_journey_record' && RPCS[1].args.p_recorded_by === 'krystal@cc.test' && RPCS[1].args.p_phone === '4175550199', [s, j, RPCS])
  ck('a person on the Journey: recorded with via phone; no name, phone or email in the record', rows().length === 2 && rows()[1].verb === 'person_recorded' && rows().every((r) => r.via === 'phone')
    && !/SECRETNAME|4175550199|secret\.test/.test(JSON.stringify(rows())), rows())
  ;[s, j] = await call(cf, 'office', { action: 'wipe', request_id: rid(18) })
  ck('an action that is not registered: refused with the list of actions', s === 400 && /'care_began', 'record', 'record_person'/.test(j.error.split('').join('')) || (s === 400 && /record_person/.test(j.error)), [s, j])

  // ── 7. call placing ──
  reset()
  ;[s, j] = await call(cp, 'office', { call_ids: [41, 42], decision: 'lead', lead_id: 'lead-77', note: 'SECRETNOTE' })
  ck('an older page with no action and no request id still places the call (placed, 2 lines)', s === 200 && j.outcome === 'placed' && j.lines === 2 && /^srv-/.test(j.request_id), [s, j])
  ck('call placing: same arguments as before, placer from the sign-in', RPCS[0].fn === 'call_record_place' && RPCS[0].args.p_by === 'krystal@cc.test' && JSON.stringify(RPCS[0].args.p_ids) === '[41,42]' && RPCS[0].args.p_lead === 'lead-77' && RPCS[0].args.p_note === 'SECRETNOTE', RPCS)
  ck('call placing: started + done (call_placed), evidence = the two call lines and the lead, never the note', rows().length === 2 && rows()[1].verb === 'call_placed' && rows()[1].item_id === 'lead:lead-77'
    && JSON.stringify(rows()[1].evidence) === JSON.stringify([{ kind: 'call_line', id: '41' }, { kind: 'call_line', id: '42' }, { kind: 'lead', id: 'lead-77' }]) && !/SECRETNOTE/.test(JSON.stringify(rows())), rows())
  RPC.call_record_place = () => ({ data: { outcome: 'refused', reason: 'call line 41 is already placed' }, error: null })
  ;[s, j] = await call(cp, 'office', { action: 'place', request_id: rid(19), call_ids: [41], decision: 'not_ours' })
  ck('a call already placed: the same 400 refusal as before, recorded as refused', s === 400 && j.outcome === 'refused' && rows().at(-1).outcome === 'refused', [s, j])
  ;[s, j] = await call(cp, 'office', { action: 'place', request_id: rid(20), call_ids: [41], decision: 'lead', lead_id: 'x', caller_phone: '4175550000' })
  ck('call placing: an undeclared field is refused by name', s === 400 && j.field === 'caller_phone', [s, j])
  ;[s, j] = await call(cp, 'office', { action: 'place', request_id: rid(21), call_ids: [], decision: 'lead' })
  ck('call placing: no call lines, the same refusal as before', s === 400 && j.error === 'call_ids must list 1 to 20 call lines', [s, j])

  // ── 8. the source ──
  const wrap = fs.readFileSync(path.join(F, '_shared/contract.ts'), 'utf8')
  ck('the wrapper never reads who the caller is from the request body', !/b\.(actor|email|recorded_by|by)\b/.test(wrap) && /requireStaff\(sb, req, roles\)/.test(wrap))
  ck('the wrapper takes the lock BEFORE running the action', wrap.indexOf("outcome: 'started'") < wrap.indexOf('def.run({ input, actor, requestId: rid })'))
  ck('neither function checks staff itself any more (one place decides: the authority table)', ['client-fact', 'call-place'].every((f) => !/requireStaff|OFFICE_ROLES/.test(fs.readFileSync(path.join(F, f, 'index.ts'), 'utf8').replace(/^\/\/.*$/gm, ''))))
  ck('neither function contacts anyone (no GoHighLevel, Resend or AxisCare)', ['client-fact', 'call-place', '_shared/contract.ts'].every((f) => !/leadconnector|resend|axiscare\.com|fetch\(/.test(fs.readFileSync(path.join(F, f.endsWith('.ts') ? f : f + '/index.ts'), 'utf8'))))
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }

// ── 9. the SQL in a real Postgres ──
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE)
  const db = new PGlite()
  const sq = fs.readFileSync('action_authority_582.sql', 'utf8'), rb = fs.readFileSync('action_authority_582_rollback.sql', 'utf8')
  await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
grant usage on schema auth to authenticated, anon, service_role; grant execute on all functions in schema auth to authenticated, anon, service_role;
create table public.persons (person_id uuid primary key, full_name text);
insert into public.persons values ('00000000-0000-4000-8000-000000000009', 'Samantha Owner'), ('00000000-0000-4000-8000-000000000001', 'Krystal Example');
create function public.desk_me() returns uuid language sql stable as $$ select auth.uid() $$;
create function public.desk_is_owner() returns boolean language sql stable as $$ select auth.uid() = '00000000-0000-4000-8000-000000000009'::uuid $$;
create function public.hub_office_ok() returns boolean language sql stable as $$ select auth.uid() is not null $$;
grant execute on function public.desk_me(), public.desk_is_owner(), public.hub_office_ok() to authenticated;
create table public.op_events (id bigserial primary key, at timestamptz default now(), actor_email text default '', actor_name text default '', actor_kind text default 'person', actor_id text default '',
  via text default '', verb text, item_id text default '', area text default '', summary text default '', data jsonb default '{}', action text default '', request_id text default '', outcome text default '',
  approval jsonb default '{}', evidence jsonb default '[]');
create unique index op_events_request_started_uq on public.op_events (request_id) where request_id <> '' and outcome = 'started';
grant select, insert on public.op_events to service_role; grant usage on sequence public.op_events_id_seq to service_role;`)
  await db.exec(sq); await db.exec(sq)
  ck('PGLITE: 582 installs, and installs again (safe to re-run)', true)
  const q1 = async (q) => (await db.query(q)).rows
  ck('PGLITE: seeded: 4 actions; person = the three office roles; job and employee = never', (await q1('select count(*)::int n from public.action_registry'))[0].n === 4
    && (await q1(`select count(*)::int n from public.action_authority where actor_kind = 'person' and level = 'allowed' and roles = array['owner_admin','care_coordinator','staffing_coordinator']`))[0].n === 4
    && (await q1(`select count(*)::int n from public.action_authority where actor_kind in ('job','employee') and level = 'never'`))[0].n === 8
    && (await q1('select count(*)::int n from public.action_authority_log'))[0].n === 12)
  const tryQ = async (q, setup = '') => { await db.exec('begin'); try { if (setup) await db.exec(setup); await db.exec(q); return 'ok' } catch (e) { return 'refused: ' + e.message } finally { await db.exec('rollback') } }
  ck('PGLITE: even the database owner cannot change a row directly (update, insert, delete refused by the guard)', (await tryQ(`update public.action_authority set level = 'autonomous' where actor_kind = 'employee'`)).includes('only be changed by an owner through authority_set')
    && (await tryQ(`insert into public.action_registry values ('x.y','x','x','',  'none', true)`)).startsWith('refused') && (await tryQ(`delete from public.action_authority`)).startsWith('refused'))
  ck('PGLITE: truncate refused on all three tables', (await tryQ('truncate public.action_authority cascade')).startsWith('refused') && (await tryQ('truncate public.action_authority_log')).startsWith('refused') && (await tryQ('truncate public.action_registry cascade')).startsWith('refused'))
  ck('PGLITE: the log is append-only even through the door (update and delete refused)', (await tryQ(`update public.action_authority_log set note = 'x'`, `select set_config('cc.authority_door','582',true)`)).includes('append-only')
    && (await tryQ(`delete from public.action_authority_log`, `select set_config('cc.authority_door','582',true)`)).includes('append-only'))
  const asRole = (role, uid, email) => `set local role ${role}; select set_config('test.uid', '${uid || ''}', true); select set_config('test.jwt', '${JSON.stringify({ email: email || '' })}', true);`
  ck('PGLITE: the server key cannot write the authority table (no grant), only read', (await tryQ(`update public.action_authority set level = 'never'`, asRole('service_role'))).includes('permission denied')
    && (await tryQ(`select * from public.action_authority`, asRole('service_role'))) === 'ok')
  ck('PGLITE: a signed-in office page can read but not write; anon cannot read', (await tryQ(`select * from public.action_authority_log`, asRole('authenticated', '00000000-0000-4000-8000-000000000001'))) === 'ok'
    && (await tryQ(`insert into public.action_authority_log (action, actor_kind, new_level, set_by) values ('a','person','never','x')`, asRole('authenticated', '00000000-0000-4000-8000-000000000001'))).includes('permission denied')
    && (await tryQ(`select * from public.action_authority`, 'set local role anon')).includes('permission denied'))
  const setQ = async (who, args) => { await db.exec('begin'); await db.exec(asRole('authenticated', who.uid, who.email)); try { const r = (await db.query(`select public.authority_set(${args}) as r`)).rows[0].r; await db.exec('commit'); return r } catch (e) { await db.exec('rollback'); return { error: e.message } } }
  const OWN = { uid: '00000000-0000-4000-8000-000000000009', email: 'Owner@CC.test' }, KRY = { uid: '00000000-0000-4000-8000-000000000001', email: 'krystal@cc.test' }
  let r = await setQ(KRY, `'call_place.place', 'person', '', 'never', '{}', 'test'`)
  ck('PGLITE: authority_set by a care coordinator: refused (owners only), nothing changed', r.outcome === 'refused' && r.reason === 'owners only' && (await q1(`select level from public.action_authority where action = 'call_place.place' and actor_kind = 'person'`))[0].level === 'allowed', r)
  r = await setQ({ uid: '', email: '' }, `'call_place.place', 'person', '', 'never', '{}', 'test'`)
  ck('PGLITE: authority_set with no sign-in: refused', r.outcome === 'refused' && r.reason === 'sign in first', r)
  r = await setQ(OWN, `'call_place.place', 'employee', '', 'approve', '{}', ''`)
  ck('PGLITE: authority_set without a note: refused (say why)', r.outcome === 'refused' && /note/.test(r.reason), r)
  r = await setQ(OWN, `'nothing.here', 'employee', '', 'approve', '{}', 'x'`)
  ck('PGLITE: authority_set on an unregistered action: refused', r.outcome === 'refused' && /not registered/.test(r.reason), r)
  r = await setQ(OWN, `'call_place.place', 'person', '', 'autonomous', '{}', 'x'`)
  ck('PGLITE: a level that does not fit the kind of caller: refused, nothing changed', r.outcome === 'refused' && /does not fit/.test(r.reason) && (await q1(`select level from public.action_authority where action = 'call_place.place' and actor_kind = 'person'`))[0].level === 'allowed', r)
  const ev0 = (await q1('select count(*)::int n from public.op_events'))[0].n
  r = await setQ(OWN, `'call_place.place', 'employee', '', 'recommend', '{}', 'test of the owner door'`)
  const logRow = (await q1(`select * from public.action_authority_log order by id desc limit 1`))[0], evRow = (await q1('select * from public.op_events order by id desc limit 1'))[0]
  ck('PGLITE: an owner changes a row: done; the table changed; the log has before, after, who and why', r.outcome === 'done' && r.old_level === 'never' && r.new_level === 'recommend'
    && (await q1(`select level, set_by from public.action_authority where action = 'call_place.place' and actor_kind = 'employee'`))[0].set_by === 'owner@cc.test'
    && logRow.old_level === 'never' && logRow.new_level === 'recommend' && logRow.set_by === 'owner@cc.test' && logRow.note === 'test of the owner door', [r, logRow])
  ck('PGLITE: ...and one event row: authority_changed, the owner as the actor, via admin', (await q1('select count(*)::int n from public.op_events'))[0].n === ev0 + 1 && evRow.verb === 'authority_changed' && evRow.actor_email === 'owner@cc.test'
    && evRow.actor_name === 'Samantha Owner' && evRow.via === 'admin' && evRow.action === 'authority.set' && /Samantha changed who may say who an unmatched call was with: employee from never to recommend/.test(evRow.summary), evRow)
  ck('PGLITE: after the owner door, the guard is closed again (a direct change in the same session is refused)', (await tryQ(`update public.action_authority set level = 'never'`)).startsWith('refused'))
  await db.exec(sq)
  ck('PGLITE: running 582 again never overwrites a row an owner changed', (await q1(`select level from public.action_authority where action = 'call_place.place' and actor_kind = 'employee'`))[0].level === 'recommend')
  await db.exec(rb)
  ck('PGLITE: the rollback removes the three tables and the function; the record keeps its rows', (await q1(`select to_regclass('public.action_authority') is null as gone, to_regprocedure('public.authority_set(text,text,text,text,text[],text)') is null as fn`))[0].gone
    && (await q1('select count(*)::int n from public.op_events'))[0].n === ev0 + 1)
  await db.exec(sq)
} else console.log('(PGLITE not set: the real-Postgres run of the SQL is skipped)')

const failed = res.filter((r) => !r[1])
for (const [n, ok, note] of res) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n      ' + note}`)
console.log(`\n${res.length - failed.length}/${res.length} passed${failed.length ? ' · FAIL' : ''}`)
process.exit(failed.length ? 1 : 0)
