-- GATE 2a rollback. Nothing reads the fact record until Gate 3, so removing it affects no screen or function.
-- If any fact has already been recorded, this refuses: facts are history and are not thrown away by accident.
begin;
do $r$ begin
  if to_regclass('public.client_fact') is not null and exists (select 1 from public.client_fact) then
    raise exception 'facts have been recorded; not removing them. Remove by hand only on purpose.'; end if;
end $r$;
drop view if exists public.client_fact_current;
drop function if exists public.client_fact_record(uuid,text,text,jsonb,text,text,uuid,text,text,text,text,timestamptz,text,text,text);
drop function if exists public.care_began_for_episode(uuid);
drop table if exists public.client_fact_door_audit;
drop table if exists public.client_fact;
drop table if exists public.fact_kind;
drop function if exists public.client_fact_guard();
commit;
