-- =============================================================================
-- incident_review.sql · INCIDENT REPORT, STAGE 2 (Samantha 2026-10-27, "continue": the office review checklist and the
-- incident list on both profiles). Installed by the Desktop step (incident_review_1147.py) after incident_report.sql (1145).
-- Safe to run again.
--   incident_report.review / reviewed_by / reviewed_by_name / reviewed_at   the office's checklist on a signed report:
--   family told, medical care, care plan change, abuse or neglect (with the hotline call). Saved once, never changed.
-- =============================================================================
alter table public.incident_report add column if not exists review jsonb;
alter table public.incident_report add column if not exists reviewed_by text;
alter table public.incident_report add column if not exists reviewed_by_name text;
alter table public.incident_report add column if not exists reviewed_at timestamptz;

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
  new.updated_at := now();
  return new;
end $f$;
