// A and B · the SQL in a real Postgres (PGlite), with small stand-ins for pg_cron. Runs axis_reader_A.sql and axis_health_B.sql
// twice (safe to run again), their rolled-back self-tests (which must pass and leave nothing behind), the grants, and both
// rollbacks.   PGLITE=<path to @electric-sql/pglite/dist/index.js> node axis_sql_test.mjs
import fs from 'fs'; import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const PG = process.env.PGLITE || `${process.env.HOME}/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js`
const { PGlite } = await import(pathToFileURL(PG).href)
const pg = new PGlite()
const cmd = (fn, body = "'{}'::jsonb") => `select net.http_post(url := 'https://x.supabase.co/functions/v1/${fn}', headers := jsonb_build_object('Content-Type', 'application/json'), body := ${body});`
await pg.exec(`create role anon; create role authenticated; create role service_role;
  create table public.app_data (key text primary key, data jsonb);
  insert into public.app_data values ('ops_settings', '{"loops_close_live": true}');
  create schema cron;
  create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text, active boolean default true);
  create function cron.schedule(n text, s text, c text) returns bigint language sql as $$
    insert into cron.job (jobname, schedule, command) values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid::bigint $$;
  create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
  create function cron.alter_job(id bigint, command text) returns void language sql as $$ update cron.job set command = alter_job.command where jobid = id $$;`)
for (const [n, c] of [['coverage-run', cmd('coverage-run?commit=1')], ['coverage-watch', cmd('coverage-watch')], ['timekeeper-watch', cmd('timekeeper-watch')],
  ['launch-evidence', cmd('launch-evidence', `'{"action":"run"}'::jsonb`)], ['late-watch', cmd('late-watch').replace("::jsonb);", "::jsonb, timeout_milliseconds := 120000);")]])
  await pg.query('insert into cron.job (jobname, schedule, command) values ($1, $2, $3)', [n, '*/5 * * * *', c])
/* a self-test always ends by raising AXISTEST_<x> {result}, which undoes everything it did */
const selftest = async (file) => { try { await pg.exec(fs.readFileSync(file, 'utf8')); return { ok: false, why: 'it did not end with its result' } }
  catch (e) { const m = /AXISTEST_[AB] (\{.*\})/.exec(String(e?.message || e)); return m ? JSON.parse(m[1]) : { ok: false, why: String(e?.message || e) } } }
const A = fs.readFileSync('axis_reader_A.sql', 'utf8'), B = fs.readFileSync('axis_health_B.sql', 'utf8')
try {
  await pg.exec(A); await pg.exec(A)
  ck('A: installs, and is safe to run again', true)
  const ta = await selftest('axis_reader_A_selftest.sql')
  ck('A: the database self-test passes', ta.ok === true && Number(ta.checks) === 14, ta)
  const left = (await pg.query(`select (select count(*) from axis_read_log)::int l, (select count(*) from axis_cache)::int c, (select used from axis_gate) u,
    (select data->>'axis_reader_max' from app_data where key = 'ops_settings') m`)).rows[0]
  ck('A: the self-test leaves nothing behind (log, copies, gate, settings)', left.l === 0 && left.c === 0 && left.u === 0 && left.m === null, left)
  const g = (await pg.query(`select has_table_privilege('authenticated', 'axis_read_log', 'select') a, has_table_privilege('anon', 'axis_gate', 'select') b,
    has_function_privilege('authenticated', 'axis_gate_take(text)', 'execute') c, has_function_privilege('service_role', 'axis_gate_take(text)', 'execute') d,
    has_table_privilege('service_role', 'axis_read_log', 'insert') e`)).rows[0]
  ck('A: no browser access to the log, gate or functions; the server has it', g.a === false && g.b === false && g.c === false && g.d === true && g.e === true, g)
  ck('A: nightly trim is scheduled', (await pg.query(`select count(*)::int n from cron.job where jobname = 'axis-read-log-trim'`)).rows[0].n === 1)
  await pg.query(`update app_data set data = data || '{"axis_reader_max": "abc", "axis_reader_window_s": "-4"}' where key = 'ops_settings'`)
  ck('A: nonsense limit settings fall back to the defaults', (await pg.query(`select axis_gate_take('normal') r`)).rows[0].r.ok === true)
  await pg.exec(`update app_data set data = data - 'axis_reader_max' - 'axis_reader_window_s' where key = 'ops_settings'; update axis_gate set used = 0, window_start = null`)
  await pg.query(`insert into axis_read_log (at, job, source, ok) values (now() - interval '20 days', 'x', 'visits', true), (now(), 'x', 'visits', true)`)
  const tr = (await pg.query(`select axis_read_log_trim() r`)).rows[0].r
  ck('A: the trim keeps 14 days', tr.log_rows_removed === 1, tr)
  await pg.query('delete from axis_read_log')

  await pg.exec(B); await pg.exec(B)
  ck('B: installs, and is safe to run again', true)
  const jobs = (await pg.query(`select jobname, command from cron.job order by jobname`)).rows
  const cmdOf = (n) => jobs.find((j) => j.jobname === n)?.command || ''
  ck('B: the four busy jobs now wait 150 s, once (not twice after a second run)', ['coverage-run', 'coverage-watch', 'timekeeper-watch', 'launch-evidence']
    .every((n) => (cmdOf(n).match(/timeout_milliseconds := 150000/g) || []).length === 1 && cmdOf(n).endsWith('timeout_milliseconds := 150000);')), jobs)
  ck('B: launch-evidence keeps its body', /body := '\{"action":"run"\}'::jsonb, timeout_milliseconds := 150000\);$/.test(cmdOf('launch-evidence')))
  ck('B: late-watch (already 120 s) is untouched', /timeout_milliseconds := 120000\);$/.test(cmdOf('late-watch')) && !/150000/.test(cmdOf('late-watch')))
  ck('B: axis-health every 5 minutes', /axis-health/.test(cmdOf('axis-health')))
  const tb = await selftest('axis_health_B_selftest.sql')
  ck('B: the database self-test passes', tb.ok === true && Number(tb.checks) >= 9, tb)
  ck('B: the self-test leaves nothing behind', (await pg.query('select count(*)::int n from axis_read_log')).rows[0].n === 0)
  const gb = (await pg.query(`select has_function_privilege('authenticated', 'axis_connection(int)', 'execute') a, has_function_privilege('anon', 'axis_connection(int)', 'execute') b`)).rows[0]
  ck('B: office users may read the summary; the public may not', gb.a === true && gb.b === false, gb)
  const empty = (await pg.query('select axis_connection(60) c')).rows[0].c
  ck('B: with an empty log it says scheduling is NOT current (never "fine" for lack of data)', empty.scheduling_current === false && empty.reader_on === false && empty.cards_on === false, empty)

  await pg.exec(fs.readFileSync('axis_health_B_rollback.sql', 'utf8'))
  const jobs2 = (await pg.query(`select jobname, command from cron.job`)).rows
  ck('B rollback: the four jobs are back exactly as they were, axis-health gone, summary gone',
    jobs2.find((j) => j.jobname === 'coverage-run').command === cmd('coverage-run?commit=1') && jobs2.find((j) => j.jobname === 'launch-evidence').command === cmd('launch-evidence', `'{"action":"run"}'::jsonb`)
    && !jobs2.some((j) => j.jobname === 'axis-health') && (await pg.query(`select to_regprocedure('axis_connection(int)') f`)).rows[0].f === null, jobs2)
  await pg.exec(fs.readFileSync('axis_reader_A_rollback.sql', 'utf8'))
  const gone = (await pg.query(`select to_regclass('axis_read_log') a, to_regclass('axis_gate') b, to_regclass('axis_cache') c, to_regprocedure('axis_gate_take(text)') d`)).rows[0]
  ck('A rollback: tables and functions gone, trim unscheduled', gone.a === null && gone.b === null && gone.c === null && gone.d === null
    && (await pg.query(`select count(*)::int n from cron.job where jobname = 'axis-read-log-trim'`)).rows[0].n === 0, gone)
  await pg.exec(A); await pg.exec(B)
  ck('A and B install again after a rollback', true)
} catch (e) { ck('the SQL ran', false, String(e?.message || e)) }
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n      ' + note))
const p = res.filter((r) => r[1]).length
console.log(`\n${p}/${res.length} passed · ${p === res.length ? 'ALL GREEN' : 'FAIL'}`)
process.exit(p === res.length ? 0 : 1)
