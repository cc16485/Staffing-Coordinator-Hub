-- 700 rollback: removes the seven-year guard on signed onboarding files and the read-only view. Deletes nothing.
begin;
drop trigger if exists onboarding_documents_keep on storage.objects;
drop function if exists public.onboarding_documents_keep();
drop view if exists public.onboarding_retention;
commit;
