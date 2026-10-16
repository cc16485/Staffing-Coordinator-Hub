-- ok_companion_806.sql (Desktop 806, 2026-10-16). OKLAHOMA COMPANION APPLICANTS IN THE SAME HUB.
-- Samantha 2026-10-16: "Approve the Oklahoma Companion pre-screener plan with all six decisions as you recommended. Start
-- building." Plan: https://claude.ai/artifact/KBxEA4jLABRzytSZqwPT9e
--
--   · job_applicants.office and job_positions.office: 'MO' | 'OK'. Every existing row reads MO. Nothing on the forms
--     chooses the office: it follows the position (job_applicants_office_from_position), so one control moves a person.
--   · The position 'companion' / "Companion", Oklahoma only. No job_postings row, so mo-care.com never shows it.
--   · applicant_screen: Oklahoma applicants are measured from Mustang (screening_settings.office_zip_ok, 73064) against the
--     17 Oklahoma service ZIPs; "lived outside Missouri" is never flagged for them; under a year of experience and "won't
--     drive clients" are flags that do not hold anyone back (her decisions 2 and 4).
--   · applicant_screening_gap: Oklahoma asks 18+, allowed to work, the OKSCREEN fingerprint check (can_pass_background).
--     Driving and the year of experience are not Oklahoma requirements. Missouri is exactly as 731 left it.
--   · applicant_followup_stop: Oklahoma applicants get no "pick a time" follow-ups (messages held, her decision 6).
--   · THE HOLD: ok_applicant_hold(phone, email, sender, channel) answers whether an address belongs to an Oklahoma applicant
--     while ops_settings.ok_applicant_msgs_live is not true, and marks the applicant's record (msgs_held_at/_note) so the
--     Hub shows "held". The server's shared send door asks it before any GoHighLevel contact is made.
--   · early_interest.moved_applicant_id: the one-time move of the opening-list caregivers (ok_companion_move(), run by
--     the Desktop step only after she has seen the count).
-- Built on screen_fix.sql (applicant_screen, 354) and one_year_731.sql (gap, follow-up stop); the Desktop step checks the
-- live ones match first. Rollback: ok_companion_806_rollback.sql.
begin;

-- ---------------------------------------------------------------------------------------------------------------------
-- The office
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.job_applicants add column if not exists office text not null default 'MO';
alter table public.job_positions  add column if not exists office text not null default 'MO';
alter table public.job_applicants add column if not exists msgs_held_at timestamptz;
alter table public.job_applicants add column if not exists msgs_held_note text;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'job_applicants_office_chk') then
    alter table public.job_applicants add constraint job_applicants_office_chk check (office in ('MO','OK'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'job_positions_office_chk') then
    alter table public.job_positions add constraint job_positions_office_chk check (office in ('MO','OK'));
  end if;
end $c$;
create index if not exists job_applicants_office_idx on public.job_applicants (office) where office <> 'MO';

insert into public.job_positions (key, label, sort, active, office)
values ('companion', 'Companion', 90, true, 'OK')
on conflict (key) do update set label = 'Companion', active = true, office = 'OK';

-- The office follows the position. A position the table does not know (or none) keeps what is there (MO on a new row).
create or replace function public.job_applicants_office_from_position()
 returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare v text;
begin
  if new.position is not null then
    select office into v from public.job_positions where key = new.position;
  end if;
  if v is not null then new.office := v;
  elsif tg_op = 'INSERT' then new.office := 'MO';
  else new.office := old.office;          -- the office is never typed in: only a position moves it
  end if;
  return new;
end $f$;
revoke all on function public.job_applicants_office_from_position() from public, anon, authenticated;
drop trigger if exists job_applicants_office_from_position on public.job_applicants;
create trigger job_applicants_office_from_position before insert or update of position, office
  on public.job_applicants for each row execute function public.job_applicants_office_from_position();

-- ---------------------------------------------------------------------------------------------------------------------
-- Miles from Mustang: the 17 ZIPs the Oklahoma office serves (centroids of the service-area map's ZCTA shapes,
-- caringcompanionsoklahoma.com assets/service-area.geojson, from the Census 2010 ZCTAs). A sorting aid, as in Missouri.
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.screening_settings add column if not exists office_zip_ok text not null default '73064';
insert into public.zip_points (zip, city, state, lat, lon) values
  ('73064','Mustang','OK',35.3752,-97.7455), ('73099','Yukon','OK',35.5283,-97.7624), ('73089','Tuttle','OK',35.2644,-97.7944),
  ('73036','El Reno','OK',35.5100,-97.9596), ('73078','Piedmont','OK',35.6703,-97.7535), ('73008','Bethany','OK',35.5140,-97.6460),
  ('73116','Nichols Hills','OK',35.5464,-97.5641), ('73127','Oklahoma City','OK',35.4776,-97.6539), ('73128','Oklahoma City','OK',35.4504,-97.6433),
  ('73132','Oklahoma City','OK',35.5509,-97.6400), ('73142','Oklahoma City','OK',35.6138,-97.6424), ('73159','Oklahoma City','OK',35.3901,-97.5768),
  ('73162','Oklahoma City','OK',35.5811,-97.6414), ('73169','Oklahoma City','OK',35.3813,-97.6426), ('73170','Oklahoma City','OK',35.3273,-97.5506),
  ('73173','Oklahoma City','OK',35.3452,-97.6223), ('73179','Oklahoma City','OK',35.4245,-97.6445)
on conflict (zip) do nothing;

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

-- 806: a change of position (and so of office) grades them again, from the right office.
drop trigger if exists applicant_screen_after on public.job_applicants;
create trigger applicant_screen_after
  after insert or update of completed_at, decline_reason, phone, email, zip,
                            has_license, has_insurance, can_pass_background,
                            lived_outside_mo, experience_kinds, status, office, has_transport, experience_years
  on public.job_applicants
  for each row
  when (pg_trigger_depth() < 1)   -- the application's own save; never the screen's own update
  execute function public.applicant_screen_trigger();

-- ---------------------------------------------------------------------------------------------------------------------
-- What still has to be asked before an interview. Missouri: exactly as 731. Oklahoma: 18+, allowed to work, OKSCREEN.
-- ---------------------------------------------------------------------------------------------------------------------
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

-- The office's answers for an Oklahoma applicant (asked on the phone): the Oklahoma three, fill only, as 586/731's screen.
create or replace function public.applicant_screen_by_office_ok(p uuid, p_age_ok boolean, p_work_auth boolean, p_okscreen boolean)
 returns text language plpgsql security definer set search_path to 'public' as $f$
declare v_by text;
begin
  if not public.hub_office_ok() then raise exception 'office staff only'; end if;
  if p_age_ok is null or p_work_auth is null or p_okscreen is null then raise exception 'all three answers are needed'; end if;
  if not exists (select 1 from public.job_applicants a where a.id = p and a.office = 'OK') then
    raise exception 'not an Oklahoma application';
  end if;
  if exists (select 1 from public.job_applicants a where a.id = p and (
       (a.age_ok is not null and a.age_ok is distinct from p_age_ok)
    or (a.work_auth is not null and a.work_auth is distinct from p_work_auth)
    or (a.can_pass_background is not null and a.can_pass_background is distinct from p_okscreen)))
  then raise exception 'SCREENING_LOCKED: an answer is already on file and is different; answers already given cannot be changed'; end if;
  v_by := coalesce(nullif(auth.jwt()->>'email',''), 'office');
  update public.job_applicants a set
    age_ok = coalesce(a.age_ok, p_age_ok), work_auth = coalesce(a.work_auth, p_work_auth),
    can_pass_background = coalesce(a.can_pass_background, p_okscreen),
    completed_at = coalesce(a.completed_at, now()),
    status = case when a.status = 'partial' then 'reviewing' else a.status end,
    screened_by = v_by, screened_at = now()
  where a.id = p and a.status in ('partial','new','reviewing');
  if not found then raise exception 'application not open'; end if;
  return public.applicant_screening_gap(p);
end $f$;
revoke all on function public.applicant_screen_by_office_ok(uuid, boolean, boolean, boolean) from public, anon;
grant execute on function public.applicant_screen_by_office_ok(uuid, boolean, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- THE HOLD. True when this phone or email belongs to somebody whose latest application is Oklahoma and Oklahoma applicant
-- messages are not switched on. Marks that application so the Hub can show what was held. Server only.
-- ---------------------------------------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------------------------------------
-- The opening list's caregivers, moved in once. ok_companion_move(false) only counts; (true) moves. Nobody is contacted.
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.early_interest add column if not exists moved_applicant_id uuid;
create or replace function public.ok_companion_move(p_do boolean)
 returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare e record; v_id uuid; v_first text; v_last text; v_moved int := 0; v_dup int := 0; v_todo int := 0;
begin
  for e in select * from public.early_interest
            where site = 'oklahoma' and kind = 'caregiver' and moved_applicant_id is null order by created_at loop
    -- already in the Hub (same last 10 digits or same email): link the list row to them, add nobody
    select a.id into v_id from public.job_applicants a
     where (length(regexp_replace(coalesce(e.phone,''),'\D','','g')) >= 10
            and right(regexp_replace(coalesce(a.phone,''),'\D','','g'),10) = right(regexp_replace(coalesce(e.phone,''),'\D','','g'),10))
        or (nullif(lower(e.email),'') is not null and lower(a.email) = lower(e.email))
     order by a.created_at limit 1;
    if v_id is not null then
      v_dup := v_dup + 1;
      if p_do then update public.early_interest set moved_applicant_id = v_id where id = e.id; end if;
      continue;
    end if;
    v_todo := v_todo + 1;
    if not p_do then continue; end if;
    v_first := split_part(btrim(e.name), ' ', 1);
    v_last  := nullif(btrim(substr(btrim(e.name), length(v_first) + 1)), '');
    insert into public.job_applicants (created_at, source, channel, posting_title, position, first_name, last_name, phone, email, zip,
                                       sms_consent, experience_years, availability, has_transport, role_answers, notes, status, completed_at)
    values (e.created_at, 'ok-opening-list', 'caringcompanionsoklahoma.com', 'Companion', 'companion', v_first, v_last, e.phone, e.email, e.zip,
            false,   -- that form asked "may we contact you", not for texts: call only
            nullif(e.experience, ''),
            case when e.interests @> array['weekdays-all'] then 'All weekdays, 8am to 6pm'
                 when e.interests @> array['weekdays-some'] then 'Some weekdays' end,
            case when e.interests @> array['drives'] then true end,
            jsonb_strip_nulls(jsonb_build_object('When can you start', e.timing,
              'CNA or HHA', case when e.interests @> array['cna-or-hha'] then 'Yes' end,
              'From the opening list', to_char(e.created_at at time zone 'America/Chicago', 'Mon DD, YYYY'))),
            nullif(btrim(coalesce(e.message,'')), ''),
            'new', e.created_at)
    returning id into v_id;
    update public.early_interest set moved_applicant_id = v_id where id = e.id;
    v_moved := v_moved + 1;
  end loop;
  return jsonb_build_object('to_move', v_todo, 'moved', v_moved, 'already_in_hub', v_dup);
end $f$;
revoke all on function public.ok_companion_move(boolean) from public, anon, authenticated;

commit;
notify pgrst, 'reload schema';
