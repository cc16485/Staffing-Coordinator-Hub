-- ⛔ REJECTED DRAFT — DO NOT RUN. Superseded by journey-episode-phaseA.sql (approved v4).
-- Kept for audit/comparison ONLY. Differences: this draft wrongly held payer_history +
-- change_payer, a single origin_lead_id, and conflated terminal vs correction states.

-- ============================================================================
-- journey-episode.sql  ·  Intake-to-Care · Stage 2 · PHASE A  (SHADOW / inert)
-- Run once in the Supabase SQL editor of the SHARED hub project.
--
-- Creates the journey_episode table, its constraints, RLS, the freeze/immutability
-- trigger, the append-only Episode-Door audit, and the Episode Door functions.
--
-- ⚠ NOTHING reads or calls this yet. It is ADDITIVE and INERT: no existing table,
--   policy, grant, or row is touched, and no code path reads or writes it. It is
--   safe to re-run (create-if-not-exists / create-or-replace / guarded).
--
-- The Episode Model is LOCKED (Stage 1): an episode is one continuous
-- intake/service lifecycle for one person; logical identity (person_id, seq).
-- This gives it a physical home with the SAME discipline as the identity layer:
-- the browser only reads; only the service-role Door writes. The Door functions
-- are `security invoker` with EXECUTE granted to service_role only — the exact
-- pattern person_resolve_or_create / person_attach_source use (not SECURITY
-- DEFINER; same guarantee, house style).
-- ============================================================================

-- ── 1. THE TABLE ─────────────────────────────────────────────────────────────
create table if not exists journey_episode (
  episode_id          uuid primary key default gen_random_uuid(),  -- physical handle, NOT the identity
  person_id           uuid references person_identity(id) on delete restrict,  -- NULL while provisional
  seq                 int,                                          -- NULL while provisional; per-person 1,2,3…
  state               text not null default 'provisional'
                        check (state in ('provisional','open','converted','established',
                                         'lost','abandoned','ended','closed','superseded')),
  origin_lead_id      text,                 -- the leads[] row that opened it (pre-resolution link)
  axiscare_client_id  text,                 -- source id, attached at conversion; NULL before
  payer_history       jsonb not null default '[]'::jsonb,          -- payer/authorization changes IN the episode
  -- provenance (mirrors the identity layer)
  source              text,
  created_by          text,
  needs_review        boolean not null default false,
  opened_at           timestamptz not null default now(),
  resolved_at         timestamptz,
  converted_at        timestamptz,
  terminal_at         timestamptz,
  updated_at          timestamptz not null default now(),
  -- person and seq are bound together, or not at all (provisional)
  constraint journey_episode_person_seq_together check ((person_id is null) = (seq is null))
);

-- seq is unique per person …
create unique index if not exists journey_episode_person_seq_uq
  on journey_episode (person_id, seq) where person_id is not null;

-- … and AT MOST ONE non-terminal (open) episode per person. This generalises the
-- constraint client_queue already enforces (one open launch per AxisCare client).
create unique index if not exists journey_episode_one_open_uq
  on journey_episode (person_id)
  where person_id is not null
    and state not in ('lost','abandoned','ended','closed','superseded');

-- ── 2. LOCK IT DOWN (mirror the identity layer) ──────────────────────────────
alter table journey_episode enable row level security;
revoke all  on public.journey_episode from anon;
grant select on public.journey_episode to authenticated;   -- browser READS only
grant all   on public.journey_episode to service_role;      -- only the Door (below) writes
do $$ begin
  create policy journey_episode_read on public.journey_episode for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- ── 3. IMMUTABILITY / FREEZE (historical isolation, structural) ──────────────
-- Once bound, person_id and seq never change. Once terminal, the row is frozen.
-- Reopening is only ever a NEW episode. This backstops the Door in the DB itself.
create or replace function journey_episode_guard() returns trigger
language plpgsql as $$
declare terminal text[] := array['lost','abandoned','ended','closed','superseded'];
begin
  if old.person_id is not null and new.person_id is distinct from old.person_id then
    raise exception 'journey_episode: person_id is immutable once set (episode %)', old.episode_id;
  end if;
  if old.seq is not null and new.seq is distinct from old.seq then
    raise exception 'journey_episode: seq is immutable once set (episode %)', old.episode_id;
  end if;
  if old.state = any(terminal) and new is distinct from old then
    raise exception 'journey_episode: episode % is terminal and frozen', old.episode_id;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists journey_episode_guard_t on journey_episode;
create trigger journey_episode_guard_t before update on journey_episode
  for each row execute function journey_episode_guard();

-- ── 4. APPEND-ONLY DOOR AUDIT (mirror identity_door_audit) ───────────────────
create table if not exists episode_door_audit (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  op           text not null check (op in ('open_provisional','resolve','attach_source','set_state','change_payer')),
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

-- ── 5. THE EPISODE DOOR (security invoker; service_role EXECUTE only) ─────────
-- 5a. Open a provisional episode at inquiry (no person yet).
create or replace function episode_open_provisional(
  p_origin_lead_id text default null,
  p_source         text default null,
  p_workflow       text default 'unspecified',
  p_acting_staff   text default 'unspecified'
) returns uuid
language plpgsql security invoker as $$
declare v_id uuid;
begin
  insert into journey_episode (origin_lead_id, source, created_by, state)
  values (p_origin_lead_id, p_source, p_acting_staff, 'provisional')
  returning episode_id into v_id;
  insert into episode_door_audit (op, workflow, acting_staff, episode_id, outcome, detail)
  values ('open_provisional', p_workflow, p_acting_staff, v_id, 'opened', p_origin_lead_id);
  return v_id;
end $$;

-- 5b. Resolve the person (Identity Door's result), bind + assign seq atomically.
--     Fails toward SEPARATION: if the person already has an open episode, this is
--     a continue/new decision for a human — it does NOT silently open a second.
create or replace function episode_resolve(
  p_episode_id   uuid,
  p_person_id    uuid,
  p_workflow     text default 'unspecified',
  p_acting_staff text default 'unspecified'
) returns jsonb
language plpgsql security invoker as $$
declare v_ep journey_episode%rowtype; v_seq int; v_open uuid;
begin
  select * into v_ep from journey_episode where episode_id = p_episode_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;

  if v_ep.person_id is not null then
    if v_ep.person_id = p_person_id then
      return jsonb_build_object('outcome','already_resolved','person_id',p_person_id,'seq',v_ep.seq);
    end if;
    insert into episode_door_audit(op,workflow,acting_staff,episode_id,person_id,outcome,detail)
    values('resolve',p_workflow,p_acting_staff,p_episode_id,p_person_id,'conflict','already bound to a different person');
    return jsonb_build_object('outcome','conflict','detail','already bound to a different person');
  end if;

  if not exists (select 1 from person_identity where id = p_person_id) then
    return jsonb_build_object('outcome','invalid_person');
  end if;

  perform pg_advisory_xact_lock(hashtext('journey_episode'), hashtext(p_person_id::text));

  select episode_id into v_open from journey_episode
    where person_id = p_person_id
      and state not in ('lost','abandoned','ended','closed','superseded')
    limit 1;
  if v_open is not null then
    update journey_episode set needs_review = true where episode_id = p_episode_id;
    insert into episode_door_audit(op,workflow,acting_staff,episode_id,person_id,outcome,detail)
    values('resolve',p_workflow,p_acting_staff,p_episode_id,p_person_id,'conflict','person already has an open episode '||v_open);
    return jsonb_build_object('outcome','conflict','detail','person already has an open episode','open_episode_id',v_open);
  end if;

  select coalesce(max(seq),0)+1 into v_seq from journey_episode where person_id = p_person_id;
  update journey_episode
     set person_id = p_person_id, seq = v_seq, resolved_at = now(),
         state = case when state = 'provisional' then 'open' else state end
   where episode_id = p_episode_id;

  insert into episode_door_audit(op,workflow,acting_staff,episode_id,person_id,outcome,detail)
  values('resolve',p_workflow,p_acting_staff,p_episode_id,p_person_id,'resolved','seq '||v_seq);
  return jsonb_build_object('outcome','resolved','person_id',p_person_id,'seq',v_seq);
end $$;

-- 5c. AxisCare attaches as a SOURCE ID on an already-resolved person. Never an episode.
create or replace function episode_attach_source(
  p_episode_id         uuid,
  p_axiscare_client_id text,
  p_workflow           text default 'unspecified',
  p_acting_staff       text default 'unspecified'
) returns jsonb
language plpgsql security invoker as $$
declare v_ep journey_episode%rowtype;
begin
  select * into v_ep from journey_episode where episode_id = p_episode_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if v_ep.state = any(array['lost','abandoned','ended','closed','superseded']) then
    return jsonb_build_object('outcome','frozen');
  end if;
  if v_ep.person_id is null then
    return jsonb_build_object('outcome','needs_resolution','detail','resolve the person before attaching AxisCare');
  end if;
  update journey_episode
     set axiscare_client_id = p_axiscare_client_id,
         converted_at = coalesce(converted_at, now()),
         state = case when state in ('provisional','open') then 'converted' else state end
   where episode_id = p_episode_id;
  insert into episode_door_audit(op,workflow,acting_staff,episode_id,person_id,outcome,detail)
  values('attach_source',p_workflow,p_acting_staff,p_episode_id,v_ep.person_id,'attached',p_axiscare_client_id);
  return jsonb_build_object('outcome','attached','axiscare_client_id',p_axiscare_client_id);
end $$;

-- 5d. Lifecycle transition. A payer/care/schedule change is NOT here — see 5e.
create or replace function episode_set_state(
  p_episode_id uuid, p_state text,
  p_workflow   text default 'unspecified', p_acting_staff text default 'unspecified'
) returns jsonb
language plpgsql security invoker as $$
declare v_ep journey_episode%rowtype;
        terminal text[] := array['lost','abandoned','ended','closed','superseded'];
begin
  select * into v_ep from journey_episode where episode_id = p_episode_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if p_state not in ('provisional','open','converted','established','lost','abandoned','ended','closed','superseded') then
    return jsonb_build_object('outcome','invalid_state');
  end if;
  if v_ep.state = any(terminal) then
    return jsonb_build_object('outcome','frozen','detail','episode is terminal');
  end if;
  update journey_episode
     set state = p_state,
         terminal_at = case when p_state = any(terminal) then now() else terminal_at end
   where episode_id = p_episode_id;
  insert into episode_door_audit(op,workflow,acting_staff,episode_id,person_id,outcome,detail)
  values('set_state',p_workflow,p_acting_staff,p_episode_id,v_ep.person_id,'state_set',p_state);
  return jsonb_build_object('outcome','state_set','state',p_state);
end $$;

-- 5e. Payer / program change: SAME episode, history appended, seq untouched.
create or replace function episode_change_payer(
  p_episode_id uuid, p_payer text,
  p_workflow   text default 'unspecified', p_acting_staff text default 'unspecified'
) returns jsonb
language plpgsql security invoker as $$
declare v_ep journey_episode%rowtype;
begin
  select * into v_ep from journey_episode where episode_id = p_episode_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if v_ep.state = any(array['lost','abandoned','ended','closed','superseded']) then
    return jsonb_build_object('outcome','frozen');
  end if;
  update journey_episode
     set payer_history = payer_history
        || jsonb_build_object('payer', p_payer, 'at', now(), 'ordinal', jsonb_array_length(payer_history))
   where episode_id = p_episode_id;
  insert into episode_door_audit(op,workflow,acting_staff,episode_id,person_id,outcome,detail)
  values('change_payer',p_workflow,p_acting_staff,p_episode_id,v_ep.person_id,'payer_changed',p_payer);
  return jsonb_build_object('outcome','payer_changed','payer',p_payer);
end $$;

-- ── 6. THE DOOR IS SERVICE-ROLE ONLY (mirror identity-door) ──────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'episode_open_provisional(text,text,text,text)',
    'episode_resolve(uuid,uuid,text,text)',
    'episode_attach_source(uuid,text,text,text)',
    'episode_set_state(uuid,text,text,text)',
    'episode_change_payer(uuid,text,text,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- ── 7. PROOF IT TOOK (read-only) ─────────────────────────────────────────────
select 'journey_episode rows'  as check, count(*)::text as value from journey_episode
union all
select 'rls enabled',
       (select case when relrowsecurity then 'yes' else 'no' end from pg_class where relname = 'journey_episode')
union all
select 'door functions',
       (select count(*)::text from pg_proc where proname like 'episode\_%' escape '\')
union all
select 'open-per-person index',
       (select case when count(*) > 0 then 'yes' else 'no' end from pg_indexes where indexname = 'journey_episode_one_open_uq');
