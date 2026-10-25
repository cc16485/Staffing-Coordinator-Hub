-- 1122 · THE CLIENT PROFILE IN THE BOOKING APP (Samantha, 2026-10-25): a family's "Suggest a change" to what caregivers see.
-- Written by family-gateway, read and closed on the client's Caregiver Preview tab (caregiver-preview), both with the service
-- role; no browser access. Nothing here reaches caregivers: the office edits and approves the Caregiver Preview as usual.
-- Safe to run again.
create table if not exists public.client_profile_suggestions (
  id bigserial primary key,
  axiscare_client_id text not null,
  circle_id text,
  contact_id bigint,
  contact_name text,
  text text not null check (char_length(text) between 1 and 500),
  status text not null default 'open' check (status in ('open', 'used', 'not_used')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by text
);
create index if not exists client_profile_suggestions_open on public.client_profile_suggestions (axiscare_client_id, status);
alter table public.client_profile_suggestions enable row level security;
revoke all on public.client_profile_suggestions from anon, authenticated;
grant all on public.client_profile_suggestions to service_role;
grant usage, select on sequence public.client_profile_suggestions_id_seq to service_role;
