-- ============================================================================
-- RUNNING LATE, L1 (Desktop 363). Samantha approved the plan 2026-09-29 ("yes to all", "build L1 now"). SHARED HUB
-- PROJECT. Safe to run again.
--
-- One row per AxisCare visit a caregiver told us about ("running late" or "can't make it"), written only by the
-- server (late-watch finds it; late-alert records what a person did). Staff read it for Needs Attention, Settings,
-- the caregiver's Performance section and the client's Care tab.
--   status  practice  found while late_watch_live is off: nothing is texted, no card opens, the missed clock-in
--                     watcher ignores it; "would" lists what would have gone (cleared after 7 days)
--           open      a live notice nobody has marked Seen yet (the admins are reminded until someone does)
--           seen      someone tapped Seen (or changed the time, or sent the family text)
--           closed    they clocked in, the visit changed, a coverage case took it, or the day ended
-- said: what they sent, word for word [{at, channel: text|call, text}] (their own words to the office).
-- family: every family text a person sent [{at, by, what: late|update|arrived, count, text}].
-- ============================================================================
create table if not exists public.late_notices (
  id                    bigserial primary key,
  visit_id              text not null unique,
  axiscare_caregiver_id text not null,
  axiscare_client_id    text,
  caregiver_name        text,
  client_first          text,
  shift_date            date not null,
  shift_start           timestamptz not null,
  kind                  text not null check (kind in ('late', 'cant_make_it')),
  status                text not null check (status in ('practice', 'open', 'seen', 'closed')),
  said                  jsonb not null default '[]'::jsonb,
  said_at               timestamptz,                    -- the newest message that made or changed it
  eta                   timestamptz,                    -- when they expect to arrive (null: no time given yet)
  eta_by                text,                           -- 'ai', or the person who changed it
  sure                  boolean not null default true,
  ghl_contact_id        text,
  asked_time_at         timestamptz,                    -- "About what time do you think you'll get there?"
  thanked_at            timestamptz,                    -- "Thanks for letting us know..."
  admin_rounds          jsonb not null default '[]'::jsonb,
  admin_last_at         timestamptz,
  seen_at               timestamptz,
  seen_by               text,
  family                jsonb not null default '[]'::jsonb,
  family_skipped_at     timestamptz,
  family_skipped_by     text,
  clock_in_at           timestamptz,
  closed_at             timestamptz,
  closed_how            text,                           -- clocked_in | visit_changed | coverage_case | day_ended
  coverage_case_id      text,
  would                 jsonb not null default '[]'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists late_notices_day_idx on public.late_notices (shift_date, status);
create index if not exists late_notices_cg_idx on public.late_notices (axiscare_caregiver_id, shift_date);
create index if not exists late_notices_client_idx on public.late_notices (axiscare_client_id, shift_date);
alter table public.late_notices enable row level security;
drop policy if exists late_notices_read on public.late_notices;
create policy late_notices_read on public.late_notices for select to authenticated using (true);
revoke all on public.late_notices from anon, authenticated;
grant select on public.late_notices to authenticated;
grant all on public.late_notices to service_role;
grant usage, select on sequence public.late_notices_id_seq to service_role;
