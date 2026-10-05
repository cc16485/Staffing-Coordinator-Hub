-- 452 · CURRENT CAREGIVERS FILL IN THEIR OWN PROFILE (Samantha, 2026-10-05).
-- One new field. self_complete = true marks a caregiver already working with us who writes their whole profile
-- themselves (three questions, a photo AND a video, their permission). New hires stay false and are unchanged.
-- Safe to run twice. Nothing is dropped or rewritten.
begin;
alter table public.caregiver_profiles add column if not exists self_complete boolean not null default false;
comment on column public.caregiver_profiles.self_complete is
  '452: a current caregiver who fills in their own profile; the hello video is required for them as well as the photo.';
commit;
