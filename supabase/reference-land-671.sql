-- ============================================================================
-- 671 · REFERENCE ANSWERS LAND BY THEMSELVES (Samantha 2026-10-12, step 3). Hub project. THE DOOR: reference_land_apply.
-- The server job reference-land puts one reference's online-form answers onto ONE Background & References person
-- (app_data.candidates) through this door, never by saving the whole list:
--   * only the five fields of that reference's slot: r{n}n, r{n}_manual, r{n}_type, r{n}_company, r{n}s (n = 1 to 4);
--     r{n}s only as Positive, Conditional, Negative or Pending; r{n}_manual only as an object;
--   * only if nobody changed that person since the job read them (_rev, the 421 per-person counter). If they did, it
--     answers 'changed' with the current record and saves nothing; the job works the answer out again on it;
--   * refuses (saves nothing) if the person is gone, two people share the number, or the person is marked not hired;
--   * no silent overwrites (her rule): refuses 'office_recorded' when the office already recorded this reference (an
--     answers record not from the online form, or a status set by hand with no answers record). A blank or Pending
--     slot, or one whose answers came from the online form (a re-answer), lands;
--   * nothing different: answers ok with no save (so a second landing of the same answer changes nothing);
--   * one history line tagged origin 'reference-land' (as step1_land_apply does), besides the database's own line.
-- The _rev is set by the database (app_data_version_t), as for every other save. Runs as its owner so the 442 people
-- lock lets it through, like caregiver_sweep_patch and step1_land_apply; the server role only.
-- Safe to run again. Rollback: drop function public.reference_land_apply(text, int, bigint, jsonb, text); no row changes.
-- ============================================================================
create or replace function public.reference_land_apply(p_candidate_id text, p_slot int, p_base_rev bigint, p_patch jsonb, p_by text default 'reference-land')
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $fn$
declare cd jsonb; rec jsonb; m jsonb; idx int := -1; i int; n int := 0; k text; v jsonb; changed text[] := '{}'; allowed text[]; outd jsonb; v_rev bigint;
begin
  if p_candidate_id is null or p_candidate_id = '' or p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'reference_land_apply: a person number and the fields are needed' using errcode = '22023';
  end if;
  if p_slot is null or p_slot < 1 or p_slot > 4 then
    raise exception 'reference_land_apply: the reference slot must be 1 to 4' using errcode = '22023';
  end if;
  allowed := array['r'||p_slot||'n', 'r'||p_slot||'_manual', 'r'||p_slot||'_type', 'r'||p_slot||'_company', 'r'||p_slot||'s'];
  for k, v in select * from jsonb_each(p_patch) loop
    if not (k = any(allowed)) then
      raise exception 'reference_land_apply: % is not a field a reference answer may land in slot %', k, p_slot using errcode = '22023';
    end if;
    if k = 'r'||p_slot||'s' and not (jsonb_typeof(v) = 'string' and v #>> '{}' in ('Positive', 'Conditional', 'Negative', 'Pending')) then
      raise exception 'reference_land_apply: % must be Positive, Conditional, Negative or Pending', k using errcode = '22023';
    end if;
    if k = 'r'||p_slot||'_manual' and jsonb_typeof(v) <> 'object' then
      raise exception 'reference_land_apply: % must be the answers record', k using errcode = '22023';
    end if;
    if k in ('r'||p_slot||'n', 'r'||p_slot||'_type', 'r'||p_slot||'_company') and jsonb_typeof(v) not in ('string', 'null') then
      raise exception 'reference_land_apply: % must be text', k using errcode = '22023';
    end if;
  end loop;

  select data into cd from public.app_data where key = 'candidates' for update;
  if cd is null or jsonb_typeof(cd) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'no_candidate'); end if;
  for i in 0 .. jsonb_array_length(cd) - 1 loop
    if jsonb_typeof(cd->i) = 'object' and (cd->i)->>'id' = p_candidate_id then n := n + 1; idx := i; end if;
  end loop;
  if n = 0 then return jsonb_build_object('ok', false, 'reason', 'no_candidate'); end if;
  if n > 1 then return jsonb_build_object('ok', false, 'reason', 'duplicate_id'); end if;
  rec := cd->idx;
  if coalesce(rec->>'not_hired', '') not in ('', 'false') then return jsonb_build_object('ok', false, 'reason', 'not_hired'); end if;
  m := rec->('r'||p_slot||'_manual');
  if (m is not null and jsonb_typeof(m) <> 'null' and m <> '""'::jsonb
        and (jsonb_typeof(m) <> 'object' or (m->>'via') is distinct from 'Online form'))
     or ((m is null or jsonb_typeof(m) = 'null' or m = '""'::jsonb) and coalesce(rec->>('r'||p_slot||'s'), '') in ('Positive', 'Conditional', 'Negative')) then
    return jsonb_build_object('ok', false, 'reason', 'office_recorded');
  end if;
  if public.app_data_rev(rec) <> coalesce(p_base_rev, -1) then
    return jsonb_build_object('ok', false, 'reason', 'changed', 'current_record', rec);
  end if;

  select coalesce(array_agg(e.key order by e.key), '{}') into changed from jsonb_each(p_patch) e where (rec->e.key) is distinct from e.value;
  if array_length(changed, 1) is null then
    return jsonb_build_object('ok', true, 'unchanged', true, 'rev', public.app_data_rev(rec), 'fields', '[]'::jsonb);
  end if;

  update public.app_data set data = jsonb_set(cd, array[idx::text], (rec - '_rev') || p_patch), updated_at = now()
   where key = 'candidates' returning data into outd;
  v_rev := public.app_data_rev(outd->idx);
  insert into public.app_data_item_change (key, record_id, change, fields_changed, actor, role, origin)
  values ('candidates', p_candidate_id, 'changed', changed, left(coalesce(nullif(p_by, ''), 'reference-land'), 120), 'service_role', 'reference-land');
  return jsonb_build_object('ok', true, 'rev', v_rev, 'fields', to_jsonb(changed));
end $fn$;
revoke all on function public.reference_land_apply(text, int, bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.reference_land_apply(text, int, bigint, jsonb, text) to service_role;
do $v$ begin
  if has_function_privilege('authenticated', 'public.reference_land_apply(text, int, bigint, jsonb, text)', 'execute')
     or has_function_privilege('anon', 'public.reference_land_apply(text, int, bigint, jsonb, text)', 'execute') then
    raise exception '671 self-check: only the server may call reference_land_apply';
  end if;
  if not exists (select 1 from pg_proc where proname = 'reference_land_apply' and pronamespace = 'public'::regnamespace and prosecdef) then
    raise exception '671 self-check: reference_land_apply must run as its owner, or the 442 people lock would refuse it';
  end if;
end $v$;
