-- =============================================================================
-- 921 · CAREGIVER PHONES FROM AXISCARE (Samantha 2026-10-18: "Build the caregiver phone fix: any AxisCare phone, fill
-- blanks hourly without overwriting, and a list of anyone with no number anywhere").
--
-- caregiver_phone_fill(p)   the one writer for this. The hourly caregiver connect job calls it for a Hub caregiver record
--   that is connected to an AxisCare caregiver and has no usable phone (fewer than 10 digits). It writes AxisCare's number
--   on that record, with where it came from (phone_from: axiscare, which AxisCare field, when, and what was there before
--   if anything). It NEVER replaces a usable number: if the record has one by the time it runs, nothing changes.
--   Server only; one at a time with the connect job (the same lock); the 421 version trigger stamps _rev and the 418 history
--   records the change, as for every other save.
-- caregiver_connect_runs.phones_filled   how many each run filled.
-- SHARED HUB PROJECT; safe to run again; one transaction. Nothing here messages anyone or writes to AxisCare.
-- =============================================================================
begin;

alter table public.caregiver_connect_runs add column if not exists phones_filled int;

create or replace function public.caregiver_phone_fill(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $fn$
declare
  rid text := nullif(trim(coalesce(p->>'caregiver_id', '')), '');
  ax text := nullif(trim(coalesce(p->>'axiscare_id', '')), '');
  ph text := left(trim(coalesce(p->>'phone', '')), 40);
  fld text := left(coalesce(p->>'field', ''), 40);
  d text := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g');
  cg jsonb; rec jsonb; newarr jsonb; n int; was text;
begin
  if rid is null or ax is null or not (length(d) = 10 or (length(d) = 11 and left(d, 1) = '1')) then
    raise exception 'caregiver_phone_fill: needs a Hub record, an AxisCare id and a 10-digit phone' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('caregiver_connect'));   -- one at a time with the connect job and the Connect card
  select data into cg from public.app_data where key = 'caregivers' for update;
  if cg is null or jsonb_typeof(cg) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'no_list');
  end if;
  select count(*) into n from jsonb_array_elements(cg) x where x->>'id' = rid;
  select x into rec from jsonb_array_elements(cg) x where x->>'id' = rid limit 1;
  if n <> 1 then return jsonb_build_object('ok', false, 'reason', case when n = 0 then 'gone' else 'duplicate_id' end); end if;
  if coalesce(rec->>'axiscare_id', '') <> ax then return jsonb_build_object('ok', false, 'reason', 'not_theirs'); end if;
  was := coalesce(rec->>'phone', '');
  if length(regexp_replace(was, '\D', '', 'g')) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'has_phone');   -- never overwrite a number
  end if;
  if p ? 'base_rev' and jsonb_typeof(p->'base_rev') <> 'null' and public.app_data_rev(rec) <> (p->>'base_rev')::bigint then
    return jsonb_build_object('ok', false, 'reason', 'changed');      -- someone saved it a moment ago; next hour
  end if;
  rec := (rec - '_rev') || jsonb_build_object('phone', ph, 'phone_from', jsonb_strip_nulls(jsonb_build_object(
    'source', 'axiscare', 'field', nullif(fld, ''), 'at', now(), 'by', 'caregiver-connect', 'was', nullif(was, ''))));
  select coalesce(jsonb_agg(case when x->>'id' = rid then rec || jsonb_build_object('id', x->'id') else x end), '[]'::jsonb)
    into newarr from jsonb_array_elements(cg) x;
  update public.app_data set data = newarr, updated_at = now() where key = 'caregivers';
  return jsonb_build_object('ok', true, 'caregiver_id', rid);
end
$fn$;
revoke all on function public.caregiver_phone_fill(jsonb) from public, anon, authenticated;
grant execute on function public.caregiver_phone_fill(jsonb) to service_role;

do $verify$
begin
  if to_regprocedure('public.app_data_rev(jsonb)') is null then raise exception '921 self-check: safe saving (421) is not installed'; end if;
  if not exists (select 1 from pg_proc where proname = 'caregiver_phone_fill' and pronamespace = 'public'::regnamespace and prosecdef) then
    raise exception '921 self-check: caregiver_phone_fill must run as its owner';
  end if;
  if has_function_privilege('authenticated', 'public.caregiver_phone_fill(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.caregiver_phone_fill(jsonb)', 'execute') then
    raise exception '921 self-check: only the server may call caregiver_phone_fill';
  end if;
end $verify$;

commit;
