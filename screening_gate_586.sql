-- screening_gate_586.sql (Desktop 586, 2026-10-11). SCREENING BEFORE BOOKING.
-- Samantha: "Before rewriting the messages, please fix the application screening gap. Applicants must complete the
-- required screening questions before the server allows interview booking, even if someone opens a booking link
-- directly." and "Make sure follow-ups stop when someone books, withdraws, opts out or becomes ineligible."
--
-- The gap: step 1 of mo-care.com/apply saves on its own (status 'partial'), the follow-up texts link straight to the
-- time picker, and interview_book accepted 'partial', so somebody could book having never answered 18+, allowed to
-- work in the U.S. or transportation.
--
-- "Required" is exactly what the form already requires, nothing new: those three questions (a no to any of them ends the
-- application), the PRN CNA Team's two CNA questions on a PRN role, and the finished form (completed_at; step 3 asks
-- when they can work). Licence, insurance, background and the rest stay context for a person, never a gate.
--
--   · applicant_screening_gap(p): null = done; 'ineligible' / 'questions' / 'unfinished' otherwise.
--   · interview_book: refuses with SCREEN_FIRST until the gap is null (so do moves, which call it).
--   · interview_mine: their link says 'screen_first' (and whether the form can still be finished) instead of times.
--   · applicant_screen_by_office(...): the office records the answers it got on the phone (hand-entered people never
--     saw the form), with who and when, and finishes the application. A no stays a no: it cannot clear a decline.
--   · Answers are locked once given (Samantha: "Existing screening answers cannot be accidentally overwritten by office
--     staff"): a trigger refuses any change to a given answer, from any screen. The one exception is the applicant still
--     filling in the form (status 'partial'), who may change a yes before finishing. A no is final. The office's own
--     decisions (decline reason, reactivate) are not touched.
--   · Bookings are guarded at the table too: a booking row can only become 'booked' through interview_book, which runs
--     the screening rule, so a direct write cannot get round it. One booking at a time per person (a lock).
--   · interview_bookings.booked_by: 'applicant' or the office user's email, for the audit history.
--   · Interviews already booked stay exactly as they are, including being moved online (they are marked
--     screen_grandfathered at install; nobody else can set that mark).
--   · applicant_followup_stop(p): why the "pick a time" follow-ups must not go (booked, withdrew, cancelled by the
--     office, ineligible, closed). Opt-outs are checked at the moment of sending, as now.
-- Interviews already booked are left exactly as they are. Built on interview_book as installed by 512 and interview_mine
-- as installed by 461; the Desktop step checks the live ones match before changing anything.
-- Rollback: screening_gate_586_rollback.sql (the two new columns are harmless left in place).
begin;

alter table public.job_applicants add column if not exists screened_by text;
alter table public.job_applicants add column if not exists screened_at timestamptz;
alter table public.interview_bookings add column if not exists booked_by text;
alter table public.interview_bookings add column if not exists screen_grandfathered boolean not null default false;

create or replace function public.applicant_screening_gap(p uuid)
 returns text language sql stable security definer set search_path to 'public' as $f$
  select case
    when a.id is null then null    -- not this rule's call: interview_book already says 'application not open'
    when a.decline_reason is not null or a.age_ok is false or a.work_auth is false or a.has_transport is false
      or (jp.track = 'prn' and a.prn->>'cna' = 'false') then 'ineligible'
    when a.age_ok is null or a.work_auth is null or a.has_transport is null
      or (jp.track = 'prn' and (a.prn->'cna' is null or a.prn->'one_year' is null)) then 'questions'
    when a.completed_at is null then 'unfinished'
  end
  from (select 1) one
  left join public.job_applicants a on a.id = p
  left join public.job_positions jp on jp.key = a.position
$f$;
revoke all on function public.applicant_screening_gap(uuid) from public, anon;
grant execute on function public.applicant_screening_gap(uuid) to authenticated;   -- the Hub shows what is missing

-- The office's answers from a phone call. Signed-in staff only. Returns what is still missing (null = they can be booked).
create or replace function public.applicant_screen_by_office(p uuid, p_age_ok boolean, p_work_auth boolean,
  p_has_transport boolean, p_prn_cna boolean default null, p_prn_one_year boolean default null)
 returns text language plpgsql security definer set search_path to 'public' as $f$
declare v_by text;
begin
  if coalesce(auth.role(),'anon') <> 'authenticated' then raise exception 'sign in first'; end if;
  if p_age_ok is null or p_work_auth is null or p_has_transport is null then
    raise exception 'all three answers are needed';
  end if;
  v_by := coalesce(nullif(auth.jwt()->>'email',''), 'office');
  -- Fill only: an answer already on file (from the form or an earlier call) is never changed here. A different answer
  -- is refused and named, so a mis-click cannot quietly undo what the applicant said.
  if exists (select 1 from public.job_applicants a where a.id = p and (
       (a.age_ok is not null and a.age_ok is distinct from p_age_ok)
    or (a.work_auth is not null and a.work_auth is distinct from p_work_auth)
    or (a.has_transport is not null and a.has_transport is distinct from p_has_transport)
    or (p_prn_cna is not null and a.prn ? 'cna' and (a.prn->>'cna')::boolean is distinct from p_prn_cna)
    or (p_prn_one_year is not null and a.prn ? 'one_year' and (a.prn->>'one_year')::boolean is distinct from p_prn_one_year)))
  then raise exception 'SCREENING_LOCKED: an answer is already on file and is different; answers already given cannot be changed'; end if;
  update public.job_applicants a set
    age_ok = coalesce(a.age_ok, p_age_ok), work_auth = coalesce(a.work_auth, p_work_auth),
    has_transport = coalesce(a.has_transport, p_has_transport),
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
revoke all on function public.applicant_screen_by_office(uuid, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.applicant_screen_by_office(uuid, boolean, boolean, boolean, boolean, boolean) to authenticated;

-- Answers already given stay as given. Applies to every route (Hub screens, the API, other functions). The applicant
-- still filling in the form may change a yes before finishing; a no is final. A deliberate correction
-- is possible only from the SQL editor with: set local cc.screening_correction = 'on';
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
  -- decline_reason is NOT locked: the office writes it ("Not moving forward", "not a fit after interview") and clears it
  -- when it reactivates someone (Hub apSetStatus / apOutcome). A screening no stays a no through the locked answers
  -- above, so a reactivated "under 18" is still not bookable.
  return new;
end $f$;
drop trigger if exists job_applicants_screen_guard on public.job_applicants;
create trigger job_applicants_screen_guard before update of age_ok, work_auth, has_transport, prn
  on public.job_applicants for each row execute function public.job_applicants_screen_guard();

-- An interview already booked before 586 may still be moved (by them online, or by the office) without the questions:
-- "keep the existing bookings unchanged". True while they hold one, or inside the move that just let it go.
create or replace function public.applicant_grandfathered_move(p uuid)
 returns boolean language sql stable security definer set search_path to 'public' as $f$
  select exists (select 1 from public.interview_bookings b
                  where b.applicant_id in (select public.applicant_person_ids(p)) and b.screen_grandfathered
                    and (b.status = 'booked' or (b.status = 'cancelled' and b.cancelled_by = 'reschedule' and b.cancelled_at = now())))
$f$;
revoke all on function public.applicant_grandfathered_move(uuid) from public, anon, authenticated;

-- A booking row only becomes 'booked' through interview_book (which runs the screening rule and marks the moment it
-- has). A direct insert or update by anyone else is refused, and nobody but the install can set the grandfathered mark.
create or replace function public.interview_bookings_screen_guard()
 returns trigger language plpgsql set search_path to 'public' as $f$
declare v_ok boolean := coalesce(current_setting('cc.screen_checked', true), '') = new.applicant_id::text;
        v_corr boolean := coalesce(current_setting('cc.screening_correction', true), '') = 'on';
begin
  if v_corr then return new; end if;
  if tg_op = 'UPDATE' and new.screen_grandfathered is distinct from old.screen_grandfathered then
    raise exception 'SCREENING_LOCKED: the grandfathered mark is set only at install';
  end if;
  if new.status = 'booked' and (tg_op = 'INSERT' or old.status is distinct from 'booked') and not v_ok then
    raise exception 'SCREEN_FIRST: bookings are made through interview_book only';
  end if;
  if tg_op = 'INSERT' and new.screen_grandfathered and not v_ok then
    raise exception 'SCREENING_LOCKED: the grandfathered mark is set only at install';
  end if;
  return new;
end $f$;
drop trigger if exists interview_bookings_screen_guard on public.interview_bookings;
create trigger interview_bookings_screen_guard before insert or update on public.interview_bookings
  for each row execute function public.interview_bookings_screen_guard();

-- Existing interviews keep working exactly as before (see applicant_grandfathered_move).
set local cc.screening_correction = 'on';
update public.interview_bookings b set screen_grandfathered = true
 where b.status = 'booked' and public.applicant_screening_gap(b.applicant_id) is not null;
set local cc.screening_correction = 'off';

-- Why the "pick a time" follow-ups must stop for this application (null = they may go). Checked on every run, per person
-- (all of their applications), so a booking or a cancel under another application counts too.
create or replace function public.applicant_followup_stop(p uuid)
 returns text language sql stable security definer set search_path to 'public' as $f$
  select case
    when a.id is null then 'gone'
    when a.status not in ('partial','new') then 'closed'
    when a.gave_up_at is not null then 'follow-ups finished'
    when a.decline_reason is not null or a.screen_grade = 'declined' or public.applicant_screening_gap(p) = 'ineligible'
      then 'ineligible'
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

CREATE OR REPLACE FUNCTION public.interview_book(p_applicant uuid, p_starts timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a public.activity_types;
  v_id uuid; v_who uuid; v_end timestamptz; v_ok boolean;
  v_gap text; v_gf boolean;
begin
  select * into a from public.activity_types where key = 'interview';
  v_end := p_starts + (a.minutes || ' minutes')::interval;

  -- NO-SHOW (2026-10-01): a no-show cannot book again (their old link included) until the office excuses it.
  if exists (select 1 from public.job_applicants where id = p_applicant and status = 'noshow')
     or exists (select 1 from public.job_applicants cur
                 where cur.id = p_applicant and public.applicant_noshow_match(cur.phone, cur.email, cur.id))
  then raise exception 'NOSHOW_BEFORE: no-showed for an interview before'; end if;

  select true into v_ok from public.job_applicants
   where id = p_applicant and status in ('partial','new','reviewing');
  if not found then raise exception 'application not open'; end if;

  -- 586 (Samantha, 2026-10-11: "Applicants must complete the required screening questions before the server allows
  -- interview booking, even if someone opens a booking link directly"). Every door comes through here: the form, their
  -- link, a move (interview_reschedule calls this), and the office's Book a time.
  v_gap := public.applicant_screening_gap(p_applicant);
  v_gf  := v_gap is not null and public.applicant_grandfathered_move(p_applicant);   -- an interview booked before 586
  if v_gap is not null and not v_gf then raise exception 'SCREEN_FIRST: %', v_gap; end if;
  -- One booking at a time per person: two taps, two tabs, or the office and the applicant at the same moment queue
  -- here instead of both booking.
  perform pg_advisory_xact_lock(hashtext('interview_book:' || (select min(x::text) from public.applicant_person_ids(p_applicant) x)));
  perform set_config('cc.screen_checked', p_applicant::text, true);   -- lets the booking-table guard know the rule ran

  -- 461 (Samantha: "reapply with us reviewing first"): applied again after the office chose not to move forward. They
  -- cannot book until the office approves this application (Hub: Approve, let them book). Replaces the older check that
  -- only looked at duplicate_of.
  if public.applicant_needs_review(p_applicant)
  then raise exception 'REVIEW_FIRST: applied before; the office reviews it before an interview is booked'; end if;

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
  -- 512 (Samantha, 2026-10-08: "Krystal is the first option during her hours"): whoever is first in the booking order
  -- and free takes it; only then the one with fewer that day.
  order by coalesce(c.booking_order, 1000), (
    select count(*) from public.coordinator_busy cb2
    where cb2.coordinator_id = av.coordinator_id
      and cb2.starts_at::date = (p_starts at time zone 'America/Chicago')::date
  ), random()
  limit 1;

  if v_who is null then raise exception 'that time was just taken'; end if;

  update public.interview_bookings set status = 'rescheduled'
   where applicant_id = p_applicant and status = 'booked';
  -- 461: one person, one interview. Their live booking under any OTHER application is let go quietly (marked told, so no
  -- "cancelled" message: the new booking's confirmation is the message).
  update public.interview_bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'reschedule',
         cancel_reason = 'booked again under another application', cancel_notified_at = now()
   where status = 'booked' and applicant_id <> p_applicant
     and applicant_id in (select public.applicant_person_ids(p_applicant));
  delete from public.coordinator_busy
   where source = 'interview' and source_id in (select x::text from public.applicant_person_ids(p_applicant) x);

  insert into public.interview_bookings (applicant_id, coordinator_id, starts_at, ends_at, booked_by, screen_grandfathered)
  values (p_applicant, v_who, p_starts, v_end,
          case when coalesce(auth.role(),'anon') = 'authenticated' then coalesce(nullif(auth.jwt()->>'email',''), 'office') else 'applicant' end,
          coalesce(v_gf, false))
  returning id into v_id;

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
  v_gap     text;
begin
  -- NO-SHOW (2026-10-01): their link says so instead of offering times
  if exists (select 1 from job_applicants where id = p_applicant and status = 'noshow') then
    return json_build_object('status', 'noshow');
  end if;
  -- 461: applied again after "not moving forward": the page says the office will review it first
  if applicant_needs_review(p_applicant) then
    return json_build_object('status', 'review');
  end if;
  -- 461: this PERSON's booking, under whichever of their applications holds it
  select * into v_row from interview_bookings
   where applicant_id in (select applicant_person_ids(p_applicant)) and status = 'booked'
   order by starts_at limit 1;
  if v_row.id is null then
    -- 586: no booking yet and the screening questions are not done: their link takes them back to the form (only an
    -- unfinished online application can still be finished online; anything else is a phone call).
    v_gap := applicant_screening_gap(p_applicant);
    if v_gap is not null then
      return (select json_build_object('status', 'screen_first', 'gap', v_gap,
                'can_finish', a.status = 'partial', 'position', a.position)   -- the role, so the form asks its own questions
                from job_applicants a where a.id = p_applicant);
    end if;
    return 'null'::json;
  end if;

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

grant execute on function public.interview_mine(uuid) to anon, authenticated;

commit;
notify pgrst, 'reload schema';
