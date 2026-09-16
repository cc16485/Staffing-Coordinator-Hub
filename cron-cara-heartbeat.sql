-- cron-cara-heartbeat.sql  ·  Cara's coverage heartbeat — ACTIVATION STAGED
-- =============================================================================
-- ⚠ DO NOT RUN ANY BLOCK until activation is explicitly approved.
--    coverage_send_live is ALREADY TRUE in production: the moment these crons
--    exist, waves, exhaustion escalation and closure texts run for real.
--
-- Run blocks ONE AT A TIME in the Supabase SQL editor (shared hub project
-- zngsgedlsxinbygwmxwn), in order, with the heartbeat-enabled functions
-- (coverage-run, coverage-watch, automation-watchdog) deployed FIRST.
--
-- What one tick can do once live:
--   coverage-watch (*/5): reads AxisCare visits (72h), opens coverage cases
--     for call-off unassignments, closes covered-outside cases (which QUEUES
--     closure texts for coverage-run), runs the daily attendance sweep and
--     hourly flagged-notes sweep (ops items). Sends nothing itself.
--   coverage-run (*/3, ?commit=1): sends caregiver waves (5 per case per
--     tick, 10-min fuse, quiet 9pm-8am unless the shift starts within 3h),
--     escalates exhausted callouts (urgent ops item + owner SMS, once per
--     case), sends winner / courtesy / family closure texts (8am-9pm, each
--     guarded: confirm_sent, closed_notified state, closure_notified,
--     family_notified). Soft 4-minute run lock guards overlapping open-case
--     work; every send persists its own guard immediately.
-- =============================================================================


-- ============================================================
-- STEP 0 — BACKFILL THE PRE-HEARTBEAT CASES (required first).
-- The engine's closure pass has no age cutoff. Six resolved cases predate
-- the heartbeat; one of them still holds 10 auto-asked caregivers in
-- "waiting", who would receive a stale "that shift is covered" text on the
-- FIRST tick. Backfilling closure_notified / family_notified marks history
-- as history, so tick one starts from silence.
--
-- 0a. PREVIEW exactly what would be stamped (run this first, read it):
select c->>'id'            as case_id,
       c->>'status'        as status,
       c->>'resolved_how'  as resolved_how,
       c->>'resolved_at'   as resolved_at,
       c->>'closure_notified' as closure_notified,
       c->>'family_notified'  as family_notified,
       jsonb_array_length(coalesce(c->'asked','[]'::jsonb)) as asked_n
from app_data, jsonb_array_elements(data) c
where key = 'coverage_cases'
  and c->>'status' is distinct from 'open'
  and coalesce(c->>'closure_notified','') = '';

-- 0b. SET THE CUTOFF to the activation moment (UTC), then stamp. Only
--     resolved cases from BEFORE the cutoff are touched; anything resolved
--     after activation gets its real closure texts from the engine.
-- update app_data set data = (
--   select jsonb_agg(
--     case when c->>'status' is distinct from 'open'
--           and coalesce(c->>'closure_notified','') = ''
--           and coalesce(c->>'resolved_at','')      <> ''
--           and (c->>'resolved_at') < '2026-09-17T00:00:00Z'   -- << SET CUTOFF
--       then c || jsonb_build_object(
--         'closure_notified', 'backfilled pre-heartbeat ' || now(),
--         'family_notified',  coalesce(nullif(c->>'family_notified',''),
--                                      'backfilled pre-heartbeat ' || now()))
--       else c end)
--   from jsonb_array_elements(data) c)
-- where key = 'coverage_cases';


-- ============================================================
-- STEP 1 — EXPLICIT SETTINGS. Production outbound behaviour should not
-- depend on invisible code defaults once the heartbeat runs. These are the
-- same values the code already uses; setting them makes them inspectable.
-- ============================================================
-- update app_data set data = data
--   || jsonb_build_object('coverage_wave_fuse_min', 10)   -- minutes between waves
--   || jsonb_build_object('coverage_quiet_from', 21)      -- 9pm Chicago
--   || jsonb_build_object('coverage_quiet_until', 8)      -- 8am Chicago
-- where key = 'ops_settings';


-- ============================================================
-- STEP 2 — THE WATCHER: every 5 minutes. Detection promise: a call-off
-- unassignment in AxisCare becomes a case within ~5 minutes.
-- ============================================================
-- do $$ begin perform cron.unschedule('coverage-watch'); exception when others then null; end $$;
-- select cron.schedule('coverage-watch', '*/5 * * * *', $job$
--   select net.http_post(
--     url     := 'https://zngsgedlsxinbygwmxwn.supabase.co/functions/v1/coverage-watch',
--     headers := jsonb_build_object('Content-Type','application/json',
--       'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuZ3NnZWRsc3hpbmJ5Z3dteHduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDIzNDQsImV4cCI6MjA5ODExODM0NH0.L_31_UKdccyRH9n7p1GaBlZTqcJipB008H-GIvxwLxM'),
--     body    := '{}'::jsonb);
-- $job$);


-- ============================================================
-- STEP 3 — THE ENGINE: every 3 minutes, IN COMMIT MODE. Without ?commit=1
-- every tick is a dry run and nothing sends — the switch that bit us once.
-- Worst-case first wave after a case opens: ~3 minutes (plus quiet hours).
-- ============================================================
-- do $$ begin perform cron.unschedule('coverage-run'); exception when others then null; end $$;
-- select cron.schedule('coverage-run', '*/3 * * * *', $job$
--   select net.http_post(
--     url     := 'https://zngsgedlsxinbygwmxwn.supabase.co/functions/v1/coverage-run?commit=1',
--     headers := jsonb_build_object('Content-Type','application/json',
--       'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuZ3NnZWRsc3hpbmJ5Z3dteHduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDIzNDQsImV4cCI6MjA5ODExODM0NH0.L_31_UKdccyRH9n7p1GaBlZTqcJipB008H-GIvxwLxM'),
--     body    := '{}'::jsonb);
-- $job$);


-- ============================================================
-- STEP 4 — PROVE THE PULSE (a few minutes after steps 2-3):
-- ============================================================
-- select jobname, schedule, active from cron.job
--   where jobname in ('coverage-watch','coverage-run');
-- select item->>'automation' as automation, item->>'at' as last_beat,
--        item->>'ok' as ok, item->>'note' as note
-- from app_data, jsonb_array_elements(data) item
-- where key = 'automation_heartbeats'
--   and item->>'automation' in ('coverage-watch','coverage-run');
-- The watchdog (daily, morning) now alerts if either beat goes stale > 1h.
-- Known limitation: engine silence is noticed next MORNING, not intraday;
-- an intraday watchdog run can be added later if that gap matters.


-- ============================================================
-- EMERGENCY OFF (any time; either line alone stops sends)
-- ============================================================
-- update app_data set data = data || '{"coverage_send_live": false}'::jsonb where key = 'ops_settings';
-- select cron.unschedule('coverage-run');
-- select cron.unschedule('coverage-watch');
