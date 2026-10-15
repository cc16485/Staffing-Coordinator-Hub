-- one_year_731_wording.sql (Desktop 731, part 2). THE JOB ADVERTS ASK FOR A YEAR OF PAID EXPERIENCE.
-- Samantha 2026-10-14: "we also need to require a year of paid experience". The adverts said the opposite
-- ("Experience helps, but reliability and kindness matter more").
-- Same method as 415: targeted replace() of exact old sentences only, never a blanket overwrite, so anything written
-- around them stays as it is. job_postings (every status) and job_templates (the saved descriptions in the Recruit tab).
-- The year is added as the FIRST line of "What we are looking for" (qualifications) unless a line there already asks for
-- a year of experience (the PRN CNA Team's does). The website's job pages rebuild from these rows within the hour.
-- One transaction. A row is only updated when something in it actually changes (updated_at feeds the sitemap).
-- Rollback: the installer saves every row it will change, with its old words, next to its report, before it runs.
begin;

create or replace function pg_temp.w731(t text) returns text language sql immutable as $f$
  select case when t is null then null else
    replace(replace(t,
      'Experience helps, but reliability and kindness matter more. If you have cared for someone before, even a family member, we would like to hear from you.',
      'We ask for at least one year of paid caregiving experience. If your experience is caring for a family member and someone can confirm it, like a hospice or home health nurse, apply anyway and we will talk it through.'),
      'Experience helps, but reliability and kindness matter more.',
      'We ask for at least one year of paid caregiving experience.')
  end
$f$;

create or replace function pg_temp.q731(t text) returns text language sql immutable as $f$
  select case
    when t is null or btrim(t) = '' then t
    when t ~* '(one|a|1)\s+year[s]?\s+of\s+[a-z ]*experience' then t
    else 'Have at least one year of paid caregiving experience, or a current CNA, CMT, LPN or RN license' || E'\n' || t
  end
$f$;

update public.job_postings p set
  summary          = pg_temp.w731(p.summary),
  description      = pg_temp.w731(p.description),
  responsibilities = pg_temp.w731(p.responsibilities),
  qualifications   = pg_temp.q731(pg_temp.w731(p.qualifications)),
  benefits         = pg_temp.w731(p.benefits)
where pg_temp.w731(p.summary)          is distinct from p.summary
   or pg_temp.w731(p.description)      is distinct from p.description
   or pg_temp.w731(p.responsibilities) is distinct from p.responsibilities
   or pg_temp.q731(pg_temp.w731(p.qualifications)) is distinct from p.qualifications
   or pg_temp.w731(p.benefits)         is distinct from p.benefits;

do $d$ begin
  if to_regclass('public.job_templates') is not null then
    update public.job_templates t set
      summary          = pg_temp.w731(t.summary),
      description      = pg_temp.w731(t.description),
      responsibilities = pg_temp.w731(t.responsibilities),
      qualifications   = pg_temp.q731(pg_temp.w731(t.qualifications)),
      benefits         = pg_temp.w731(t.benefits)
    where pg_temp.w731(t.summary)          is distinct from t.summary
       or pg_temp.w731(t.description)      is distinct from t.description
       or pg_temp.w731(t.responsibilities) is distinct from t.responsibilities
       or pg_temp.q731(pg_temp.w731(t.qualifications)) is distinct from t.qualifications
       or pg_temp.w731(t.benefits)         is distinct from t.benefits;
  end if;
end $d$;

commit;
