-- =============================================================================
-- PRN CNA ON-CALL CALENDAR (Samantha 2026-10-29: "Yes, build the on-call redo as recommended (decisions 22 to 27) and the
-- expectations wording as drafted." Rules in supabase/functions/_shared/prn-oncall.ts)
--   prn_oncall        may now keep 'asked' rows: one shift (day or overnight) a member asked for on their PRN Team page. The
--                     office's one-tap OK writes a 'confirmed' row (ask_id = the ask) and takes the ask off the waiting list
--                     (cancelled_by 'Confirmed ...'). Two live confirmed people never share one shift.
--   prn_oncall_marks  what happened, kept as written: covering (said yes on the office's call), no_answer, not_covered (a
--                     miss: that on-call shift is not paid and they can't sign up again), lifted (an owner let them sign up
--                     again, with a reason). Each outcome once per open-shift case (a yes, then a miss if they
--                     didn't come after all).
--   prn_oncall_terms  each signed On-Call Expectations: the exact words, their version, the name they typed, when. Kept.
-- Written only by the prn-week and prn-page functions (service role). Office staff can read. Adds only; safe to run again.
-- =============================================================================
set local lock_timeout = '5s';

alter table public.prn_oncall add column if not exists ask_id bigint references public.prn_oncall(id) on delete restrict;
alter table public.prn_oncall drop constraint if exists prn_oncall_kind_check;
alter table public.prn_oncall add constraint prn_oncall_kind_check check (kind in ('offer', 'confirmed', 'asked'));
alter table public.prn_oncall drop constraint if exists prn_oncall_shift_check;
alter table public.prn_oncall add constraint prn_oncall_shift_check check (shift is null
  or (kind = 'confirmed' and shift in ('day', 'overnight', 'whole')) or (kind = 'asked' and shift in ('day', 'overnight')));
alter table public.prn_oncall drop constraint if exists prn_oncall_asked_one_shift;
alter table public.prn_oncall add constraint prn_oncall_asked_one_shift check (kind <> 'asked'
  or (start_date is not null and end_date = start_date and shift in ('day', 'overnight')));
/* one person, one date: was (applicant_id, start_date); a daytime and an overnight on the same date are now two rows */
drop index if exists public.prn_oncall_one_confirm;
create unique index if not exists prn_oncall_one_confirm2 on public.prn_oncall (applicant_id, start_date, coalesce(shift, ''))
  where kind = 'confirmed' and cancelled_at is null;
create unique index if not exists prn_oncall_one_per_shift on public.prn_oncall (start_date, shift)
  where kind = 'confirmed' and cancelled_at is null and shift in ('day', 'overnight');
create unique index if not exists prn_oncall_one_ask on public.prn_oncall (applicant_id, start_date, shift)
  where kind = 'asked' and cancelled_at is null;

create table if not exists public.prn_oncall_marks (
  id            bigserial primary key,
  applicant_id  uuid not null references public.job_applicants(id) on delete restrict,
  oncall_id     bigint references public.prn_oncall(id) on delete restrict,
  kind          text not null check (kind in ('covering', 'no_answer', 'not_covered', 'lifted')),
  case_id       text check (case_id is null or length(case_id) <= 80),
  note          text check (note is null or length(note) <= 600),
  by_email      text not null,
  by_name       text,
  at            timestamptz not null default now(),
  constraint prn_oncall_marks_shift check (kind = 'lifted' or oncall_id is not null),
  constraint prn_oncall_marks_reason check (kind <> 'lifted' or length(btrim(coalesce(note, ''))) >= 3)
);
create index if not exists prn_oncall_marks_member_idx on public.prn_oncall_marks (applicant_id, at);
create unique index if not exists prn_oncall_marks_one_case on public.prn_oncall_marks (case_id, kind) where case_id is not null;
create unique index if not exists prn_oncall_marks_one_miss on public.prn_oncall_marks (oncall_id) where kind in ('no_answer', 'not_covered');

create table if not exists public.prn_oncall_terms (
  id            bigserial primary key,
  applicant_id  uuid not null references public.job_applicants(id) on delete restrict,
  version       text not null check (version ~ '^v[0-9a-f]{8}$'),
  body          text not null check (length(body) between 20 and 4000),
  typed_name    text not null check (length(btrim(typed_name)) between 3 and 80),
  agreed_at     timestamptz not null default now(),
  via           text not null default 'prn-page',
  unique (applicant_id, version)
);

/* both kept as written: no edits, no deletes */
create or replace function public.prn_oncall_kept()
returns trigger language plpgsql as $$
begin raise exception 'HISTORY_IS_KEPT' using errcode = 'P0001', hint = 'On-call marks and signed expectations are kept as written.'; end $$;
drop trigger if exists prn_oncall_marks_kept on public.prn_oncall_marks;
create trigger prn_oncall_marks_kept before update or delete on public.prn_oncall_marks for each row execute function public.prn_oncall_kept();
drop trigger if exists prn_oncall_terms_kept on public.prn_oncall_terms;
create trigger prn_oncall_terms_kept before update or delete on public.prn_oncall_terms for each row execute function public.prn_oncall_kept();

alter table public.prn_oncall_marks enable row level security;
alter table public.prn_oncall_terms enable row level security;
drop policy if exists prn_oncall_marks_read on public.prn_oncall_marks;
create policy prn_oncall_marks_read on public.prn_oncall_marks for select to authenticated using (true);
drop policy if exists prn_oncall_terms_read on public.prn_oncall_terms;
create policy prn_oncall_terms_read on public.prn_oncall_terms for select to authenticated using (true);
revoke all on public.prn_oncall_marks, public.prn_oncall_terms from anon, authenticated;
grant select on public.prn_oncall_marks, public.prn_oncall_terms to authenticated;
grant all on public.prn_oncall_marks, public.prn_oncall_terms to service_role;
grant usage, select on sequence public.prn_oncall_marks_id_seq, public.prn_oncall_terms_id_seq to service_role;

/* the PRN Team page's record may keep 'oncall_signed' and 'oncall_ask' (every earlier kind stays allowed) */
alter table public.prn_page_log drop constraint if exists prn_page_log_kind_check;
alter table public.prn_page_log add constraint prn_page_log_kind_check check (kind in ('viewed', 'office_preview', 'looking_on', 'looking_off',
  'hours_saved', 'short_notice', 'break_set', 'course_request', 'idea', 'interested', 'feedback', 'oncall_offer', 'oncall_signed', 'oncall_ask'));
