-- =============================================================================
-- 650 v10 · the AI employee also reads GoHighLevel texts (Samantha 2026-10-12: "it should read GHL texts!"). PRACTICE.
-- =============================================================================
-- channel: 'call' (as before) or 'text' (a burst of texts from one person, read with the thread around it).
-- Still no transcript or text bodies kept, no phone number or email. Append-only. Office read. One transaction.
-- Rollback: drop column channel (only after the reader is back on a version that does not write it).
-- =============================================================================
begin;
alter table public.call_task_reading add column if not exists channel text not null default 'call';
alter table public.call_task_reading drop constraint if exists call_task_reading_channel_check;
alter table public.call_task_reading add constraint call_task_reading_channel_check check (channel in ('call', 'text'));
create index if not exists call_task_reading_channel_ix on public.call_task_reading (channel, call_at desc);
do $v$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'call_task_reading' and column_name = 'channel') then
    raise exception '650 v10 self-check: the channel column is missing'; end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.call_task_reading'::regclass and tgname like 'call_task_reading_keep%') <> 2 then
    raise exception '650 v10 self-check: the append-only guards are not both in place'; end if;
  raise notice '650 v10: readings know whether they came from a call or texts';
end $v$;
commit;
