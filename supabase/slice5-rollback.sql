-- =============================================================================
-- SLICE 5 ROLLBACK · the change log kind list and caregiver_sweep_patch go back to how they were before slice 5.
-- NOTHING IS DELETED (her rule 8): change log rows of the two new kinds stay (the list is only narrowed when none exist),
-- roster fields written by the readiness server stay on the records, journey rows and events stay.
-- =============================================================================
do $k$ declare cn text; n int; begin
  select count(*) into n from public.axiscare_change_log where kind in ('caregiver_status', 'prn_team_classes');
  if n > 0 then
    raise notice 'slice 5 rollback: % change log row(s) use the new kinds; the kind list is kept so they stay valid', n;
  else
    select conname into cn from pg_constraint
     where conrelid = 'public.axiscare_change_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%client_created%';
    if cn is not null then execute format('alter table public.axiscare_change_log drop constraint %I', cn); end if;
    alter table public.axiscare_change_log add constraint axiscare_change_log_kind_check check (kind in (
      'client_created','client_linked','client_updated','responsible_party','care_level','care_tasks','care_plan_note','client_note',
      'caregiver_note','schedule','visit_caregiver','call_summary','scheduling_note'));
  end if;
end $k$;

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
   where k not in ('eligibility_history', 'eligibility_state', 'eligibility_reason', 'eligibility_at', 'axiscare_note_for');
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
