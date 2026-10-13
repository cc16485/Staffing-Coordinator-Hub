-- ============================================================================
-- 2026-10-13: Samantha moved the Code of Ethics and the HIPAA acknowledgment from Viventium into Step 1 (the Employee
-- Handbook stays in Viventium, her call). Their readiness rows now say so and complete from the Step 1 signature (caregiver-journey derives
-- them). Client Rights (participant rights) is signed in Step 1 too (receipt and review only); the office explains it with
-- the Code of Ethics and the HIPAA policy at the Orientation Video Call, and that row needs both. Old-path people
-- are unchanged (the office can still confirm these from the Viventium checklist). Safe to run twice.
-- Rollback: step1-viventium-forms-rollback.sql (the titles go back).
-- ============================================================================
begin;
update public.client_journey_step_def set def = def || '{"title": "Code of Ethics acknowledged (signed in Step 1)", "stage": "step1", "proof": "record", "evidence_required": "the Step 1 signature on the Code of Ethics"}'::jsonb, updated_by = 'step1 viventium forms 2026-10-13' where key = 'cg.step2.code_of_ethics';
update public.client_journey_step_def set def = def || '{"title": "HIPAA and confidentiality acknowledged (signed in Step 1)", "stage": "step1", "proof": "record", "evidence_required": "the Step 1 signature on HIPAA & the Privacy Rule"}'::jsonb, updated_by = 'step1 viventium forms 2026-10-13' where key = 'cg.step2.confidentiality';
/* 2026-10-13 (her ruling): the Client Rights signature confirms receipt and review only; the office explains all three at the
   Orientation Video Call and records it there (welcome-rights-explained.sql). The row completes only when BOTH exist. */
update public.client_journey_step_def set def = def || '{"title": "Client Rights, Code of Ethics and confidentiality: received and reviewed (signed in Step 1) and explained at the Orientation Video Call (19 CSR 15-7.021(24)(B)5)", "stage": "orientation", "proof": "record", "evidence_required": "the Step 1 signature on Client Rights AND the office record at the Orientation Video Call: explained (date, who) and the employee confirmed they understood"}'::jsonb, updated_by = 'step1 viventium forms 2026-10-13' where key = 'cg.step2.participant_rights';
commit;
