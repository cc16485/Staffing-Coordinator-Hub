-- 581 · proof of the operational change history, run by slice2_history_581.py AFTER the install. NOTHING STAYS.
-- One DO block that always ends by raising 'PROBE_RESULT: {...}', so everything is rolled back: the test saves, the
-- history lines they produce and the forced-error rule all vanish. It saves through the live door the Hub uses
-- (upsert_app_data_item) with a made-up signed-in identity in the request claims, exactly what the watcher reads:
--   1. the first work item, with a harmless marker field, as a signed-in person  -> expect ONE line, that actor;
--   2. the settings record, with a marker setting, as a signed-in person         -> expect ONE line naming it;
--   3. the second work item as a server job (role service_role, no email)        -> expect ONE line, actor 'server';
--   4. the watcher forced to fail, then a work-item save                         -> the save still goes through,
--                                                                                   one 'trigger_error' line.
-- It does not switch to the browser role, so no read rule is involved (418 proved those); what it proves is the
-- watcher on the operational keys. No record field, name or value leaves the database: only change kinds, field
-- names, actor and role.
do $proof$
declare
  maxid bigint; items jsonb; a jsonb; b jsonb; r1 jsonb; r2 jsonb; r3 jsonb; kept boolean; nerr int;
begin
  select coalesce(max(id), 0) into maxid from public.app_data_item_change;
  select data into items from public.app_data where key = 'ops_items';
  select x into a from jsonb_array_elements(case when jsonb_typeof(items) = 'array' then items else '[]'::jsonb end) with ordinality t(x, o)
   where jsonb_typeof(x) = 'object' and coalesce(x->>'id', '') <> '' order by o limit 1;
  select x into b from jsonb_array_elements(case when jsonb_typeof(items) = 'array' then items else '[]'::jsonb end) with ordinality t(x, o)
   where jsonb_typeof(x) = 'object' and coalesce(x->>'id', '') <> '' and x->>'id' <> coalesce(a->>'id', '') order by o limit 1;
  if a is null or b is null then
    raise exception 'PROBE_RESULT: %', jsonb_build_object('skipped', 'fewer than 2 work items with an id');
  end if;
  if not exists (select 1 from public.app_data where key = 'ops_settings' and jsonb_typeof(data) = 'object') then
    raise exception 'PROBE_RESULT: %', jsonb_build_object('skipped', 'no settings record');
  end if;

  -- 1: a work item, as a signed-in person
  perform set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000581","email":"proof-581@invalid.test"}', true);
  perform set_config('request.headers', '{"origin":"https://proof-581.invalid"}', true);
  perform public.upsert_app_data_item('ops_items', a || '{"_proof_581":"x"}'::jsonb);
  select coalesce(jsonb_agg(jsonb_build_object('change', c.change, 'fields_changed', c.fields_changed, 'actor', c.actor, 'role', c.role,
           'origin', c.origin, 'same_record', c.record_id = a->>'id', 'has_name', c.names is not null) order by c.id), '[]'::jsonb)
    into r1 from public.app_data_item_change c where c.id > maxid and c.key = 'ops_items';

  -- 2: the settings record, as a signed-in person
  update public.app_data set data = data || '{"_proof_581":"x"}'::jsonb where key = 'ops_settings';
  select coalesce(jsonb_agg(jsonb_build_object('change', c.change, 'fields_changed', c.fields_changed, 'actor', c.actor, 'record_id', c.record_id) order by c.id), '[]'::jsonb)
    into r2 from public.app_data_item_change c where c.id > maxid and c.key = 'ops_settings';

  -- 3: a server job
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.headers', '{}', true);
  perform public.upsert_app_data_item('ops_items', b || '{"_proof_581":"x"}'::jsonb);
  select coalesce(jsonb_agg(jsonb_build_object('change', c.change, 'fields_changed', c.fields_changed, 'actor', c.actor, 'role', c.role) order by c.id), '[]'::jsonb)
    into r3 from public.app_data_item_change c where c.id > maxid and c.key = 'ops_items' and c.record_id = b->>'id';

  -- 4: the watcher fails; the save must still go through
  alter table public.app_data_item_change add constraint proof_581_force_error check (change = 'trigger_error') not valid;
  perform public.upsert_app_data_item('ops_items', a || '{"_proof_581":"y"}'::jsonb);
  select exists (select 1 from public.app_data, jsonb_array_elements(data) x where key = 'ops_items' and x->>'id' = a->>'id' and x->>'_proof_581' = 'y') into kept;
  select count(*) into nerr from public.app_data_item_change c where c.id > maxid and c.change = 'trigger_error' and c.key = 'ops_items';

  raise exception 'PROBE_RESULT: %', jsonb_build_object('item_rows', r1, 'settings_rows', r2, 'server_rows', r3, 'error_saved', kept, 'error_rows', nerr);
end $proof$;
