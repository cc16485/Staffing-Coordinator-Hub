-- ============================================================================
-- SLICE 2d (Samantha: "start slice 2d", 2026-10-10). Hub project. THE LANDING DOOR: step1_land_apply.
-- When a Step 1 form is signed, the Step 1 server lands the answers the office already uses onto the Background &
-- References row (app_data.candidates) whose offer_id matches: lived outside Missouri and the states, fingerprints
-- Required when so, no employer history, the four reference slots, the Step 1 done time. Fills blanks only for the
-- reference slots (what the office recorded wins); only the allowed fields; one history row per landing. Runs as its
-- owner so the 442 people lock lets it through, like candidate_import_apply; service role only.
-- Safe to run again. Rollback: drop function public.step1_land_apply(text, jsonb, text); no row changes.
-- ============================================================================
create or replace function public.step1_land_apply(p_offer_id text, p_patch jsonb, p_by text default 'step1')
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $fn$
declare cd jsonb; idx int := -1; i int; c jsonb; k text; v jsonb; filled text[] := '{}'; allowed text[]; n int;
begin
  if p_offer_id is null or p_offer_id = '' or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'step1_land_apply: an offer id and a patch are needed' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('step1_land'));
  select data into cd from public.app_data where key = 'candidates' for update;
  if cd is null or jsonb_typeof(cd) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'no_list'); end if;
  for i in 0 .. jsonb_array_length(cd) - 1 loop
    if (cd->i)->>'offer_id' = p_offer_id and coalesce((cd->i)->>'not_hired', '') <> 'true' then idx := i; exit; end if;
  end loop;
  if idx < 0 then return jsonb_build_object('ok', false, 'reason', 'no_candidate'); end if;
  c := cd->idx;
  allowed := array['oos', 'fp', 'no_employer_history', 'step1_landed', 'step1_done_at'];
  for n in 1..4 loop
    allowed := allowed || array['r'||n||'n', 'r'||n||'s', 'r'||n||'_phone', 'r'||n||'_email', 'r'||n||'_type', 'r'||n||'_company', 'r'||n||'_rel', 'r'||n||'_howlong'];
  end loop;
  for k, v in select * from jsonb_each(p_patch) loop
    if not (k = any(allowed)) then raise exception 'step1_land_apply: % is not a field Step 1 may land', k using errcode = '22023'; end if;
    if k ~ '^r[1-4]' then
      -- a slot already holding a name is never touched (the office's record wins)
      if coalesce(c->>(substring(k from '^r[1-4]')||'n'), '') <> '' and not (p_patch ? (substring(k from '^r[1-4]')||'n') and coalesce(c->>(substring(k from '^r[1-4]')||'n'), '') = '') then continue; end if;
    end if;
    if k in ('oos', 'fp', 'no_employer_history') and coalesce(c->>k, '') not in ('', 'N/A') then continue; end if;
    if k = 'step1_landed' then c := jsonb_set(c, '{step1_landed}', coalesce(c->'step1_landed', '{}'::jsonb) || v); filled := filled || k; continue; end if;
    if k = 'step1_done_at' and coalesce(c->>k, '') <> '' then continue; end if;
    c := jsonb_set(c, array[k], v); filled := filled || k;
  end loop;
  if array_length(filled, 1) is null then return jsonb_build_object('ok', true, 'candidate_id', c->>'id', 'filled', filled); end if;
  c := jsonb_set(c, '{_rev}', to_jsonb(coalesce((c->>'_rev')::int, 0) + 1));
  update public.app_data set data = jsonb_set(cd, array[idx::text], c), updated_at = now() where key = 'candidates';
  insert into public.app_data_item_change (key, record_id, change, fields_changed, actor, role, origin)
  values ('candidates', c->>'id', 'changed', filled, left(coalesce(p_by, 'step1'), 120), 'service_role', 'step1_land_apply');
  return jsonb_build_object('ok', true, 'candidate_id', c->>'id', 'filled', filled);
end $fn$;
revoke all on function public.step1_land_apply(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.step1_land_apply(text, jsonb, text) to service_role;
do $v$ begin
  if has_function_privilege('authenticated', 'public.step1_land_apply(text, jsonb, text)', 'execute') then
    raise exception '567 self-check: only the server may call step1_land_apply';
  end if;
end $v$;
