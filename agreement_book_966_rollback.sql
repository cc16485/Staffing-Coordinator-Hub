-- agreement_book_966_rollback.sql · undoes agreement_book_966.sql. Run ONLY after the previous client-agreement,
-- family-gateway and family-app-office functions are deployed again (they read or write app_book_choice). Whether each
-- person may book (app_can_book) is kept exactly as it is.
begin;
alter table public.circle_contacts drop column if exists app_book_choice;
commit;
