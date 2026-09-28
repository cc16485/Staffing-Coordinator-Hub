-- Rollback for call-record.sql. Only while the record is empty: once it holds calls they are history, and it refuses.
begin;
do $r$ begin
  if to_regclass('public.call_record') is not null and exists (select 1 from public.call_record) then
    raise exception 'call_record rollback refused: it already holds calls (they are history). Nothing was changed.'; end if;
end $r$;
drop table if exists public.call_record;
drop function if exists public.call_record_add(text,text,text,text,text,text,text,text,text,text,text);
drop function if exists public.call_record_guard();
commit;
