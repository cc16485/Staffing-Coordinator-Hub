-- 648 proof (rolls back): an office member can read and mark a review; a signed-in stranger sees none and can mark none;
-- nobody signed in can write the AI's words.
do $$
declare office uuid; app uuid; r jsonb := '{}'; n int; ok boolean; rid uuid;
begin
  select ai.auth_user_id into office from public.auth_identities ai join public.staff_roles s on s.person_id = ai.person_id
   where s.entity = 'cc_ihs' and s.role = 'owner_admin' and ai.auth_user_id is not null limit 1;
  select id into app from public.job_applicants order by created_at desc limit 1;
  insert into public.interview_reviews (applicant_id, kind, review) values (app, 'full', '{"items":[]}') returning id into rid;
  perform set_config('request.jwt.claims', json_build_object('sub', office, 'role', 'authenticated', 'app_metadata', json_build_object('hub_access', json_build_array('care_coordinator')))::text, true);
  perform set_config('request.jwt.claim.sub', office::text, true);
  set local role authenticated;
  r := r || jsonb_build_object('office_reads', (select count(*) from public.interview_reviews where id = rid));
  update public.interview_reviews set marks = '{"x":{"mark":"confirm"}}' where id = rid; get diagnostics n = row_count; r := r || jsonb_build_object('office_marks', n);
  begin update public.interview_reviews set review = '{}' where id = rid; ok := true; exception when others then ok := false; end;
  r := r || jsonb_build_object('office_rewrites_ai', ok);
  begin insert into public.interview_reviews (applicant_id, kind, review) values (app, 'full', '{}'); ok := true; exception when others then ok := false; end;
  r := r || jsonb_build_object('office_inserts', ok);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000006a8', 'role', 'authenticated', 'app_metadata', json_build_object('hub_access', json_build_array('care_coordinator')))::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000006a8', true);
  set local role authenticated;
  r := r || jsonb_build_object('stranger_reads', (select count(*) from public.interview_reviews));
  update public.interview_reviews set marks = '{}' where id = rid; get diagnostics n = row_count; r := r || jsonb_build_object('stranger_marks', n);
  reset role;
  raise exception 'PROBE_RESULT: %', r;
end $$;
