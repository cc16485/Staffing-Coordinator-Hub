-- =============================================================================
-- 650 v7 · the call readings keep the whole reading (Samantha 2026-10-12, her eight points). PRACTICE ONLY.
-- =============================================================================
-- detail: the call summary, what the AI understood, the promises told apart (we agreed / caller will / considering /
--   awaiting confirmation), and EVERY responsibility the call created with its decision (new card, add to a card,
--   already in a workflow, done on the call, the caller's, not needed), reason, area, urgency, due date and owner.
-- tasks: up to 8 would-be cards a call (was 3), so a call with several unrelated jobs loses none.
-- Still: no transcript, phone number or email. Append-only. Office read. One transaction. Safe to run again.
-- Rollback: drop column detail; put the 3-card check back (only if no row holds more than 3).
-- =============================================================================
begin;
alter table public.call_task_reading add column if not exists detail jsonb not null default '{}'::jsonb;
alter table public.call_task_reading drop constraint if exists call_task_reading_detail_check;
alter table public.call_task_reading add constraint call_task_reading_detail_check check (jsonb_typeof(detail) = 'object');
alter table public.call_task_reading drop constraint if exists call_task_reading_tasks_check;
alter table public.call_task_reading add constraint call_task_reading_tasks_check check (jsonb_typeof(tasks) = 'array' and jsonb_array_length(tasks) <= 8);
comment on table public.call_task_reading is '650 · what the AI employee read in each call: the summary, what it understood, the promises, every responsibility with its decision, and the cards it would make (practice) or made (live). No transcript, phone or email.';
do $v$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'call_task_reading' and column_name = 'detail') then
    raise exception '650 v7 self-check: the detail column is missing'; end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'call_task_reading_tasks_check') !~ '<= 8' then
    raise exception '650 v7 self-check: the 8-card check is not in place'; end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.call_task_reading'::regclass and tgname like 'call_task_reading_keep%') <> 2 then
    raise exception '650 v7 self-check: the append-only guards are not both in place'; end if;
  raise notice '650 v7: readings keep the whole reading, up to 8 cards';
end $v$;
commit;
