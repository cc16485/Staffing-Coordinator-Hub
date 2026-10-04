// 438 · the caregiver connect job (_shared/cg-connect.ts + caregiver-connect/index.ts) against a fake database, with
// the REAL rules file from the Hub (../cc-hub-live/caregiver-connect-rules.js). The database writer itself
// (caregiver_connect_apply) is proven on a real Postgres in cg_connect_sql_test.py.
// node cg_connect_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const RULES_PATH = process.env.CG_RULES || path.join(ROOT, '..', 'cc-hub-live', 'caregiver-connect-rules.js')
const ELIG_PATH = process.env.CG_ELIG || path.join(ROOT, '..', 'cc-hub-live', 'eligibility-rules.js')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 700)])
globalThis.Deno = { env: { get: () => '' } }
const J = await import(path.join(FN, '_shared/cg-connect.ts'))
const SRC = fs.readFileSync(RULES_PATH, 'utf8'), ESRC = fs.readFileSync(ELIG_PATH, 'utf8')
const clone = (x) => JSON.parse(JSON.stringify(x))

/* ── a fake database: app_data rows, the connect tables, rpc calls recorded ── */
function fakeDb(init) {
  const t = { app_data: clone(init.app_data), caregiver_connect_runs: [], caregiver_connect_log: clone(init.log ?? []),
    caregiver_connect_blocked: clone(init.blocked ?? []), domains: [{ code: 'caregivers', entity: 'cc_ihs', owner_person: 'p1' }], persons: [{ person_id: 'p1', primary_email: 'angiel@mo-care.com' }] }
  const calls = []
  const applyResults = init.applyResults ?? {}
  function q(table) {
    let rows = () => t[table] ?? []
    const filters = []; let ord = null, lim = null
    const run = () => {
      let r = rows().filter((x) => filters.every((f) => f(x)))
      if (ord) r = r.slice().sort((a, b) => (ord.asc ? 1 : -1) * String(a[ord.k]).localeCompare(String(b[ord.k])))
      if (lim != null) r = r.slice(0, lim)
      return r
    }
    const b = {
      select() { return b },
      eq(k, v) { filters.push((x) => String(x[k]) === String(v)); return b },
      in(k, vs) { filters.push((x) => vs.includes(x[k])); return b },
      order(k, o) { ord = { k, asc: !!o?.ascending }; return b },
      limit(n) { lim = n; return b },
      async maybeSingle() { if (init.fail?.[table]) return { data: null, error: { message: 'down' } }; return { data: run()[0] ?? null, error: null } },
      then(ok, ko) { const v = init.fail?.[table] ? { data: null, error: { message: 'down' } } : { data: run(), error: null }; return Promise.resolve(v).then(ok, ko) },
      async insert(row) { t[table].push({ at: new Date().toISOString(), ...row }); return { error: null } },
    }
    return b
  }
  return {
    t, calls,
    from: (table) => q(table),
    async rpc(name, args) {
      calls.push([name, clone(args)])
      if (name === 'upsert_app_data_item') {
        const row = t.app_data.find((r) => r.key === args.target_key)
        const i = row.data.findIndex((x) => x.id === args.item.id)
        if (i >= 0) row.data[i] = args.item; else row.data.push(args.item)
        return { error: null }
      }
      if (name === 'caregiver_connect_practice') return { data: args.p_rows.length, error: null }
      if (name === 'caregiver_connect_apply') {
        const p = args.p
        if (applyResults[p.op]) return { data: applyResults[p.op], error: null }
        const cg = t.app_data.find((r) => r.key === 'caregivers').data
        if (p.op === 'link') { const r = cg.find((x) => String(x.id) === p.caregiver_id); r.axiscare_id = p.axiscare_id; r.connected = p.connected; return { data: { ok: true, log_id: 1 }, error: null } }
        if (p.op === 'move' || p.op === 'create') {
          const id = 100 + cg.length; cg.push({ ...p.record, id })
          if (p.op === 'move') { const cd = t.app_data.find((r) => r.key === 'candidates'); cd.data = cd.data.filter((k) => String(k.id) !== p.candidate_id) }
          return { data: { ok: true, log_id: 2, caregiver_id: id }, error: null }
        }
        return { data: { ok: true, log_id: 9 }, error: null }
      }
      return { error: { message: 'unknown rpc ' + name } }
    },
  }
}
const CASEY = { id: 50, first: 'Casey', last: 'Moreno', phone: '417.555.0103', oos: 'no', orient_session_date: '2026-09-25', oig: 'Clear', oig_date: '2026-09-10', r1n: 'Ref One', r1s: 'Received', _rev: 4 }
const census = [
  { id: '101', first: 'Jordan', last: 'Pike', mobile: '1-417-555-0101', active: true, hire_date: '2026-09-01' },
  { id: '103', first: 'Casey', last: 'Moreno', mobile: '1-417-555-0103', active: true, hire_date: '2026-09-30' },
  { id: '104', first: 'Quinn', last: 'Ashby', mobile: '1-417-555-0104', active: true },
  { id: '105', first: 'Taylor', last: 'Brandt', mobile: '1-417-555-0105', active: true },
  { id: '110', first: 'Blake', last: 'Hart', mobile: '1-417-555-0110', active: true },
  { id: '107', first: 'Avery', last: 'Cole', mobile: '1-417-555-0107', active: false },
]
const world = (live, extra = {}) => ({
  app_data: [
    { key: 'ops_settings', data: live ? { cg_connect_live: true } : {} },
    { key: 'caregivers', data: [{ id: 20, first: 'Jo', last: 'Pike', phone: '(417) 555-0101', _rev: 2 }, { id: 22, first: 'Tayler', last: 'Brandt', phone: '4175559999' },
      { id: 27, first: 'Blake', last: 'Hart', axiscare_id: '110' }] },
    { key: 'candidates', data: [clone(CASEY)] },
    { key: 'ops_items', data: extra.items ?? [{ id: 'ops_cgconnect_110', kind: 'caregiver_connect', status: 'open', title: 'Connect caregiver: Blake Hart' }] },
  ], ...extra,
})
const okDeps = (over = {}) => ({ census: async () => ({ ok: true, rows: clone(census), total: census.length, truncated: false }), rules: async () => ({ ok: true, C: J.rulesFrom(SRC), E: J.eligFrom(ESRC) }), ...over })
const NOW = new Date('2026-10-04T15:17:00Z')

// the rules file, as the server runs it
const C = J.rulesFrom(SRC)
ck('the Hub rules file runs in its own scope on the server (nothing left on the globals)', typeof C.plan === 'function' && globalThis.CCConnect === undefined)
let threw = ''; try { J.rulesFrom('var x = 1') } catch (e) { threw = e.message }
ck('a file that does not define the rules is refused', /did not define/.test(threw))
ck("rev reads like the database's app_data_rev", J.rev({ _rev: 3 }) === 3 && J.rev({ _rev: '7' }) === 7 && J.rev({}) === 0 && J.rev({ _rev: 'x' }) === 0 && J.rev({ _rev: -1 }) === 0)

// practice
{
  const db = fakeDb(world(false))
  const r = await J.runJob(db, okDeps(), { caller: 'cron', runId: 'r1', now: NOW })
  const pr = db.calls.find((c) => c[0] === 'caregiver_connect_practice')
  ck('practice: counts what it would do', r.ok && r.mode === 'practice' && r.linked === 1 && r.moved === 1 && r.created === 1 && r.review === 1 && r.census_active === 5, r)
  ck('practice: the list holds every would-do, with names and how', pr && pr[1].p_mode === 'practice' && JSON.stringify(pr[1].p_rows.map((x) => [x.action, x.axiscare_id, x.how ?? ''])) === JSON.stringify([['link', '101', 'phone'], ['move', '103', 'phone'], ['create', '104', 'new'], ['review', '105', '']])
    && pr[1].p_rows[0].record_name === 'Jo Pike' && /similar/.test(pr[1].p_rows[3].why) && pr[1].p_rows[3].options[0].text.includes('Tayler Brandt'), pr)
  ck('practice: nothing is connected, moved or started; no Needs Attention items', !db.calls.some((c) => c[0] === 'caregiver_connect_apply' || c[0] === 'upsert_app_data_item'), db.calls.map((c) => c[0]))
  ck('practice: one run line', db.t.caregiver_connect_runs.length === 1 && db.t.caregiver_connect_runs[0].mode === 'practice' && db.t.caregiver_connect_runs[0].ok === true)
}
// dry
{
  const db = fakeDb(world(false))
  const r = await J.runJob(db, okDeps(), { caller: 'owner', runId: 'r1', dry: true, now: NOW })
  ck('dry: counts only, records nothing at all', r.dry && r.linked === 1 && db.calls.length === 0 && db.t.caregiver_connect_runs.length === 0, [r, db.calls])
}
// live
{
  const db = fakeDb(world(true))
  const r = await J.runJob(db, okDeps(), { caller: 'cron', runId: 'r2', now: NOW })
  const ap = db.calls.filter((c) => c[0] === 'caregiver_connect_apply').map((c) => c[1].p)
  ck('live: link, move and create go through the one writer, by the job', r.ok && r.mode === 'live' && JSON.stringify(ap.map((p) => [p.op, p.axiscare_id])) === JSON.stringify([['link', '101'], ['move', '103'], ['create', '104']]) && ap.every((p) => p.by === 'auto' && p.run_id === 'r2'), [r, ap])
  const L = ap[0]
  ck('live link: the record and the _rev the job saw, how, when', L.caregiver_id === '20' && L.base_rev === 2 && L.how === 'phone' && L.connected.by === 'auto' && L.connected.at === NOW.toISOString())
  const M = ap[1]
  const E = J.eligFrom(ESRC)
  const btn = C.recordFromCandidate(clone(CASEY), '2026-09-30', '2026-09-25', { promoted_at: NOW.toISOString(), hiring_snapshot: E.hiringSnapshot(clone(CASEY)) })
  const strip = (x) => { const y = clone(x); delete y.axiscare_id; delete y.connected; delete y.id; if (y.hiring_snapshot) delete y.hiring_snapshot.at; return y }
  ck('live move: the record is exactly the Move to caregiver record (+ AxisCare id + how), from the candidate _rev it saw', M.candidate_id === '50' && M.cand_base_rev === 4
    && JSON.stringify(strip(M.record)) === JSON.stringify(strip(btn)) && M.record.axiscare_id === '103' && M.record.connected.from === 'background & references' && M.record.hire_date === '2026-09-30', [M.record, btn])
  ck('live move: the hire snapshot is saved, as the button now saves it (why they were allowed to be hired)', M.record.hiring_snapshot && M.record.hiring_snapshot.event === 'pre_hire_clearance'
     && M.record.hiring_snapshot.oig === 'Clear' && M.record.hiring_snapshot.refs === 'Received|||' && Array.isArray(M.record.hiring_snapshot.outstanding), M.record.hiring_snapshot)
  ck('the hiring rules run in their own scope too (nothing left on the globals)', globalThis.CCElig === undefined)
  const N = ap[2]
  ck('live create: an empty record with their AxisCare id, "auto from AxisCare"', N.record.axiscare_id === '104' && N.record.created_via === 'auto from AxisCare' && !('prehire' in N.record) && N.record.connected.how === 'new')
  const items = db.t.app_data.find((x) => x.key === 'ops_items').data
  const it = items.find((x) => x.id === 'ops_cgconnect_105')
  ck('live: one Needs Attention item for the caregiver a person must decide about, owned by the caregivers owner', it && it.kind === 'caregiver_connect' && it.domain === 'caregivers' && it.title === 'Connect caregiver: Taylor Brandt'
    && /Tayler Brandt \(Hub record; similar name\)/.test(it.detail) && /name is similar/.test(it.detail) && it.owner === 'angiel@mo-care.com' && !/—/.test(it.detail + it.title + it.next_action), it)
  ck('live: the item for a caregiver now connected is closed', items.find((x) => x.id === 'ops_cgconnect_110').status === 'done')
  const lr = db.calls.find((c) => c[0] === 'caregiver_connect_practice')
  ck('live: the needs-a-look list carries only the reviews', lr[1].p_mode === 'live' && lr[1].p_rows.length === 1 && lr[1].p_rows[0].action === 'review')
  ck('live: one run line with what was done', db.t.caregiver_connect_runs[0].linked === 1 && db.t.caregiver_connect_runs[0].moved === 1 && db.t.caregiver_connect_runs[0].created === 1 && db.t.caregiver_connect_runs[0].ok)
  const db2 = fakeDb(world(true, { items: [{ id: 'ops_cgconnect_105', status: 'done', closed_by: 'Krystal', title: 'x' }] }))
  await J.runJob(db2, okDeps(), { caller: 'cron', runId: 'r3', now: NOW })
  const it2 = db2.t.app_data.find((x) => x.key === 'ops_items').data.filter((x) => x.id === 'ops_cgconnect_105')
  ck('live: an item a person closed stays closed (never doubled)', it2.length === 1 && it2[0].status === 'done' && it2[0].closed_by === 'Krystal')
}
// refused
{
  const db = fakeDb(world(true, { applyResults: { link: { ok: false, reason: 'changed' } } }))
  const r = await J.runJob(db, okDeps(), { caller: 'cron', runId: 'r4', now: NOW })
  ck('a refused change (someone edited the record) is counted, the rest still go, tried again next hour', r.refused === 1 && r.moved === 1 && r.linked === 0 && r.ok, r)
}
// failures
{
  const db = fakeDb(world(true))
  const r = await J.runJob(db, okDeps({ census: async () => ({ ok: false, error: 'AxisCare answered 503 on page 1' }) }), { caller: 'cron', runId: 'f1', now: NOW })
  ck('AxisCare down: nothing changes, the run says why', !r.ok && /AxisCare could not be read \(AxisCare answered 503/.test(r.error) && !db.calls.some((c) => c[0] === 'caregiver_connect_apply') && db.t.caregiver_connect_runs[0].ok === false, r)
  ck('...one failed run opens no item yet', !db.t.app_data.find((x) => x.key === 'ops_items').data.some((x) => x.id === J.FAILING_ID))
  const bad = okDeps({ rules: async () => ({ ok: false, error: 'rules file not approved: caregiver-connect-rules.js (fingerprint abc)' }) })
  await J.runJob(db, bad, { caller: 'cron', runId: 'f2', now: NOW })
  await J.runJob(db, bad, { caller: 'cron', runId: 'f3', now: NOW })
  const f = db.t.app_data.find((x) => x.key === 'ops_items').data.find((x) => x.id === J.FAILING_ID)
  ck('3 scheduled runs in a row that could not run: one Needs Attention item', f && f.status === 'open' && /could not run 3 times in a row/.test(f.detail) && !/—/.test(f.detail), f)
  await J.runJob(db, bad, { caller: 'cron', runId: 'f4', now: NOW })
  ck('...not doubled by a 4th', db.t.app_data.find((x) => x.key === 'ops_items').data.filter((x) => x.id === J.FAILING_ID).length === 1)
  const r2 = await J.runJob(db, okDeps(), { caller: 'cron', runId: 'ok1', now: NOW })
  ck('...and closed when it runs again', r2.ok && db.t.app_data.find((x) => x.key === 'ops_items').data.find((x) => x.id === J.FAILING_ID).status === 'done')
  const db3 = fakeDb(world(true))
  for (const id of ['o1', 'o2', 'o3']) await J.runJob(db3, bad, { caller: 'owner', runId: id, now: NOW })
  ck("the owner's own test runs never raise the item (only the schedule's)", !db3.t.app_data.find((x) => x.key === 'ops_items').data.some((x) => x.id === J.FAILING_ID))
  const db4 = fakeDb({ ...world(true), fail: { caregiver_connect_blocked: true } })
  const r4 = await J.runJob(db4, okDeps(), { caller: 'cron', runId: 'b1', now: NOW })
  ck('the undone pairs unreadable: nothing changes (never risk redoing an undo)', !r4.ok && /undone connections could not be read/.test(r4.error) && !db4.calls.some((c) => c[0] === 'caregiver_connect_apply'), r4)
}
// undone pairs are honoured
{
  const db = fakeDb(world(true, { blocked: [{ axiscare_id: '101', kind: 'caregiver', record_id: '20' }] }))
  const r = await J.runJob(db, okDeps(), { caller: 'cron', runId: 'u1', now: NOW })
  ck('"Not this person": the job never links that pair again; a person decides', r.linked === 0 && r.review === 2 && !db.calls.some((c) => c[0] === 'caregiver_connect_apply' && c[1].p.axiscare_id === '101'), r)
}
// manual
{
  const staff = { name: 'Angiel Falig', email: 'angiel@mo-care.com' }
  const db = fakeDb(world(true, { items: [{ id: 'ops_cgconnect_105', kind: 'caregiver_connect', status: 'open', title: 'x' }] }))
  const r = await J.manualAction(db, okDeps(), staff, { action: 'link', axiscare_id: '105', caregiver_id: '22' })
  const p = db.calls.find((c) => c[0] === 'caregiver_connect_apply')[1].p
  ck('Connect card, "This is their Hub record": through the one writer, as that person', r.ok && p.op === 'link' && p.mode === 'manual' && p.by === 'angiel@mo-care.com' && p.connected.by === 'Angiel Falig' && p.connected.how === 'manual' && !('base_rev' in p), [r, p])
  const it = db.t.app_data.find((x) => x.key === 'ops_items').data.find((x) => x.id === 'ops_cgconnect_105')
  ck('...and their Needs Attention item is closed by that person', it.status === 'done' && it.closed_by === 'Angiel Falig')
  const db2 = fakeDb(world(true))
  const m = await J.manualAction(db2, okDeps(), staff, { action: 'move', axiscare_id: '103', candidate_id: '50' })
  const mp = db2.calls.find((c) => c[0] === 'caregiver_connect_apply')[1].p
  ck('"Move over from Background & References": the button\'s record, the candidate _rev it read', m.ok && mp.op === 'move' && mp.cand_base_rev === 4 && mp.record.candidate_id === 50 && mp.record.connected.by === 'Angiel Falig' && mp.record.hiring_snapshot && mp.record.hiring_snapshot.event === 'pre_hire_clearance', mp)
  const n = await J.manualAction(fakeDb(world(true)), okDeps(), staff, { action: 'new', axiscare_id: '105' })
  ck('"Start a new Hub record"', n.ok && /new Hub record/.test(n.message))
  const nf = await J.manualAction(fakeDb(world(true)), okDeps(), staff, { action: 'link', axiscare_id: '999', caregiver_id: '22' })
  ck('a caregiver AxisCare does not have: refused, nothing changed', !nf.ok && nf.status === 404)
  const down = await J.manualAction(fakeDb(world(true)), okDeps({ census: async () => ({ ok: false, error: 'x' }) }), staff, { action: 'new', axiscare_id: '105' })
  ck('AxisCare down: the card says so, nothing changed', !down.ok && /AxisCare could not be read/.test(down.message))
  const gone = await J.manualAction(fakeDb(world(true)), okDeps(), staff, { action: 'move', axiscare_id: '103', candidate_id: '77' })
  ck('a candidate no longer there: refused', !gone.ok && /no longer in Background/.test(gone.message))
  const refused = await J.manualAction(fakeDb(world(true, { applyResults: { create: { ok: false, reason: 'already_connected', message: 'This caregiver is already connected to a Hub record, so nothing was changed.' } } })), okDeps(), staff, { action: 'new', axiscare_id: '101' })
  ck("the writer's refusal is shown in its own words", !refused.ok && refused.status === 409 && /already connected/.test(refused.message))
  const dbU = fakeDb({ ...world(true), log: [{ id: 7, action: 'move', result: 'done' }, { id: 8, action: 'review', result: 'would' }] })
  const u = await J.manualAction(dbU, okDeps(), staff, { action: 'undo', log_id: 7 })
  const up = dbU.calls.find((c) => c[0] === 'caregiver_connect_apply')[1].p
  ck('"Not this person" on a move: unmove, by that person', u.ok && up.op === 'unmove' && up.log_id === 7 && up.by === 'angiel@mo-care.com' && /back in Background/.test(u.message), [u, up])
  const u2 = await J.manualAction(dbU, okDeps(), staff, { action: 'undo', log_id: 8 })
  ck('...a list entry that is not a done connection cannot be undone', !u2.ok && u2.status === 404)
  ck('unknown actions are refused', (await J.manualAction(dbU, okDeps(), staff, { action: 'delete' })).status === 400)
}
// the function's wiring
const IX = fs.readFileSync(path.join(FN, 'caregiver-connect/index.ts'), 'utf8')
ck('index: the job answers only its schedule or the owner; staff actions need an office role', /const caller = await jobCaller\(req\)\s*\n\s*if \(!caller\) return json\(\{ error: 'not allowed' \}, 401\)/.test(IX) && /requireStaff\(db, req, OFFICE_ROLES\)/.test(IX))
ck('index: ?dry=1 is the owner\'s only', /if \(dry && caller !== 'owner'\) return json/.test(IX))
ck('index: the rules are the approved Hub files only (connect rules + hiring rules)', /approvedRules\(db, RULES_FILE\)/.test(IX) && /approvedRules\(db, ELIG_FILE\)/.test(IX) && J.RULES_FILE === 'caregiver-connect-rules.js' && J.ELIG_FILE === 'eligibility-rules.js')
ck('index: answers the browser (CORS on every answer, OPTIONS)', /req\.method === 'OPTIONS'/.test(IX) && /Access-Control-Allow-Origin/.test(IX))
const all = IX + fs.readFileSync(path.join(FN, '_shared/cg-connect.ts'), 'utf8') + fs.readFileSync(path.join(FN, '_shared/axis-census.ts'), 'utf8')
ck('sends nothing: no texting, email or AxisCare write anywhere in it', !/ghl|sendSms|send-candidate|resend|leadconnector|method:\s*'(POST|PUT|PATCH|DELETE)'/i.test(all.replace(/req\.method/g, '')))
ck('no em dash', !/—/.test(all))
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
