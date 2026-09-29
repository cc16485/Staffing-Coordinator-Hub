-- ============================================================================
-- PRN4 · KEEPING THE BENCH AT 20+ (Desktop 358). Samantha approved 2026-09-29 ("yes to all"). Safe to run again.
-- prn_checkins: each 60-day availability check-in text sent to a PRN CNA, and when they answered (Still right or
-- Update). Written only by the server (prn-reconfirm sends; caregiver-availability marks it answered). Staff read it
-- for the dashboard's "call them". The weekday schedule is created by the installer (it needs the jobs' secret).
-- ============================================================================
create table if not exists public.prn_checkins (
  id                    bigserial primary key,
  axiscare_caregiver_id text not null,
  applicant_id          uuid references public.job_applicants(id) on delete restrict,
  sent_at               timestamptz not null default now(),
  answered_at           timestamptz,
  how                   text check (how is null or how in ('still_right', 'updated'))
);
create index if not exists prn_checkins_cg_idx on public.prn_checkins (axiscare_caregiver_id, sent_at);
alter table public.prn_checkins enable row level security;
drop policy if exists prn_checkins_read on public.prn_checkins;
create policy prn_checkins_read on public.prn_checkins for select to authenticated using (true);
revoke all on public.prn_checkins from anon, authenticated;
grant select on public.prn_checkins to authenticated;
grant all on public.prn_checkins to service_role;
grant usage, select on sequence public.prn_checkins_id_seq to service_role;
