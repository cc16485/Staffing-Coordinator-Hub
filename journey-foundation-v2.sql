-- =============================================================================
-- journey-foundation-v2.sql · Stage 2 v2 (approved Option 5 physical design)
-- Replaces the UNUSED Phase A Journey foundation. Run as one transaction.
--
--   episode_id  = canonical, immutable episode identity
--   person_id   = whose lifecycle (null only for unresolved inquiries)
--   no seq      = lifetime ordinal is DERIVED, only when complete history proves it
--   episode_fact= append-only, attributed lifecycle facts (begin, end, order, history)
--   AxisCare client id is person-level (identity layer); Journey never stores it
--
-- SAFETY
--   * Empty-foundation guard: every existing Journey table is locked ACCESS
--     EXCLUSIVE and counted inside this transaction. Any row aborts everything.
--   * Only the named Journey objects are dropped, never with CASCADE, so a
--     dependency from anything outside Journey aborts the migration instead.
--   * A self-check at the end raises on any mismatch, which rolls back all of it.
--   * RERUN: on an empty v2 install it reinstalls the identical foundation. With
--     any Journey row present it refuses and changes nothing.
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 0. EMPTY-FOUNDATION GUARD
-- ---------------------------------------------------------------------------
do $guard$
declare t text; n bigint;
begin
  foreach t in array array['journey_episode','episode_source','episode_fact',
                           'episode_review','episode_door_audit'] loop
    if to_regclass('public.' || t) is not null then
      execute format('lock table public.%I in access exclusive mode', t);
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        raise exception 'journey_foundation_v2 refused: public.% contains % row(s). Nothing was changed.', t, n;
      end if;
    end if;
  end loop;
end $guard$;

-- ---------------------------------------------------------------------------
-- 1. REMOVE THE EXISTING (EMPTY) JOURNEY FOUNDATION  · Phase A or a prior v2
-- ---------------------------------------------------------------------------
drop view if exists public.journey_episode_current, public.episode_order,
                    public.episode_range, public.episode_fact_current;
drop table if exists public.episode_review, public.episode_fact, public.episode_source,
                     public.journey_episode, public.episode_door_audit;
do $drop$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         -- Phase A
         'journey_episode_guard','episode_open_provisional','episode_resolve',
         'episode_attach_source','episode_set_state','episode_void',
         -- v2
         'journey_state_is_active','journey_state_is_terminal','journey_state_is_frozen',
         'journey_bound_lo','journey_bound_hi','journey_seat_ok','journey_lock_person',
         'journey_overlap','journey_open_review','journey_audit','journey_block_truncate',
         'episode_fact_guard','episode_append_only_guard','episode_review_guard',
         'episode_open_for_person','episode_record_fact','episode_record_historical',
         'episode_review_resolve')
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $drop$;

-- ---------------------------------------------------------------------------
-- 2. SINGLE DEFINITIONS (pure, immutable)
--    The ONLY place the active-state list is written. Index, Doors and views
--    all call it. (Redefining it later requires REINDEX of the one-active index.)
-- ---------------------------------------------------------------------------
create function public.journey_state_is_active(p_state text) returns boolean
language sql immutable parallel safe
as $$ select p_state in ('provisional','open','converted','established') $$;

create function public.journey_state_is_terminal(p_state text) returns boolean
language sql immutable parallel safe
as $$ select p_state in ('lost','abandoned','ended','closed') $$;

create function public.journey_state_is_frozen(p_state text) returns boolean
language sql immutable parallel safe
as $$ select public.journey_state_is_terminal(p_state) or p_state = 'voided' $$;

-- earliest / latest possible date implied by one begin-or-end fact
create function public.journey_bound_lo(p_basis text, p_on date, p_not_before date, p_not_after date)
returns date language sql immutable parallel safe
as $$ select case p_basis when 'documented' then p_on
                          when 'observed_window' then p_not_before
                          else '-infinity'::date end $$;

create function public.journey_bound_hi(p_basis text, p_on date, p_not_before date, p_not_after date)
returns date language sql immutable parallel safe
as $$ select case p_basis when 'documented' then p_on
                          when 'observed_window' then p_not_after
                          when 'before_observation' then p_not_after
                          else 'infinity'::date end $$;

create function public.journey_seat_ok(p_seat text) returns boolean
language sql immutable parallel safe
as $$ select p_seat in ('client_intake','owner_decision','system') $$;

-- ---------------------------------------------------------------------------
-- 3. TABLES
-- ---------------------------------------------------------------------------
create table public.journey_episode (
  episode_id                uuid primary key default gen_random_uuid(),
  person_id                 uuid references public.person_identity(id) on delete restrict,
  state                     text not null default 'provisional'
                              check (state in ('provisional','open','converted','established',
                                               'lost','abandoned','ended','closed','voided')),
  origin_kind               text not null default 'live' check (origin_kind in ('live','historical')),
  needs_review              boolean not null default false,
  void_reason               text,
  voided_at                 timestamptz,
  voided_by                 text,
  corrected_into_episode_id uuid references public.journey_episode(episode_id) on delete restrict,
  created_by                text not null default 'unspecified',
  created_at                timestamptz not null default now(),   -- record times, NOT lifecycle dates
  resolved_at               timestamptz,
  converted_at              timestamptz,
  terminal_at               timestamptz,
  updated_at                timestamptz not null default now(),
  constraint journey_episode_person_required
    check (person_id is not null or state in ('provisional','voided','lost','abandoned')),
  constraint journey_episode_provisional_unbound
    check (state <> 'provisional' or person_id is null),
  constraint journey_episode_void_fields check (
    state = 'voided'
    or (void_reason is null and voided_at is null and voided_by is null
        and corrected_into_episode_id is null)),
  constraint journey_episode_historical_terminal
    check (origin_kind <> 'historical' or public.journey_state_is_terminal(state))
);
comment on table public.journey_episode is
  'journey_foundation v2 · episode_id is the canonical identity; no seq; lifecycle facts in episode_fact';

-- one operationally active episode per person (single definition of "active")
create unique index journey_episode_one_active_uq
  on public.journey_episode (person_id)
  where person_id is not null and public.journey_state_is_active(state);
create index journey_episode_person_ix on public.journey_episode (person_id);

create table public.episode_fact (
  fact_id              uuid primary key default gen_random_uuid(),
  episode_id           uuid not null references public.journey_episode(episode_id) on delete restrict,
  fact_type            text not null
                         check (fact_type in ('began','ended','precedes','prior_history','erroneous','retract')),
  basis                text check (basis in ('documented','observed_window','before_observation','unknown')),
  on_date              date,
  not_before           date,
  not_after            date,
  other_episode_id     uuid references public.journey_episode(episode_id) on delete restrict,
  prior_history_status text check (prior_history_status in ('unobserved','none_found','documented_complete')),
  evidence             text not null check (length(btrim(evidence)) > 0),
  evidence_ref         text,
  asserted_by          text not null,
  acting_seat          text not null check (public.journey_seat_ok(acting_seat)),
  asserted_at          timestamptz not null default now(),
  supersedes_fact_id   uuid references public.episode_fact(fact_id) on delete restrict,
  constraint episode_fact_shape check (case fact_type
    when 'began' then other_episode_id is null and prior_history_status is null and (
         (basis = 'documented'         and on_date is not null and not_before is null and not_after is null)
      or (basis = 'observed_window'    and on_date is null and not_before is not null and not_after is not null
                                       and not_before <= not_after)
      or (basis = 'before_observation' and on_date is null and not_before is null and not_after is not null)
      or (basis = 'unknown'            and on_date is null and not_before is null and not_after is null))
    when 'ended' then other_episode_id is null and prior_history_status is null and (
         (basis = 'documented'         and on_date is not null and not_before is null and not_after is null)
      or (basis = 'observed_window'    and on_date is null and not_before is not null and not_after is not null
                                       and not_before <= not_after)
      or (basis = 'unknown'            and on_date is null and not_before is null and not_after is null))
    when 'precedes' then other_episode_id is not null and other_episode_id <> episode_id and basis is null
      and on_date is null and not_before is null and not_after is null and prior_history_status is null
    when 'prior_history' then prior_history_status is not null and basis is null and other_episode_id is null
      and on_date is null and not_before is null and not_after is null
    when 'erroneous' then basis is null and other_episode_id is null and prior_history_status is null
      and on_date is null and not_before is null and not_after is null
    when 'retract' then supersedes_fact_id is not null and basis is null and other_episode_id is null
      and prior_history_status is null and on_date is null and not_before is null and not_after is null
  end)
);
create unique index episode_fact_supersedes_once on public.episode_fact (supersedes_fact_id)
  where supersedes_fact_id is not null;
create index episode_fact_episode_ix on public.episode_fact (episode_id);

-- episode-level evidence ONLY. Person-level ids (AxisCare client, GHL contact)
-- live in the identity layer. Observation/event refs must be the durable record
-- id (tr_… transition, ce_… client event), never a bare client id.
create table public.episode_source (
  id          uuid primary key default gen_random_uuid(),
  episode_id  uuid not null references public.journey_episode(episode_id) on delete restrict,
  system      text not null
                check (system in ('lead','client_queue','axiscare_observation','axiscare_event','booking')),
  source_ref  text not null check (length(btrim(source_ref)) > 0),
  role        text not null check (role in ('origin','duplicate','additional','evidence')),
  linked_at   timestamptz not null default now(),
  linked_by   text,
  constraint episode_source_ref_shape check (
        (system <> 'axiscare_observation' or source_ref ~ '^tr_[^_]+_.+$')
    and (system <> 'axiscare_event'       or source_ref ~ '^ce_.+_.+$'))
);
create unique index episode_source_uq on public.episode_source (system, source_ref);
create unique index episode_source_one_origin_uq on public.episode_source (episode_id) where role = 'origin';

create table public.episode_review (
  review_id   uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('resolve_conflict','open_conflict','overlap',
                                            'historical_evidence','fact_correction','boundary')),
  seat        text not null check (seat in ('client_intake','owner_decision')),
  person_id   uuid references public.person_identity(id) on delete restrict,
  episode_id  uuid references public.journey_episode(episode_id) on delete restrict,
  status      text not null default 'open' check (status in ('open','resolved','dismissed')),
  detail      jsonb not null default '{}'::jsonb,
  created_by  text not null default 'unspecified',
  created_at  timestamptz not null default now(),
  resolved_by text,
  resolved_at timestamptz,
  resolution  text,
  constraint episode_review_resolution_fields check (
    (status = 'open' and resolved_by is null and resolved_at is null and resolution is null)
    or (status <> 'open' and resolved_by is not null and resolved_at is not null))
);
create index episode_review_open_ix on public.episode_review (seat) where status = 'open';

create table public.episode_door_audit (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  op           text not null check (op in ('open_provisional','resolve','open_for_person','set_state',
                                           'record_fact','record_historical','attach_source','void',
                                           'review_resolve')),
  workflow     text not null default 'unspecified',
  acting_staff text not null default 'unspecified',
  acting_seat  text not null default 'system',
  episode_id   uuid,
  person_id    uuid,
  outcome      text not null,
  detail       text
);

-- ---------------------------------------------------------------------------
-- 4. GUARD TRIGGERS
-- ---------------------------------------------------------------------------
create function public.journey_episode_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'journey_episode rows are never deleted (%)', old.episode_id;
  end if;
  if new.episode_id <> old.episode_id then
    raise exception 'journey_episode: episode_id is immutable';
  end if;
  if old.person_id is not null and new.person_id is distinct from old.person_id then
    raise exception 'journey_episode: person_id is immutable once set (%)', old.episode_id;
  end if;
  if new.origin_kind <> old.origin_kind then
    raise exception 'journey_episode: origin_kind is immutable (%)', old.episode_id;
  end if;
  if public.journey_state_is_frozen(old.state) and new is distinct from old then
    raise exception 'journey_episode: episode % is % and frozen', old.episode_id, old.state;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger journey_episode_guard_t before update or delete on public.journey_episode
  for each row execute function public.journey_episode_guard();

create function public.episode_append_only_guard() returns trigger
language plpgsql as $$
begin
  raise exception '%: rows are append-only (% refused)', tg_table_name, tg_op;
end $$;
create trigger episode_source_append_only_t before update or delete on public.episode_source
  for each row execute function public.episode_append_only_guard();
create trigger episode_fact_append_only_t before update or delete on public.episode_fact
  for each row execute function public.episode_append_only_guard();
create trigger episode_door_audit_append_only_t before update or delete on public.episode_door_audit
  for each row execute function public.episode_append_only_guard();

create function public.episode_fact_guard() returns trigger
language plpgsql as $$
declare v_target public.episode_fact%rowtype; v_p1 uuid; v_p2 uuid;
begin
  if new.supersedes_fact_id is not null then
    select * into v_target from public.episode_fact where fact_id = new.supersedes_fact_id;
    if v_target.episode_id <> new.episode_id then
      raise exception 'episode_fact: a correction must stay on the same episode';
    end if;
    if new.fact_type <> 'retract' and new.fact_type <> v_target.fact_type then
      raise exception 'episode_fact: a correction must keep the fact type';
    end if;
  end if;
  if new.fact_type = 'precedes' then
    select person_id into v_p1 from public.journey_episode where episode_id = new.episode_id;
    select person_id into v_p2 from public.journey_episode where episode_id = new.other_episode_id;
    if v_p1 is null or v_p1 is distinct from v_p2 then
      raise exception 'episode_fact: precedes must link two episodes of the same person';
    end if;
  end if;
  return new;
end $$;
create trigger episode_fact_insert_t before insert on public.episode_fact
  for each row execute function public.episode_fact_guard();

create function public.episode_review_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'episode_review rows are never deleted'; end if;
  if old.status <> 'open' then raise exception 'episode_review: % is already %', old.review_id, old.status; end if;
  if (new.review_id, new.kind, new.seat, new.person_id, new.episode_id, new.detail, new.created_by, new.created_at)
     is distinct from
     (old.review_id, old.kind, old.seat, old.person_id, old.episode_id, old.detail, old.created_by, old.created_at) then
    raise exception 'episode_review: only the resolution may change';
  end if;
  return new;
end $$;
create trigger episode_review_guard_t before update or delete on public.episode_review
  for each row execute function public.episode_review_guard();

create function public.journey_block_truncate() returns trigger
language plpgsql as $$
begin
  raise exception '% cannot be truncated', tg_table_name;
end $$;
create trigger journey_episode_no_truncate before truncate on public.journey_episode
  for each statement execute function public.journey_block_truncate();
create trigger episode_fact_no_truncate before truncate on public.episode_fact
  for each statement execute function public.journey_block_truncate();
create trigger episode_source_no_truncate before truncate on public.episode_source
  for each statement execute function public.journey_block_truncate();
create trigger episode_review_no_truncate before truncate on public.episode_review
  for each statement execute function public.journey_block_truncate();
create trigger episode_door_audit_no_truncate before truncate on public.episode_door_audit
  for each statement execute function public.journey_block_truncate();

-- ---------------------------------------------------------------------------
-- 5. DERIVED CURRENT TRUTH (read-only views, caller privileges)
-- ---------------------------------------------------------------------------
create view public.episode_fact_current with (security_invoker = true) as
select f.*
  from public.episode_fact f
 where f.fact_type <> 'retract'
   and not exists (select 1 from public.episode_fact s where s.supersedes_fact_id = f.fact_id);

create view public.episode_range with (security_invoker = true) as
select e.episode_id, e.person_id, e.state, e.origin_kind,
       (e.state <> 'voided'
        and not exists (select 1 from public.episode_fact_current x
                         where x.episode_id = e.episode_id and x.fact_type = 'erroneous')) as counted,
       b.basis as began_basis,
       public.journey_bound_lo(b.basis, b.on_date, b.not_before, b.not_after) as began_lo,
       public.journey_bound_hi(b.basis, b.on_date, b.not_before, b.not_after) as began_hi,
       d.basis as ended_basis,
       case when public.journey_state_is_active(e.state) then 'infinity'::date
            else public.journey_bound_lo(d.basis, d.on_date, d.not_before, d.not_after) end as ended_lo,
       case when public.journey_state_is_active(e.state) then 'infinity'::date
            else public.journey_bound_hi(d.basis, d.on_date, d.not_before, d.not_after) end as ended_hi,
       ph.prior_history_status
  from public.journey_episode e
  left join public.episode_fact_current b  on b.episode_id  = e.episode_id and b.fact_type  = 'began'
  left join public.episode_fact_current d  on d.episode_id  = e.episode_id and d.fact_type  = 'ended'
  left join public.episode_fact_current ph on ph.episode_id = e.episode_id and ph.fact_type = 'prior_history';

-- A before B when (1) A's latest possible end is strictly before B's earliest
-- possible begin, or (2) a date A certainly covers is earlier than a date B certainly
-- covers (lifecycles of one person cannot overlap, so that fixes their order), or
-- (3) a current documented "precedes" fact says so. Anything else is unknown.
create view public.episode_order with (security_invoker = true) as
select a.episode_id as earlier_episode_id, b.episode_id as later_episode_id, a.person_id, 'dates'::text as basis
  from public.episode_range a
  join public.episode_range b on b.person_id = a.person_id and b.episode_id <> a.episode_id
 where a.person_id is not null and a.counted and b.counted
   and (a.ended_hi < b.began_lo
        or (a.began_hi <= a.ended_lo and b.began_hi <= b.ended_lo
            and a.began_hi <> 'infinity'::date and b.began_hi <> 'infinity'::date
            and a.began_hi < b.began_hi))
union
select f.episode_id, f.other_episode_id, ra.person_id, 'fact'::text
  from public.episode_fact_current f
  join public.episode_range ra on ra.episode_id = f.episode_id
  join public.episode_range rb on rb.episode_id = f.other_episode_id
 where f.fact_type = 'precedes' and ra.counted and rb.counted;

-- lifetime_ordinal exists only when the person's earliest counted episode carries
-- documented_complete prior history AND every pair of counted episodes is ordered
-- without contradiction. Otherwise it is NULL and the reason says why.
create view public.journey_episode_current with (security_invoker = true) as
with pairs as (
  select distinct person_id, earlier_episode_id, later_episode_id from public.episode_order
), per_person as (
  select r.person_id,
         count(*) filter (where r.counted) as n,
         (select count(*) from pairs p where p.person_id = r.person_id) as n_pairs,
         exists (select 1 from pairs p1 join pairs p2
                   on p1.earlier_episode_id = p2.later_episode_id and p1.later_episode_id = p2.earlier_episode_id
                  where p1.person_id = r.person_id) as contradictory,
         exists (select 1 from public.episode_range c
                  where c.person_id = r.person_id and c.counted
                    and c.prior_history_status = 'documented_complete'
                    and not exists (select 1 from pairs p where p.later_episode_id = c.episode_id)) as complete_from_start
    from public.episode_range r
   where r.person_id is not null
   group by r.person_id
)
select r.*,
       case when r.counted and pp.complete_from_start and not pp.contradictory
                 and pp.n_pairs = pp.n * (pp.n - 1) / 2
            then 1 + (select count(*) from pairs p where p.later_episode_id = r.episode_id)::int
       end as lifetime_ordinal,
       case when r.person_id is null then 'person not resolved'
            when not r.counted then 'not a counted lifecycle'
            when pp.contradictory then 'contradictory order evidence'
            when not pp.complete_from_start then 'complete history not documented'
            when pp.n_pairs <> pp.n * (pp.n - 1) / 2 then 'order not fully established'
            else 'established' end as lifetime_ordinal_reason
  from public.episode_range r
  left join per_person pp on pp.person_id = r.person_id;

-- ---------------------------------------------------------------------------
-- 6. INTERNAL HELPERS (service_role only)
-- ---------------------------------------------------------------------------
create function public.journey_lock_person(p_person uuid) returns void
language sql security invoker
as $$ select pg_advisory_xact_lock(hashtext('journey_person'), hashtext(p_person::text)) $$;

-- first counted episode of p_person (other than p_exclude) that DEFINITELY overlaps
-- the given range: both lifecycles certainly cover a common date. A lifecycle
-- certainly covers [latest possible begin, earliest possible end] when that is
-- non-empty. Unknown bounds are ignorance, not conflict; a person cannot hold two
-- lifecycles at once, so documented evidence narrows an unknown bound instead.
create function public.journey_overlap(p_person uuid, p_b_lo date, p_b_hi date, p_e_lo date, p_e_hi date,
                                       p_exclude uuid) returns uuid
language sql stable security invoker
as $$
  select r.episode_id from public.episode_range r
   where r.person_id = p_person and r.counted and r.episode_id is distinct from p_exclude
     and p_b_hi <= p_e_lo and r.began_hi <= r.ended_lo
     and p_b_hi < r.ended_lo and r.began_hi < p_e_lo
   limit 1
$$;

create function public.journey_open_review(p_kind text, p_seat text, p_person uuid, p_episode uuid,
                                           p_detail jsonb, p_by text) returns uuid
language sql security invoker
as $$
  insert into public.episode_review (kind, seat, person_id, episode_id, detail, created_by)
  values (p_kind, p_seat, p_person, p_episode, coalesce(p_detail, '{}'::jsonb), coalesce(p_by, 'unspecified'))
  returning review_id
$$;

create function public.journey_audit(p_op text, p_workflow text, p_staff text, p_seat text,
                                     p_episode uuid, p_person uuid, p_outcome text, p_detail text) returns void
language sql security invoker
as $$
  insert into public.episode_door_audit (op, workflow, acting_staff, acting_seat, episode_id, person_id, outcome, detail)
  values (p_op, coalesce(p_workflow, 'unspecified'), coalesce(p_staff, 'unspecified'),
          coalesce(p_seat, 'system'), p_episode, p_person, p_outcome, p_detail)
$$;

-- ---------------------------------------------------------------------------
-- 7. DOORS  (security invoker; EXECUTE for service_role only)
-- ---------------------------------------------------------------------------

-- 7.1 an inquiry opens a lifecycle before anyone knows whose it is
create function public.episode_open_provisional(
  p_origin_system text default null, p_origin_ref text default null, p_began_on date default null,
  p_workflow text default 'unspecified', p_acting_staff text default 'unspecified',
  p_acting_seat text default 'client_intake'
) returns jsonb
language plpgsql security invoker as $$
declare v uuid;
begin
  if not public.journey_seat_ok(p_acting_seat) then return jsonb_build_object('outcome','invalid_seat'); end if;
  begin
    insert into public.journey_episode (state, created_by) values ('provisional', p_acting_staff)
    returning episode_id into v;
    if p_origin_system is not null and p_origin_ref is not null then
      insert into public.episode_source (episode_id, system, source_ref, role, linked_by)
      values (v, p_origin_system, p_origin_ref, 'origin', p_acting_staff);
    end if;
    if p_began_on is not null then
      insert into public.episode_fact (episode_id, fact_type, basis, on_date, evidence, evidence_ref, asserted_by, acting_seat)
      values (v, 'began', 'documented', p_began_on, 'inquiry received', p_origin_system || ':' || p_origin_ref,
              p_acting_staff, p_acting_seat);
    end if;
  exception
    when unique_violation then
      perform public.journey_audit('open_provisional', p_workflow, p_acting_staff, p_acting_seat, null, null,
                                   'conflict', coalesce(p_origin_system || ':' || p_origin_ref, ''));
      return jsonb_build_object('outcome','conflict','detail','origin already belongs to an episode');
    when check_violation then
      return jsonb_build_object('outcome','invalid','detail', sqlerrm);
  end;
  perform public.journey_audit('open_provisional', p_workflow, p_acting_staff, p_acting_seat, v, null,
                               'opened', coalesce(p_origin_system || ':' || p_origin_ref, ''));
  return jsonb_build_object('outcome','opened','episode_id', v);
end $$;

-- 7.2 bind a person to a provisional episode; the episode_id never changes
create function public.episode_resolve(
  p_episode_id uuid, p_person_id uuid,
  p_prior_history text default null, p_prior_evidence text default null,
  p_workflow text default 'unspecified', p_acting_staff text default 'unspecified',
  p_acting_seat text default 'client_intake'
) returns jsonb
language plpgsql security invoker as $$
declare v_ep public.journey_episode%rowtype; v_active uuid; v_conf uuid; v_r record; v_needs_prior boolean;
begin
  if not public.journey_seat_ok(p_acting_seat) then return jsonb_build_object('outcome','invalid_seat'); end if;
  if not exists (select 1 from public.person_identity where id = p_person_id) then
    return jsonb_build_object('outcome','invalid_person');
  end if;
  perform public.journey_lock_person(p_person_id);
  select * into v_ep from public.journey_episode where episode_id = p_episode_id for update;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if v_ep.person_id is not null then
    if v_ep.person_id = p_person_id then
      return jsonb_build_object('outcome','already_resolved','episode_id', p_episode_id);
    end if;
    perform public.journey_audit('resolve', p_workflow, p_acting_staff, p_acting_seat, p_episode_id, p_person_id,
                                 'conflict', 'already bound to a different person');
    return jsonb_build_object('outcome','conflict','detail','already bound to a different person');
  end if;
  if v_ep.state <> 'provisional' then
    return jsonb_build_object('outcome','invalid_state','state', v_ep.state);
  end if;

  select episode_id into v_active from public.journey_episode
   where person_id = p_person_id and public.journey_state_is_active(state) limit 1;
  if v_active is not null then
    update public.journey_episode set needs_review = true where episode_id = p_episode_id;
    perform public.journey_open_review('resolve_conflict', 'client_intake', p_person_id, p_episode_id,
            jsonb_build_object('active_episode_id', v_active), p_acting_staff);
    perform public.journey_audit('resolve', p_workflow, p_acting_staff, p_acting_seat, p_episode_id, p_person_id,
                                 'conflict', 'person already has active episode ' || v_active);
    return jsonb_build_object('outcome','conflict','active_episode_id', v_active);
  end if;

  v_needs_prior := not exists (select 1 from public.episode_range where person_id = p_person_id and counted)
               and not exists (select 1 from public.episode_fact_current
                                where episode_id = p_episode_id and fact_type = 'prior_history');
  if v_needs_prior and (p_prior_history is null or p_prior_evidence is null) then
    return jsonb_build_object('outcome','prior_history_required');
  end if;

  select * into v_r from public.episode_range where episode_id = p_episode_id;
  v_conf := public.journey_overlap(p_person_id, v_r.began_lo, v_r.began_hi, 'infinity', 'infinity',
                                   p_episode_id);
  if v_conf is not null then
    perform public.journey_open_review('overlap', 'owner_decision', p_person_id, p_episode_id,
            jsonb_build_object('overlaps_episode_id', v_conf), p_acting_staff);
    perform public.journey_audit('resolve', p_workflow, p_acting_staff, p_acting_seat, p_episode_id, p_person_id,
                                 'conflict_overlap', 'overlaps ' || v_conf);
    return jsonb_build_object('outcome','conflict_overlap','overlaps_episode_id', v_conf);
  end if;

  update public.journey_episode
     set person_id = p_person_id, state = 'open', resolved_at = now()
   where episode_id = p_episode_id;
  if v_needs_prior then
    insert into public.episode_fact (episode_id, fact_type, prior_history_status, evidence, asserted_by, acting_seat)
    values (p_episode_id, 'prior_history', p_prior_history, p_prior_evidence, p_acting_staff, p_acting_seat);
  end if;
  perform public.journey_audit('resolve', p_workflow, p_acting_staff, p_acting_seat, p_episode_id, p_person_id,
                               'resolved', null);
  return jsonb_build_object('outcome','resolved','episode_id', p_episode_id);
end $$;

-- 7.3 a known person's lifecycle: baseline (already in care), new lifecycle, or return
create function public.episode_open_for_person(
  p_person_id uuid,
  p_state text,
  p_began_basis text, p_began_evidence text,
  p_began_on date default null, p_began_not_before date default null, p_began_not_after date default null,
  p_prior_history text default null, p_prior_evidence text default null,
  p_evidence_ref text default null,
  p_workflow text default 'unspecified', p_acting_staff text default 'unspecified',
  p_acting_seat text default 'client_intake'
) returns jsonb
language plpgsql security invoker as $$
declare v uuid; v_active uuid; v_conf uuid; v_has_counted boolean;
begin
  if not public.journey_seat_ok(p_acting_seat) then return jsonb_build_object('outcome','invalid_seat'); end if;
  if p_state = 'provisional' or not public.journey_state_is_active(p_state) then
    return jsonb_build_object('outcome','invalid_state');   -- an operationally active, resolved state
  end if;
  if not exists (select 1 from public.person_identity where id = p_person_id) then
    return jsonb_build_object('outcome','invalid_person');
  end if;
  perform public.journey_lock_person(p_person_id);

  select episode_id into v_active from public.journey_episode
   where person_id = p_person_id and public.journey_state_is_active(state) limit 1;
  if v_active is not null then
    perform public.journey_open_review('open_conflict', 'client_intake', p_person_id, v_active,
            jsonb_build_object('attempted_state', p_state), p_acting_staff);
    perform public.journey_audit('open_for_person', p_workflow, p_acting_staff, p_acting_seat, v_active, p_person_id,
                                 'conflict', 'person already has an active episode');
    return jsonb_build_object('outcome','conflict','active_episode_id', v_active);
  end if;

  -- every earlier counted lifecycle must have a documented or observed end
  if exists (select 1 from public.episode_range
              where person_id = p_person_id and counted
                and (ended_basis is null or ended_basis not in ('documented','observed_window'))) then
    perform public.journey_open_review('boundary', 'owner_decision', p_person_id, null,
            jsonb_build_object('reason','an earlier lifecycle has no documented end'), p_acting_staff);
    perform public.journey_audit('open_for_person', p_workflow, p_acting_staff, p_acting_seat, null, p_person_id,
                                 'boundary_unresolved', null);
    return jsonb_build_object('outcome','boundary_unresolved');
  end if;

  select exists (select 1 from public.episode_range where person_id = p_person_id and counted) into v_has_counted;
  if not v_has_counted and (p_prior_history is null or p_prior_evidence is null) then
    return jsonb_build_object('outcome','prior_history_required');
  end if;

  v_conf := public.journey_overlap(p_person_id,
              public.journey_bound_lo(p_began_basis, p_began_on, p_began_not_before, p_began_not_after),
              public.journey_bound_hi(p_began_basis, p_began_on, p_began_not_before, p_began_not_after),
              'infinity', 'infinity', null);
  if v_conf is not null then
    perform public.journey_open_review('overlap', 'owner_decision', p_person_id, v_conf,
            jsonb_build_object('reason','new lifecycle would overlap a known one'), p_acting_staff);
    perform public.journey_audit('open_for_person', p_workflow, p_acting_staff, p_acting_seat, v_conf, p_person_id,
                                 'conflict_overlap', null);
    return jsonb_build_object('outcome','conflict_overlap','overlaps_episode_id', v_conf);
  end if;

  begin
    insert into public.journey_episode (person_id, state, created_by, resolved_at, converted_at)
    values (p_person_id, p_state, p_acting_staff, now(), case when p_state = 'converted' then now() end)
    returning episode_id into v;
    insert into public.episode_fact (episode_id, fact_type, basis, on_date, not_before, not_after,
                                     evidence, evidence_ref, asserted_by, acting_seat)
    values (v, 'began', p_began_basis, p_began_on, p_began_not_before, p_began_not_after,
            p_began_evidence, p_evidence_ref, p_acting_staff, p_acting_seat);
    if not v_has_counted then
      insert into public.episode_fact (episode_id, fact_type, prior_history_status, evidence, asserted_by, acting_seat)
      values (v, 'prior_history', p_prior_history, p_prior_evidence, p_acting_staff, p_acting_seat);
    end if;
  exception
    when unique_violation then
      return jsonb_build_object('outcome','conflict','detail','concurrent active episode');
    when check_violation or not_null_violation then
      return jsonb_build_object('outcome','invalid','detail', sqlerrm);
  end;
  perform public.journey_audit('open_for_person', p_workflow, p_acting_staff, p_acting_seat, v, p_person_id,
                               'opened', p_state || ' / began ' || p_began_basis);
  return jsonb_build_object('outcome','opened','episode_id', v);
end $$;

-- 7.4 state changes; a terminal state writes its end fact in the SAME call, then freezes
create function public.episode_set_state(
  p_episode_id uuid, p_state text,
  p_end_basis text default null, p_end_on date default null,
  p_end_not_before date default null, p_end_not_after date default null, p_end_evidence text default null,
  p_workflow text default 'unspecified', p_acting_staff text default 'unspecified',
  p_acting_seat text default 'client_intake'
) returns jsonb
language plpgsql security invoker as $$
declare v_ep public.journey_episode%rowtype; v_r record; v_e_hi date;
begin
  if not public.journey_seat_ok(p_acting_seat) then return jsonb_build_object('outcome','invalid_seat'); end if;
  select * into v_ep from public.journey_episode where episode_id = p_episode_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if v_ep.person_id is not null then perform public.journey_lock_person(v_ep.person_id); end if;
  select * into v_ep from public.journey_episode where episode_id = p_episode_id for update;
  if public.journey_state_is_frozen(v_ep.state) then return jsonb_build_object('outcome','frozen'); end if;
  if p_state = 'voided' then return jsonb_build_object('outcome','use_void'); end if;
  if p_state = 'provisional'
     or not (public.journey_state_is_active(p_state) or public.journey_state_is_terminal(p_state)) then
    return jsonb_build_object('outcome','invalid_state');
  end if;
  if v_ep.person_id is null and p_state not in ('lost','abandoned') then
    return jsonb_build_object('outcome','invalid_state','detail','resolve the person first');
  end if;

  if public.journey_state_is_terminal(p_state) then
    if p_end_basis is null or p_end_basis not in ('documented','observed_window') or p_end_evidence is null then
      return jsonb_build_object('outcome','end_required',
                                'detail','a terminal state needs a documented or observed end with evidence');
    end if;
    select * into v_r from public.episode_range where episode_id = p_episode_id;
    v_e_hi := public.journey_bound_hi(p_end_basis, p_end_on, p_end_not_before, p_end_not_after);
    if v_e_hi < v_r.began_lo then
      return jsonb_build_object('outcome','invalid_end','detail','end is before the lifecycle began');
    end if;
    begin
      insert into public.episode_fact (episode_id, fact_type, basis, on_date, not_before, not_after,
                                       evidence, asserted_by, acting_seat)
      values (p_episode_id, 'ended', p_end_basis, p_end_on, p_end_not_before, p_end_not_after,
              p_end_evidence, p_acting_staff, p_acting_seat);
    exception when check_violation then
      return jsonb_build_object('outcome','invalid','detail', sqlerrm);
    end;
    update public.journey_episode set state = p_state, terminal_at = now() where episode_id = p_episode_id;
  else
    update public.journey_episode
       set state = p_state,
           converted_at = case when p_state = 'converted' then coalesce(converted_at, now()) else converted_at end
     where episode_id = p_episode_id;
  end if;
  perform public.journey_audit('set_state', p_workflow, p_acting_staff, p_acting_seat, p_episode_id, v_ep.person_id,
                               'state_set', p_state);
  return jsonb_build_object('outcome','state_set','state', p_state);
end $$;

-- 7.5 add, correct or retract a lifecycle fact (append-only; corrections supersede)
create function public.episode_record_fact(
  p_episode_id uuid, p_fact_type text, p_evidence text,
  p_basis text default null, p_on_date date default null,
  p_not_before date default null, p_not_after date default null,
  p_other_episode_id uuid default null, p_prior_history text default null,
  p_evidence_ref text default null, p_supersedes_fact_id uuid default null,
  p_workflow text default 'unspecified', p_acting_staff text default 'unspecified',
  p_acting_seat text default 'client_intake'
) returns jsonb
language plpgsql security invoker as $$
declare v_ep public.journey_episode%rowtype; v_target public.episode_fact%rowtype;
        v_r record; v_b_lo date; v_b_hi date; v_e_lo date; v_e_hi date; v_conf uuid; v_new uuid;
        v_frozen boolean; v_material boolean;
begin
  if not public.journey_seat_ok(p_acting_seat) then return jsonb_build_object('outcome','invalid_seat'); end if;
  select * into v_ep from public.journey_episode where episode_id = p_episode_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if v_ep.person_id is not null then perform public.journey_lock_person(v_ep.person_id); end if;
  v_frozen := public.journey_state_is_frozen(v_ep.state)
              or (p_fact_type = 'precedes' and exists (
                    select 1 from public.journey_episode o
                     where o.episode_id = p_other_episode_id and public.journey_state_is_frozen(o.state)));

  if p_supersedes_fact_id is not null then
    select * into v_target from public.episode_fact where fact_id = p_supersedes_fact_id;
    if not found or v_target.episode_id <> p_episode_id then
      return jsonb_build_object('outcome','invalid','detail','the fact to correct is not on this episode');
    end if;
    if not exists (select 1 from public.episode_fact_current where fact_id = p_supersedes_fact_id) then
      return jsonb_build_object('outcome','invalid','detail','that fact is no longer current');
    end if;
  elsif p_fact_type = 'retract' then
    return jsonb_build_object('outcome','invalid','detail','retract needs the fact it retracts');
  elsif p_fact_type in ('began','ended','prior_history')
        and exists (select 1 from public.episode_fact_current
                     where episode_id = p_episode_id and fact_type = p_fact_type) then
    return jsonb_build_object('outcome','use_supersede','detail','a current ' || p_fact_type || ' fact exists');
  end if;

  if p_fact_type = 'ended' and not public.journey_state_is_terminal(v_ep.state) then
    return jsonb_build_object('outcome','use_set_state');
  end if;

  -- Owner / Decision only when the fact would CHANGE accepted frozen history:
  -- a correction or retraction, a begin or end boundary, documented-complete
  -- prior history (changes the derived ordinal), an order not already derived,
  -- or an erroneous marking. Consistent supporting facts are recorded normally.
  v_material := p_fact_type = 'erroneous'
             or (v_frozen and (
                   p_supersedes_fact_id is not null
                or p_fact_type in ('began','ended')
                or (p_fact_type = 'prior_history' and p_prior_history = 'documented_complete')
                or (p_fact_type = 'precedes' and not exists (
                      select 1 from public.episode_order
                       where earlier_episode_id = p_episode_id and later_episode_id = p_other_episode_id))));
  if v_material and p_acting_seat <> 'owner_decision' then
    perform public.journey_open_review('fact_correction', 'owner_decision', v_ep.person_id, p_episode_id,
            jsonb_build_object('fact_type', p_fact_type, 'supersedes', p_supersedes_fact_id,
                               'evidence', p_evidence), p_acting_staff);
    perform public.journey_audit('record_fact', p_workflow, p_acting_staff, p_acting_seat, p_episode_id,
                                 v_ep.person_id, 'review', p_fact_type);
    return jsonb_build_object('outcome','review','seat','owner_decision');
  end if;
  if p_fact_type = 'erroneous' and not v_frozen then
    return jsonb_build_object('outcome','use_void');
  end if;

  if p_fact_type = 'precedes' and exists (
       select 1 from public.episode_order
        where earlier_episode_id = p_other_episode_id and later_episode_id = p_episode_id) then
    perform public.journey_open_review('fact_correction', 'owner_decision', v_ep.person_id, p_episode_id,
            jsonb_build_object('reason','contradicts established order','other', p_other_episode_id), p_acting_staff);
    return jsonb_build_object('outcome','review','seat','owner_decision');
  end if;

  -- a changed begin or end must not make two known lifecycles overlap
  if v_ep.person_id is not null and p_fact_type in ('began','ended') then
    select * into v_r from public.episode_range where episode_id = p_episode_id;
    v_b_lo := v_r.began_lo; v_b_hi := v_r.began_hi; v_e_lo := v_r.ended_lo; v_e_hi := v_r.ended_hi;
    if p_fact_type = 'began' then
      v_b_lo := public.journey_bound_lo(p_basis, p_on_date, p_not_before, p_not_after);
      v_b_hi := public.journey_bound_hi(p_basis, p_on_date, p_not_before, p_not_after);
    else
      v_e_lo := public.journey_bound_lo(p_basis, p_on_date, p_not_before, p_not_after);
      v_e_hi := public.journey_bound_hi(p_basis, p_on_date, p_not_before, p_not_after);
    end if;
    v_conf := public.journey_overlap(v_ep.person_id, v_b_lo, v_b_hi, v_e_lo, v_e_hi, p_episode_id);
    if v_conf is not null then
      perform public.journey_open_review('overlap', 'owner_decision', v_ep.person_id, p_episode_id,
              jsonb_build_object('overlaps_episode_id', v_conf, 'fact_type', p_fact_type), p_acting_staff);
      perform public.journey_audit('record_fact', p_workflow, p_acting_staff, p_acting_seat, p_episode_id,
                                   v_ep.person_id, 'conflict_overlap', p_fact_type);
      return jsonb_build_object('outcome','conflict_overlap','overlaps_episode_id', v_conf);
    end if;
  end if;

  begin
    insert into public.episode_fact (episode_id, fact_type, basis, on_date, not_before, not_after,
                                     other_episode_id, prior_history_status, evidence, evidence_ref,
                                     asserted_by, acting_seat, supersedes_fact_id)
    values (p_episode_id, p_fact_type, p_basis, p_on_date, p_not_before, p_not_after,
            p_other_episode_id, p_prior_history, p_evidence, p_evidence_ref,
            p_acting_staff, p_acting_seat, p_supersedes_fact_id)
    returning fact_id into v_new;
  exception
    when unique_violation then return jsonb_build_object('outcome','conflict','detail','that fact was already corrected');
    when check_violation or not_null_violation or raise_exception then
      return jsonb_build_object('outcome','invalid','detail', sqlerrm);
  end;
  perform public.journey_audit('record_fact', p_workflow, p_acting_staff, p_acting_seat, p_episode_id,
                               v_ep.person_id, 'recorded', p_fact_type);
  return jsonb_build_object('outcome','recorded','fact_id', v_new);
end $$;

-- 7.6 a past lifecycle found later. Only fully dated, non-overlapping evidence,
--     confirmed by Owner / Decision, creates an episode. Everything else -> review.
create function public.episode_record_historical(
  p_person_id uuid, p_evidence text,
  p_began_on date default null, p_ended_on date default null, p_state text default 'ended',
  p_evidence_ref text default null,
  p_workflow text default 'unspecified', p_acting_staff text default 'unspecified',
  p_acting_seat text default 'client_intake'
) returns jsonb
language plpgsql security invoker as $$
declare v uuid; v_conf uuid; v_review uuid;
begin
  if not public.journey_seat_ok(p_acting_seat) then return jsonb_build_object('outcome','invalid_seat'); end if;
  if not exists (select 1 from public.person_identity where id = p_person_id) then
    return jsonb_build_object('outcome','invalid_person');
  end if;
  if p_state not in ('ended','closed') then return jsonb_build_object('outcome','invalid_state'); end if;
  perform public.journey_lock_person(p_person_id);

  if p_acting_seat <> 'owner_decision' or p_began_on is null or p_ended_on is null or p_began_on > p_ended_on then
    v_review := public.journey_open_review('historical_evidence', 'owner_decision', p_person_id, null,
                  jsonb_build_object('began_on', p_began_on, 'ended_on', p_ended_on, 'evidence', p_evidence,
                                     'evidence_ref', p_evidence_ref), p_acting_staff);
    perform public.journey_audit('record_historical', p_workflow, p_acting_staff, p_acting_seat, null, p_person_id,
                                 'review', 'not created: needs confirmed, fully dated evidence');
    return jsonb_build_object('outcome','review','review_id', v_review);
  end if;

  v_conf := public.journey_overlap(p_person_id, p_began_on, p_began_on, p_ended_on, p_ended_on, null);
  if v_conf is not null then
    v_review := public.journey_open_review('overlap', 'owner_decision', p_person_id, v_conf,
                  jsonb_build_object('began_on', p_began_on, 'ended_on', p_ended_on, 'evidence', p_evidence),
                  p_acting_staff);
    perform public.journey_audit('record_historical', p_workflow, p_acting_staff, p_acting_seat, null, p_person_id,
                                 'review', 'may overlap ' || v_conf);
    return jsonb_build_object('outcome','review','review_id', v_review, 'overlaps_episode_id', v_conf);
  end if;

  insert into public.journey_episode (person_id, state, origin_kind, created_by, resolved_at, terminal_at)
  values (p_person_id, p_state, 'historical', p_acting_staff, now(), now())
  returning episode_id into v;
  insert into public.episode_fact (episode_id, fact_type, basis, on_date, evidence, evidence_ref, asserted_by, acting_seat)
  values (v, 'began', 'documented', p_began_on, p_evidence, p_evidence_ref, p_acting_staff, p_acting_seat),
         (v, 'ended', 'documented', p_ended_on, p_evidence, p_evidence_ref, p_acting_staff, p_acting_seat);
  perform public.journey_audit('record_historical', p_workflow, p_acting_staff, p_acting_seat, v, p_person_id,
                               'created', p_began_on || ' to ' || p_ended_on);
  return jsonb_build_object('outcome','created','episode_id', v);
end $$;

-- 7.7 attach episode-level evidence (never a person-level id)
create function public.episode_attach_source(
  p_episode_id uuid, p_system text, p_source_ref text, p_role text default 'evidence',
  p_workflow text default 'unspecified', p_acting_staff text default 'unspecified',
  p_acting_seat text default 'client_intake'
) returns jsonb
language plpgsql security invoker as $$
declare v_ep public.journey_episode%rowtype;
begin
  if not public.journey_seat_ok(p_acting_seat) then return jsonb_build_object('outcome','invalid_seat'); end if;
  select * into v_ep from public.journey_episode where episode_id = p_episode_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if public.journey_state_is_frozen(v_ep.state) then return jsonb_build_object('outcome','frozen'); end if;
  begin
    insert into public.episode_source (episode_id, system, source_ref, role, linked_by)
    values (p_episode_id, p_system, p_source_ref, p_role, p_acting_staff);
  exception
    when unique_violation then
      perform public.journey_audit('attach_source', p_workflow, p_acting_staff, p_acting_seat, p_episode_id,
                                   v_ep.person_id, 'conflict', p_system || ':' || p_source_ref);
      return jsonb_build_object('outcome','conflict','detail','source already belongs to an episode, or a second origin');
    when check_violation then
      perform public.journey_audit('attach_source', p_workflow, p_acting_staff, p_acting_seat, p_episode_id,
                                   v_ep.person_id, 'invalid_source', p_system || ':' || p_source_ref);
      return jsonb_build_object('outcome','invalid_source','detail', sqlerrm);
  end;
  perform public.journey_audit('attach_source', p_workflow, p_acting_staff, p_acting_seat, p_episode_id,
                               v_ep.person_id, 'attached', p_role || ' ' || p_system || ':' || p_source_ref);
  return jsonb_build_object('outcome','attached');
end $$;

-- 7.8 void an episode that should never have existed (not for frozen episodes)
create function public.episode_void(
  p_episode_id uuid, p_reason text, p_corrected_into uuid default null,
  p_workflow text default 'unspecified', p_acting_staff text default 'unspecified',
  p_acting_seat text default 'client_intake'
) returns jsonb
language plpgsql security invoker as $$
declare v_ep public.journey_episode%rowtype;
begin
  if not public.journey_seat_ok(p_acting_seat) then return jsonb_build_object('outcome','invalid_seat'); end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then return jsonb_build_object('outcome','reason_required'); end if;
  select * into v_ep from public.journey_episode where episode_id = p_episode_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if v_ep.person_id is not null then perform public.journey_lock_person(v_ep.person_id); end if;
  select * into v_ep from public.journey_episode where episode_id = p_episode_id for update;
  if public.journey_state_is_frozen(v_ep.state) then
    return jsonb_build_object('outcome','frozen','detail','use an erroneous fact (Owner / Decision) for a frozen episode');
  end if;
  update public.journey_episode
     set state = 'voided', void_reason = p_reason, voided_at = now(), voided_by = p_acting_staff,
         corrected_into_episode_id = p_corrected_into, terminal_at = now()
   where episode_id = p_episode_id;
  perform public.journey_audit('void', p_workflow, p_acting_staff, p_acting_seat, p_episode_id, v_ep.person_id,
                               'voided', p_reason);
  return jsonb_build_object('outcome','voided');
end $$;

-- 7.9 close a review; Owner / Decision reviews need that seat
create function public.episode_review_resolve(
  p_review_id uuid, p_status text, p_resolution text,
  p_acting_staff text default 'unspecified', p_acting_seat text default 'client_intake'
) returns jsonb
language plpgsql security invoker as $$
declare v public.episode_review%rowtype;
begin
  if not public.journey_seat_ok(p_acting_seat) then return jsonb_build_object('outcome','invalid_seat'); end if;
  if p_status not in ('resolved','dismissed') then return jsonb_build_object('outcome','invalid_status'); end if;
  select * into v from public.episode_review where review_id = p_review_id for update;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if v.status <> 'open' then return jsonb_build_object('outcome','already_closed'); end if;
  if v.seat = 'owner_decision' and p_acting_seat <> 'owner_decision' then
    return jsonb_build_object('outcome','seat_required','seat','owner_decision');
  end if;
  update public.episode_review
     set status = p_status, resolution = p_resolution, resolved_by = p_acting_staff, resolved_at = now()
   where review_id = p_review_id;
  perform public.journey_audit('review_resolve', 'review', p_acting_staff, p_acting_seat, v.episode_id, v.person_id,
                               p_status, p_resolution);
  return jsonb_build_object('outcome', p_status);
end $$;

-- ---------------------------------------------------------------------------
-- 8. PRIVILEGES · RLS
--    Supabase grants ALL on new objects to anon/authenticated/service_role by
--    default, so everything is revoked first and granted back precisely.
-- ---------------------------------------------------------------------------
alter table public.journey_episode    enable row level security;
alter table public.episode_fact       enable row level security;
alter table public.episode_source     enable row level security;
alter table public.episode_review     enable row level security;
alter table public.episode_door_audit enable row level security;

revoke all on public.journey_episode, public.episode_fact, public.episode_source,
              public.episode_review, public.episode_door_audit
  from public, anon, authenticated, service_role;
revoke all on public.episode_fact_current, public.episode_range, public.episode_order,
              public.journey_episode_current
  from public, anon, authenticated, service_role;
revoke all on sequence public.episode_door_audit_id_seq from public, anon, authenticated, service_role;

grant select on public.journey_episode, public.episode_fact, public.episode_source, public.episode_review
  to authenticated;                                                  -- browser READS only
grant select on public.episode_fact_current, public.episode_range, public.episode_order,
                public.journey_episode_current to authenticated, service_role;
grant select, insert, update on public.journey_episode to service_role;   -- no delete, no truncate
grant select, insert         on public.episode_fact    to service_role;   -- append-only
grant select, insert         on public.episode_source  to service_role;   -- append-only
grant select, insert, update on public.episode_review  to service_role;
grant select, insert         on public.episode_door_audit to service_role;
grant usage, select on sequence public.episode_door_audit_id_seq to service_role;

create policy journey_episode_read on public.journey_episode for select to authenticated using (true);
create policy episode_fact_read    on public.episode_fact    for select to authenticated using (true);
create policy episode_source_read  on public.episode_source  for select to authenticated using (true);
create policy episode_review_read  on public.episode_review  for select to authenticated using (true);

do $grants$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'episode\_%' escape '\' or p.proname like 'journey\_%' escape '\')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname in ('journey_state_is_active','journey_state_is_terminal','journey_state_is_frozen',
                     'journey_bound_lo','journey_bound_hi','journey_seat_ok') then
      execute format('grant execute on function %s to authenticated, service_role', r.sig);  -- pure, used by views
    elsif r.proname in ('journey_episode_guard','episode_append_only_guard','episode_fact_guard',
                        'episode_review_guard','journey_block_truncate') then
      null;                                                                                  -- triggers only
    else
      execute format('grant execute on function %s to service_role', r.sig);                 -- Doors + internals
    end if;
  end loop;
end $grants$;

-- ---------------------------------------------------------------------------
-- 9. SELF-CHECK · any mismatch raises and rolls back the whole migration
-- ---------------------------------------------------------------------------
do $verify$
declare t text; r record; bad text := ''; n int;
begin
  foreach t in array array['journey_episode','episode_fact','episode_source','episode_review','episode_door_audit'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then bad := bad || ' rls:' || t; end if;
    if has_table_privilege('anon', 'public.' || t, 'select') then bad := bad || ' anon_select:' || t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'insert')
       or has_table_privilege('authenticated', 'public.' || t, 'update')
       or has_table_privilege('authenticated', 'public.' || t, 'delete')
       or has_table_privilege('authenticated', 'public.' || t, 'truncate') then bad := bad || ' auth_write:' || t; end if;
    if has_table_privilege('service_role', 'public.' || t, 'delete')
       or has_table_privilege('service_role', 'public.' || t, 'truncate') then bad := bad || ' svc_delete:' || t; end if;
  end loop;
  foreach t in array array['episode_fact','episode_source','episode_door_audit'] loop
    if has_table_privilege('service_role', 'public.' || t, 'update') then bad := bad || ' svc_update:' || t; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.episode_door_audit', 'select') then bad := bad || ' auth_audit'; end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'journey_episode' and column_name = 'seq') then
    bad := bad || ' seq_present';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'journey_episode_one_active_uq'
                  and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%journey_state_is_active%') then
    bad := bad || ' one_active_index';
  end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('episode_open_provisional','episode_resolve','episode_open_for_person',
         'episode_set_state','episode_record_fact','episode_record_historical','episode_attach_source',
         'episode_void','episode_review_resolve');
  if n <> 9 then bad := bad || ' door_count:' || n; end if;
  for r in select p.oid::regprocedure as sig, p.prosecdef, p.proname
             from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and (p.proname like 'episode\_%' escape '\' or p.proname like 'journey\_%' escape '\') loop
    if r.prosecdef then bad := bad || ' definer:' || r.proname; end if;
    if has_function_privilege('anon', r.sig, 'execute') then bad := bad || ' anon_exec:' || r.proname; end if;
    if r.proname in ('episode_open_provisional','episode_resolve','episode_open_for_person','episode_set_state',
                     'episode_record_fact','episode_record_historical','episode_attach_source','episode_void',
                     'episode_review_resolve') then
      if has_function_privilege('authenticated', r.sig, 'execute') then bad := bad || ' auth_exec:' || r.proname; end if;
      if not has_function_privilege('service_role', r.sig, 'execute') then bad := bad || ' svc_noexec:' || r.proname; end if;
    end if;
  end loop;
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind = 'v'
              and c.relname in ('episode_fact_current','episode_range','episode_order','journey_episode_current') loop
    if not exists (select 1 from pg_class where relname = r.relname and relnamespace = 'public'::regnamespace
                    and 'security_invoker=true' = any(coalesce(reloptions, '{}'))) then
      bad := bad || ' view_not_invoker:' || r.relname;
    end if;
  end loop;
  if coalesce(obj_description('public.journey_episode'::regclass, 'pg_class'), '') not like 'journey_foundation v2%' then
    bad := bad || ' version_marker';
  end if;
  if bad <> '' then
    raise exception 'journey_foundation_v2 self-check failed:%', bad;
  end if;
end $verify$;

commit;
