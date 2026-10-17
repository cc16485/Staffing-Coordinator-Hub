-- agreement_contacts_872_rollback.sql · undoes agreement_contacts_872.sql. Run ONLY after the previous late-watch,
-- late-alert and client-agreement functions are deployed again (they would read wants_late / contacts_review).
-- Family members added by a review stay in the Family Circle (they are real people the family signed for); only the
-- link back to the agreement is dropped. Running-late texts go back to following wants_changes.
begin;
drop index if exists public.circle_contacts_from_agreement;
alter table public.circle_contacts drop column if exists from_agreement_n;
alter table public.circle_contacts drop column if exists from_agreement;
alter table public.circle_contacts drop column if exists wants_late;
alter table public.client_agreements drop column if exists contacts_review;
commit;
