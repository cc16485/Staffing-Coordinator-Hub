-- ============================================================================
-- 708 ROLLBACK · LPN HIRING, THE HUB PROJECT. Deletes nothing (her rule: a rollback deletes nothing).
--   the four nurse readiness rows go inactive (no card shows them; recorded rows and their history stay);
--   the step1_forms.nurse_form column, its keep trigger, the sealed nursing license columns and the 'caregiver_class' change
--   log kind STAY (a Step 1 already made with the form keeps it; nothing sealed is thrown away; old log rows stay valid).
-- Run the functions' rollback (redeploy main's step1-sign, offer-sign, caregiver-journey, step2-handoff, hire-profile,
-- applicant-link) before or after this; either order is safe.
-- ============================================================================
update public.client_journey_step_def set active = false, updated_by = '708 rollback'
 where key in ('cg.credential.nurse_license', 'cg.nurse.orientation', 'cg.nurse.section2_ack', 'cg.step2.position_description') and active;
