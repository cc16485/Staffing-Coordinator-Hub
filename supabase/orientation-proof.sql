-- ============================================================================
-- ORIENTATION PROOF (Samantha 2026-10-28: "no caregiver is approved to work without verified orientation, while recognizing
-- legitimate historical training records"). Safe to run again.
-- The nightly audit's door onto a caregiver record (caregiver_audit_patch, slice 6) gains ONE field: orient_verified, the
-- office's verification of a historical orientation record ({date, document, by, by_email, at, kind, note}), written only by
-- the orientation-proof function. Everything else about the function is exactly as slice 6 made it.
-- Rollback: run supabase/slice6-continuous-audits.sql's function again (the field list without orient_verified).
-- ============================================================================
create or replace function public.caregiver_audit_patch(p_id text, p_base_rev bigint, p_patch jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $fn$
declare cg jsonb; rec jsonb; n int; bad text[]; newarr jsonb; outd jsonb; v_rev bigint;
begin
  if p_id is null or p_id = '' or p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'caregiver_audit_patch: a caregiver number and the fields are needed' using errcode = '22023';
  end if;
  select array_agg(k) into bad from jsonb_object_keys(p_patch) k
   where k not in ('orient_date', 'orient_proof', 'alz_date', 'alz_hrs', 'alz_proof', 'ojt_online', 'ojt_online_proof', 'annual_date', 'annual_hrs', 'annual_proof',
                   'hire_date', 'first_contact', 'axiscare_id', 'th_synced', 'oig', 'oig_date', 'oig_proof', 'oig_evidence', 'orient_verified');
  if bad is not null then
    raise exception 'caregiver_audit_patch: not a field the audit owns: %', array_to_string(bad, ', ') using errcode = '22023';
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
revoke all on function public.caregiver_audit_patch(text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.caregiver_audit_patch(text, bigint, jsonb) to service_role;
do $v$ begin
  if has_function_privilege('authenticated', 'public.caregiver_audit_patch(text, bigint, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.caregiver_audit_patch(text, bigint, jsonb)', 'execute') then
    raise exception 'orientation proof self-check: only the server may call caregiver_audit_patch'; end if;
end $v$;
