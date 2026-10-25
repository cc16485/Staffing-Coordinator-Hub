-- 1123 · THE FAMILY'S OWN PROFILE + THE BOOKING APP PAGE (Samantha, 2026-10-25). Two tables, written and read only by the
-- server (family-gateway, family-offer, family-app-office, caregiver-preview) with the service role; no browser access.
--  family_client_profile: the profile a family writes in the Booking App for their loved one (one per client). Shown on
--    Booking App visit offers. Separate from the office's Caregiver Preview (client_caregiver_profile), which shows on shifts.
--  family_app_activity: what families do in the app (opens, profile saves and stops), for the Hub's Booking App page.
-- Safe to run again.
create table if not exists public.family_client_profile (
  axiscare_client_id text primary key,
  about text check (about is null or char_length(about) <= 400),
  work text check (work is null or char_length(work) <= 300),
  talk text check (talk is null or char_length(talk) <= 300),
  little text check (little is null or char_length(little) <= 300),
  enjoys jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_contact text,
  updated_by_name text,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.family_client_profile enable row level security;
revoke all on public.family_client_profile from anon, authenticated;
grant all on public.family_client_profile to service_role;

create table if not exists public.family_app_activity (
  id bigserial primary key,
  at timestamptz not null default now(),
  contact_id text,
  axiscare_client_id text,
  name text,
  kind text not null,
  summary text,
  data jsonb not null default '{}'::jsonb
);
create index if not exists family_app_activity_at on public.family_app_activity (at desc);
create index if not exists family_app_activity_contact on public.family_app_activity (contact_id, kind, at desc);
alter table public.family_app_activity enable row level security;
revoke all on public.family_app_activity from anon, authenticated;
grant all on public.family_app_activity to service_role;
grant usage, select on sequence public.family_app_activity_id_seq to service_role;

-- THE CLIENT'S PHOTO (2026-10-25): optional, added by the family in the Booking App; shown only to the caregiver confirmed on a
-- visit, through signed links that expire. A private storage bucket (no public access; only the server reads and writes it).
alter table public.family_client_profile add column if not exists photo_path text;
alter table public.family_client_profile add column if not exists photo_at timestamptz;
alter table public.family_client_profile add column if not exists photo_by text;
alter table public.family_client_profile add column if not exists photo_consent text;
alter table public.family_client_profile add column if not exists photo_ai text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-photos', 'client-photos', false, 409600, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 409600, allowed_mime_types = array['image/jpeg'];
