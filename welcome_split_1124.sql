-- =============================================================================
-- 1124 · TWO WELCOME EMAILS (Samantha 2026-10-25: "please seperate the emails, the one to access axiscare should go automatically
-- to everyone in the family circle....the booking app should only be sent manually to those client who we think would be
-- interested or be able to turn off the booking app and that means it takes it off the email").
--  * circle_contacts: the AxisCare welcome's own record (when, who or "automatic", how), and why an automatic send couldn't go.
--    The existing welcome_sent_* columns are the Booking App email from now on.
--  * Everyone who already got the old combined welcome WITH the AxisCare steps counts as having the AxisCare welcome, so
--    nobody gets it twice. (A welcome sent with "Include the AxisCare Family Portal steps" unticked doesn't count.)
--  * care_circles: the client's Booking App off, with who, when and why.
--  * ops_settings.family_axis_welcome_auto = false (her switch for the automatic send), only when not already there.
-- Changes nothing else. Idempotent. All or nothing.
-- =============================================================================
begin;
do $guard$ begin
  if to_regclass('public.care_circles') is null or to_regclass('public.circle_contacts') is null then raise exception 'care_circles or circle_contacts is missing. Nothing was changed.'; end if;
end $guard$;
alter table public.circle_contacts add column if not exists axis_welcome_sent_at timestamptz;
alter table public.circle_contacts add column if not exists axis_welcome_sent_by text;
alter table public.circle_contacts add column if not exists axis_welcome_how text;
alter table public.circle_contacts add column if not exists axis_welcome_failed_at timestamptz;
alter table public.circle_contacts add column if not exists axis_welcome_failed_why text;
alter table public.care_circles add column if not exists booking_app_off_at timestamptz;
alter table public.care_circles add column if not exists booking_app_off_by text;
alter table public.care_circles add column if not exists booking_app_off_reason text;
update public.circle_contacts c
   set axis_welcome_sent_at = c.welcome_sent_at, axis_welcome_sent_by = c.welcome_sent_by, axis_welcome_how = 'with the first welcome'
 where c.welcome_sent_at is not null and c.axis_welcome_sent_at is null
   and coalesce((select e.data->>'include_axis' from public.op_events e
                  where e.verb = 'family_app_welcome' and e.data->>'contact_id' = c.id::text
                  order by e.at desc limit 1), 'true') <> 'false';
update public.app_data
   set data = jsonb_build_object('family_axis_welcome_auto', false) || coalesce(data, '{}'::jsonb)
 where key = 'ops_settings';
commit;
