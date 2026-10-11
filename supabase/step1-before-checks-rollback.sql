-- STEP 1 BEFORE CHECKS rollback: the server door goes; every record it made stays.
drop function if exists public.step1_candidate_create(text, jsonb);
update public.client_journey_step_def set active = false, updated_at = now(), updated_by = 'case.net rollback' where key = 'cg.check.casenet';
update public.client_journey_step_def set def = jsonb_set(def, '{after}', (def->'after') - 'cg.check.casenet'), updated_at = now(), updated_by = 'case.net rollback' where key in ('cg.approve.advance', 'cg.approve.work');
