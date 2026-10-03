-- 421 · proof of the per-person save, run by safe_saves_421.py. NOTHING STAYS.
-- One DO block that always ends by raising 'PROBE_RESULT: {...}', so everything it does is rolled back: the test
-- saves, the history lines and refusal lines they leave, and the counter. It acts as a signed-in browser (role
-- authenticated, a made-up proof identity) on the real candidate list and:
--   1. adds a made-up person: the database gives a fresh number, above every number used before;
--   2. changes person A (a harmless marker field) based on the _rev it read: saved, A's _rev goes up by 1;
--      then sends a second change to A still based on the OLD _rev (a page that opened earlier): refused, nothing saved;
--   3. two pages each change a different person (B and C), each based on what it read: both saved;
--   4. removes A, B and C in one save: refused (more than 2), nothing saved;
--   5. the same call as anon: refused;
--   6. reads the 418 history and the refusal log lines these left.
-- (While acting as the browser it reads _rev directly: the internal helper app_data_rev is not callable by browsers.)
-- Only record numbers, counters and yes/no answers leave the database; never a name or any other field.
do $proof$
declare
  cur jsonb; v0 bigint; ids text[]; a text; b text; c text; maxid bigint; counter0 bigint; hmax bigint; clmax bigint;
  ra bigint; rb bigint; rc bigint; ra_after bigint;
  r_add jsonb; r_put1 jsonb; r_stale jsonb; r_b jsonb; r_c jsonb; r_bulk jsonb; new_id bigint;
  data_after_stale jsonb; data_after_bulk jsonb; same_after_stale boolean; same_after_bulk boolean;
  added_ok boolean; v_end bigint; anon_refused boolean := false; hist jsonb; clog jsonb;
begin
  select data, version into cur, v0 from public.app_data where key = 'candidates';
  select array_agg(i order by o) into ids from (
    select x->>'id' as i, min(o) as o from jsonb_array_elements(coalesce(cur, '[]'::jsonb)) with ordinality t(x, o)
     where jsonb_typeof(x) = 'object' and (x->>'id') ~ '^[0-9]{1,15}$' group by x->>'id' having count(*) = 1) s;
  if coalesce(array_length(ids, 1), 0) < 3 then
    raise exception 'PROBE_RESULT: %', jsonb_build_object('skipped', 'fewer than 3 candidates with their own number');
  end if;
  a := ids[1]; b := ids[2]; c := ids[3];
  select coalesce(max((x->>'id')::bigint), 0) into maxid from jsonb_array_elements(cur) x where jsonb_typeof(x) = 'object' and (x->>'id') ~ '^[0-9]{1,15}$';
  select coalesce((select last_id from public.app_data_id_counter where key = 'candidates'), 0) into counter0;
  select coalesce(max(id), 0) into hmax from public.app_data_item_change;
  select coalesce(max(id), 0) into clmax from public.app_data_conflict_log;
  select public.app_data_rev(x) into ra from jsonb_array_elements(cur) x where x->>'id' = a;
  select public.app_data_rev(x) into rb from jsonb_array_elements(cur) x where x->>'id' = b;
  select public.app_data_rev(x) into rc from jsonb_array_elements(cur) x where x->>'id' = c;

  perform set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000421","email":"proof-421@invalid.test"}', true);
  perform set_config('request.headers', '{"origin":"https://proof-421.invalid"}', true);
  set local role authenticated;

  -- 1. add
  r_add := public.app_data_items_apply('candidates', jsonb_build_array(jsonb_build_object('op', 'add', 'tmp', '-1',
             'record', jsonb_build_object('first', 'Proof', 'last', 'Four21', 'id', 10, '_rev', 7))));
  new_id := (r_add->'ids'->>'-1')::bigint;
  select exists (select 1 from public.app_data d, jsonb_array_elements(d.data) x where d.key = 'candidates'
                  and (x->>'id')::text = new_id::text and x->>'last' = 'Four21' and not x ? '_rev') into added_ok;

  -- 2. a change based on what was read, then a second one still based on the old _rev
  r_put1 := public.app_data_items_apply('candidates', jsonb_build_array(jsonb_build_object('op', 'put', 'id', a, 'base_rev', ra,
              'record', (select x || '{"_proof_421": 1}'::jsonb from jsonb_array_elements(cur) x where x->>'id' = a))));
  select coalesce((x->>'_rev')::bigint, 0) into ra_after from public.app_data d, jsonb_array_elements(d.data) x where d.key = 'candidates' and x->>'id' = a;
  select data into data_after_stale from public.app_data where key = 'candidates';
  r_stale := public.app_data_items_apply('candidates', jsonb_build_array(jsonb_build_object('op', 'put', 'id', a, 'base_rev', ra,
              'record', (select x || '{"_proof_421": 2}'::jsonb from jsonb_array_elements(cur) x where x->>'id' = a))));
  select (data = data_after_stale) into same_after_stale from public.app_data where key = 'candidates';

  -- 3. two pages, two different people, each based on what it read
  r_b := public.app_data_items_apply('candidates', jsonb_build_array(jsonb_build_object('op', 'put', 'id', b, 'base_rev', rb,
           'record', (select x || '{"_proof_421": "b"}'::jsonb from jsonb_array_elements(cur) x where x->>'id' = b))));
  r_c := public.app_data_items_apply('candidates', jsonb_build_array(jsonb_build_object('op', 'put', 'id', c, 'base_rev', rc,
           'record', (select x || '{"_proof_421": "c"}'::jsonb from jsonb_array_elements(cur) x where x->>'id' = c))));

  -- 4. three removed in one save
  select data into data_after_bulk from public.app_data where key = 'candidates';
  r_bulk := public.app_data_items_apply('candidates', (select jsonb_agg(jsonb_build_object('op', 'remove', 'id', x->>'id', 'base_rev', coalesce((x->>'_rev')::bigint, 0)))
              from public.app_data d, jsonb_array_elements(d.data) x where d.key = 'candidates' and x->>'id' in (a, b, c)));
  select (data = data_after_bulk) into same_after_bulk from public.app_data where key = 'candidates';
  select version into v_end from public.app_data where key = 'candidates';
  reset role;

  -- 5. anon
  begin
    set local role anon;
    perform public.app_data_items_apply('candidates', '[{"op":"add","tmp":"x","record":{"first":"Anon"}}]'::jsonb);
  exception when insufficient_privilege then anon_refused := true;
  end;
  reset role;

  -- 6. what the history and the refusal log recorded
  select coalesce(jsonb_agg(jsonb_build_object('change', h.change, 'record_id', h.record_id, 'actor', h.actor) order by h.id), '[]'::jsonb)
    into hist from public.app_data_item_change h where h.id > hmax;
  select coalesce(jsonb_agg(jsonb_build_object('reason', l.reason, 'ids', l.ids, 'actor', l.actor) order by l.id), '[]'::jsonb)
    into clog from public.app_data_conflict_log l where l.id > clmax;

  raise exception 'PROBE_RESULT: %', jsonb_build_object(
    'a', a, 'b', b, 'c', c, 'max_before', maxid, 'counter_before', counter0, 'version_before', v0, 'version_after', v_end,
    'add_ok', r_add->'ok', 'new_id', new_id, 'added_present', added_ok,
    'put1_ok', r_put1->'ok', 'rev_before', ra, 'rev_after', ra_after, 'put1_rev', r_put1->'revs'->a,
    'stale_ok', r_stale->'ok', 'stale_reason', r_stale->'reason', 'stale_conflict_ids', (select jsonb_agg(x->'id') from jsonb_array_elements(r_stale->'conflicts') x),
    'stale_current_rev', (select public.app_data_rev(x->'current_record') from jsonb_array_elements(r_stale->'conflicts') x limit 1),
    'stale_nothing_saved', same_after_stale,
    'b_ok', r_b->'ok', 'c_ok', r_c->'ok',
    'bulk_ok', r_bulk->'ok', 'bulk_reason', r_bulk->'reason', 'bulk_nothing_saved', same_after_bulk,
    'anon_refused', anon_refused, 'history', hist, 'refusals', clog);
end $proof$;
