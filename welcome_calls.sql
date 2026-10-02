-- welcome_calls.sql (Desktop 407, 2026-10-01). Remote orientation, slice 1a.
-- Samantha: once references and background checks are clear and Viventium Step 2 is done, the office presses "Invite to
-- welcome call"; the new hire books a 15-minute Google Meet welcome call (one shared Meet link for the whole office),
-- "same as interviews, but don't have them overlap with an in-person interview for now". On the call staff check the
-- I-9 documents (uploaded in Viventium Step 2), set up the AxisCare app and review the caregiver profile.
--
--   • Times: the interview hours (coordinator_availability for 'interview'), in 15-minute steps, at least 2 hours
--     ahead, up to 14 days out. ONE welcome call at a time (shared Meet room), and never overlapping an interview
--     or anything that blocks everyone (orientation sessions, office-wide blocks).
--   • A booked call writes coordinator_busy with coordinator_id NULL, which the interview booking already treats as
--     "blocks everyone", so no interview can be booked over it.
--   • The public page (cc.mo-care.com/welcome.html?w=<id>) only knows its own invitation id; everything else goes
--     through the functions below. Office staff (authenticated) read and update the table directly.
-- Run as one transaction.

create table if not exists public.welcome_calls (
  id               uuid primary key default gen_random_uuid(),
  candidate_id     text not null,                 -- the Hub's candidate record id (app_data 'candidates')
  first_name       text,
  last_name        text,
  phone            text,
  email            text,
  status           text not null default 'invited' check (status in ('invited','booked','done','noshow','cancelled')),
  starts_at        timestamptz,
  ends_at          timestamptz,
  invited_at       timestamptz not null default now(),
  invited_by       text,
  booked_at        timestamptz,
  confirmed_at     timestamptz,
  reminded_day_at  timestamptz,
  reminded_hour_at timestamptz,
  i9_checked       boolean not null default false,
  app_setup        boolean not null default false,
  profile_reviewed boolean not null default false,
  photo_link_sent  boolean not null default false,
  notes            text,
  done_at          timestamptz,
  done_by          text,
  closed_reason    text,                          -- why a call was moved or cancelled (e.g. Step 2 not done)
  updated_at       timestamptz not null default now()
);
create index if not exists welcome_calls_when_idx on public.welcome_calls (starts_at) where status = 'booked';
create index if not exists welcome_calls_cand_idx on public.welcome_calls (candidate_id);

alter table public.welcome_calls enable row level security;
revoke all on public.welcome_calls from anon;
grant select, insert, update on public.welcome_calls to authenticated;
grant all on public.welcome_calls to service_role;
drop policy if exists welcome_calls_staff on public.welcome_calls;
create policy welcome_calls_staff on public.welcome_calls for all to authenticated using (true) with check (true);

-- the one shared Google Meet room (Hub settings can change it later)
alter table public.scheduling_settings add column if not exists welcome_meet_url text;
update public.scheduling_settings set welcome_meet_url = coalesce(welcome_meet_url, 'https://meet.google.com/yqj-nzuo-tgp') where id = 1;

-- open times: interview hours, 15-minute steps, nothing overlapping an interview, a welcome call or an all-staff block
create or replace function public.welcome_open_slots()
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  with days as (select (current_date + i) as d from generate_series(0, 14) i),
  blocks as (
    select distinct ((d.d + av.start_time) at time zone 'America/Chicago') as bs,
                    ((d.d + av.end_time)   at time zone 'America/Chicago') as be
    from days d
    join public.coordinator_availability av on av.active and av.activity = 'interview'
     and av.day_of_week = extract(dow from d.d)::int
    join public.coordinators c on c.id = av.coordinator_id and c.active),
  slots as (
    select distinct b.bs + (n * interval '15 minutes') as st
    from blocks b, generate_series(0, greatest(0, (extract(epoch from (b.be - b.bs)) / 900)::int - 1)) n)
  select s.st, s.st + interval '15 minutes'
  from slots s
  where s.st > now() + interval '2 hours'
    and not exists (
      select 1 from public.coordinator_busy cb
      where (cb.coordinator_id is null or cb.source in ('interview', 'welcome_call'))
        and cb.starts_at < s.st + interval '15 minutes' and cb.ends_at > s.st)
  order by s.st;
$$;

-- what the page shows for one invitation
create or replace function public.welcome_mine(p_id uuid)
returns json language sql stable security definer set search_path to 'public' as $$
  select case when w.id is null then null else json_build_object(
    'first', w.first_name, 'status', w.status, 'starts_at', w.starts_at,
    'meet', (select welcome_meet_url from public.scheduling_settings where id = 1)) end
  from (select 1) x left join public.welcome_calls w on w.id = p_id;
$$;

-- book or move a call (the person's own invitation only)
create or replace function public.welcome_book(p_id uuid, p_starts timestamptz)
returns json language plpgsql security definer set search_path to 'public' as $$
declare w public.welcome_calls; v_label text;
begin
  select * into w from public.welcome_calls where id = p_id for update;
  if w.id is null then raise exception 'NOT_FOUND: no such invitation'; end if;
  if w.status not in ('invited', 'booked', 'noshow') then raise exception 'CLOSED: this invitation is no longer open'; end if;
  perform pg_advisory_xact_lock(hashtext('welcome_call'));     -- one booking decision at a time
  -- release their old time first so moving within the same hour works
  delete from public.coordinator_busy where source = 'welcome_call' and source_id = p_id::text;
  if not exists (select 1 from public.welcome_open_slots() s where s.starts_at = p_starts) then
    raise exception 'TAKEN: that time is no longer available';
  end if;
  v_label := 'Welcome call — ' || coalesce(w.first_name, '') || ' ' || left(coalesce(w.last_name, ''), 1) || '.';
  insert into public.coordinator_busy (coordinator_id, starts_at, ends_at, source, source_id, label)
  values (null, p_starts, p_starts + interval '15 minutes', 'welcome_call', p_id::text, v_label);
  update public.welcome_calls set status = 'booked', starts_at = p_starts, ends_at = p_starts + interval '15 minutes',
    booked_at = now(), confirmed_at = null, reminded_day_at = null, reminded_hour_at = null, updated_at = now()
  where id = p_id;
  return json_build_object('booked', p_starts);
end $$;

-- the person cancels their time (the invitation stays open so they can pick another)
create or replace function public.welcome_cancel(p_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  update public.welcome_calls set status = 'invited', starts_at = null, ends_at = null, closed_reason = 'cancelled by them',
    updated_at = now() where id = p_id and status = 'booked';
  delete from public.coordinator_busy where source = 'welcome_call' and source_id = p_id::text;
  return json_build_object('ok', true);
end $$;

revoke all on function public.welcome_open_slots() from public;
revoke all on function public.welcome_mine(uuid) from public;
revoke all on function public.welcome_book(uuid, timestamptz) from public;
revoke all on function public.welcome_cancel(uuid) from public;
grant execute on function public.welcome_open_slots() to anon, authenticated;
grant execute on function public.welcome_mine(uuid) to anon, authenticated;
grant execute on function public.welcome_book(uuid, timestamptz) to anon, authenticated;
grant execute on function public.welcome_cancel(uuid) to anon, authenticated;
