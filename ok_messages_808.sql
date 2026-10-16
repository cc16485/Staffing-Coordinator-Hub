-- ok_messages_808.sql (Desktop 808, 2026-10-16). OKLAHOMA APPLICANT MESSAGES FROM THE 405 NUMBER.
-- Samantha 2026-10-16: "Approve the Oklahoma applicant messages plan with all five decisions as you recommended. Start
-- building." Plan: https://claude.ai/artifact/6o96izMj4RBMEFZmgQBNn2
--
--   · Two switches replace 806's one, both OFF until she turns them on (Owners Hub Admin page):
--       ok_applicant_office_msgs_live  the office's buttons: Text, interview cancelled, not hiring / candidate pool, no-show
--       ok_applicant_auto_msgs_live    the automatic interview messages: booked, the day before, cancelled
--     Every other sender (references, Step 2, offers, the Training Platform, welcome calls...) stays held for Oklahoma with
--     both on: Oklahoma offers are not built.
--   · ops_settings.ok_from_number: the number Oklahoma texts go out from, +1 405 500 1758 unless already set.
--   · applicant_followup_stop: Oklahoma applicants never get the "finish your application" / "pick a time" follow-ups
--     (decision 2: no self-booking in Oklahoma, the recruiter calls).
-- Built on ok_companion_806.sql (the hold and the follow-up stop); the Desktop step checks the live ones match first.
-- Rollback: ok_messages_808_rollback.sql.
begin;

update public.app_data
   set data = jsonb_build_object('ok_from_number', '+14055001758', 'ok_applicant_office_msgs_live', false, 'ok_applicant_auto_msgs_live', false)
              || data    -- anything already set wins
 where key = 'ops_settings';

create or replace function public.ok_applicant_hold(p_phone text, p_email text, p_sender text default null, p_channel text default null)
 returns boolean language plpgsql security definer set search_path to 'public' as $f$
declare
  v_d text := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10);
  v_e text := nullif(lower(btrim(coalesce(p_email,''))), '');
  v_id uuid; v_office text; v_ops jsonb; v_switch text;
begin
  -- 808: which switch lets this sender through for Oklahoma (null = none: held whatever the switches say)
  v_switch := case
    when p_sender in ('send-candidate-message (office text)', 'send-candidate-message (interview cancelled)',
                      'send-candidate-message (applicant decision)', 'applicant-noshow') then 'ok_applicant_office_msgs_live'
    when p_sender = 'interview-messages' then 'ok_applicant_auto_msgs_live'
  end;
  if length(v_d) < 10 then v_d := null; end if;
  if v_d is null and v_e is null then return false; end if;
  select a.id, a.office into v_id, v_office from public.job_applicants a
   where (v_d is not null and right(regexp_replace(coalesce(a.phone,''), '\D', '', 'g'), 10) = v_d)
      or (v_e is not null and lower(a.email) = v_e)
   order by a.created_at desc limit 1;
  if v_office is distinct from 'OK' then return false; end if;
  select d.data into v_ops from public.app_data d where d.key = 'ops_settings';
  if v_switch is not null and coalesce((v_ops->>v_switch)::boolean, false) then return false; end if;
  update public.job_applicants set msgs_held_at = now(),
         msgs_held_note = left(coalesce(nullif(p_channel,''), 'message') || ' from ' || coalesce(nullif(p_sender,''), 'the Hub')
                               || case when v_switch is null then ' held: not set up for Oklahoma yet'
                                       when v_switch = 'ok_applicant_office_msgs_live' then ' held: Oklahoma office messages are off'
                                       else ' held: Oklahoma interview messages are off' end, 200)
   where id = v_id;
  return true;
end $f$;
revoke all on function public.ok_applicant_hold(text, text, text, text) from public, anon, authenticated;
grant execute on function public.ok_applicant_hold(text, text, text, text) to service_role;

create or replace function public.applicant_followup_stop(p uuid)
 returns text language sql stable security definer set search_path to 'public' as $f$
  select case
    when a.id is null then 'gone'
    when a.office = 'OK' then 'Oklahoma applicant: the recruiter calls (no automatic follow-ups)'   -- 808 (806 held them)
    when a.status not in ('partial','new') then 'closed'
    when a.gave_up_at is not null then 'follow-ups finished'
    when a.decline_reason is not null or a.screen_grade = 'declined' or public.applicant_screening_gap(p) = 'ineligible'
      then 'ineligible'
    when a.one_year = 'family' then 'waiting for the office to verify family caregiving'   -- 731
    when exists (select 1 from public.interview_bookings b where b.status = 'booked'
                  and b.applicant_id in (select public.applicant_person_ids(p))) then 'booked'
    when exists (select 1 from public.interview_bookings b where b.status = 'cancelled' and b.cancelled_by = 'applicant'
                  and b.applicant_id in (select public.applicant_person_ids(p))) then 'withdrew (cancelled their interview)'
    when exists (select 1 from public.interview_bookings b where b.status = 'cancelled' and b.cancelled_by = 'office'
                  and b.applicant_id in (select public.applicant_person_ids(p))) then 'the office cancelled their interview'
    when exists (select 1 from public.interview_bookings b where b.status in ('attended','noshow')
                  and b.applicant_id in (select public.applicant_person_ids(p))) then 'already interviewed or missed it'
  end
  from (select 1) one left join public.job_applicants a on a.id = p
$f$;
revoke all on function public.applicant_followup_stop(uuid) from public, anon, authenticated;   -- the server's follow-up job only

commit;
notify pgrst, 'reload schema';
