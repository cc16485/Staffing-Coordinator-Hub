-- 1096 · Cara's shift opportunity page (2026-10-24). Two additions, both inert until the page is switched on:
--   1. shift_offer_codes: one row per caregiver per shift offer, holding only HASHES of the one-time code and of the
--      2-hour session, the tries, the send times and a lock. Server only (row level security on, no policies; the anon
--      and signed-in roles get nothing).
--   2. care_circles.caregiver_enjoys: the office-approved "What they enjoy" list beside the existing caregiver About.
create table if not exists public.shift_offer_codes (
  id text primary key,
  case_id text not null,
  ask_id text not null,
  code_hash text,
  code_sent_at timestamptz,
  code_tries integer not null default 0,
  sends jsonb not null default '[]'::jsonb,
  session_hash text,
  session_exp timestamptz,
  locked_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.shift_offer_codes enable row level security;
revoke all on public.shift_offer_codes from anon, authenticated;
grant all on public.shift_offer_codes to service_role;
alter table public.care_circles add column if not exists caregiver_enjoys text[];
alter table public.care_circles add column if not exists caregiver_enjoys_by text;
alter table public.care_circles add column if not exists caregiver_enjoys_at timestamptz;
