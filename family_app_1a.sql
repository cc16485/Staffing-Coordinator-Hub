-- =============================================================================
-- family_app_1a.sql · Family booking app, Step 1a (plan approved 2026-10-15). Run by Desktop 801.
--  * circle_contacts gains the app columns: who has an app login (app_user_id = the login in cc-family-app),
--    whether it is on (app_status), whether they may book (app_can_book), who turned it on and when.
--  * family_bookings: the family's booking REQUEST, a work record pointing at the AxisCare visit it became.
--    AxisCare stays the record of the visit itself. Office staff read it; only the server writes it.
--  * ops_settings gains the app's settings, only where not already set: practice mode on (family_app_live false),
--    Missouri's app service "PP - WC" (Private Pay - Wellness Care), Oklahoma none yet, the family-cancel reason.
-- Changes nothing else. Idempotent.
-- =============================================================================
begin;

do $guard$
begin
  if to_regclass('public.circle_contacts') is null or to_regclass('public.care_circles') is null then
    raise exception '801 refused: circle_contacts / care_circles not found. Nothing was changed.'; end if;
  if to_regprocedure('public.hub_office_ok()') is null then
    raise exception '801 refused: hub_office_ok() is missing. Nothing was changed.'; end if;
end $guard$;

alter table public.circle_contacts add column if not exists app_user_id uuid;
alter table public.circle_contacts add column if not exists app_status text;
alter table public.circle_contacts add column if not exists app_can_book boolean not null default false;
alter table public.circle_contacts add column if not exists app_invited_at timestamptz;
alter table public.circle_contacts add column if not exists app_invited_by text;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'circle_contacts_app_status_ck') then
    alter table public.circle_contacts add constraint circle_contacts_app_status_ck check (app_status is null or app_status in ('active', 'revoked'));
  end if;
end $c$;
create unique index if not exists circle_contacts_app_login_once on public.circle_contacts (app_user_id, circle_id) where app_user_id is not null;
create index if not exists circle_contacts_app_user on public.circle_contacts (app_user_id) where app_user_id is not null;

create table if not exists public.family_bookings (
  id                              uuid primary key default gen_random_uuid(),
  axiscare_client_id              text not null,
  client_name                     text,
  state                           text check (state in ('MO', 'OK')),
  contact_id                      bigint,
  app_user_id                     uuid,
  requested_by_name               text,
  visit_date                      date not null,
  start_time                      text not null check (start_time ~ '^\d{2}:\d{2}$'),
  end_time                        text not null check (end_time ~ '^\d{2}:\d{2}$'),
  hours                           numeric(4,1) not null check (hours >= 2),
  tasks                           text[] not null default '{}',
  who                             text check (who in ('regular', 'favorites', 'any')),
  requested_caregiver_axiscare_id text,
  note                            text,
  status                          text not null check (status in ('received', 'practice', 'waiting_for_caregiver', 'placed', 'needs_office', 'cancelled')),
  axiscare_visit_id               text,
  caregiver_axiscare_id           text,
  caregiver_name                  text,
  error                           text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  placed_at                       timestamptz,
  placed_by                       text,
  cancelled_at                    timestamptz,
  cancelled_by                    text
);
create index if not exists family_bookings_client on public.family_bookings (axiscare_client_id, visit_date);
create index if not exists family_bookings_open on public.family_bookings (visit_date) where status in ('received', 'waiting_for_caregiver', 'needs_office');
create unique index if not exists family_bookings_one_slot on public.family_bookings (axiscare_client_id, visit_date, start_time) where status <> 'cancelled';

alter table public.family_bookings enable row level security;
revoke all on public.family_bookings from anon, authenticated;
grant select on public.family_bookings to authenticated;
grant select, insert, update on public.family_bookings to service_role;
drop policy if exists family_bookings_office_read on public.family_bookings;
create policy family_bookings_office_read on public.family_bookings for select to authenticated using (public.hub_office_ok());

-- The app's settings, only where not set already (Hub-editable later).
update public.app_data
   set data = jsonb_build_object(
                'family_app_live', false,
                'family_app_service_MO', 'PP - WC',
                'family_app_cancel_reason', 'Schedule Change - Client Cancellation',
                'family_app_office_phone_MO', '(417) 234-8494') || coalesce(data, '{}'::jsonb)
 where key = 'ops_settings';

commit;
