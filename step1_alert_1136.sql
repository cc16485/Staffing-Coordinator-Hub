-- ============================================================================
-- 1136 · SHARED HUB PROJECT (zngsgedlsxinbygwmxwn) · STEP 1 ALERT (Samantha 2026-10-26)
-- "When Step 1 is complete, text and email every active admin right away so we start background checks and references."
-- One row per person who finished Step 1 (never a practice or training hire): what the admins need to know, and when
-- the email and the text were claimed, so each admin gets ONE of each, ever. The server alone reads and writes it.
-- Safe to run again.
-- ============================================================================
create table if not exists public.step1_alerts (
  offer_id         text primary key,
  name             text not null default '',
  phone            text not null default '',
  position         text not null default '',
  offered_by       text not null default '',
  refs             jsonb not null default '{}'::jsonb,
  done_at          timestamptz not null,
  created_at       timestamptz not null default now(),
  email_claimed_at timestamptz,
  email_result     jsonb,
  text_claimed_at  timestamptz,
  text_result      jsonb
);
create index if not exists step1_alerts_owed_idx on public.step1_alerts (done_at)
  where email_claimed_at is null or text_claimed_at is null;

alter table public.step1_alerts enable row level security;
revoke all on public.step1_alerts from anon, authenticated;
grant all on public.step1_alerts to service_role;

-- Her switch starts OFF. Only added when missing, so running this again never turns it off (or on).
update public.app_data set data = jsonb_build_object('step1_alert_live', false) || data
  where key = 'ops_settings' and jsonb_typeof(data) = 'object' and not (data ? 'step1_alert_live');
