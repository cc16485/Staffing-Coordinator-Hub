-- =============================================================================
-- SLICE 8 · CLIENT AUDIT READINESS (Samantha "GO" / "YES TO ALL", 2026-10-11). Hub project. Three nullable columns on
-- client_issue for the grievance written answer (her decision 2): the file the Hub stored, how it was answered, or why it was
-- answered in person. Nothing else changes in the database; the nightly client pass, the proof files and the export live in
-- the client-audit function. The schedule (client-audit-nightly) and the ihs-rules.js fingerprint are installed by the step.
-- Rollback: the columns stay (they only add evidence); the function and schedule are removed by the rollback step.
-- =============================================================================
do $guard$ begin
  if to_regclass('public.client_issue') is null then raise exception 'slice 8 refused: client_issue is missing. Nothing was changed.'; end if;
  if to_regclass('public.document_access_log') is null then raise exception 'slice 8 refused: document_access_log is missing. Nothing was changed.'; end if;
end $guard$;
alter table public.client_issue add column if not exists resolution_doc text;
alter table public.client_issue add column if not exists resolution_how text check (resolution_how is null or resolution_how in ('written', 'in_person'));
alter table public.client_issue add column if not exists resolution_in_person text;
comment on column public.client_issue.resolution_doc is 'Slice 8: the written answer to a grievance, a path in the private client-journey-files bucket (grievance/<issue id>/...)';
comment on column public.client_issue.resolution_in_person is 'Slice 8: why a grievance was answered in person instead of in writing (her decision 2)';
do $v$ declare n int; begin
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'client_issue' and column_name in ('resolution_doc', 'resolution_how', 'resolution_in_person');
  if n <> 3 then raise exception 'slice 8 self-check: the three grievance answer columns are not all there'; end if;
end $v$;
