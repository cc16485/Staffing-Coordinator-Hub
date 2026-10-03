-- 420 · THE MORNING BRIEF AT 8AM CENTRAL, ALL YEAR (Samantha 2026-10-02: "make that email send at 8am not 7am").
-- Only the two lead-digest schedules' TIMES change; their commands (address, vault secret, body) are untouched.
--   daily-lead-digest         45 11 * * 1-5  ->  0 13 * * 1-5   (8am Chicago in daylight time, 7am in standard time)
--   daily-lead-digest-winter  45 12 * * 1-5  ->  0 14 * * 1-5   (9am Chicago in daylight time, 8am in standard time)
-- lead-digest itself sends only in Chicago's 8 o'clock hour and stamps morning_brief_state, so exactly one of the two
-- runs sends each weekday, summer or winter, and never twice.
-- Rollback (times only): the same two alter_job calls with '45 11 * * 1-5' and '45 12 * * 1-5'.
do $$
declare a bigint; w bigint;
begin
  select jobid into a from cron.job where jobname = 'daily-lead-digest' and command like '%/functions/v1/lead-digest%';
  select jobid into w from cron.job where jobname = 'daily-lead-digest-winter' and command like '%/functions/v1/lead-digest%';
  if a is null or w is null then raise exception '420: the two lead-digest schedules were not both found; nothing changed'; end if;
  perform cron.alter_job(job_id := a, schedule := '0 13 * * 1-5');
  perform cron.alter_job(job_id := w, schedule := '0 14 * * 1-5');
end $$;
