-- ============================================================================
-- 2026-10-13: Samantha moved the Employee Handbook acknowledgment, the Code of Ethics and the HIPAA acknowledgment from
-- Viventium into Step 1. Their readiness rows now say so and complete from the Step 1 signature (caregiver-journey derives
-- them). Participant rights stays a Viventium item until a Client Rights statement is handed out in Step 1. Old-path people
-- are unchanged (the office can still confirm these from the Viventium checklist). Safe to run twice.
-- Rollback: step1-viventium-forms-rollback.sql (the titles go back).
-- ============================================================================
begin;
update public.client_journey_step_def set def = def || '{"title": "Employee Handbook acknowledged (signed in Step 1)", "stage": "step1", "proof": "record", "evidence_required": "the Step 1 signature on the Employee Handbook Acknowledgment"}'::jsonb, updated_by = 'step1 viventium forms 2026-10-13' where key = 'cg.step2.handbook';
update public.client_journey_step_def set def = def || '{"title": "Code of Ethics acknowledged (signed in Step 1)", "stage": "step1", "proof": "record", "evidence_required": "the Step 1 signature on the Code of Ethics"}'::jsonb, updated_by = 'step1 viventium forms 2026-10-13' where key = 'cg.step2.code_of_ethics';
update public.client_journey_step_def set def = def || '{"title": "HIPAA and confidentiality acknowledged (signed in Step 1)", "stage": "step1", "proof": "record", "evidence_required": "the Step 1 signature on HIPAA & the Privacy Rule"}'::jsonb, updated_by = 'step1 viventium forms 2026-10-13' where key = 'cg.step2.confidentiality';
commit;
