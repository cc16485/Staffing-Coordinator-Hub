-- =============================================================================
-- 1037 · THE PRN CAREGIVER TEAM (Samantha 2026-10-21: "Yes to all 8 PRN Caregiver recommendations. Use 10 as the starting
-- team goal." Design: https://claude.ai/artifact/YTpYS2zWUWHjLjwr1Rm6Da). Hub project. Run by Desktop step 1037.
-- Her pay: caregiver $16 ongoing, caregiver PRN $18, CNA $18 ongoing, CNA PRN $20 (the Hub's pay_rates card holds them).
--   1. job_positions.requires_cna (true for prn_cna, false for prn_caregiver) and pay_note (the ongoing note under the pay
--      box, so no page hard-codes it). The new role prn_caregiver "PRN Caregiver Team" with its own pay acknowledgment
--      (PRN-PAY-2026-10C).
--   2. applicant_screen_prn and applicant_screening_gap check CNA only when the role requires it (the office re-screen,
--      applicant_screen_by_office, ends in applicant_screening_gap, so it follows). The year of paid experience stays.
--   3. pay_tracks.team ('cna' | 'caregiver', default 'cna'); pay_track_history.from_team / to_team; pay_track_start (a
--      track starts on a team) and pay_team_change (a PRN Caregiver who earns a CNA moves to the PRN CNA Team), each one
--      transaction with its history line, server only.
--   4. ops_settings.prn_caregiver_minimum = 10 when it is not set (prn_team_minimum 20 stays for CNAs).
--   5. The always-on posting prn-caregiver-springfield (PER_DIEM, no expiry) as a DRAFT: publishing it on Recruit puts it
--      on mo-care.com through build-jobs.
-- Idempotent: inserts happen once, an edit made in the Hub is never overwritten. Rollback: prn-caregiver-1037-rollback.sql.
-- =============================================================================
alter table public.job_positions
  add column if not exists requires_cna boolean not null default true,
  add column if not exists pay_note text;

update public.job_positions set pay_note = 'Note: if you would like to switch to taking an ongoing client, our CNAs are paid $18 an hour.'
 where key = 'prn_cna' and pay_note is null;

insert into public.job_positions (key, label, screener, pay_min, pay_max, pay_unit, sort, active, track, pay_ack, pay_ack_version, requires_cna, pay_note)
select 'prn_caregiver', 'PRN Caregiver Team', '[]'::jsonb, 18, null, 'HOUR',
       coalesce((select max(sort) from public.job_positions), 0) + 1, true, 'prn',
       'I understand that Caring Companions PRN Caregiver Team members are paid $18/hour.',
       'PRN-PAY-2026-10C', false,
       'If you later move to a regular schedule, the ongoing caregiver rate is $16/hour.'
where not exists (select 1 from public.job_positions where key = 'prn_caregiver');

create or replace function public.applicant_screen_prn(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r       public.job_applicants;
  v_track text;
  v_cna   boolean;
  v_mine  text[] := array['CNA not confirmed', 'under a year of caregiving experience',
                          'PRN Team pay not acknowledged', 'no PRN availability given'];
  v_flags text[] := '{}';
  v_days  int;
  v_times int;
begin
  select * into r from public.job_applicants where id = p_id;
  if not found or r.position is null then return; end if;
  select track, coalesce(requires_cna, true) into v_track, v_cna from public.job_positions where key = r.position;
  if v_track is distinct from 'prn' then return; end if;
  -- Somebody the form already turned away needs no more flags.
  if r.completed_at is null or r.decline_reason is not null then return; end if;

  v_days  := case when jsonb_typeof(r.prn->'days')  = 'array' then jsonb_array_length(r.prn->'days')  else 0 end;
  v_times := case when jsonb_typeof(r.prn->'times') = 'array' then jsonb_array_length(r.prn->'times') else 0 end;
  -- 1037: CNA only for a role that needs it
  if v_cna and (r.prn->>'cna') is distinct from 'true' then v_flags := array_append(v_flags, 'CNA not confirmed'); end if;
  if (r.prn->>'one_year') = 'false' then v_flags := array_append(v_flags, 'under a year of caregiving experience'); end if;
  if r.pay_ack_at is null then v_flags := array_append(v_flags, 'PRN Team pay not acknowledged'); end if;
  if v_days = 0 or v_times = 0 then v_flags := array_append(v_flags, 'no PRN availability given'); end if;

  update public.job_applicants set
    screen_flags = array(select f from unnest(coalesce(screen_flags, '{}'::text[])) f where f <> all (v_mine)) || v_flags,
    screen_grade = case when screen_grade = 'qualified' and array_length(v_flags, 1) is not null then 'review' else screen_grade end
  where id = p_id;
end $$;

revoke all on function public.applicant_screen_prn(uuid) from public, anon;
grant execute on function public.applicant_screen_prn(uuid) to authenticated, service_role;

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
      or (jp.track = 'prn' and coalesce(jp.requires_cna, true) and a.prn->>'cna' = 'false')   -- 1037: CNA only for a role that needs it
      or a.one_year = 'no' then 'ineligible'
    when a.age_ok is null or a.work_auth is null or a.has_transport is null
      or (jp.track = 'prn' and ((coalesce(jp.requires_cna, true) and a.prn->'cna' is null) or a.prn->'one_year' is null))
      or a.one_year is null or a.one_year = 'family' then 'questions'   -- 731: 'family' waits for the office to verify
    when a.completed_at is null then 'unfinished'
  end
  from (select 1) one
  left join public.job_applicants a on a.id = p
  left join public.job_positions jp on jp.key = a.position
$f$;
revoke all on function public.applicant_screening_gap(uuid) from public, anon;
grant execute on function public.applicant_screening_gap(uuid) to authenticated;

alter table public.pay_tracks add column if not exists team text not null default 'cna';
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'pay_tracks_team_chk') then
    alter table public.pay_tracks add constraint pay_tracks_team_chk check (team in ('cna', 'caregiver'));
  end if;
end $c$;
alter table public.pay_track_history add column if not exists from_team text;
alter table public.pay_track_history add column if not exists to_team text;

-- pay_track_start: a track starts on its team (the role's own key decides: requires_cna = the PRN CNA Team).
create or replace function public.pay_track_start(p_applicant uuid, p_team text, p_rate numeric, p_effective date, p_by text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur public.pay_tracks;
begin
  if p_team not in ('cna', 'caregiver') then raise exception 'BAD_TEAM' using errcode = 'P0001'; end if;
  if p_rate is null or p_rate <= 0 or p_rate >= 200 then raise exception 'BAD_RATE' using errcode = 'P0001'; end if;
  if coalesce(trim(p_by), '') = '' or coalesce(trim(p_reason), '') = '' or p_effective is null then raise exception 'WHO_WHY_WHEN_REQUIRED' using errcode = 'P0001'; end if;
  select * into cur from public.pay_tracks where applicant_id = p_applicant for update;
  if found then return jsonb_build_object('outcome', 'already', 'track', cur.track, 'team', cur.team, 'rate', cur.rate); end if;
  insert into public.pay_tracks (applicant_id, track, team, rate, since) values (p_applicant, 'prn_team', p_team, p_rate, p_effective);
  insert into public.pay_track_history (applicant_id, from_track, from_rate, to_track, to_rate, effective_date, changed_by, reason, from_team, to_team)
  values (p_applicant, null, null, 'prn_team', p_rate, p_effective, trim(p_by), trim(p_reason), null, p_team);
  return jsonb_build_object('outcome', 'changed', 'to', 'prn_team', 'team', p_team, 'rate', p_rate);
end $$;
revoke all on function public.pay_track_start(uuid, text, numeric, date, text, text) from public, anon, authenticated;
grant execute on function public.pay_track_start(uuid, text, numeric, date, text, text) to service_role;

-- pay_team_change: a deliberate office step (decision 6): a PRN Caregiver who earns a CNA joins the PRN CNA Team at its rate.
create or replace function public.pay_team_change(p_applicant uuid, p_from_team text, p_to_team text, p_rate numeric, p_effective date, p_by text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur public.pay_tracks;
begin
  if p_to_team not in ('cna', 'caregiver') then raise exception 'BAD_TEAM' using errcode = 'P0001'; end if;
  if p_rate is null or p_rate <= 0 or p_rate >= 200 then raise exception 'BAD_RATE' using errcode = 'P0001'; end if;
  if coalesce(trim(p_by), '') = '' or coalesce(trim(p_reason), '') = '' or p_effective is null then raise exception 'WHO_WHY_WHEN_REQUIRED' using errcode = 'P0001'; end if;
  select * into cur from public.pay_tracks where applicant_id = p_applicant for update;
  if not found then raise exception 'NO_TRACK_YET' using errcode = 'P0001'; end if;
  if cur.team is distinct from p_from_team then raise exception 'TEAM_CHANGED' using errcode = 'P0001'; end if;
  if cur.team = p_to_team then raise exception 'SAME_TEAM' using errcode = 'P0001'; end if;
  update public.pay_tracks set team = p_to_team, rate = case when cur.track = 'prn_team' then p_rate else cur.rate end, since = p_effective, updated_at = now() where applicant_id = p_applicant;
  insert into public.pay_track_history (applicant_id, axiscare_caregiver_id, from_track, from_rate, to_track, to_rate, effective_date, changed_by, reason, from_team, to_team)
  values (p_applicant, cur.axiscare_caregiver_id, cur.track, cur.rate, cur.track, case when cur.track = 'prn_team' then p_rate else cur.rate end, p_effective, trim(p_by), trim(p_reason), cur.team, p_to_team);
  return jsonb_build_object('outcome', 'changed', 'from_team', cur.team, 'to_team', p_to_team, 'track', cur.track, 'rate', case when cur.track = 'prn_team' then p_rate else cur.rate end);
end $$;
revoke all on function public.pay_team_change(uuid, text, text, numeric, date, text, text) from public, anon, authenticated;
grant execute on function public.pay_team_change(uuid, text, text, numeric, date, text, text) to service_role;

update public.app_data set data = data || jsonb_build_object('prn_caregiver_minimum', 10), updated_at = now()
 where key = 'ops_settings' and not (data ? 'prn_caregiver_minimum');

insert into public.job_postings (slug, status, title, description, employment_type, pay_min, pay_max, pay_unit,
                                 summary, qualifications, openings, position, indeed_feed, valid_through, internal_note)
select 'prn-caregiver-springfield', 'draft', 'PRN Caregiver',
       E'Start PRN. Stay flexible.\n\n'
       || E'Join Caring Companions'' PRN Caregiver Team and earn $18 an hour, with the flexibility to decide when you can help.\n\n'
       || E'You tell us when you''re generally available. When we have an opportunity that may fit, we''ll text you. Can help? Accept it. Can''t help? Decline it. No pressure to accept, and no guilt for declining. There may be times when you can help often and times when you can''t help at all. That''s the beauty of PRN. But once you accept and are confirmed, we must be able to depend on you.\n\n'
       || E'PRN opportunities may include covering open shifts, being a second set of hands and supporting caregivers in the field.\n\n'
       || E'Apply in under two minutes. We keep this team open all year.\n\n'
       || E'Note: if you later move to a regular schedule, the ongoing caregiver rate is $16 an hour.',
       'PER_DIEM', 18, null, 'HOUR',
       '$18/hr · Start PRN. Stay flexible.',
       E'At least a year of paid caregiving experience\nA driver''s license and reliable transportation\nAble to pass a background check and references',
       1, 'prn_caregiver', true, null,
       'PRN Caregiver Team, always on (1037, 2026-10-21). ONE pay track at a time: PRN $18/hr OR ongoing caregiver $16/hr. A CNA moves to the PRN CNA Team ($20) through prn-team to_cna_team.'
where not exists (select 1 from public.job_postings where slug = 'prn-caregiver-springfield');

do $v$ begin
  if not exists (select 1 from public.job_positions where key = 'prn_caregiver' and track = 'prn' and requires_cna = false) then raise exception '1037 self-check: the PRN Caregiver Team role is missing'; end if;
  if exists (select 1 from public.job_positions where key = 'prn_cna' and requires_cna is distinct from true) then raise exception '1037 self-check: the PRN CNA Team no longer requires a CNA'; end if;
  if has_function_privilege('authenticated', 'public.pay_team_change(uuid, text, text, numeric, date, text, text)', 'execute') then raise exception '1037 self-check: only the server may change a team'; end if;
end $v$;
