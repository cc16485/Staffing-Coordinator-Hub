-- rollback: the three rows read as Viventium Step 2 items again (confirmed by the office from the checklist).
begin;
update public.client_journey_step_def set def = def || '{"title": "Viventium Step 2: Code of ethics acknowledged", "stage": "step2", "proof": "confirmed"}'::jsonb, updated_by = 'step1 viventium forms rollback' where key = 'cg.step2.code_of_ethics';
update public.client_journey_step_def set def = def || '{"title": "Viventium Step 2: Confidentiality and HIPAA acknowledged", "stage": "step2", "proof": "confirmed"}'::jsonb, updated_by = 'step1 viventium forms rollback' where key = 'cg.step2.confidentiality';
update public.client_journey_step_def set def = def || '{"title": "Viventium Step 2: Participant rights acknowledged (19 CSR 15-7.021(24)(B)5)", "stage": "step2", "proof": "confirmed"}'::jsonb, updated_by = 'step1 viventium forms rollback' where key = 'cg.step2.participant_rights';
commit;
