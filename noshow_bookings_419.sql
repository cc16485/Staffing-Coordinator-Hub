-- noshow_bookings_419.sql (Desktop 419, 2026-10-02). Samantha: "in the interviews tab there is 3 waiting on an outcome,
-- but we have already marked all three as no-show".
-- The Interviews tab counts a past interview_bookings row still 'booked' as "waiting on an outcome". Marking an applicant
-- no-show through anything other than the applicant-noshow function's 'mark' (the pre-400 button, a status edit, the
-- 401 clean-up, a held message sent later with 'send') changed job_applicants.status but left the booking 'booked'.
--   1. One-time: every PAST booking still 'booked' whose applicant is marked no-show becomes 'noshow'
--      (outcome_at + noshow_notified_at stamped so no automatic no-show message can ever pick it up; nothing is sent),
--      and its calendar hold (coordinator_busy, source 'interview') is freed.
--   2. From now on: whenever an applicant's status becomes 'noshow' by ANY path, the same happens automatically
--      (trigger). Future bookings are left alone (a no-show cannot book; if one exists the office sees it).
-- Run as one transaction.

create or replace function public.noshow_close_bookings(p_applicant uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  with closed as (
    update public.interview_bookings
       set status = 'noshow', outcome_at = coalesce(outcome_at, now()), noshow_notified_at = coalesce(noshow_notified_at, now())
     where applicant_id = p_applicant and status = 'booked' and starts_at < now()
    returning id)
  select count(*) into n from closed;
  delete from public.coordinator_busy where source = 'interview' and source_id = p_applicant::text
     and ends_at < now() + interval '1 hour';
  return n;
end $$;
revoke all on function public.noshow_close_bookings(uuid) from public, anon, authenticated;

create or replace function public.trg_applicant_noshow_bookings()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status = 'noshow' and coalesce(old.status, '') <> 'noshow' then
    begin
      perform public.noshow_close_bookings(new.id);
    exception when others then
      raise warning 'noshow_close_bookings failed for %: %', new.id, sqlerrm;   -- never block marking the no-show
    end;
  end if;
  return new;
end $$;
drop trigger if exists applicant_noshow_bookings on public.job_applicants;
create trigger applicant_noshow_bookings after update of status on public.job_applicants
  for each row execute function public.trg_applicant_noshow_bookings();

-- the one-time catch-up
select public.noshow_close_bookings(a.id)
  from public.job_applicants a
 where a.status = 'noshow'
   and exists (select 1 from public.interview_bookings b where b.applicant_id = a.id and b.status = 'booked' and b.starts_at < now());
