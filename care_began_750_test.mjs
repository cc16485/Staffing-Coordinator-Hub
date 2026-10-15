// 750 · one "care began" rule, rehearsed in a real Postgres (PGlite) with stand-in tables shaped like the live ones.
// The live function before 750 (client-fact-care-began-fix.sql) is installed first, then 750, twice. A checkbox tick
// with no clock-out no longer says care began; AxisCare's first completed visit and a hand record still do.
//   PGLITE=<path to @electric-sql/pglite/dist/index.js> node care_began_750_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 500)])
const sql750 = fs.readFileSync('care-began-one-rule-750.sql', 'utf8'), oldFile = fs.readFileSync('client-fact-care-began-fix.sql', 'utf8')
const old = oldFile.slice(oldFile.indexOf('create or replace function public.care_began_for_episode'), oldFile.indexOf('end $f$;') + 8)   /* the live rule before 750 */
ck('750 is one transaction that replaces only care_began_for_episode', /^begin;$/m.test(sql750) && /^commit;$/m.test(sql750) && (sql750.match(/create or replace function/g) || []).length === 1 && !/\b(drop|truncate|delete|grant|alter)\b/i.test(sql750.replace(/--.*$/gm, '')))
ck('no em dash in 750', !/—/.test(sql750))
if (!process.env.PGLITE) { ck('PGLITE not set: the database rehearsal did not run', false) } else {
  const { PGlite } = await import(process.env.PGLITE)
  const pg = new PGlite(); await pg.waitReady
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.app_data (key text primary key, data jsonb);
    create table public.journey_episode (episode_id uuid primary key, person_id uuid, state text, created_at timestamptz default now());
    create table public.episode_source (episode_id uuid, system text, source_ref text, role text);
    create table public.person_source_id (person_id uuid, system text, entity_type text, source_id text);
    create table public.client_queue (id uuid primary key, axiscare_client_id text, added_at timestamptz, first_shift_done boolean, first_shift_done_at timestamptz);
    create table public.launch_evidence (launch_id uuid, fact text, source text, evidence jsonb, recorded_at timestamptz default now());
    create view public.episode_range as select episode_id, null::text as began_basis, null::date as began_lo, null::date as began_hi from public.journey_episode;
    create function public.lead_inquiry_date(p jsonb) returns date language sql as $$ select (p->>'created_at')::date $$;
    insert into public.app_data values ('leads', '[{"id":"L1","created_at":"2026-09-01"},{"id":"L2","created_at":"2026-09-01"},{"id":"L3","created_at":"2026-09-01"}]');
  `)
  const E = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']
  const P = ['a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', 'a3333333-3333-4333-8333-333333333333']
  const Q = ['b1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222', 'b3333333-3333-4333-8333-333333333333']
  for (let i = 0; i < 3; i++) await pg.exec(`insert into journey_episode values ('${E[i]}','${P[i]}','open');
    insert into episode_source values ('${E[i]}','lead','L${i + 1}','origin'); insert into person_source_id values ('${P[i]}','axiscare','client','${300 + i}');
    insert into client_queue values ('${Q[i]}','${300 + i}','2026-09-05', true, '2026-09-10T15:00:00Z');`)
  await pg.exec(`insert into launch_evidence (launch_id, fact, source, evidence) values ('${Q[1]}','first_shift','axiscare','{"clock_in_date":"2026-09-08"}'),
    ('${Q[2]}','first_shift','person','{"date":"2026-09-07"}')`)
  const began = async (e) => (await pg.query(`select public.care_began_for_episode('${e}') as r`)).rows[0].r
  await pg.exec(old)
  await pg.exec(`revoke all on function public.care_began_for_episode(uuid) from public`)   /* as live: server only */
  const b0 = [await began(E[0]), await began(E[1]), await began(E[2])]
  ck('before 750: the checkbox alone says care began (Sep 10)', b0[0].began === true && b0[0].on === '2026-09-10', b0[0])
  let err = ''; try { await pg.exec(sql750) } catch (e) { err = String(e.message || e) }
  ck('750 installs (its self-checks pass)', !err, err)
  err = ''; try { await pg.exec(sql750) } catch (e) { err = String(e.message || e) }
  ck('750 installs again (safe to re-run)', !err, err)
  const b1 = [await began(E[0]), await began(E[1]), await began(E[2])]
  ck('after 750: the checkbox alone no longer says care began', b1[0].began === false, b1[0])
  ck('after 750: AxisCare\'s first clock-in still counts (Sep 8)', b1[1].began === true && b1[1].on === '2026-09-08' && /AxisCare/.test(b1[1].basis), b1[1])
  ck('after 750: a hand record still counts (Sep 7)', b1[2].began === true && b1[2].on === '2026-09-07' && /hand/.test(b1[2].basis), b1[2])
  ck('after 750: still not reachable from a browser', !(await pg.query(`select has_function_privilege('authenticated','public.care_began_for_episode(uuid)','execute') a`)).rows[0].a)
  const bad = sql750.replace("raise notice '750", "raise exception 'injected failure'; raise notice '750")
  await pg.exec(old); err = ''; try { await pg.exec(bad) } catch (e) { err = String(e.message || e) }
  try { await pg.exec('rollback') } catch (e) {}
  const b2 = await began(E[0])
  ck('a failure inside 750 leaves the old rule in place (all or nothing)', /injected failure/.test(err) && b2.began === true && b2.on === '2026-09-10', [err, b2])
}
let fails = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (!ok) fails++ }
console.log(`\n${res.length - fails}/${res.length} passed`); process.exit(fails ? 1 : 0)
