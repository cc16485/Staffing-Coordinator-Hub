-- 465 proof, inside the live database, acting as the real Krystal and the real Samantha with their own sign-ins. EVERYTHING
-- here is undone (the block always ends by raising PROBE_RESULT). It reports counts, yes/no and first names only.
do $proof$
declare
  k_person uuid; k_uid uuid; s_person uuid; s_uid uuid; k_claims jsonb; s_claims jsonb;
  r jsonb := '{}'::jsonb; res jsonb; w1 uuid; w2 uuid; w3 uuid; sg uuid; n int; t text;
  owners int; desk_people int; cc_owner uuid;
  drops_for text;
begin
  select p.person_id, ai.auth_user_id into k_person, k_uid from public.persons p join public.auth_identities ai on ai.person_id = p.person_id
   where lower(p.primary_email) = 'krystal@mo-care.com' and ai.auth_user_id is not null limit 1;
  select p.person_id, ai.auth_user_id into s_person, s_uid from public.persons p join public.auth_identities ai on ai.person_id = p.person_id
   where lower(p.primary_email) = 'samantha@mo-care.com' and ai.auth_user_id is not null limit 1;
  select count(distinct person_id)::int into owners from public.staff_roles where entity = 'cc_ihs' and role = 'owner_admin';
  select count(distinct person_id)::int into desk_people from public.staff_roles where entity = 'cc_ihs' and role in ('owner_admin', 'care_coordinator', 'staffing_coordinator');
  select owner_person into cc_owner from public.domains where entity = 'cc_ihs' and code = 'client_care';
  r := jsonb_build_object('found', k_uid is not null and s_uid is not null, 'owners', owners, 'desk_people', desk_people,
    'client_care_owner', (select split_part(full_name, ' ', 1) from public.persons where person_id = cc_owner),
    'deliver_open_to_pages', has_function_privilege('authenticated', 'public.kind_word_deliver(uuid)', 'execute') or has_function_privilege('anon', 'public.kind_word_deliver(uuid)', 'execute'),
    'clip_open_to_public', has_function_privilege('anon', 'public.kind_word_clip(text,text,text,text,text,date,jsonb)', 'execute'),
    'clip_for_signed_in', has_function_privilege('authenticated', 'public.kind_word_clip(text,text,text,text,text,date,jsonb)', 'execute'));
  if k_uid is null or s_uid is null then raise exception 'PROBE_RESULT: %', r; end if;
  k_claims := jsonb_build_object('sub', k_uid, 'role', 'authenticated') || coalesce((select jsonb_build_object('app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb)) from auth.users u where u.id = k_uid), '{}'::jsonb);
  s_claims := jsonb_build_object('sub', s_uid, 'role', 'authenticated') || coalesce((select jsonb_build_object('app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb)) from auth.users u where u.id = s_uid), '{}'::jsonb);
  insert into public.kind_words (quote, who, about, source, status, suggested_by) values ('Proof 465 suggestion, undone.', 'Proof', '', 'shift_note', 'suggested', 'proof-465') returning id into sg;

  set local role authenticated;
  -- KRYSTAL clips a review (the whole company) and a compliment about a client
  perform set_config('request.jwt.claims', k_claims::text, true); perform set_config('request.jwt.claim.sub', k_uid::text, true);
  res := public.kind_word_clip('Proof review, undone.', 'A Google review', 'Caring Companions', '', 'review', current_date, null); w1 := (res->>'id')::uuid;
  res := public.kind_word_clip('Proof client compliment, undone.', 'The Proof family', 'Proof client', '', 'text', current_date, '{"type":"client","ax":"proof-465","name":"Proof client"}'::jsonb); w2 := (res->>'id')::uuid;
  begin perform public.kind_word_clip('', '', '', '', 'other', null, null); r := r || '{"empty_refused":false}'; exception when others then r := r || '{"empty_refused":true}'; end;
  begin perform public.kind_word_deliver(w1); r := r || '{"page_can_deliver":true}'; exception when others then r := r || '{"page_can_deliver":false}'; end;
  perform public.kind_word_decide(sg, true);
  -- SAMANTHA clips a compliment about a caregiver
  perform set_config('request.jwt.claims', s_claims::text, true); perform set_config('request.jwt.claim.sub', s_uid::text, true);
  res := public.kind_word_clip('Proof caregiver compliment, undone.', 'The Proof family', 'Proof caregiver', 'caregiver', 'shift_note', current_date, '{"type":"caregiver","id":"proof","name":"Proof caregiver"}'::jsonb); w3 := (res->>'id')::uuid;
  select count(*)::int into n from public.kind_word_drops where kind_word_id = w3; r := r || jsonb_build_object('s_reads_others_drops', n);
  -- KRYSTAL reads what landed on her desk
  perform set_config('request.jwt.claims', k_claims::text, true); perform set_config('request.jwt.claim.sub', k_uid::text, true);
  select count(*)::int into n from public.kind_word_drops where person_id = k_person and kind_word_id in (w1, w2, w3, sg); r := r || jsonb_build_object('k_sees_own_drops', n);
  select count(*)::int into n from public.kind_word_drops where person_id = s_person; r := r || jsonb_build_object('k_sees_samantha_drops', n);
  select count(*)::int into n from public.kind_words where id in (w1, w2, w3, sg); r := r || jsonb_build_object('k_sees_jar', n);
  reset role;
  r := r || jsonb_build_object(
    'review_to', (select count(*) from public.kind_word_drops where kind_word_id = w1), 'review_to_krystal', exists (select 1 from public.kind_word_drops where kind_word_id = w1 and person_id = k_person),
    'review_to_samantha', exists (select 1 from public.kind_word_drops where kind_word_id = w1 and person_id = s_person),
    'client_to', (select count(*) from public.kind_word_drops where kind_word_id = w2), 'client_to_samantha', exists (select 1 from public.kind_word_drops where kind_word_id = w2 and person_id = s_person),
    'caregiver_to_krystal', exists (select 1 from public.kind_word_drops where kind_word_id = w3 and person_id = k_person),
    'caregiver_to_samantha', exists (select 1 from public.kind_word_drops where kind_word_id = w3 and person_id = s_person),
    'decided_to', (select count(*) from public.kind_word_drops where kind_word_id = sg), 'all_kind', (select bool_and(status = 'kind') from public.kind_words where id in (w1, w2, w3, sg)));
  raise exception 'PROBE_RESULT: %', r;
end $proof$;
