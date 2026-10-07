-- 495 proof, inside the live database, acting as the real Krystal and the real Samantha with their own sign-ins. EVERYTHING
-- here is undone (the block always ends by raising PROBE_RESULT). It reports yes/no and counts only.
do $proof$
declare
  k_person uuid; k_uid uuid; s_person uuid; s_uid uuid; k_claims jsonb; s_claims jsonb;
  r jsonb := '{}'::jsonb; own uuid; signed uuid; n int;
begin
  select p.person_id, ai.auth_user_id into k_person, k_uid from public.persons p join public.auth_identities ai on ai.person_id = p.person_id
   where lower(p.primary_email) = 'krystal@mo-care.com' and ai.auth_user_id is not null limit 1;
  select p.person_id, ai.auth_user_id into s_person, s_uid from public.persons p join public.auth_identities ai on ai.person_id = p.person_id
   where lower(p.primary_email) = 'samantha@mo-care.com' and ai.auth_user_id is not null limit 1;
  r := jsonb_build_object('found', k_uid is not null and s_uid is not null, 'table', to_regclass('public.desk_repeats') is not null,
    'anon_can_read', has_table_privilege('anon', 'public.desk_repeats', 'select'));
  if k_uid is null or s_uid is null then raise exception 'PROBE_RESULT: %', r; end if;
  k_claims := jsonb_build_object('sub', k_uid, 'role', 'authenticated') || coalesce((select jsonb_build_object('app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb)) from auth.users u where u.id = k_uid), '{}'::jsonb);
  s_claims := jsonb_build_object('sub', s_uid, 'role', 'authenticated') || coalesce((select jsonb_build_object('app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb)) from auth.users u where u.id = s_uid), '{}'::jsonb);
  set local role authenticated;
  -- KRYSTAL sets her own repeating task
  perform set_config('request.jwt.claims', k_claims::text, true); perform set_config('request.jwt.claim.sub', k_uid::text, true);
  insert into public.desk_repeats (person_id, body, rule) values (k_person, 'Proof 495, undone', '{"kind":"weekdays"}') returning id into own;
  r := r || jsonb_build_object('k_own', own is not null);
  begin insert into public.desk_repeats (person_id, body, rule) values (s_person, 'Proof 495 on Samantha, undone', '{"kind":"daily"}'); r := r || '{"k_on_samantha_refused":false}'; exception when others then r := r || '{"k_on_samantha_refused":true}'; end;
  -- SAMANTHA sets a signed one on Krystal's desk, and cannot set an unsigned one there
  perform set_config('request.jwt.claims', s_claims::text, true); perform set_config('request.jwt.claim.sub', s_uid::text, true);
  insert into public.desk_repeats (person_id, from_person_id, body, rule) values (k_person, s_person, 'Proof 495 payroll, undone', '{"kind":"biweekly","anchor":"2026-10-09"}') returning id into signed;
  r := r || jsonb_build_object('s_signed_on_krystal', signed is not null);
  begin insert into public.desk_repeats (person_id, body, rule) values (k_person, 'Proof 495 unsigned, undone', '{"kind":"daily"}'); r := r || '{"s_unsigned_refused":false}'; exception when others then r := r || '{"s_unsigned_refused":true}'; end;
  select count(*)::int into n from public.desk_repeats where id in (own, signed); r := r || jsonb_build_object('s_reads_krystals', n);
  -- KRYSTAL: sees both, may skip a day on the signed one, may not stop or change it, may stop her own
  perform set_config('request.jwt.claims', k_claims::text, true); perform set_config('request.jwt.claim.sub', k_uid::text, true);
  select count(*)::int into n from public.desk_repeats where id in (own, signed); r := r || jsonb_build_object('k_sees_both', n);
  begin update public.desk_repeats set skips = '["2026-10-23"]'::jsonb where id = signed; r := r || '{"k_skip_signed":true}'; exception when others then r := r || '{"k_skip_signed":false}'; end;
  begin update public.desk_repeats set active = false where id = signed; r := r || '{"k_stop_signed_refused":false}'; exception when others then r := r || '{"k_stop_signed_refused":true}'; end;
  begin update public.desk_repeats set body = 'changed' where id = signed; r := r || '{"k_change_signed_refused":false}'; exception when others then r := r || '{"k_change_signed_refused":true}'; end;
  begin delete from public.desk_repeats where id = signed; r := r || jsonb_build_object('k_delete_signed_refused', not exists (select 1 from public.desk_repeats where id = signed) = false); exception when others then r := r || '{"k_delete_signed_refused":true}'; end;
  update public.desk_repeats set active = false where id = own;
  r := r || jsonb_build_object('k_stopped_own', (select stopped_at is not null and stopped_by = k_person from public.desk_repeats where id = own));
  -- SAMANTHA stops hers
  perform set_config('request.jwt.claims', s_claims::text, true); perform set_config('request.jwt.claim.sub', s_uid::text, true);
  update public.desk_repeats set active = false where id = signed;
  r := r || jsonb_build_object('s_stopped_signed', (select stopped_at is not null and stopped_by = s_person from public.desk_repeats where id = signed));
  reset role;
  raise exception 'PROBE_RESULT: %', r;
end $proof$;
