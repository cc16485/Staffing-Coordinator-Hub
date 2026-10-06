-- 463 proof, inside the live database, acting as the real Krystal (Care Coordinator) and the real Samantha (Owner) with
-- their own sign-in details. EVERYTHING here is undone: the block always ends by raising PROBE_RESULT, which rolls it
-- all back. It reports yes/no, counts and first names only. No desk holds anything before Stage 1, and nothing is kept.
do $proof$
declare
  k_person uuid; k_uid uuid; s_person uuid; s_uid uuid;
  k_claims jsonb; s_claims jsonb; k_staff jsonb;
  l1 uuid; l2 uuid; n1 uuid; kw uuid; n int; t text;
  r jsonb := '{}'::jsonb;
  tabs text[] := array['desk_lines','desk_stickies','desk_pages','desk_settings','desk_visits','kind_words','kind_word_drops'];
  team jsonb;
begin
  -- who is who (by work email, never printed)
  select p.person_id, ai.auth_user_id into k_person, k_uid from public.persons p join public.auth_identities ai on ai.person_id = p.person_id
   where lower(p.primary_email) = 'krystal@mo-care.com' and ai.auth_user_id is not null limit 1;
  select p.person_id, ai.auth_user_id into s_person, s_uid from public.persons p join public.auth_identities ai on ai.person_id = p.person_id
   where lower(p.primary_email) = 'samantha@mo-care.com' and ai.auth_user_id is not null limit 1;
  r := r || jsonb_build_object('found_krystal', k_uid is not null, 'found_samantha', s_uid is not null,
    'samantha_owner', exists (select 1 from public.staff_roles where person_id = s_person and entity = 'cc_ihs' and role = 'owner_admin'),
    'krystal_owner', exists (select 1 from public.staff_roles where person_id = k_person and entity = 'cc_ihs' and role = 'owner_admin'),
    'krystal_coordinator', exists (select 1 from public.staff_roles where person_id = k_person and entity = 'cc_ihs' and role = 'care_coordinator'));

  -- the team as the database sees it: first name, Hub roles, a CC Hub sign-in or not
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into team from (
    select jsonb_build_object('name', split_part(p.full_name, ' ', 1),
      'roles', coalesce((select jsonb_agg(sr.role order by sr.role) from public.staff_roles sr where sr.person_id = p.person_id and sr.entity = 'cc_ihs'), '[]'::jsonb),
      'login', exists (select 1 from public.auth_identities ai where ai.person_id = p.person_id and ai.auth_user_id is not null),
      'cc_hub', exists (select 1 from public.auth_identities ai join auth.users u on u.id = ai.auth_user_id
                         where ai.person_id = p.person_id and (u.raw_app_meta_data->'hub_access' is null or u.raw_app_meta_data->'hub_access' ? 'care_coordinator'))) x
      from public.persons p
     where p.active and (exists (select 1 from public.staff_roles sr where sr.person_id = p.person_id and sr.entity = 'cc_ihs')
            or p.full_name ilike 'angiel%' or p.full_name ilike 'zach%')) q;
  r := r || jsonb_build_object('team', team);

  -- the browser's privileges: nothing for the public key; no TRUNCATE, REFERENCES or TRIGGER for anyone signed in
  r := r || jsonb_build_object(
    'anon_anything', (select bool_or(has_table_privilege('anon', 'public.' || x, 'SELECT') or has_table_privilege('anon', 'public.' || x, 'INSERT')
                         or has_table_privilege('anon', 'public.' || x, 'UPDATE') or has_table_privilege('anon', 'public.' || x, 'DELETE')
                         or has_table_privilege('anon', 'public.' || x, 'TRUNCATE')) from unnest(tabs) x),
    'signed_in_bulk', (select bool_or(has_table_privilege('authenticated', 'public.' || x, 'TRUNCATE') or has_table_privilege('authenticated', 'public.' || x, 'REFERENCES')
                         or has_table_privilege('authenticated', 'public.' || x, 'TRIGGER')) from unnest(tabs) x),
    'anon_functions', (select bool_or(has_function_privilege('anon', p.oid, 'execute')) from pg_proc p
                        where p.pronamespace = 'public'::regnamespace and (p.proname like 'desk\_%' or p.proname like 'kind\_word\_%')),
    'tidy_signed_in', has_function_privilege('authenticated', 'public.desk_tidy()', 'execute'),
    'rls_on', (select bool_and(c.relrowsecurity) from pg_class c where c.oid = any (select ('public.' || x)::regclass from unnest(tabs) x)));

  if k_uid is null or s_uid is null then raise exception 'PROBE_RESULT: %', r; end if;

  k_claims := jsonb_build_object('sub', k_uid, 'role', 'authenticated', 'aud', 'authenticated')
           || coalesce((select jsonb_build_object('app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb), 'user_metadata', coalesce(u.raw_user_meta_data, '{}'::jsonb), 'email', u.email) from auth.users u where u.id = k_uid), '{}'::jsonb);
  s_claims := jsonb_build_object('sub', s_uid, 'role', 'authenticated', 'aud', 'authenticated')
           || coalesce((select jsonb_build_object('app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb), 'user_metadata', coalesce(u.raw_user_meta_data, '{}'::jsonb), 'email', u.email) from auth.users u where u.id = s_uid), '{}'::jsonb);
  k_staff := jsonb_set(k_claims, '{app_metadata}', coalesce(k_claims->'app_metadata', '{}'::jsonb) || '{"hub_access":["staffing"]}'::jsonb);

  -- a suggestion from the Hub, made the way the server would (not as anyone)
  insert into public.kind_words (quote, who, about, source, status, suggested_by) values ('Proof 463, undone.', 'Proof', 'Proof', 'other', 'suggested', 'proof-463') returning id into kw;

  set local role authenticated;

  -- ── KRYSTAL ──
  perform set_config('request.jwt.claims', k_claims::text, true); perform set_config('request.jwt.claim.sub', k_uid::text, true);
  r := r || jsonb_build_object('k_is_me', public.desk_me() = k_person, 'k_hub_ok', public.desk_hub_ok(), 'k_is_owner', public.desk_is_owner());
  begin insert into public.desk_lines (person_id, place, day, body) values (k_person, 'day', current_date, 'proof line, undone') returning id into l1; r := r || '{"k_add_own":"went in"}';
  exception when others then r := r || jsonb_build_object('k_add_own', 'refused: ' || left(sqlerrm, 100)); end;
  begin insert into public.desk_lines (person_id, place, day, body) values (s_person, 'day', current_date, 'proof'); r := r || '{"k_add_samantha":"went in"}';
  exception when others then r := r || '{"k_add_samantha":"refused"}'; end;
  begin insert into public.desk_stickies (person_id, color, body) values (k_person, 'pink', 'proof sticky'); r := r || '{"k_sticky_own":"went in"}';
  exception when others then r := r || jsonb_build_object('k_sticky_own', 'refused: ' || left(sqlerrm, 100)); end;
  begin update public.desk_lines set owner_star_by = k_person where id = l1; r := r || '{"k_self_star":"went in"}';
  exception when others then r := r || '{"k_self_star":"refused"}'; end;
  begin perform public.desk_set_has_desk(k_person, true); r := r || '{"k_switch_desk":"went in"}';
  exception when others then r := r || '{"k_switch_desk":"refused"}'; end;

  -- ── SAMANTHA ──
  perform set_config('request.jwt.claims', s_claims::text, true); perform set_config('request.jwt.claim.sub', s_uid::text, true);
  r := r || jsonb_build_object('s_is_owner', public.desk_is_owner());
  begin insert into public.desk_lines (person_id, place, day, body, done_at) values (s_person, 'day', current_date, 'proof line, undone', now()) returning id into l2; r := r || '{"s_add_own":"went in"}';
  exception when others then r := r || jsonb_build_object('s_add_own', 'refused: ' || left(sqlerrm, 100)); end;
  select count(*)::int into n from public.desk_lines where id = l1; r := r || jsonb_build_object('s_reads_krystal', n);
  update public.desk_lines set body = 'changed by proof' where id = l1; get diagnostics n = row_count; r := r || jsonb_build_object('s_rewrites_krystal', n);
  begin insert into public.desk_lines (person_id, place, day, body) values (k_person, 'day', current_date, 'proof'); r := r || '{"s_writes_on_krystal":"went in"}';
  exception when others then r := r || '{"s_writes_on_krystal":"refused"}'; end;
  begin insert into public.desk_stickies (person_id, color, body, from_person_id) values (k_person, 'honey', 'proof note, undone', s_person) returning id into n1; r := r || '{"s_leaves_note":"went in"}';
  exception when others then r := r || jsonb_build_object('s_leaves_note', 'refused: ' || left(sqlerrm, 100)); end;
  begin insert into public.desk_stickies (person_id, color, body, from_person_id) values (s_person, 'honey', 'proof', s_person); r := r || '{"s_signs_own_desk":"went in"}';
  exception when others then r := r || '{"s_signs_own_desk":"refused"}'; end;
  begin insert into public.desk_visits (desk_person_id, visitor_person_id, day) values (k_person, s_person, current_date); r := r || '{"s_visit":"went in"}';
  exception when others then r := r || jsonb_build_object('s_visit', 'refused: ' || left(sqlerrm, 100)); end;
  begin perform public.desk_star_line(l1, true); r := r || '{"s_star_unfinished":"went in"}';
  exception when others then r := r || '{"s_star_unfinished":"refused"}'; end;

  -- ── KRYSTAL finishes the line and answers the note ──
  perform set_config('request.jwt.claims', k_claims::text, true); perform set_config('request.jwt.claim.sub', k_uid::text, true);
  update public.desk_lines set done_at = now() where id = l1;
  select count(*)::int into n from public.desk_lines where id = l2; r := r || jsonb_build_object('k_reads_samantha', n);
  select count(*)::int into n from public.desk_stickies where id = n1; r := r || jsonb_build_object('k_sees_note', n);
  begin update public.desk_stickies set body = 'changed by proof' where id = n1; get diagnostics n = row_count; r := r || jsonb_build_object('k_rewrites_note', case when n = 1 then 'went in' else 'nothing' end);
  exception when others then r := r || '{"k_rewrites_note":"refused"}'; end;
  begin update public.desk_stickies set x = 300, y = 40, seen_at = now(), ack_at = now() where id = n1; get diagnostics n = row_count; r := r || jsonb_build_object('k_moves_answers_note', case when n = 1 then 'went in' else 'nothing' end);
  exception when others then r := r || jsonb_build_object('k_moves_answers_note', 'refused: ' || left(sqlerrm, 100)); end;
  select count(*)::int into n from public.desk_visits where desk_person_id = k_person; r := r || jsonb_build_object('k_sees_visit', n);
  begin perform public.desk_star_line(l2, true); r := r || '{"k_gives_star":"went in"}';
  exception when others then r := r || '{"k_gives_star":"refused"}'; end;
  begin insert into public.kind_words (quote, who, about, source, status, created_by) values ('Proof clip, undone.', 'Proof', 'Proof', 'other', 'kind', k_person); r := r || '{"k_clips_kind_word":"went in"}';
  exception when others then r := r || jsonb_build_object('k_clips_kind_word', 'refused: ' || left(sqlerrm, 100)); end;
  begin insert into public.kind_words (quote, status, suggested_by) values ('Proof, undone.', 'suggested', 'browser'); r := r || '{"k_fakes_suggestion":"went in"}';
  exception when others then r := r || '{"k_fakes_suggestion":"refused"}'; end;
  begin perform public.kind_word_decide(kw, true); r := r || '{"k_decides_suggestion":"went in"}';
  exception when others then r := r || jsonb_build_object('k_decides_suggestion', 'refused: ' || left(sqlerrm, 100)); end;

  -- ── SAMANTHA stars the finished line and edits her own note ──
  perform set_config('request.jwt.claims', s_claims::text, true); perform set_config('request.jwt.claim.sub', s_uid::text, true);
  begin perform public.desk_star_line(l1, true); r := r || '{"s_star_finished":"went in"}';
  exception when others then r := r || jsonb_build_object('s_star_finished', 'refused: ' || left(sqlerrm, 100)); end;
  begin update public.desk_stickies set body = 'proof note, edited' where id = n1; get diagnostics n = row_count; r := r || jsonb_build_object('s_edits_own_note', case when n = 1 then 'went in' else 'nothing' end);
  exception when others then r := r || jsonb_build_object('s_edits_own_note', 'refused: ' || left(sqlerrm, 100)); end;
  begin update public.desk_stickies set seen_at = now() + interval '1 hour' where id = n1; r := r || '{"s_marks_seen":"went in"}';
  exception when others then r := r || '{"s_marks_seen":"refused"}'; end;

  -- ── KRYSTAL with only the old Staffing hub on her sign-in ──
  perform set_config('request.jwt.claims', k_staff::text, true); perform set_config('request.jwt.claim.sub', k_uid::text, true);
  select count(*)::int into n from public.desk_lines where id = l1; r := r || jsonb_build_object('staffing_only_reads', n);

  reset role;
  r := r || jsonb_build_object('star_landed', (select owner_star_by = s_person from public.desk_lines where id = l1),
                               'note_words_kept', (select body from public.desk_stickies where id = n1) = 'proof note, edited',
                               'decided', (select status from public.kind_words where id = kw));
  raise exception 'PROBE_RESULT: %', r;
end $proof$;
