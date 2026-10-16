-- ok_messages_808_rollback.sql: puts back 806's hold (one switch, ok_applicant_msgs_live, off) and 806's follow-up stop.
-- The ops_settings keys 808 added (ok_from_number and the two switches) stay; nothing reads them after this.
begin;
create or replace function public.ok_applicant_hold(p_phone text, p_email text, p_sender text default null, p_channel text default null)
 returns boolean language plpgsql security definer set search_path to 'public' as $f$
declare
  v_d text := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10);
  v_e text := nullif(lower(btrim(coalesce(p_email,''))), '');
  v_id uuid; v_office text;
begin
  if coalesce((select (d.data->>'ok_applicant_msgs_live')::boolean from public.app_data d where d.key = 'ops_settings'), false) then
    return false;
  end if;
  if length(v_d) < 10 then v_d := null; end if;
  if v_d is null and v_e is null then return false; end if;
  select a.id, a.office into v_id, v_office from public.job_applicants a
   where (v_d is not null and right(regexp_replace(coalesce(a.phone,''), '\D', '', 'g'), 10) = v_d)
      or (v_e is not null and lower(a.email) = v_e)
   order by a.created_at desc limit 1;
  if v_office is distinct from 'OK' then return false; end if;
  update public.job_applicants set msgs_held_at = now(),
         msgs_held_note = left(coalesce(nullif(p_channel,''), 'message') || ' from ' || coalesce(nullif(p_sender,''), 'the Hub')
                               || ' held: Oklahoma applicant messages are off', 200)
   where id = v_id;
  return true;
end $f$;
revoke all on function public.ok_applicant_hold(text, text, text, text) from public, anon, authenticated;
grant execute on function public.ok_applicant_hold(text, text, text, text) to service_role;

create or replace function public.applicant_followup_stop(p uuid)
 returns text language sql stable security definer set search_path to 'public' as $f$
  select case
    when a.id is null then 'gone'
    when a.office = 'OK' and coalesce((select (d.data->>'ok_applicant_msgs_live')::boolean from public.app_data d
                                        where d.key = 'ops_settings'), false) is not true
      then 'Oklahoma applicant: messages held'   -- 806
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
