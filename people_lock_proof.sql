-- 442 proof: acting as a signed-in office user, inside the live database. EVERYTHING here is undone (the block always
-- ends by raising PROBE_RESULT, which rolls it all back). Nothing about anybody is printed.
do $proof$
declare c0 jsonb; g0 jsonb; r1 text; r2 text; r3 text; r4 text; n int; ok5 jsonb; ok6 text; same_c boolean; same_g boolean;
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"proof-442@mo-care.invalid"}', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  select data into c0 from public.app_data where key = 'candidates';
  select data into g0 from public.app_data where key = 'caregivers';
  set local role authenticated;
  begin
    insert into public.app_data (key, data) values ('candidates', '[]'::jsonb) on conflict (key) do update set data = excluded.data;
    r1 := 'went in';
  exception when others then r1 := 'refused'; end;
  begin
    update public.app_data set data = '[]'::jsonb where key = 'caregivers'; get diagnostics n = row_count;
    r2 := case when n = 0 then 'refused' else 'went in' end;
  exception when others then r2 := 'refused'; end;
  begin
    delete from public.app_data where key = 'candidates'; get diagnostics n = row_count;
    r3 := case when n = 0 then 'refused' else 'went in' end;
  exception when others then r3 := 'refused'; end;
  begin
    perform public.upsert_app_data_item('caregivers', jsonb_build_object('id', 'proof-442'));
    r4 := 'went in';
  exception when others then r4 := 'refused'; end;
  begin
    ok5 := public.app_data_items_apply('caregivers', '[]'::jsonb);
  exception when others then ok5 := jsonb_build_object('ok', false, 'error', left(sqlerrm, 120)); end;
  begin
    update public.app_data set data = data where key = 'ops_items'; get diagnostics n = row_count;
    ok6 := case when n = 1 then 'allowed' else 'none' end;
  exception when others then ok6 := 'refused: ' || left(sqlerrm, 120); end;
  reset role;
  select (data is not distinct from c0) into same_c from public.app_data where key = 'candidates';
  select (data is not distinct from g0) into same_g from public.app_data where key = 'caregivers';
  raise exception 'PROBE_RESULT: %', jsonb_build_object('whole_upsert', r1, 'update', r2, 'delete', r3, 'old_item_save', r4,
    'one_person_save', ok5, 'other_list', ok6, 'candidates_same', same_c, 'caregivers_same', same_g);
end $proof$;
