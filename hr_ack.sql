-- =============================================================================
-- hr_ack.sql · WRITE-UP ACKNOWLEDGMENT (HR Agent build step 8, Samantha 2026-10-18: "build step 8")
-- Installed by Desktop step 968 (hr_ack_968.py). Safe to run again.
-- Her decisions (2026-10-18): the caregiver signs that they RECEIVED the notice, not that they agree, with a typed full
-- name and a tick, on a private link Zach texts (he sees the exact words and presses Send) or in person on an office or
-- Zach's phone. If they refuse, Zach records it with the date, how it was delivered and a witness (no witness only with a
-- reason). A link not signed in 5 business days shows on his dashboard to record as "Did not sign". The signed or refused
-- notice is kept as a PDF and filed: the Performance tab in the Hub, a short note in AxisCare, and a task for Zach to
-- upload the PDF in AxisCare (its system takes no files).
--   hr_ack        one row per notice sent for acknowledgment: a snapshot of the notice, the private link (only its hash),
--                 the outcome and who recorded it. Server only: the hr-ack function is the only door (owners via sign-in,
--                 the caregiver via their link). Never deleted.
--   hr_ack_event  every step (sent, opened, signed, refused, filed), append only.
--   bucket hr-docs  PRIVATE PDFs; never deleted, moved or renamed. Opens go through hr-ack (owners only, every open logged
--                 in document_access_log).
-- =============================================================================
create table if not exists public.hr_ack (
  id uuid primary key default gen_random_uuid(),
  writeup_id text not null,
  practice boolean not null default true,
  caregiver text not null,
  axiscare_caregiver_id text,
  level text not null default '',
  notice text not null,
  notice_hash text not null,
  via text not null check (via in ('link', 'in_person', 'sample')),
  token_hash text unique,
  expires_at timestamptz,
  status text not null default 'waiting' check (status in ('waiting', 'signed', 'refused', 'did_not_sign', 'cancelled')),
  started_by text not null,
  started_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by text,
  opened_at timestamptz,
  signed_name text,
  signed_at timestamptz,
  sign_ip text,
  sign_agent text,
  refused_on date,
  refused_how text,
  witness text,
  witness_reason text,
  recorded_by text,
  recorded_at timestamptz,
  note text,
  pdf_path text,
  ax_note text check (ax_note in ('sent', 'failed', 'skipped')),
  ax_note_error text,
  ax_upload_at timestamptz,
  ax_upload_by text,
  updated_at timestamptz not null default now()
);
create index if not exists hr_ack_writeup on public.hr_ack (writeup_id, started_at);
comment on table public.hr_ack is '968 (2026-10-18): write-up acknowledgment (received, not agreed) or refusal with witness. Server only (hr-ack). Never deleted.';

create table if not exists public.hr_ack_event (
  id bigserial primary key,
  ack_id uuid not null references public.hr_ack(id),
  at timestamptz not null default now(),
  kind text not null,
  by_email text,
  by_name text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists hr_ack_event_ack on public.hr_ack_event (ack_id, at);
comment on table public.hr_ack_event is '968 (2026-10-18): every acknowledgment step, append only.';

create or replace function public.hr_ack_no_delete() returns trigger
language plpgsql set search_path = pg_catalog, public as $f$
begin raise exception 'HR acknowledgment records are kept and cannot be deleted.' using errcode = '42501'; end $f$;
create or replace function public.hr_ack_event_append_only() returns trigger
language plpgsql set search_path = pg_catalog, public as $f$
begin raise exception 'The acknowledgment history can only be added to.' using errcode = '42501'; end $f$;
create or replace function public.hr_ack_guard() returns trigger
language plpgsql set search_path = pg_catalog, public as $f$
begin
  -- what was sent and signed never changes: the notice, its hash, the signature and a finished outcome
  if new.notice is distinct from old.notice or new.notice_hash is distinct from old.notice_hash or new.writeup_id is distinct from old.writeup_id
     or new.practice is distinct from old.practice then
    raise exception 'The notice on an acknowledgment cannot be changed.' using errcode = '42501'; end if;
  if old.status in ('signed', 'refused', 'did_not_sign') and (new.status is distinct from old.status or new.signed_name is distinct from old.signed_name
     or new.signed_at is distinct from old.signed_at or new.witness is distinct from old.witness or new.refused_on is distinct from old.refused_on
     or new.pdf_path is distinct from old.pdf_path and old.pdf_path is not null) then
    raise exception 'A finished acknowledgment cannot be changed.' using errcode = '42501'; end if;
  new.updated_at := now();
  return new;
end $f$;
drop trigger if exists hr_ack_guard_t on public.hr_ack;
create trigger hr_ack_guard_t before update on public.hr_ack for each row execute function public.hr_ack_guard();
drop trigger if exists hr_ack_no_delete on public.hr_ack;
create trigger hr_ack_no_delete before delete on public.hr_ack for each row execute function public.hr_ack_no_delete();
drop trigger if exists hr_ack_no_truncate on public.hr_ack;
create trigger hr_ack_no_truncate before truncate on public.hr_ack execute function public.hr_ack_no_delete();
drop trigger if exists hr_ack_event_no_change on public.hr_ack_event;
create trigger hr_ack_event_no_change before update or delete on public.hr_ack_event for each row execute function public.hr_ack_event_append_only();
drop trigger if exists hr_ack_event_no_truncate on public.hr_ack_event;
create trigger hr_ack_event_no_truncate before truncate on public.hr_ack_event execute function public.hr_ack_event_append_only();

-- server only
alter table public.hr_ack enable row level security;
alter table public.hr_ack_event enable row level security;
revoke all privileges on table public.hr_ack from anon, authenticated;
revoke all privileges on table public.hr_ack_event from anon, authenticated;
revoke all privileges on sequence public.hr_ack_event_id_seq from anon, authenticated;
grant all on public.hr_ack, public.hr_ack_event to service_role;
grant usage, select on sequence public.hr_ack_event_id_seq to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-docs', 'hr-docs', false, 15728640, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.hr_docs_keep() returns trigger
language plpgsql set search_path = pg_catalog, public as $k$
begin
  if coalesce(current_setting('cc.retention_purge', true), '') = 'on' then return case when tg_op = 'DELETE' then old else new end; end if;
  if old.bucket_id = 'hr-docs' then
    if tg_op = 'DELETE' then
      raise exception 'HR documents are kept and cannot be deleted (%).', old.name using errcode = '42501';
    elsif new.bucket_id is distinct from old.bucket_id or new.name is distinct from old.name then
      raise exception 'HR documents cannot be moved or renamed (%).', old.name using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $k$;
drop trigger if exists hr_docs_keep on storage.objects;
create trigger hr_docs_keep before delete or update on storage.objects
  for each row when (old.bucket_id = 'hr-docs') execute function public.hr_docs_keep();
