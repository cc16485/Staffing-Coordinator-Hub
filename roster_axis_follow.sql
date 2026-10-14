-- =============================================================================
-- 722 · THE HUB FOLLOWS AXISCARE FOR ACTIVE (Samantha, 2026-10-14: "axiscare is the truth for if a caregiver is active or
-- not"; her choice "Hub follows AxisCare": the Hub marks a caregiver inactive, or active again, whenever AxisCare does,
-- checked nightly, and the Caregivers page lists everyone it changed. Nobody is deleted).
--
-- caregiver_active_patch changes only `active` and the note of why (active_from_axiscare) on ONE caregiver, and only if that
-- caregiver's _rev is still the one the nightly job read (otherwise it hands back the current record and changes nothing),
-- the same safe-save pattern as caregiver_sweep_patch (441). Server role only. Safe to run again.
-- Undo: roster_axis_follow_rollback.sql (drops the function; the changes it made stay, each one is on the Caregivers page).
-- =============================================================================
create or replace function public.caregiver_active_patch(p_id text, p_base_rev bigint, p_active boolean, p_note jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $fn$
declare cg jsonb; rec jsonb; n int; newarr jsonb; outd jsonb; v_rev bigint;
begin
  if p_id is null or p_id = '' or p_active is null or p_note is null or jsonb_typeof(p_note) <> 'object' then
    raise exception 'caregiver_active_patch: a caregiver number, active true or false, and the note are needed' using errcode = '22023';
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
  select coalesce(jsonb_agg(case when x->>'id' = p_id
           then ((x - '_rev') || jsonb_build_object('active', p_active, 'active_from_axiscare', p_note)) else x end), '[]'::jsonb)
    into newarr from jsonb_array_elements(cg) x;
  update public.app_data set data = newarr, updated_at = now() where key = 'caregivers' returning data into outd;
  select public.app_data_rev(x) into v_rev from jsonb_array_elements(outd) x where x->>'id' = p_id limit 1;
  return jsonb_build_object('ok', true, 'rev', v_rev);
end $fn$;
revoke all on function public.caregiver_active_patch(text, bigint, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.caregiver_active_patch(text, bigint, boolean, jsonb) to service_role;
do $v$ begin
  if has_function_privilege('authenticated', 'public.caregiver_active_patch(text, bigint, boolean, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.caregiver_active_patch(text, bigint, boolean, jsonb)', 'execute') then
    raise exception '722 self-check: only the server may call caregiver_active_patch';
  end if;
  if not exists (select 1 from pg_proc where proname = 'app_data_rev' and pronamespace = 'public'::regnamespace) then
    raise exception '722 self-check: app_data_rev (safe saves) is missing';
  end if;
end $v$;
