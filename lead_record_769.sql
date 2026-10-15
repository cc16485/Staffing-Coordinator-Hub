-- 769 · calls and texts with a lead record themselves (Samantha 2026-10-15, approved mockup Part 2:
--   https://claude.ai/artifact/MhFEgbLXTzmPCbegzHVv49). Safe to run again.
--
-- 1. lead_record_seen: each GoHighLevel call or text the recorder has looked at, once per mode (practice / live).
--    What it did with it (recorded, would_record, already, waiting, several, skipped), which lead, a short line.
--    No message text is kept here beyond the one-line history wording. Office staff read it (the Hub shows the
--    practice list and the "Couldn't tell whose" list); only the server writes it, except the one pick below.
-- 2. lead_record_state: how far back the conversation scan has reached, one row per mode (so going live scans
--    from lead_record_since again and catches up the practice days).
-- 3. lead_put_if_same(id, before, after): replaces ONE lead only if it is still exactly what the recorder read, so a
--    save from the Hub in between is never overwritten (the recorder reads again and redoes it). Server only.
-- 4. app_data_item_get(key, id): one record, read as the signed-in person (their own access rules apply). The Hub
--    uses it before saving a lead, to keep events the recorder added since the page loaded.
-- 5. lead_record_pick(message_id, lead_id): office staff answer "whose was this?" for a number shared by two leads.
--    It only marks the row; the Hub records the call on the chosen lead the same way Log a call does.

create table if not exists public.lead_record_seen (
  message_id text not null,
  mode text not null check (mode in ('practice', 'live')),
  msg_at timestamptz not null,
  kind text not null,
  status text not null check (status in ('recorded', 'would_record', 'already', 'waiting', 'several', 'skipped', 'picked', 'error')),
  lead_id text,
  candidates jsonb not null default '[]'::jsonb,
  line text,
  ev jsonb,
  note text,
  tries int not null default 0,
  seen_at timestamptz not null default now(),
  picked_by text,
  primary key (message_id, mode)
);
create index if not exists lead_record_seen_at on public.lead_record_seen (msg_at desc);
create index if not exists lead_record_seen_status on public.lead_record_seen (status) where status in ('waiting', 'several');
alter table public.lead_record_seen enable row level security;
revoke all on public.lead_record_seen from public, anon, authenticated;
grant select on public.lead_record_seen to authenticated;
grant all on public.lead_record_seen to service_role;
drop policy if exists lead_record_seen_read on public.lead_record_seen;
create policy lead_record_seen_read on public.lead_record_seen for select to authenticated using (public.can_access_data_key('leads'));

create table if not exists public.lead_record_state (
  mode text primary key check (mode in ('practice', 'live')),
  scanned_to timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.lead_record_state enable row level security;
revoke all on public.lead_record_state from public, anon, authenticated;
grant all on public.lead_record_state to service_role;

create or replace function public.lead_put_if_same(p_id text, p_before jsonb, p_after jsonb) returns boolean
language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $f$
declare idx int; cur jsonb;
begin
  if coalesce(p_id, '') = '' or coalesce(p_after->>'id', '') <> p_id then raise exception 'lead id mismatch'; end if;
  perform 1 from public.app_data where key = 'leads' for update;
  select i - 1, x into idx, cur from public.app_data a, jsonb_array_elements(a.data) with ordinality e(x, i)
   where a.key = 'leads' and x->>'id' = p_id limit 1;
  if idx is null or cur is distinct from p_before then return false; end if;
  update public.app_data set data = jsonb_set(data, array[idx::text], p_after), updated_at = now() where key = 'leads';
  return true;
end $f$;
revoke all on function public.lead_put_if_same(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.lead_put_if_same(text, jsonb, jsonb) to service_role;

create or replace function public.app_data_item_get(p_key text, p_id text) returns jsonb
language sql stable security invoker set search_path = pg_catalog, public, pg_temp as $f$
  select x from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) x
   where a.key = p_key and x->>'id' = p_id limit 1
$f$;
revoke all on function public.app_data_item_get(text, text) from public, anon;
grant execute on function public.app_data_item_get(text, text) to authenticated, service_role;

create or replace function public.lead_record_pick(p_message_id text, p_lead_id text) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $f$
declare n int;
begin
  if not public.can_access_data_key('leads') then raise exception 'not allowed'; end if;
  update public.lead_record_seen set status = 'picked', lead_id = nullif(p_lead_id, ''),
         picked_by = left(coalesce(auth.jwt()->>'email', ''), 120), seen_at = now()
   where message_id = p_message_id and mode = 'live' and status = 'several'
     and (coalesce(p_lead_id, '') = '' or candidates ? p_lead_id);
  get diagnostics n = row_count;
  return n = 1;
end $f$;
revoke all on function public.lead_record_pick(text, text) from public, anon;
grant execute on function public.lead_record_pick(text, text) to authenticated;
