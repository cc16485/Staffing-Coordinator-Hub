-- B · database self-test, run AFTER axis_reader_A.sql and axis_health_B.sql. One block that always ends by raising
-- AXISTEST_B <result>, so everything it did is undone. The result is {"ok": true|false, "failed": [names], "checks": n}.
-- Proves axis_connection keeps each kind of information apart (a good caregiver read never makes failing visits look fine),
-- counts 429s, held reads and shared answers apart from real calls, and says when scheduling is not current.
do $$
declare res jsonb := '[]'::jsonb; c jsonb; r jsonb;
begin
  delete from public.axis_read_log;   -- undone below; only so the counts are exact
  insert into public.axis_read_log (at, job, source, status, ok) values
    (now() - interval '2 minutes', 'roster', 'caregivers', 200, true),
    (now() - interval '40 minutes', 'coverage-watch', 'visits', 200, true),
    (now() - interval '9 minutes', 'coverage-watch', 'visits', 429, false),
    (now() - interval '4 minutes', 'coverage-run', 'visits', 429, false);
  insert into public.axis_read_log (at, job, source, status, ok, held, error) values (now() - interval '3 minutes', 'client-journey', 'visits', 429, false, true, 'held: AxisCare asked the Hub to wait');
  insert into public.axis_read_log (at, job, source, status, ok, from_cache) values (now() - interval '1 minute', 'client-journey', 'clients', 200, true, true);
  c := public.axis_connection(15);
  res := res || jsonb_build_object('n', 'visits: 2 real calls in 15 min, 2 failed, 2 were 429s, 1 held', 'ok',
    (c#>>'{sources,visits,calls}')::int = 2 and (c#>>'{sources,visits,failed}')::int = 2 and (c#>>'{sources,visits,r429}')::int = 2 and (c#>>'{sources,visits,held}')::int = 1);
  res := res || jsonb_build_object('n', 'visits: last good read is the one 40 minutes ago', 'ok', (c#>>'{sources,visits,last_ok_at}')::timestamptz < now() - interval '39 minutes');
  res := res || jsonb_build_object('n', 'caregivers fine on their own line', 'ok', (c#>>'{sources,caregivers,last_try_ok}')::boolean and (c#>>'{sources,caregivers,failed}')::int = 0);
  res := res || jsonb_build_object('n', 'scheduling is NOT current although the caregiver list read fine', 'ok', (c->>'scheduling_current')::boolean = false);
  res := res || jsonb_build_object('n', 'a shared answer is not counted as a call', 'ok', (c#>>'{sources,clients,calls}')::int = 0 and (c#>>'{sources,clients,shared}')::int = 1);
  res := res || jsonb_build_object('n', 'totals: 3 calls, 2 failed, 2 429s, 1 held', 'ok',
    (c#>>'{totals,calls}')::int = 3 and (c#>>'{totals,failed}')::int = 2 and (c#>>'{totals,r429}')::int = 2 and (c#>>'{totals,held}')::int = 1);
  res := res || jsonb_build_object('n', 'per job: coverage-run 1 call, 1 429', 'ok',
    exists (select 1 from jsonb_array_elements(c->'jobs') j where j->>'job' = 'coverage-run' and (j->>'calls')::int = 1 and (j->>'r429')::int = 1));
  insert into public.axis_read_log (at, job, source, status, ok) values (now(), 'coverage-watch', 'visits', 200, true);
  res := res || jsonb_build_object('n', 'a good visit read now: scheduling current', 'ok', (public.axis_connection(15)->>'scheduling_current')::boolean);
  res := res || jsonb_build_object('n', 'the four busy jobs keep their answers (150 s)', 'ok', (select count(*) = 4 from cron.job
    where jobname in ('coverage-run', 'coverage-watch', 'timekeeper-watch', 'launch-evidence') and command like '%timeout_milliseconds := 150000%'));
  res := res || jsonb_build_object('n', 'axis-health is scheduled every 5 minutes', 'ok', exists (select 1 from cron.job where jobname = 'axis-health' and schedule = '1-59/5 * * * *' and active));
  select jsonb_build_object('ok', bool_and(coalesce((x->>'ok')::boolean, false)),
    'failed', coalesce(jsonb_agg(x->>'n') filter (where not coalesce((x->>'ok')::boolean, false)), '[]'::jsonb), 'checks', count(*))
    into r from jsonb_array_elements(res) x;
  raise exception 'AXISTEST_B %', r::text;
end $$;
