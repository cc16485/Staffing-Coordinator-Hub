// 1035 LEAVING ONBOARDING: the SQL in a real Postgres.   PGLITE=<path> node leave_1035_sql_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const sq = fs.readFileSync('supabase/leave-1035.sql', 'utf8'), rb = fs.readFileSync('supabase/leave-1035-rollback.sql', 'utf8')
ck('no em dash in the SQL', !/—/.test(sq + rb))
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.reference_requests (id text primary key, candidate_id text, responded_at timestamptz);
    create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now());
    create function public.app_data_rev(r jsonb) returns bigint language sql immutable as $$ select coalesce((r->>'_rev')::bigint, 0) $$;
    insert into public.app_data values ('candidates', '[{"id": 7, "first": "Kim"}]'), ('caregivers', '[{"id": 55, "candidate_id": 7}]');`)
  await db.exec(sq); await db.exec(sq)
  const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'reference_requests'`)).rows.map((x) => x.column_name)
  ck('reference_requests gets closed_at and closed_reason (ran twice)', cols.includes('closed_at') && cols.includes('closed_reason'), cols)
  const a = (await db.query(`select public.leave_patch('candidates', '7', 0, '{"not_hired": true, "not_hired_reason": "ghosted", "left_at": "x", "left_by": "Krystal"}'::jsonb) as r`)).rows[0].r
  const b = (await db.query(`select public.leave_patch('caregivers', '55', 0, '{"not_hired": true, "onboarding_left": true}'::jsonb) as r`)).rows[0].r
  let refused = false; try { await db.query(`select public.leave_patch('candidates', '7', 0, '{"care_level_approved": 3}'::jsonb)`) } catch { refused = true }
  const c = (await db.query(`select data->0 as c from public.app_data where key = 'candidates'`)).rows[0].c
  ck('leave_patch saves the leaving fields on a candidate and a roster record, refuses any other field', a.ok && b.ok && c.not_hired === true && c.not_hired_reason === 'ghosted' && refused, { a, b, c })
  ck('only the server may call it', !(await db.query(`select has_function_privilege('authenticated', 'public.leave_patch(text, text, bigint, jsonb)', 'execute') as x`)).rows[0].x)
  await db.exec(rb)
  const after = (await db.query(`select column_name from information_schema.columns where table_name = 'reference_requests'`)).rows.map((x) => x.column_name)
  ck('rollback removes the door and the two columns', !after.includes('closed_at') && !(await db.query(`select to_regprocedure('public.leave_patch(text, text, bigint, jsonb)') as x`)).rows[0].x)
} else ck('PGLITE is set', false)
for (const [n, o, note] of res) console.log((o ? 'PASS  ' : 'FAIL  ') + n + (o ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
