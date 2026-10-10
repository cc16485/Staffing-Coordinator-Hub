-- SLICE 3b · Migration C (2026-10-10): the caregiver catalog rows go active now that caregiver-journey reads them.
-- Additive; no row deleted; safe to run twice. Undo: update ... set active = false where key like 'cg.%'.
update public.client_journey_step_def set active = true, updated_by = '3b activate 2026-10-10' where key like 'cg.%' and active = false;
