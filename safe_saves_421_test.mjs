// 421 · safe saves part 2: app_data.version, per-person _rev, app_data_items_apply, app_data_save.
//   node safe_saves_421_test.mjs                                   SQL scans only
//   PGLITE=<path to @electric-sql/pglite> node safe_saves_421_test.mjs   also runs the SQL (twice, alongside the 418
//                                                                     history) and the installer's proof in a real Postgres
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 900)])
const DASH = /[—―]/
const sq = fs.readFileSync('safe_saves_2.sql', 'utf8'); const pf = fs.readFileSync('safe_saves_2_proof.sql', 'utf8')
const code = sq.replace(/^\s*--.*$/gm, '')

// ── 1. the SQL (scans) ──
ck('SQL: one transaction, with a lock wait limit', /^begin;\nset local lock_timeout = '5s';/m.test(sq) && /^commit;\s*$/m.test(sq) && (code.match(/^begin;/gm) || []).length === 1)
ck('SQL: no grant or revoke on app_data itself, no blanket grant, no truncate, nothing dropped but its own trigger and policy',
  !/(grant|revoke)[^;]* on (table )?public\.app_data\b(?!_)/i.test(code) && !/grant all/i.test(code) && !/truncate/i.test(code) && !/drop (table|function|column)/i.test(code)
  && (code.match(/drop (trigger|policy) if exists/g) || []).length === 2, code.match(/(grant|revoke)[^;]*;/g))
const grants = (code.match(/\bgrant [^;]*;/g) || [])
ck('SQL: the only grants are EXECUTE on the two new saves to authenticated, and SELECT on the refusal log', grants.length === 3
  && grants.filter((g) => /^grant execute on function public\.app_data_(items_apply|save)\(/.test(g) && / to authenticated;$/.test(g)).length === 2
  && grants.some((g) => g === 'grant select on public.app_data_conflict_log to authenticated;'), grants)
ck('SQL: the per-person save runs as owner with a pinned search_path and a 3 second lock limit; it locks the row',
  /app_data_items_apply[\s\S]*?language plpgsql security definer\nset search_path = pg_catalog, public, pg_temp\nset lock_timeout = '3s'/.test(sq) && /where key = p_key for update;/.test(sq))
ck('SQL: app_data_save runs as the caller (every app_data rule still applies)', /app_data_save[\s\S]*?language plpgsql security invoker/.test(sq))
ck('SQL: only candidates and caregivers go through the per-person save', /if p_key is null or p_key not in \('candidates', 'caregivers'\) then/.test(sq))
ck('SQL: signed-in only, and the key-access check, before anything is read', sq.indexOf("raise exception 'app_data_items_apply: sign in first'") < sq.indexOf('for update;')
  && sq.indexOf('public.can_access_data_key(p_key)') < sq.indexOf('for update;'))
ck('proof: a single DO block that always ends by raising PROBE_RESULT (so it is rolled back)', /^do \$proof\$/m.test(pf) && (pf.match(/raise exception 'PROBE_RESULT/g) || []).length === 2 && !/commit/i.test(pf.replace(/^--.*$/gm, '')))
ck('proof: never returns a name or other field (only numbers and yes/no)', !/'first'|'last'|'name'|->>'first'/.test(pf.split("raise exception 'PROBE_RESULT: %', jsonb_build_object(\n    'a'")[1] || 'x'))
ck('no em dash in the SQL or the proof', !DASH.test(sq) && !DASH.test(pf))

// ── 2. in a real Postgres ──
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE)
  const db = new PGlite()
  const P = (i, o = {}) => ({ id: i, first: 'First' + i, last: 'Last' + i, phone: '41755500' + String(i).padStart(2, '0'), status: 'new', ...o })
  const list = (ids) => ids.map((i) => P(i))
  await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now());
create function public.can_access_data_key(k text) returns boolean language sql stable security definer as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'deny', '') <> k $$;
alter table public.app_data enable row level security;
create policy app_data_rw on public.app_data for all to authenticated using (public.can_access_data_key(key)) with check (public.can_access_data_key(key));
grant select, insert, update, delete on public.app_data to authenticated;
create function public.touch_app_data() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger trg_touch_app_data before update on public.app_data for each row execute function public.touch_app_data();
create table public.reference_requests (id serial primary key, candidate_id bigint);
insert into public.reference_requests (candidate_id) values (25), (3);
create table public.hire_intake (id serial primary key, candidate_id bigint);
insert into public.hire_intake (candidate_id) values (987654);
insert into public.app_data (key, data) values ('candidates', '${JSON.stringify(list([1, 2, 3, 4, 5, 20]))}'),
  ('caregivers', '${JSON.stringify([P(1), P(2, { candidate_id: 22 }), P(7)])}'), ('settings', '{"a":1}'), ('leads', '[{"id":"L1"}]');`)
  await db.exec(fs.readFileSync('app_data_history.sql', 'utf8'))
  await db.exec(sq); await db.exec(sq)
  ck('PGLITE: the SQL installs alongside the 418 history, and installs again (safe to re-run)', true)

  const q1 = async (s, p) => (await db.query(s, p)).rows
  const row = async (k) => (await q1('select data, version from public.app_data where key = $1', [k]))[0]
  const SIGNED = { role: 'authenticated', sub: 'u-1', email: 'krystal@example.test' }
  // run as a signed-in browser (or anon), always in its own transaction
  const as = async (claims, role, sql, params = []) => {
    await db.exec('begin')
    try {
      if (claims) await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
      await db.exec(`set local role ${role}`)
      const r = await db.query(sql, params); await db.exec('commit'); return r.rows
    } catch (e) { await db.exec('rollback'); return 'refused: ' + e.message }
  }
  const apply = async (key, changes, expected = null, claims = SIGNED) => {
    const r = await as(claims, 'authenticated', 'select public.app_data_items_apply($1, $2, $3) as r', [key, JSON.stringify(changes), expected && JSON.stringify(expected)])
    return typeof r === 'string' ? r : r[0].r
  }
  const recs = async (k) => (await row(k)).data
  const rec = async (k, id) => (await recs(k)).find((x) => String(x.id) === String(id))
  const clog = async () => q1('select key, actor, ids, reason from public.app_data_conflict_log order by id')

  // ── version ──
  let v0 = (await row('settings')).version
  await db.query(`update public.app_data set data = '{"a":2}' where key = 'settings'`)
  let v1 = (await row('settings')).version
  await db.query(`update public.app_data set data = '{"a":2}', version = 99 where key = 'settings'`)
  let v2 = (await row('settings')).version
  ck('PGLITE: version starts at 0, goes up by 1 when data changes, stays when it does not, and a writer cannot set it', v0 === 0 && v1 === 1 && v2 === 1, [v0, v1, v2])
  const lv = (await row('leads')).version
  await as(SIGNED, 'authenticated', `insert into public.app_data (key, data) values ('leads', '[{"id":"L2"}]') on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at`)
  ck('PGLITE: the Hub\'s ordinary upsert (insert ... on conflict) still works for a signed-in browser and bumps version', (await row('leads')).version === lv + 1 && (await row('leads')).data[0].id === 'L2')

  // ── a legacy whole-list save as a signed-in browser still works and stamps _rev ──
  let cur = await recs('candidates')
  let next = cur.map((x) => x.id === 2 ? { ...x, status: 'ready' } : x)
  let r = await as(SIGNED, 'authenticated', 'update public.app_data set data = $1 where key = $2', [JSON.stringify(next), 'candidates'])
  ck('PGLITE: an old whole-list save as a signed-in browser still goes through (the helpers it triggers need no grant)', Array.isArray(r), r)
  ck('PGLITE: the changed person gets _rev 1; the others are untouched (no _rev added)', (await rec('candidates', 2))._rev === 1 && !('_rev' in (await rec('candidates', 1))))
  // an old page saves a copy that still says _rev 0 for person 2 (same content) and changes person 3
  next = (await recs('candidates')).map((x) => x.id === 2 ? { ...x, _rev: 0 } : x.id === 3 ? { ...x, status: 'x' } : x)
  await db.query('update public.app_data set data = $1 where key = $2', [JSON.stringify(next), 'candidates'])
  ck('PGLITE: an old copy cannot wind a counter back (person 2 keeps _rev 1); person 3 changed -> _rev 1', (await rec('candidates', 2))._rev === 1 && (await rec('candidates', 3))._rev === 1)
  // an old page saves an OLDER version of person 2 (content differs) with _rev 0: still counts as a change -> _rev 2
  next = (await recs('candidates')).map((x) => x.id === 2 ? { ...x, status: 'new', _rev: 0 } : x)
  await db.query('update public.app_data set data = $1 where key = $2', [JSON.stringify(next), 'candidates'])
  ck('PGLITE: any change to a person moves _rev forward, whatever _rev the writer sent', (await rec('candidates', 2))._rev === 2)

  // ── the counter seed ──
  const seed = await q1(`select key, last_id from public.app_data_id_counter order by key`)
  ck('PGLITE: the number counter starts above every number used (candidates: reference request #25 beats the list max 20 and roster candidate_id 22; caregivers: 7); an AxisCare number in hire_intake is ignored',
    seed.length === 2 && Number(seed.find((s) => s.key === 'candidates').last_id) === 25 && Number(seed.find((s) => s.key === 'caregivers').last_id) === 7, seed)

  // ── add ──
  let hmax = (await q1('select coalesce(max(id), 0)::int as m from public.app_data_item_change'))[0].m
  let vb = (await row('candidates')).version
  r = await apply('candidates', [{ op: 'add', tmp: '-1', record: { id: 3, _rev: 9, first: 'Aimee', last: 'New' } }, { op: 'add', tmp: '-2', record: { first: 'Bo', last: 'Two' } }])
  ck('PGLITE: add: the database gives fresh numbers (26, 27), never the number the page sent, and says which tmp got which', r.ok === true && r.ids['-1'] === 26 && r.ids['-2'] === 27, r)
  const aimee = await rec('candidates', 26)
  ck('PGLITE: add: the record is stored with its new number, the old page number and _rev dropped (counts as 0)', aimee && aimee.first === 'Aimee' && !('_rev' in aimee) && (await recs('candidates')).filter((x) => x.id === 3).length === 1, aimee)
  ck('PGLITE: one save = one version step', r.version === vb + 1 && (await row('candidates')).version === vb + 1, [r.version, vb])
  let h = await q1(`select change, record_id, actor, role from public.app_data_item_change where id > $1 order by id`, [hmax])
  ck('PGLITE: the 418 history still records each added person, with who saved', h.length === 2 && h.every((x) => x.change === 'added' && x.actor === 'krystal@example.test' && x.role === 'authenticated') && h.map((x) => x.record_id).join() === '26,27', h)

  // ── numbers are never reused ──
  r = await apply('candidates', [{ op: 'remove', id: 27, base_rev: 0 }])
  ck('PGLITE: removing one person works', r.ok === true && !(await rec('candidates', 27)), r)
  r = await apply('candidates', [{ op: 'add', tmp: 'a', record: { first: 'Cy' } }])
  ck('PGLITE: the next new person gets 28, not the removed 27 (numbers are never reused)', r.ok && r.ids.a === 28, r)
  await db.query(`update public.app_data set data = data || '[{"id": 40, "first": "Legacy"}]'::jsonb where key = 'candidates'`)
  r = await apply('candidates', [{ op: 'add', tmp: 'b', record: { first: 'Di' } }])
  ck('PGLITE: a number added by an old whole-list save (40) is respected: next is 41', r.ok && r.ids.b === 41, r)

  // ── put + conflicts ──
  let p2 = await rec('candidates', 2)
  hmax = (await q1('select coalesce(max(id), 0)::int as m from public.app_data_item_change'))[0].m
  r = await apply('candidates', [{ op: 'put', id: 2, base_rev: p2._rev, record: { ...p2, status: 'checks', _rev: 0, id: 999 } }])
  const p2b = await rec('candidates', 2)
  ck('PGLITE: put based on the current _rev: saved, _rev up by 1 (reported back), the number kept', r.ok && r.revs['2'] === p2._rev + 1 && p2b._rev === p2._rev + 1 && p2b.status === 'checks' && !(await rec('candidates', 999)), [r, p2b])
  h = await q1(`select change, record_id, fields_changed from public.app_data_item_change where id > $1`, [hmax])
  ck('PGLITE: the history records the change by field name', h.length === 1 && h[0].change === 'changed' && h[0].fields_changed.includes('status'), h)
  const before = JSON.stringify(await recs('candidates')); const vbc = (await row('candidates')).version; const nlog = (await clog()).length
  r = await apply('candidates', [{ op: 'put', id: 2, base_rev: p2._rev, record: { ...p2, status: 'stale page' } }])
  ck('PGLITE: put based on an OLD _rev (a page that opened earlier): refused, with that person\'s current record', r.ok === false && r.reason === 'conflict'
    && r.conflicts.length === 1 && r.conflicts[0].id === 2 && r.conflicts[0].current_record.status === 'checks' && r.conflicts[0].current_record._rev === p2b._rev, r)
  ck('PGLITE: refused means nothing saved (list and version unchanged)', JSON.stringify(await recs('candidates')) === before && (await row('candidates')).version === vbc)
  let L = await clog()
  ck('PGLITE: the refusal is logged (key, who, which number, why), never the record', L.length === nlog + 1 && L.at(-1).reason === 'conflict' && L.at(-1).ids.join() === '2' && L.at(-1).actor === 'krystal@example.test', L)
  // all or nothing
  const p4 = await rec('candidates', 4)
  r = await apply('candidates', [{ op: 'put', id: 4, base_rev: 0, record: { ...p4, status: 'ok' } }, { op: 'add', tmp: 'z', record: { first: 'Zed' } }, { op: 'put', id: 2, base_rev: 0, record: { ...p2, status: 'old' } }])
  ck('PGLITE: one stale change in a save of three: NOTHING in it is saved (no add, no other put)', r.ok === false && r.conflicts.map((c) => c.id).join() === '2'
    && (await rec('candidates', 4)).status === 'new' && !(await recs('candidates')).some((x) => x.first === 'Zed') && (await row('candidates')).version === vbc, r)
  // two pages, two different people
  const p5 = await rec('candidates', 5)
  const ra = await apply('candidates', [{ op: 'put', id: 4, base_rev: 0, record: { ...p4, status: 'tab A' } }])
  const rb = await apply('candidates', [{ op: 'put', id: 5, base_rev: 0, record: { ...p5, status: 'tab B' } }])
  ck('PGLITE: two pages changing two different people, each from what it read: both saved', ra.ok && rb.ok && (await rec('candidates', 4)).status === 'tab A' && (await rec('candidates', 5)).status === 'tab B', [ra, rb])
  // no base_rev = no check (last write wins for that one record)
  r = await apply('candidates', [{ op: 'put', id: 5, record: { ...p5, status: 'no base' } }])
  ck('PGLITE: a put without base_rev is not checked (kept for server tools; the Hub always sends it)', r.ok && (await rec('candidates', 5)).status === 'no base')
  // gone / duplicate
  r = await apply('candidates', [{ op: 'put', id: 999, base_rev: 0, record: { first: 'Ghost' } }])
  ck('PGLITE: a change to someone no longer on the list: refused as gone (never re-added)', r.ok === false && r.conflicts[0].reason === 'gone' && r.conflicts[0].current_record === null && !(await recs('candidates')).some((x) => x.first === 'Ghost'), r)
  await db.query(`update public.app_data set data = data || '[{"id": 1, "first": "Dupe"}]'::jsonb where key = 'candidates'`)
  r = await apply('candidates', [{ op: 'put', id: 1, base_rev: 0, record: { first: 'Which' } }])
  ck('PGLITE: two people sharing a number (the Aimee case): a change to that number is refused as duplicate_id', r.ok === false && r.conflicts[0].reason === 'duplicate_id' && (await clog()).at(-1).reason === 'duplicate_id', r)
  r = await apply('candidates', [{ op: 'add', tmp: 'q', record: { first: 'Next' } }])
  ck('PGLITE: other saves still work while a duplicate exists', r.ok && r.ids.q === 42, r)
  await db.query(`update public.app_data set data = (select jsonb_agg(x) from jsonb_array_elements(data) x where x->>'first' <> 'Dupe') where key = 'candidates'`)

  // ── bulk removal ──
  const vbb = (await row('candidates')).version; const nb = (await recs('candidates')).length
  r = await apply('candidates', [{ op: 'remove', id: 4 }, { op: 'remove', id: 5 }, { op: 'remove', id: 20 }])
  ck('PGLITE: removing 3 people in one save is refused, nothing removed, logged as bulk_remove_refused', r.ok === false && r.reason === 'bulk_remove' && r.removes === 3
    && (await recs('candidates')).length === nb && (await row('candidates')).version === vbb && (await clog()).at(-1).reason === 'bulk_remove_refused', r)
  r = await apply('candidates', [{ op: 'remove', id: 4 }, { op: 'remove', id: 5 }])
  ck('PGLITE: removing 2 is allowed', r.ok && (await recs('candidates')).length === nb - 2, r)
  await apply('candidates', [{ op: 'add', tmp: '1', record: { first: 'B1' } }, { op: 'add', tmp: '2', record: { first: 'B2' } }, { op: 'add', tmp: '3', record: { first: 'B3' } }])
  const bIds = (await recs('candidates')).filter((x) => /^B\d$/.test(x.first)).map((x) => ({ op: 'remove', id: x.id }))
  r = await apply('candidates', [...bIds, { op: 'allow_bulk_remove' }])
  ck('PGLITE: with allow_bulk_remove the 3 go, and that is recorded too', r.ok && !(await recs('candidates')).some((x) => /^B\d$/.test(x.first)) && (await clog()).at(-1).reason === 'bulk_remove_allowed', r)

  // ── refusals: who and which key ──
  const anonR = await as(null, 'anon', `select public.app_data_items_apply('candidates', '[{"op":"add","tmp":"x","record":{"first":"Anon"}}]'::jsonb)`)
  ck('PGLITE: anon cannot call it', String(anonR).startsWith('refused') && /permission denied/.test(anonR), anonR)
  const anonS = await as(null, 'anon', `select public.app_data_save('settings', '{}'::jsonb, 0)`)
  ck('PGLITE: anon cannot call app_data_save', String(anonS).startsWith('refused'), anonS)
  r = await apply('candidates', [{ op: 'add', tmp: 'x', record: { first: 'NoRole' } }], null, { sub: 'u-2' })
  ck('PGLITE: a caller without the signed-in role is refused', String(r).includes('sign in first'), r)
  const svc = await as({ role: 'service_role' }, 'service_role', `select public.app_data_items_apply('candidates', '[]'::jsonb)`)
  ck('PGLITE: the server key is refused too (only signed-in staff use it)', String(svc).includes('sign in first') || String(svc).includes('permission denied'), svc)
  r = await apply('settings', [{ op: 'add', tmp: 'x', record: {} }])
  ck('PGLITE: any other key is refused (only candidates and caregivers)', String(r).includes('only candidates and caregivers'), r)
  r = await apply('caregivers', [{ op: 'add', tmp: 'x', record: { first: 'X' } }], null, { ...SIGNED, deny: 'caregivers' })
  ck('PGLITE: no access to the key = refused (can_access_data_key)', String(r).includes('do not have access'), r)
  r = await apply('candidates', [{ op: 'explode' }])
  ck('PGLITE: an unknown change is refused whole', String(r).includes('unknown change'), r)
  r = await apply('candidates', [{ op: 'put', id: 2, record: { a: 1 } }, { op: 'remove', id: 2 }])
  ck('PGLITE: the same person twice in one save is refused', String(r).includes('appears twice'), r)
  r = await apply('candidates', [{ op: 'add', tmp: 'v', record: { first: 'V' } }], { version: 1 })
  ck('PGLITE: an optional expected version that is out of date is refused', r.ok === false && r.reason === 'version' && (await clog()).at(-1).reason === 'version', r)

  // ── caregivers too; other keys untouched ──
  const settingsBefore = JSON.stringify(await recs('settings'))
  const g7 = await rec('caregivers', 7)
  r = await apply('caregivers', [{ op: 'put', id: 7, base_rev: 0, record: { ...g7, skills: { a: 1 } } }, { op: 'add', tmp: '-5', record: { first: 'New', last: 'Hire', candidate_id: 26 } }])
  ck('PGLITE: caregivers work the same way (own counter: next is 8)', r.ok && r.ids['-5'] === 8 && (await rec('caregivers', 7))._rev === 1, r)
  ck('PGLITE: other keys are never touched', JSON.stringify(await recs('settings')) === settingsBefore)

  // ── the read rules on the new tables ──
  ck('PGLITE: a signed-in browser can read the refusal log, not write it', Array.isArray(await as(SIGNED, 'authenticated', 'select count(*) from public.app_data_conflict_log'))
    && String(await as(SIGNED, 'authenticated', `insert into public.app_data_conflict_log (key, reason) values ('candidates', 'x')`)).startsWith('refused'))
  ck('PGLITE: anon cannot read the refusal log; nobody in a browser can see or change the number counter',
    String(await as(null, 'anon', 'select count(*) from public.app_data_conflict_log')).startsWith('refused')
    && String(await as(SIGNED, 'authenticated', 'select * from public.app_data_id_counter')).startsWith('refused')
    && String(await as(SIGNED, 'authenticated', `update public.app_data_id_counter set last_id = 0`)).startsWith('refused'))
  const cfg = await q1(`select proconfig from pg_proc where proname = 'app_data_items_apply'`)
  ck('PGLITE: the lock wait limit is set on the function (3s)', cfg[0].proconfig.includes('lock_timeout=3s'), cfg)

  // ── app_data_save ──
  const sv = (await row('settings')).version
  let s = await as(SIGNED, 'authenticated', `select public.app_data_save('settings', '{"a":3}'::jsonb, $1) as r`, [sv])
  ck('PGLITE: app_data_save with the version it read: saved, new version back', s[0].r.ok === true && s[0].r.version === sv + 1 && (await recs('settings')).a === 3, s)
  s = await as(SIGNED, 'authenticated', `select public.app_data_save('settings', '{"a":4}'::jsonb, $1) as r`, [sv])
  ck('PGLITE: app_data_save with an old version: refused, nothing saved, current data + version handed back', s[0].r.ok === false && s[0].r.reason === 'version' && s[0].r.version === sv + 1 && s[0].r.data.a === 3 && (await recs('settings')).a === 3, s)
  s = await as(SIGNED, 'authenticated', `select public.app_data_save('brand_new_key', '[1]'::jsonb, 0) as r`)
  ck('PGLITE: app_data_save creates a missing key when expecting version 0', s[0].r.ok === true && (await row('brand_new_key')).data[0] === 1, s)
  s = await as(SIGNED, 'authenticated', `select public.app_data_save('candidates', '[]'::jsonb, 0) as r`)
  ck('PGLITE: app_data_save refuses candidates and caregivers (whole-list saves of people are what this replaces)', String(s).includes('one person at a time'), s)
  s = await as({ ...SIGNED, deny: 'settings' }, 'authenticated', `select public.app_data_save('settings', '{}'::jsonb, 0) as r`)
  ck('PGLITE: app_data_save respects key access', String(s).includes('do not have access'), s)

  // ── a failing _rev stamp never fails a save ──
  await db.exec(`create or replace function public.app_data_stamp_revs(od jsonb, nd jsonb) returns jsonb language plpgsql as $$ begin raise exception 'boom'; end $$`)
  r = await as(SIGNED, 'authenticated', 'update public.app_data set data = $1 where key = $2', [JSON.stringify([...(await recs('caregivers')), { id: 50, first: 'Still' }]), 'caregivers'])
  ck('PGLITE: if stamping _rev ever fails, the save still goes through', Array.isArray(r) && !!(await rec('caregivers', 50)), r)
  await db.exec(sq)

  // ── the installer's proof, run here: everything rolled back ──
  const snap = async () => (await q1(`select (select md5(data::text) from public.app_data where key = 'candidates') as m, (select version from public.app_data where key = 'candidates') as v,
    (select count(*)::int from public.app_data_item_change) as h, (select count(*)::int from public.app_data_conflict_log) as l,
    (select last_id from public.app_data_id_counter where key = 'candidates') as c`))[0]
  const b4 = await snap()
  let probe = null
  try { await db.exec(pf) } catch (e) { probe = e.message }
  const af = await snap()
  const J = probe && probe.includes('PROBE_RESULT: ') ? JSON.parse(probe.split('PROBE_RESULT: ')[1]) : null
  ck('PGLITE proof: the add got a fresh number above the old max and the counter', J && J.add_ok === true && J.new_id > Number(J.max_before) && J.new_id > Number(J.counter_before) && J.added_present === true, J || probe)
  ck('PGLITE proof: a change from what was read saved (_rev +1); the same change from an old _rev refused, nothing saved', J && J.put1_ok && J.rev_after === J.rev_before + 1 && J.put1_rev === J.rev_after
    && J.stale_ok === false && J.stale_reason === 'conflict' && J.stale_conflict_ids.map(String).join() === J.a && J.stale_current_rev === J.rev_after && J.stale_nothing_saved === true, J)
  ck('PGLITE proof: two pages, two people: both saved', J && J.b_ok && J.c_ok, J)
  ck('PGLITE proof: 3 removed at once refused, nothing saved', J && J.bulk_ok === false && J.bulk_reason === 'bulk_remove' && J.bulk_nothing_saved, J)
  ck('PGLITE proof: anon refused', J && J.anon_refused === true, J)
  ck('PGLITE proof: version moved exactly once per saved change (4)', J && J.version_after === J.version_before + 4, J)
  const hk = J ? J.history.map((x) => x.change + ':' + x.record_id).join() : ''
  ck('PGLITE proof: the 418 history shows the added person and the three changes, by the proof identity', J && hk === `added:${J.new_id},changed:${J.a},changed:${J.b},changed:${J.c}` && J.history.every((x) => x.actor === 'proof-421@invalid.test'), hk)
  ck('PGLITE proof: the refusal log shows the stale change and the bulk removal', J && J.refusals.map((x) => x.reason).join() === 'conflict,bulk_remove_refused', J && J.refusals)
  ck('PGLITE proof: no name leaves the database', probe && !/First\d|Last\d|Four21/.test(probe), probe)
  ck('PGLITE proof: nothing stayed (list, version, history, refusal log, counter all unchanged)', JSON.stringify(b4) === JSON.stringify(af), [b4, af])
  await db.query(`update public.app_data set data = '[{"id":1},{"id":2}]' where key = 'candidates'`)
  try { await db.exec(pf) } catch (e) { probe = e.message }
  ck('PGLITE proof: with fewer than 3 people it skips', /skipped/.test(probe), probe)
} else console.log('(PGLITE not set: the real-Postgres run of the SQL is skipped)')

const failed = res.filter((r) => !r[1])
for (const [n, ok, note] of res) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n      ' + note}`)
console.log(`\n${res.length - failed.length}/${res.length} passed${failed.length ? ' · FAIL' : ''}`)
process.exit(failed.length ? 1 : 0)
