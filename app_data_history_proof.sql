-- 418 · proof of the change history, run by safe_saves_418.py. NOTHING STAYS.
-- One DO block that always ends by raising 'PROBE_RESULT: {...}', so the whole thing is rolled back: the test saves,
-- the history lines they produce and the forced-error constraint all vanish. It acts as a signed-in browser
-- (role authenticated, a made-up proof identity) and:
--   1. saves the candidate list with one person changed (a harmless marker field), one made-up person added (with a
--      fake phone and email, to prove those are never copied) and the last three people removed;
--   2. reads back, still as that browser, the history lines the save produced (proves the read rule too);
--   3. forces the watcher to fail (a temporary rule on the history table that refuses normal lines) and saves the
--      original list back, proving the save still goes through and one 'trigger_error' line is written.
-- Real names of the three removed people never leave the database: the result only says whether a name was kept.
do $proof$
declare
  maxid bigint; cur jsonb; ids text[]; chg text; rem text[]; newdata jsonb; n1 int; n2 int;
  rows1 jsonb; rows2 jsonb; leak boolean; same boolean;
begin
  select coalesce(max(id), 0) into maxid from public.app_data_item_change;
  select data into cur from public.app_data where key = 'candidates';
  select array_agg(x->>'id' order by o) into ids
    from jsonb_array_elements(coalesce(cur, '[]'::jsonb)) with ordinality as t(x, o)
   where jsonb_typeof(x) = 'object' and coalesce(x->>'id', '') <> '';
  if coalesce(array_length(ids, 1), 0) < 4 then
    raise exception 'PROBE_RESULT: %', jsonb_build_object('skipped', 'fewer than 4 candidates with an id');
  end if;
  chg := ids[1];
  rem := ids[array_length(ids, 1) - 2 : array_length(ids, 1)];
  select coalesce(jsonb_agg(case when x->>'id' = chg then x || '{"_proof_418": "x"}'::jsonb else x end order by o), '[]'::jsonb)
    into newdata
    from jsonb_array_elements(cur) with ordinality as t(x, o)
   where not (jsonb_typeof(x) = 'object' and coalesce(x->>'id', '') = any(rem));
  newdata := newdata || jsonb_build_array(jsonb_build_object('id', 'proof-418-added', 'first', 'Proof', 'last', 'Added',
                                                              'phone', '4170000418', 'email', 'proof-418-person@invalid.test', 'ssn', '000-00-0418'));

  perform set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000418","email":"proof-418@invalid.test"}', true);
  perform set_config('request.headers', '{"referer":"https://proof-418.invalid/some/path?token=secret"}', true);

  -- 1 + 2: a real save, as a signed-in browser
  set local role authenticated;
  update public.app_data set data = newdata, updated_at = now() where key = 'candidates';
  get diagnostics n1 = row_count;
  select coalesce(jsonb_agg(jsonb_build_object('change', c.change, 'record_id', c.record_id, 'fields_changed', c.fields_changed,
           'bulk_removed', c.bulk_removed, 'actor', c.actor, 'role', c.role, 'origin', c.origin,
           'names', case when c.change = 'added' then c.names else (c.names is not null)::text end) order by c.id), '[]'::jsonb)
    into rows1 from public.app_data_item_change c where c.id > maxid;
  reset role;
  select exists (select 1 from public.app_data_item_change c where c.id > maxid
                  and (to_jsonb(c)::text like '%4170000418%' or to_jsonb(c)::text like '%proof-418-person%' or to_jsonb(c)::text like '%000-00-0418%'
                       or to_jsonb(c)::text like '%token=secret%' or to_jsonb(c)::text like '%some/path%'))
    into leak;

  -- 3: the watcher fails; the save must still go through
  alter table public.app_data_item_change add constraint proof_418_force_error check (change = 'trigger_error') not valid;
  set local role authenticated;
  update public.app_data set data = cur, updated_at = now() where key = 'candidates';
  get diagnostics n2 = row_count;
  reset role;
  select (data = cur) into same from public.app_data where key = 'candidates';
  select coalesce(jsonb_agg(jsonb_build_object('change', c.change, 'actor', c.actor, 'has_error_text', c.error is not null) order by c.id), '[]'::jsonb)
    into rows2 from public.app_data_item_change c where c.id > maxid and c.change = 'trigger_error';

  raise exception 'PROBE_RESULT: %', jsonb_build_object(
    'changed_id', chg, 'removed_ids', to_jsonb(rem), 'saved', n1, 'rows', rows1, 'leak', leak,
    'error_saved', n2, 'error_save_kept', same, 'error_rows', rows2);
end $proof$;
