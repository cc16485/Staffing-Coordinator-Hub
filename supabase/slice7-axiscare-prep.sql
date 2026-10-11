-- =============================================================================
-- SLICE 7 · AXISCARE PREPARATION (Samantha "yes to all", 2026-10-10). Hub project. No new table:
--   1. the AxisCare change log learns two kinds: caregiver_hire_date (the employment start date written once at Approve to
--      Work, read back) and caregiver_level (the approved Level of Care class written once, read back)
--   2. five caregiver catalog rows, active: the caregiver record in AxisCare (verified from the connect), the attributes and
--      the availability entered in AxisCare by copy sheet (office ticks), the hire date and the level class (verified from
--      the read-back; optional rows so a practice run never blocks a card)
-- Rollback: slice7-rollback.sql (the kind list narrows only when no row uses the new kinds; the rows go inactive; nothing deleted).
-- =============================================================================
do $guard$ begin
  if to_regclass('public.axiscare_change_log') is null then raise exception 'slice 7 refused: axiscare_change_log is missing. Nothing was changed.'; end if;
  if to_regclass('public.client_journey_step_def') is null then raise exception 'slice 7 refused: the journey catalog is missing. Nothing was changed.'; end if;
end $guard$;

do $k$ declare cn text; begin
  select conname into cn from pg_constraint
   where conrelid = 'public.axiscare_change_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%client_created%';
  if cn is null then raise exception 'slice 7 refused: the change log kind list was not found. Nothing was changed.'; end if;
  execute format('alter table public.axiscare_change_log drop constraint %I', cn);
  alter table public.axiscare_change_log add constraint axiscare_change_log_kind_check check (kind in (
    'client_created','client_linked','client_updated','responsible_party','care_level','care_tasks','care_plan_note','client_note',
    'caregiver_note','schedule','visit_caregiver','call_summary','scheduling_note',
    'caregiver_status','prn_team_classes','caregiver_hire_date','caregiver_level'));
end $k$;

insert into public.client_journey_step_def (key, catalog_version, def, active, updated_by) values ('cg.axiscare.in_training', 1, '{"subject": "caregiver", "title": "Caregiver record in AxisCare (hired, In Training)", "stage": "orientation", "sort": 79, "owner_role": "staffing_coordinator", "proof": "verified", "permission": "hub", "evidence_required": "system_fact:AxisCare caregiver connected to the roster record (the connect job)", "required": true, "active": true, "payers": [], "after": ["cg.approve.advance"], "howto": ["The office hires the applicant in AxisCare by hand around the welcome call (the API cannot convert an applicant). The hourly connect job links the AxisCare caregiver to the roster record; this row verifies from that link.", "A card nudges the Staffing Coordinator when the welcome call is done and AxisCare still has no caregiver record two business days later."], "due": {"days": 2, "from": "cg.welcome.call"}}'::jsonb, true, 'seed 7 2026-10-10') on conflict (key) do update set def = excluded.def, active = true, updated_by = excluded.updated_by;
insert into public.client_journey_step_def (key, catalog_version, def, active, updated_by) values ('cg.axiscare.attributes', 1, '{"subject": "caregiver", "title": "Attributes entered in AxisCare (copy sheet)", "stage": "orientation", "sort": 86, "owner_role": "staffing_coordinator", "proof": "confirmed", "permission": "office", "evidence_required": "confirmed_by:the office person who typed them, from the copy sheet", "required": true, "active": true, "payers": [], "after": ["cg.axiscare.in_training"], "howto": ["AxisCare has no door for attributes. Press Copy sheet on this row: the Step 1 answers in AxisCare order (languages, pets, smoking, transportation, lifts, levels, specialties). Type them on the caregiver's Attributes screen, then confirm this row."]}'::jsonb, true, 'seed 7 2026-10-10') on conflict (key) do update set def = excluded.def, active = true, updated_by = excluded.updated_by;
insert into public.client_journey_step_def (key, catalog_version, def, active, updated_by) values ('cg.axiscare.availability', 1, '{"subject": "caregiver", "title": "Availability entered in AxisCare (copy sheet)", "stage": "orientation", "sort": 87, "owner_role": "staffing_coordinator", "proof": "confirmed", "permission": "office", "evidence_required": "confirmed_by:the office person who typed it, from the copy sheet", "required": true, "active": true, "payers": [], "after": ["cg.axiscare.in_training"], "howto": ["AxisCare has no door for availability. Press Copy sheet on this row: the Step 1 grid by day and time, ideal hours, max miles. Type it on the caregiver's Availability screen, then confirm this row. The Hub's own availability record (Team Builder) landed at connect."]}'::jsonb, true, 'seed 7 2026-10-10') on conflict (key) do update set def = excluded.def, active = true, updated_by = excluded.updated_by;
insert into public.client_journey_step_def (key, catalog_version, def, active, updated_by) values ('cg.axiscare.hire_date', 1, '{"subject": "caregiver", "title": "AxisCare hire date = orientation completion (written once, read back)", "stage": "ready", "sort": 102, "owner_role": "hub", "proof": "verified", "permission": "hub", "evidence_required": "system_fact:AxisCare hireDate read back after the write (decision 7)", "required": false, "active": true, "payers": [], "after": ["cg.axiscare.active"], "howto": ["Written at Approve to Work after AxisCare reads back Active, only when the dates differ, only with the Admin switch on; the change log keeps every outcome."]}'::jsonb, true, 'seed 7 2026-10-10') on conflict (key) do update set def = excluded.def, active = true, updated_by = excluded.updated_by;
insert into public.client_journey_step_def (key, catalog_version, def, active, updated_by) values ('cg.axiscare.level', 1, '{"subject": "caregiver", "title": "Approved Level of Care class in AxisCare (written once, read back)", "stage": "ready", "sort": 103, "owner_role": "hub", "proof": "verified", "permission": "hub", "evidence_required": "system_fact:AxisCare classes read back after the write", "required": false, "active": true, "payers": [], "after": ["cg.axiscare.active"], "howto": ["Written at Approve to Work after AxisCare reads back Active: the approved level class (Level 1 unless recorded higher) is added, every other class kept, only with the Admin switch on. Team Builder and coverage read the level from these classes."]}'::jsonb, true, 'seed 7 2026-10-10') on conflict (key) do update set def = excluded.def, active = true, updated_by = excluded.updated_by;

do $v$ declare d text; n int; begin
  select pg_get_constraintdef(oid) into d from pg_constraint where conname = 'axiscare_change_log_kind_check';
  if d is null or d not like '%caregiver_hire_date%' or d not like '%caregiver_level%' or d not like '%caregiver_status%' then raise exception 'slice 7 self-check: the kind list is not as expected'; end if;
  select count(*) into n from public.client_journey_step_def where key in ('cg.axiscare.in_training','cg.axiscare.attributes','cg.axiscare.availability','cg.axiscare.hire_date','cg.axiscare.level') and active;
  if n <> 5 then raise exception 'slice 7 self-check: expected 5 active rows, found %', n; end if;
  if has_table_privilege('authenticated', 'public.client_journey_step_def', 'insert') then raise exception 'slice 7 self-check: the catalog must stay server-written'; end if;
end $v$;
