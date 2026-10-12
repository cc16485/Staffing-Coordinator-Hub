-- 650 ROLLBACK · remove the call follow-up readings (only if ever needed). Unschedule the call-tasks job first
-- (the 650 report names it). One transaction. Nothing else in the Hub reads this table except the Practice list.
begin;
drop function if exists public.call_who(text);
drop table if exists public.call_task_reading;
drop function if exists public.call_task_reading_keep();
commit;
