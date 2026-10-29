-- 1181 · QUICK CAREGIVER PROFILE (Samantha, 2026-10-29: "yes, build the quick version: photo plus 3 short answers, office
-- writes it with Beef it up, caregiver replies OK to approve").
-- A current caregiver sends a photo and three short answers; the office writes the three sections; the caregiver OKs the
-- exact words before the office publishes. Adds fields only, empty or false for everyone. Nothing is dropped or rewritten.
begin;
alter table public.caregiver_profiles add column if not exists quick boolean not null default false;
alter table public.caregiver_profiles add column if not exists quick_answers jsonb;
alter table public.caregiver_profiles add column if not exists approval_sent_at timestamptz;
alter table public.caregiver_profiles add column if not exists approval_words jsonb;
alter table public.caregiver_profiles add column if not exists approved_at timestamptz;
alter table public.caregiver_profiles add column if not exists approved_by text;
alter table public.caregiver_profiles add column if not exists change_request text;
alter table public.caregiver_profiles add column if not exists change_request_at timestamptz;
comment on column public.caregiver_profiles.quick is '1181: the quick version: they send a photo and 3 short answers, the office writes it, they OK it.';
comment on column public.caregiver_profiles.quick_answers is '1181: their 3 short answers {years, words, outside}.';
comment on column public.caregiver_profiles.approval_sent_at is '1181: when the words the office wrote went to them to OK.';
comment on column public.caregiver_profiles.approval_words is '1181: the exact words sent to them, then the exact words they OKd {about, experience, why_this_work}.';
comment on column public.caregiver_profiles.approved_at is '1181: when they OKd the words (on their page, or by text or phone, recorded by the office).';
comment on column public.caregiver_profiles.approved_by is '1181: how the OK came: on their page, or who in the office recorded it.';
comment on column public.caregiver_profiles.change_request is '1181: what they asked to have changed, from their page.';
comment on column public.caregiver_profiles.change_request_at is '1181: when they asked.';
commit;
