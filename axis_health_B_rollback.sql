-- Rollback of B (axis_health_B.sql): stop the axis-health job, give the four jobs back their old 5 s scheduler wait,
-- remove the Settings summary. Cards the job made stay as they are (a person can close them).
select cron.unschedule('axis-health') where exists (select 1 from cron.job where jobname = 'axis-health');
do $$
declare j record;
begin
  for j in select jobid, command from cron.job where jobname in ('coverage-run', 'coverage-watch', 'timekeeper-watch', 'launch-evidence')
    and command like '%, timeout_milliseconds := 150000);%'
  loop
    perform cron.alter_job(j.jobid, command := replace(j.command, ', timeout_milliseconds := 150000);', ');'));
  end loop;
end $$;
drop function if exists public.axis_connection(int);
