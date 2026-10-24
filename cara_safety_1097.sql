-- 1097 · Cara's response board and shift page (2026-10-24). No code step (her call: "no need for a code on the open
-- shift"), so no code table. Two additions on care_circles, both inert until used:
--   caregiver_enjoys (+ by/at): the office's "What they enjoy" list beside the caregiver About
--   caregiver_share_care (+ by/at): the office ticked "Share the care needs on shift pages" for this client (default off)
alter table public.care_circles add column if not exists caregiver_enjoys text[];
alter table public.care_circles add column if not exists caregiver_enjoys_by text;
alter table public.care_circles add column if not exists caregiver_enjoys_at timestamptz;
alter table public.care_circles add column if not exists caregiver_share_care boolean not null default false;
alter table public.care_circles add column if not exists caregiver_share_care_by text;
alter table public.care_circles add column if not exists caregiver_share_care_at timestamptz;
