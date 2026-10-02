-- ============================================================================
-- 415 · HIRING WORDING (orientation from home, part 3), Samantha 2026-10-02. SHARED HUB PROJECT (zngsgedlsxinbygwmxwn).
-- The job adverts say what really happens: one 20-minute in-person interview, then paperwork, a welcome call and
-- 6 hours of PAID training (2h orientation + 4h Alzheimer's and dementia) from home. Only those 6 hours are called
-- paid; on-the-job and annual training are not. The application takes about 2 minutes.
--
-- Targeted replace() of exact old phrases only, never a blanket overwrite, so anything Samantha has written around
-- them stays as it is. job_postings (every status) and job_templates (the saved descriptions in the Recruit tab).
-- The one-liner is added as the last paragraph of the description of every posting that is not closed, and every
-- template, unless it is already there. The website's job page builder (tools/build-jobs.mjs) moves it to the top
-- of the Google and Indeed descriptions and shows a "How hiring works" block on the page instead of repeating it.
--
-- One transaction. Safe to run again: none of the new words contain an old phrase, the one-liner is only added
-- where it is missing, and a row is only updated when something in it actually changes (so updated_at, which the
-- sitemap uses, is not touched for nothing).
-- Rollback: there is no exact undo of a replace(); the installer first saves every row it will change, with its old
-- words, next to its report ("Hiring wording 415 before <time>.json"), so Claude can put them back if ever needed.
-- ============================================================================
begin;

create or replace function pg_temp.hw415(t text) returns text language sql immutable as $f$
  select case when t is null then null else
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
      -- the two benefit lines that sit together on the Springfield caregiver adverts become one honest line
      regexp_replace(t, 'Paid orientation and training[ \t]*\r?\n[ \t]*[-•*]?[ \t]*Ongoing paid training, including dementia and Alzheimer''s care',
                        'Paid orientation and Alzheimer''s and dementia training (6 hours)', 'g'),
      'Ongoing paid training, including dementia and Alzheimer''s care', 'Paid orientation and Alzheimer''s and dementia training (6 hours)'),
      'Paid orientation and training, including safe transfers', 'Paid orientation and dementia training (6 hours)'),
      'Paid orientation and training', 'Paid orientation and dementia training'),
      'orientation and training are provided before you start', 'you complete 6 hours of paid orientation and dementia training from home before you start'),
      'Orientation and training are provided before you start', 'You complete 6 hours of paid orientation and dementia training from home before you start'),
      -- the application's length, only where it is the application being described (never "5 minutes from town")
      'under two minutes', 'about 2 minutes'),
      'Apply in about five minutes', 'Apply in about 2 minutes'),
      'Apply in about 5 minutes', 'Apply in about 2 minutes'),
      'takes about five minutes', 'takes about 2 minutes'),
      'takes about 5 minutes', 'takes about 2 minutes')
  end
$f$;

create or replace function pg_temp.hw415_line() returns text language sql immutable as $f$
  select 'One 20-minute in-person interview at our office, then your paperwork, welcome call and 6 hours of paid training all from home on your phone or computer.'::text
$f$;

-- the description with the one-liner as its last paragraph (only if missing; an empty description stays empty)
create or replace function pg_temp.hw415_desc(t text, add_line boolean) returns text language sql immutable as $f$
  select case
    when t is null or btrim(t) = '' then t
    when not add_line or position(pg_temp.hw415_line() in pg_temp.hw415(t)) > 0 then pg_temp.hw415(t)
    else rtrim(pg_temp.hw415(t), E' \t\r\n') || E'\n\n' || pg_temp.hw415_line()
  end
$f$;

update public.job_postings p set
  summary          = pg_temp.hw415(p.summary),
  description      = pg_temp.hw415_desc(p.description, p.status <> 'closed'),
  responsibilities = pg_temp.hw415(p.responsibilities),
  qualifications   = pg_temp.hw415(p.qualifications),
  benefits         = pg_temp.hw415(p.benefits)
where pg_temp.hw415(p.summary)          is distinct from p.summary
   or pg_temp.hw415_desc(p.description, p.status <> 'closed') is distinct from p.description
   or pg_temp.hw415(p.responsibilities) is distinct from p.responsibilities
   or pg_temp.hw415(p.qualifications)   is distinct from p.qualifications
   or pg_temp.hw415(p.benefits)         is distinct from p.benefits;

-- job_templates is optional (the Hub copes without it), so only if it is there
do $d$ begin
  if to_regclass('public.job_templates') is not null then
    update public.job_templates t set
      summary          = pg_temp.hw415(t.summary),
      description      = pg_temp.hw415_desc(t.description, true),
      responsibilities = pg_temp.hw415(t.responsibilities),
      qualifications   = pg_temp.hw415(t.qualifications),
      benefits         = pg_temp.hw415(t.benefits)
    where pg_temp.hw415(t.summary)          is distinct from t.summary
       or pg_temp.hw415_desc(t.description, true) is distinct from t.description
       or pg_temp.hw415(t.responsibilities) is distinct from t.responsibilities
       or pg_temp.hw415(t.qualifications)   is distinct from t.qualifications
       or pg_temp.hw415(t.benefits)         is distinct from t.benefits;
  end if;
end $d$;

commit;
