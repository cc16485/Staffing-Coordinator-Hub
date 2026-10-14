-- 648 · THE AI INTERVIEW REVIEW'S RECORD (Samantha 2026-10-13, "yes to all" + "build"). Adds only; safe to re-run.
-- One row per time someone taps Analyze Interview (or Check before they leave). The AI's review (review) is written once
-- by the server and never changed; the office's Confirm / Correct / Dismiss, notes and follow-up tasks go in marks.
-- Office only, like the rest of the interview (647): read and mark with an office role; written only by the server.
create table if not exists public.interview_reviews (
  id            uuid primary key default gen_random_uuid(),
  applicant_id  uuid not null references public.job_applicants(id) on delete cascade,
  kind          text not null check (kind in ('full','check')),
  model         text,
  created_at    timestamptz not null default now(),
  created_by    text,
  recording_ids jsonb not null default '[]'::jsonb,
  review        jsonb not null,
  marks         jsonb not null default '{}'::jsonb
);
create index if not exists interview_reviews_applicant_idx on public.interview_reviews (applicant_id, created_at desc);
alter table public.interview_reviews enable row level security;
revoke all on public.interview_reviews from public, anon, authenticated;
grant select on public.interview_reviews to authenticated;
grant update (marks) on public.interview_reviews to authenticated;
grant all on public.interview_reviews to service_role;
drop policy if exists interview_reviews_office_read on public.interview_reviews;
create policy interview_reviews_office_read on public.interview_reviews for select to authenticated using (public.hub_office_ok());
drop policy if exists interview_reviews_office_mark on public.interview_reviews;
create policy interview_reviews_office_mark on public.interview_reviews for update to authenticated using (public.hub_office_ok()) with check (public.hub_office_ok());
