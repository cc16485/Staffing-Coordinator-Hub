-- applicant_msgs_445.sql (Desktop 445, 2026-10-04). Samantha approved the plan "Private applicant links, and two loose
-- ends" ("yes to all", https://claude.ai/artifact/MQgrEVdZ8Kr65LBLsha1Aq), decisions 3 and 4.
--   3 · "Not hiring" and "Candidate pool" get a short, kind message the office sees first (applicant-decision-msg).
--       job_applicants gets: when it went, which decision it was for, who pressed Send, and when one is waiting for
--       texting hours. Only that function writes them (the server key).
--   4 · The orientation day-before reminder is sent by the Hub (orientation-remind) instead of a GoHighLevel workflow.
--       orient_reminders: one row per person per session (practice and live kept apart), so nobody is reminded twice.
--       orient_remind_runs: each check, so the Hub can say when it last looked and whether it could.
--       Office staff (signed in) can read both lists; nobody but the server can write them.
-- Run as one transaction. Adds only; changes no existing row.

alter table public.job_applicants
  add column if not exists decision_msg_at      timestamptz,
  add column if not exists decision_msg_kind    text,
  add column if not exists decision_msg_by      text,
  add column if not exists decision_msg_held_at timestamptz;

create table if not exists public.orient_reminders (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  run_id        text,
  mode          text not null check (mode in ('practice', 'live')),
  session_id    text not null,
  session_date  date not null,
  phone10       text not null,
  who           text,
  result        text not null check (result in ('would', 'skipped', 'sending', 'sent', 'not_sent', 'failed')),
  detail        text,
  sent_at       timestamptz,
  constraint orient_reminders_once unique (session_id, session_date, phone10, mode)
);
create index if not exists orient_reminders_at on public.orient_reminders (at desc);

create table if not exists public.orient_remind_runs (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  run_id    text,
  mode      text,
  caller    text,
  ok        boolean not null,
  sessions  int,
  due       int,
  skipped   int,
  would     int,
  sent      int,
  not_sent  int,
  failed    int,
  error     text
);
create index if not exists orient_remind_runs_at on public.orient_remind_runs (at desc);

alter table public.orient_reminders enable row level security;
alter table public.orient_remind_runs enable row level security;
revoke all on public.orient_reminders, public.orient_remind_runs from public, anon, authenticated;
revoke all on sequence public.orient_reminders_id_seq, public.orient_remind_runs_id_seq from public, anon, authenticated;
grant select on public.orient_reminders, public.orient_remind_runs to authenticated;
grant all on public.orient_reminders, public.orient_remind_runs to service_role;
grant usage, select on sequence public.orient_reminders_id_seq, public.orient_remind_runs_id_seq to service_role;
drop policy if exists orient_reminders_read on public.orient_reminders;
create policy orient_reminders_read on public.orient_reminders for select to authenticated using (true);
drop policy if exists orient_remind_runs_read on public.orient_remind_runs;
create policy orient_remind_runs_read on public.orient_remind_runs for select to authenticated using (true);
