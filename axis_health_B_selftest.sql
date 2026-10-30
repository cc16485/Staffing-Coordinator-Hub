-- B · database self-test, run AFTER axis_reader_A.sql and axis_health_B.sql, in one transaction that is always rolled back.
-- Proves axis_connection keeps each kind of information apart (a good caregiver read never makes failing visits look fine),
-- counts 429s, held reads and shared answers apart from real calls, and says when scheduling is not current.
begin;
create temp table t_res (name text, ok boolean) on commit drop;
delete from public.axis_read_log;   -- rolled back below; only so the counts are exact
insert into public.axis_read_log (at, job, source, status, ok) values
  (now() - interval '2 minutes', 'roster', 'caregivers', 200, true),
  (now() - interval '40 minutes', 'coverage-watch', 'visits', 200, true),
  (now() - interval '9 minutes', 'coverage-watch', 'visits', 429, false),
  (now() - interval '4 minutes', 'coverage-run', 'visits', 429, false);
insert into public.axis_read_log (at, job, source, status, ok, held, error) values (now() - interval '3 minutes', 'client-journey', 'visits', 429, false, true, 'held: AxisCare asked the Hub to wait');
insert into public.axis_read_log (at, job, source, status, ok, from_cache) values (now() - interval '1 minute', 'client-journey', 'clients', 200, true, true);
create temp table t_c on commit drop as select public.axis_connection(15) as c;
insert into t_res select 'visits: 2 real calls in 15 min, 2 failed, 2 were 429s, 1 held',
  (c#>>'{sources,visits,calls}')::int = 2 and (c#>>'{sources,visits,failed}')::int = 2 and (c#>>'{sources,visits,r429}')::int = 2 and (c#>>'{sources,visits,held}')::int = 1 from t_c;
insert into t_res select 'visits: last good read is the one 40 minutes ago', (c#>>'{sources,visits,last_ok_at}')::timestamptz < now() - interval '39 minutes' from t_c;
insert into t_res select 'caregivers fine on their own line', (c#>>'{sources,caregivers,last_try_ok}')::boolean and (c#>>'{sources,caregivers,failed}')::int = 0 from t_c;
insert into t_res select 'scheduling is NOT current although the caregiver list read fine', (c->>'scheduling_current')::boolean = false from t_c;
insert into t_res select 'a shared answer is not counted as a call', (c#>>'{sources,clients,calls}')::int = 0 and (c#>>'{sources,clients,shared}')::int = 1 from t_c;
insert into t_res select 'totals: 3 calls, 2 failed, 2 429s, 1 held', (c#>>'{totals,calls}')::int = 3 and (c#>>'{totals,failed}')::int = 2 and (c#>>'{totals,r429}')::int = 2 and (c#>>'{totals,held}')::int = 1 from t_c;
insert into t_res select 'per job: coverage-run 1 call, 1 429', exists (select 1 from t_c, jsonb_array_elements(c->'jobs') j where j->>'job' = 'coverage-run' and (j->>'calls')::int = 1 and (j->>'r429')::int = 1) from t_c limit 1;
insert into public.axis_read_log (at, job, source, status, ok) values (now(), 'coverage-watch', 'visits', 200, true);
insert into t_res select 'a good visit read now: scheduling current', (public.axis_connection(15)->>'scheduling_current')::boolean;
insert into t_res select 'the four busy jobs keep their answers (150 s)', (select count(*) = 4 from cron.job where jobname in ('coverage-run', 'coverage-watch', 'timekeeper-watch', 'launch-evidence') and command like '%timeout_milliseconds := 150000%');
insert into t_res select 'axis-health is scheduled every 5 minutes', exists (select 1 from cron.job where jobname = 'axis-health' and schedule = '1-59/5 * * * *' and active);
select bool_and(ok) as ok, string_agg(name, ', ') filter (where not ok) as failed, count(*) as checks from t_res;
rollback;
