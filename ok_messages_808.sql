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
--   · Driving is required for Oklahoma (her rule, relayed 2026-10-16): screening gap, screen and the office's questions.
--   · applicant_followup_stop: Oklahoma applicants never get the "finish your application" / "pick a time" follow-ups
--     (decision 2: no self-booking in Oklahoma, the recruiter calls).
-- Built on ok_companion_806.sql (the hold, the follow-up stop, the screen, the gap); the Desktop step checks the live ones match first.
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

-- ---------------------------------------------------------------------------------------------------------------------
-- 808: DRIVING IS REQUIRED for every Oklahoma Companion (her rule 2026-10-16, relayed: "I think every employee has to be able
-- to drive clients since that's one of the few services its too hard to filter non drivers out"). Replaces 806's "asked,
-- not required": the screening gap treats a no as ineligible and a missing answer as a question to ask; the screen no
-- longer lets "won't drive clients" pass as qualified; the office's Oklahoma questions ask it.
-- ---------------------------------------------------------------------------------------------------------------------
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
    -- 808: driving is REQUIRED (her rule 2026-10-16: "every employee has to be able to drive clients"); the form turns a no
    -- away; a no that reaches the Hub another way is a flag that holds them for a look.
    if r.has_transport = false then v_flags := array_append(v_flags, 'won''t drive clients (every Companion drives)'); end if;
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
  elsif v_ok and v_flags <@ array['under a year of experience']::text[] then
    v_grade := 'qualified';   -- 806: asked so the recruiter knows, not a reason to hold anyone back (808: driving is no longer one)
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
      when a.decline_reason is not null or a.age_ok is false or a.work_auth is false or a.can_pass_background is false
        or a.has_transport is false then 'ineligible'                                          -- 808: every Companion drives
      when a.age_ok is null or a.work_auth is null or a.can_pass_background is null or a.has_transport is null then 'questions'
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

-- 808: the Oklahoma four (driving added). The 806 three-answer version stays for a Hub page loaded before 808's Hub change.
create or replace function public.applicant_screen_by_office_ok(p uuid, p_age_ok boolean, p_work_auth boolean, p_okscreen boolean, p_drives boolean)
 returns text language plpgsql security definer set search_path to 'public' as $f$
declare v_by text;
begin
  if not public.hub_office_ok() then raise exception 'office staff only'; end if;
  if p_age_ok is null or p_work_auth is null or p_okscreen is null or p_drives is null then raise exception 'all four answers are needed'; end if;
  if not exists (select 1 from public.job_applicants a where a.id = p and a.office = 'OK') then
    raise exception 'not an Oklahoma application';
  end if;
  if exists (select 1 from public.job_applicants a where a.id = p and (
       (a.age_ok is not null and a.age_ok is distinct from p_age_ok)
    or (a.work_auth is not null and a.work_auth is distinct from p_work_auth)
    or (a.can_pass_background is not null and a.can_pass_background is distinct from p_okscreen)
    or (a.has_transport is not null and a.has_transport is distinct from p_drives)))
  then raise exception 'SCREENING_LOCKED: an answer is already on file and is different; answers already given cannot be changed'; end if;
  v_by := coalesce(nullif(auth.jwt()->>'email',''), 'office');
  update public.job_applicants a set
    age_ok = coalesce(a.age_ok, p_age_ok), work_auth = coalesce(a.work_auth, p_work_auth),
    can_pass_background = coalesce(a.can_pass_background, p_okscreen),
    has_transport = coalesce(a.has_transport, p_drives),
    completed_at = coalesce(a.completed_at, now()),
    status = case when a.status = 'partial' then 'reviewing' else a.status end,
    screened_by = v_by, screened_at = now()
  where a.id = p and a.status in ('partial','new','reviewing');
  if not found then raise exception 'application not open'; end if;
  return public.applicant_screening_gap(p);
end $f$;
revoke all on function public.applicant_screen_by_office_ok(uuid, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.applicant_screen_by_office_ok(uuid, boolean, boolean, boolean, boolean) to authenticated;

commit;
notify pgrst, 'reload schema';
