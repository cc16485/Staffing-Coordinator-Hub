-- interview_person_461.sql (Desktop 461, 2026-10-05). ONE PERSON, ONE INTERVIEW; AND "REAPPLY WITH US REVIEWING FIRST".
-- Samantha: Shakira Sutton applied twice 21 minutes apart, booked once per application, cancelled one, and the other stayed
-- on the Interviews list. Her decisions: "both" (clean it up AND stop it happening) and "reapply with us reviewing first".
--   · applicant_person_ids(p): every application by the same person (last 10 phone digits, or email).
--   · interview_book: booking under one application quietly lets go of that person's live booking under any other
--     application (no message: the new booking's confirmation says it all). A repeat application from someone the office
--     chose not to move forward with cannot book until the office approves it (REVIEW_FIRST, explained on the page).
--   · interview_cancel / interview_reschedule / interview_self_changes / interview_mine: by person, not by application, so a
--     cancel from either link clears every live booking, the limits cannot be dodged by applying twice, and either link shows
--     the real booking. A cancel also releases the calendar hold (the page always said "the time goes back to being
--     available"; the hold used to stay).
--   · review_cleared_at / review_cleared_by: the office's "Approve: let them book" (Hub).
-- Built on the definitions in noshow_policy.sql (interview_book, interview_mine) and interview-limits.sql (interview_cancel,
-- interview_reschedule, interview_self_changes); the Desktop step checks the live ones match those before replacing them.
-- Run as one transaction. Rollback: interview_person_461_rollback.sql puts those definitions back.
begin;

alter table public.job_applicants add column if not exists review_cleared_at timestamptz;
alter table public.job_applicants add column if not exists review_cleared_by text;

-- Every application by the same person as p (p included): same last 10 phone digits, or same email.
create or replace function public.applicant_person_ids(p uuid)
 returns setof uuid language sql stable security definer set search_path to 'public' as $f$
  with me as (
    select right(regexp_replace(coalesce(phone,''),'\D','','g'),10) as ph, nullif(lower(trim(coalesce(email,''))),'') as em
      from public.job_applicants where id = p)
  select a.id from public.job_applicants a, me
   where a.id = p
      or (length(me.ph) = 10 and right(regexp_replace(coalesce(a.phone,''),'\D','','g'),10) = me.ph)
      or (me.em is not null and lower(trim(coalesce(a.email,''))) = me.em)
$f$;

-- Why an open application has to wait for the office before an interview is booked (null = it does not):
--   'dnr'      they are on the do-not-rehire list (same phone or email). Amanda Peak, 2026-10-05: applied several times
--              after the office had told her by phone she could not be rehired. The office takes them off the list to
--              change that; "Approve, let them book" is not offered for this one.
--   'declined' they applied again after the office chose not to move forward (an EARLIER application of theirs is
--              declined), and the office has not approved this one yet ("Approve, let them book").
-- Their own application being declined is a different thing (it is simply closed).
create or replace function public.applicant_review_reason(p uuid)
 returns text language sql stable security definer set search_path to 'public' as $f$
  with cur as (
    select a.*, right(regexp_replace(coalesce(a.phone,''),'\D','','g'),10) as ph, nullif(lower(trim(coalesce(a.email,''))),'') as em
      from public.job_applicants a where a.id = p and a.status in ('partial','new','reviewing'))
  select case
    when exists (select 1 from cur, public.do_not_rehire d
                  where (length(cur.ph) = 10 and d.phone_digits is not null
                         and right(regexp_replace(d.phone_digits,'\D','','g'),10) = cur.ph)
                     or (cur.em is not null and d.email is not null and lower(trim(d.email)) = cur.em)) then 'dnr'
    when exists (select 1 from cur where cur.review_cleared_at is null
                    and exists (select 1 from public.job_applicants prior
                                 where prior.id in (select public.applicant_person_ids(p)) and prior.id <> p
                                   and prior.status = 'declined' and prior.created_at < cur.created_at)) then 'declined'
  end
$f$;

create or replace function public.applicant_needs_review(p uuid)
 returns boolean language sql stable security definer set search_path to 'public' as $f$
  select public.applicant_review_reason(p) is not null
$f$;

-- Does this person hold a live booking under ANOTHER application? (the reminder texts skip them)
create or replace function public.applicant_person_booked_elsewhere(p uuid)
 returns boolean language sql stable security definer set search_path to 'public' as $f$
  select exists (select 1 from public.interview_bookings b
                  where b.status = 'booked' and b.applicant_id <> p and b.applicant_id in (select public.applicant_person_ids(p)))
$f$;

revoke all on function public.applicant_person_ids(uuid) from public, anon, authenticated;
revoke all on function public.applicant_person_booked_elsewhere(uuid) from public, anon, authenticated;
revoke all on function public.applicant_needs_review(uuid) from public, anon;
grant execute on function public.applicant_needs_review(uuid) to authenticated;
revoke all on function public.applicant_review_reason(uuid) from public, anon;
grant execute on function public.applicant_review_reason(uuid) to authenticated;   -- the Hub shows "needs your review" and why

-- How many times THIS PERSON has changed a booking themselves (any of their applications).
create or replace function public.interview_self_changes(p_applicant uuid)
returns integer language sql security definer set search_path = public stable as $$
  select count(*)::int from interview_bookings
   where applicant_id in (select applicant_person_ids(p_applicant))
     and status = 'cancelled'
     and (cancelled_by = 'applicant'
          or (cancelled_by = 'reschedule' and cancel_reason = 'moved by the applicant'));
$$;

CREATE OR REPLACE FUNCTION public.interview_mine(p_applicant uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row     interview_bookings%rowtype;
  v_changes integer;
  v_blocked text;
begin
  -- NO-SHOW (2026-10-01): their link says so instead of offering times
  if exists (select 1 from job_applicants where id = p_applicant and status = 'noshow') then
    return json_build_object('status', 'noshow');
  end if;
  -- 461: applied again after "not moving forward": the page says the office will review it first
  if applicant_needs_review(p_applicant) then
    return json_build_object('status', 'review');
  end if;
  -- 461: this PERSON's booking, under whichever of their applications holds it
  select * into v_row from interview_bookings
   where applicant_id in (select applicant_person_ids(p_applicant)) and status = 'booked'
   order by starts_at limit 1;
  if v_row.id is null then return 'null'::json; end if;

  v_changes := interview_self_changes(p_applicant);
  v_blocked := case
    when v_changes >= 2 then 'limit'
    when v_row.starts_at < now() + interval '2 hours' then 'too_close'
    else null end;

  return json_build_object(
    'starts_at', v_row.starts_at,
    'status', v_row.status,
    'self_changes', v_changes,
    'can_change', v_blocked is null,
    'blocked', v_blocked);
end $function$;

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
  order by (
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

-- A cancel from either of their links (or the office) clears every live booking of THIS PERSON, and frees the time.
create or replace function public.interview_cancel(
  p_applicant uuid,
  p_reason    text default null,
  p_by        text default 'applicant'
)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_old timestamptz;
begin
  if p_by not in ('applicant','office','reschedule') then
    raise exception 'p_by must be applicant, office or reschedule';
  end if;
  if coalesce(auth.role(),'anon') <> 'authenticated' then p_by := 'applicant'; end if;

  if p_by = 'applicant' then
    if interview_self_changes(p_applicant) >= 2 then
      return json_build_object('cancelled', false, 'reason', 'limit');
    end if;
    if exists (select 1 from interview_bookings
                where applicant_id in (select applicant_person_ids(p_applicant)) and status = 'booked'
                  and starts_at < now() + interval '2 hours') then
      return json_build_object('cancelled', false, 'reason', 'too_close');
    end if;
  end if;

  with u as (
    update interview_bookings
       set status        = 'cancelled',
           cancelled_at  = now(),
           cancelled_by  = p_by,
           cancel_reason = nullif(trim(coalesce(p_reason,'')), '')
     where applicant_id in (select applicant_person_ids(p_applicant)) and status = 'booked'
     returning starts_at)
  select min(starts_at) into v_old from u;

  if v_old is null then
    return json_build_object('cancelled', false, 'reason', 'none');
  end if;
  delete from coordinator_busy where source = 'interview' and source_id in (select x::text from applicant_person_ids(p_applicant) x);
  return json_build_object('cancelled', true, 'was', v_old);
end $$;

create or replace function public.interview_reschedule(
  p_applicant uuid,
  p_starts    timestamptz,
  p_by        text default 'applicant'
)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_old timestamptz;
begin
  if coalesce(auth.role(),'anon') <> 'authenticated' then p_by := 'applicant'; end if;

  select starts_at into v_old
    from interview_bookings
   where applicant_id in (select applicant_person_ids(p_applicant)) and status = 'booked'
   order by starts_at limit 1;

  if p_by = 'applicant' and v_old is not null then
    if interview_self_changes(p_applicant) >= 2 then
      raise exception 'CHANGE_LIMIT: this booking can only be changed by the office now';
    end if;
    if v_old < now() + interval '2 hours' then
      raise exception 'TOO_CLOSE: within two hours of the interview, changes are phone-only';
    end if;
  end if;

  update interview_bookings
     set status        = 'cancelled',
         cancelled_at  = now(),
         cancelled_by  = 'reschedule',
         cancel_reason = case when p_by = 'office' then 'moved by the office'
                              else 'moved by the applicant' end,
         cancel_notified_at = now()   -- a move is never announced as a cancellation
   where applicant_id in (select applicant_person_ids(p_applicant)) and status = 'booked';

  perform interview_book(p_applicant, p_starts);

  update interview_bookings
     set rescheduled_from = v_old,
         confirmed_at     = null,
         reminded_day_at  = null,
         reminded_hour_at = null
   where applicant_id = p_applicant and status = 'booked';

  return json_build_object('booked', p_starts, 'was', v_old);
end $$;

-- The calendar holds earlier cancellations left behind (a cancel never released its hold, so that time could stay blocked):
-- future interview holds with no live booking at that time are released. Past holds are left alone.
delete from public.coordinator_busy cb
 where cb.source = 'interview' and cb.starts_at > now()
   and not exists (select 1 from public.interview_bookings b
                    where b.status = 'booked' and b.applicant_id::text = cb.source_id and b.starts_at = cb.starts_at);

grant execute on function public.interview_self_changes(uuid)                  to anon, authenticated;
grant execute on function public.interview_mine(uuid)                          to anon, authenticated;
grant execute on function public.interview_cancel(uuid, text, text)            to anon, authenticated;
grant execute on function public.interview_reschedule(uuid, timestamptz, text) to anon, authenticated;

commit;
notify pgrst, 'reload schema';
