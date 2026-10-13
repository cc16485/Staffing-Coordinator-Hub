-- Hepatitis B vaccination rollback (2026-10-13). Removes the storage keep-guard on hepb-docs and turns the readiness row
-- cg.health.hepb off. Deletes nothing: the three tables and every row (confidential medical records kept for employment plus
-- 30 years, 1910.1030(h)(1)(iv)), the history guards, the private bucket and its files all stay, unreachable by anon and
-- authenticated; without the hepb function nothing reads or writes them. Safe to run twice.
begin;
drop trigger if exists hepb_documents_keep on storage.objects;
drop function if exists public.hepb_documents_keep();
update public.client_journey_step_def set active = false, updated_by = 'hepb rollback' where key = 'cg.health.hepb';
commit;
