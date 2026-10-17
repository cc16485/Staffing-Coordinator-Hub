-- =============================================================================
-- Family app Release 1: honest requests (Samantha 2026-10-17: "Approve decisions 1 to 7 as recommended, office help Monday
-- to Friday only, and the confirmation text until 9 PM. Start Release 1.").
--  * family_bookings: answer_by / team_from / asking_from / two_stage (when the family hears back; two stages for visits
--    more than 7 days ahead), all_asked_at, ended_at / ended_why, the "not filled" family message fields, and the new
--    status 'not_filled' (nobody accepted; nothing scheduled).
--  * ops_settings: her approval of the "not filled" family message recorded (family_unfilled_text_approved), and
--    "Let me choose" paused (family_choose_live false; decision 3, the code stays).
-- Changes nothing else. Idempotent. All or nothing.
-- =============================================================================
begin;
do $guard$ begin
  if to_regclass('public.family_bookings') is null then raise exception 'family_bookings is missing (run the family app steps first). Nothing was changed.'; end if;
end $guard$;
alter table public.family_bookings add column if not exists answer_by timestamptz;
alter table public.family_bookings add column if not exists team_from timestamptz;
alter table public.family_bookings add column if not exists asking_from timestamptz;
alter table public.family_bookings add column if not exists two_stage boolean not null default false;
alter table public.family_bookings add column if not exists all_asked_at timestamptz;
alter table public.family_bookings add column if not exists ended_at timestamptz;
alter table public.family_bookings add column if not exists ended_why text;
alter table public.family_bookings add column if not exists family_unfilled_pending boolean not null default false;
alter table public.family_bookings add column if not exists family_unfilled_at timestamptz;
alter table public.family_bookings add column if not exists family_unfilled_how text;
do $status$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.family_bookings'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%waiting_for_caregiver%' loop
    execute format('alter table public.family_bookings drop constraint %I', c);
  end loop;
  alter table public.family_bookings add constraint family_bookings_status_check
    check (status in ('received', 'practice', 'waiting_for_caregiver', 'placed', 'needs_office', 'cancelled', 'not_filled'));
end $status$;
create index if not exists family_bookings_unfilled_due on public.family_bookings (family_unfilled_pending) where family_unfilled_pending;
update public.app_data
   set data = jsonb_build_object(
                'family_unfilled_text_approved', jsonb_build_object('by', 'Samantha', 'on', '2026-10-17',
                  'words', 'Approve decisions 1 to 7 as recommended, office help Monday to Friday only, and the confirmation text until 9 PM. Start Release 1.',
                  'scope', 'ONE message to the person who booked when nobody accepted their app request: nothing was scheduled, no charge, request another time. The text with Texts OK, else the email; 8 AM to 7:30 PM Central')
              ) || coalesce(data, '{}'::jsonb) || jsonb_build_object('family_choose_live', false)
 where key = 'ops_settings';
commit;
