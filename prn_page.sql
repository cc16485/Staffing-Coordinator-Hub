-- ============================================================================
-- PRN STEP 5a · THE PRN TEAM PAGE (Samantha 2026-10-29). Safe to run again.
--  1. prn_page_log: what a PRN member did on their own page, and each time the office looked at it. Kept, never edited or
--     deleted. Written only by the prn-page function (service role); office staff can read it.
--       viewed            they opened their page (the PRN table's "Last looked at their page")
--       office_preview    someone in the office opened "See what they see" (by_name, by_email)
--       looking_on/off    "I'm looking for hours" (note: what they wrote), on for 7 days
--       hours_saved       they saved My hours
--       short_notice      they changed short notice (note: yes / no)
--       break_set         they set or ended a break (note: the date, or empty)
--       course_request    "I'd like to take this" (note: the course)
--       idea              "Share an idea" (note: their words)
--  2. prn_touches gains 'handled': the office dealt with a This week line from the page (a course assigned, an idea read).
-- ============================================================================
create table if not exists public.prn_page_log (
  id            bigserial primary key,
  applicant_id  uuid not null references public.job_applicants(id) on delete restrict,
  kind          text not null check (kind in ('viewed', 'office_preview', 'looking_on', 'looking_off', 'hours_saved', 'short_notice', 'break_set', 'course_request', 'idea')),
  note          text check (note is null or length(note) <= 600),
  by_name       text,
  by_email      text,
  at            timestamptz not null default now()
);
create index if not exists prn_page_log_member_idx on public.prn_page_log (applicant_id, at desc);
alter table public.prn_page_log enable row level security;
drop policy if exists prn_page_log_read on public.prn_page_log;
create policy prn_page_log_read on public.prn_page_log for select to authenticated using (true);
revoke all on public.prn_page_log from anon, authenticated;
grant select on public.prn_page_log to authenticated;
grant all on public.prn_page_log to service_role;
grant usage, select on sequence public.prn_page_log_id_seq to service_role;
create or replace function public.prn_page_log_frozen()
returns trigger language plpgsql as $$
begin
  raise exception 'HISTORY_IS_KEPT' using errcode = 'P0001', hint = 'What happened on a PRN Team page is never edited or deleted.';
end $$;
drop trigger if exists prn_page_log_frozen on public.prn_page_log;
create trigger prn_page_log_frozen before update or delete on public.prn_page_log
  for each row execute function public.prn_page_log_frozen();

alter table public.prn_touches drop constraint if exists prn_touches_kind_check;
alter table public.prn_touches add constraint prn_touches_kind_check check (kind in ('thanks_sent', 'card_mailed', 'called', 'not_this_one',
  'goback_asked', 'goback_yes', 'goback_no', 'goback_unclear', 'welcome_sent', 'welcome_call', 'handled'));
