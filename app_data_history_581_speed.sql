-- 581 · speed probe, run by slice2_history_581.py BEFORE the install. NOTHING STAYS.
-- The installer sends this as ONE request: this file with the install marker line (below) replaced by the body
-- of app_data_history_581.sql (without its begin/commit). The request is one transaction and ends by raising
-- 'PROBE_RESULT: {...}', so the trial install, every timed save and every history line are rolled back.
--   before: for each watched list, save one record (a harmless marker field) through upsert_app_data_item 5 times,
--           and save the settings record 5 times, with the history as it is today (these keys not watched);
--   install the 581 watcher (inside this transaction only);
--   after:  the same saves again, now watched.
-- While it runs (a few seconds) other saves to app_data wait for it, then go through.
-- Only key names, record counts, sizes and milliseconds leave the database.
create temp table s581_t (k text, phase text, ms numeric) on commit drop;

do $before$
declare wk text; it jsonb; t0 timestamptz; i int;
begin
  foreach wk in array array['candidates', 'caregivers', 'ops_items', 'leads', 'coverage_cases', 'timekeeper_cases', 'staffing_plans', 'visit_changes'] loop
    select x into it from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) x
     where a.key = wk and jsonb_typeof(x) = 'object' and coalesce(x->>'id', '') <> '' limit 1;
    continue when it is null;
    for i in 1..5 loop
      t0 := clock_timestamp();
      if wk in ('candidates', 'caregivers') then   -- upsert_app_data_item is not their door (people_lock); time the whole-list save they use
        update public.app_data set data = (select jsonb_agg(case when x->>'id' = it->>'id' then x || jsonb_build_object('_speed_581', i) else x end order by o)
                                             from jsonb_array_elements(data) with ordinality t(x, o)) where key = wk;
      else
        perform public.upsert_app_data_item(wk, it || jsonb_build_object('_speed_581', i));
      end if;
      insert into s581_t values (wk, 'before', extract(epoch from clock_timestamp() - t0) * 1000);
    end loop;
  end loop;
  if exists (select 1 from public.app_data where key = 'ops_settings' and jsonb_typeof(data) = 'object') then
    for i in 1..5 loop
      t0 := clock_timestamp();
      update public.app_data set data = data || jsonb_build_object('_speed_581', i) where key = 'ops_settings';
      insert into s581_t values ('ops_settings', 'before', extract(epoch from clock_timestamp() - t0) * 1000);
    end loop;
  end if;
end $before$;

-- 581 INSTALL GOES HERE

do $after$
declare wk text; it jsonb; t0 timestamptz; i int; sizes jsonb; times jsonb;
begin
  foreach wk in array array['candidates', 'caregivers', 'ops_items', 'leads', 'coverage_cases', 'timekeeper_cases', 'staffing_plans', 'visit_changes'] loop
    select x into it from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) x
     where a.key = wk and jsonb_typeof(x) = 'object' and coalesce(x->>'id', '') <> '' limit 1;
    continue when it is null;
    for i in 6..10 loop
      t0 := clock_timestamp();
      if wk in ('candidates', 'caregivers') then
        update public.app_data set data = (select jsonb_agg(case when x->>'id' = it->>'id' then x || jsonb_build_object('_speed_581', i) else x end order by o)
                                             from jsonb_array_elements(data) with ordinality t(x, o)) where key = wk;
      else
        perform public.upsert_app_data_item(wk, it || jsonb_build_object('_speed_581', i));
      end if;
      insert into s581_t values (wk, 'after', extract(epoch from clock_timestamp() - t0) * 1000);
    end loop;
  end loop;
  if exists (select 1 from public.app_data where key = 'ops_settings' and jsonb_typeof(data) = 'object') then
    for i in 6..10 loop
      t0 := clock_timestamp();
      update public.app_data set data = data || jsonb_build_object('_speed_581', i) where key = 'ops_settings';
      insert into s581_t values ('ops_settings', 'after', extract(epoch from clock_timestamp() - t0) * 1000);
    end loop;
  end if;
  select coalesce(jsonb_object_agg(key, jsonb_build_object('n', case when jsonb_typeof(data) = 'array' then jsonb_array_length(data) end, 'bytes', pg_column_size(data))), '{}'::jsonb)
    into sizes from public.app_data where key in ('candidates', 'caregivers', 'ops_items', 'leads', 'coverage_cases', 'timekeeper_cases', 'staffing_plans', 'visit_changes', 'ops_settings');
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into times from (
    select k, jsonb_build_object(
      'before_med', round((percentile_cont(0.5) within group (order by ms) filter (where phase = 'before'))::numeric, 1),
      'before_max', round(max(ms) filter (where phase = 'before'), 1),
      'after_med', round((percentile_cont(0.5) within group (order by ms) filter (where phase = 'after'))::numeric, 1),
      'after_max', round(max(ms) filter (where phase = 'after'), 1),
      'lines', (select count(*) from public.app_data_item_change c where c.key = s.k and c.at >= now())) as v
      from s581_t s group by k) q;
  raise exception 'PROBE_RESULT: %', jsonb_build_object('sizes', sizes, 'times', times);
end $after$;
