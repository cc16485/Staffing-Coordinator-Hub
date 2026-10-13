-- ============================================================================
-- HEPATITIS B VACCINATION (OSHA 29 CFR 1910.1030; the owner's ruling 2026-10-13; research launch/review/hepb-osha-research.md).
-- Hub project. Positions with reasonably anticipated exposure to blood (the exposure table in _shared/hepb.ts, Admin
-- overrides in ops_settings.hepb_exposure) are offered the vaccine at no cost after the bloodborne pathogens training and
-- within 10 working days of initial assignment. Never mandatory: the employee may decline by signing the Appendix A
-- statement word for word, and may later choose the vaccine at no cost ((f)(2)(iii)).
--
--   hepb_record   one row per person (an offer, a roster caregiver, or both): position and exposure decided at set-up,
--                 the training date the office confirmed, initial assignment and the deadline, the offer, the answer, the
--                 doses, the owner's check of an exception, the signed declination. Never deleted. Server only.
--   hepb_event    the full history: append-only (update, delete and truncate refused). Server only.
--   hepb_document proofs (completed series, antibody test, dose records) and nothing else; never deleted; a document's
--                 identity never changes. Server only.
--   bucket hepb-docs  PRIVATE (no public URL), images and PDF, 15 MB: the signed declinations and the proofs. Confidential
--                 employee medical records ((h)(1)(iii)), kept for employment plus 30 years ((h)(1)(iv)): a file can never be
--                 deleted, moved or renamed (the same keep-guard as driver-docs). Only the hepb function mints five-minute
--                 links, only for an owner, and every open is a row in document_access_log.
--   client_journey_step_def  the readiness row cg.health.hepb (NOT required for Approve to Work: the offer is due within 10
--                 working days AFTER initial assignment; the hepb function raises the deadline cards).
-- Existing caregivers: nothing here creates a record for anyone. The office sets each one up (Set up on their card).
-- Safe to run twice. Rollback: hepb-vaccination-rollback.sql (removes the storage guard and turns the readiness row off;
-- the tables, every row, the bucket and its files stay: no medical record is ever deleted).
-- ============================================================================
begin;
create table if not exists public.hepb_record (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid unique,
  caregiver_id text unique,
  axiscare_id text,
  name text,
  position text,
  position_source text,                      -- 'offer' | 'roster' | 'office' | 'fallback'
  exposed boolean not null,
  exposure_basis jsonb not null default '{}'::jsonb,   -- the table row used: { position, scope, source, fallback }
  status text not null check (status in ('not_required', 'pending', 'vaccine', 'complete', 'prior_series', 'immune', 'contraindicated', 'declined')),
  status_at timestamptz not null default now(),
  training_date date,                        -- bloodborne pathogens training, confirmed by the office ((g)(2)(i); (h)(2))
  training_confirmed_by text, training_confirmed_at timestamptz,
  assignment_date date,                      -- initial assignment: first client visit, else Approve to Work, else the office's date
  assignment_source text,
  due_date date,                             -- 10 working days after assignment_date ((f)(2)(i))
  offered_at timestamptz, offered_via text,
  choice_at timestamptz, choice_by text,
  declined_at timestamptz, declination_version int, declination_fingerprint text, declination_pdf text, declination_typed_name text,
  doses jsonb not null default '[]'::jsonb,  -- [{ n, date, recorded_by, recorded_at }]
  series_complete_at timestamptz, series_complete_by text,
  verified_at timestamptz, verified_by text, -- an owner checked the exception (series, antibody test, contraindication)
  reminders jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hepb_record_someone check (offer_id is not null or caregiver_id is not null)
);
comment on table public.hepb_record is 'Hepatitis B vaccination (OSHA 1910.1030(f), 2026-10-13): confidential medical record; never deleted; server only';

create table if not exists public.hepb_event (
  id bigserial primary key,
  hepb_id uuid not null references public.hepb_record(id),
  at timestamptz not null default now(),
  kind text not null check (kind in ('created', 'training_confirmed', 'assignment_set', 'offered', 'offer_held', 'offer_refused', 'chose', 'declined',
    'doc_uploaded', 'dose_recorded', 'series_complete', 'verified', 'card', 'note')),
  by_name text, by_email text, by_person text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists hepb_event_rec on public.hepb_event (hepb_id, at);
comment on table public.hepb_event is 'Hepatitis B vaccination (2026-10-13): the full history, append-only';

create table if not exists public.hepb_document (
  id uuid primary key default gen_random_uuid(),
  hepb_id uuid not null references public.hepb_record(id),
  kind text not null check (kind in ('series_proof', 'titer_proof', 'dose_record', 'provider_note', 'other')),
  path text not null,
  content_type text,
  uploaded_at timestamptz not null default now(),
  uploaded_by text not null,
  unique (hepb_id, path)
);
create index if not exists hepb_document_rec on public.hepb_document (hepb_id, kind);
comment on table public.hepb_document is 'Hepatitis B vaccination (2026-10-13): proofs in the PRIVATE bucket hepb-docs; never deleted';

create or replace function public.hepb_no_delete() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
begin
  raise exception 'Hepatitis B records are confidential medical records kept for employment plus 30 years: never deleted or emptied (%).', tg_table_name using errcode = 'check_violation';
end $t$;
create or replace function public.hepb_event_append_only() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
begin
  raise exception 'Hepatitis B history is append-only: a line is never changed or removed.' using errcode = 'check_violation';
end $t$;
create or replace function public.hepb_record_touch() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
begin
  new.updated_at := now();
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'hepb_record: the record number and its creation time never change' using errcode = 'check_violation'; end if;
  if old.offer_id is not null and new.offer_id is distinct from old.offer_id then
    raise exception 'hepb_record: the offer a record belongs to never changes' using errcode = 'check_violation'; end if;
  if old.caregiver_id is not null and new.caregiver_id is distinct from old.caregiver_id then
    raise exception 'hepb_record: the caregiver a record belongs to never changes' using errcode = 'check_violation'; end if;
  if old.declined_at is not null and (new.declined_at is distinct from old.declined_at or new.declination_pdf is distinct from old.declination_pdf
     or new.declination_fingerprint is distinct from old.declination_fingerprint or new.declination_typed_name is distinct from old.declination_typed_name) then
    raise exception 'hepb_record: a signed declination is never changed (a later yes to the vaccine is a new answer beside it)' using errcode = 'check_violation'; end if;
  return new;
end $t$;
create or replace function public.hepb_document_guard() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
begin
  raise exception 'hepb_document: an uploaded document is never changed' using errcode = 'check_violation';
end $t$;
drop trigger if exists hepb_record_touch_t on public.hepb_record;
create trigger hepb_record_touch_t before update on public.hepb_record for each row execute function public.hepb_record_touch();
drop trigger if exists hepb_record_no_delete on public.hepb_record;
create trigger hepb_record_no_delete before delete on public.hepb_record for each row execute function public.hepb_no_delete();
drop trigger if exists hepb_record_no_truncate on public.hepb_record;
create trigger hepb_record_no_truncate before truncate on public.hepb_record execute function public.hepb_no_delete();
drop trigger if exists hepb_event_no_change on public.hepb_event;
create trigger hepb_event_no_change before update or delete on public.hepb_event for each row execute function public.hepb_event_append_only();
drop trigger if exists hepb_event_no_truncate on public.hepb_event;
create trigger hepb_event_no_truncate before truncate on public.hepb_event execute function public.hepb_event_append_only();
drop trigger if exists hepb_document_guard_t on public.hepb_document;
create trigger hepb_document_guard_t before update on public.hepb_document for each row execute function public.hepb_document_guard();
drop trigger if exists hepb_document_no_delete on public.hepb_document;
create trigger hepb_document_no_delete before delete on public.hepb_document for each row execute function public.hepb_no_delete();
drop trigger if exists hepb_document_no_truncate on public.hepb_document;
create trigger hepb_document_no_truncate before truncate on public.hepb_document execute function public.hepb_no_delete();

-- server only: no browser role reads or writes any of the three (1910.1030(h)(1)(iii) confidentiality)
alter table public.hepb_record enable row level security;
alter table public.hepb_event enable row level security;
alter table public.hepb_document enable row level security;
revoke all privileges on table public.hepb_record from anon, authenticated;
revoke all privileges on table public.hepb_event from anon, authenticated;
revoke all privileges on table public.hepb_document from anon, authenticated;
revoke all privileges on sequence public.hepb_event_id_seq from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hepb-docs', 'hepb-docs', false, 15728640, array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.hepb_documents_keep() returns trigger
language plpgsql set search_path = pg_catalog, public as $k$
begin
  if coalesce(current_setting('cc.retention_purge', true), '') = 'on' then return case when tg_op = 'DELETE' then old else new end; end if;
  if old.bucket_id = 'hepb-docs' then
    if tg_op = 'DELETE' then
      raise exception 'Hepatitis B documents are medical records kept 30 years after employment and cannot be deleted (%).', old.name using errcode = '42501';
    elsif new.bucket_id is distinct from old.bucket_id or new.name is distinct from old.name then
      raise exception 'Hepatitis B documents cannot be moved or renamed (%).', old.name using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $k$;
drop trigger if exists hepb_documents_keep on storage.objects;
create trigger hepb_documents_keep before delete or update on storage.objects
  for each row when (old.bucket_id = 'hepb-docs') execute function public.hepb_documents_keep();

-- the readiness row (caregiver journey). Not required: never blocks Approve to Work; the hepb function writes it.
insert into public.client_journey_step_def (key, catalog_version, def, active, updated_by) values ('cg.health.hepb', 1, '{"subject": "caregiver", "title": "Hepatitis B vaccine offered (OSHA 1910.1030): accepted, declined on the Appendix A statement, or an exception", "stage": "ready", "sort": 104, "owner_role": "hub", "proof": "verified", "permission": "hub", "evidence_required": "system_fact:the hepb record (status words only; the record itself is a confidential medical record, owners only)", "required": false, "active": true, "payers": [], "after": ["cg.approve.work"], "howto": ["Only for positions with reasonably anticipated exposure to blood (the exposure table; other positions show not needed).", "The office confirms the bloodborne pathogens training date on the Hepatitis B card; the offer link then goes to the caregiver. It must be offered within 10 working days of their first client visit (or Approve to Work when no visit is known). A card comes when that deadline passes without an offer or an answer.", "The vaccine is never required: declining on the signed Appendix A statement completes this row, and they can still choose the vaccine later at no cost."]}'::jsonb, true, 'hepb 2026-10-13')
  on conflict (key) do update set def = excluded.def, active = true, updated_by = excluded.updated_by;
commit;

do $v$ begin
  if has_table_privilege('authenticated', 'public.hepb_record', 'select') or has_table_privilege('anon', 'public.hepb_record', 'select')
     or has_table_privilege('authenticated', 'public.hepb_document', 'select') or has_table_privilege('authenticated', 'public.hepb_event', 'select')
     or has_table_privilege('authenticated', 'public.hepb_record', 'update') then
    raise exception 'hepatitis B self-check: a browser role can reach a hepatitis B table'; end if;
  if not exists (select 1 from storage.buckets where id = 'hepb-docs' and public = false) then
    raise exception 'hepatitis B self-check: the hepb-docs bucket is missing or public'; end if;
  if not exists (select 1 from public.client_journey_step_def where key = 'cg.health.hepb' and active and (def->>'required') = 'false') then
    raise exception 'hepatitis B self-check: the readiness row is missing or required'; end if;
  if exists (select 1 from public.client_journey_step_def where key = 'cg.approve.work' and def->'after' ? 'cg.health.hepb') then
    raise exception 'hepatitis B self-check: Approve to Work must not wait for the hepatitis B row'; end if;
end $v$;
