-- one_year_731.sql (Desktop 731, 2026-10-14). A YEAR OF PAID EXPERIENCE.
-- Samantha 2026-10-14: "we also need to require a year of paid experience"; paid family caregiving counts with pay
-- records; unpaid family caregiving counts if "a hospice or home health nurse" or "family member can verify" it, "as an
-- office review, not automatic". Under a year otherwise: a kind decline on the form.
--
--   · job_applicants.one_year: 'yes' | 'family' (unpaid family caregiving, waiting for the office) | 'family_ok' (the
--     office verified it, with who confirmed it in one_year_confirmer) | 'no'. Null on applications from before 731.
--   · applicant_screening_gap: 'no' is ineligible; null or 'family' is 'questions' (no interview until answered/verified).
--     Interviews already booked are untouched (586's grandfathering still applies to moves).
--   · applicant_screen_by_office: two new optional answers (p_one_year, p_one_year_confirmer). The office's review is
--     the only change allowed after the answer is given: 'family' becomes 'family_ok' or 'no'.
--   · job_applicants_screen_guard: the same lock for one_year, on every route.
--   · applicant_followup_stop: no "pick a time" follow-ups while family caregiving waits for the office.
--   · apply_save: stores the form's answer. Nothing else in it changes.
-- Built on screening_gate_586.sql (gap, office, guard, follow-up stop) and noshow_policy.sql (apply_save); the Desktop
-- step checks the live ones match before changing anything. Rollback: one_year_731_rollback.sql.
begin;

alter table public.job_applicants add column if not exists one_year text;
alter table public.job_applicants add column if not exists one_year_confirmer text;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'job_applicants_one_year_chk') then
    alter table public.job_applicants add constraint job_applicants_one_year_chk
      check (one_year is null or one_year in ('yes','family','family_ok','no'));
  end if;
end $c$;

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

-- The old six-answer version is replaced by the eight-answer one (the two new answers are optional).
drop function if exists public.applicant_screen_by_office(uuid, boolean, boolean, boolean, boolean, boolean);
create or replace function public.applicant_screen_by_office(p uuid, p_age_ok boolean, p_work_auth boolean,
  p_has_transport boolean, p_prn_cna boolean default null, p_prn_one_year boolean default null,
  p_one_year text default null, p_one_year_confirmer text default null)
 returns text language plpgsql security definer set search_path to 'public' as $f$
declare v_by text;
begin
  if coalesce(auth.role(),'anon') <> 'authenticated' then raise exception 'sign in first'; end if;
  if p_age_ok is null or p_work_auth is null or p_has_transport is null then
    raise exception 'all three answers are needed';
  end if;
  if p_one_year is not null and p_one_year not in ('yes','family_ok','no') then
    raise exception 'one year answer must be yes, family_ok or no';
  end if;
  if p_one_year = 'family_ok' and nullif(btrim(coalesce(p_one_year_confirmer,'')),'') is null then
    raise exception 'say who confirmed the family caregiving';
  end if;
  v_by := coalesce(nullif(auth.jwt()->>'email',''), 'office');
  -- Fill only: an answer already on file (from the form or an earlier call) is never changed here. A different answer
  -- is refused and named, so a mis-click cannot quietly undo what the applicant said.
  if exists (select 1 from public.job_applicants a where a.id = p and (
       (a.age_ok is not null and a.age_ok is distinct from p_age_ok)
    or (a.work_auth is not null and a.work_auth is distinct from p_work_auth)
    or (a.has_transport is not null and a.has_transport is distinct from p_has_transport)
    or (p_prn_cna is not null and a.prn ? 'cna' and (a.prn->>'cna')::boolean is distinct from p_prn_cna)
    or (p_prn_one_year is not null and a.prn ? 'one_year' and (a.prn->>'one_year')::boolean is distinct from p_prn_one_year)
    -- 731: the one change allowed is the office's review of family caregiving ('family' becomes 'family_ok' or 'no').
    or (p_one_year is not null and a.one_year is not null and a.one_year is distinct from p_one_year
        and not (a.one_year = 'family' and p_one_year in ('family_ok','no')))))
  then raise exception 'SCREENING_LOCKED: an answer is already on file and is different; answers already given cannot be changed'; end if;
  update public.job_applicants a set
    age_ok = coalesce(a.age_ok, p_age_ok), work_auth = coalesce(a.work_auth, p_work_auth),
    has_transport = coalesce(a.has_transport, p_has_transport),
    one_year = case when a.one_year is null or a.one_year = 'family' then coalesce(p_one_year, a.one_year) else a.one_year end,
    one_year_confirmer = case when p_one_year = 'family_ok' then btrim(p_one_year_confirmer) else a.one_year_confirmer end,
    prn = case when exists (select 1 from public.job_positions jp where jp.key = a.position and jp.track = 'prn')
                and (p_prn_cna is not null or p_prn_one_year is not null)
               then jsonb_strip_nulls(jsonb_build_object('cna', p_prn_cna, 'one_year', p_prn_one_year)) || coalesce(a.prn, '{}'::jsonb)
               else a.prn end,
    completed_at = coalesce(a.completed_at, now()),
    status = case when a.status = 'partial' then 'reviewing' else a.status end,
    screened_by = v_by, screened_at = now()
  where a.id = p and a.status in ('partial','new','reviewing');
  if not found then raise exception 'application not open'; end if;
  return public.applicant_screening_gap(p);
end $f$;
revoke all on function public.applicant_screen_by_office(uuid, boolean, boolean, boolean, boolean, boolean, text, text) from public, anon;
grant execute on function public.applicant_screen_by_office(uuid, boolean, boolean, boolean, boolean, boolean, text, text) to authenticated;

create or replace function public.job_applicants_screen_guard()
 returns trigger language plpgsql set search_path to 'public' as $f$
declare
  v_form boolean := old.status = 'partial' and coalesce(auth.role(),'anon') <> 'authenticated';
  v_old boolean; v_new boolean; k text;
begin
  if coalesce(current_setting('cc.screening_correction', true), '') = 'on' then return new; end if;
  foreach k in array array['age_ok','work_auth','has_transport','prn_cna','prn_one_year'] loop
    v_old := case k when 'age_ok' then old.age_ok when 'work_auth' then old.work_auth when 'has_transport' then old.has_transport
                    when 'prn_cna' then (old.prn->>'cna')::boolean else (old.prn->>'one_year')::boolean end;
    v_new := case k when 'age_ok' then new.age_ok when 'work_auth' then new.work_auth when 'has_transport' then new.has_transport
                    when 'prn_cna' then (new.prn->>'cna')::boolean else (new.prn->>'one_year')::boolean end;
    if v_old is not null and v_new is distinct from v_old and not (v_form and v_old) then
      raise exception 'SCREENING_LOCKED: % was already answered; answers already given cannot be changed', k;
    end if;
  end loop;
  -- 731: the year-of-experience answer. Same rule; the one change allowed after it is given is the office's review of
  -- family caregiving ('family' becomes 'family_ok' or 'no'), and the applicant may still change it while filling in the
  -- form, unless it was a no.
  if old.one_year is not null and new.one_year is distinct from old.one_year
     and not (v_form and old.one_year <> 'no')
     and not (old.one_year = 'family' and new.one_year in ('family_ok','no') and coalesce(auth.role(),'anon') = 'authenticated') then
    raise exception 'SCREENING_LOCKED: one_year was already answered; answers already given cannot be changed';
  end if;
  -- decline_reason is NOT locked: the office writes it ("Not moving forward", "not a fit after interview") and clears it
  -- when it reactivates someone (Hub apSetStatus / apOutcome). A screening no stays a no through the locked answers
  -- above, so a reactivated "under 18" is still not bookable.
  return new;
end $f$;
drop trigger if exists job_applicants_screen_guard on public.job_applicants;
create trigger job_applicants_screen_guard before update of age_ok, work_auth, has_transport, prn, one_year
  on public.job_applicants for each row execute function public.job_applicants_screen_guard();

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
    -- NO-SHOW (2026-10-01, Samantha: "not allowed to re-apply and if they try they are told that they have no-showed for
    -- an interview with us before"). An application from the same phone (last 10 digits) or email as one marked a
    -- no-show (and not excused by the office) is refused; the apply page shows the message.
    if public.applicant_noshow_match(p_data->>'phone', p_data->>'email', null) then
      raise exception 'NOSHOW_BEFORE: no-showed for an interview before';
    end if;
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
    -- 731: a year of paid experience ('yes' | 'family' | 'no'). Only the form's own three answers are accepted here.
    one_year      = case when p_data->>'one_year' in ('yes','family','no') then p_data->>'one_year' else one_year end,
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

commit;
