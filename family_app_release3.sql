-- =============================================================================
-- Family app Release 3: safe matching, notes and Help us fill (Samantha 2026-10-17: "Start Release 3."; decisions 3, 4, 5
-- and 6 approved the same day, https://claude.ai/artifact/AS6GbybmUqC47WKPto44p8).
--  * family_bookings: what the caregiver should know (home_notes), the note checks (note_check, note_hidden), a request held
--    for the office (hold_reason, held_by, held_at, reviewed_*, decline_reason), the decline message owed, Help us fill
--    (help_fill, fill_task_at, fill_closed_by, unfilled_kind 'couldnt'), and the statuses 'held' and 'declined'.
--  * care_circles: the companion tasks this client may pick in the app (app_tasks, null = all) and the Help us fill flag.
--  * family_bookings: a late cancel's charge for the weekly billing list (late_charge_hours, late_pay_caregiver, late_billed_*),
--    instead of an office card (her 2026-10-17 check: no office involvement where it isn't needed).
--  * ops_settings: her approval of the "couldn't fill" family message recorded. (Flagged notes are stopped at Send since her
--    choice of 2026-10-17, so no "declined" message is ever sent and none is recorded.)
-- Changes nothing else. Idempotent. All or nothing.
-- =============================================================================
begin;
do $guard$ begin
  if to_regclass('public.family_bookings') is null or to_regclass('public.care_circles') is null then raise exception 'family_bookings or care_circles is missing. Nothing was changed.'; end if;
end $guard$;
alter table public.family_bookings add column if not exists home_notes jsonb;
alter table public.family_bookings add column if not exists note_check text;
alter table public.family_bookings add column if not exists note_hidden boolean not null default false;
alter table public.family_bookings add column if not exists hold_reason text;
alter table public.family_bookings add column if not exists held_by text;
alter table public.family_bookings add column if not exists held_at timestamptz;
alter table public.family_bookings add column if not exists reviewed_at timestamptz;
alter table public.family_bookings add column if not exists reviewed_by text;
alter table public.family_bookings add column if not exists review_decision text;
alter table public.family_bookings add column if not exists decline_reason text;
alter table public.family_bookings add column if not exists family_declined_pending boolean not null default false;
alter table public.family_bookings add column if not exists family_declined_at timestamptz;
alter table public.family_bookings add column if not exists family_declined_how text;
alter table public.family_bookings add column if not exists help_fill boolean not null default false;
alter table public.family_bookings add column if not exists fill_task_at timestamptz;
alter table public.family_bookings add column if not exists fill_closed_by text;
alter table public.family_bookings add column if not exists unfilled_kind text;
alter table public.family_bookings add column if not exists late_charge_hours numeric;
alter table public.family_bookings add column if not exists late_pay_caregiver text;
alter table public.family_bookings add column if not exists late_billed_at timestamptz;
alter table public.family_bookings add column if not exists late_billed_by text;
do $status$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.family_bookings'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%waiting_for_caregiver%' loop
    execute format('alter table public.family_bookings drop constraint %I', c);
  end loop;
  alter table public.family_bookings add constraint family_bookings_status_check
    check (status in ('received', 'practice', 'waiting_for_caregiver', 'placed', 'needs_office', 'cancelled', 'not_filled', 'held', 'declined'));
end $status$;
create index if not exists family_bookings_held on public.family_bookings (answer_by) where status = 'held';
create index if not exists family_bookings_declined_due on public.family_bookings (family_declined_pending) where family_declined_pending;
alter table public.care_circles add column if not exists app_tasks text[];
alter table public.care_circles add column if not exists help_fill jsonb;
update public.app_data
   set data = jsonb_build_object(
                'family_couldnt_text_approved', jsonb_build_object('by', 'Samantha', 'on', '2026-10-17',
                  'words', 'Approve decisions 1 to 7 as recommended, office help Monday to Friday only (decision 3: Help us fill, couldn''t fill)',
                  'scope', 'ONE message to the person who booked when a Help us fill request ends unfilled after the office tried: nothing was scheduled, no charge, call us if essential. The text with Texts OK, else the email; 8 AM to 7:30 PM Central')
              ) || coalesce(data, '{}'::jsonb)
 where key = 'ops_settings';
commit;
