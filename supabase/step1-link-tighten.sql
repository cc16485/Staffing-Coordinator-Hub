-- =============================================================================
-- STEP 1 LINK TIGHTEN (go-live gate, 2026-10-13; Samantha's rules: "Applicants cannot be approved to work with incomplete
-- required steps" and "no silent failures"). Hub project. Replaces step1_candidate_create from step1-before-checks.sql.
-- What changes, and only this:
--   · an existing Background & References record is linked to a new-path offer ONLY when the first name matches AND the
--     phone (last ten digits) or the email matches. A name alone never links (two people can share a name; a wrong link
--     hands one person's checks and references to the other).
--   · a record whose onboarding_path is 'old' is never flipped to the new path. A new record is made for the offer instead,
--     and ONE Needs Attention card (Recruiting & Orientation owner) names both records so the office can merge them by hand
--     if they are the same person.
-- Unchanged: a record already carrying this offer id is returned as it is; otherwise the record is added with the next
-- person number (app_data_id_counter: a number is never given twice); server only (service role).
-- Rollback: step1-link-tighten-rollback.sql puts back the step1-before-checks.sql version (records it made stay).
-- =============================================================================
create or replace function public.step1_candidate_create(p_offer_id text, p_record jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $fn$
declare cd jsonb; i int; c jsonb; idx int := -1; old_idx int := -1; nxt bigint; maxid bigint; d10 text; em text; fn text;
  old_rec jsonb; card_id text; owner_email text := ''; owner_name text := ''; ops jsonb; nm text; card_made boolean := false;
begin
  if coalesce(p_offer_id, '') = '' or jsonb_typeof(p_record) <> 'object' then
    raise exception 'step1_candidate_create: an offer id and a record are needed' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('step1_land'));
  insert into public.app_data (key, data) values ('candidates', '[]'::jsonb) on conflict (key) do nothing;
  select data into cd from public.app_data where key = 'candidates' for update;
  if jsonb_typeof(cd) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'no_list'); end if;
  d10 := right(regexp_replace(coalesce(p_record->>'phone', ''), '\D', '', 'g'), 10);
  em := lower(btrim(coalesce(p_record->>'email', '')));
  fn := lower(btrim(coalesce(p_record->>'first', '')));
  for i in 0 .. jsonb_array_length(cd) - 1 loop
    c := cd->i;
    if jsonb_typeof(c) <> 'object' then continue; end if;
    if c->>'offer_id' = p_offer_id then return jsonb_build_object('ok', true, 'created', false, 'how', 'already', 'id', c->'id'); end if;
  end loop;
  /* a link needs the same first name AND the same phone or email; never a name alone */
  if fn <> '' then
    for i in 0 .. jsonb_array_length(cd) - 1 loop
      c := cd->i;
      if jsonb_typeof(c) <> 'object' or coalesce(c->>'offer_id', '') <> '' or coalesce(c->>'not_hired', '') = 'true' then continue; end if;
      if lower(btrim(coalesce(c->>'first', ''))) <> fn then continue; end if;
      if not ((length(d10) = 10 and right(regexp_replace(coalesce(c->>'phone', ''), '\D', '', 'g'), 10) = d10)
              or (em <> '' and lower(btrim(coalesce(c->>'email', ''))) = em)) then continue; end if;
      if coalesce(c->>'onboarding_path', '') = 'old' then
        if old_idx < 0 then old_idx := i; end if;
        continue;
      end if;
      idx := i; exit;
    end loop;
  end if;
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
  /* an old-path record with the same first name and phone or email: never flipped; one card names both for the office */
  if old_idx >= 0 then
    old_rec := cd->old_idx;
    card_id := 's1dup_' || p_offer_id;
    nm := btrim(coalesce(p_record->>'first', '') || ' ' || coalesce(p_record->>'last', ''));
    begin
      if to_regclass('public.domains') is not null and to_regclass('public.persons') is not null then
        execute $q$select lower(coalesce(p.primary_email, '')), coalesce(p.full_name, '') from public.domains d join public.persons p on p.person_id = d.owner_person
                   where d.entity = 'cc_ihs' and d.code = 'recruiting_orientation' limit 1$q$ into owner_email, owner_name;
      end if;
    exception when others then owner_email := ''; owner_name := '';
    end;
    insert into public.app_data (key, data) values ('ops_items', '[]'::jsonb) on conflict (key) do nothing;
    select data into ops from public.app_data where key = 'ops_items' for update;
    if jsonb_typeof(ops) = 'array' and not exists (select 1 from jsonb_array_elements(ops) x where x->>'id' = card_id) then
      update public.app_data set data = data || jsonb_build_array(jsonb_build_object(
        'id', card_id, 'kind', 'step1_possible_duplicate', 'domain', 'recruiting_orientation', 'status', 'open', 'urgency', 'today',
        'title', 'Two records may be the same person: ' || coalesce(nullif(nm, ''), 'a new hire'),
        'detail', 'Their Step 1 is complete, so the Hub made a new Background & References record (number ' || nxt::text || ') for the new-path offer. '
          || 'An older record on the old path (number ' || coalesce(old_rec->>'id', '?') || ', ' || btrim(coalesce(old_rec->>'first', '') || ' ' || coalesce(old_rec->>'last', '')) || ') has the same first name and the same phone or email. '
          || 'The old record was not changed. If they are the same person, merge them by hand; if not, close this card.',
        'who', coalesce(nullif(nm, ''), 'a new hire'), 'offer_id', p_offer_id, 'candidate_id', nxt, 'other_candidate_id', old_rec->'id',
        'owner', coalesce(owner_email, ''), 'owner_name', coalesce(owner_name, ''),
        'created_at', now(), 'first_at', now(), 'last_at', now(), 'due', now() + interval '24 hours',
        'created_by', 'step1_candidate_create', 'opened_by', 'step1_candidate_create')), updated_at = now()
       where key = 'ops_items';
      card_made := true;
    end if;
    return jsonb_build_object('ok', true, 'created', true, 'how', 'created_old_path_kept', 'id', nxt, 'other_id', old_rec->'id', 'card', case when card_made then card_id else null end);
  end if;
  return jsonb_build_object('ok', true, 'created', true, 'how', 'created', 'id', nxt);
end $fn$;
revoke all on function public.step1_candidate_create(text, jsonb) from public, anon, authenticated;
grant execute on function public.step1_candidate_create(text, jsonb) to service_role;
do $v$ begin
  if exists (select 1 from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'step1_candidate_create'
              and grantee in ('anon', 'authenticated', 'PUBLIC')) then raise exception 'step1-link-tighten self-check: a browser can call step1_candidate_create'; end if;
  if position('step1_possible_duplicate' in pg_get_functiondef('public.step1_candidate_create(text,jsonb)'::regprocedure)) = 0 then
    raise exception 'step1-link-tighten self-check: the tightened function is not installed'; end if;
end $v$;
