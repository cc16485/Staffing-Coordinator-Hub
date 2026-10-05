-- 449 proof, inside the live database. EVERYTHING here is undone (the block always ends by raising PROBE_RESULT, which
-- rolls it all back). It reports counts and yes/no only: nothing on the board, and no room name, is printed.
do $proof$
declare
  fn_n int; a_anon boolean; a_auth boolean; a_pub boolean;
  own_su int; own_tm int; room_src text; room_hub text;
  shapes jsonb[] := array['{"app_metadata":{"hub_access":["care_coordinator"]}}', '{"hub_access":["care_coordinator"]}',
                          '{"user_metadata":{"hub_access":["care_coordinator"]}}']::jsonb[];
  s jsonb; chosen jsonb; cc_su int; cc_tm int; cc_ops int; cc_ths int; cc_write text; st_su int; n int;
begin
  select count(*)::int, coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute')), false),
         coalesce(bool_or(has_function_privilege('authenticated', p.oid, 'execute')), false),
         coalesce(bool_or(has_function_privilege('public', p.oid, 'execute')), false)
    into fn_n, a_anon, a_auth, a_pub
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'submit_standup_note_public';
  select count(*)::int into own_su from public.app_data where key = 'standup_notes';
  select count(*)::int into own_tm from public.app_data where key = 'team_meetings';
  select x->>'room_name' into room_src from public.app_data t, jsonb_array_elements(case when jsonb_typeof(t.data) = 'array' then t.data else '[]'::jsonb end) x
   where t.key = 'team_hub_settings' and x->>'id' = 'video_room' limit 1;
  select data->'team_video_room'->>'room_name' into room_hub from public.app_data where key = 'ops_settings' and jsonb_typeof(data) = 'object';
  -- act as a signed-in person whose only hub is the CC Hub (whichever way this database reads the hub list)
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  foreach s in array shapes loop
    perform set_config('request.jwt.claims', (s || '{"role":"authenticated","email":"proof-449@mo-care.invalid"}'::jsonb)::text, true);
    if public.jwt_hub_access() is not null and public.jwt_hub_access() ? 'care_coordinator' and not (public.jwt_hub_access() ? 'team_hub') then
      chosen := s; exit;
    end if;
  end loop;
  if chosen is not null then
    set local role authenticated;
    select count(*)::int into cc_su from public.app_data where key = 'standup_notes';
    select count(*)::int into cc_tm from public.app_data where key = 'team_meetings';
    select count(*)::int into cc_ops from public.app_data where key = 'ops_settings';
    select count(*)::int into cc_ths from public.app_data where key = 'team_hub_settings';
    begin
      perform public.upsert_app_data_item('standup_notes', '{"id":"proof-449","summary":"proof, undone"}'::jsonb);
      select count(*)::int into n from public.app_data, jsonb_array_elements(data) x where key = 'standup_notes' and x->>'id' = 'proof-449';
      cc_write := case when n = 1 then 'went in' else 'not there after saving' end;
    exception when others then cc_write := 'refused: ' || left(sqlerrm, 120); end;
    -- someone with only the old Staffing hub still can't see the board
    perform set_config('request.jwt.claims', (replace(chosen::text, 'care_coordinator', 'staffing')::jsonb || '{"role":"authenticated","email":"proof-449@mo-care.invalid"}'::jsonb)::text, true);
    select count(*)::int into st_su from public.app_data where key = 'standup_notes';
    reset role;
  end if;
  raise exception 'PROBE_RESULT: %', jsonb_build_object(
    'functions', fn_n, 'anon_can_call', a_anon, 'signed_in_can_call', a_auth, 'everyone_can_call', a_pub,
    'claim_read', chosen is not null, 'board_exists', own_su, 'meetings_exist', own_tm,
    'cc_sees_board', cc_su, 'cc_sees_meetings', cc_tm, 'cc_sees_settings', cc_ops, 'cc_sees_team_hub_settings', cc_ths,
    'cc_can_add', cc_write, 'staffing_only_sees_board', st_su,
    'team_room', room_src is not null, 'room_copied_same', room_src is not null and room_hub is not distinct from room_src);
end $proof$;
