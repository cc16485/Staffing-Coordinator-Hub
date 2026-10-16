-- =============================================================================
-- family_app_offer_v2.sql · The caregiver offer, her rules (2026-10-16): the caregiver's link shows a short About the office
-- wrote, and "the family asked for you" only when they did; the family hears who's coming when a caregiver is confirmed
-- (her words: "including the automatic text to the family when a caregiver is confirmed (8 AM to 8 PM, Texts OK only, email
-- if no consent)").
--  * care_circles.caregiver_about (+ by, at): the office's few sentences for caregivers. First name only, no address or
--    medical detail. 400 characters at most.
--  * family_bookings.family_confirm_pending / family_confirmed_at / family_confirm_how: the one "who's coming" message.
--  * ops_settings, only where not set: her approval of that message recorded (family_confirm_text_approved).
-- Changes nothing else. Idempotent.
-- =============================================================================
begin;

do $guard$
begin
  if to_regclass('public.family_bookings') is null or to_regclass('public.care_circles') is null then
    raise exception 'refused: family_bookings or care_circles not found. Nothing was changed.'; end if;
end $guard$;

alter table public.care_circles add column if not exists caregiver_about text;
alter table public.care_circles add column if not exists caregiver_about_by text;
alter table public.care_circles add column if not exists caregiver_about_at timestamptz;
alter table public.care_circles drop constraint if exists care_circles_caregiver_about_len;
alter table public.care_circles add constraint care_circles_caregiver_about_len check (caregiver_about is null or char_length(caregiver_about) <= 400);

alter table public.family_bookings add column if not exists family_confirm_pending boolean not null default false;
alter table public.family_bookings add column if not exists family_confirmed_at timestamptz;
alter table public.family_bookings add column if not exists family_confirm_how text;
create index if not exists family_bookings_confirm_due on public.family_bookings (visit_date) where status = 'placed' and family_confirm_pending;

update public.app_data
   set data = jsonb_build_object(
                'family_confirm_text_approved', jsonb_build_object('by', 'Samantha', 'on', '2026-10-16',
                  'words', 'Yes, build all of it, including the automatic text to the family when a caregiver is confirmed (8 AM to 8 PM, Texts OK only, email if no consent).',
                  'scope', 'ONE message to the person who booked, when a caregiver is confirmed on a visit booked in the family app: the text with Texts OK, else the email; 8 AM to 8 PM Central')
              ) || coalesce(data, '{}'::jsonb)
 where key = 'ops_settings';

commit;
