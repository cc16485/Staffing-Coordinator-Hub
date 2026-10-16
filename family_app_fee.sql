-- =============================================================================
-- family_app_fee.sql · the month-end App fee check for the family app (her yes 2026-10-16: "Approve the App fee check plan
-- as recommended"). Rules: supabase/functions/_shared/family-fee.ts.
--  * care_circles gains the App plan tick: app_plan (null = never set, so the first family login invite turns it on),
--    app_plan_since (the month they join is free), app_plan_by.
--  * family_app_fees: one row per App plan client per month: visits, the result (free / fee / joined / couldnt_check),
--    the fee, and the office's "Added to the AxisCare invoice" tick (billed_at, billed_by). Office read; server writes.
--  * ops_settings: family_app_fee 15 (only where not set), and family_fee_check_ready true. Her go-live rule: live family
--    booking needs family_app_live AND family_fee_check_ready, so the app cannot go live without this check.
-- Changes nothing else. Idempotent.
-- =============================================================================
begin;

do $guard$
begin
  if to_regclass('public.care_circles') is null then raise exception 'refused: care_circles not found. Nothing was changed.'; end if;
  if to_regprocedure('public.hub_office_ok()') is null then raise exception 'refused: hub_office_ok() is missing. Nothing was changed.'; end if;
end $guard$;

alter table public.care_circles add column if not exists app_plan boolean;
alter table public.care_circles add column if not exists app_plan_since date;
alter table public.care_circles add column if not exists app_plan_by text;

create table if not exists public.family_app_fees (
  month               text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  axiscare_client_id  text not null,
  circle_id           text,
  client_name         text,
  visits              int,
  result              text not null check (result in ('free', 'fee', 'joined', 'couldnt_check')),
  fee                 numeric(6,2) not null default 0,
  error               text,
  checked_at          timestamptz not null default now(),
  checked_by          text,
  billed_at           timestamptz,
  billed_by           text,
  primary key (month, axiscare_client_id)
);
alter table public.family_app_fees enable row level security;
revoke all on public.family_app_fees from anon, authenticated;
grant select on public.family_app_fees to authenticated;
grant select, insert, update on public.family_app_fees to service_role;
drop policy if exists family_app_fees_office_read on public.family_app_fees;
create policy family_app_fees_office_read on public.family_app_fees for select to authenticated using (public.hub_office_ok());

update public.app_data
   set data = jsonb_build_object('family_app_fee', 15) || coalesce(data, '{}'::jsonb) || jsonb_build_object('family_fee_check_ready', true)
 where key = 'ops_settings';

commit;
