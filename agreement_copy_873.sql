-- agreement_copy_873.sql · the family's copy of the signed Client Care Agreement (Samantha 2026-10-16: "the client, or primary
-- contact gets emailed a copy right after they sign"; a big "COPY" on the paper copy we print and hand them; "Signed
-- electronically on ___" on the PDF). One column on the agreement: where the printed family copy is stored, and every
-- emailed copy (to, when, by whom, how it went, and the exact file that was sent). Only the client-agreement function
-- (service role) writes it. Nothing else changes.
begin;
alter table public.client_agreements add column if not exists copies jsonb not null default '{}'::jsonb
  check (jsonb_typeof(copies) = 'object');
commit;
