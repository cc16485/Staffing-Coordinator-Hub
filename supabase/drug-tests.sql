-- ============================================================================
-- DRUG TEST RECORD (Samantha's ruling, 2026-10-13). Hub project.
-- Her words: "Caring Companions does NOT routinely drug test every applicant after an offer. We conduct drug testing only
-- under certain circumstances, based on company policy and applicable law. Keep the conditional drug-testing language in
-- the Employment Agreement. Do not make drug testing a standard Step 1 requirement. Do not automatically trigger drug
-- testing for every new hire. Allow authorized management to initiate and document testing when required by our policy.
-- Do not invent testing circumstances or grounds that we have not approved."
--
-- So: a record management keeps by hand, nothing more. No readiness row, no Step 1 item, no automation, no reminder, no
-- card, no message ever comes from it. The reason is management's own words (free text); there is no list of grounds.
--
--   drug_test_entry   APPEND-ONLY (update, delete and truncate refused). Three kinds of line:
--                       request     a test management started: date requested, requested by (their Hub sign-in), the
--                                   reason in their own words (required), the test type (free text), notes
--                       result      for a request (test_id): pending, negative, positive, refused or cancelled as recorded
--                                   by management, the result date, the proof document, notes
--                       correction  never an overwrite: a new line that names the line it corrects (corrects), with the
--                                   corrected fields and why (correction_reason, required)
--                     The person: any of offer_id, caregiver_id (roster), candidate_id, applicant_id. Server only: no
--                     browser role reads or writes it; the drug-test function answers the Hub (owners record; results are
--                     read only by owners and the person who requested; other office staff see only that a record exists).
--   bucket drug-test-docs  PRIVATE, images (jpeg, png, heic, webp) and PDF, 15 MB. Only the server mints five-minute links
--                     and every open is a row in document_access_log. A file there is never deleted, moved or renamed.
-- Safe to run twice. Rollback: drug-tests-rollback.sql (removes the storage guard only; every line and file stays).
-- ============================================================================
begin;
create table if not exists public.drug_test_entry (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  kind text not null check (kind in ('request', 'result', 'correction')),
  test_id uuid references public.drug_test_entry(id),
  corrects uuid references public.drug_test_entry(id),
  offer_id text, caregiver_id text, candidate_id text, applicant_id text,
  name text,
  date_requested date,
  requested_by_name text, requested_by_email text, requested_by_person text,
  reason text,
  test_type text,
  result text check (result is null or result in ('pending', 'negative', 'positive', 'refused', 'cancelled')),
  result_date date,
  proof_path text, proof_content_type text,
  notes text,
  correction_reason text,
  entered_by_name text, entered_by_email text not null, entered_by_person text,
  constraint drug_test_someone check (offer_id is not null or caregiver_id is not null or candidate_id is not null or applicant_id is not null),
  constraint drug_test_request_shape check (kind <> 'request' or (test_id is null and corrects is null and date_requested is not null and length(btrim(coalesce(reason, ''))) > 0 and requested_by_email is not null)),
  constraint drug_test_result_shape check (kind <> 'result' or (test_id is not null and corrects is null and result is not null)),
  constraint drug_test_correction_shape check (kind <> 'correction' or (test_id is not null and corrects is not null and length(btrim(coalesce(correction_reason, ''))) > 0))
);
create index if not exists drug_test_entry_offer on public.drug_test_entry (offer_id) where offer_id is not null;
create index if not exists drug_test_entry_caregiver on public.drug_test_entry (caregiver_id) where caregiver_id is not null;
create index if not exists drug_test_entry_candidate on public.drug_test_entry (candidate_id) where candidate_id is not null;
create index if not exists drug_test_entry_applicant on public.drug_test_entry (applicant_id) where applicant_id is not null;
create index if not exists drug_test_entry_test on public.drug_test_entry (test_id);
comment on table public.drug_test_entry is 'Drug test record (2026-10-13): kept by management by hand when company policy calls for a test; append-only (corrections are new lines); server only; nothing automatic';

create or replace function public.drug_test_append_only() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
begin
  raise exception 'The drug test record is append-only: a line is never changed or removed. Add a correction instead.' using errcode = 'check_violation';
end $t$;
drop trigger if exists drug_test_entry_no_change on public.drug_test_entry;
create trigger drug_test_entry_no_change before update or delete on public.drug_test_entry for each row execute function public.drug_test_append_only();
drop trigger if exists drug_test_entry_no_truncate on public.drug_test_entry;
create trigger drug_test_entry_no_truncate before truncate on public.drug_test_entry execute function public.drug_test_append_only();

alter table public.drug_test_entry enable row level security;
revoke all privileges on table public.drug_test_entry from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('drug-test-docs', 'drug-test-docs', false, 15728640, array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.drug_test_docs_keep() returns trigger
language plpgsql set search_path = pg_catalog, public as $k$
begin
  if coalesce(current_setting('cc.retention_purge', true), '') = 'on' then return case when tg_op = 'DELETE' then old else new end; end if;
  if old.bucket_id = 'drug-test-docs' then
    if tg_op = 'DELETE' then
      raise exception 'Drug test documents are kept and cannot be deleted (%).', old.name using errcode = '42501';
    elsif new.bucket_id is distinct from old.bucket_id or new.name is distinct from old.name then
      raise exception 'Drug test documents are kept and cannot be moved or renamed (%).', old.name using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $k$;
comment on function public.drug_test_docs_keep() is 'Drug test record (2026-10-13): files in drug-test-docs cannot be deleted, moved or renamed';
drop trigger if exists drug_test_docs_keep on storage.objects;
create trigger drug_test_docs_keep before delete or update on storage.objects
  for each row when (old.bucket_id = 'drug-test-docs') execute function public.drug_test_docs_keep();
commit;

do $v$ begin
  if has_table_privilege('authenticated', 'public.drug_test_entry', 'select') or has_table_privilege('anon', 'public.drug_test_entry', 'select')
     or has_table_privilege('authenticated', 'public.drug_test_entry', 'insert') or has_table_privilege('anon', 'public.drug_test_entry', 'insert') then
    raise exception 'drug test self-check: a browser role can reach drug_test_entry'; end if;
  if not exists (select 1 from storage.buckets where id = 'drug-test-docs' and public = false) then
    raise exception 'drug test self-check: the drug-test-docs bucket is missing or public'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'drug_test_entry_no_change' and tgrelid = 'public.drug_test_entry'::regclass) then
    raise exception 'drug test self-check: the append-only guard is missing'; end if;
end $v$;
