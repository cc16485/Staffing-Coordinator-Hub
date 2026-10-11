-- =============================================================================
-- ORIENTATION VIDEO CALL in the job adverts (Samantha 2026-10-11 chose the name; "yes" to updating the adverts). Hub project.
-- job_postings (every status) and job_templates (the Recruit tab's saved descriptions): only the old phrase changes, "welcome
-- call" / "welcome video call" becomes "Orientation Video Call" ("a welcome call" becomes "an Orientation Video Call"), never
-- a blanket overwrite, so everything she has written around it stays. The website's job pages and the Indeed feed are rebuilt
-- from these rows within the hour. A row is only updated when something in it actually changes. Safe to run again.
-- Rollback: no exact undo of a replace(); the step saves every row it will change, with its old words, next to its report.
-- =============================================================================
begin;
create or replace function pg_temp.ovc(t text) returns text language sql immutable as $f$
  select case when t is null then null else
    regexp_replace(regexp_replace(t, '\m([Aa]) welcome (video )?call\M', '\1n Orientation Video Call', 'g'),
                   '\mwelcome (video )?call(s?)\M', 'Orientation Video Call\2', 'gi')
  end
$f$;
update public.job_postings p set
  summary = pg_temp.ovc(p.summary), description = pg_temp.ovc(p.description), responsibilities = pg_temp.ovc(p.responsibilities),
  qualifications = pg_temp.ovc(p.qualifications), benefits = pg_temp.ovc(p.benefits)
where pg_temp.ovc(p.summary) is distinct from p.summary or pg_temp.ovc(p.description) is distinct from p.description
   or pg_temp.ovc(p.responsibilities) is distinct from p.responsibilities or pg_temp.ovc(p.qualifications) is distinct from p.qualifications
   or pg_temp.ovc(p.benefits) is distinct from p.benefits;
do $d$ begin
  if to_regclass('public.job_templates') is not null then
    update public.job_templates t set
      summary = pg_temp.ovc(t.summary), description = pg_temp.ovc(t.description), responsibilities = pg_temp.ovc(t.responsibilities),
      qualifications = pg_temp.ovc(t.qualifications), benefits = pg_temp.ovc(t.benefits)
    where pg_temp.ovc(t.summary) is distinct from t.summary or pg_temp.ovc(t.description) is distinct from t.description
       or pg_temp.ovc(t.responsibilities) is distinct from t.responsibilities or pg_temp.ovc(t.qualifications) is distinct from t.qualifications
       or pg_temp.ovc(t.benefits) is distinct from t.benefits;
  end if;
end $d$;
commit;
