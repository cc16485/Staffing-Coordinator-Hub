-- =============================================================================
-- incident_investigation.sql · INCIDENTS TO HR (Samantha 2026-10-27: "Zach needs to be involved in incident reports as
-- well... it needs to be investigated further which i dont want the care coordinators to have to do"). Installed by the
-- Desktop step after incident_review.sql (1147). Safe to run again.
--   inv_ask / inv_asked_by / inv_asked_by_name / inv_asked_at   the office hands a report to Zach, with why. Saved once.
--   inv_findings / inv_by / inv_by_name / inv_at               what Zach found and what happens next. Saved once.
-- =============================================================================
alter table public.incident_report add column if not exists inv_ask jsonb;
alter table public.incident_report add column if not exists inv_asked_by text;
alter table public.incident_report add column if not exists inv_asked_by_name text;
alter table public.incident_report add column if not exists inv_asked_at timestamptz;
alter table public.incident_report add column if not exists inv_findings jsonb;
alter table public.incident_report add column if not exists inv_by text;
alter table public.incident_report add column if not exists inv_by_name text;
alter table public.incident_report add column if not exists inv_at timestamptz;

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
  -- Stage 2: a review only on a signed report, and once saved it never changes
  if new.reviewed_at is not null and old.reviewed_at is null and old.status <> 'submitted' then
    raise exception 'Only a signed incident report can be reviewed.' using errcode = '42501'; end if;
  if old.reviewed_at is not null and (new.review is distinct from old.review or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_by_name is distinct from old.reviewed_by_name or new.reviewed_at is distinct from old.reviewed_at) then
    raise exception 'A saved incident review cannot be changed.' using errcode = '42501'; end if;
  -- HR (2026-10-27): handing it to Zach, and what he found, are each saved once; never on a cancelled report
  if new.inv_asked_at is not null and old.inv_asked_at is null and old.status = 'cancelled' then
    raise exception 'A cancelled incident report cannot be looked into.' using errcode = '42501'; end if;
  if old.inv_asked_at is not null and (new.inv_ask is distinct from old.inv_ask or new.inv_asked_by is distinct from old.inv_asked_by
     or new.inv_asked_by_name is distinct from old.inv_asked_by_name or new.inv_asked_at is distinct from old.inv_asked_at) then
    raise exception 'Who asked for an incident to be looked into, and why, cannot be changed.' using errcode = '42501'; end if;
  if new.inv_at is not null and old.inv_at is null and new.inv_asked_at is null then
    raise exception 'Nobody asked for this incident to be looked into.' using errcode = '42501'; end if;
  if old.inv_at is not null and (new.inv_findings is distinct from old.inv_findings or new.inv_by is distinct from old.inv_by
     or new.inv_by_name is distinct from old.inv_by_name or new.inv_at is distinct from old.inv_at) then
    raise exception 'What was found cannot be changed once written.' using errcode = '42501'; end if;
  new.updated_at := now();
  return new;
end $f$;
