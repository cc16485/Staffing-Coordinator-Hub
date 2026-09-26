-- =============================================================================
-- admission-newclients-rollback.sql · removes Step 3's admission objects ONLY while unused
-- Refuses once any admission has recorded its Journey (those are history).
-- =============================================================================
begin;
do $guard$
declare n bigint;
begin
  if to_regclass('public.client_admission_journey') is not null then
    lock table public.client_admission_journey in access exclusive mode;
    select count(*) into n from public.client_admission_journey;
    if n > 0 then raise exception 'rollback refused: % admission Journey decision(s) exist. Nothing was changed.', n; end if;
  end if;
end $guard$;
drop view if exists public.client_admission_lead_options;
drop function if exists public.client_admission_admit(uuid, text, uuid, text, text, text, text, text);
drop table if exists public.client_admission_journey;
drop function if exists public.client_admission_journey_guard();
commit;
