-- ============================================================================
-- SLICE 2a (Samantha: "proceed with Phase 2a development and fictional testing", 2026-10-09). Hub project.
-- Two tables for Step 1 on the phone. Nothing reads or writes them yet (the signing server is 2b). No existing row,
-- table, policy or grant changes. Safe to run more than once.
--
--   step1_forms     one row per offer: the answers per screen (never the identity fields), the signature of each of
--                   the seven forms (typed name, time, device, browser, version, fingerprint), the PDF paths, progress,
--                   the e-sign consent, the reminders and the receipt. A signed form is never changed: a trigger refuses
--                   any change to a signature or a PDF path once set. Server only: anon and authenticated hold nothing.
--   step1_identity  the lock (section 19): the Social Security number, date of birth and driver's license number as
--                   ciphertext sealed in the function (AES-256-GCM, key only in the function secret STEP1_KEK), the last
--                   four digits, the address, when captured, when to purge, when purged, how many reveals. Server only.
--                   A reveal is allowed only to named screening staff (Admin page list), expires in five minutes, and is
--                   logged in document_access_log (doc = 'identity'), which is already append-only.
-- Rollback (slice2a-step1-tables-rollback.sql): nothing is dropped and no row is deleted; the tables stay empty and
-- unreachable, which is exactly their state before any function uses them.
-- ============================================================================
create table if not exists public.step1_forms (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null unique,
  started_at timestamptz,
  completed_at timestamptz,
  current_screen text,
  answers jsonb not null default '{}'::jsonb,
  signatures jsonb not null default '{}'::jsonb,
  pdfs jsonb not null default '{}'::jsonb,
  esign_consent_at timestamptz,
  esign_consent_detail jsonb,
  reminder_1_at timestamptz,
  reminder_2_at timestamptz,
  receipt jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.step1_forms is '2a · Step 1 on the phone, one row per offer; signatures and PDF paths are write-once (trigger); server only';
create or replace function public.step1_forms_guard() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
declare k text;
begin
  new.updated_at := now();
  for k in select jsonb_object_keys(old.signatures) loop
    if new.signatures -> k is distinct from old.signatures -> k then
      raise exception 'step1_forms: the signature of % is never changed (offer %)', k, old.offer_id using errcode = 'check_violation';
    end if;
  end loop;
  for k in select jsonb_object_keys(old.pdfs) loop
    if new.pdfs -> k is distinct from old.pdfs -> k then
      raise exception 'step1_forms: the stored PDF of % is never replaced (offer %)', k, old.offer_id using errcode = 'check_violation';
    end if;
  end loop;
  if old.completed_at is not null and new.completed_at is distinct from old.completed_at then
    raise exception 'step1_forms: the completion time is never changed (offer %)', old.offer_id using errcode = 'check_violation';
  end if;
  return new;
end $t$;
drop trigger if exists trg_step1_forms_guard on public.step1_forms;
create trigger trg_step1_forms_guard before update on public.step1_forms for each row execute function public.step1_forms_guard();
create or replace function public.step1_no_delete() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
begin
  raise exception 'Step 1 records are never deleted or emptied' using errcode = 'check_violation';
end $t$;
drop trigger if exists trg_step1_forms_no_delete on public.step1_forms;
create trigger trg_step1_forms_no_delete before delete on public.step1_forms for each row execute function public.step1_no_delete();
drop trigger if exists trg_step1_forms_no_truncate on public.step1_forms;
create trigger trg_step1_forms_no_truncate before truncate on public.step1_forms execute function public.step1_no_delete();
alter table public.step1_forms enable row level security;
revoke all privileges on table public.step1_forms from anon, authenticated;

create table if not exists public.step1_identity (
  offer_id uuid primary key,
  ssn_sealed text,
  ssn_last4 text,
  dob_sealed text,
  license_sealed text,
  license_last4 text,
  license_state text,
  license_expires date,
  address1 text, address2 text, city text, state text, zip text,
  captured_at timestamptz not null default now(),
  purge_after timestamptz,
  purged_at timestamptz,
  reveals integer not null default 0,
  updated_at timestamptz not null default now()
);
comment on table public.step1_identity is '2a · the lock (section 19): sealed SSN, date of birth and license number, last four digits, address; purge window to be set once the retention requirement is verified; server only; reveals only by named screening staff, each logged in document_access_log and expiring in five minutes';
drop trigger if exists trg_step1_identity_no_delete on public.step1_identity;
create trigger trg_step1_identity_no_delete before delete on public.step1_identity for each row execute function public.step1_no_delete();
drop trigger if exists trg_step1_identity_no_truncate on public.step1_identity;
create trigger trg_step1_identity_no_truncate before truncate on public.step1_identity execute function public.step1_no_delete();
alter table public.step1_identity enable row level security;
revoke all privileges on table public.step1_identity from anon, authenticated;
