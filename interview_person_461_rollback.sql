-- interview_person_461_rollback.sql: puts back the interview rules exactly as they were before 461 (copied from
-- noshow_policy.sql for interview_book / interview_mine and interview-limits.sql for interview_cancel / interview_reschedule /
-- interview_self_changes). The two review columns and the helper functions are left in place (harmless).
begin;
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

  -- NEW: refuse if this application is a duplicate of one that was declined.
  -- Stops a previously-declined applicant from self-booking a fresh interview
  -- through a second application before the office has reviewed it.
  if exists (
    select 1
      from public.job_applicants cur
      join public.job_applicants prior on prior.id = cur.duplicate_of
     where cur.id = p_applicant and prior.status = 'declined')
  then raise exception 'previously declined — office review required before booking'; end if;

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
  delete from public.coordinator_busy
   where source = 'interview' and source_id = p_applicant::text;

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
  select * into v_row from interview_bookings
   where applicant_id = p_applicant and status = 'booked'
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

create or replace function public.interview_self_changes(p_applicant uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::int from interview_bookings
   where applicant_id = p_applicant
     and status = 'cancelled'
     and (cancelled_by = 'applicant'
          or (cancelled_by = 'reschedule' and cancel_reason = 'moved by the applicant'));
$$;

create or replace function public.interview_cancel(
  p_applicant uuid,
  p_reason    text default null,
  p_by        text default 'applicant'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
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
                where applicant_id = p_applicant and status = 'booked'
                  and starts_at < now() + interval '2 hours') then
      return json_build_object('cancelled', false, 'reason', 'too_close');
    end if;
  end if;

  update interview_bookings
     set status        = 'cancelled',
         cancelled_at  = now(),
         cancelled_by  = p_by,
         cancel_reason = nullif(trim(coalesce(p_reason,'')), '')
   where applicant_id = p_applicant and status = 'booked'
   returning starts_at into v_old;

  if v_old is null then
    return json_build_object('cancelled', false, 'reason', 'none');
  end if;
  return json_build_object('cancelled', true, 'was', v_old);
end $$;

create or replace function public.interview_reschedule(
  p_applicant uuid,
  p_starts    timestamptz,
  p_by        text default 'applicant'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old timestamptz;
begin
  if coalesce(auth.role(),'anon') <> 'authenticated' then p_by := 'applicant'; end if;

  select starts_at into v_old
    from interview_bookings
   where applicant_id = p_applicant and status = 'booked'
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
   where applicant_id = p_applicant and status = 'booked';

  perform interview_book(p_applicant, p_starts);

  update interview_bookings
     set rescheduled_from = v_old,
         confirmed_at     = null,
         reminded_day_at  = null,
         reminded_hour_at = null
   where applicant_id = p_applicant and status = 'booked';

  return json_build_object('booked', p_starts, 'was', v_old);
end $$;

grant execute on function public.interview_self_changes(uuid)                  to anon, authenticated;
grant execute on function public.interview_mine(uuid)                          to anon, authenticated;
grant execute on function public.interview_cancel(uuid, text, text)            to anon, authenticated;
grant execute on function public.interview_reschedule(uuid, timestamptz, text) to anon, authenticated;
commit;
notify pgrst, 'reload schema';
