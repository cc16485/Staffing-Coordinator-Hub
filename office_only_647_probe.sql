-- 647 proof (rolls back): acts as an office member and as a signed-in stranger, and reports what each can do.
do $$
declare office uuid; r jsonb := '{}'; n int; ok boolean;
begin
  select ai.auth_user_id into office from public.auth_identities ai join public.staff_roles s on s.person_id = ai.person_id
   where s.entity = 'cc_ihs' and s.role = 'owner_admin' and ai.auth_user_id is not null limit 1;
  -- the office member
  perform set_config('request.jwt.claims', json_build_object('sub', office, 'role', 'authenticated', 'app_metadata', json_build_object('hub_access', json_build_array('care_coordinator')))::text, true);
  perform set_config('request.jwt.claim.sub', office::text, true);
  set local role authenticated;
  r := r || jsonb_build_object('office_applicants', (select count(*) from public.job_applicants),
    'office_bookings', (select count(*) from public.interview_bookings), 'office_recordings', (select count(*) from public.recordings),
    'office_audio', (select count(*) from storage.objects where bucket_id = 'recordings'));
  update public.job_applicants set status = status where id = (select id from public.job_applicants order by created_at desc limit 1);
  get diagnostics n = row_count; r := r || jsonb_build_object('office_can_save', n);
  reset role;
  -- a signed-in stranger (a sign-in with CC Hub access but no office role)
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000006a7', 'role', 'authenticated', 'app_metadata', json_build_object('hub_access', json_build_array('care_coordinator')))::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000006a7', true);
  set local role authenticated;
  r := r || jsonb_build_object('stranger_applicants', (select count(*) from public.job_applicants),
    'stranger_bookings', (select count(*) from public.interview_bookings), 'stranger_recordings', (select count(*) from public.recordings),
    'stranger_settings', (select count(*) from public.recordings_settings), 'stranger_audio', (select count(*) from storage.objects where bucket_id = 'recordings'));
  update public.job_applicants set status = status; get diagnostics n = row_count; r := r || jsonb_build_object('stranger_saved', n);
  begin insert into public.job_applicants (first_name) values ('probe'); ok := true; exception when others then ok := sqlerrm not ilike '%row-level security%'; end;
  r := r || jsonb_build_object('stranger_add', ok);
  begin perform public.applicant_screen_by_office('00000000-0000-0000-0000-000000000000', true, true, true); ok := true;
  exception when others then ok := sqlerrm not like '%office staff only%'; end;
  r := r || jsonb_build_object('stranger_screen', ok);
  begin perform public.recordings_due_for_purge(); ok := true; exception when others then ok := false; end;
  r := r || jsonb_build_object('stranger_purge_list', ok);
  reset role;
  raise exception 'PROBE_RESULT: %', r;
end $$;
