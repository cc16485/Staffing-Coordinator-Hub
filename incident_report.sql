-- =============================================================================
-- incident_report.sql · INCIDENT REPORT, STAGE 1 (Samantha 2026-10-27: "build the incident report as planned with your
-- three picks. Start with Stage 1 so Ashley's report can go out"). Installed by the Desktop step (incident_report_s1.py).
-- Safe to run again.
--   incident_report        one row per report: who, which client, which day, the private link (only its hash), the
--                          caregiver's answers and finger signature once signed, the PDF. Server only: the incident-report
--                          function is the only door (the office via sign-in, the caregiver via their link). Never deleted.
--   incident_event         every step (started, sent, opened, reminded, submitted, cancelled), append only.
--   bucket incident-docs   PRIVATE PDFs (health information); never deleted, moved or renamed. Opens go through
--                          incident-report (office only, every open logged in document_access_log).
--   ops_settings.incident_reports_live  added OFF if missing (practice: nothing texted, no card).
-- =============================================================================
create table if not exists public.incident_report (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'client' check (kind in ('client', 'employee_injury')),
  practice boolean not null default true,
  client_ax text,
  client_name text not null,
  caregiver text not null,
  happened_on date not null,
  source_item_id text,
  card_id text,
  note_words text,
  caregiver_phone_hint text,
  token_hash text unique,
  expires_at timestamptz,
  status text not null default 'waiting' check (status in ('waiting', 'submitted', 'cancelled')),
  started_by text not null,
  started_by_name text,
  started_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by text,
  opened_at timestamptz,
  reminded_at timestamptz,
  answers jsonb,
  answers_hash text,
  signature jsonb,
  signed_name text,
  submitted_at timestamptz,
  sign_ip text,
  sign_agent text,
  told_late boolean,
  pdf_path text,
  cancelled_at timestamptz,
  cancelled_by text,
  updated_at timestamptz not null default now()
);
create index if not exists incident_report_client on public.incident_report (client_ax, started_at);
create index if not exists incident_report_source on public.incident_report (source_item_id);
create index if not exists incident_report_waiting on public.incident_report (status, sent_at) where status = 'waiting';
comment on table public.incident_report is '2026-10-27 incident report (Stage 1): the caregiver''s signed account. Server only (incident-report). Never deleted.';

create table if not exists public.incident_event (
  id bigserial primary key,
  report_id uuid not null references public.incident_report(id),
  at timestamptz not null default now(),
  kind text not null,
  by_email text,
  by_name text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists incident_event_report on public.incident_event (report_id, at);
comment on table public.incident_event is '2026-10-27: every incident report step, append only.';

create or replace function public.incident_report_no_delete() returns trigger
language plpgsql set search_path = pg_catalog, public as $f$
begin raise exception 'Incident reports are kept and cannot be deleted.' using errcode = '42501'; end $f$;
create or replace function public.incident_event_append_only() returns trigger
language plpgsql set search_path = pg_catalog, public as $f$
begin raise exception 'The incident report history can only be added to.' using errcode = '42501'; end $f$;
create or replace function public.incident_report_guard() returns trigger
language plpgsql set search_path = pg_catalog, public as $f$
begin
  -- who, which client, which day and practice never change once started
  if new.client_name is distinct from old.client_name or new.caregiver is distinct from old.caregiver or new.happened_on is distinct from old.happened_on
     or new.practice is distinct from old.practice or new.kind is distinct from old.kind or new.started_by is distinct from old.started_by then
    raise exception 'Who and when on an incident report cannot be changed. Cancel it and start a new one.' using errcode = '42501'; end if;
  -- what the caregiver signed never changes
  if old.status = 'submitted' and (new.status is distinct from old.status or new.answers is distinct from old.answers or new.signature is distinct from old.signature
     or new.signed_name is distinct from old.signed_name or new.submitted_at is distinct from old.submitted_at or new.pdf_path is distinct from old.pdf_path) then
    raise exception 'A signed incident report cannot be changed.' using errcode = '42501'; end if;
  if old.status = 'cancelled' and new.status is distinct from old.status then
    raise exception 'A cancelled incident report stays cancelled. Start a new one.' using errcode = '42501'; end if;
  new.updated_at := now();
  return new;
end $f$;
drop trigger if exists incident_report_guard_t on public.incident_report;
create trigger incident_report_guard_t before update on public.incident_report for each row execute function public.incident_report_guard();
drop trigger if exists incident_report_no_delete on public.incident_report;
create trigger incident_report_no_delete before delete on public.incident_report for each row execute function public.incident_report_no_delete();
drop trigger if exists incident_report_no_truncate on public.incident_report;
create trigger incident_report_no_truncate before truncate on public.incident_report execute function public.incident_report_no_delete();
drop trigger if exists incident_event_no_change on public.incident_event;
create trigger incident_event_no_change before update or delete on public.incident_event for each row execute function public.incident_event_append_only();
drop trigger if exists incident_event_no_truncate on public.incident_event;
create trigger incident_event_no_truncate before truncate on public.incident_event execute function public.incident_event_append_only();

-- server only
alter table public.incident_report enable row level security;
alter table public.incident_event enable row level security;
revoke all privileges on table public.incident_report from anon, authenticated;
revoke all privileges on table public.incident_event from anon, authenticated;
revoke all privileges on sequence public.incident_event_id_seq from anon, authenticated;
grant all on public.incident_report, public.incident_event to service_role;
grant usage, select on sequence public.incident_event_id_seq to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incident-docs', 'incident-docs', false, 15728640, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.incident_docs_keep() returns trigger
language plpgsql set search_path = pg_catalog, public as $k$
begin
  if coalesce(current_setting('cc.retention_purge', true), '') = 'on' then return case when tg_op = 'DELETE' then old else new end; end if;
  if old.bucket_id = 'incident-docs' then
    if tg_op = 'DELETE' then
      raise exception 'Incident reports are kept and cannot be deleted (%).', old.name using errcode = '42501';
    elsif new.bucket_id is distinct from old.bucket_id or new.name is distinct from old.name then
      raise exception 'Incident reports cannot be moved or renamed (%).', old.name using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $k$;
drop trigger if exists incident_docs_keep on storage.objects;
create trigger incident_docs_keep before delete or update on storage.objects
  for each row when (old.bucket_id = 'incident-docs') execute function public.incident_docs_keep();

-- the switch, OFF if it was never set (never turned off here if Samantha already turned it on)
update public.app_data set data = data || '{"incident_reports_live": false}'::jsonb
 where key = 'ops_settings' and not (data ? 'incident_reports_live');
