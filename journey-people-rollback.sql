-- Gate 4a rollback. Refuses once any person has been recorded (people are history, not thrown away by accident).
begin;
do $r$ begin
  if to_regclass('public.journey_person') is not null and exists (select 1 from public.journey_person) then
    raise exception 'people have been recorded; not removing them. Remove by hand only on purpose.'; end if;
end $r$;
drop view if exists public.journey_person_current;
drop function if exists public.people_on_journey_record(uuid,uuid,boolean,text,text,text,text[],text,text,text,text,text,text,timestamptz,text,uuid,text,text);
drop table if exists public.journey_person_door_audit;
drop table if exists public.journey_person;
drop function if exists public.people_on_journey_guard();
commit;
