-- B · NO SILENT FAILURES FROM AXISCARE (Samantha, 2026-10-29). Needs A (axis_reader_A.sql) first.
--  1. axis_connection(minutes): what the Hub Settings "AxisCare connection" section shows, one line per kind of AxisCare
--     information (visits, one visit, schedules, caregiver list, client records, reasons), so a good caregiver-list read
--     never makes a failing visit read look healthy (her rule 3). Office users (signed in) may read it; it holds counts and
--     times only, no names.
--  2. The scheduler waits up to 150 s for coverage-run, coverage-watch, timekeeper-watch and launch-evidence (it gave up after
--     5 s, so their reports, including "AxisCare answered 429", were thrown away). This changes what is kept, not what
--     the jobs do. Rollback: axis_health_B_rollback.sql.
--  3. The axis-health job every 5 minutes (cards only while Settings > Tell me when AxisCare can't be read is on).

create or replace function public.axis_connection(p_minutes int default 60) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  since timestamptz := now() - make_interval(mins => greatest(5, least(p_minutes, 1440)));
  s jsonb; srcs jsonb; jobs jsonb; hours jsonb; g public.axis_gate; vis jsonb;
begin
  select data into s from public.app_data where key = 'ops_settings';
  select * into g from public.axis_gate where id = 1;
  /* per kind of information: the last good read and the last failed one ever (14 days kept), counts in the window */
  select coalesce(jsonb_object_agg(src, info), '{}'::jsonb) into srcs from (
    select l.source as src, jsonb_build_object(
      'last_ok_at', max(l.at) filter (where l.ok and not l.from_cache and not l.coalesced),
      'last_fail_at', max(l.at) filter (where not l.ok),
      'last_429_at', max(l.at) filter (where l.status = 429 and not l.held),
      'calls', count(*) filter (where l.at >= since and not l.from_cache and not l.coalesced and not l.held),
      'failed', count(*) filter (where l.at >= since and not l.ok and not l.held),
      'r429', count(*) filter (where l.at >= since and l.status = 429 and not l.held),
      'held', count(*) filter (where l.at >= since and l.held),
      'shared', count(*) filter (where l.at >= since and (l.from_cache or l.coalesced)),
      'last_error', (select coalesce(x.error, 'AxisCare answered ' || x.status) from public.axis_read_log x
                     where x.source = l.source and not x.ok order by x.at desc limit 1),
      'last_try_ok', (select x.ok from public.axis_read_log x where x.source = l.source and not x.from_cache and not x.coalesced order by x.at desc limit 1)
    ) as info
    from public.axis_read_log l group by l.source) q;
  select coalesce(jsonb_agg(j order by j->>'job'), '[]'::jsonb) into jobs from (
    select jsonb_build_object('job', job,
      'calls', count(*) filter (where not from_cache and not coalesced and not held),
      'failed', count(*) filter (where not ok and not held), 'r429', count(*) filter (where status = 429 and not held),
      'held', count(*) filter (where held), 'shared', count(*) filter (where from_cache or coalesced),
      'last_ok_at', max(at) filter (where ok and not from_cache and not coalesced)) j
    from public.axis_read_log where at >= since group by job) q;
  /* the last 24 hours, hour by hour (the before/after comparison) */
  select coalesce(jsonb_agg(h order by h->>'hour'), '[]'::jsonb) into hours from (
    select jsonb_build_object('hour', date_trunc('hour', at),
      'calls', count(*) filter (where not from_cache and not coalesced and not held),
      'failed', count(*) filter (where not ok and not held), 'r429', count(*) filter (where status = 429 and not held),
      'held', count(*) filter (where held), 'shared', count(*) filter (where from_cache or coalesced), 'live', bool_or(live)) h
    from public.axis_read_log where at >= now() - interval '24 hours' group by date_trunc('hour', at)) q;
  vis := srcs->'visits';
  return jsonb_build_object(
    'as_of', now(), 'minutes', greatest(5, least(p_minutes, 1440)),
    'reader_on', coalesce((s->>'axis_shared_reader_live')::boolean, false),
    'cards_on', coalesce((s->>'axis_failure_cards_live')::boolean, false),
    'axiscare_wait_until', case when g.backoff_until > now() then g.backoff_until end,
    'last_429_at', g.last_429_at,
    /* scheduling is current when the last visit-list call worked and was in the last 10 minutes */
    'scheduling_current', coalesce((vis->>'last_try_ok')::boolean, false)
      and coalesce((vis->>'last_ok_at')::timestamptz > now() - interval '10 minutes', false),
    'sources', srcs, 'jobs', jobs, 'hours', hours,
    'totals', jsonb_build_object(
      'calls', (select count(*) from public.axis_read_log where at >= since and not from_cache and not coalesced and not held),
      'failed', (select count(*) from public.axis_read_log where at >= since and not ok and not held),
      'r429', (select count(*) from public.axis_read_log where at >= since and status = 429 and not held),
      'held', (select count(*) from public.axis_read_log where at >= since and held),
      'shared', (select count(*) from public.axis_read_log where at >= since and (from_cache or coalesced))));
end $$;
revoke all on function public.axis_connection(int) from public, anon;
grant execute on function public.axis_connection(int) to authenticated, service_role;

-- 2 · keep the busy jobs' answers (150 s, like the other long jobs)
do $$
declare j record;
begin
  for j in select jobid, command from cron.job where jobname in ('coverage-run', 'coverage-watch', 'timekeeper-watch', 'launch-evidence')
    and command not like '%timeout_milliseconds%' and command like '%::jsonb);'
  loop
    perform cron.alter_job(j.jobid, command := regexp_replace(j.command, '::jsonb\);\s*$', '::jsonb, timeout_milliseconds := 150000);'));
  end loop;
end $$;

-- 3 · the axis-health job (it decides nothing on its own while its switch is off; it only reports)
select cron.schedule('axis-health', '1-59/5 * * * *', $c$select net.http_post(url := 'https://zngsgedlsxinbygwmxwn.supabase.co/functions/v1/axis-health', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hub_job_secret')), body := '{}'::jsonb, timeout_milliseconds := 60000);$c$);
