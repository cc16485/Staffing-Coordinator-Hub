-- =============================================================================
-- HIPAA OK in the Hub (Samantha 2026-10-23: "approve it only in the hub instead of checking axiscare"; "recorded with who and
-- when, kept through the nightly sync, AxisCare's explicit No still wins"). Two columns on circle_contacts: when the office
-- marked HIPAA OK and who. circles-sync only writes its own AxisCare fields, so these stay through the nightly run.
-- Changes nothing else. Idempotent. All or nothing.
-- =============================================================================
begin;
do $guard$ begin
  if to_regclass('public.circle_contacts') is null then raise exception 'circle_contacts is missing. Nothing was changed.'; end if;
end $guard$;
alter table public.circle_contacts add column if not exists hipaa_office_ok_at timestamptz;
alter table public.circle_contacts add column if not exists hipaa_office_ok_by text;
commit;
