-- Rollback for noshow_policy.sql: the live definitions as of 2026-10-01 (Desktop 399). The added columns stay (they only hold history).

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
    -- 354: where they have worked, as rows. Dropped when this function was last rewritten; the form always sends it.
    work_history  = case when p_data ? 'work_history' and p_data->'work_history' <> 'null'::jsonb
                         then p_data->'work_history' else work_history end,
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
