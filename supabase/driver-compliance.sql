-- ============================================================================
-- DRIVER COMPLIANCE (Samantha's 7-point ask, 2026-10-13; spec launch/review/driver-compliance-spec.md). Hub project.
-- Every applicant answers in Step 1 whether they will transport clients in their own vehicle. NO: the Non-Driver Agreement,
-- status Non-Driver. YES: the Driver/Vehicle agreement, photos of the license front and back and proof of insurance, then
-- "Pending Verification" until authorized office staff verify and approve. Uploading never authorizes driving.
--
--   driver_compliance        one row per person (an offer, a roster caregiver, or both); status non_driver | pending |
--                            approved | suspended; the signed agreement; the expiries; who verified what and when; who
--                            approved and when; the reminder stamps. Never deleted. Server only.
--   driver_compliance_event  the full history: append-only (update, delete and truncate refused). Server only.
--   driver_document          one row per uploaded license photo, insurance proof or driving record; a newer one supersedes
--                            (superseded_at), nothing is ever deleted; the path and kind never change once written; a
--                            verification once stamped never changes. Server only.
--   bucket driver-docs       PRIVATE (no public URL), images (jpeg, png, heic, webp) and PDF, 15 MB. Supabase Storage
--                            encrypts objects at rest. Only the server mints short-lived links, and every staff open is a
--                            row in document_access_log. A file there can never be deleted, moved or renamed (the same
--                            guard as 700 for onboarding-documents; the only door is a deliberate purge setting, and no
--                            purge exists).
--   driver_roster_patch      the server's ONLY door onto the caregiver roster for driving: ONE caregiver (by id), ONLY
--                            dl_status, cleared_to_drive, dl_expires, auto_ins_expires, dl_approved_by, dl_approved_at, only
--                            when nobody changed that caregiver since the server read them (_rev, the 421 counter), one
--                            history line tagged driver-compliance. Runs as its owner (the 442 people lock lets it through,
--                            like reference_land_apply); the server role only.
--   evidence_field_kept      learns cleared_to_drive (dl_* and *_expires are already kept), patched in place like
--                            evidence-training-fields.sql so anything another install added stays.
-- Existing drivers: nothing here creates a status for anyone (her rule: no assumption). The profile shows "Not set up yet".
-- Safe to run twice. Rollback: driver-compliance-rollback.sql (removes the door and the storage guard and the evidence word;
-- the tables, their rows, the bucket and its files all stay: no record is ever deleted).
-- ============================================================================
do $guard$ begin
  if to_regprocedure('public.app_data_rev(jsonb)') is null then
    raise exception 'driver compliance refused: app_data_rev (421) is missing. Nothing was changed.'; end if;
  if to_regclass('public.app_data_item_change') is null then
    raise exception 'driver compliance refused: app_data_item_change is missing. Nothing was changed.'; end if;
end $guard$;

begin;
-- ── 1. the record ──────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.driver_compliance (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid unique,
  caregiver_id text unique,
  axiscare_id text,
  name text,
  status text not null check (status in ('non_driver', 'pending', 'approved', 'suspended')),
  status_reason text,
  status_at timestamptz not null default now(),
  agreement_form text check (agreement_form is null or agreement_form in ('vehicle', 'non_driver')),
  agreement_signed_at timestamptz,
  agreement_version int,
  agreement_pdf text,
  license_state text,
  license_expires date,
  insurance_expires date,
  insurer text,
  license_verified_at timestamptz, license_verified_by text,
  insurance_verified_at timestamptz, insurance_verified_by text,
  coverage_verified_at timestamptz, coverage_verified_by text, coverage_note text,
  mvr_verified_at timestamptz, mvr_verified_by text, mvr_result text check (mvr_result is null or mvr_result in ('acceptable', 'not_acceptable')),
  approved_at timestamptz,
  approved_by text,
  reminders jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_compliance_someone check (offer_id is not null or caregiver_id is not null)
);
comment on table public.driver_compliance is 'Driver compliance (2026-10-13): one row per person; status non_driver, pending, approved or suspended; never deleted; server only';

create table if not exists public.driver_compliance_event (
  id bigserial primary key,
  dc_id uuid not null references public.driver_compliance(id),
  at timestamptz not null default now(),
  kind text not null check (kind in ('created', 'agreement_signed', 'doc_uploaded', 'verified', 'approved', 'suspended', 'non_driver',
    'driver_requested', 'reminder_sent', 'reminder_held', 'reminder_refused', 'expired', 'note')),
  by_name text, by_email text, by_person text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists driver_compliance_event_dc on public.driver_compliance_event (dc_id, at);
comment on table public.driver_compliance_event is 'Driver compliance (2026-10-13): the full history, append-only (update, delete and truncate refused)';

create table if not exists public.driver_document (
  id uuid primary key default gen_random_uuid(),
  dc_id uuid not null references public.driver_compliance(id),
  kind text not null check (kind in ('license_front', 'license_back', 'insurance', 'mvr', 'other')),
  path text not null,
  content_type text,
  uploaded_at timestamptz not null default now(),
  uploaded_by text not null,
  expires date,
  verified_at timestamptz, verified_by text,
  superseded_at timestamptz,
  unique (dc_id, path)
);
create index if not exists driver_document_dc on public.driver_document (dc_id, kind);
comment on table public.driver_document is 'Driver compliance (2026-10-13): license photos, insurance proof, driving records in the PRIVATE bucket driver-docs; never deleted; a newer one supersedes';

-- ── 2. guards: never deleted, history append-only, a document's identity and its verification never change ────────
create or replace function public.driver_no_delete() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
begin
  raise exception 'Driver compliance records are never deleted or emptied (%).', tg_table_name using errcode = 'check_violation';
end $t$;
create or replace function public.driver_event_append_only() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
begin
  raise exception 'Driver compliance history is append-only: a line is never changed or removed.' using errcode = 'check_violation';
end $t$;
create or replace function public.driver_compliance_touch() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
begin
  new.updated_at := now();
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'driver_compliance: the record number and its creation time never change' using errcode = 'check_violation';
  end if;
  if old.offer_id is not null and new.offer_id is distinct from old.offer_id then
    raise exception 'driver_compliance: the offer a record belongs to never changes' using errcode = 'check_violation';
  end if;
  if old.caregiver_id is not null and new.caregiver_id is distinct from old.caregiver_id then
    raise exception 'driver_compliance: the caregiver a record belongs to never changes' using errcode = 'check_violation';
  end if;
  return new;
end $t$;
create or replace function public.driver_document_guard() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
begin
  if new.id is distinct from old.id or new.dc_id is distinct from old.dc_id or new.kind is distinct from old.kind or new.path is distinct from old.path
     or new.uploaded_at is distinct from old.uploaded_at or new.uploaded_by is distinct from old.uploaded_by or new.content_type is distinct from old.content_type then
    raise exception 'driver_document: an uploaded document is never changed (only its verification and superseded time are added)' using errcode = 'check_violation';
  end if;
  if old.verified_at is not null and (new.verified_at is distinct from old.verified_at or new.verified_by is distinct from old.verified_by) then
    raise exception 'driver_document: a verification is never changed' using errcode = 'check_violation';
  end if;
  if old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at then
    raise exception 'driver_document: a superseded document stays superseded' using errcode = 'check_violation';
  end if;
  return new;
end $t$;
drop trigger if exists driver_compliance_touch_t on public.driver_compliance;
create trigger driver_compliance_touch_t before update on public.driver_compliance for each row execute function public.driver_compliance_touch();
drop trigger if exists driver_compliance_no_delete on public.driver_compliance;
create trigger driver_compliance_no_delete before delete on public.driver_compliance for each row execute function public.driver_no_delete();
drop trigger if exists driver_compliance_no_truncate on public.driver_compliance;
create trigger driver_compliance_no_truncate before truncate on public.driver_compliance execute function public.driver_no_delete();
drop trigger if exists driver_event_no_change on public.driver_compliance_event;
create trigger driver_event_no_change before update or delete on public.driver_compliance_event for each row execute function public.driver_event_append_only();
drop trigger if exists driver_event_no_truncate on public.driver_compliance_event;
create trigger driver_event_no_truncate before truncate on public.driver_compliance_event execute function public.driver_event_append_only();
drop trigger if exists driver_document_guard_t on public.driver_document;
create trigger driver_document_guard_t before update on public.driver_document for each row execute function public.driver_document_guard();
drop trigger if exists driver_document_no_delete on public.driver_document;
create trigger driver_document_no_delete before delete on public.driver_document for each row execute function public.driver_no_delete();
drop trigger if exists driver_document_no_truncate on public.driver_document;
create trigger driver_document_no_truncate before truncate on public.driver_document execute function public.driver_no_delete();

-- server only: no browser role reads or writes any of the three (the function answers the Hub page)
alter table public.driver_compliance enable row level security;
alter table public.driver_compliance_event enable row level security;
alter table public.driver_document enable row level security;
revoke all privileges on table public.driver_compliance from anon, authenticated;
revoke all privileges on table public.driver_compliance_event from anon, authenticated;
revoke all privileges on table public.driver_document from anon, authenticated;
revoke all privileges on sequence public.driver_compliance_event_id_seq from anon, authenticated;

-- ── 3. the private bucket and its keep-guard ───────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('driver-docs', 'driver-docs', false, 15728640, array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.driver_documents_keep() returns trigger
language plpgsql set search_path = pg_catalog, public as $k$
begin
  if coalesce(current_setting('cc.retention_purge', true), '') = 'on' then return case when tg_op = 'DELETE' then old else new end; end if;
  if old.bucket_id = 'driver-docs' then
    if tg_op = 'DELETE' then
      raise exception 'Driver documents are kept and cannot be deleted (%).', old.name using errcode = '42501';
    elsif new.bucket_id is distinct from old.bucket_id or new.name is distinct from old.name then
      raise exception 'Driver documents are kept and cannot be moved or renamed (%).', old.name using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $k$;
comment on function public.driver_documents_keep() is 'Driver compliance (2026-10-13): files in driver-docs cannot be deleted, moved or renamed';
drop trigger if exists driver_documents_keep on storage.objects;
create trigger driver_documents_keep before delete or update on storage.objects
  for each row when (old.bucket_id = 'driver-docs') execute function public.driver_documents_keep();

-- ── 4. the roster door ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.driver_roster_patch(p_id text, p_base_rev bigint, p_patch jsonb, p_by text default 'driver-compliance')
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $fn$
declare cg jsonb; rec jsonb; idx int := -1; i int; n int := 0; k text; v jsonb; changed text[] := '{}'; outd jsonb; v_rev bigint;
begin
  if p_id is null or p_id = '' or p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'driver_roster_patch: a caregiver number and the fields are needed' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_patch) loop
    if k not in ('dl_status', 'cleared_to_drive', 'dl_expires', 'auto_ins_expires', 'dl_approved_by', 'dl_approved_at') then
      raise exception 'driver_roster_patch: % is not a field driver compliance may write', k using errcode = '22023';
    end if;
    if k = 'dl_status' and not (jsonb_typeof(v) = 'string' and v #>> '{}' in ('Non-Driver', 'Pending Verification', 'Approved Driver', 'Suspended')) then
      raise exception 'driver_roster_patch: dl_status must be Non-Driver, Pending Verification, Approved Driver or Suspended' using errcode = '22023';
    end if;
    if k = 'cleared_to_drive' and jsonb_typeof(v) <> 'boolean' then
      raise exception 'driver_roster_patch: cleared_to_drive must be true or false' using errcode = '22023';
    end if;
    if k in ('dl_expires', 'auto_ins_expires') and not (jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and v #>> '{}' ~ '^\d{4}-\d{2}-\d{2}$')) then
      raise exception 'driver_roster_patch: % must be a date (YYYY-MM-DD)', k using errcode = '22023';
    end if;
    if k in ('dl_approved_by', 'dl_approved_at') and jsonb_typeof(v) not in ('string', 'null') then
      raise exception 'driver_roster_patch: % must be text', k using errcode = '22023';
    end if;
  end loop;
  select data into cg from public.app_data where key = 'caregivers' for update;
  if cg is null or jsonb_typeof(cg) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  for i in 0 .. jsonb_array_length(cg) - 1 loop
    if jsonb_typeof(cg->i) = 'object' and (cg->i)->>'id' = p_id then n := n + 1; idx := i; end if;
  end loop;
  if n = 0 then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  if n > 1 then return jsonb_build_object('ok', false, 'reason', 'duplicate_id'); end if;
  rec := cg->idx;
  if public.app_data_rev(rec) <> coalesce(p_base_rev, -1) then
    return jsonb_build_object('ok', false, 'reason', 'changed', 'current_record', rec);
  end if;
  select coalesce(array_agg(e.key order by e.key), '{}') into changed from jsonb_each(p_patch) e where (rec->e.key) is distinct from e.value;
  if array_length(changed, 1) is null then
    return jsonb_build_object('ok', true, 'unchanged', true, 'rev', public.app_data_rev(rec), 'fields', '[]'::jsonb);
  end if;
  update public.app_data set data = jsonb_set(cg, array[idx::text], (rec - '_rev') || p_patch), updated_at = now()
   where key = 'caregivers' returning data into outd;
  v_rev := public.app_data_rev(outd->idx);
  insert into public.app_data_item_change (key, record_id, change, fields_changed, actor, role, origin)
  values ('caregivers', p_id, 'changed', changed, left(coalesce(nullif(p_by, ''), 'driver-compliance'), 120), 'service_role', 'driver-compliance');
  return jsonb_build_object('ok', true, 'rev', v_rev, 'fields', to_jsonb(changed));
end $fn$;
revoke all on function public.driver_roster_patch(text, bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.driver_roster_patch(text, bigint, jsonb, text) to service_role;
commit;

-- ── 5. the value history learns cleared_to_drive (patched in place; refuses a rule it does not recognise) ──────────
do $p$ declare src text; begin
  if to_regprocedure('public.evidence_field_kept(text,text)') is null then raise notice 'no evidence_field_kept here (slice 9 not installed): nothing to widen'; return; end if;
  src := pg_get_functiondef('public.evidence_field_kept(text,text)'::regprocedure);
  if position('''cleared_to_drive''' in src) > 0 then raise notice 'cleared_to_drive already kept: nothing to do'; return; end if;
  if position('''hire_date'', ''axiscare_id''' in src) = 0 then raise exception 'the live evidence_field_kept is not the expected one; the rest of driver compliance is installed, the history word was not added'; end if;
  execute replace(src, '''hire_date'', ''axiscare_id''', '''hire_date'', ''cleared_to_drive'', ''axiscare_id''');
  if not public.evidence_field_kept('caregivers', 'cleared_to_drive') or not public.evidence_field_kept('caregivers', 'dl_status') or public.evidence_field_kept('caregivers', 'ssn') then
    raise exception 'self-check failed: the history rule did not learn cleared_to_drive'; end if;
end $p$;

-- ── 6. self-checks ─────────────────────────────────────────────────────────────────────────────────────────────────
do $v$ begin
  if has_function_privilege('authenticated', 'public.driver_roster_patch(text, bigint, jsonb, text)', 'execute')
     or has_function_privilege('anon', 'public.driver_roster_patch(text, bigint, jsonb, text)', 'execute') then
    raise exception 'driver compliance self-check: only the server may call driver_roster_patch'; end if;
  if not exists (select 1 from pg_proc where proname = 'driver_roster_patch' and pronamespace = 'public'::regnamespace and prosecdef) then
    raise exception 'driver compliance self-check: driver_roster_patch must run as its owner'; end if;
  if has_table_privilege('authenticated', 'public.driver_compliance', 'select') or has_table_privilege('anon', 'public.driver_compliance', 'select')
     or has_table_privilege('authenticated', 'public.driver_document', 'select') or has_table_privilege('authenticated', 'public.driver_compliance_event', 'select') then
    raise exception 'driver compliance self-check: a browser role can read a driver table'; end if;
  if not exists (select 1 from storage.buckets where id = 'driver-docs' and public = false) then
    raise exception 'driver compliance self-check: the driver-docs bucket is missing or public'; end if;
end $v$;
