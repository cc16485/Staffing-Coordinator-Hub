-- interview_history_748_rollback.sql: puts interview_cancel and interview_reschedule back as interview_person_461.sql left
-- them. The office_user column stays (nothing reads it once the Hub change is undone).
begin;

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

grant execute on function public.interview_cancel(uuid, text, text)            to anon, authenticated;
grant execute on function public.interview_reschedule(uuid, timestamptz, text) to anon, authenticated;

commit;
notify pgrst, 'reload schema';
