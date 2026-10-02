-- caregiver_profile_2a.sql (Desktop 409, 2026-10-01). Caregiver profile, part 2, slice 2a: one profile in onboarding.
-- Samantha: ONE caregiver profile serves both "introduce your caregiver" and "caregiver change" (wired in 2b). The
-- office drafts it ahead of the welcome call (AI, from their application and interview), reads it to them on the
-- call, types their changes, and texts/emails a personal link where they add a photo (required) and, if they like,
-- a short video. New hires need a published profile before working (the gate is 2c; caregiver_profile_published()
-- below is the helper it will use).
--
--   • New columns tie the profile to the Hub candidate (candidate_id = app_data 'candidates' id) and record each
--     step (drafted, link sent, submitted, published: when and by whom). Once they are an employee the same row is
--     found by axiscare_id (their AxisCare caregiver id), so the office can open and edit it for as long as they work
--     here (Samantha: "can their profile link be linked in the employees profile so we can always access it").
--   • upload_token is the PERSONAL link secret (cc.mo-care.com/caregiver-profile.html?t=<token>). It is not the public
--     card id (caregiver.html?id=<id>), so a family holding the card link can never edit the profile.
--   • CLOSES TWO GAPS: anonymous visitors could insert any row into caregiver_profiles (policy cgp_anon_insert) and
--     upload any file into the caregiver-profiles bucket (policy cgp_files_write). Both are gone; the new-hire page
--     now works only through the caregiver-profile function with their personal token, and files go up on a
--     one-time signed upload link that function hands out.
--   • The bucket stays PUBLIC (the card's photo and video addresses keep working without RLS), but listing the bucket
--     is now staff-only, so nobody can walk the folder names to find profile ids or unpublished photos.
-- Run as one transaction. Safe to run again.

create extension if not exists "pgcrypto";

alter table public.caregiver_profiles
  add column if not exists candidate_id   text,          -- the Hub candidate id (app_data 'candidates')
  add column if not exists applicant_id   uuid,          -- their online application (job_applicants.id), if found
  add column if not exists last_name      text,          -- for the office; the card shows the initial only
  add column if not exists upload_token   uuid not null default gen_random_uuid(),
  add column if not exists drafted_at     timestamptz,
  add column if not exists drafted_by     text,
  add column if not exists link_sent_at   timestamptz,
  add column if not exists link_sent_by   text,
  add column if not exists submitted_at   timestamptz,
  add column if not exists submit_count   int not null default 0,   -- submits on submit_day (a simple daily limit)
  add column if not exists submit_day     date,
  add column if not exists published_at   timestamptz,
  add column if not exists published_by   text;

-- one live profile per candidate (a withdrawn one can be replaced)
create unique index if not exists caregiver_profiles_candidate_uniq
  on public.caregiver_profiles (candidate_id) where candidate_id is not null and status <> 'withdrawn';
create unique index if not exists caregiver_profiles_token_uniq on public.caregiver_profiles (upload_token);
-- a current employee's profile is found by their AxisCare caregiver id (the employee page in the Hub). Not unique:
-- older rows may already share one; the Hub shows the live one and the office tidies any duplicate.
create index if not exists caregiver_profiles_axiscare_idx on public.caregiver_profiles (axiscare_id) where axiscare_id is not null;

-- ── Gap 1: anonymous visitors can no longer write to the table ──
drop policy if exists cgp_anon_insert on public.caregiver_profiles;
revoke all on public.caregiver_profiles from anon;
grant all on public.caregiver_profiles to authenticated, service_role;
drop policy if exists cgp_auth_all on public.caregiver_profiles;
create policy cgp_auth_all on public.caregiver_profiles
  for all to authenticated using (true) with check (true);

-- ── Gap 2: anonymous visitors can no longer upload files or list the bucket ──
-- The bucket itself stays public, so /storage/v1/object/public/caregiver-profiles/<path> (what the card uses) still
-- loads without any policy. Uploads from the new-hire page use signed upload links from the function.
drop policy if exists cgp_files_write on storage.objects;
create policy cgp_files_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'caregiver-profiles');
drop policy if exists cgp_files_read on storage.objects;
create policy cgp_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'caregiver-profiles');
-- cgp_files_manage (authenticated: all) is unchanged.

-- ── For slice 2c: has this candidate got a published profile? ──
create or replace function public.caregiver_profile_published(p_candidate_id text)
returns boolean language sql stable security invoker set search_path to 'public' as $$
  select exists (select 1 from public.caregiver_profiles p
                 where p.candidate_id = p_candidate_id and p.published and p.status <> 'withdrawn');
$$;
revoke all on function public.caregiver_profile_published(text) from public;
grant execute on function public.caregiver_profile_published(text) to authenticated, service_role;
