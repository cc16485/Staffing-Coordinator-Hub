-- A · ONE SHARED AXISCARE READER (Samantha, 2026-10-29: "the hub is not checking in with Axiscare enough"; her go on A and B
-- with her requirements: combine identical requests, one global request limit, urgent scheduling first, respect AxisCare's
-- retry instructions, scheduling accuracy first). Server only (service role). No browser access.
--   axis_read_log   one row per AxisCare call (and per answer served from the Hub's short-term copy), always written,
--                   switch on or off, so there is a real before/after count.
--   axis_gate       one row: the global request limit (a short window) and AxisCare's "wait" (backoff after a 429).
--   axis_cache      short-term copies of small AxisCare answers, so identical reads from different jobs make one call.
-- Everything that changes behaviour waits behind ops_settings.axis_shared_reader_live (off until she turns it on).
-- The limit numbers live in ops_settings too (axis_reader_window_s, axis_reader_max, axis_reader_urgent_reserve).

create table if not exists public.axis_read_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  job text not null,
  source text not null,            -- visits | visit | schedules | caregivers | clients | reasons | other
  priority text not null default 'normal',
  method text not null default 'GET',
  status int,                      -- AxisCare's HTTP answer; null = no answer (network)
  ok boolean not null default false,
  ms int,
  attempt int not null default 1,
  from_cache boolean not null default false,   -- answered from the Hub's short-term copy (no AxisCare call)
  coalesced boolean not null default false,    -- joined an identical read already under way (no AxisCare call)
  held boolean not null default false,         -- the Hub's own limit held it back (no AxisCare call)
  live boolean not null default false,         -- the shared reader switch was on
  waited_ms int not null default 0,
  retry_after_s numeric,
  error text
);
create index if not exists axis_read_log_at on public.axis_read_log (at);
create index if not exists axis_read_log_source_at on public.axis_read_log (source, at);

create table if not exists public.axis_gate (
  id int primary key default 1 check (id = 1),
  window_start timestamptz,
  used int not null default 0,
  backoff_until timestamptz,
  consecutive_429 int not null default 0,
  last_429_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.axis_gate (id) values (1) on conflict (id) do nothing;

create table if not exists public.axis_cache (
  key text primary key,
  body text,
  status int,
  fetched_at timestamptz,
  bytes int,
  lease_owner text,
  lease_until timestamptz
);

alter table public.axis_read_log enable row level security;
alter table public.axis_gate enable row level security;
alter table public.axis_cache enable row level security;
revoke all on public.axis_read_log, public.axis_gate, public.axis_cache from anon, authenticated;
revoke all on sequence public.axis_read_log_id_seq from anon, authenticated;
grant all on public.axis_read_log, public.axis_gate, public.axis_cache to service_role;
grant usage, select on sequence public.axis_read_log_id_seq to service_role;

-- a whole-number setting from ops_settings, or the default
create or replace function public.axis_setting_int(p_settings jsonb, p_key text, p_default int) returns int
language sql immutable as $$
  select case when coalesce(p_settings->>p_key, '') ~ '^\d{1,4}$' then (p_settings->>p_key)::int else p_default end
$$;

-- Take one slot under the global limit. urgent (Cara's scheduling reads) may use the whole window; normal leaves
-- axis_reader_urgent_reserve slots free for urgent; low uses at most half of what normal may. While AxisCare has asked
-- us to wait (backoff_until), nobody goes, urgent included. Returns {ok} or {ok:false, wait_ms, why}.
create or replace function public.axis_gate_take(p_priority text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s jsonb; g public.axis_gate; t timestamptz := clock_timestamp();
  win int; mx int; res int; cap int;
begin
  select data into s from public.app_data where key = 'ops_settings';
  win := greatest(1, public.axis_setting_int(s, 'axis_reader_window_s', 10));
  mx  := greatest(1, public.axis_setting_int(s, 'axis_reader_max', 8));
  res := least(mx - 1, greatest(0, public.axis_setting_int(s, 'axis_reader_urgent_reserve', 3)));
  cap := case p_priority when 'urgent' then mx when 'low' then greatest(1, (mx - res) / 2) else greatest(1, mx - res) end;
  select * into g from public.axis_gate where id = 1 for update;
  if not found then insert into public.axis_gate (id) values (1) returning * into g; end if;
  if g.backoff_until is not null and g.backoff_until > t then
    return jsonb_build_object('ok', false, 'wait_ms', ceil(extract(epoch from (g.backoff_until - t)) * 1000)::int, 'why', 'axiscare_asked_to_wait');
  end if;
  if g.window_start is null or t >= g.window_start + make_interval(secs => win) then
    g.window_start := t; g.used := 0;
  end if;
  if g.used >= cap then
    return jsonb_build_object('ok', false, 'wait_ms', greatest(50, ceil(extract(epoch from (g.window_start + make_interval(secs => win) - t)) * 1000)::int), 'why', 'hub_limit');
  end if;
  update public.axis_gate set window_start = g.window_start, used = g.used + 1, updated_at = t where id = 1;
  return jsonb_build_object('ok', true);
end $$;

-- Report AxisCare's answer. A 429 sets the wait: exactly what AxisCare asked for (Retry-After, at most 15 minutes), or when
-- it gave no time, 2, 4, 8 ... up to 60 seconds for each 429 in a row. Any good answer resets the count.
create or replace function public.axis_gate_report(p_status int, p_retry_after_s numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.axis_gate; t timestamptz := clock_timestamp(); n int; w numeric;
begin
  select * into g from public.axis_gate where id = 1 for update;
  if not found then insert into public.axis_gate (id) values (1) returning * into g; end if;
  if p_status = 429 then
    n := g.consecutive_429 + 1;
    w := case when p_retry_after_s is not null and p_retry_after_s > 0 then least(p_retry_after_s, 900) else least(60, 2 * power(2, n - 1)) end;
    update public.axis_gate set consecutive_429 = n, last_429_at = t, updated_at = t,
      backoff_until = greatest(coalesce(backoff_until, t), t + make_interval(secs => w::double precision)) where id = 1;
    return jsonb_build_object('wait_s', w, 'in_a_row', n);
  elsif p_status between 200 and 399 and g.consecutive_429 > 0 then
    update public.axis_gate set consecutive_429 = 0, updated_at = t where id = 1;
  end if;
  return jsonb_build_object('wait_s', 0);
end $$;

-- One reader at a time fetches a given key; the others wait for its copy (identical requests combined).
create or replace function public.axis_cache_lease(p_key text, p_owner text, p_ttl_s int) returns boolean
language plpgsql security definer set search_path = public as $$
declare got text;
begin
  insert into public.axis_cache (key, lease_owner, lease_until) values (p_key, p_owner, clock_timestamp() + make_interval(secs => p_ttl_s))
  on conflict (key) do update set lease_owner = excluded.lease_owner, lease_until = excluded.lease_until
    where public.axis_cache.lease_until is null or public.axis_cache.lease_until < clock_timestamp() or public.axis_cache.lease_owner = excluded.lease_owner
  returning lease_owner into got;
  return coalesce(got = p_owner, false);
end $$;

create or replace function public.axis_cache_put(p_key text, p_owner text, p_body text, p_status int) returns void
language sql security definer set search_path = public as $$
  insert into public.axis_cache (key, body, status, fetched_at, bytes, lease_owner, lease_until)
  values (p_key, p_body, p_status, clock_timestamp(), length(p_body), null, null)
  on conflict (key) do update set body = excluded.body, status = excluded.status, fetched_at = excluded.fetched_at, bytes = excluded.bytes,
    lease_owner = null, lease_until = null
$$;

-- give back a lease without a copy (the read failed), so the next reader does not wait for nothing
create or replace function public.axis_cache_release(p_key text, p_owner text) returns void
language sql security definer set search_path = public as $$
  update public.axis_cache set lease_owner = null, lease_until = null where key = p_key and lease_owner = p_owner
$$;

-- nightly: keep 14 days of the log, one day of copies
create or replace function public.axis_read_log_trim() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a int; b int;
begin
  delete from public.axis_read_log where at < now() - interval '14 days'; get diagnostics a = row_count;
  delete from public.axis_cache where coalesce(fetched_at, lease_until, now() - interval '2 days') < now() - interval '1 day'; get diagnostics b = row_count;
  return jsonb_build_object('log_rows_removed', a, 'copies_removed', b);
end $$;

revoke all on function public.axis_gate_take(text), public.axis_gate_report(int, numeric), public.axis_cache_lease(text, text, int),
  public.axis_cache_put(text, text, text, int), public.axis_cache_release(text, text), public.axis_read_log_trim() from public, anon, authenticated;
grant execute on function public.axis_gate_take(text), public.axis_gate_report(int, numeric), public.axis_cache_lease(text, text, int),
  public.axis_cache_put(text, text, text, int), public.axis_cache_release(text, text), public.axis_read_log_trim() to service_role;

select cron.schedule('axis-read-log-trim', '50 8 * * *', 'select public.axis_read_log_trim()');
