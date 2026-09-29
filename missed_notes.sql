-- ============================================================================
-- MISSED SHIFT NOTES, M1–M3 (Desktop 361). Samantha approved 2026-09-29 ("go for the missed shift notes M0-M3",
-- "yes to all", "go and merge"), with her corrections from M0. SHARED HUB PROJECT. Safe to run again.
--
-- One row per caregiver + client + Central day (M0 proved AxisCare keeps one care note per that group). Written only
-- by the server (the missed-notes function). Staff read it for Needs Attention, the caregiver's page and Settings.
--   status  practice    found while the texts are off (never counted, cleared after 7 days)
--           open        a live miss: texted (or waiting for 8am), no reply yet
--           recovered   they replied with the note ("recovered by text"): STILL counts toward 3 in 30 days
--           unresolved  no reply by 6pm the next day: counts, and reads as more serious in a write-up
-- A phone (telephony) clock-out is not a miss by itself; only an unresolved one counts (her rule).
-- ============================================================================
create table if not exists public.missed_notes (
  id                    bigserial primary key,
  axiscare_caregiver_id text not null,
  axiscare_client_id    text not null,
  shift_date            date not null,
  caregiver_name        text,
  client_first          text,
  visit_id              text not null,          -- one visit of the group (a note written on it covers the group)
  visit_count           int not null default 1,
  clock_out_at          timestamptz,
  clock_out_method      text,                   -- app | web | phone | other
  status                text not null check (status in ('practice', 'open', 'recovered', 'unresolved')),
  counts                boolean not null default false,  -- toward 3 in 30 days (false for practice, phone recovered)
  texted_at             timestamptz,
  reminded_at           timestamptz,
  ghl_contact_id        text,
  reply_text            text,
  replied_at            timestamptz,
  resolved_at           timestamptz,
  entered_at            timestamptz,            -- "Put it in AxisCare", a person's tap
  entered_by            text,
  entered_text          text,
  draft_id              text,                   -- the draft write-up it went into
  created_at            timestamptz not null default now(),
  unique (axiscare_caregiver_id, axiscare_client_id, shift_date)
);
create index if not exists missed_notes_cg_idx on public.missed_notes (axiscare_caregiver_id, shift_date);
create index if not exists missed_notes_status_idx on public.missed_notes (status);
alter table public.missed_notes enable row level security;
drop policy if exists missed_notes_read on public.missed_notes;
create policy missed_notes_read on public.missed_notes for select to authenticated using (true);
revoke all on public.missed_notes from anon, authenticated;
grant select on public.missed_notes to authenticated;
grant all on public.missed_notes to service_role;
grant usage, select on sequence public.missed_notes_id_seq to service_role;
