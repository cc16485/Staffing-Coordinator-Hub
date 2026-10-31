-- =============================================================================
-- PRN CNA ON CALL, EVERY WEEK (Samantha 2026-10-30: "Yes to all 7 recommendations. Build recurring on-call sign-up."
-- Rules W1 to W7 in supabase/functions/_shared/prn-oncall.ts)
--   prn_oncall_series  an open on-call shift taken every week: one weekday, one shift (day or overnight), from its first date.
--                      asked (waiting for the office) -> confirmed (the office's one OK) -> ended (they called to stop it, the
--                      office said not this one, they took the ask back, or a miss). Kept; ended ones stay as history.
--   prn_oncall.series_id  each week of it is still its own prn_oncall row (asked, or confirmed by the daily fill), so the
--                      calendar, payroll and "the office calls the on-call CNA first" read it like any other shift.
-- Written only by the prn-week and prn-page functions (service role). Office staff can read. Adds only; safe to run again.
-- =============================================================================
set local lock_timeout = '5s';

create table if not exists public.prn_oncall_series (
  id            bigserial primary key,
  applicant_id  uuid not null references public.job_applicants(id) on delete restrict,
  slot          text not null check (slot in ('day', 'overnight')),
  weekday       smallint not null check (weekday between 0 and 6),
  first_date    date not null,
  status        text not null check (status in ('asked', 'confirmed', 'ended')),
  note          text check (note is null or length(note) <= 300),
  by_email      text not null,
  by_name       text,
  at            timestamptz not null default now(),
  confirmed_at  timestamptz,
  confirmed_by  text,
  ended_at      timestamptz,
  ended_by      text,
  end_why       text check (end_why is null or length(end_why) <= 300),
  constraint prn_oncall_series_weekday check (weekday = extract(dow from first_date)::int),
  constraint prn_oncall_series_ended check ((status = 'ended') = (ended_at is not null)),
  constraint prn_oncall_series_confirmed check (status <> 'confirmed' or confirmed_at is not null)
);
/* one live every-week shift per person, weekday and shift */
create unique index if not exists prn_oncall_series_one_live on public.prn_oncall_series (applicant_id, weekday, slot) where status in ('asked', 'confirmed');
create index if not exists prn_oncall_series_live_idx on public.prn_oncall_series (status) where status in ('asked', 'confirmed');

alter table public.prn_oncall add column if not exists series_id bigint references public.prn_oncall_series(id) on delete restrict;
create index if not exists prn_oncall_series_rows_idx on public.prn_oncall (series_id) where series_id is not null;
comment on column public.prn_oncall.series_id is 'Set when this week is part of an every-week on-call shift (prn_oncall_series).';

alter table public.prn_oncall_series enable row level security;
drop policy if exists prn_oncall_series_read on public.prn_oncall_series;
create policy prn_oncall_series_read on public.prn_oncall_series for select to authenticated using (true);
revoke all on public.prn_oncall_series from anon, authenticated;
grant select on public.prn_oncall_series to authenticated;
grant all on public.prn_oncall_series to service_role;
grant usage, select on sequence public.prn_oncall_series_id_seq to service_role;
