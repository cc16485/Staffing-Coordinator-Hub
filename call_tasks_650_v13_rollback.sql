-- 650 v13 rollback: only after the reader is back on v12 (which writes one try per version).
-- Refuses if any message has more than one try for a version (the old unique key would not fit).
begin;
do $r$
begin
  if exists (select 1 from public.call_task_reading group by message_id, version having count(*) > 1) then
    raise exception '650 v13 rollback refused: some readings have more than one try. Nothing was changed.'; end if;
end $r$;
drop table if exists public.call_promise_watch;
alter table public.call_task_reading drop constraint if exists call_task_reading_message_version_attempt_key;
alter table public.call_task_reading add constraint call_task_reading_message_id_version_key unique (message_id, version);
alter table public.call_task_reading drop constraint if exists call_task_reading_attempt_check;
alter table public.call_task_reading drop column if exists attempt;
commit;
