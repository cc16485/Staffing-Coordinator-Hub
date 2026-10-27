-- ============================================================================
-- 1141 · SHARED HUB PROJECT (zngsgedlsxinbygwmxwn) · FRIENDS & FAMILY INVITE CHECK (Samantha 2026-10-27)
-- "Yes, use this definition for the invitation check, including the 30-day wait after serious issues. Continue building
-- step 3 with the switch off."
-- One row per day: who WOULD get a Friends & Family invitation that day (ready, waiting, held, and why), what couldn't be
-- read, and how many were sent (always 0 in this step). Kept 30 days. The server alone reads and writes it; the
-- Friends & Family tab (step 4) will show it to owners. Safe to run again.
-- ============================================================================
create table if not exists public.ff_invite_runs (
  run_day   date primary key,
  ran_at    timestamptz not null default now(),
  ok        boolean not null default false,
  problems  jsonb not null default '[]'::jsonb,
  live      boolean not null default false,
  summary   jsonb,
  people    jsonb not null default '[]'::jsonb,
  sent      integer not null default 0
);

alter table public.ff_invite_runs enable row level security;
revoke all on public.ff_invite_runs from anon, authenticated;
grant all on public.ff_invite_runs to service_role;

-- Her switch starts OFF. Only added when missing, so running this again never turns it off (or on).
update public.app_data set data = jsonb_build_object('ff_invites_live', false) || data
  where key = 'ops_settings' and jsonb_typeof(data) = 'object' and not (data ? 'ff_invites_live');
