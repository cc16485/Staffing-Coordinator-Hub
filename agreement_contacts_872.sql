-- agreement_contacts_872.sql · Client Care Agreement, Stage 2: the office reviews the signed Contacts & Permissions
-- (Exhibit I) and approves them into the Hub Family Circle and AxisCare responsible parties 1-3 (Samantha 2026-10-16:
-- "yes start stage 2"; "Separately" for the two kinds of family texts; "Checklist" for what AxisCare's API cannot set).
--   1. circle_contacts.wants_late: running-late texts get their own switch (until now they followed wants_changes).
--      Added ONCE with everyone's current choice carried over, so nobody's texts change today: a person who turned off
--      caregiver-change texts keeps not getting running-late texts either. A second run never resets anyone.
--   2. circle_contacts.from_agreement / from_agreement_n: which signed agreement (and which contact on it) a member came
--      from, so a second review of the same agreement updates that person instead of adding them twice.
--   3. client_agreements.contacts_review: what the office approved, what went to the Hub and AxisCare, and the
--      AxisCare checklist (emails and sign-ins AxisCare's API cannot set), each tick with who and when.
-- Only the client-agreement function (service role) writes contacts_review. Nothing else changes.
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'circle_contacts' and column_name = 'wants_late') then
    alter table public.circle_contacts add column wants_late boolean not null default true;
    update public.circle_contacts set wants_late = false where wants_changes is false;
  end if;
end $$;

alter table public.circle_contacts add column if not exists from_agreement uuid references public.client_agreements(id);
alter table public.circle_contacts add column if not exists from_agreement_n smallint check (from_agreement_n is null or from_agreement_n between 1 and 4);
create unique index if not exists circle_contacts_from_agreement on public.circle_contacts (from_agreement, from_agreement_n) where from_agreement is not null;

alter table public.client_agreements add column if not exists contacts_review jsonb
  check (contacts_review is null or jsonb_typeof(contacts_review) = 'object');

commit;
