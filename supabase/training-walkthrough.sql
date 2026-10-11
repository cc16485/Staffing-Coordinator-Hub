-- =============================================================================
-- TRAINING WALKTHROUGH (Samantha 2026-10-11: "I would like for our staff to also put their info in to experience it, as a
-- training, set up inside the applicant journey tab"; "yes to all": any office staff, through the welcome call, ends by itself
-- after 14 days, their records shown with "(TRAINING)"). Hub project. Three server-only doors:
--   test_people_add(phone, email)      adds to ops_settings.test_people in one statement (never a stale copy); says what it added
--   test_people_remove(phone, email)   takes them off again (the walkthrough removes only what it added)
--   training_walkthrough_close(offer_id, reason)   ends ONE walkthrough on the Hub side: the records carrying that offer id and
--     "(TRAINING)" come off the working lists (the change and value histories keep them), the readiness card closes with an event,
--     its cards are marked done, an open welcome call is cancelled and its time in the shared room freed. Nothing is deleted from
--     any history.
-- Rollback: training-walkthrough-rollback.sql drops the three (what they did stays).
-- =============================================================================
create or replace function public.test_people_add(p_phone text, p_email text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $fn$
declare ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10); em text := lower(btrim(coalesce(p_email, '')));
  cur jsonb; added_p boolean := false; added_e boolean := false;
begin
  select coalesce(data->'test_people', '{}'::jsonb) into cur from public.app_data where key = 'ops_settings' for update;
  if cur is null then return jsonb_build_object('ok', false, 'reason', 'no settings'); end if;
  if length(ph) = 10 and not coalesce(cur->'phones', '[]'::jsonb) @> to_jsonb(ph) then cur := jsonb_set(cur, '{phones}', coalesce(cur->'phones', '[]'::jsonb) || to_jsonb(ph)); added_p := true; end if;
  if em like '%@%' and not coalesce(cur->'emails', '[]'::jsonb) @> to_jsonb(em) then cur := jsonb_set(cur, '{emails}', coalesce(cur->'emails', '[]'::jsonb) || to_jsonb(em)); added_e := true; end if;
  if added_p or added_e then update public.app_data set data = data || jsonb_build_object('test_people', cur), updated_at = now() where key = 'ops_settings'; end if;
  return jsonb_build_object('ok', true, 'added_phone', added_p, 'added_email', added_e);
end $fn$;
create or replace function public.test_people_remove(p_phone text, p_email text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $fn$
declare ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10); em text := lower(btrim(coalesce(p_email, ''))); cur jsonb;
begin
  select coalesce(data->'test_people', '{}'::jsonb) into cur from public.app_data where key = 'ops_settings' for update;
  if cur is null then return jsonb_build_object('ok', false); end if;
  if length(ph) = 10 then cur := jsonb_set(cur, '{phones}', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(cur->'phones', '[]'::jsonb)) x where x <> to_jsonb(ph)), '[]'::jsonb)); end if;
  if em <> '' then cur := jsonb_set(cur, '{emails}', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(cur->'emails', '[]'::jsonb)) x where lower(x #>> '{}') <> em), '[]'::jsonb)); end if;
  update public.app_data set data = data || jsonb_build_object('test_people', cur), updated_at = now() where key = 'ops_settings';
  return jsonb_build_object('ok', true);
end $fn$;
create or replace function public.tw_card_hit(x jsonb, p_offer text, cids text[], names text[], jids text[])
returns boolean language sql immutable set search_path = pg_catalog, public, pg_temp as $fn$
  select strpos(x::text, p_offer) > 0
      or exists (select 1 from unnest(jids) q where length(q) >= 30 and strpos(x::text, q) > 0)
      or coalesce(x->>'candidate_id', x->>'cand_id', '') = any(cids)
      or exists (select 1 from unnest(names) q where q ilike '%(TRAINING)%' and strpos(x::text, q) > 0)
$fn$;
create or replace function public.training_walkthrough_close(p_offer_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp set lock_timeout = '5s' as $fn$
declare k text; n_rec int := 0; n int; cids text[] := '{}'; names text[] := '{}'; jids text[] := '{}'; j uuid; n_cards int := 0; n_wc int := 0; w record;
begin
  if coalesce(p_offer_id, '') = '' then raise exception 'training_walkthrough_close: which offer?' using errcode = '22023'; end if;
  foreach k in array array['candidates', 'caregivers'] loop
    cids := cids || coalesce((select array_agg(coalesce(x->>'candidate_id', x->>'id')) from public.app_data a, jsonb_array_elements(a.data) x
     where a.key = k and x->>'offer_id' = p_offer_id and coalesce(x->>'last', '') ilike '%(TRAINING)%'), '{}'::text[]);
    names := names || coalesce((select array_agg(btrim(coalesce(x->>'first', '') || ' ' || coalesce(x->>'last', ''))) from public.app_data a, jsonb_array_elements(a.data) x
     where a.key = k and x->>'offer_id' = p_offer_id and coalesce(x->>'last', '') ilike '%(TRAINING)%'), '{}'::text[]);
    update public.app_data set data = (select coalesce(jsonb_agg(x order by i), '[]'::jsonb) from jsonb_array_elements(data) with ordinality e(x, i)
      where not (x->>'offer_id' = p_offer_id and coalesce(x->>'last', '') ilike '%(TRAINING)%')), updated_at = now()
     where key = k and exists (select 1 from jsonb_array_elements(data) x where x->>'offer_id' = p_offer_id and coalesce(x->>'last', '') ilike '%(TRAINING)%');
    get diagnostics n = row_count; n_rec := n_rec + n;
  end loop;
  for j in select journey_id from public.client_journey where subject = 'caregiver' and offer_id = p_offer_id and status <> 'closed' loop
    jids := jids || j::text;
    update public.client_journey set status = 'closed', closed_reason = left(coalesce(p_reason, 'Training walkthrough ended'), 200), updated_at = now() where journey_id = j;
    insert into public.client_journey_event (journey_id, actor_email, actor_name, kind, detail, reason) values (j, 'hub', 'Training walkthrough', 'closed', '{"training": true}', left(coalesce(p_reason, 'Training walkthrough ended'), 200));
  end loop;
  /* its cards: the offer id or a journey id anywhere on the card (both are long unique ids), a record id as the card's own
     candidate field (never a loose text match on a short number), or the "<first> (TRAINING)" name */
  update public.app_data set data = (select jsonb_agg(case when public.tw_card_hit(x, p_offer_id, cids, names, jids) and coalesce(x->>'status', '') not in ('done', 'closed', 'resolved')
      then x || jsonb_build_object('status', 'done', 'closed_at', now(), 'close_note', 'Training walkthrough ended') else x end order by i) from jsonb_array_elements(data) with ordinality e(x, i)), updated_at = now()
   where key = 'ops_items' and exists (select 1 from jsonb_array_elements(data) x where public.tw_card_hit(x, p_offer_id, cids, names, jids) and coalesce(x->>'status', '') not in ('done', 'closed', 'resolved'));
  get diagnostics n_cards = row_count;
  if to_regclass('public.welcome_calls') is not null and array_length(cids, 1) > 0 then
    for w in update public.welcome_calls set status = 'cancelled', closed_reason = 'training walkthrough ended', updated_at = now()
              where candidate_id = any(cids) and status in ('invited', 'booked', 'noshow') returning id loop
      n_wc := n_wc + 1;
      if to_regclass('public.coordinator_busy') is not null then delete from public.coordinator_busy where source = 'welcome_call' and source_id = w.id::text; end if;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'records_off_lists', n_rec, 'cards_closed', n_cards, 'welcome_calls_cancelled', n_wc);
end $fn$;
revoke all on function public.test_people_add(text, text), public.test_people_remove(text, text), public.training_walkthrough_close(text, text), public.tw_card_hit(jsonb, text, text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.test_people_add(text, text), public.test_people_remove(text, text), public.training_walkthrough_close(text, text), public.tw_card_hit(jsonb, text, text[], text[], text[]) to service_role;
insert into public.app_data (key, data) values ('training_walkthroughs', '[]'::jsonb) on conflict (key) do nothing;
do $v$ begin
  if exists (select 1 from information_schema.routine_privileges where routine_schema = 'public' and routine_name in ('test_people_add', 'test_people_remove', 'training_walkthrough_close', 'tw_card_hit') and grantee in ('anon', 'authenticated', 'PUBLIC')) then
    raise exception 'training walkthrough self-check: a browser can call a server-only door'; end if;
end $v$;
