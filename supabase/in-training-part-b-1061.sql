-- =============================================================================
-- IN TRAINING PLAN v2, PART B (Samantha approved 2026-10-22). Hub project. No new table, no new column:
--   1. one caregiver catalog row, active: the check-in call from the Staffing Coordinator after they go Active in AxisCare
--      (optional: it is opened by the Hub only when checkin_call_live is on, so it never blocks Approve to Work)
--   2. the "Caregiver record in AxisCare" row's how-to says the new order: added as In Training right after Step 2 is checked,
--      then Send orientation information
-- Rollback: in-training-part-b-1061-rollback.sql (the row goes inactive, the old how-to comes back; nothing deleted).
-- =============================================================================
do $guard$ begin
  if to_regclass('public.client_journey_step_def') is null then raise exception '1061 refused: the journey catalog is missing. Nothing was changed.'; end if;
  if not exists (select 1 from public.client_journey_step_def where key = 'cg.axiscare.in_training' and active) then raise exception '1061 refused: the AxisCare row is missing. Nothing was changed.'; end if;
end $guard$;

insert into public.client_journey_step_def (key, catalog_version, def, active, updated_by) values ('cg.checkin.call', 1, '{"subject": "caregiver", "title": "Check-in call from the Staffing Coordinator (after they are Active)", "stage": "ready", "sort": 105, "owner_role": "staffing_coordinator", "proof": "confirmed", "permission": "office", "evidence_required": "confirmed_by:the office person who made the call (everything on file, questions answered, AxisCare app downloaded, test clock-in done or declined)", "required": false, "active": true, "payers": [], "after": ["cg.axiscare.active"], "howto": ["When they finish orientation and AxisCare reads back Active, the Hub opens this call and texts them the AxisCare app guide.", "Call them: make sure everything is on file and complete, answer any questions about orientation or the job, make sure the AxisCare app is downloaded and they can sign in, and ask if they would like a quick test clock-in.", "Tick each one on their readiness card, then press Done. No answer? Press No answer and try again the next business day. Shift texts wait until this call is done."]}'::jsonb, true, '1061 2026-10-22') on conflict (key) do update set def = excluded.def, active = true, updated_by = excluded.updated_by;

update public.client_journey_step_def
   set def = jsonb_set(def, '{howto}', '["Right after Step 2 is checked, the Staffing Coordinator adds them in AxisCare by hand as In Training (the API cannot convert an applicant), with their address, zip code and birth date from the card (the AxisCare app sign-up needs those to match).", "Then press Send orientation information: the Hub finds them In Training in AxisCare, checks the zip code and birth date, and sends ONE message with their orientation link, profile link and welcome call booking.", "The hourly connect job links the AxisCare caregiver to the roster record; this row verifies from that link."]'::jsonb),
       updated_by = '1061 2026-10-22'
 where key = 'cg.axiscare.in_training';

do $v$ declare n int; begin
  select count(*) into n from public.client_journey_step_def where key = 'cg.checkin.call' and active and (def->>'required')::boolean = false and def->'after' = '["cg.axiscare.active"]'::jsonb;
  if n <> 1 then raise exception '1061 self-check: the check-in row is not as expected'; end if;
  if (select def->'howto'->>1 from public.client_journey_step_def where key = 'cg.axiscare.in_training') not like 'Then press Send orientation information%' then raise exception '1061 self-check: the AxisCare how-to did not change'; end if;
  if has_table_privilege('authenticated', 'public.client_journey_step_def', 'insert') then raise exception '1061 self-check: the catalog must stay server-written'; end if;
end $v$;
