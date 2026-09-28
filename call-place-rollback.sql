-- Rollback for call-place.sql. Only while nothing has been placed: once a person has placed a call, it is history.
begin;
do $r$ begin
  if to_regclass('public.call_placement') is not null and exists (select 1 from public.call_placement) then
    raise exception 'call_placement rollback refused: calls have been placed (they are history). Nothing was changed.'; end if;
end $r$;
drop table if exists public.call_placement;
drop function if exists public.call_record_place(bigint[],text,text,uuid,text,text,text);
drop function if exists public.call_placement_guard();
commit;
