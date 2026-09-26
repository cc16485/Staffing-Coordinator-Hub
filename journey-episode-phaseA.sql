-- ============================================================================
-- journey-episode-phaseA.sql
-- Intake-to-Care · Stage 2 · Phase A migration  ·  FROM APPROVED DESIGN v4
-- ----------------------------------------------------------------------------
-- REPLACEMENT for the REJECTED draft `journey-episode.sql`. That draft is kept
-- unchanged for audit; this is a separate, clean file so the two can be compared.
--
-- Creates the episode-identity layer: journey_episode (identity + lifecycle ONLY),
-- episode_source (one-to-many source links), episode_door_audit, the freeze
-- trigger, and the Episode Door functions (security invoker; service_role EXECUTE
-- only). Additive + inert: nothing reads or calls it yet.
--
-- Requires: the standard Supabase roles (anon, authenticated, service_role) and
-- the person_identity table (FK dependency only). Intended to run inside ONE
-- transaction (atomic; proven in the disposable-schema harness).
--
-- NOT payer/authorization/care/schedule/start-date: those are owned elsewhere
-- (Start Contract / auth record / Staffing Need) per the ratified field-ownership
-- map, keyed by episode_id. This layer stores episode IDENTITY and LIFECYCLE only.
-- ============================================================================

-- ── 1. journey_episode : episode identity + lifecycle ONLY ───────────────────
create table if not exists journey_episode (
  episode_id                uuid primary key default gen_random_uuid(),  -- surrogate handle, NOT the identity
  person_id                 uuid references person_identity(id) on delete restrict,  -- NULL while provisional
  seq                       int,                                          -- NULL while provisional
  state                     text not null default 'provisional'
                              check (state in ('provisional','open','converted','established',  -- active
                                               'lost','abandoned','ended','closed',             -- real terminal
                                               'voided')),                                      -- correction
  void_reason               text,
  voided_at                 timestamptz,
  voided_by                 text,
  corrected_into_episode_id uuid references journey_episode(episode_id) on delete restrict,
  needs_review              boolean not null default false,
  source                    text,
  created_by                text,
  opened_at                 timestamptz not null default now(),
  resolved_at               timestamptz,
  converted_at              timestamptz,
  terminal_at               timestamptz,
  updated_at                timestamptz not null default now(),
  -- person and seq are bound together, or not at all (provisional)
  constraint journey_episode_person_seq_together check ((person_id is null) = (seq is null)),
  -- void fields exist only on a voided row
  constraint journey_episode_void_fields check (
    state = 'voided'
    or (void_reason is null and voided_at is null and voided_by is null and corrected_into_episode_id is null)
  )
);

-- seq is unique per person; VOIDED rows keep their seq, so retired numbers stay reserved.
create unique index if not exists journey_episode_person_seq_uq
  on journey_episode (person_id, seq) where person_id is not null;

-- at most ONE ACTIVE episode per person (real-terminal AND voided excluded).
create unique index if not exists journey_episode_one_active_uq
  on journey_episode (person_id)
  where person_id is not null and state in ('provisional','open','converted','established');

-- ── 2. episode_source : one episode, many source records ─────────────────────
create table if not exists episode_source (
  id          uuid primary key default gen_random_uuid(),
  episode_id  uuid not null references journey_episode(episode_id) on delete cascade,
  system      text not null,                 -- 'lead' | 'axiscare' | 'ghl' | …
  source_ref  text not null,                 -- the lead id / AxisCare client id / …
  role        text not null check (role in ('origin','duplicate','additional','converted')),
  linked_at   timestamptz not null default now(),
  linked_by   text
);
-- a given source belongs to exactly one episode
create unique index if not exists episode_source_uq on episode_source (system, source_ref);
-- exactly one origin per episode; it is never replaced
create unique index if not exists episode_source_one_origin_uq on episode_source (episode_id) where role = 'origin';

-- ── 3. LOCK IT DOWN (mirror the identity layer) ──────────────────────────────
alter table journey_episode enable row level security;
alter table episode_source  enable row level security;
revoke all  on public.journey_episode from anon;
revoke all  on public.episode_source  from anon;
grant select on public.journey_episode to authenticated;   -- browser READS only
grant select on public.episode_source  to authenticated;
grant all    on public.journey_episode to service_role;     -- only the Door writes
grant all    on public.episode_source  to service_role;
do $$ begin create policy journey_episode_read on public.journey_episode for select to authenticated using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy episode_source_read  on public.episode_source  for select to authenticated using (true); exception when duplicate_object then null; end $$;

-- ── 4. FREEZE / IMMUTABILITY (historical isolation, structural) ──────────────
-- person_id and seq are write-once; real-terminal AND voided rows are frozen.
create or replace function journey_episode_guard() returns trigger
language plpgsql as $$
declare frozen text[] := array['lost','abandoned','ended','closed','voided'];
begin
  if old.person_id is not null and new.person_id is distinct from old.person_id then
    raise exception 'journey_episode: person_id is immutable once set (%)', old.episode_id;
  end if;
  if old.seq is not null and new.seq is distinct from old.seq then
    raise exception 'journey_episode: seq is immutable once set (%)', old.episode_id;
  end if;
  if old.state = any(frozen) and new is distinct from old then
    raise exception 'journey_episode: episode % is % and frozen', old.episode_id, old.state;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists journey_episode_guard_t on journey_episode;
create trigger journey_episode_guard_t before update on journey_episode
  for each row execute function journey_episode_guard();

-- ── 5. APPEND-ONLY DOOR AUDIT (mirror identity_door_audit) ───────────────────
create table if not exists episode_door_audit (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  op           text not null check (op in ('open_provisional','resolve','attach_source','set_state','void')),
  workflow     text not null default 'unspecified',
  acting_staff text not null default 'unspecified',
  episode_id   uuid,
  person_id    uuid,
  outcome      text not null,
  detail       text
);
alter table episode_door_audit enable row level security;
revoke all on episode_door_audit from public, anon, authenticated;
revoke update, delete, truncate on episode_door_audit from service_role;
revoke references, trigger on episode_door_audit from service_role;
grant insert, select on episode_door_audit to service_role;
grant usage on sequence episode_door_audit_id_seq to service_role;

-- ── 6. THE EPISODE DOOR (security invoker; service_role EXECUTE only) ─────────
-- 6a. Open a provisional episode at inquiry, with its origin source.
create or replace function episode_open_provisional(
  p_origin_system text default null,
  p_origin_ref    text default null,
  p_source        text default null,
  p_workflow      text default 'unspecified',
  p_acting_staff  text default 'unspecified'
) returns uuid
language plpgsql security invoker as $$
declare v_id uuid;
begin
  insert into journey_episode (source, created_by, state)
  values (p_source, p_acting_staff, 'provisional')
  returning episode_id into v_id;
  if p_origin_system is not null and p_origin_ref is not null then
    insert into episode_source (episode_id, system, source_ref, role, linked_by)
    values (v_id, p_origin_system, p_origin_ref, 'origin', p_acting_staff);
  end if;
  insert into episode_door_audit (op, workflow, acting_staff, episode_id, outcome, detail)
  values ('open_provisional', p_workflow, p_acting_staff, v_id, 'opened',
          coalesce(p_origin_system || ':' || p_origin_ref, ''));
  return v_id;
end $$;

-- 6b. Resolve the person, bind + assign seq ATOMICALLY and SERIALIZED per person.
--     next seq := max(seq)+1 over ALL of the person's episodes, VOIDED INCLUDED,
--     computed WHILE HOLDING the per-person advisory lock inside this transaction.
--     Fails toward SEPARATION: a person's second active episode is a human decision.
create or replace function episode_resolve(
  p_episode_id   uuid,
  p_person_id    uuid,
  p_workflow     text default 'unspecified',
  p_acting_staff text default 'unspecified'
) returns jsonb
language plpgsql security invoker as $$
declare v_ep journey_episode%rowtype; v_seq int; v_active uuid;
begin
  select * into v_ep from journey_episode where episode_id = p_episode_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;

  if v_ep.person_id is not null then
    if v_ep.person_id = p_person_id then
      return jsonb_build_object('outcome','already_resolved','seq',v_ep.seq);
    end if;
    insert into episode_door_audit(op,workflow,acting_staff,episode_id,person_id,outcome,detail)
    values('resolve',p_workflow,p_acting_staff,p_episode_id,p_person_id,'conflict','already bound to a different person');
    return jsonb_build_object('outcome','conflict','detail','already bound to a different person');
  end if;

  if not exists (select 1 from person_identity where id = p_person_id) then
    return jsonb_build_object('outcome','invalid_person');
  end if;

  -- serialize per person for the remainder of this transaction
  perform pg_advisory_xact_lock(hashtext('journey_episode'), hashtext(p_person_id::text));

  select episode_id into v_active from journey_episode
    where person_id = p_person_id and state in ('provisional','open','converted','established')
    limit 1;
  if v_active is not null then
    update journey_episode set needs_review = true where episode_id = p_episode_id;
    insert into episode_door_audit(op,workflow,acting_staff,episode_id,person_id,outcome,detail)
    values('resolve',p_workflow,p_acting_staff,p_episode_id,p_person_id,'conflict','person already has an active episode '||v_active);
    return jsonb_build_object('outcome','conflict','active_episode_id',v_active);
  end if;

  -- HIGH-WATER MARK across ALL of the person's episodes, voided included
  select coalesce(max(seq),0)+1 into v_seq from journey_episode where person_id = p_person_id;
  update journey_episode
     set person_id = p_person_id, seq = v_seq, resolved_at = now(),
         state = case when state = 'provisional' then 'open' else state end
   where episode_id = p_episode_id;

  insert into episode_door_audit(op,workflow,acting_staff,episode_id,person_id,outcome,detail)
  values('resolve',p_workflow,p_acting_staff,p_episode_id,p_person_id,'resolved','seq '||v_seq);
  return jsonb_build_object('outcome','resolved','seq',v_seq);
end $$;

-- 6c. Attach a source (duplicate / additional / converted). AxisCare = a
--     'converted' source on an already-resolved person; never a new episode.
create or replace function episode_attach_source(
  p_episode_id   uuid,
  p_system       text,
  p_source_ref   text,
  p_role         text default 'additional',
  p_workflow     text default 'unspecified',
  p_acting_staff text default 'unspecified'
) returns jsonb
language plpgsql security invoker as $$
declare v_ep journey_episode%rowtype; frozen text[] := array['lost','abandoned','ended','closed','voided'];
begin
  select * into v_ep from journey_episode where episode_id = p_episode_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if v_ep.state = any(frozen) then return jsonb_build_object('outcome','frozen'); end if;
  if p_role not in ('origin','duplicate','additional','converted') then
    return jsonb_build_object('outcome','invalid_role'); end if;
  if p_role = 'converted' and v_ep.person_id is null then
    return jsonb_build_object('outcome','needs_resolution','detail','resolve the person before attaching AxisCare');
  end if;
  begin
    insert into episode_source (episode_id, system, source_ref, role, linked_by)
    values (p_episode_id, p_system, p_source_ref, p_role, p_acting_staff);
  exception when unique_violation then
    insert into episode_door_audit(op,workflow,acting_staff,episode_id,person_id,outcome,detail)
    values('attach_source',p_workflow,p_acting_staff,p_episode_id,v_ep.person_id,'conflict',
           p_system||':'||p_source_ref||' already attached, or a second origin');
    return jsonb_build_object('outcome','conflict','detail','source already belongs to an episode, or a second origin');
  end;
  if p_role = 'converted' and v_ep.state in ('provisional','open') then
    update journey_episode set state = 'converted', converted_at = coalesce(converted_at, now())
     where episode_id = p_episode_id;
  end if;
  insert into episode_door_audit(op,workflow,acting_staff,episode_id,person_id,outcome,detail)
  values('attach_source',p_workflow,p_acting_staff,p_episode_id,v_ep.person_id,'attached',p_role||' '||p_system||':'||p_source_ref);
  return jsonb_build_object('outcome','attached','role',p_role);
end $$;

-- 6d. Lifecycle transition (not void). Refused on a frozen episode.
create or replace function episode_set_state(
  p_episode_id uuid, p_state text,
  p_workflow   text default 'unspecified', p_acting_staff text default 'unspecified'
) returns jsonb
language plpgsql security invoker as $$
declare v_ep journey_episode%rowtype;
        realterm text[] := array['lost','abandoned','ended','closed'];
        frozen   text[] := array['lost','abandoned','ended','closed','voided'];
begin
  select * into v_ep from journey_episode where episode_id = p_episode_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if p_state = 'voided' then return jsonb_build_object('outcome','use_void','detail','use episode_void()'); end if;
  if p_state not in ('provisional','open','converted','established','lost','abandoned','ended','closed') then
    return jsonb_build_object('outcome','invalid_state'); end if;
  if v_ep.state = any(frozen) then return jsonb_build_object('outcome','frozen'); end if;
  update journey_episode
     set state = p_state,
         terminal_at = case when p_state = any(realterm) then now() else terminal_at end
   where episode_id = p_episode_id;
  insert into episode_door_audit(op,workflow,acting_staff,episode_id,person_id,outcome,detail)
  values('set_state',p_workflow,p_acting_staff,p_episode_id,v_ep.person_id,'state_set',p_state);
  return jsonb_build_object('outcome','state_set','state',p_state);
end $$;

-- 6e. Void (correction). Allowed once from an ACTIVE state; a real terminal is
--     never voided. seq is left in place (retired), never reused.
create or replace function episode_void(
  p_episode_id     uuid,
  p_reason         text,
  p_corrected_into uuid default null,
  p_workflow       text default 'unspecified',
  p_acting_staff   text default 'unspecified'
) returns jsonb
language plpgsql security invoker as $$
declare v_ep journey_episode%rowtype; frozen text[] := array['lost','abandoned','ended','closed','voided'];
begin
  select * into v_ep from journey_episode where episode_id = p_episode_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if v_ep.state = any(frozen) then
    return jsonb_build_object('outcome','frozen','detail','a real terminal or already-voided episode cannot be voided');
  end if;
  update journey_episode
     set state = 'voided', void_reason = p_reason, voided_at = now(),
         voided_by = p_acting_staff, corrected_into_episode_id = p_corrected_into, terminal_at = now()
   where episode_id = p_episode_id;
  insert into episode_door_audit(op,workflow,acting_staff,episode_id,person_id,outcome,detail)
  values('void',p_workflow,p_acting_staff,p_episode_id,v_ep.person_id,'voided',p_reason);
  return jsonb_build_object('outcome','voided');
end $$;

-- ── 7. THE DOOR IS SERVICE-ROLE ONLY (mirror identity-door) ──────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'episode_open_provisional(text,text,text,text,text)',
    'episode_resolve(uuid,uuid,text,text)',
    'episode_attach_source(uuid,text,text,text,text,text)',
    'episode_set_state(uuid,text,text,text)',
    'episode_void(uuid,text,uuid,text,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
