-- =============================================================================
-- People involved, lined up with the Client Care Agreement (Samantha 2026-10-17: "line People involved up with the agreement:
-- Medical decisions, Health and Financial POA, and HIPAA shown from the signed agreement").
-- The roles a person on a Journey may carry gain medical_decisions, poa_health and poa_financial. The older decision_maker and
-- poa stay valid, because journey_person is append-only history and nothing is re-labelled by guessing. Both the table's check
-- and the one door that records people (people_on_journey_record) are widened; nothing else in the function changes.
-- Idempotent. All or nothing.
-- =============================================================================
begin;
do $guard$ begin
  if to_regclass('public.journey_person') is null then raise exception 'journey_person is missing. Nothing was changed.'; end if;
end $guard$;
do $roles$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.journey_person'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%decision_maker%' loop
    execute format('alter table public.journey_person drop constraint %I', c);
  end loop;
  alter table public.journey_person add constraint journey_person_roles_check
    check (roles <@ array['primary','decision_maker','poa','medical_decisions','poa_health','poa_financial','billing','emergency','professional']::text[]);
end $roles$;
do $door$
declare f regprocedure; def text;
  old_list text := $q$array['primary','decision_maker','poa','billing','emergency','professional']::text[]$q$;
  new_list text := $q$array['primary','decision_maker','poa','medical_decisions','poa_health','poa_financial','billing','emergency','professional']::text[]$q$;
begin
  select p.oid::regprocedure into f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'people_on_journey_record';
  if f is null then raise exception 'people_on_journey_record is missing. Nothing was changed.'; end if;
  def := pg_get_functiondef(f);
  if position(new_list in def) > 0 then return; end if;                 -- already done
  if position(old_list in def) = 0 then raise exception 'people_on_journey_record does not look as expected. Nothing was changed.'; end if;
  execute replace(def, old_list, new_list);                              -- CREATE OR REPLACE: owner, grants and everything else kept
end $door$;
commit;
