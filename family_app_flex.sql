-- =============================================================================
-- family_app_flex.sql · Flexible booking + caregiver offers for the family app (her yes 2026-10-16:
-- "Approve the family app flexible booking plan as recommended: caregiver yes goes straight on the schedule, picks get
-- 4 hours first, office card if unfilled 24 hours before or everyone asked, families see who and when in the app only.")
--  * family_bookings: a set time (from/to) or flexible (anytime between window_start and window_end, `hours` long).
--    A flexible booking has no start/end until a caregiver takes it and picks the start; only then is the AxisCare visit
--    made. preferred_caregiver_ids = the caregivers the family would like asked first. who: preferred | any (old
--    regular/favorites answers still accepted). offer_stage / offer_next_at / unfilled_card_at are the offer engine's.
--  * family_offers: one row per caregiver asked about one booking. The link in the text is signed (HMAC with
--    HUB_JOB_SECRET, its own purpose label) and names only the offer. Only the server writes it; office staff read it.
--  * ops_settings, only where not set: booking days/hours per state (MO any day 7-18, OK Mon-Fri 8-18), and the offer
--    engine's settings with family_offer_live OFF. A $5 Missouri short-visit extra in the app settings is removed (her rule
--    2026-10-16: the app has no extra charge for short visits).
-- Changes nothing else. Idempotent.
-- =============================================================================
begin;

do $guard$
begin
  if to_regclass('public.family_bookings') is null then
    raise exception 'refused: family_bookings not found (Step 1a first). Nothing was changed.'; end if;
  if to_regprocedure('public.hub_office_ok()') is null then
    raise exception 'refused: hub_office_ok() is missing. Nothing was changed.'; end if;
end $guard$;

alter table public.family_bookings add column if not exists kind text not null default 'set';
alter table public.family_bookings add column if not exists window_start text;
alter table public.family_bookings add column if not exists window_end text;
alter table public.family_bookings add column if not exists preferred_caregiver_ids text[] not null default '{}';
alter table public.family_bookings add column if not exists offer_stage text;
alter table public.family_bookings add column if not exists offer_next_at timestamptz;
alter table public.family_bookings add column if not exists unfilled_card_at timestamptz;
alter table public.family_bookings alter column start_time drop not null;
alter table public.family_bookings alter column end_time drop not null;
update public.family_bookings set window_start = start_time, window_end = end_time where window_start is null and start_time is not null;

alter table public.family_bookings drop constraint if exists family_bookings_who_check;
alter table public.family_bookings drop constraint if exists family_bookings_who_ck;
alter table public.family_bookings add constraint family_bookings_who_ck check (who is null or who in ('preferred', 'any', 'regular', 'favorites'));
alter table public.family_bookings drop constraint if exists family_bookings_kind_ck;
alter table public.family_bookings add constraint family_bookings_kind_ck check (kind in ('set', 'flex'));
alter table public.family_bookings drop constraint if exists family_bookings_times_ck;
alter table public.family_bookings add constraint family_bookings_times_ck check (
  (start_time is null or start_time ~ '^\d{2}:\d{2}$') and (end_time is null or end_time ~ '^\d{2}:\d{2}$')
  and (window_start is null or window_start ~ '^\d{2}:\d{2}$') and (window_end is null or window_end ~ '^\d{2}:\d{2}$')
  and (kind = 'flex' or (start_time is not null and end_time is not null))
  and (kind = 'set' or (window_start is not null and window_end is not null)));
alter table public.family_bookings drop constraint if exists family_bookings_stage_ck;
alter table public.family_bookings add constraint family_bookings_stage_ck check (offer_stage is null or offer_stage in ('picks', 'team', 'done'));
create index if not exists family_bookings_offering on public.family_bookings (visit_date) where status = 'waiting_for_caregiver' and caregiver_axiscare_id is null;

create table if not exists public.family_offers (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null references public.family_bookings (id),
  caregiver_axiscare_id text not null,
  caregiver_name        text,
  wave                  text not null check (wave in ('picks', 'team')),
  wave_no               int not null default 1,
  state                 text not null check (state in ('sent', 'yes', 'no', 'taken', 'closed', 'failed')),
  sent_at               timestamptz,
  answered_at           timestamptz,
  picked_start          text,
  error                 text,
  created_at            timestamptz not null default now(),
  unique (booking_id, caregiver_axiscare_id)
);
create index if not exists family_offers_booking on public.family_offers (booking_id);
alter table public.family_offers enable row level security;
revoke all on public.family_offers from anon, authenticated;
grant select on public.family_offers to authenticated;
grant select, insert, update on public.family_offers to service_role;
drop policy if exists family_offers_office_read on public.family_offers;
create policy family_offers_office_read on public.family_offers for select to authenticated using (public.hub_office_ok());

-- Her rule 2026-10-16 (live on mo-care.com/app): no extra charge for short visits booked in the app. Clear the old $5.
update public.app_data set data = data - 'family_app_short_extra_MO' where key = 'ops_settings' and (data->>'family_app_short_extra_MO') = '5';

-- Settings, only where not set already (her own values kept).
update public.app_data
   set data = jsonb_build_object(
                'family_app_days_MO', '[0,1,2,3,4,5,6]'::jsonb, 'family_app_open_MO', '07:00', 'family_app_close_MO', '18:00',
                'family_app_days_OK', '[1,2,3,4,5]'::jsonb,     'family_app_open_OK', '08:00', 'family_app_close_OK', '18:00',
                'family_offer_live', false,
                'family_offer_pick_wait_hours', 4,
                'family_offer_wave_size', 5,
                'family_offer_wave_gap_minutes', 60,
                'family_offer_unfilled_hours', 24) || coalesce(data, '{}'::jsonb)
 where key = 'ops_settings';

commit;
