-- 495 rollback: repeating tasks go away (the lines they already put on pages stay as ordinary lines).
begin;
drop table if exists public.desk_repeats cascade;
drop function if exists public.desk_guard_repeats();
commit;
