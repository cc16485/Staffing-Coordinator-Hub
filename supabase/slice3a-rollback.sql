-- SLICE 3a ROLLBACK · nothing deleted. The caregiver catalog rows go inactive (they already are); the three columns and their
-- constraints are dropped only if no caregiver journey exists. Client journeys are untouched either way.
update public.client_journey_step_def set active = false, updated_by = 'rollback 3a' where key like 'cg.%';
do $r$ begin
  if exists (select 1 from public.client_journey where subject = 'caregiver') then
    raise notice 'caregiver journeys exist: the subject columns stay (nothing breaks with them present)';
  else
    alter table public.client_journey drop constraint if exists cj_caregiver_rows_are_caregivers;
    alter table public.client_journey drop constraint if exists cj_client_rows_are_clients;
    alter table public.client_journey drop constraint if exists cj_has_a_person_or_offer;
    alter table public.client_journey drop constraint if exists cj_caregiver_id_digits;
    alter table public.client_journey drop constraint if exists cj_caregiver_id_unique;
    alter table public.client_journey drop constraint if exists cj_offer_id_unique;
    alter table public.client_journey drop constraint if exists cj_subject_kind;
    drop index if exists public.client_journey_by_subject;
    alter table public.client_journey drop column if exists axiscare_caregiver_id;
    alter table public.client_journey drop column if exists offer_id;
    alter table public.client_journey drop column if exists subject;
    alter table public.client_journey add constraint cj_has_a_person check (lead_id is not null or axiscare_client_id is not null);
  end if;
end $r$;
