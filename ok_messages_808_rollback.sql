-- ok_messages_808_rollback.sql: puts back 806's hold (one switch, ok_applicant_msgs_live, off), 806's follow-up stop, and
-- 806's screen and screening gap (driving asked, not required); removes the four-answer Oklahoma office screen.
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
CREATE OR REPLACE FUNCTION public.applicant_screen(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r      public.job_applicants;
  s      public.screening_settings;
  home   public.zip_points;
  office public.zip_points;
  v_dup  uuid;
  v_mi   numeric;
  v_flags text[] := '{}';
  v_grade text;
  v_digits text;
  v_dup_status text;
  v_ok   boolean;
begin
  select * into r from public.job_applicants where id = p_id;
  if not found then return null; end if;
  select * into s from public.screening_settings where id = 1;
  v_ok := r.office = 'OK';   -- 806: Caring Companions Oklahoma (Mustang)

  v_digits := nullif(regexp_replace(coalesce(r.phone,''), '[^0-9]', '', 'g'), '');
  -- Ten digits is a US number; a leading 1 is the same person.
  if length(v_digits) = 11 and left(v_digits,1) = '1' then v_digits := right(v_digits, 10); end if;

  -- Applied before? The earliest record is the one to work from.
  select id, status into v_dup, v_dup_status
  from public.job_applicants o
  where o.id <> p_id
    and o.created_at < r.created_at
    and o.status <> 'partial'   -- 354: their own unfinished start is not an earlier application (the form's rule too)
    and (
      (v_digits is not null and right(regexp_replace(coalesce(o.phone,''), '[^0-9]', '', 'g'), 10) = right(v_digits, 10))
      or (r.email is not null and lower(o.email) = lower(r.email))
    )
  order by o.created_at
  limit 1;

  -- 354: say so on the record, as the form does when they start, so running the screen never wipes the warning.
  if v_dup is not null then
    v_flags := array_append(v_flags, case when v_dup_status = 'declined'
      then 'Previously DECLINED: open their earlier application and review before proceeding'
      else 'Applied before: there is an earlier application on file' end);
  end if;

  -- Somebody we would not take back.
  if exists (
    select 1 from public.do_not_rehire d
    where (v_digits is not null and d.phone_digits is not null
           and right(regexp_replace(d.phone_digits,'[^0-9]','','g'), 10) = right(v_digits, 10))
       or (r.email is not null and d.email is not null and lower(d.email) = lower(r.email))
  ) then
    v_flags := array_append(v_flags, 'not eligible for rehire');
  end if;

  -- How far out they are. 806: from the office they applied to.
  select * into office from public.zip_points where zip = case when v_ok then coalesce(s.office_zip_ok, '73064') else s.office_zip end;
  if r.zip is not null then
    select * into home from public.zip_points where zip = left(regexp_replace(r.zip,'[^0-9]','','g'), 5);
  end if;
  if home.zip is not null and office.zip is not null then
    v_mi := public.miles_between(office.lat, office.lon, home.lat, home.lon);
    if v_mi > s.far_miles then
      v_flags := array_append(v_flags, v_mi::text || ' miles out');
    elsif v_mi > s.review_miles then
      v_flags := array_append(v_flags, v_mi::text || ' miles out, worth checking the drive');
    end if;
  elsif r.zip is not null then
    v_flags := array_append(v_flags, 'zip we do not cover, check where they are');
  end if;

  -- The rest is context rather than distance.
  if v_ok then
    -- 806: driving clients is asked, not required (her decision 4); OKSCREEN is a knockout on the form itself.
    if r.has_transport = false then v_flags := array_append(v_flags, 'won''t drive clients'); end if;
  else
    if r.has_license = false then v_flags := array_append(v_flags, 'no driver''s license'); end if;
    if r.has_insurance = false then v_flags := array_append(v_flags, 'no auto insurance'); end if;
  end if;
  if r.can_pass_background = false then v_flags := array_append(v_flags, 'unsure about the background check'); end if;
  if r.lived_outside_mo and not v_ok then v_flags := array_append(v_flags, 'lived outside Missouri, fingerprints needed'); end if;
  if (r.experience_kinds is not null
      and not exists (select 1 from unnest(r.experience_kinds) k where k ~* 'agency|facility|hospital|friends|family'))
    then v_flags := array_append(v_flags, 'no caregiving experience yet'); end if;
  -- 806: Oklahoma asks experience with older adults; under a year is a flag, never a no (her decision 2).
  if v_ok and r.experience_years in ('None yet', 'Less than 1 year') then
    v_flags := array_append(v_flags, 'under a year of experience'); end if;

  -- The grade. Distance never decides on its own: it puts somebody in front of
  -- a person, and the person decides.
  if r.decline_reason is not null or r.status = 'declined' then
    v_grade := 'declined';
  elsif v_dup is not null then
    v_grade := 'duplicate';
  elsif array_length(v_flags, 1) is null then
    v_grade := 'qualified';
  elsif v_flags = array['no caregiving experience yet']::text[]
     or v_flags = array['lived outside Missouri, fingerprints needed']::text[] then
    -- Neither is a reason to slow anybody down. We train, and the fingerprint
    -- check simply starts earlier.
    v_grade := 'qualified';
  elsif v_ok and v_flags <@ array['under a year of experience', 'won''t drive clients']::text[] then
    v_grade := 'qualified';   -- 806: asked so the recruiter knows, not a reason to hold anyone back
  else
    v_grade := 'review';
  end if;

  update public.job_applicants
     set duplicate_of = v_dup,
         screen_grade = v_grade,
         screen_flags = v_flags,
         miles_out    = v_mi
   where id = p_id;

  return v_grade;
end $function$;

create or replace function public.applicant_screening_gap(p uuid)
 returns text language sql stable security definer set search_path to 'public' as $f$
  select case
    when a.id is null then null    -- not this rule's call: interview_book already says 'application not open'
    when a.office = 'OK' then case   -- 806
      when a.decline_reason is not null or a.age_ok is false or a.work_auth is false or a.can_pass_background is false then 'ineligible'
      when a.age_ok is null or a.work_auth is null or a.can_pass_background is null then 'questions'
      when a.completed_at is null then 'unfinished' end
    when a.decline_reason is not null or a.age_ok is false or a.work_auth is false or a.has_transport is false
      or (jp.track = 'prn' and a.prn->>'cna' = 'false')
      or a.one_year = 'no' then 'ineligible'
    when a.age_ok is null or a.work_auth is null or a.has_transport is null
      or (jp.track = 'prn' and (a.prn->'cna' is null or a.prn->'one_year' is null))
      or a.one_year is null or a.one_year = 'family' then 'questions'   -- 731: 'family' waits for the office to verify
    when a.completed_at is null then 'unfinished'
  end
  from (select 1) one
  left join public.job_applicants a on a.id = p
  left join public.job_positions jp on jp.key = a.position
$f$;
revoke all on function public.applicant_screening_gap(uuid) from public, anon;
grant execute on function public.applicant_screening_gap(uuid) to authenticated;

drop function if exists public.applicant_screen_by_office_ok(uuid, boolean, boolean, boolean, boolean);

commit;
notify pgrst, 'reload schema';
