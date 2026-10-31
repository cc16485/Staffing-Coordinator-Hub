-- =============================================================================
-- FIELD SUPPORT VISITS · THE TEXT (Samantha 2026-10-31: a Field Support request "will show up on the PRNs little hub and will
-- text them just like an open shift")
-- prn_mentor_texts: each text a request sent to a PRN CNA (one per person per visit, so nobody is texted twice for the same
-- visit), with the words that went out (the page link kept out). Kept: no updates or deletes. Office staff read; only the
-- server writes. Adds only; safe to run again.
-- =============================================================================
set local lock_timeout = '5s';
create table if not exists public.prn_mentor_texts (
  id            bigserial primary key,
  visit_id      bigint not null references public.prn_mentor_visits(id) on delete restrict,
  applicant_id  uuid not null references public.job_applicants(id) on delete restrict,
  message       text check (message is null or length(message) <= 800),
  by_email      text,
  by_name       text,
  at            timestamptz not null default now(),
  unique (visit_id, applicant_id)
);
comment on table public.prn_mentor_texts is 'Field Support Visits: each request text to a PRN CNA (once per person per visit).';
alter table public.prn_mentor_texts enable row level security;
drop policy if exists prn_mentor_texts_read on public.prn_mentor_texts;
create policy prn_mentor_texts_read on public.prn_mentor_texts for select to authenticated using (true);
revoke all on public.prn_mentor_texts from anon, authenticated;
grant select on public.prn_mentor_texts to authenticated;
grant all on public.prn_mentor_texts to service_role;
grant usage, select on sequence public.prn_mentor_texts_id_seq to service_role;
create or replace function public.prn_mentor_texts_kept() returns trigger language plpgsql set search_path = pg_catalog, public as $f$
begin raise exception 'Field Support Visit texts are kept as sent.'; end $f$;
drop trigger if exists prn_mentor_texts_kept on public.prn_mentor_texts;
create trigger prn_mentor_texts_kept before update or delete on public.prn_mentor_texts for each row execute function public.prn_mentor_texts_kept();
