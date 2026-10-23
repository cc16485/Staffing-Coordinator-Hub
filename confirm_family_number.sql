-- =============================================================================
-- Confirm a family member's number in the Hub (Samantha 2026-10-23: "add a Confirm number button in the Hub (who and when
-- recorded). Switch-free."). A number that came from AxisCare is "probable" in phone_index and is never texted until a person
-- confirms it. The confirmation itself is written to phone_index (verified_by, verified_at) by family-app-office; these three
-- columns show it on the Family Circle person, for the number it was confirmed for (a new number starts unconfirmed again).
-- Changes nothing else. Idempotent. All or nothing.
-- =============================================================================
begin;
do $guard$ begin
  if to_regclass('public.circle_contacts') is null or to_regclass('public.phone_index') is null then raise exception 'circle_contacts or phone_index is missing. Nothing was changed.'; end if;
end $guard$;
alter table public.circle_contacts add column if not exists phone_confirmed_at timestamptz;
alter table public.circle_contacts add column if not exists phone_confirmed_by text;
alter table public.circle_contacts add column if not exists phone_confirmed_number text;
commit;
