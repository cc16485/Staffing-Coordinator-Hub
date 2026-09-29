-- ============================================================================
-- PRN3 · COUNTING ON THE PRN TEAM (Desktop 357). Samantha approved 2026-09-29 ("yes to all"). Safe to run again.
-- Once a PRN CNA says yes and is confirmed, we need to be able to depend on them. This keeps, per person and per
-- shift, that they were confirmed, and if they backed out afterwards. Written only by the office's prn-team function,
-- never edited or deleted. Nothing here touches pay.
-- ============================================================================
create table if not exists public.prn_shift_log (
  id                    bigserial primary key,
  axiscare_caregiver_id text not null,
  applicant_id          uuid references public.job_applicants(id) on delete restrict,
  case_id               text not null,
  kind                  text not null check (kind in ('confirmed', 'backed_out')),
  shift_date            date,
  recorded_by           text not null,
  recorded_at           timestamptz not null default now(),
  unique (case_id, kind, axiscare_caregiver_id)
);
create index if not exists prn_shift_log_cg_idx on public.prn_shift_log (axiscare_caregiver_id, recorded_at);
alter table public.prn_shift_log enable row level security;
drop policy if exists prn_shift_log_read on public.prn_shift_log;
create policy prn_shift_log_read on public.prn_shift_log for select to authenticated using (true);
revoke all on public.prn_shift_log from anon, authenticated;
grant select on public.prn_shift_log to authenticated;
grant all on public.prn_shift_log to service_role;
grant usage, select on sequence public.prn_shift_log_id_seq to service_role;

create or replace function public.prn_shift_log_frozen()
returns trigger language plpgsql as $$
begin
  raise exception 'HISTORY_IS_KEPT' using errcode = 'P0001', hint = 'The PRN shift record is never edited or deleted.';
end $$;
drop trigger if exists prn_shift_log_frozen on public.prn_shift_log;
create trigger prn_shift_log_frozen before update or delete on public.prn_shift_log
  for each row execute function public.prn_shift_log_frozen();
