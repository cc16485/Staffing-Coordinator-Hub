-- ============================================================================
-- 432 · CALLS TELL US "RUNNING LATE" (Desktop 432). Samantha 2026-10-03, after her call to Mary: "i thought it might
-- have read my transcript from my call to mary to see that she said she is running late and will be to Aprils in 8
-- minutes", then "yes build it". SHARED HUB PROJECT. Safe to run again. Adds columns only; nothing is deleted or
-- rewritten, no setting is written.
--
-- late_notices gains what the call was (late-watch writes these; staff only read them):
--   source           'text' or 'call' (the newest thing that made or changed the notice was a call)
--   call_at          when the call was (GoHighLevel's time for the call)
--   call_message_id  GoHighLevel's id for the call
--   call_direction   'in' (they called the office line) or 'out' (the office called them)
--   call_by          who in the office was on the call (GoHighLevel user name), when GoHighLevel says
--   call_by_email    that person's email, so the page can say "your call" to them
--   call_quote       their own words on the call, copied by the AI and kept only if really in the transcript
-- The read rule (staff may read, only the server writes) is unchanged.
-- ============================================================================
begin;
alter table public.late_notices add column if not exists source           text;
alter table public.late_notices add column if not exists call_at          timestamptz;
alter table public.late_notices add column if not exists call_message_id  text;
alter table public.late_notices add column if not exists call_direction   text;
alter table public.late_notices add column if not exists call_by          text;
alter table public.late_notices add column if not exists call_by_email    text;
alter table public.late_notices add column if not exists call_quote       text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'late_notices_source_check') then
    alter table public.late_notices add constraint late_notices_source_check check (source is null or source in ('text', 'call'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'late_notices_call_direction_check') then
    alter table public.late_notices add constraint late_notices_call_direction_check check (call_direction is null or call_direction in ('in', 'out'));
  end if;
end $$;
commit;
