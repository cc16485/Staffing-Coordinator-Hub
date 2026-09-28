-- axiscare-change-log rollback: removes the record only while it is empty (once lines exist, it is history and stays).
begin;
do $r$ begin
  if exists (select 1 from public.axiscare_change_log) then
    raise exception 'axiscare_change_log rollback refused: it already holds records (they are history). Nothing was changed.'; end if;
end $r$;
drop function if exists public.axiscare_change_record(text,text,text,text,text,text,text,text,text);
drop table if exists public.axiscare_change_log;
drop function if exists public.axiscare_change_guard();
commit;
