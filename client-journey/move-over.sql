-- =====================================================================================================================
-- The client journey move-over (483/484, Samantha 2026-10-06). Safe to run more than once. Nothing is removed.
--   assigned_how  how the Care Coordinator was picked (chosen / lead coordinator / routing / default / opened by), so a
--                 journey routed before anyone knew the payer can move to the right person once the payer is answered
--   launch_id     the First shift launch (client_queue) this journey opened or picked up at the Team stage, so the
--                 rest of the Hub (launch evidence, when care began, one open episode per client) keeps working and
--                 the Hub shows the journey in its place
-- =====================================================================================================================
alter table public.client_journey add column if not exists assigned_how text;
alter table public.client_journey add column if not exists launch_id text;
