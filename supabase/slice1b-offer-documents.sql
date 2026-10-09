-- =============================================================================
-- 540 · SLICE 1b: THE PRIVATE DOCUMENT BUCKET AND THE OPEN LOG (Samantha approved 2026-10-08, testing only). Hub project.
-- =============================================================================
-- onboarding-documents: a PRIVATE bucket, PDFs only, 10 MB each. No storage rule grants anon or authenticated anything,
-- so only the server (service role, inside offer-sign) can write or read it; every staff open goes through the
-- function and is logged. document_access_log: append-only (UPDATE, DELETE and TRUNCATE refused for every role; anon
-- and authenticated hold nothing). Safe to run again. Undo: slice1b-offer-documents-rollback.sql (keeps every file).
begin;
set local lock_timeout = '5s';
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('onboarding-documents', 'onboarding-documents', false, 10485760, array['application/pdf'])
  on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];
create table if not exists public.document_access_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  offer_id text not null,
  doc text not null,
  path text not null,
  by_person text,
  by_email text,
  by_name text,
  ip text
);
comment on table public.document_access_log is '540 · every staff open of a signed onboarding document; append-only for every role';
create or replace function public.document_access_log_append_only() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
begin
  raise exception 'document_access_log is append-only: rows are never changed, deleted or emptied' using errcode = 'check_violation';
end $t$;
drop trigger if exists trg_document_access_log_append_only on public.document_access_log;
create trigger trg_document_access_log_append_only before update or delete on public.document_access_log
  for each row execute function public.document_access_log_append_only();
drop trigger if exists trg_document_access_log_no_truncate on public.document_access_log;
create trigger trg_document_access_log_no_truncate before truncate on public.document_access_log
  for each statement execute function public.document_access_log_append_only();
alter table public.document_access_log enable row level security;
revoke all privileges on table public.document_access_log from anon, authenticated;
commit;
