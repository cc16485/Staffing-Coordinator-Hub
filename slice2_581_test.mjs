// 581 · Phase 1 Slice 2: change history for the operational records (app_data_history_581.sql).
//   node slice2_581_test.mjs                                    SQL scans + the installer's static checks
//   PGLITE=<path to @electric-sql/pglite> node slice2_581_test.mjs   also runs 418 then 581 (twice), the proof,
//                                                               the rollback, a randomized same-answer check against
//                                                               the 418 watcher, and the speed measurement, in a real Postgres
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const DASH = /[—―]/
const sq = fs.readFileSync('app_data_history_581.sql', 'utf8')
const rb = fs.readFileSync('app_data_history_581_rollback.sql', 'utf8')
const old = fs.readFileSync('app_data_history.sql', 'utf8')
const pf = fs.readFileSync('app_data_history_581_proof.sql', 'utf8')
const py = fs.readFileSync('slice2_history_581.py', 'utf8')
const KEYS = ['candidates', 'caregivers', 'ops_items', 'leads', 'coverage_cases', 'timekeeper_cases', 'staffing_plans', 'visit_changes', 'ops_settings']

// ── 1. the SQL, read ──
const code = sq.replace(/^--.*$/gm, '')
const lists = [...code.matchAll(/in \(('candidates'[^)]*)\)/g)].map((m) => m[1].replace(/\s+/g, ' ').split(',').map((s) => s.trim().replace(/'/g, '')))
ck('the watcher and both triggers name exactly the same 9 keys', lists.filter((l) => l.length > 3).length === 3 && lists.filter((l) => l.length > 3).every((l) => l.join() === KEYS.join()), lists)
ck('one transaction (begin ... commit), refuses if 418 is not installed', /^begin;/m.test(code) && /^commit;/m.test(code) && /581 refused: the 418 change history is not installed/.test(code))
ck('it only watches: an AFTER trigger that returns null, every failure caught', /after insert or update of data on public\.app_data/.test(code) && /after delete on public\.app_data/.test(code) && /exception when others then/.test(code) && !/raise exception/.test(code.split('$fn$')[1] || 'raise exception'))
ck('it never touches the table, its grants or its read rule (418 keeps those)', !/create table|alter table|grant |create policy|drop policy/i.test(code.replace(/revoke all on function public\.app_data_item_change_capture\(\)[^;]*;/, '')))
ck('names kept only for candidates, caregivers and leads', /named := k in \('candidates', 'caregivers', 'leads'\)/.test(code))
ck('the settings record names the settings that changed, never values', /if k = 'ops_settings' then/.test(code) && /values \(k, null, 'changed', f,/.test(code))
ck('no network calls in the watcher', !/net\.|http_post|http_get|pg_net/.test(code))
ck('no em dash in any 581 file', ![sq, rb, pf, py].some((t) => DASH.test(t)))
ck('the rollback is the reviewed 418 SQL, unchanged from its begin', rb.includes(old.slice(old.indexOf('begin;'))))
ck('proof: one DO block that always ends by raising PROBE_RESULT (rolled back)', /^do \$proof\$/m.test(pf) && (pf.match(/raise exception 'PROBE_RESULT/g) || []).length >= 1 && !/commit/i.test(pf.replace(/^--.*$/gm, '')))
ck('installer: checks the reviewed sha of all three SQL files before running anything', /SB_SQL_SHA/.test(py) && /SB_PROOF_SHA/.test(py) && /SB_ROLLBACK_SHA/.test(py) && /is not the reviewed version/.test(py))
ck('installer: the speed gate stops BEFORE the install when a save would be slower than half a second', /GATE_MS = 500/.test(py) && py.indexOf('PART 2 · SPEED') < py.indexOf('PART 3 · CHANGE'))
ck('installer: sends nothing (no GoHighLevel, Resend or function calls)', !/leadconnector|resend\.com|functions\/v1/.test(py))

// ── 2. in a real Postgres ──
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE)
  const db = new PGlite()
  const P = (i, o = {}) => ({ id: i, first: 'First' + i, last: 'Last' + i, phone: '41755500' + String(i).padStart(2, '0'), email: `p${i}@example.test`, status: 'new', ...o })
  const list = (n) => Array.from({ length: n }, (_, i) => P(i + 1))
  const W = (i, o = {}) => ({ id: 'ops_' + i, kind: 'call_back', title: 'Call back Mrs Example ' + i, detail: 'note text ' + 'x'.repeat(600), status: 'open', owner: 'krystal@example.test',
    history: Array.from({ length: 8 }, (_, j) => ({ at: '2026-10-0' + (1 + (j % 9)), by: 'Krystal', text: 'line ' + j + ' ' + 'y'.repeat(60) })), ...o })
  await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now(), version bigint default 0);
create function public.can_access_data_key(k text) returns boolean language sql stable as $$ select true $$;
alter table public.app_data enable row level security;
create policy app_data_rw on public.app_data for all to authenticated using (public.can_access_data_key(key)) with check (public.can_access_data_key(key));
grant select, insert, update, delete on public.app_data to authenticated, service_role;
-- the live per-item door (one-door proof): runs as the caller, finds the item by id, replaces it in place or appends
create function public.upsert_app_data_item(target_key text, item jsonb) returns void language plpgsql as $f$
declare idx int;
begin
  if coalesce(item->>'id', '') = '' then raise exception 'item.id required'; end if;
  insert into public.app_data (key, data) values (target_key, '[]'::jsonb) on conflict (key) do nothing;
  select i - 1 into idx from public.app_data a, jsonb_array_elements(a.data) with ordinality e(x, i) where a.key = target_key and x->>'id' = item->>'id' limit 1;
  if idx is null then update public.app_data set data = data || jsonb_build_array(item), updated_at = now() where key = target_key;
  else update public.app_data set data = jsonb_set(data, array[idx::text], item), updated_at = now() where key = target_key; end if;
end $f$;
grant execute on function public.upsert_app_data_item(text, jsonb) to authenticated, service_role;
insert into public.app_data (key, data) values ('candidates', '${JSON.stringify(list(60))}'), ('caregivers', '${JSON.stringify(list(5))}'),
  ('ops_items', '${JSON.stringify(Array.from({ length: 40 }, (_, i) => W(i + 1)))}'), ('leads', '[{"id":"L1","first":"Lead","last":"One","phone":"4175550101"}]'),
  ('coverage_cases', '[{"id":"cc1","status":"open"}]'), ('timekeeper_cases', '[{"id":"tk1","status":"open"}]'), ('staffing_plans', '[{"id":"sp1","hours":10}]'),
  ('visit_changes', '[{"id":"vc1","state":"proposed"}]'), ('ops_settings', '{"routing_live":false,"coverage_send_live":true,"quiet_start":"21:00"}'),
  ('automation_log', '[{"id":"a1"}]'), ('automation_heartbeats', '{"work-route":"2026-10-10"}');`)
  await db.exec(old)
  await db.exec(sq); await db.exec(sq)
  ck('PGLITE: 418 then 581 installs, and 581 installs again (safe to re-run)', true)
  const hist = async (w = 'true') => (await db.query(`select key, record_id, change, fields_changed, bulk_removed, actor, role, origin, names, error from public.app_data_item_change where ${w} order by id`)).rows
  const clear = () => db.exec('delete from public.app_data_item_change')
  const SIGNED = { role: 'authenticated', sub: 'u-1', email: 'krystal@example.test' }
  const asUser = async (q, params = [], claims = SIGNED, headers = { origin: 'https://cc.mo-care.com' }) => {
    await db.exec('begin')
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    if (headers) await db.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(headers)])
    await db.exec(`set local role ${claims.role === 'service_role' ? 'service_role' : 'authenticated'}`)
    try { const r = await db.query(q, params); await db.exec('commit'); return r } catch (e) { await db.exec('rollback'); return 'refused: ' + e.message }
  }
  const upsert = (key, item, claims, headers) => asUser('select public.upsert_app_data_item($1, $2)', [key, JSON.stringify(item)], claims, headers)

  // work item: one item changed through the real door, as a signed-in person
  await clear()
  await upsert('ops_items', W(7, { status: 'claimed', owner: 'samantha@example.test' }))
  let h = await hist()
  ck('PGLITE: a work item saved through upsert_app_data_item: ONE history line, with the actor (the Slice 2 gate)', h.length === 1 && h[0].key === 'ops_items' && h[0].record_id === 'ops_7' && h[0].change === 'changed'
    && h[0].fields_changed.join() === 'owner,status' && h[0].actor === 'krystal@example.test' && h[0].role === 'authenticated' && h[0].origin === 'https://cc.mo-care.com', h)
  ck('PGLITE: the work-item line has no name and no value (no title, owner email or note text)', h.length === 1 && h[0].names === null && !/Example|samantha@|claimed|note text/.test(JSON.stringify(h.map(({ actor, ...x }) => x))), h)
  await clear()
  await upsert('ops_items', W(41, { title: 'New card' }))
  h = await hist()
  ck('PGLITE: a new work item: one "added" line, no name kept', h.length === 1 && h[0].change === 'added' && h[0].record_id === 'ops_41' && h[0].names === null, h)
  await clear()
  await upsert('ops_items', W(41, { title: 'New card' }))
  ck('PGLITE: saving the same work item again unchanged records nothing', (await hist()).length === 0)
  // a server job
  await clear()
  await upsert('ops_items', W(3, { escalation: { at: 'now' } }), { role: 'service_role' }, null)
  h = await hist()
  ck('PGLITE: a server job\'s save is recorded as actor "server", role service_role', h.length === 1 && h[0].actor === 'server' && h[0].role === 'service_role' && h[0].fields_changed.join() === 'escalation', h)
  // leads keep names; the other operational lists are watched
  await clear()
  await upsert('leads', { id: 'L2', first: 'Mary', last: 'Newlead', phone: '4175550199' })
  await upsert('leads', { id: 'L1', first: 'Lead', last: 'One', phone: '4175550101', status: 'Converted' })
  for (const [k, it] of [['coverage_cases', { id: 'cc1', status: 'covered' }], ['timekeeper_cases', { id: 'tk1', status: 'resolved' }], ['staffing_plans', { id: 'sp1', hours: 12 }], ['visit_changes', { id: 'vc1', state: 'done' }]]) await upsert(k, it)
  h = await hist()
  ck('PGLITE: a new lead is recorded with first + last only; a changed lead with field names only', h.filter((x) => x.key === 'leads').map((x) => `${x.change}:${x.record_id}:${x.names}:${(x.fields_changed || []).join()}`).join('|') === 'added:L2:Mary Newlead:|changed:L1:null:status', h)
  ck('PGLITE: coverage cases, missed clock-in cases, staffing plans and visit changes are each recorded', ['coverage_cases', 'timekeeper_cases', 'staffing_plans', 'visit_changes'].every((k) => h.filter((x) => x.key === k && x.change === 'changed').length === 1), h)
  ck('PGLITE: no phone or value leaked from leads', !/4175550|Converted/.test(JSON.stringify(h)), h)
  // the settings record, saved whole (as app_data_save does)
  await clear()
  await asUser(`update public.app_data set data = data || '{"routing_live":true,"quiet_start":"20:00","new_switch":false}'::jsonb where key = 'ops_settings'`)
  h = await hist()
  ck('PGLITE: the settings record: ONE line naming the settings that changed (no values, no record id)', h.length === 1 && h[0].key === 'ops_settings' && h[0].record_id === null && h[0].change === 'changed'
    && h[0].fields_changed.join() === 'new_switch,quiet_start,routing_live' && h[0].actor === 'krystal@example.test' && !/20:00|true/.test(JSON.stringify(h[0].fields_changed)), h)
  await clear()
  await asUser(`update public.app_data set data = data where key = 'ops_settings'`)
  ck('PGLITE: a settings save that changes nothing records nothing', (await hist()).length === 0)
  // other keys untouched
  await clear()
  await asUser(`update public.app_data set data = data || '[{"id":"a2"}]'::jsonb where key = 'automation_log'`)
  await asUser(`update public.app_data set data = '{"work-route":"2026-10-11"}'::jsonb where key = 'automation_heartbeats'`)
  ck('PGLITE: logs and heartbeats are not watched (nothing recorded)', (await hist()).length === 0)
  // shifting and reordering: no false lines
  await clear()
  await asUser(`update public.app_data set data = (select jsonb_agg(x) from jsonb_array_elements(data) x where x->>'id' <> 'ops_2') where key = 'ops_items'`)
  h = await hist()
  ck('PGLITE: one work item removed from the middle: exactly one "removed" line (the 39 that moved up are not "changed")', h.length === 1 && h[0].change === 'removed' && h[0].record_id === 'ops_2' && !h[0].bulk_removed, h)
  await clear()
  await asUser(`update public.app_data set data = (select jsonb_agg(x order by x->>'id' desc) from jsonb_array_elements(data) x) where key = 'ops_items'`)
  ck('PGLITE: the same work items in a different order: nothing recorded', (await hist()).length === 0)
  // 418 behaviours still hold for candidates
  await clear()
  const next = list(60).filter((x) => x.id < 58).map((x) => x.id === 5 ? { ...x, status: 'ready', phone: '4170000000' } : x).concat([P(61, { first: 'Aimee', last: 'Newperson' })])
  await asUser('update public.app_data set data = $1 where key = $2', [JSON.stringify(next), 'candidates'])
  h = await hist()
  ck('PGLITE: candidates still: 1 changed (field names), 1 added (name), 3 removed in bulk (names), the actor on each', h.map((x) => x.change).sort().join() === 'added,changed,removed,removed,removed'
    && h.find((x) => x.change === 'changed').fields_changed.join() === 'phone,status' && h.find((x) => x.change === 'added').names === 'Aimee Newperson'
    && h.filter((x) => x.change === 'removed').every((x) => x.bulk_removed && /^First5[89]|^First60/.test(x.names)) && h.every((x) => x.actor === 'krystal@example.test'), h)
  // forced failure: the save still goes through
  await clear()
  await db.exec(`alter table public.app_data_item_change add constraint t_force check (change = 'trigger_error') not valid`)
  const r = await upsert('ops_items', W(9, { status: 'done' }))
  const saved = (await db.query(`select x->>'status' as s from public.app_data, jsonb_array_elements(data) x where key = 'ops_items' and x->>'id' = 'ops_9'`)).rows[0]?.s
  h = await hist()
  ck('PGLITE: the watcher failing never fails a work-item save; one trigger_error line instead', typeof r !== 'string' && saved === 'done' && h.length === 1 && h[0].change === 'trigger_error' && h[0].key === 'ops_items', [r, saved, h])
  await db.exec('alter table public.app_data_item_change drop constraint t_force')
  // the whole row deleted / created
  await clear()
  await db.exec(`delete from public.app_data where key = 'staffing_plans'`)
  h = await hist()
  ck('PGLITE: a whole operational row deleted: each record recorded as removed', h.length === 1 && h[0].key === 'staffing_plans' && h[0].change === 'removed', h)
  // read rules unchanged
  const as = async (role, q) => { await db.exec('begin'); await db.exec(`set local role ${role}`); try { const x = await db.query(q); return x.rows } catch (e) { return 'refused: ' + e.message } finally { await db.exec('rollback') } }
  ck('PGLITE: read rules unchanged: signed-in reads, cannot write; anon refused', Array.isArray(await as('authenticated', 'select count(*) from public.app_data_item_change'))
    && String(await as('authenticated', `insert into public.app_data_item_change (key, change) values ('ops_items', 'added')`)).startsWith('refused')
    && String(await as('anon', 'select count(*) from public.app_data_item_change')).startsWith('refused'))

  // ── same answers as the 418 watcher (randomized) ──
  // the 418 algorithm, in JS: index both lists by id and compare
  const expect = (a, b, named) => {
    const om = new Map(a.filter((x) => x && x.id != null && x.id !== '').map((x) => [String(x.id), x])), nm = new Map(b.filter((x) => x && x.id != null && x.id !== '').map((x) => [String(x.id), x]))
    const out = []; const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y)
    for (const [i] of om) if (!nm.has(i)) out.push('removed:' + i)
    for (const [i] of nm) if (!om.has(i)) out.push('added:' + i)
    for (const [i, n] of nm) if (om.has(i)) { const o = om.get(i); const f = [...new Set([...Object.keys(o), ...Object.keys(n)])].filter((k) => !eq(o[k], n[k])).sort(); if (f.length) out.push('changed:' + i + ':' + f.join(',')) }
    return out.sort()
  }
  let seed = 581; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const canon = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, canon(o[k])])) : o)
  let mism = []; let rounds = 0
  for (let t = 0; t < 120; t++) {
    let a = Array.from({ length: 5 + Math.floor(rnd() * 25) }, (_, i) => ({ id: 'w' + i, s: Math.floor(rnd() * 3), n: 'x' }))
    let b = a.map((x) => ({ ...x }))
    const ops = 1 + Math.floor(rnd() * 4)
    for (let o = 0; o < ops; o++) {
      const c = rnd(), j = Math.floor(rnd() * b.length)
      if (c < 0.3 && b.length) b[j] = { ...b[j], s: b[j].s + 1, ...(rnd() < 0.3 ? { extra: 1 } : {}) }
      else if (c < 0.5 && b.length) b.splice(j, 1)
      else if (c < 0.7) b.splice(j, 0, { id: 'n' + t + '_' + o, s: 0 })
      else if (c < 0.85 && b.length > 1) { const k = Math.floor(rnd() * b.length); [b[j], b[k]] = [b[k], b[j]] }
      else if (b.length) { const { n, ...rest } = b[j]; b[j] = rest }
    }
    await db.exec(`update public.app_data set data = '${JSON.stringify(a)}' where key = 'coverage_cases'`); await clear()
    await db.query('update public.app_data set data = $1 where key = $2', [JSON.stringify(b), 'coverage_cases'])
    const got = (await hist()).map((x) => x.change + ':' + x.record_id + (x.change === 'changed' ? ':' + x.fields_changed.join(',') : '')).sort()
    const want = expect(a.map(canon), b.map(canon))
    rounds++; if (got.join('|') !== want.join('|')) mism.push({ t, got, want })
  }
  ck(`PGLITE: randomized: the faster watcher gives exactly the 418 answer in ${rounds} random edits (changes, removes, inserts, swaps, removed fields)`, mism.length === 0, mism.slice(0, 2))

  // ── speed ──
  const N = Number(process.env.S2_N || 1500)
  const big = Array.from({ length: N }, (_, i) => W(i + 1))
  const bytes = JSON.stringify(big).length
  await db.exec(`update public.app_data set data = '${JSON.stringify(big).replace(/'/g, "''")}' where key = 'ops_items'`)
  const time = async (reps = 8) => { const ts = []; for (let i = 0; i < reps; i++) { const t0 = performance.now(); await upsert('ops_items', W(1 + ((i * 97) % N), { status: 's' + i + Math.random() })); ts.push(performance.now() - t0) } ts.sort((x, y) => x - y); return { med: ts[Math.floor(ts.length / 2)], max: ts[ts.length - 1] } }
  await db.exec('alter table public.app_data disable trigger app_data_item_change_t')
  const none = await time()
  await db.exec('alter table public.app_data enable trigger app_data_item_change_t')
  const s581 = await time()
  // the 418 algorithm on the same list, for comparison
  await db.exec(old.replace(/'candidates', 'caregivers'/g, `'candidates', 'caregivers', 'ops_items'`))
  const s418 = await time()
  await db.exec(sq)
  const f = (x) => `${x.med.toFixed(0)} ms (slowest ${x.max.toFixed(0)})`
  console.log(`  speed, ${N} work items (${(bytes / 1e6).toFixed(1)} MB), one item saved through upsert_app_data_item, in WebAssembly Postgres:\n    no history ${f(none)} · 581 watcher ${f(s581)} · 418-style full comparison ${f(s418)}`)
  ck(`PGLITE: speed: with ${N} work items the 581 watcher adds less than 100 ms to a one-item save (${f(none)} without, ${f(s581)} with)`, s581.med - none.med < 100, { none, s581, s418 })
  ck('PGLITE: speed: the 581 watcher is faster than the 418 full comparison on a long list', s581.med < s418.med, { s581, s418 })

  // ── the installer's proof, here: nothing stays ──
  await db.exec(`update public.app_data set data = '${JSON.stringify(Array.from({ length: 40 }, (_, i) => W(i + 1)))}' where key = 'ops_items'`)
  const snap = async () => (await db.query(`select (select count(*) from public.app_data_item_change)::int as n, (select md5(string_agg(key || md5(data::text), ',' order by key)) from public.app_data) as m`)).rows[0]
  const before = await snap(); let probe = null
  try { await db.exec(pf) } catch (e) { probe = e.message }
  const after = await snap()
  const J = probe && probe.includes('PROBE_RESULT: ') ? JSON.parse(probe.split('PROBE_RESULT: ')[1]) : null
  ck('PGLITE proof: a signed-in work-item save left one line with the proof actor; settings one line; a server save "server"', J && J.item_rows?.length === 1 && J.item_rows[0].change === 'changed' && J.item_rows[0].fields_changed.join() === '_proof_581'
    && J.item_rows[0].actor === 'proof-581@invalid.test' && J.item_rows[0].role === 'authenticated' && J.settings_rows?.length === 1 && J.settings_rows[0].fields_changed.join() === '_proof_581'
    && J.server_rows?.length === 1 && J.server_rows[0].actor === 'server', J || probe)
  ck('PGLITE proof: the watcher forced to fail still saved, with one trigger_error line', J && J.error_saved === true && J.error_rows === 1, J)
  ck('PGLITE proof: nothing stayed (every app_data value and the history count are as before)', before.n === after.n && before.m === after.m && (await db.query(`select count(*)::int as n from pg_constraint where conname = 'proof_581_force_error'`)).rows[0].n === 0, [before, after])

  // ── the rollback ──
  await db.exec(rb); await clear()
  await upsert('ops_items', W(5, { status: 'after-rollback' }))
  await asUser('update public.app_data set data = $1 where key = $2', [JSON.stringify(list(59)), 'candidates'])
  h = await hist()
  ck('PGLITE: the rollback puts 418 back: work items no longer recorded, candidates still are', h.length > 0 && h.every((x) => x.key === 'candidates'), h)

  // ── the installer's speed probe, from the 418 state: times, then nothing stays ──
  const sp = fs.readFileSync('app_data_history_581_speed.sql', 'utf8')
  const body = sq.replace(/^begin;\s*$|^commit;\s*$/gm, '')
  const trg = async () => (await db.query(`select pg_get_triggerdef(oid) as d from pg_trigger where tgrelid = 'public.app_data'::regclass and tgname = 'app_data_item_change_t'`)).rows[0].d
  const b5 = await snap(); let sprobe = null
  try { await db.exec(sp.replace('-- 581 INSTALL GOES HERE', body)) } catch (e) { sprobe = e.message }
  const SJ = sprobe && sprobe.includes('PROBE_RESULT: ') ? JSON.parse(sprobe.split('PROBE_RESULT: ')[1]) : null
  const a5 = await snap()
  ck('PGLITE speed probe: times every watched key before and after, and the watcher wrote lines in the trial', SJ && ['ops_items', 'leads', 'coverage_cases', 'timekeeper_cases', 'visit_changes', 'ops_settings', 'candidates', 'caregivers'].every((k) => SJ.times[k] && SJ.times[k].after_max != null && SJ.times[k].before_max != null && SJ.times[k].lines >= 5)
    && SJ.sizes.ops_items.n === 40 && SJ.sizes.ops_settings.n === null, SJ || sprobe)
  ck('PGLITE speed probe: nothing stayed (the 418 watcher is still the live one; every value and the history count unchanged)', !/ops_items/.test(await trg()) && b5.n === a5.n && b5.m === a5.m, [b5, a5])
  await db.exec(sq)
} else console.log('(PGLITE not set: the real-Postgres run of the SQL is skipped)')

const failed = res.filter((r) => !r[1])
for (const [n, ok, note] of res) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n      ' + note}`)
console.log(`\n${res.length - failed.length}/${res.length} passed${failed.length ? ' · FAIL' : ''}`)
process.exit(failed.length ? 1 : 0)
