-- =============================================================================
-- 611 · Step 1 experience and references (Samantha 2026-10-11, approving the Step 1 previews with refinements)
-- =============================================================================
-- Additive only. Nothing is removed, nothing is backfilled here (the practice mark is set by the install step from the
-- Training Platform's offers, and by step1-sign itself from then on).
--   step1_forms.practice              the reference page asks task questions only for these (practice and training hires)
--   reference_requests.task_list      the tasks this reference was asked about
--   reference_requests.task_confirm   their answer per task: saw | believe | no | unknown
--   reference_requests.comfort_why    the optional why under "comfortable with similar care for someone you care about"
--   reference_requests.tasks_answered_at
-- Only the service role writes them (reference-tasks); anon keeps no table access (refs_r1r5.sql revoked it).
alter table public.step1_forms add column if not exists practice boolean not null default false;
alter table public.reference_requests
  add column if not exists task_list jsonb,
  add column if not exists task_confirm jsonb,
  add column if not exists comfort_why text,
  add column if not exists tasks_answered_at timestamptz;
