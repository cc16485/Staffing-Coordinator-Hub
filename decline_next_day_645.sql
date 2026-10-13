-- 645 · Not hiring message goes the next morning (Samantha 2026-10-13). Adds only; safe to re-run.
alter table public.job_applicants add column if not exists decision_msg_due_at timestamptz;
alter table public.job_applicants add column if not exists decision_msg_problem text;
comment on column public.job_applicants.decision_msg_due_at is 'When the booked Not hiring message goes (10am Central the next day); cleared when it goes, is cancelled, or they are moved.';
comment on column public.job_applicants.decision_msg_problem is 'Why a booked Not hiring message could not go; shown on their profile with Send / Don''t send.';
create index if not exists job_applicants_decision_due_idx on public.job_applicants (decision_msg_due_at) where decision_msg_due_at is not null;
