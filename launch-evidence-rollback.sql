-- launch-evidence-rollback.sql · removes Change 1's table and Door while unused.
-- Refuses once any evidence has been recorded (that history is not thrown away).
-- The client_queue boxes the Door ticked stay ticked; they are ordinary launch steps.
begin;
do $guard$
declare n bigint;
begin
  if to_regclass('public.launch_evidence') is not null then
    lock table public.launch_evidence in access exclusive mode;
    select count(*) into n from public.launch_evidence;
    if n > 0 then raise exception 'launch_evidence rollback refused: % row(s) of evidence recorded. Nothing was changed.', n; end if;
  end if;
end $guard$;
drop function if exists public.launch_evidence_record(uuid, text, jsonb, text, text, text);
drop function if exists public.launch_evidence_stamp(text);
drop table if exists public.launch_evidence;
drop function if exists public.launch_evidence_guard();
commit;
