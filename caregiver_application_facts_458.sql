-- 458 · THE STEP 1 APPLICATION, ON THEIR PROFILE (Samantha, 2026-10-05: "can you pull 'step 1 application' in from their GHL
-- account and save it into their profiles"; she approved the list of what to keep, "yes build it").
-- One row per Hub caregiver: ONLY the approved details read from their GoHighLevel "Upload Step 1 Application Packet" PDF
-- (their own words, experience without employer names, client-matching answers, availability, favorites). Never a Social
-- Security or licence number, birth date, address, phone, email, emergency or reference contact, criminal or driving
-- answer, tax or I-9 detail, or signature. The PDF itself is not copied.
-- Office staff (signed in) may READ; only the server writes. The public has no access at all.
-- Safe to run twice. Nothing existing is changed.
begin;
create table if not exists public.caregiver_application_facts (
  id               uuid primary key default gen_random_uuid(),
  hub_caregiver_id text not null unique,
  axiscare_id      text,
  candidate_id     text,
  ghl_contact_id   text,
  ghl_file_key     text,
  first_name       text,
  facts            jsonb not null default '{}'::jsonb,
  pages            int,
  extracted_at     timestamptz not null default now(),
  extracted_by     text
);
create index if not exists caregiver_application_facts_ax on public.caregiver_application_facts (axiscare_id) where axiscare_id is not null;
alter table public.caregiver_application_facts enable row level security;
revoke all privileges on public.caregiver_application_facts from anon, authenticated;
grant select on public.caregiver_application_facts to authenticated;
grant all privileges on public.caregiver_application_facts to service_role;
drop policy if exists "staff_read_application_facts" on public.caregiver_application_facts;
create policy "staff_read_application_facts" on public.caregiver_application_facts for select to authenticated using (true);
commit;
notify pgrst, 'reload schema';
