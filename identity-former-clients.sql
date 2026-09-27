-- =============================================================================
-- identity-former-clients.sql · One client profile, step 5b-A (2026-09-27)
--
-- Returning families: ~268 former AxisCare clients are not in the hub's identity list, so a family
-- that calls back can't be recognised. Approved 2026-09-27 ("yes to all"): bring them in with their
-- name, birth date and phones, marked former, no Journey.
--
--   person_identity + birth_date   (the one new field; from AxisCare's dateOfBirth; a strong match
--                                   signal together with the name, never used alone)
--
-- Additive and rerunnable; no row is changed here (identity-backfill ?former_clients=1 fills it).
-- =============================================================================
begin;

alter table public.person_identity add column if not exists birth_date date;
comment on column public.person_identity.birth_date is
  'From AxisCare dateOfBirth (identity-backfill). With the name, a strong "same family?" signal for a person to confirm; never a match on its own.';

do $verify$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'person_identity' and column_name = 'birth_date' and data_type = 'date') then
    raise exception 'identity-former-clients self-check failed: birth_date column';
  end if;
end $verify$;

commit;
