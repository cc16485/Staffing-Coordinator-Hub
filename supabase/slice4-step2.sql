-- =============================================================================
-- SLICE 4 · VIVENTIUM STEP 2, MANUAL AND AUDITED (Samantha "go", 2026-10-10). Hub project. One small change, no new table:
-- step2_patch, the Step 2 server's own door onto a Background & References row (or the roster record a person moved to):
-- only the step2_* fields, only when nobody changed the record since it was read, server role only. Same mechanics as
-- caregiver_sweep_patch (441). The 15-minute schedule (step2-handoff pass) is installed by the Desktop step.
-- Rollback: drop function public.step2_patch(text, text, bigint, jsonb); nothing else; no row is deleted.
-- =============================================================================
do $guard$ begin
  if to_regprocedure('public.app_data_rev(jsonb)') is null then
    raise exception 'slice 4 refused: app_data_rev is missing. Nothing was changed.'; end if;
end $guard$;

create or replace function public.step2_patch(p_key text, p_id text, p_base_rev bigint, p_patch jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $fn$
declare cg jsonb; rec jsonb; n int; bad text[]; newarr jsonb; outd jsonb; v_rev bigint;
begin
  if p_key is null or p_key not in ('candidates', 'caregivers') then
    raise exception 'step2_patch: only candidates and caregivers are saved this way' using errcode = '22023';
  end if;
  if p_id is null or p_id = '' or p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'step2_patch: a record number and the fields are needed' using errcode = '22023';
  end if;
  select array_agg(k) into bad from jsonb_object_keys(p_patch) k
   where k not in ('step2_sent_at', 'step2_sent_by', 'step2_sent_note', 'step2_resent_at', 'step2_resent_by', 'step2_msg',
                   'step2_done_at', 'step2_done_by', 'step2_done_how', 'step2_receipt',
                   'step2_verified_at', 'step2_verified_by', 'step2_checklist', 'step2_i9_s2_by', 'step2_i9_s2_at', 'step2_note',
                   'step2_still_open_at', 'step2_still_open_by', 'step2_still_open_task', 'step2_reminders', 'step2_history', 'step2_invite');
  if bad is not null then
    raise exception 'step2_patch: not a Step 2 field: %', array_to_string(bad, ', ') using errcode = '22023';
  end if;
  select data into cg from public.app_data where key = p_key for update;
  if cg is null or jsonb_typeof(cg) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  select count(*) into n from jsonb_array_elements(cg) x where x->>'id' = p_id;
  if n = 0 then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  if n > 1 then return jsonb_build_object('ok', false, 'reason', 'duplicate_id'); end if;
  select x into rec from jsonb_array_elements(cg) x where x->>'id' = p_id limit 1;
  if public.app_data_rev(rec) <> coalesce(p_base_rev, -1) then
    return jsonb_build_object('ok', false, 'reason', 'changed', 'current_record', rec);
  end if;
  select coalesce(jsonb_agg(case when x->>'id' = p_id then ((x - '_rev') || p_patch) else x end), '[]'::jsonb) into newarr from jsonb_array_elements(cg) x;
  update public.app_data set data = newarr, updated_at = now() where key = p_key returning data into outd;
  select public.app_data_rev(x) into v_rev from jsonb_array_elements(outd) x where x->>'id' = p_id limit 1;
  return jsonb_build_object('ok', true, 'rev', v_rev);
end $fn$;
revoke all on function public.step2_patch(text, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.step2_patch(text, text, bigint, jsonb) to service_role;

do $v$ begin
  if has_function_privilege('authenticated', 'public.step2_patch(text, text, bigint, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.step2_patch(text, text, bigint, jsonb)', 'execute') then
    raise exception 'slice 4 self-check: only the server may call step2_patch'; end if;
end $v$;
