-- =============================================================================
-- 624 · THE CHANGE HISTORY KEEPS EVERY TRAINING FIELD (Samantha 2026-10-12: training proof for the MMAC audit)
-- =============================================================================
-- evidence_field_kept decides which caregiver fields the value history (Slice 9) keeps. It kept orient*, alz*, ojt_online*
-- and annual*, but not the in-person on-the-job training (ojt_date, ojt_signed, ojt_proof) nor the ethics and rights
-- acknowledgments. This widens "ojt_online" to "ojt" and adds "ethics" and "rights", patching the LIVE rule in place (so
-- anything another install added to it stays), and refuses if the live rule is not the expected one.
-- Rollback: the reverse replace (evidence-training-fields-rollback.sql). Nothing is deleted.
do $p$ declare src text; begin
  src := pg_get_functiondef('public.evidence_field_kept(text,text)'::regprocedure);
  if position('|ojt|ethics|rights|annual|' in src) > 0 then raise notice 'already widened: nothing to do'; return; end if;
  if position('|ojt_online|annual|' in src) = 0 then raise exception 'the live evidence_field_kept is not the expected one; nothing was changed'; end if;
  execute replace(src, '|ojt_online|annual|', '|ojt|ethics|rights|annual|');
  if not public.evidence_field_kept('caregivers', 'ojt_date') or not public.evidence_field_kept('caregivers', 'ojt_proof') or public.evidence_field_kept('caregivers', 'ssn') then
    raise exception 'self-check failed; nothing was changed'; end if;
end $p$;
