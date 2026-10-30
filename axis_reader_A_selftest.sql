-- A · database self-test, run AFTER axis_reader_A.sql, inside one transaction that is always rolled back (nothing stays).
-- Proves the limit, the urgent reserve, AxisCare's wait after a 429, combining via the lease, and the copy.
-- Prints one row: ok = true when every check passed, and the failed check names otherwise.
begin;
create temp table t_res (name text, ok boolean) on commit drop;
update public.axis_gate set window_start = null, used = 0, backoff_until = null, consecutive_429 = 0 where id = 1;
update public.app_data set data = data || '{"axis_reader_window_s": "60", "axis_reader_max": "3", "axis_reader_urgent_reserve": "1"}'::jsonb
  where key = 'ops_settings';
-- normal may take 2 (3 minus the reserve of 1), the 3rd normal waits, urgent still goes
insert into t_res select 'normal 1', (public.axis_gate_take('normal')->>'ok')::boolean;
insert into t_res select 'normal 2', (public.axis_gate_take('normal')->>'ok')::boolean;
insert into t_res select 'normal 3 waits (hub_limit)', public.axis_gate_take('normal')->>'why' = 'hub_limit';
insert into t_res select 'urgent uses the reserve', (public.axis_gate_take('urgent')->>'ok')::boolean;
insert into t_res select 'urgent 2 waits (window full)', public.axis_gate_take('urgent')->>'why' = 'hub_limit';
-- a 429 with Retry-After 30: everyone waits about 30 s, urgent too
update public.axis_gate set window_start = null, used = 0 where id = 1;
select public.axis_gate_report(429, 30);
insert into t_res select 'after a 429 urgent waits for AxisCare', public.axis_gate_take('urgent')->>'why' = 'axiscare_asked_to_wait';
insert into t_res select 'the wait is AxisCare''s 30 s', ((public.axis_gate_take('normal')->>'wait_ms')::int between 28000 and 30500);
-- no Retry-After: 2 s, then 4 s for the next 429 in a row; a good answer resets the count
update public.axis_gate set backoff_until = null where id = 1;
insert into t_res select 'no Retry-After, 2nd in a row: 4 s', (public.axis_gate_report(429, null)->>'wait_s')::numeric = 4;
select public.axis_gate_report(200, null);
insert into t_res select 'a good answer resets the count', (select consecutive_429 = 0 from public.axis_gate where id = 1);
-- combining: one lease per key; the owner's copy clears it
insert into t_res select 'first reader gets the lease', public.axis_cache_lease('/t/selftest', 'a', 15);
insert into t_res select 'second reader does not', not public.axis_cache_lease('/t/selftest', 'b', 15);
select public.axis_cache_put('/t/selftest', 'a', '{"x":1}', 200);
insert into t_res select 'the copy is kept and the lease is free', (select body = '{"x":1}' and lease_owner is null from public.axis_cache where key = '/t/selftest');
insert into t_res select 'a released lease can be taken', public.axis_cache_lease('/t/selftest', 'b', 15) and (select public.axis_cache_release('/t/selftest', 'b') is null) and public.axis_cache_lease('/t/selftest', 'c', 15);
-- the log takes a row as the server writes it
insert into public.axis_read_log (job, source, status, ok) values ('selftest', 'visits', 200, true);
insert into t_res select 'the log takes a row', exists (select 1 from public.axis_read_log where job = 'selftest');
select bool_and(ok) as ok, string_agg(name, ', ') filter (where not ok) as failed, count(*) as checks from t_res;
rollback;
