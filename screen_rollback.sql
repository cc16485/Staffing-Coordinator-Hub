-- 354 rollback (only if Samantha asks): the exact live code from before 354 (Desktop 353's copy), and the catch-up rows removed.

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
begin
  select * into r from public.job_applicants where id = p_id;
  if not found then return null; end if;
  select * into s from public.screening_settings where id = 1;

  v_digits := nullif(regexp_replace(coalesce(r.phone,''), '[^0-9]', '', 'g'), '');
  -- Ten digits is a US number; a leading 1 is the same person.
  if length(v_digits) = 11 and left(v_digits,1) = '1' then v_digits := right(v_digits, 10); end if;

  -- Applied before? The earliest record is the one to work from.
  select id into v_dup
  from public.job_applicants o
  where o.id <> p_id
    and o.created_at < r.created_at
    and (
      (v_digits is not null and right(regexp_replace(coalesce(o.phone,''), '[^0-9]', '', 'g'), 10) = right(v_digits, 10))
      or (r.email is not null and lower(o.email) = lower(r.email))
    )
  order by o.created_at
  limit 1;

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

CREATE OR REPLACE FUNCTION public.apply_save(p_id uuid, p_data jsonb, p_done boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_prior_id uuid;
  v_prior_status text;
  v_new_digits text := regexp_replace(coalesce(p_data->>'phone',''), '\D', '', 'g');
begin
  if p_id is null then
    -- Have we seen this person before? Match on a 10+ digit phone OR an email.
    -- Skip 'partial' rows (abandoned starts) so an unfinished attempt is not
    -- treated as a prior application.
    select id, status into v_prior_id, v_prior_status
      from public.job_applicants
     where status <> 'partial'
       and (
            (length(v_new_digits) >= 10
              and right(regexp_replace(coalesce(phone,''),'\D','','g'), 10) = right(v_new_digits, 10))
         or (nullif(lower(p_data->>'email'),'') is not null
              and lower(coalesce(email,'')) = lower(p_data->>'email'))
           )
     order by created_at desc
     limit 1;

    insert into public.job_applicants (
      posting_slug, posting_title, source, channel,
      first_name, last_name, phone, email, zip, city, job_type,
      hours_wanted, will_build_up,
      experience_kinds, sms_consent, position, status,
      duplicate_of, screen_grade, screen_flags)
    values (
      p_data->>'posting_slug', p_data->>'posting_title',
      coalesce(p_data->>'source','website'), p_data->>'channel',
      p_data->>'first_name', p_data->>'last_name', p_data->>'phone',
      p_data->>'email', p_data->>'zip', p_data->>'city', p_data->>'job_type',
      p_data->>'hours_wanted', (p_data->>'will_build_up')::boolean,
      case when p_data ? 'experience_kinds'
        then array(select jsonb_array_elements_text(p_data->'experience_kinds')) end,
      coalesce((p_data->>'sms_consent')::boolean, false),
      p_data->>'position',
      'partial',
      v_prior_id,
      case when v_prior_id is not null then 'duplicate' else null end,
      case
        when v_prior_status = 'declined'
          then array['Previously DECLINED — open their earlier application and review before proceeding']
        when v_prior_id is not null
          then array['Applied before — there is an earlier application on file']
        else null end)
    returning id into v_id;
    return v_id;
  end if;

  -- UPDATE path — unchanged from the original function.
  update public.job_applicants set
    first_name    = coalesce(p_data->>'first_name', first_name),
    last_name     = coalesce(p_data->>'last_name', last_name),
    phone         = coalesce(p_data->>'phone', phone),
    email         = coalesce(p_data->>'email', email),
    zip           = coalesce(p_data->>'zip', zip),
    city          = coalesce(p_data->>'city', city),
    job_type      = coalesce(p_data->>'job_type', job_type),
    hours_wanted  = coalesce(p_data->>'hours_wanted', hours_wanted),
    will_build_up = coalesce((p_data->>'will_build_up')::boolean, will_build_up),
    experience_kinds = case when p_data ? 'experience_kinds'
      then array(select jsonb_array_elements_text(p_data->'experience_kinds')) else experience_kinds end,
    sms_consent   = coalesce((p_data->>'sms_consent')::boolean, sms_consent),
    position      = coalesce(p_data->>'position', position),
    role_answers  = case when p_data ? 'role_answers' and p_data->'role_answers' <> 'null'::jsonb
                         then p_data->'role_answers' else role_answers end,
    age_ok        = coalesce((p_data->>'age_ok')::boolean, age_ok),
    work_auth     = coalesce((p_data->>'work_auth')::boolean, work_auth),
    has_transport = coalesce((p_data->>'has_transport')::boolean, has_transport),
    has_license   = coalesce((p_data->>'has_license')::boolean, has_license),
    has_insurance = coalesce((p_data->>'has_insurance')::boolean, has_insurance),
    can_pass_background = coalesce((p_data->>'can_pass_background')::boolean, can_pass_background),
    lived_outside_mo    = coalesce((p_data->>'lived_outside_mo')::boolean, lived_outside_mo),
    states_lived     = coalesce(p_data->>'states_lived', states_lived),
    experience_years = coalesce(p_data->>'experience_years', experience_years),
    experience       = coalesce(p_data->>'experience', experience),
    availability     = coalesce(p_data->>'availability', availability),
    referral_source  = coalesce(p_data->>'referral_source', referral_source),
    decline_reason = coalesce(p_data->>'decline_reason', decline_reason),
    completed_at  = case when p_done or p_data ? 'decline_reason'
                         then coalesce(completed_at, now()) else completed_at end,
    status        = case
                      when p_data ? 'decline_reason' then 'declined'
                      when p_done and status = 'partial' then 'new'
                      else status end
  where id = p_id
    and status = 'partial'
  returning id into v_id;
  return v_id;
end $function$;

drop trigger if exists applicant_screen_after on public.job_applicants;
CREATE TRIGGER applicant_screen_after AFTER INSERT OR UPDATE OF completed_at, decline_reason, phone, email, zip, has_license, has_insurance, can_pass_background, lived_outside_mo, experience_kinds, status ON public.job_applicants FOR EACH ROW WHEN ((pg_trigger_depth() = 1)) EXECUTE FUNCTION applicant_screen_trigger();

drop trigger if exists offboard_to_dnr_after on public.job_applicants;
CREATE TRIGGER offboard_to_dnr_after AFTER UPDATE OF rehire_ok, left_at ON public.job_applicants FOR EACH ROW WHEN ((pg_trigger_depth() = 1)) EXECUTE FUNCTION offboard_to_dnr();

delete from public.do_not_rehire where added_by like 'catch-up 354:%';
-- The G2 grades can stay (they are what the screen says); to clear them: update job_applicants set screen_grade = null ... for the ids in the 354 report window.
