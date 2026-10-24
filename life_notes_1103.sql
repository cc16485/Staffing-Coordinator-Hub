-- 1103 · LIFE STORY SUGGESTIONS FROM SHIFT NOTES (Samantha, 2026-10-24, Life Story plan step 3, practice first).
-- One row per client and topic ("cards", "game shows"), combined across notes: how many notes and which caregivers
-- mentioned it, and for each note only the caregiver's first name, the day, the visit number and the few words relied on
-- (other people's names masked). No note text. Status: practice (collected, never shown), known (already in the Life
-- Story), later suggested / accepted / dismissed. Read and written only by the care-notes function (service role).
create table if not exists public.life_note_suggestion (
  id uuid primary key default gen_random_uuid(),
  axiscare_client_id text not null,
  client_first text,
  topic_key text not null,
  label text not null,
  kind text not null,
  status text not null default 'practice',
  mentions integer not null default 0,
  caregivers jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  decided_by text, decided_at timestamptz,
  unique (axiscare_client_id, topic_key)
);
alter table public.life_note_suggestion enable row level security;
revoke all on public.life_note_suggestion from anon, authenticated;
grant all on public.life_note_suggestion to service_role;
