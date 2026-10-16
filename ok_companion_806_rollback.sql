-- ok_companion_806_rollback.sql: puts back applicant_screen (screen_fix.sql, 354) with its trigger, and 731's screening gap and
-- follow-up stop; removes the office trigger, the Oklahoma office screen and the move (the hold stays: the redeployed senders ask it); retires the Companion position.
-- The columns (office, msgs_held_*, office_zip_ok, moved_applicant_id) and the Oklahoma ZIPs stay: harmless left in place.
-- Every applicant moved in from the opening list stays in the Hub (they are real applicants).
begin;
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
begin
  select * into r from public.job_applicants where id = p_id;
  if not found then return null; end if;
  select * into s from public.screening_settings where id = 1;

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

  -- How far out they are.
  select * into office from public.zip_points where zip = s.office_zip;
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
  if r.has_license = false then v_flags := array_append(v_flags, 'no driver''s license'); end if;
  if r.has_insurance = false then v_flags := array_append(v_flags, 'no auto insurance'); end if;
  if r.can_pass_background = false then v_flags := array_append(v_flags, 'unsure about the background check'); end if;
  if r.lived_outside_mo then v_flags := array_append(v_flags, 'lived outside Missouri, fingerprints needed'); end if;
  if (r.experience_kinds is not null
      and not exists (select 1 from unnest(r.experience_kinds) k where k ~* 'agency|facility|hospital|friends|family'))
    then v_flags := array_append(v_flags, 'no caregiving experience yet'); end if;

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

drop trigger if exists applicant_screen_after on public.job_applicants;
create trigger applicant_screen_after
  after insert or update of completed_at, decline_reason, phone, email, zip,
                            has_license, has_insurance, can_pass_background,
                            lived_outside_mo, experience_kinds, status
  on public.job_applicants
  for each row
  when (pg_trigger_depth() < 1)   -- the application's own save; never the screen's own update
  execute function public.applicant_screen_trigger();

create or replace function public.applicant_screening_gap(p uuid)
 returns text language sql stable security definer set search_path to 'public' as $f$
  select case
    when a.id is null then null    -- not this rule's call: interview_book already says 'application not open'
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

create or replace function public.applicant_followup_stop(p uuid)
 returns text language sql stable security definer set search_path to 'public' as $f$
  select case
    when a.id is null then 'gone'
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

drop trigger if exists job_applicants_office_from_position on public.job_applicants;
drop function if exists public.job_applicants_office_from_position();
drop function if exists public.applicant_screen_by_office_ok(uuid, boolean, boolean, boolean);
drop function if exists public.ok_companion_move(boolean);
update public.job_positions set active = false where key = 'companion';
commit;
notify pgrst, 'reload schema';
