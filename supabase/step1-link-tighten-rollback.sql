-- STEP 1 LINK TIGHTEN rollback (2026-10-13): puts back step1_candidate_create exactly as step1-before-checks.sql installed it
-- (links on the same phone OR the same first and last name). Every record and card the tightened version made stays.
create or replace function public.step1_candidate_create(p_offer_id text, p_record jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $fn$
declare cd jsonb; i int; c jsonb; idx int := -1; how text := 'created'; nxt bigint; maxid bigint; d10 text;
begin
  if coalesce(p_offer_id, '') = '' or jsonb_typeof(p_record) <> 'object' then
    raise exception 'step1_candidate_create: an offer id and a record are needed' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('step1_land'));
  insert into public.app_data (key, data) values ('candidates', '[]'::jsonb) on conflict (key) do nothing;
  select data into cd from public.app_data where key = 'candidates' for update;
  if jsonb_typeof(cd) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'no_list'); end if;
  d10 := right(regexp_replace(coalesce(p_record->>'phone', ''), '\D', '', 'g'), 10);
  for i in 0 .. jsonb_array_length(cd) - 1 loop
    c := cd->i;
    if jsonb_typeof(c) <> 'object' then continue; end if;
    if c->>'offer_id' = p_offer_id then return jsonb_build_object('ok', true, 'created', false, 'how', 'already', 'id', c->'id'); end if;
  end loop;
  for i in 0 .. jsonb_array_length(cd) - 1 loop
    c := cd->i;
    if jsonb_typeof(c) <> 'object' or coalesce(c->>'offer_id', '') <> '' or coalesce(c->>'not_hired', '') = 'true' then continue; end if;
    if (length(d10) = 10 and right(regexp_replace(coalesce(c->>'phone', ''), '\D', '', 'g'), 10) = d10)
       or (lower(coalesce(c->>'first', '')) = lower(coalesce(p_record->>'first', '')) and lower(coalesce(c->>'last', '')) = lower(coalesce(p_record->>'last', ''))
           and coalesce(p_record->>'first', '') <> '') then idx := i; exit; end if;
  end loop;
  if idx >= 0 then
    c := (cd->idx) || jsonb_build_object('offer_id', p_offer_id, 'onboarding_path', coalesce(p_record->>'onboarding_path', 'new'));
    update public.app_data set data = jsonb_set(data, array[idx::text], c), updated_at = now() where key = 'candidates';
    return jsonb_build_object('ok', true, 'created', false, 'how', 'linked', 'id', c->'id');
  end if;
  select coalesce(max((v->>'id')::bigint), 0) into maxid from jsonb_array_elements(cd) v where jsonb_typeof(v) = 'object' and (v->>'id') ~ '^[0-9]{1,15}$';
  insert into public.app_data_id_counter (key, last_id) values ('candidates', 0) on conflict (key) do nothing;
  select last_id into nxt from public.app_data_id_counter where key = 'candidates' for update;
  nxt := greatest(coalesce(nxt, 0), maxid) + 1;
  update public.app_data_id_counter set last_id = nxt, updated_at = now() where key = 'candidates';
  c := (p_record - 'id' - '_rev') || jsonb_build_object('id', nxt, 'offer_id', p_offer_id);
  update public.app_data set data = data || jsonb_build_array(c), updated_at = now() where key = 'candidates';
  return jsonb_build_object('ok', true, 'created', true, 'how', how, 'id', nxt);
end $fn$;
revoke all on function public.step1_candidate_create(text, jsonb) from public, anon, authenticated;
grant execute on function public.step1_candidate_create(text, jsonb) to service_role;
