-- Drug test record rollback (2026-10-13). Removes the storage keep-guard on drug-test-docs. Deletes nothing (her rule: no
-- record or document is ever deleted on rollback): the table, every line, its append-only guard, the private bucket and its
-- files all stay, unreachable by anon and authenticated; without the drug-test function nothing reads or writes them.
-- Safe to run twice.
begin;
drop trigger if exists drug_test_docs_keep on storage.objects;
drop function if exists public.drug_test_docs_keep();
commit;
