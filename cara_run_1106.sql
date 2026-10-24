-- 1106 · CARA PHASE 2 PART A, "LET CARA RUN IT" (Samantha, 2026-10-24). One row per coverage case that a coordinator handed
-- to Cara: who started it and when, which wave she's on, when the next is due, whether she's paused on a yes, who the office
-- said "Not this one" to, and what still needs the office. version goes up on every write; every write names the version it
-- read, so two writers can't both win. lease_until: the every-3-minutes run holds a case for 90 seconds while it acts.
-- cara_run_event: the history the office sees (started, each wave and who it went to, each pause, every office decision).
-- Read and written only by the coverage-run function (service role). No browser access.
create table if not exists public.cara_run (
  case_id text primary key,
  run_no integer not null default 1,
  status text not null check (status in ('running', 'paused', 'needs_office', 'stopped', 'done')),
  practice boolean not null default true,
  started_by text not null,
  started_email text,
  started_at timestamptz not null default now(),
  wave integer not null default 0,
  wave_base integer not null default 0,
  next_wave_at timestamptz,
  held_until timestamptz,
  paused_ask_id text, paused_name text, paused_at timestamptz, confirm_by timestamptz,
  seen_yes jsonb not null default '[]'::jsonb,
  declined jsonb not null default '[]'::jsonb,
  needs text,
  lease_id text, lease_until timestamptz,
  ended_by text, ended_at timestamptz, end_why text,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists public.cara_run_event (
  id bigserial primary key,
  case_id text not null,
  run_no integer not null default 1,
  at timestamptz not null default now(),
  kind text not null,
  actor text,
  summary text not null,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists cara_run_event_case on public.cara_run_event (case_id, at);
create index if not exists cara_run_status on public.cara_run (status);
alter table public.cara_run enable row level security;
alter table public.cara_run_event enable row level security;
revoke all on public.cara_run from anon, authenticated;
revoke all on public.cara_run_event from anon, authenticated;
revoke all on sequence public.cara_run_event_id_seq from anon, authenticated;
grant all on public.cara_run to service_role;
grant all on public.cara_run_event to service_role;
grant usage, select on sequence public.cara_run_event_id_seq to service_role;
