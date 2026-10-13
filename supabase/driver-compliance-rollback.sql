-- Driver compliance rollback (2026-10-13). Removes the roster door, the storage keep-guard on driver-docs and the
-- cleared_to_drive word in the value history. Deletes nothing (her rule: no record or signed document is ever deleted on
-- rollback): the three tables and every row, the history guards, the private bucket and its files all stay, unreachable
-- by anon and authenticated; without the driver-compliance function nothing reads or writes them. Safe to run twice.
begin;
drop function if exists public.driver_roster_patch(text, bigint, jsonb, text);
drop trigger if exists driver_documents_keep on storage.objects;
drop function if exists public.driver_documents_keep();
commit;
do $p$ declare src text; begin
  if to_regprocedure('public.evidence_field_kept(text,text)') is null then return; end if;
  src := pg_get_functiondef('public.evidence_field_kept(text,text)'::regprocedure);
  if position('''hire_date'', ''cleared_to_drive'', ''axiscare_id''' in src) = 0 then raise notice 'cleared_to_drive is not in the history rule: nothing to undo'; return; end if;
  execute replace(src, '''hire_date'', ''cleared_to_drive'', ''axiscare_id''', '''hire_date'', ''axiscare_id''');
end $p$;
