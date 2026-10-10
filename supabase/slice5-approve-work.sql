-- =============================================================================
-- SLICE 5 · APPROVE TO WORK AND AXISCARE ACTIVE (Samantha: "start slice 5", 2026-10-10; wording, old-path flip left as is,
-- new-path lock only: her three answers the same day). Hub project. Two small changes, no new table:
--   1. the AxisCare change log learns two kinds: caregiver_status (the Active update at Approve to Work, with its read-back)
--      and prn_team_classes (prn-team has recorded with this kind since 2026-09-29 and the list never allowed it, so those
--      records were refused quietly: fixed here, nothing back-filled)
--   2. caregiver_sweep_patch may save six more fields the readiness server owns on a roster record: approved_to_work_at,
--      approved_to_work_by, axiscare_status_active, axiscare_status_label, axiscare_status_at, work_lock. Same rule as
--      before: only those fields, only when nobody changed the record since it was read. Server role only.
-- Rollback: slice5-rollback.sql (the kind list and the function go back; no row is deleted).
-- =============================================================================
do $guard$ begin
  if to_regclass('public.axiscare_change_log') is null then
    raise exception 'slice 5 refused: axiscare_change_log is not installed (C2a). Nothing was changed.'; end if;
  if to_regprocedure('public.caregiver_sweep_patch(text, bigint, jsonb)') is null then
    raise exception 'slice 5 refused: caregiver_sweep_patch is not installed (441). Nothing was changed.'; end if;
end $guard$;

-- 1. the kind list (the constraint is found by what it checks, not by a name that may differ)
do $k$ declare cn text; begin
  select conname into cn from pg_constraint
   where conrelid = 'public.axiscare_change_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%client_created%';
  if cn is null then raise exception 'slice 5 refused: the change log kind list was not found. Nothing was changed.'; end if;
  execute format('alter table public.axiscare_change_log drop constraint %I', cn);
  alter table public.axiscare_change_log add constraint axiscare_change_log_kind_check check (kind in (
    'client_created','client_linked','client_updated','responsible_party','care_level','care_tasks','care_plan_note','client_note',
    'caregiver_note','schedule','visit_caregiver','call_summary','scheduling_note',
    'caregiver_status','prn_team_classes'));
end $k$;

-- 2. the roster fields the readiness server owns
create or replace function public.caregiver_sweep_patch(p_id text, p_base_rev bigint, p_patch jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $fn$
declare cg jsonb; rec jsonb; n int; bad text[]; newarr jsonb; outd jsonb; v_rev bigint;
begin
  if p_id is null or p_id = '' or p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'caregiver_sweep_patch: a caregiver number and the fields are needed' using errcode = '22023';
  end if;
  select array_agg(k) into bad from jsonb_object_keys(p_patch) k
   where k not in ('eligibility_history', 'eligibility_state', 'eligibility_reason', 'eligibility_at', 'axiscare_note_for',
                   'approved_to_work_at', 'approved_to_work_by', 'axiscare_status_active', 'axiscare_status_label', 'axiscare_status_at', 'work_lock');
  if bad is not null then
    raise exception 'caregiver_sweep_patch: not a field the sweep owns: %', array_to_string(bad, ', ') using errcode = '22023';
  end if;
  select data into cg from public.app_data where key = 'caregivers' for update;
  if cg is null or jsonb_typeof(cg) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  select count(*) into n from jsonb_array_elements(cg) x where x->>'id' = p_id;
  if n = 0 then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  if n > 1 then return jsonb_build_object('ok', false, 'reason', 'duplicate_id'); end if;
  select x into rec from jsonb_array_elements(cg) x where x->>'id' = p_id limit 1;
  if public.app_data_rev(rec) <> coalesce(p_base_rev, -1) then
    return jsonb_build_object('ok', false, 'reason', 'changed', 'current_record', rec);
  end if;
  select coalesce(jsonb_agg(case when x->>'id' = p_id then ((x - '_rev') || p_patch) else x end), '[]'::jsonb) into newarr from jsonb_array_elements(cg) x;
  update public.app_data set data = newarr, updated_at = now() where key = 'caregivers' returning data into outd;
  select public.app_data_rev(x) into v_rev from jsonb_array_elements(outd) x where x->>'id' = p_id limit 1;
  return jsonb_build_object('ok', true, 'rev', v_rev);
end $fn$;
revoke all on function public.caregiver_sweep_patch(text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.caregiver_sweep_patch(text, bigint, jsonb) to service_role;

do $v$ declare d text; begin
  select pg_get_constraintdef(oid) into d from pg_constraint where conname = 'axiscare_change_log_kind_check';
  if d is null or d not like '%caregiver_status%' or d not like '%prn_team_classes%' or d not like '%client_created%' then
    raise exception 'slice 5 self-check: the kind list is not as expected'; end if;
  if has_function_privilege('authenticated', 'public.caregiver_sweep_patch(text, bigint, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.caregiver_sweep_patch(text, bigint, jsonb)', 'execute') then
    raise exception 'slice 5 self-check: only the server may call caregiver_sweep_patch'; end if;
  if has_table_privilege('authenticated', 'public.client_journey', 'select') then
    raise exception 'slice 5 self-check: the journey tables must stay server-only'; end if;
end $v$;
