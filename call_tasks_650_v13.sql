-- =============================================================================
-- 650 v13 · nothing falls through the cracks (Samantha 2026-10-12: "build both"). PRACTICE ONLY.
-- =============================================================================
-- 1. No silent failures: a call or text the reader could not read is tried again (up to 3 tries, 30 minutes apart),
--    and every try is kept. attempt numbers the tries; the newest reading still wins. A call GoHighLevel never
--    transcribed gets a reading too ("no transcript"), so every answered call has a row and none is missing quietly.
-- 2. Promise watch: every promise the office made (we agreed) or a confirmation it is waiting on, with the day it is
--    due, the owner, and whether the office's later calls, texts and cards show it was kept. In practice the Hub only
--    shows it ("would remind"); nobody is reminded and nothing is sent.
-- Still no transcript, text bodies, phone number or email. Readings stay append-only. Office read. One transaction.
-- Safe to run again. Rollback: call_tasks_650_v13_rollback.sql (after the reader is back on v12).
-- =============================================================================
begin;
alter table public.call_task_reading add column if not exists attempt int not null default 1;
alter table public.call_task_reading drop constraint if exists call_task_reading_attempt_check;
alter table public.call_task_reading add constraint call_task_reading_attempt_check check (attempt between 1 and 5);
alter table public.call_task_reading drop constraint if exists call_task_reading_message_id_version_key;
alter table public.call_task_reading drop constraint if exists call_task_reading_message_version_attempt_key;
alter table public.call_task_reading add constraint call_task_reading_message_version_attempt_key unique (message_id, version, attempt);

create table if not exists public.call_promise_watch (
  id               bigserial primary key,
  created_at       timestamptz not null default now(),
  message_id       text not null check (length(message_id) between 4 and 80),   -- the call or text burst the promise came from
  idx              int not null check (idx between 0 and 9),                    -- which promise in that reading
  version          text not null check (length(version) between 1 and 40),
  channel          text not null default 'call' check (channel in ('call', 'text')),
  call_at          timestamptz not null,
  person_id        uuid,
  lead_id          text check (lead_id is null or length(lead_id) <= 100),
  who_name         text check (who_name is null or length(who_name) <= 120),
  caller           text check (caller is null or length(caller) <= 80),
  what             text not null check (length(what) <= 160),
  kind             text not null check (kind in ('we_agreed', 'awaiting_confirmation')),
  area             text not null check (length(area) <= 40),
  owner            jsonb not null default '{}'::jsonb check (jsonb_typeof(owner) = 'object'),
  due              date not null,
  status           text not null default 'waiting' check (status in ('waiting', 'kept', 'kept_late', 'would_remind', 'dropped')),
  why              text check (why is null or length(why) <= 300),
  evidence         jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 5),
  checks           int not null default 0,
  last_activity_at timestamptz,
  checked_at       timestamptz,
  history          jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),   -- every status change, never overwritten
  unique (message_id, idx)
);
comment on table public.call_promise_watch is '650 v13 · promises from calls and texts (we agreed, awaiting confirmation), when due, the owner, and whether later calls, texts and cards show them kept. Practice: shown only. No message bodies, phone or email.';
create index if not exists call_promise_watch_due_ix on public.call_promise_watch (status, due);

alter table public.call_promise_watch enable row level security;
revoke all on public.call_promise_watch from public, anon, authenticated, service_role;
revoke all on sequence public.call_promise_watch_id_seq from public, anon, authenticated, service_role;
grant select on public.call_promise_watch to authenticated;
grant select, insert, update on public.call_promise_watch to service_role;
grant usage on sequence public.call_promise_watch_id_seq to service_role;
drop policy if exists call_promise_watch_office on public.call_promise_watch;
create policy call_promise_watch_office on public.call_promise_watch for select to authenticated using (public.hub_office_ok());

do $v$
begin
  if not exists (select 1 from pg_constraint where conname = 'call_task_reading_message_version_attempt_key') then
    raise exception '650 v13 self-check: readings cannot keep more than one try'; end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.call_task_reading'::regclass and tgname like 'call_task_reading_keep%') <> 2 then
    raise exception '650 v13 self-check: the append-only guards are not both in place'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.call_promise_watch'::regclass) then raise exception '650 v13 self-check: row security is off on the promise watch'; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'call_promise_watch'
              and (grantee in ('anon', 'PUBLIC') or (grantee = 'authenticated' and privilege_type <> 'SELECT')
                   or (grantee = 'service_role' and privilege_type not in ('SELECT', 'INSERT', 'UPDATE')))) then
    raise exception '650 v13 self-check: someone could change or delete promises, or anon could read them'; end if;
  raise notice '650 v13: tries are kept, and promises are watched';
end $v$;
commit;
