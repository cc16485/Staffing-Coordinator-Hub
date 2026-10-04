-- =============================================================================
-- 441 · SAFE SAVES STEP 4: THE ELIGIBILITY SWEEP SAVES ONLY ITS OWN FIELDS. Samantha approved the safe saves plan
-- 2026-10-04 ("yes to all"): https://claude.ai/artifact/Y8Kmn4hR7rmWt9keXG6uGd
--
-- The sweep (switched off today) used to save each caregiver's WHOLE record from the copy it read at the start of its
-- run (upsert_app_data_item), so an office edit made while it ran would be undone. caregiver_sweep_patch changes only
-- the five fields the sweep owns, and only if that caregiver's _rev is still the one the sweep read; otherwise it hands
-- back the current record so the sweep can work eligibility out again from it. Server role only. Safe to run again.
-- =============================================================================
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
do $v$ begin
  if has_function_privilege('authenticated', 'public.caregiver_sweep_patch(text, bigint, jsonb)', 'execute') then
    raise exception '441 self-check: only the server may call caregiver_sweep_patch';
  end if;
end $v$;
