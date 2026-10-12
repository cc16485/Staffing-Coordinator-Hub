-- 623 · PHONE NOTIFICATIONS (Samantha 2026-10-12, "build 6-8", item 7). Which phones get a CC Office notification.
-- A person turns it on for their own phone (CC Office → More); each row is one phone. Nobody can see or change anybody
-- else's phones. The notification itself carries no names or details (it says "Something needs you in CC Office"), so
-- nothing about a client or caregiver passes through Apple's or Google's push service.
-- push_notified: which Act Now items a phone was already told about (server only), so nobody is told twice.
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  endpoint    text not null unique,
  p256dh      text,
  auth        text,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  last_error  text,
  failures    int not null default 0
);
create index if not exists push_subscriptions_email_idx on public.push_subscriptions (lower(email));
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subs_own on public.push_subscriptions;
create policy push_subs_own on public.push_subscriptions for all to authenticated
  using (public.desk_hub_ok() and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (public.desk_hub_ok() and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

create table if not exists public.push_notified (
  item_id     text not null,
  email       text not null,
  notified_at timestamptz not null default now(),
  primary key (item_id, email)
);
alter table public.push_notified enable row level security;
revoke all on public.push_notified from anon, authenticated;
grant all on public.push_notified to service_role;
