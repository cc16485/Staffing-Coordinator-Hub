-- RN review rollback (2026-10-14). Removes the storage keep-guard on nurse-docs, the GHE signature keeper on app_data and
-- the read-only retention view. Deletes
-- nothing (her rule: no record or signed document is ever deleted on rollback): the three tables and every row, their
-- guards, the private bucket and its files all stay, unreachable by anon and authenticated; without the rn-review
-- function nothing reads or writes them. Safe to run twice.
begin;
drop trigger if exists nurse_documents_keep on storage.objects;
drop function if exists public.nurse_documents_keep();
drop view if exists public.rn_review_retention;
drop trigger if exists ghe_forms_a_rn_keep_t on public.app_data;
drop function if exists public.ghe_rn_signature_keep();
commit;
