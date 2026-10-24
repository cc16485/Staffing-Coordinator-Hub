-- 1108 · REASONS BY ID + THE VISIT HISTORY (Samantha, 2026-10-24). coverage-watch keeps, for every visit it sees (the next
-- 72 hours and those deleted in that window), a row whenever its reason, caregiver, times or state change: nothing is
-- overwritten, so a corrected reason never erases what happened (her rule 7). visit_last holds the latest look per visit, so
-- only changes are written. Read and written only by the server (service role). No browser access.
create table if not exists public.visit_history (
  id bigserial primary key,
  visit_id text not null,
  client_axiscare_id text,
  reason_id text, reason_name text,
  caregiver_id text, caregiver_name text,
  state text,                -- caregiver | placeholder | empty | removed
  start text, "end" text,
  first_seen boolean not null default false,
  seen_at timestamptz not null default now()
);
create index if not exists visit_history_visit on public.visit_history (visit_id, seen_at);
create table if not exists public.visit_last (
  visit_id text primary key,
  sig text not null,
  seen_at timestamptz not null default now()
);
alter table public.visit_history enable row level security;
alter table public.visit_last enable row level security;
revoke all on public.visit_history from anon, authenticated;
revoke all on public.visit_last from anon, authenticated;
revoke all on sequence public.visit_history_id_seq from anon, authenticated;
grant all on public.visit_history to service_role;
grant all on public.visit_last to service_role;
grant usage, select on sequence public.visit_history_id_seq to service_role;
