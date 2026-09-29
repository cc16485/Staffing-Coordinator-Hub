-- ============================================================================
-- PRN1 · THE PRN CNA TEAM, RECRUITING (Desktop 352). Samantha approved 2026-09-29 ("yes to all").
-- SHARED HUB PROJECT (zngsgedlsxinbygwmxwn). Safe to run again.
--
-- Pay belongs to the shift: PRN and open coverage $20 an hour, an ongoing assignment $18. This part is only the
-- recruiting end: the role, its always-on posting, the answers a PRN applicant gives, the pay acknowledgment, and
-- the screen that reads them.
--
-- Nothing already live is replaced. apply_save and applicant_screen stay exactly as they are; the PRN answers go
-- through their own small function, and the PRN checks run as their own triggers beside the existing screen.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Written down at last. These three were made in the SQL editor and never kept in a file, so a rebuild would
-- have lost them. "if not exists" means this changes nothing where they are already there.
-- ---------------------------------------------------------------------------
create table if not exists public.job_positions (
  key       text primary key,
  label     text not null,
  screener  jsonb not null default '[]'::jsonb,   -- [{q, type: yesno|text, knockout}]
  pay_min   numeric(8,2),
  pay_max   numeric(8,2),
  pay_unit  text default 'HOUR',
  sort      int default 0,
  active    boolean not null default true
);
alter table public.job_postings   add column if not exists position text;
alter table public.job_applicants add column if not exists post_interview jsonb;

-- ---------------------------------------------------------------------------
-- The role carries its own track and, for the PRN Team, the pay statement applicants must accept.
-- The statement and its version live on the role (not in the page), so what an applicant agreed to is always
-- the wording the office set, and a new wording gets a new version.
-- ---------------------------------------------------------------------------
alter table public.job_positions
  add column if not exists track           text,   -- 'prn' for the PRN CNA Team
  add column if not exists pay_ack         text,
  add column if not exists pay_ack_version text;

-- What a PRN applicant tells us, and when they accepted the pay.
--   prn: {cna, one_year, days[mon..sun], times[morning,daytime,evening,overnight], notice, interests[]}
alter table public.job_applicants
  add column if not exists prn             jsonb,
  add column if not exists pay_ack_at      timestamptz,
  add column if not exists pay_ack_version text,
  add column if not exists pay_ack_text    text;


-- ---------------------------------------------------------------------------
-- Only the answers the form offers survive. Anything else a browser sends is dropped, so the Hub never shows a
-- day or an interest nobody could have picked.
-- ---------------------------------------------------------------------------
create or replace function public.prn_clean(p jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'cna',      case when jsonb_typeof(p->'cna') = 'boolean' then p->'cna' end,
    'one_year', case when jsonb_typeof(p->'one_year') = 'boolean' then p->'one_year' end,
    'days', case when jsonb_typeof(p->'days') = 'array' then (
      select coalesce(jsonb_agg(v order by array_position(array['mon','tue','wed','thu','fri','sat','sun'], v)), '[]'::jsonb)
      from (select distinct x as v from jsonb_array_elements_text(p->'days') x
            where x in ('mon','tue','wed','thu','fri','sat','sun')) s) end,
    'times', case when jsonb_typeof(p->'times') = 'array' then (
      select coalesce(jsonb_agg(v order by array_position(array['morning','daytime','evening','overnight'], v)), '[]'::jsonb)
      from (select distinct x as v from jsonb_array_elements_text(p->'times') x
            where x in ('morning','daytime','evening','overnight')) s) end,
    'notice', case when p->>'notice' in ('same_day','few_hours','24h','48h') then p->>'notice' end,
    'interests', case when jsonb_typeof(p->'interests') = 'array' then (
      select coalesce(jsonb_agg(v order by array_position(array['calloffs','evenings','overnights','weekends','short','long','multiday'], v)), '[]'::jsonb)
      from (select distinct x as v from jsonb_array_elements_text(p->'interests') x
            where x in ('calloffs','evenings','overnights','weekends','short','long','multiday')) s) end
  ));
$$;


-- ---------------------------------------------------------------------------
-- apply_prn_save: the PRN answers and the pay acknowledgment, for an application still being filled in.
-- Public on purpose (the apply page runs without a sign-in), and only ever touches the PRN columns of an
-- unfinished application for a PRN role. The pay wording and version stored are read from the role here,
-- never taken from the browser, and the time is the server's.
-- ---------------------------------------------------------------------------
create or replace function public.apply_prn_save(p_id uuid, p_position text, p_prn jsonb, p_pay_ack boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pos  text;
  v_role public.job_positions;
  v_id   uuid;
begin
  select coalesce(a.position, p_position) into v_pos
    from public.job_applicants a where a.id = p_id and a.status = 'partial';
  if v_pos is null then return null; end if;
  select * into v_role from public.job_positions where key = v_pos;
  if v_role.track is distinct from 'prn' then return null; end if;

  update public.job_applicants set
    position        = coalesce(position, v_pos),
    prn             = case when jsonb_typeof(p_prn) = 'object'
                           then coalesce(prn, '{}'::jsonb) || public.prn_clean(p_prn) else prn end,
    pay_ack_at      = case when pay_ack_at is null and p_pay_ack and v_role.pay_ack is not null then now() else pay_ack_at end,
    pay_ack_version = case when pay_ack_at is null and p_pay_ack and v_role.pay_ack is not null then v_role.pay_ack_version else pay_ack_version end,
    pay_ack_text    = case when pay_ack_at is null and p_pay_ack and v_role.pay_ack is not null then v_role.pay_ack else pay_ack_text end
  where id = p_id and status = 'partial'
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.apply_prn_save(uuid, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.apply_prn_save(uuid, text, jsonb, boolean) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- A PRN application can't be finished without the pay acknowledgment. The form already insists; this is the
-- database insisting too. Turning somebody away (the CNA question) still finishes the record as declined.
-- ---------------------------------------------------------------------------
create or replace function public.applicant_prn_pay_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_role public.job_positions;
begin
  if new.position is null or new.pay_ack_at is not null or new.decline_reason is not null then return new; end if;
  select * into v_role from public.job_positions where key = new.position;
  if v_role.track = 'prn' and v_role.pay_ack is not null then
    raise exception 'PAY_ACK_REQUIRED' using errcode = 'P0001',
      hint = 'A PRN CNA Team application needs the pay acknowledgment before it is sent.';
  end if;
  return new;
end $$;

drop trigger if exists applicant_prn_pay_guard on public.job_applicants;
create trigger applicant_prn_pay_guard
  before update of completed_at on public.job_applicants
  for each row
  when (old.completed_at is null and new.completed_at is not null)
  execute function public.applicant_prn_pay_guard();


-- ---------------------------------------------------------------------------
-- The PRN part of the screen. Runs after the existing screen (triggers of the same kind run in name order, and
-- this name sorts last), and only adds to what it decided:
--   not a CNA · under a year's experience · pay not accepted · no days or times given
-- Any of these moves "cleared the screen" to "needs a look", so a person decides. Nobody is turned away here.
-- ---------------------------------------------------------------------------
create or replace function public.applicant_screen_prn(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r       public.job_applicants;
  v_track text;
  v_mine  text[] := array['CNA not confirmed', 'under a year of caregiving experience',
                          'PRN Team pay not acknowledged', 'no PRN availability given'];
  v_flags text[] := '{}';
  v_days  int;
  v_times int;
begin
  select * into r from public.job_applicants where id = p_id;
  if not found or r.position is null then return; end if;
  select track into v_track from public.job_positions where key = r.position;
  if v_track is distinct from 'prn' then return; end if;
  -- Somebody the form already turned away needs no more flags.
  if r.completed_at is null or r.decline_reason is not null then return; end if;

  v_days  := case when jsonb_typeof(r.prn->'days')  = 'array' then jsonb_array_length(r.prn->'days')  else 0 end;
  v_times := case when jsonb_typeof(r.prn->'times') = 'array' then jsonb_array_length(r.prn->'times') else 0 end;
  if (r.prn->>'cna') is distinct from 'true' then v_flags := array_append(v_flags, 'CNA not confirmed'); end if;
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

create or replace function public.applicant_screen_prn_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.completed_at is not null or new.decline_reason is not null then
    perform public.applicant_screen_prn(new.id);
  end if;
  return null;
end $$;

drop trigger if exists zz_applicant_screen_prn on public.job_applicants;
create trigger zz_applicant_screen_prn
  after insert or update of completed_at, decline_reason, phone, email, zip,
                            has_license, has_insurance, can_pass_background,
                            lived_outside_mo, experience_kinds, status, prn, pay_ack_at
  on public.job_applicants
  for each row
  when (pg_trigger_depth() < 1)   -- only the application's own save; never the screens' own updates
  execute function public.applicant_screen_prn_trigger();


-- ---------------------------------------------------------------------------
-- The role. Inserted once; running this again never overwrites an edit made in the Hub. Its always-on posting is
-- prn1_posting.sql, published only once the live proof has passed.
-- ---------------------------------------------------------------------------
insert into public.job_positions (key, label, screener, pay_min, pay_max, pay_unit, sort, active, track, pay_ack, pay_ack_version)
select 'prn_cna', 'PRN CNA Team', '[]'::jsonb, 20, null, 'HOUR',
       coalesce((select max(sort) from public.job_positions), 0) + 1, true, 'prn',
       'I understand that Caring Companions PRN Team shifts are paid at $20/hour. If I choose to accept an ongoing/regular client schedule, ongoing scheduled shifts are paid at $18/hour.',
       'PRN-PAY-2026-09'
where not exists (select 1 from public.job_positions where key = 'prn_cna');
