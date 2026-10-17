-- =============================================================================
-- The family welcome (Samantha 2026-10-17: "make it manual and make note of the date and time it was sent - then have an alert
-- if it wasn't sent"; "then we can choose the correct email too"; "Build it. The chosen version also sets the App plan fee
-- default: Flexible on, Regular and Combination off (office can still change it)").
--  * care_circles: the client's Care Scheduling Type (regular | flexible | both), with who set it and when.
--  * circle_contacts: the welcome record (when, who, which version, how), when the person first became ready for one (for the
--    one-business-day reminder), and "No welcome" with who and why.
--  * ops_settings: the reminder on (family_welcome_alert_live), and the clients who never get a reminder
--    (family_welcome_skip_clients, AxisCare ids): Charles & Jodie (live-in, #55), Cynthia (#220), Karen (#247) and Tommy (#294)
--    (IHS ending), and the Office Staff record (#293). Only set when not already there.
-- Changes nothing else. Idempotent. All or nothing.
-- =============================================================================
begin;
do $guard$ begin
  if to_regclass('public.care_circles') is null or to_regclass('public.circle_contacts') is null then raise exception 'care_circles or circle_contacts is missing. Nothing was changed.'; end if;
end $guard$;
alter table public.care_circles add column if not exists care_scheduling_type text;
alter table public.care_circles add column if not exists care_scheduling_type_at timestamptz;
alter table public.care_circles add column if not exists care_scheduling_type_by text;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'care_circles_care_scheduling_type_check') then
    alter table public.care_circles add constraint care_circles_care_scheduling_type_check check (care_scheduling_type is null or care_scheduling_type in ('regular', 'flexible', 'both'));
  end if;
end $c$;
alter table public.circle_contacts add column if not exists welcome_sent_at timestamptz;
alter table public.circle_contacts add column if not exists welcome_sent_by text;
alter table public.circle_contacts add column if not exists welcome_version text;
alter table public.circle_contacts add column if not exists welcome_how text;
alter table public.circle_contacts add column if not exists welcome_ready_at timestamptz;
alter table public.circle_contacts add column if not exists welcome_skip_at timestamptz;
alter table public.circle_contacts add column if not exists welcome_skip_by text;
alter table public.circle_contacts add column if not exists welcome_skip_reason text;
update public.app_data
   set data = jsonb_build_object('family_welcome_alert_live', true, 'family_welcome_skip_clients', jsonb_build_array('55', '220', '247', '294', '293')) || coalesce(data, '{}'::jsonb)
 where key = 'ops_settings';
commit;
