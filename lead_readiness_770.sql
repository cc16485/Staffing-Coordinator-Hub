-- 770 · how serious each open family sounds, for the ranked Leads list (Samantha 2026-10-15, approved mockup Part 1:
--   https://claude.ai/artifact/MhFEgbLXTzmPCbegzHVv49). Safe to run again.
-- lead_readiness: one reading per lead (ready / deciding / looking, why, hours a week if they said a number), made by the
-- lead-readiness job whenever the family's story changes. Office staff read it; only the server writes it. No lead changes.
create table if not exists public.lead_readiness (
  lead_id text primary key,
  level text check (level in ('ready', 'deciding', 'looking')),
  why text,
  hours_heard numeric check (hours_heard is null or (hours_heard > 0 and hours_heard <= 168)),
  source text check (source is null or source in ('call', 'form')),
  based_on text,
  pending_fp text,
  model text,
  read_at timestamptz,
  error text,
  tries int not null default 0
);
alter table public.lead_readiness enable row level security;
revoke all on public.lead_readiness from public, anon, authenticated;
grant select on public.lead_readiness to authenticated;
grant all on public.lead_readiness to service_role;
drop policy if exists lead_readiness_read on public.lead_readiness;
create policy lead_readiness_read on public.lead_readiness for select to authenticated using (public.can_access_data_key('leads'));
