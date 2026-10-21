-- Rollback for onboarding-1031.sql: the fingerprint row back on, dementia required again and back in front of Approve to Work.
-- The oig_auto_search key stays open (it only holds search results; removing the mapping would not delete them).
update public.client_journey_step_def set active = true, def = jsonb_set(def, '{active}', 'true'::jsonb), updated_at = now(), updated_by = 'onboarding 1031 rollback'
 where key = 'cg.check.fingerprints';
update public.client_journey_step_def set def = jsonb_set(def, '{required}', 'true'::jsonb), updated_at = now(), updated_by = 'onboarding 1031 rollback'
 where key = 'cg.training.dementia';
update public.client_journey_step_def set def = jsonb_set(def, '{after}', (def->'after') || '["cg.training.dementia"]'::jsonb), updated_at = now(), updated_by = 'onboarding 1031 rollback'
 where key = 'cg.approve.work' and not (def->'after') @> '["cg.training.dementia"]'::jsonb;
