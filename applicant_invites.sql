-- ============================================================================
-- SEND THE APPLICATION (Desktop 364). Samantha approved 2026-09-29 ("yes to all"). SHARED HUB PROJECT. Safe to run again.
--
-- Somebody calls asking about a job; staff type their name, phone, email and the position, and the applicant-invite
-- function sends them that position's application link. This is the log of those sends. It is deliberately NOT a
-- job_applicants row: their real application would then land as a duplicate and be hidden from the New list.
-- The Hub matches an invite to the application that follows by phone or email.
-- Written only by the server (applicant-invite). Staff read it for "Sent the link, hasn't applied".
-- ============================================================================
create table if not exists public.applicant_invites (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  first_name    text not null,
  last_name     text,
  phone         text,                    -- 10 digits
  email         text,
  position      text not null,           -- job_positions.key
  position_label text,
  link          text not null,
  sms_asked     boolean not null default false,  -- staff ticked "They asked us to text it"
  texted        boolean not null default false,
  emailed       boolean not null default false,
  not_sent      text[] not null default '{}',     -- why a channel did not go (no consent, opted out, number not trusted)
  sent_by       text,                    -- staff email
  sent_by_name  text,
  closed_at     timestamptz,             -- "Called them, done" from the Hub
  closed_by     text
);
create index if not exists applicant_invites_created_idx on public.applicant_invites (created_at desc);
alter table public.applicant_invites enable row level security;
drop policy if exists applicant_invites_read on public.applicant_invites;
create policy applicant_invites_read on public.applicant_invites for select to authenticated using (true);
revoke all on public.applicant_invites from anon, authenticated;
grant select on public.applicant_invites to authenticated;
grant all on public.applicant_invites to service_role;
grant usage, select on sequence public.applicant_invites_id_seq to service_role;
