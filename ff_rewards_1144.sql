-- ============================================================================
-- 1144 · SHARED HUB PROJECT (zngsgedlsxinbygwmxwn) · FRIENDS & FAMILY $100 TRACKING (Samantha 2026-10-27)
-- "Yes, start step 5: the $100 credit and bonus tracking, live as I decided."
-- One row per inquiry that came through a Friends & Family person's link and has had its first visit: the line (who referred,
-- the new client, hours from AxisCare, the owner's "payment received" tick, Ready / Under review with the reasons, the
-- decision, then Credit applied or Paid), with every change kept in its history. The server alone reads and writes it;
-- owners see it in the Hub's Friends & Family tab (ff-invite-check checks that they are an owner). Safe to run again.
-- ============================================================================
create table if not exists public.ff_rewards (
  lead_id     text primary key,
  status      text not null default 'on_the_way'
                check (status in ('on_the_way', 'ready', 'under_review', 'approved', 'not_earned', 'applied', 'paid')),
  line        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.ff_rewards enable row level security;
revoke all on public.ff_rewards from anon, authenticated;
grant all on public.ff_rewards to service_role;
