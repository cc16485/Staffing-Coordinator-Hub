-- agreement_links_874_rollback.sql · undoes agreement_links_874.sql. Run ONLY after the agreement-sign function is deleted
-- and the previous client-agreement is deployed again. Agreements signed from home keep their signature record (it is on
-- the agreement row and its PDF); only the link rows go.
begin;
drop table if exists public.client_agreement_links;
commit;
