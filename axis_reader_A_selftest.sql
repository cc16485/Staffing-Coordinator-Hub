-- A · database self-test, run AFTER axis_reader_A.sql. One block that always ends by raising AXISTEST_A <result>, so
-- everything it did is undone (nothing stays). The result is {"ok": true|false, "failed": [names], "checks": n}.
-- Proves the limit, the urgent reserve, AxisCare's wait after a 429, combining via the lease, the copy and the log.
do $$
declare res jsonb := '[]'::jsonb; r jsonb;
  procedure_ok boolean;
begin
  update public.axis_gate set window_start = null, used = 0, backoff_until = null, consecutive_429 = 0 where id = 1;
  update public.app_data set data = data || '{"axis_reader_window_s": "60", "axis_reader_max": "3", "axis_reader_urgent_reserve": "1"}'::jsonb
    where key = 'ops_settings';
  -- normal may take 2 (3 minus the reserve of 1), the 3rd normal waits, urgent still goes
  res := res || jsonb_build_object('n', 'normal 1', 'ok', (public.axis_gate_take('normal')->>'ok')::boolean);
  res := res || jsonb_build_object('n', 'normal 2', 'ok', (public.axis_gate_take('normal')->>'ok')::boolean);
  res := res || jsonb_build_object('n', 'normal 3 waits (hub_limit)', 'ok', public.axis_gate_take('normal')->>'why' = 'hub_limit');
  res := res || jsonb_build_object('n', 'urgent uses the reserve', 'ok', (public.axis_gate_take('urgent')->>'ok')::boolean);
  res := res || jsonb_build_object('n', 'urgent 2 waits (window full)', 'ok', public.axis_gate_take('urgent')->>'why' = 'hub_limit');
  -- a 429 with Retry-After 30: everyone waits about 30 s, urgent too
  update public.axis_gate set window_start = null, used = 0 where id = 1;
  perform public.axis_gate_report(429, 30);
  res := res || jsonb_build_object('n', 'after a 429 urgent waits for AxisCare', 'ok', public.axis_gate_take('urgent')->>'why' = 'axiscare_asked_to_wait');
  res := res || jsonb_build_object('n', 'the wait is AxisCare''s 30 s', 'ok', ((public.axis_gate_take('normal')->>'wait_ms')::int between 28000 and 30500));
  -- no Retry-After: 2 s, then 4 s for the next 429 in a row; a good answer resets the count
  update public.axis_gate set backoff_until = null where id = 1;
  res := res || jsonb_build_object('n', 'no Retry-After, 2nd in a row: 4 s', 'ok', (public.axis_gate_report(429, null)->>'wait_s')::numeric = 4);
  perform public.axis_gate_report(200, null);
  res := res || jsonb_build_object('n', 'a good answer resets the count', 'ok', (select consecutive_429 = 0 from public.axis_gate where id = 1));
  -- combining: one lease per key; the owner's copy clears it
  res := res || jsonb_build_object('n', 'first reader gets the lease', 'ok', public.axis_cache_lease('/t/selftest', 'a', 15));
  res := res || jsonb_build_object('n', 'second reader does not', 'ok', not public.axis_cache_lease('/t/selftest', 'b', 15));
  perform public.axis_cache_put('/t/selftest', 'a', '{"x":1}', 200);
  res := res || jsonb_build_object('n', 'the copy is kept and the lease is free', 'ok', (select body = '{"x":1}' and lease_owner is null from public.axis_cache where key = '/t/selftest'));
  procedure_ok := public.axis_cache_lease('/t/selftest', 'b', 15);
  perform public.axis_cache_release('/t/selftest', 'b');
  res := res || jsonb_build_object('n', 'a released lease can be taken', 'ok', procedure_ok and public.axis_cache_lease('/t/selftest', 'c', 15));
  -- the log takes a row as the server writes it
  insert into public.axis_read_log (job, source, status, ok) values ('selftest', 'visits', 200, true);
  res := res || jsonb_build_object('n', 'the log takes a row', 'ok', exists (select 1 from public.axis_read_log where job = 'selftest'));
  select jsonb_build_object('ok', bool_and(coalesce((x->>'ok')::boolean, false)),
    'failed', coalesce(jsonb_agg(x->>'n') filter (where not coalesce((x->>'ok')::boolean, false)), '[]'::jsonb), 'checks', count(*))
    into r from jsonb_array_elements(res) x;
  raise exception 'AXISTEST_A %', r::text;
end $$;
