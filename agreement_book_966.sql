-- agreement_book_966.sql · Client Care Agreement: the Booking App terms and "Can book in the app" (Samantha 2026-10-18:
-- the Booking App needs its own terms because of the $15 fee for a month with no visits, signed at the care assessment;
-- "Update Section 9 ... add the Can book in the app box to Exhibit I, and update the tablet").
--   circle_contacts.app_book_choice: the latest choice about whether this person may book in the Booking App, made on a
--   signed agreement ("Can book in the app" Yes / No on Exhibit I, set when the office approves the contacts) or with the
--   office's booking switch. A person's FIRST sign-in follows it; with no choice (null) the usual rule applies (the client
--   and AxisCare responsible parties may book, others may not). Everyone starts with no choice, so nobody changes today.
-- Only the server functions write it. Nothing else changes. A second run changes nothing.
begin;
alter table public.circle_contacts add column if not exists app_book_choice boolean;
commit;
