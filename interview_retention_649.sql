-- 649 · INTERVIEW RECORDS KEPT 2 YEARS (Samantha 2026-10-14: "2 years", after the cited research in
-- ~/Claude/Projects/interview-retention-research.md: 29 CFR 1602.14 needs 1 year from the decision; the Missouri Human Rights
-- Act allows a lawsuit up to 2 years after, RSMo 213.111). Adds only; safe to re-run.
--   • recordings_settings.keep_interview_days = 730: the daily clean-up (purge-recordings) clears an interview's transcript
--     two years after it was recorded, deletes AI reviews two years after they were made, and removes the interviewer's
--     observations two years after they were saved. Audio stays at 1 year (keep_audio_days 365). 0 turns it off.
--   • A legal hold on a person (job_applicants.records_hold_at) stops all of it for them until the hold is lifted.
--   • Kept: the application and the interview answers on it (they are part of a hire's personnel file).
alter table public.recordings_settings add column if not exists keep_interview_days int not null default 730 check (keep_interview_days >= 0);
update public.recordings_settings set keep_interview_days = 730 where id = 1;
alter table public.recordings add column if not exists transcript_purged_at timestamptz;
alter table public.job_applicants add column if not exists records_hold_at timestamptz;
alter table public.job_applicants add column if not exists records_hold_by text;
alter table public.job_applicants add column if not exists records_hold_reason text;
comment on column public.job_applicants.records_hold_at is 'Legal hold: while set, the 2-year clean-up never touches this person''s transcripts, observations or AI reviews (649).';
