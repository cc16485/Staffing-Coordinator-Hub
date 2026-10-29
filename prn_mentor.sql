-- =============================================================================
-- PRN STEP 8a · GAP MENTORS (Samantha 2026-10-29: "Yes, build step 8 (Gap Mentors) with its switches off"; plan section 4b)
-- prn_mentor_visits: each "Ask a Gap Mentor" (a refresher with a caregiver, a care update visit, a concern-only supervisory
-- visit), who asked, the family's OK, who it was assigned to (the coordinator puts it in AxisCare), and the mentor's note.
-- prn_mentor_answers: each Gap Mentor's "I can do it" / "Not this time" (one per mentor per visit; a no is never counted).
-- Kept: no deletes (a visit is cancelled, not removed); a note, once in, stays. Office staff read; only the server writes.
-- Adds only; safe to run again.
-- =============================================================================
set local lock_timeout = '5s';
create table if not exists public.prn_mentor_visits (
  id             bigserial primary key,
  kind           text not null check (kind in ('refresher', 'care_update', 'supervisory')),
  client_ax      text not null check (client_ax ~ '^\d+$'),
  client_name    text not null check (length(btrim(client_name)) between 1 and 80),
  visit_date     date not null,
  visit_time     text not null check (visit_time ~ '^\d\d:\d\d-\d\d:\d\d$'),
  skill          text check (skill is null or skill in ('hoyer', 'transfers', 'bathing', 'dementia', 'falls')),
  caregiver_ax   text,
  caregiver_name text,
  note           text check (note is null or length(note) <= 500),
  family_ok      boolean,
  guide          boolean not null default false,
  va             boolean not null default false,
  status         text not null default 'open' check (status in ('open', 'assigned', 'done', 'cancelled')),
  asked_by       text not null,
  asked_at       timestamptz not null default now(),
  assigned_to    uuid references public.job_applicants(id) on delete restrict,
  assigned_by    text,
  assigned_at    timestamptz,
  report         jsonb,
  report_at      timestamptz,
  cancelled_by   text,
  cancelled_at   timestamptz,
  constraint prn_mentor_refresher_has_caregiver check (kind <> 'refresher' or (caregiver_ax is not null and caregiver_name is not null and skill is not null and family_ok is true)),
  constraint prn_mentor_update_has_family_ok check (kind <> 'care_update' or family_ok is true),
  constraint prn_mentor_assigned_has_who check (status not in ('assigned', 'done') or assigned_to is not null)
);
create index if not exists prn_mentor_visits_open_idx on public.prn_mentor_visits (status, visit_date);
create index if not exists prn_mentor_visits_client_idx on public.prn_mentor_visits (client_ax, asked_at desc);
create table if not exists public.prn_mentor_answers (
  id            bigserial primary key,
  visit_id      bigint not null references public.prn_mentor_visits(id) on delete restrict,
  applicant_id  uuid not null references public.job_applicants(id) on delete restrict,
  answer        text not null check (answer in ('yes', 'no')),
  at            timestamptz not null default now(),
  unique (visit_id, applicant_id)
);
comment on table public.prn_mentor_visits is 'PRN step 8a: Gap Mentor visits (refresher, care update, concern-only supervisory), asked from a client''s Care tab.';
comment on table public.prn_mentor_answers is 'PRN step 8a: a Gap Mentor''s answer to a visit (yes / not this time). A no is never counted.';
do $g$ begin
  execute 'alter table public.prn_mentor_visits enable row level security';
  execute 'alter table public.prn_mentor_answers enable row level security';
end $g$;
drop policy if exists prn_mentor_visits_read on public.prn_mentor_visits;
create policy prn_mentor_visits_read on public.prn_mentor_visits for select to authenticated using (true);
drop policy if exists prn_mentor_answers_read on public.prn_mentor_answers;
create policy prn_mentor_answers_read on public.prn_mentor_answers for select to authenticated using (true);
revoke all on public.prn_mentor_visits, public.prn_mentor_answers from anon, authenticated;
grant select on public.prn_mentor_visits, public.prn_mentor_answers to authenticated;
grant all on public.prn_mentor_visits, public.prn_mentor_answers to service_role;
grant usage, select on sequence public.prn_mentor_visits_id_seq, public.prn_mentor_answers_id_seq to service_role;

/* kept: no deletes; a note, once in, stays as written */
create or replace function public.prn_mentor_kept() returns trigger language plpgsql set search_path = pg_catalog, public as $f$
begin
  if tg_op = 'DELETE' then raise exception 'Gap Mentor visits are kept (cancel one instead).'; end if;
  if old.report is not null and (new.report is distinct from old.report or new.report_at is distinct from old.report_at) then
    raise exception 'A Gap Mentor''s note stays as it was written.';
  end if;
  return new;
end $f$;
drop trigger if exists prn_mentor_kept on public.prn_mentor_visits;
create trigger prn_mentor_kept before update or delete on public.prn_mentor_visits for each row execute function public.prn_mentor_kept();
