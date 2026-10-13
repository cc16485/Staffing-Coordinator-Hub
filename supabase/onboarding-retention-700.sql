-- ============================================================================
-- 700 · SEVEN-YEAR RETENTION FOR SIGNED ONBOARDING RECORDS (Samantha 2026-10-11: "7 years" for signed onboarding records;
-- 2026-10-13: "electronic signatures, timestamps, completed PDFs, audit records, and seven-year record retention are
-- implemented and tested"). Hub project.
--
-- What Missouri asks: personnel and screening records kept five years (19 CSR 15-7.021(24)); MO HealthNet records six
-- years from the date of service (13 CSR 70-3.030); EEOC one year for applications (29 CFR 1602.14). Seven years after the
-- later of (a) the offer ending for someone never hired or (b) separation for someone hired meets every one of them.
--
--   1. The signed files: every object in the private bucket 'onboarding-documents' (signed offer letters, position
--      descriptions, every signed Step 1 form) can no longer be deleted, renamed or moved, by anyone, through the
--      storage API or SQL. Personnel-file exports (exports/...) stay replaceable: they are copies made on request.
--      The only door is a deliberate retention purge that sets cc.retention_purge = 'on' in its own transaction, and
--      no such purge exists (none is built; deleting anything after seven years is a later decision of hers).
--   2. The rows: step1_forms and step1_identity already refuse delete and truncate (slice 2a); unchanged.
--   3. One read-only view, onboarding_retention: for every Step 1 record, the earliest date anything may be removed:
--      seven years after it was completed or last touched, and for anyone hired, seven years after they leave (shown as
--      "kept while they work here" until then).
-- Nothing is deleted or changed by this file. Safe to run twice (create or replace / drop trigger if exists).
-- Rollback: onboarding-retention-700-rollback.sql removes the trigger and the view only.
-- ============================================================================
begin;
create or replace function public.onboarding_documents_keep() returns trigger
language plpgsql set search_path = pg_catalog, public as $k$
begin
  if coalesce(current_setting('cc.retention_purge', true), '') = 'on' then return case when tg_op = 'DELETE' then old else new end; end if;
  if old.bucket_id = 'onboarding-documents' and old.name not like 'exports/%' then
    if tg_op = 'DELETE' then
      raise exception 'Signed onboarding documents are kept for seven years and cannot be deleted (%).', old.name using errcode = '42501';
    elsif new.bucket_id is distinct from old.bucket_id or new.name is distinct from old.name then
      raise exception 'Signed onboarding documents are kept for seven years and cannot be moved or renamed (%).', old.name using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $k$;
comment on function public.onboarding_documents_keep() is '700 · signed onboarding documents cannot be deleted, moved or renamed (seven-year retention); exports/ excepted';
drop trigger if exists onboarding_documents_keep on storage.objects;
create trigger onboarding_documents_keep before delete or update on storage.objects
  for each row when (old.bucket_id = 'onboarding-documents') execute function public.onboarding_documents_keep();

create or replace view public.onboarding_retention as
  select f.offer_id, f.started_at, f.completed_at, coalesce(f.practice, false) as practice,
         greatest(coalesce(f.completed_at, f.started_at, f.created_at), f.updated_at)::date as basis_date,
         (greatest(coalesce(f.completed_at, f.started_at, f.created_at), f.updated_at) + interval '7 years')::date as earliest_removal_if_never_hired,
         'If they were hired: kept while they work here, then seven years after they leave.'::text as if_hired
    from public.step1_forms f;
comment on view public.onboarding_retention is '700 · the earliest date a Step 1 record may be removed (seven years); read only; nothing removes anything';
revoke all on public.onboarding_retention from anon, authenticated;
commit;
