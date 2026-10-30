-- Rollback of A (axis_reader_A.sql). First turn Settings > Shared AxisCare reader off (the jobs then call AxisCare as before
-- and only write the log). This removes the log, the limit and the copies; the reader then finds no log table, skips the
-- row, and reads as before (it never stops a read for a log or database problem).
select cron.unschedule('axis-read-log-trim') where exists (select 1 from cron.job where jobname = 'axis-read-log-trim');
drop function if exists public.axis_gate_take(text);
drop function if exists public.axis_gate_report(int, numeric);
drop function if exists public.axis_cache_lease(text, text, int);
drop function if exists public.axis_cache_put(text, text, text, int);
drop function if exists public.axis_cache_release(text, text);
drop function if exists public.axis_read_log_trim();
drop function if exists public.axis_setting_int(jsonb, text, int);
drop table if exists public.axis_cache;
drop table if exists public.axis_gate;
drop table if exists public.axis_read_log;
