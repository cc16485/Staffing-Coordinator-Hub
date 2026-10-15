-- interview_history_748.sql (Desktop 748, 2026-10-15). EVERY INTERVIEW CANCEL AND MOVE, ON THE APPLICANT'S PAGE.
-- Samantha: "when an applicant cancels and reschedules their interview please record that in their profile so we can see if
-- theyve canceled and rescheduled a bunch of times, that can be a pattern of unreliability."
-- Every cancelled or moved booking already stays in interview_bookings (it is never deleted). Two things kept that record wrong:
--   · The office's Cancel sheet runs through the Hub's server (applicant-text), and interview_cancel treated every caller that
--     was not a signed-in browser as the applicant. So "We need to cancel" was saved as the APPLICANT cancelling, and once the
--     applicant had used their two online changes, the office could not cancel for them at all ("no live booking").
--   · The office's Move button could only say "moved by the office", even when the applicant rang up and asked.
-- This change:
--   · office_user: who in the office made the change (empty when the applicant did it online or by replying NO).
--   · interview_cancel / interview_reschedule: the office (signed-in Hub, or the Hub's server) says who asked, and is never
--     held to the applicant's two-changes or two-hours limits. The public apply page is unchanged: limits as before.
-- Built on the definitions in interview_person_461.sql; the Desktop step checks the live ones match those first.
-- Run as one transaction. Rollback: interview_history_748_rollback.sql (puts 461's definitions back; the column stays, unused).
begin;

alter table public.interview_bookings add column if not exists office_user text;

create or replace function public.interview_cancel(
  p_applicant uuid,
  p_reason    text default null,
  p_by        text default 'applicant'
)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_old   timestamptz;
  -- 748: the office (signed in to the Hub, or the Hub's server acting for a signed-in office user) is trusted to say who
  -- asked; only the public apply page is held to the applicant's own limits.
  v_staff boolean := coalesce(auth.role(),'anon') in ('authenticated','service_role');
begin
  if p_by not in ('applicant','office','reschedule') then
    raise exception 'p_by must be applicant, office or reschedule';
  end if;
  if not v_staff then p_by := 'applicant'; end if;

  if p_by = 'applicant' and not v_staff then
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
  v_old   timestamptz;
  v_staff boolean := coalesce(auth.role(),'anon') in ('authenticated','service_role');   -- 748, as in interview_cancel
begin
  if not v_staff then p_by := 'applicant'; end if;

  select starts_at into v_old
    from interview_bookings
   where applicant_id in (select applicant_person_ids(p_applicant)) and status = 'booked'
   order by starts_at limit 1;

  if p_by = 'applicant' and not v_staff and v_old is not null then
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
