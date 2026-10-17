-- client_agreement_871_rollback.sql · undo client_agreement_871.sql. Only safe before any real agreement is signed: it
-- drops the table and the file guard. The bucket and any files in it are LEFT in place on purpose (signed records).
begin;
drop trigger if exists client_agreements_keep_files on storage.objects;
drop function if exists public.client_agreements_keep_files();
drop table if exists public.client_agreements;
commit;
