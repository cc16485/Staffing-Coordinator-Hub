-- =============================================================================
-- LEAVING ONBOARDING (Samantha 2026-10-21: "We need a clear way to take someone out of onboarding if they ghost, or let us
-- know that they took another position, etc."). Hub project. Run by Desktop step 1035.
--   reference_requests.closed_at / closed_reason   a request closed because they left (reference-chase, the reference
--                                                   texts and the applicant nudge skip closed rows; Come back reopens
--                                                   only the rows that leave closed)
--   leave_patch                                     the server's door for the leave fields on a candidate or roster record
--                                                   (only those fields, only if nobody changed the record since it was
--                                                   read), like step2_patch
-- Idempotent. Rollback: leave-1035-rollback.sql.
-- =============================================================================
alter table public.reference_requests add column if not exists closed_at timestamptz;
alter table public.reference_requests add column if not exists closed_reason text;

create or replace function public.leave_patch(p_key text, p_id text, p_base_rev bigint, p_patch jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $fn$
declare cg jsonb; rec jsonb; n int; bad text[]; newarr jsonb; outd jsonb; v_rev bigint;
begin
  if p_key is null or p_key not in ('candidates', 'caregivers') then
    raise exception 'leave_patch: only candidates and caregivers are saved this way' using errcode = '22023';
  end if;
  if p_id is null or p_id = '' or p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'leave_patch: a record number and the fields are needed' using errcode = '22023';
  end if;
  select array_agg(k) into bad from jsonb_object_keys(p_patch) k
   where k not in ('not_hired', 'not_hired_reason', 'not_hired_notes', 'not_hired_date', 'left_at', 'left_by', 'onboarding_left', 'came_back');
  if bad is not null then
    raise exception 'leave_patch: not a leaving-onboarding field: %', array_to_string(bad, ', ') using errcode = '22023';
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
revoke all on function public.leave_patch(text, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.leave_patch(text, text, bigint, jsonb) to service_role;

do $v$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'reference_requests' and column_name = 'closed_at') then raise exception '1035 self-check: closed_at is missing'; end if;
  if has_function_privilege('authenticated', 'public.leave_patch(text, text, bigint, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.leave_patch(text, text, bigint, jsonb)', 'execute') then
    raise exception '1035 self-check: only the server may call leave_patch'; end if;
end $v$;
