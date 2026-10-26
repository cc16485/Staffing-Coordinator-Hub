-- 1138 · THREE MORE INTERVIEW QUESTIONS (Samantha 2026-10-26: "first ask if they have worked for Caring Companions before,
-- also ask if they are working now, and to tell us about their last 3 jobs"). Adds them to the caregiver interview:
-- "Worked with us before" goes first, "Working now" and "Your last 3 jobs" go right after "Your story". Placed by the live
-- order (questions edited in the Hub keep their wording and order). No scores (her rule): rubric is null.
-- Safe to run again: seeded_as keeps a re-run from adding them twice.
begin;
with s as (
  select coalesce((select min(sort) from public.interview_questions where position = 'caregiver' and active), 10) as first_sort,
         coalesce((select sort from public.interview_questions where seeded_as = 'v2-01'), 10) as story_sort
)
insert into public.interview_questions (seeded_as, position, section, sort, question, kind, guidance, rubric, optional)
select v.seeded_as, 'caregiver', v.section, v.sort, v.question, 'open', v.guidance, null, false
from s, lateral (values
  ('v3-01', 'Worked with us before', s.first_sort - 5,
   'Have you ever worked for Caring Companions before?',
   'If yes: "When was that, what did you do, and why did it end?" Note it so the office checks their old file before an offer.'),
  ('v3-02', 'Working now', s.story_sort + 3,
   'Are you working right now? Where, and how many hours a week?',
   'If yes: "Are you keeping that job?" · "What days and times does it take up?" A second job never counts against anyone; it tells us what schedule works.'),
  ('v3-03', 'Your last 3 jobs', s.story_sort + 6,
   'Tell me about your last 3 jobs. Where did you work, what did you do there, how long were you there, and why did you leave?',
   'Any kind of job counts, not only caregiving. Strong: clear, honest reasons for leaving. Note any job you want their references to confirm.')
) as v(seeded_as, section, sort, question, guidance)
on conflict (seeded_as) do nothing;
commit;
