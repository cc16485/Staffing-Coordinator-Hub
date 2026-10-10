-- applicant_texts_574.sql (Desktop 574, 2026-10-10). Samantha: "yes to all, build it" on texting applicants from the
-- Hub (Applicants tab, Interviews tab, the applicant's page), and the office's own cancel-interview message.
--   applicant_texts: every text the office sends an applicant from the Hub (the exact words, who pressed Send, when it
--   went, or when it is waiting for 8am), so the applicant's card can say "texted 2h ago by Krystal" and the journey
--   check and audit can see it. Only the applicant-text function writes it (the server key). Office staff (signed in)
--   can read it.
-- Run as one transaction. Adds only; changes no existing row.

create table if not exists public.applicant_texts (
  id            bigserial primary key,
  applicant_id  uuid not null,
  kind          text not null check (kind in ('text', 'reply', 'cancel')),
  status        text not null check (status in ('sent', 'held', 'failed', 'cancelled')),
  phone         text,
  email         text,
  message       text not null,
  email_subject text,
  send_after    timestamptz,
  created_at    timestamptz not null default now(),
  created_by    text,
  sent_at       timestamptz,
  texted        boolean,
  emailed       boolean,
  error         text
);
create index if not exists applicant_texts_applicant on public.applicant_texts (applicant_id, created_at desc);
create index if not exists applicant_texts_held on public.applicant_texts (send_after) where status = 'held';

alter table public.applicant_texts enable row level security;
revoke all on public.applicant_texts from public, anon, authenticated;
revoke all on sequence public.applicant_texts_id_seq from public, anon, authenticated;
grant select on public.applicant_texts to authenticated;
grant all on public.applicant_texts to service_role;
grant usage, select on sequence public.applicant_texts_id_seq to service_role;
drop policy if exists applicant_texts_read on public.applicant_texts;
create policy applicant_texts_read on public.applicant_texts for select to authenticated using (true);
