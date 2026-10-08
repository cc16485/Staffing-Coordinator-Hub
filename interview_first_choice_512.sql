-- interview_first_choice_512.sql (Desktop 512, 2026-10-08). WHO TAKES AN INTERVIEW.
-- Samantha: "it should be Krystal M-F 8:30am-1:30pm and Samantha 10:00am-4:30pm" and "Krystal is the first option during
-- her hours". Until now a booking went to whichever free interviewer had fewer that day (random between equals).
--   · coordinators.booking_order: who is asked first (lower first; empty = after everyone with a number).
--   · interview_book: the free interviewer first in the booking order takes it; only then fewer-that-day.
-- The interviewers' hours and order values are set by the Desktop step (they are your settings, not code).
-- Built on interview_book as installed by 461 (interview_person_461.sql); the Desktop step checks the live one matches.
-- Rollback: interview_first_choice_512_rollback.sql puts the 461 interview_book back (the column is harmless left in place).
begin;

alter table public.coordinators add column if not exists booking_order integer;

CREATE OR REPLACE FUNCTION public.interview_book(p_applicant uuid, p_starts timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a public.activity_types;
  v_id uuid; v_who uuid; v_end timestamptz; v_ok boolean;
begin
  select * into a from public.activity_types where key = 'interview';
  v_end := p_starts + (a.minutes || ' minutes')::interval;

  -- NO-SHOW (2026-10-01): a no-show cannot book again (their old link included) until the office excuses it.
  if exists (select 1 from public.job_applicants where id = p_applicant and status = 'noshow')
     or exists (select 1 from public.job_applicants cur
                 where cur.id = p_applicant and public.applicant_noshow_match(cur.phone, cur.email, cur.id))
  then raise exception 'NOSHOW_BEFORE: no-showed for an interview before'; end if;

  select true into v_ok from public.job_applicants
   where id = p_applicant and status in ('partial','new','reviewing');
  if not found then raise exception 'application not open'; end if;

  -- 461 (Samantha: "reapply with us reviewing first"): applied again after the office chose not to move forward. They
  -- cannot book until the office approves this application (Hub: Approve, let them book). Replaces the older check that
  -- only looked at duplicate_of.
  if public.applicant_needs_review(p_applicant)
  then raise exception 'REVIEW_FIRST: applied before; the office reviews it before an interview is booked'; end if;

  if p_starts <= now() + (a.lead_hours || ' hours')::interval then
    raise exception 'that time has passed';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_starts::text));

  select av.coordinator_id into v_who
  from public.coordinator_availability av
  join public.coordinators c on c.id = av.coordinator_id and c.active
  where av.active and av.activity = 'interview'
    and av.day_of_week = extract(dow from (p_starts at time zone 'America/Chicago'))::int
    and (p_starts at time zone 'America/Chicago')::time >= av.start_time
    and (p_starts at time zone 'America/Chicago')::time <  av.end_time
    and not exists (
      select 1 from public.coordinator_busy cb
      where (cb.coordinator_id is null or cb.coordinator_id = av.coordinator_id)
        and cb.source is distinct from 'interview'
        and cb.starts_at < v_end and cb.ends_at > p_starts)
    and (
      select count(*) from public.coordinator_busy cb
      where (cb.coordinator_id is null or cb.coordinator_id = av.coordinator_id)
        and cb.source = 'interview'
        and cb.starts_at < v_end and cb.ends_at > p_starts) < a.per_slot
  -- 512 (Samantha, 2026-10-08: "Krystal is the first option during her hours"): whoever is first in the booking order
  -- and free takes it; only then the one with fewer that day.
  order by coalesce(c.booking_order, 1000), (
    select count(*) from public.coordinator_busy cb2
    where cb2.coordinator_id = av.coordinator_id
      and cb2.starts_at::date = (p_starts at time zone 'America/Chicago')::date
  ), random()
  limit 1;

  if v_who is null then raise exception 'that time was just taken'; end if;

  update public.interview_bookings set status = 'rescheduled'
   where applicant_id = p_applicant and status = 'booked';
  -- 461: one person, one interview. Their live booking under any OTHER application is let go quietly (marked told, so no
  -- "cancelled" message: the new booking's confirmation is the message).
  update public.interview_bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'reschedule',
         cancel_reason = 'booked again under another application', cancel_notified_at = now()
   where status = 'booked' and applicant_id <> p_applicant
     and applicant_id in (select public.applicant_person_ids(p_applicant));
  delete from public.coordinator_busy
   where source = 'interview' and source_id in (select x::text from public.applicant_person_ids(p_applicant) x);

  insert into public.interview_bookings (applicant_id, coordinator_id, starts_at, ends_at)
  values (p_applicant, v_who, p_starts, v_end) returning id into v_id;

  insert into public.coordinator_busy (coordinator_id, starts_at, ends_at, source, source_id, label)
  values (v_who, p_starts, v_end, 'interview', p_applicant::text,
          'Interview — ' || coalesce((select first_name || ' ' || last_name
                                      from public.job_applicants where id = p_applicant), 'applicant'));

  update public.job_applicants
     set status = case when status = 'partial' then 'new' else status end
   where id = p_applicant;

  return v_id;
end $function$;

commit;
notify pgrst, 'reload schema';
