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

-- 0b. THE CUTOFF IS FIXED, NOT A PLACEHOLDER: 2026-09-16T12:00:00Z (the
--     heartbeat-infrastructure review date). It is deliberately EARLIER
--     than any possible activation: every case it can touch is already
--     known (the six from the 0a preview), and a case resolved after this
--     instant is NEVER swept in by running this late — the safe failure is
--     an extra recent case getting real closure texts, never a swallowed
--     one. If activation slips far enough that new pre-activation resolved
--     cases accumulate, re-run 0a and re-review; do not widen this literal
--     casually.
--
--     SEMANTICS: closure_notified / family_notified are STAGE-COMPLETION
--     records (the engine now stamps them with courtesy/family COUNTS, and
--     count 0 + no_recipients when nobody was eligible). This backfill
--     completes the stage for pre-heartbeat history with explicit
--     backfilled_* provenance and count 0 — it records that no messages
--     will be sent, never that messages were sent.
-- update app_data set data = (
--   select jsonb_agg(
--     case when c->>'status' is distinct from 'open'
--           and coalesce(c->>'closure_notified','') = ''
--           and coalesce(c->>'resolved_at','')      <> ''
--           and (c->>'resolved_at') < '2026-09-16T12:00:00Z'   -- FIXED CUTOFF, see note above
--       then c || jsonb_build_object(
--         'closure_notified', now(),
--         'closure_courtesy_count', 0,
--         'closure_no_recipients', true,
--         'closure_backfilled', 'pre-heartbeat history, no stale texts (' || now() || ')',
--         'family_notified',  coalesce(nullif(c->>'family_notified',''), now()::text),
--         'family_notified_count', coalesce((c->>'family_notified_count')::int, 0),
--         'family_no_recipients', (coalesce(c->>'family_notified','') = ''),
--         'family_backfilled', case when coalesce(c->>'family_notified','') = ''
--                                   then 'pre-heartbeat history (' || now() || ')' else null end)
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
-- ⚠ LEGACY DEAD JOB (discovered at the 2026-09-16 activation gate): a
--   'coverage-watch-5min' job already exists from the 09-12 build session,
--   firing every 5 minutes and receiving 401 INVALID_JWT_FORMAT on every
--   call (its stored Bearer token is a display-masked credential: 8 real
--   characters then literal bullet characters). It has never
--   successfully invoked anything. It MUST be unscheduled here, or this
--   file would leave a zombie beside the real job.
-- do $$ begin perform cron.unschedule('coverage-watch-5min'); exception when others then null; end $$;
-- do $$ begin perform cron.unschedule('coverage-watch'); exception when others then null; end $$;
-- select cron.schedule('coverage-watch', '*/5 * * * *', $job$
--   select net.http_post(
--     url     := 'https://zngsgedlsxinbygwmxwn.supabase.co/functions/v1/coverage-watch',
--     headers := jsonb_build_object('Content-Type','application/json',
--       'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuZ3NnZWRsc3hpbmJ5Z3dteHduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDIzNDQsImV4cCI6MjA5ODExODM0NH0.L_31_UKdccyRH9n7p1GaBlZTqcJipB008H-GIvxwLxM'),
--     body    := '{}'::jsonb);
-- $job$);


-- ============================================================
-- STEP 3 — THE ENGINE: every 3 minutes, IN COMMIT MODE.
-- ⚠ DO NOT REMOVE `?commit=1` FROM THE URL BELOW. Without it coverage-run
--   is DRY-RUN ONLY: the cron looks perfectly healthy, the heartbeat beats,
--   and no wave, escalation or closure text ever sends.
-- Worst-case first wave after a case opens: ~3 minutes (plus quiet hours).
-- ============================================================
-- ⚠ LEGACY DEAD JOB (same 401 family as the watcher's): 'coverage-run-5min'
--   exists, fires every 5 minutes, has never authenticated, and carries no
--   ?commit=1 anyway. Unschedule it here for the same zombie reason.
-- do $$ begin perform cron.unschedule('coverage-run-5min'); exception when others then null; end $$;
-- do $$ begin perform cron.unschedule('coverage-run'); exception when others then null; end $$;
-- select cron.schedule('coverage-run', '*/3 * * * *', $job$
--   select net.http_post(
--     url     := 'https://zngsgedlsxinbygwmxwn.supabase.co/functions/v1/coverage-run?commit=1',
--     headers := jsonb_build_object('Content-Type','application/json',
--       'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuZ3NnZWRsc3hpbmJ5Z3dteHduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDIzNDQsImV4cCI6MjA5ODExODM0NH0.L_31_UKdccyRH9n7p1GaBlZTqcJipB008H-GIvxwLxM'),
--     body    := '{}'::jsonb);
-- $job$);


-- ============================================================
-- STEP 4 — THE WATCHDOG GOES HOURLY. A daily check was fine for daily
-- jobs; an every-few-minutes coverage engine must not be able to die
-- quietly for a whole day. Replaces the daily job. The function itself
-- suppresses repeat alerts (same problem signature at most every 6h),
-- so a persisting outage does not text the office hourly.
-- ============================================================
-- do $$ begin perform cron.unschedule('daily-automation-watchdog'); exception when others then null; end $$;
-- do $$ begin perform cron.unschedule('hourly-automation-watchdog'); exception when others then null; end $$;
-- select cron.schedule('hourly-automation-watchdog', '10 * * * *', $job$
--   select net.http_post(
--     url     := 'https://zngsgedlsxinbygwmxwn.supabase.co/functions/v1/automation-watchdog',
--     headers := jsonb_build_object('Content-Type','application/json',
--       'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuZ3NnZWRsc3hpbmJ5Z3dteHduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDIzNDQsImV4cCI6MjA5ODExODM0NH0.L_31_UKdccyRH9n7p1GaBlZTqcJipB008H-GIvxwLxM'),
--     body    := '{}'::jsonb);
-- $job$);


-- ============================================================
-- REQUIRED BEFORE UNATTENDED coverage-watch OPERATION (recorded, unbuilt):
-- the id-less duplicate-case guard. An open case opened by phone/board
-- without an AxisCare visit id does not block the watcher's visit-id
-- dedupe, so the same shift can grow two competing cases and two competing
-- callouts. Proposed secondary identity: client_axiscare_id + shift_date —
-- but FIRST answer whether two legitimate same-client shifts can share a
-- calendar date (morning + evening visits); if so the key must also carry
-- the scheduled start time. Attended activation may proceed without it;
-- unattended operation may not.
-- ============================================================


-- ============================================================
-- STEP 5 — PROVE THE PULSE (a few minutes after steps 2-4):
-- ============================================================
-- select jobname, schedule, active from cron.job
--   where jobname in ('coverage-watch','coverage-run','hourly-automation-watchdog');
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
