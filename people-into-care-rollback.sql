-- GATE 4b rollback · removes the "people going into care" door and its log.
-- The five circle_contacts columns are KEPT (they say where members came from and when
-- they were sent to AxisCare; dropping them would erase that). Circle members added
-- through the door stay in their Family Circles: they are real people the office chose.
begin;
drop function if exists public.people_into_care_add(text, text, uuid, text);
do $r$ begin
  if to_regclass('public.people_into_care_audit') is not null and exists (select 1 from public.people_into_care_audit where outcome = 'added') then
    raise notice 'people_into_care rollback: the log holds real additions, so it is kept as history (the door is gone)';
  else
    execute 'drop table if exists public.people_into_care_audit';
    execute 'drop function if exists public.people_into_care_guard()';
  end if;
end $r$;
commit;
