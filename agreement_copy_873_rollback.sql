-- agreement_copy_873_rollback.sql · undoes agreement_copy_873.sql. Run ONLY after the previous client-agreement function is
-- deployed again (it would read copies). The copy files themselves stay in storage (that bucket keeps every file).
begin;
alter table public.client_agreements drop column if exists copies;
commit;
