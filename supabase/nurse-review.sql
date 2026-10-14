-- ============================================================================
-- RN REVIEW (LPN nurse visit plan, steps 5 to 7; Samantha approved "approve nursing plan" 2026-10-14; build spec
-- launch/review/lpn/build-spec.md). Hub project. Natasha Early (RN, W-2 employee) reviews her LPNs' work on her own page
-- (cc.mo-care.com/rn.html), which reads and writes ONLY through the rn-review function. Nothing here is a browser table.
--
--   nurse_flag          an LPN's "Mark for Natasha": the client (Hub nurse client and AxisCare id), the visit or date, the
--                       nurse service key, what was seen, who and when; open until the RN reviews it with her note
--                       (reviewed_at, reviewed_by). A review is final. Never deleted. Server only.
--   rn_ghe_signature    the RN's write-once signature on an LPN's GHE: one per GHE form (unique), who, when, the typed name,
--                       the consent words, the device, the fingerprint of the answers and signatures she signed, the signed
--                       PDF. Nothing in a row ever changes, except the PDF path and the form-updated time, each set once.
--   rn_review_event     the history: append-only (update, delete and truncate refused).
--   bucket nurse-docs   PRIVATE, PDF only, 10 MB: the signed review PDFs. A file there can never be deleted, moved or
--                       renamed (the 700 keep-guard; the only door is a deliberate purge setting, and no purge exists).
--   rn_review_retention read only: the earliest date anything here may be removed (seven years; nothing removes anything).
-- Every open of a GHE, a nursing history or a signed PDF is a row in the existing document_access_log (logOpen).
-- Nothing here changes app_data, a switch or anyone's record. Safe to run twice.
-- Rollback: nurse-review-rollback.sql (removes the storage guard and the view; every table, row and file stays).
-- ============================================================================
begin;
-- ── 1. the tables ─────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.nurse_flag (
  id uuid primary key default gen_random_uuid(),
  client_id text,
  client_axiscare_id text,
  client_name text,
  visit_id text,
  visit_date date,
  service_key text not null check (service_key ~ '^[a-z0-9_]{2,40}$'),
  service_name text,
  seen text not null check (length(btrim(seen)) >= 5),
  by_name text not null,
  by_email text,
  by_person text,
  entered_by text,
  at timestamptz not null default now(),
  rn_name text,
  status text not null default 'open' check (status in ('open', 'reviewed')),
  rn_note text,
  reviewed_at timestamptz,
  reviewed_by text,
  reviewed_by_email text,
  practice boolean not null default false,
  constraint nurse_flag_client check (client_id is not null or client_axiscare_id is not null),
  constraint nurse_flag_review check ((status = 'open' and reviewed_at is null and rn_note is null and reviewed_by is null)
    or (status = 'reviewed' and reviewed_at is not null and reviewed_by is not null and length(btrim(coalesce(rn_note, ''))) >= 5))
);
create index if not exists nurse_flag_open on public.nurse_flag (status, rn_name);
create index if not exists nurse_flag_client on public.nurse_flag (client_id);
comment on table public.nurse_flag is 'RN review (2026-10-14): an LPN''s Mark for Natasha; open until the RN reviews it with her note; a review is final; never deleted; server only';

create table if not exists public.rn_ghe_signature (
  id uuid primary key default gen_random_uuid(),
  ghe_id text not null unique,
  client_id text,
  client_axiscare_id text,
  client_name text,
  visit_date date,
  lpn_name text,
  rn_name text not null,
  rn_email text not null,
  rn_person text,
  typed_name text not null check (length(btrim(typed_name)) >= 4),
  consent boolean not null check (consent),
  consent_words text not null,
  version int not null,
  signed_at timestamptz not null default now(),
  ip text,
  agent text,
  form_fingerprint text not null check (form_fingerprint ~ '^[0-9a-f]{64}$'),
  pdf_path text,
  form_updated_at timestamptz,
  practice boolean not null default false
);
comment on table public.rn_ghe_signature is 'RN review (2026-10-14): the supervising RN''s write-once signature on an LPN''s GHE (one per form); never changed or deleted; server only';

create table if not exists public.rn_review_event (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('signed', 'sent_back', 'flag_created', 'flag_reviewed', 'pdf_failed', 'form_updated', 'form_update_failed')),
  ghe_id text,
  flag_id uuid,
  client_ref text,
  by_name text, by_email text, by_person text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists rn_review_event_ghe on public.rn_review_event (ghe_id, at);
comment on table public.rn_review_event is 'RN review (2026-10-14): the history, append-only (update, delete and truncate refused)';

-- ── 2. guards ──────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.rn_review_no_delete() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
begin
  raise exception 'RN review records are kept and are never deleted or emptied (%).', tg_table_name using errcode = 'check_violation';
end $t$;
create or replace function public.rn_review_event_append_only() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
begin
  raise exception 'RN review history is append-only: a line is never changed or removed.' using errcode = 'check_violation';
end $t$;
create or replace function public.nurse_flag_guard() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
begin
  if new.id is distinct from old.id or new.client_id is distinct from old.client_id or new.client_axiscare_id is distinct from old.client_axiscare_id
     or new.client_name is distinct from old.client_name or new.visit_id is distinct from old.visit_id or new.visit_date is distinct from old.visit_date
     or new.service_key is distinct from old.service_key or new.service_name is distinct from old.service_name or new.seen is distinct from old.seen
     or new.by_name is distinct from old.by_name or new.by_email is distinct from old.by_email or new.by_person is distinct from old.by_person
     or new.entered_by is distinct from old.entered_by or new.at is distinct from old.at or new.practice is distinct from old.practice then
    raise exception 'nurse_flag: what the LPN marked is never changed (only the RN''s review is added)' using errcode = 'check_violation';
  end if;
  if old.status = 'reviewed' and (new.status is distinct from old.status or new.rn_note is distinct from old.rn_note or new.reviewed_at is distinct from old.reviewed_at
     or new.reviewed_by is distinct from old.reviewed_by or new.reviewed_by_email is distinct from old.reviewed_by_email or new.rn_name is distinct from old.rn_name) then
    raise exception 'nurse_flag: a review is final and never changed' using errcode = 'check_violation';
  end if;
  return new;
end $t$;
create or replace function public.rn_ghe_signature_guard() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
begin
  if (to_jsonb(new) - 'pdf_path' - 'form_updated_at') is distinct from (to_jsonb(old) - 'pdf_path' - 'form_updated_at') then
    raise exception 'rn_ghe_signature: a signature is write-once and never changed' using errcode = 'check_violation';
  end if;
  if old.pdf_path is not null and new.pdf_path is distinct from old.pdf_path then
    raise exception 'rn_ghe_signature: the signed PDF of a signature never changes' using errcode = 'check_violation';
  end if;
  if old.form_updated_at is not null and new.form_updated_at is distinct from old.form_updated_at then
    raise exception 'rn_ghe_signature: the form-updated time is set once' using errcode = 'check_violation';
  end if;
  return new;
end $t$;
drop trigger if exists nurse_flag_guard_t on public.nurse_flag;
create trigger nurse_flag_guard_t before update on public.nurse_flag for each row execute function public.nurse_flag_guard();
drop trigger if exists nurse_flag_no_delete on public.nurse_flag;
create trigger nurse_flag_no_delete before delete on public.nurse_flag for each row execute function public.rn_review_no_delete();
drop trigger if exists nurse_flag_no_truncate on public.nurse_flag;
create trigger nurse_flag_no_truncate before truncate on public.nurse_flag execute function public.rn_review_no_delete();
drop trigger if exists rn_ghe_signature_guard_t on public.rn_ghe_signature;
create trigger rn_ghe_signature_guard_t before update on public.rn_ghe_signature for each row execute function public.rn_ghe_signature_guard();
drop trigger if exists rn_ghe_signature_no_delete on public.rn_ghe_signature;
create trigger rn_ghe_signature_no_delete before delete on public.rn_ghe_signature for each row execute function public.rn_review_no_delete();
drop trigger if exists rn_ghe_signature_no_truncate on public.rn_ghe_signature;
create trigger rn_ghe_signature_no_truncate before truncate on public.rn_ghe_signature execute function public.rn_review_no_delete();
drop trigger if exists rn_review_event_no_change on public.rn_review_event;
create trigger rn_review_event_no_change before update or delete on public.rn_review_event for each row execute function public.rn_review_event_append_only();
drop trigger if exists rn_review_event_no_truncate on public.rn_review_event;
create trigger rn_review_event_no_truncate before truncate on public.rn_review_event execute function public.rn_review_event_append_only();

-- server only: no browser role reads or writes any of the three (the function answers the pages); never a blanket grant
alter table public.nurse_flag enable row level security;
alter table public.rn_ghe_signature enable row level security;
alter table public.rn_review_event enable row level security;
revoke all privileges on table public.nurse_flag from anon, authenticated;
revoke all privileges on table public.rn_ghe_signature from anon, authenticated;
revoke all privileges on table public.rn_review_event from anon, authenticated;
revoke all privileges on sequence public.rn_review_event_id_seq from anon, authenticated;
grant select, insert, update on table public.nurse_flag, public.rn_ghe_signature to service_role;
grant select, insert on table public.rn_review_event to service_role;
grant usage on sequence public.rn_review_event_id_seq to service_role;

-- ── 3. the private bucket and its keep-guard (the 700 pattern) ─────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nurse-docs', 'nurse-docs', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.nurse_documents_keep() returns trigger
language plpgsql set search_path = pg_catalog, public as $k$
begin
  if coalesce(current_setting('cc.retention_purge', true), '') = 'on' then return case when tg_op = 'DELETE' then old else new end; end if;
  if old.bucket_id = 'nurse-docs' then
    if tg_op = 'DELETE' then
      raise exception 'Signed nursing documents are kept for seven years and cannot be deleted (%).', old.name using errcode = '42501';
    elsif new.bucket_id is distinct from old.bucket_id or new.name is distinct from old.name then
      raise exception 'Signed nursing documents are kept for seven years and cannot be moved or renamed (%).', old.name using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $k$;
comment on function public.nurse_documents_keep() is 'RN review (2026-10-14): files in nurse-docs cannot be deleted, moved or renamed (seven-year retention)';
drop trigger if exists nurse_documents_keep on storage.objects;
create trigger nurse_documents_keep before delete or update on storage.objects
  for each row when (old.bucket_id = 'nurse-docs') execute function public.nurse_documents_keep();

-- ── 4. seven years, read only ──────────────────────────────────────────────────────────────────────────────────────
create or replace view public.rn_review_retention as
  select 'signature'::text as what, s.id::text as id, s.ghe_id, s.client_name, s.signed_at as basis, (s.signed_at + interval '7 years')::date as earliest_removal, s.practice
    from public.rn_ghe_signature s
  union all
  select 'flag', f.id::text, null, f.client_name, coalesce(f.reviewed_at, f.at), (coalesce(f.reviewed_at, f.at) + interval '7 years')::date, f.practice
    from public.nurse_flag f;
comment on view public.rn_review_retention is 'RN review (2026-10-14): the earliest date a signature or flag may be removed (seven years); read only; nothing removes anything';
revoke all on public.rn_review_retention from anon, authenticated;
commit;

-- ── 5. self-checks ─────────────────────────────────────────────────────────────────────────────────────────────────
do $v$ begin
  if has_table_privilege('authenticated', 'public.nurse_flag', 'select') or has_table_privilege('anon', 'public.nurse_flag', 'select')
     or has_table_privilege('authenticated', 'public.rn_ghe_signature', 'select') or has_table_privilege('authenticated', 'public.rn_review_event', 'select')
     or has_table_privilege('authenticated', 'public.nurse_flag', 'insert') or has_table_privilege('authenticated', 'public.rn_ghe_signature', 'insert') then
    raise exception 'RN review self-check: a browser role can reach an RN review table'; end if;
  if not exists (select 1 from storage.buckets where id = 'nurse-docs' and public = false) then
    raise exception 'RN review self-check: the nurse-docs bucket is missing or public'; end if;
end $v$;
