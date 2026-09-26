-- =============================================================================
-- staffing-foundation.sql · Stage 3 · Staffing Need -> Ask -> Reply -> Assignment
--
--   staffing_need       durable identity of one exact requirement, owned by a
--                       Journey episode; capacity = seats; the requirement never
--                       changes (a changed slot is a NEW need that supersedes it)
--   staffing_ask        one outreach attempt; exact text as sent; append-only
--                       except a one-time close. "Asked" is DERIVED from open asks.
--   staffing_reply      what the caregiver actually said; append-only; a
--                       reclassification supersedes. A "yes" never assigns.
--   staffing_assignment the human placement decision, one per seat
--   staffing_assignment_sync  append-only AxisCare write-back results
--   staffing_door_audit append-only
--
-- Additive: new objects only. It references journey_episode and person_identity
-- and changes neither. Matcher results are never stored.
-- GUARD: every staffing table is locked and counted; any row aborts everything.
-- RERUN: reinstalls identically while empty; refuses with any row present.
-- =============================================================================
begin;

do $guard$
declare t text; n bigint;
begin
  foreach t in array array['staffing_need','staffing_ask','staffing_reply','staffing_assignment',
                           'staffing_assignment_sync','staffing_door_audit'] loop
    if to_regclass('public.' || t) is not null then
      execute format('lock table public.%I in access exclusive mode', t);
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        raise exception 'staffing_foundation refused: public.% contains % row(s). Nothing was changed.', t, n;
      end if;
    end if;
  end loop;
end $guard$;

drop view if exists public.staffing_need_status, public.staffing_ask_current;
drop table if exists public.staffing_assignment_sync, public.staffing_assignment, public.staffing_reply,
                     public.staffing_ask, public.staffing_need, public.staffing_door_audit;
do $drop$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'staffing\_%' escape '\'
  loop execute 'drop function ' || r.sig; end loop;
end $drop$;

-- ---------------------------------------------------------------------------
-- single definitions
-- ---------------------------------------------------------------------------
create function public.staffing_seat_ok(p_seat text) returns boolean
language sql immutable parallel safe
as $$ select p_seat in ('client_intake','owner_decision','system','legacy_mirror') $$;

-- deciding seats: an assignment is a human decision (legacy_mirror records one already made)
create function public.staffing_decider_ok(p_seat text) returns boolean
language sql immutable parallel safe
as $$ select p_seat in ('client_intake','owner_decision','legacy_mirror') $$;

create function public.staffing_caregiver_key(p_person uuid, p_axiscare text, p_name text) returns text
language sql immutable parallel safe
as $$ select coalesce('p:' || p_person::text, 'ax:' || nullif(btrim(p_axiscare), ''),
                      'n:' || lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))) $$;

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------
create table public.staffing_need (
  need_id               uuid primary key default gen_random_uuid(),
  episode_id            uuid not null references public.journey_episode(episode_id) on delete restrict,
  kind                  text not null check (kind in ('dated_shift','recurring_slot')),
  shift_date            date,
  weekday               text check (weekday in ('mon','tue','wed','thu','fri','sat','sun')),
  start_time            time not null,
  end_time              time not null,
  capacity              int  not null default 1 check (capacity between 1 and 10),
  min_care_level        smallint check (min_care_level between 1 and 3),
  axiscare_visit_ref    text check (axiscare_visit_ref ~ '^s=[^:]+:d=\d{4}-\d{2}-\d{2}$'),
  axiscare_schedule_ref text,
  note                  text,
  state                 text not null default 'open' check (state in ('open','closed')),
  closed_reason         text check (closed_reason in ('covered','cancelled','superseded','not_needed','shift_passed')),
  closed_at             timestamptz,
  supersedes_need_id    uuid references public.staffing_need(need_id) on delete restrict,
  superseded_by_need_id uuid references public.staffing_need(need_id) on delete restrict deferrable initially deferred,
  origin_system         text not null default 'hub'
                          check (origin_system in ('hub','coverage_case','team_builder','legacy_mirror')),
  origin_ref            text,
  created_by            text not null,
  created_seat          text not null check (public.staffing_seat_ok(created_seat)),
  created_at            timestamptz not null default now(),
  constraint staffing_need_shape check (
       (kind = 'dated_shift'    and shift_date is not null and weekday is null)
    or (kind = 'recurring_slot' and weekday is not null and shift_date is null)),
  constraint staffing_need_closed_fields check (
       (state = 'open' and closed_reason is null and closed_at is null and superseded_by_need_id is null)
    or (state = 'closed' and closed_reason is not null and closed_at is not null
        and ((closed_reason = 'superseded') = (superseded_by_need_id is not null))))
);
comment on table public.staffing_need is
  'staffing_foundation v1 · need_id is the durable identity of one exact requirement; owned by a Journey episode';
create unique index staffing_need_open_visit_uq on public.staffing_need (axiscare_visit_ref)
  where state = 'open' and axiscare_visit_ref is not null;
create unique index staffing_need_origin_uq on public.staffing_need (origin_system, origin_ref) where origin_ref is not null;
create index staffing_need_episode_ix on public.staffing_need (episode_id);

create table public.staffing_ask (
  ask_id              uuid primary key default gen_random_uuid(),
  need_id             uuid not null references public.staffing_need(need_id) on delete restrict,
  caregiver_person_id uuid references public.person_identity(id) on delete restrict,
  caregiver_axiscare_id text,
  caregiver_name      text not null check (length(btrim(caregiver_name)) > 0),
  caregiver_key       text generated always as
                        (public.staffing_caregiver_key(caregiver_person_id, caregiver_axiscare_id, caregiver_name)) stored,
  channel             text not null check (channel in ('sms','call','in_person','axiscare_app','email','other')),
  message_text        text,
  message_status      text not null check (message_status in ('exact','verbal','not_retained_legacy')),
  sent_at             timestamptz not null,
  sender              text not null,
  sent_by             text not null,
  seat                text not null check (public.staffing_seat_ok(seat)),
  ghl_contact_id      text,
  external_ref        text,
  origin_system       text not null default 'hub'
                        check (origin_system in ('hub','coverage_case','team_builder','legacy_mirror')),
  origin_ref          text,
  closed_at           timestamptz,
  closed_reason       text check (closed_reason in ('need_closed','superseded','no_answer_final','withdrawn')),
  recorded_at         timestamptz not null default now(),
  constraint staffing_ask_text check (
       (message_status = 'exact' and message_text is not null and length(btrim(message_text)) > 0)
    or (message_status = 'verbal' and channel in ('call','in_person','other'))
    or (message_status = 'not_retained_legacy' and seat = 'legacy_mirror')),
  constraint staffing_ask_written_needs_text check (
       channel not in ('sms','email') or message_status in ('exact','not_retained_legacy')),
  constraint staffing_ask_closed_fields check ((closed_at is null) = (closed_reason is null))
);
create unique index staffing_ask_one_open_per_caregiver on public.staffing_ask (need_id, caregiver_key) where closed_at is null;
create unique index staffing_ask_origin_uq on public.staffing_ask (origin_system, origin_ref) where origin_ref is not null;
create index staffing_ask_need_ix on public.staffing_ask (need_id);

create table public.staffing_reply (
  reply_id              uuid primary key default gen_random_uuid(),
  ask_id                uuid not null references public.staffing_ask(ask_id) on delete restrict,
  received_at           timestamptz not null,
  channel               text not null check (channel in ('sms','call','in_person','axiscare_app','email','other')),
  raw_text              text not null check (length(btrim(raw_text)) > 0),
  classification        text not null check (classification in ('yes','no','question','unclear','no_answer')),
  classified_by         text not null check (classified_by in ('engine','staff')),
  availability_proposal jsonb,
  recorded_by           text not null,
  seat                  text not null check (public.staffing_seat_ok(seat)),
  supersedes_reply_id   uuid references public.staffing_reply(reply_id) on delete restrict,
  origin_system         text not null default 'hub'
                          check (origin_system in ('hub','coverage_case','team_builder','legacy_mirror')),
  origin_ref            text,
  recorded_at           timestamptz not null default now()
);
create unique index staffing_reply_supersedes_once on public.staffing_reply (supersedes_reply_id) where supersedes_reply_id is not null;
create unique index staffing_reply_origin_uq on public.staffing_reply (origin_system, origin_ref) where origin_ref is not null;
create index staffing_reply_ask_ix on public.staffing_reply (ask_id);

create table public.staffing_assignment (
  assignment_id       uuid primary key default gen_random_uuid(),
  need_id             uuid not null references public.staffing_need(need_id) on delete restrict,
  seat_no             int  not null check (seat_no >= 1),
  caregiver_person_id uuid references public.person_identity(id) on delete restrict,
  caregiver_axiscare_id text,
  caregiver_name      text not null check (length(btrim(caregiver_name)) > 0),
  caregiver_key       text generated always as
                        (public.staffing_caregiver_key(caregiver_person_id, caregiver_axiscare_id, caregiver_name)) stored,
  basis_reply_id      uuid references public.staffing_reply(reply_id) on delete restrict,
  decided_by          text not null,
  decided_seat        text not null check (public.staffing_decider_ok(decided_seat)),
  decided_at          timestamptz not null default now(),
  state               text not null default 'active' check (state in ('active','released')),
  released_at         timestamptz,
  released_by         text,
  release_reason      text,
  origin_system       text not null default 'hub'
                        check (origin_system in ('hub','coverage_case','team_builder','legacy_mirror')),
  origin_ref          text,
  constraint staffing_assignment_release_fields check (
       (state = 'active' and released_at is null and released_by is null and release_reason is null)
    or (state = 'released' and released_at is not null and released_by is not null and release_reason is not null))
);
create unique index staffing_assignment_one_per_seat on public.staffing_assignment (need_id, seat_no) where state = 'active';
create unique index staffing_assignment_caregiver_once on public.staffing_assignment (need_id, caregiver_key) where state = 'active';
create unique index staffing_assignment_origin_uq on public.staffing_assignment (origin_system, origin_ref) where origin_ref is not null;

create table public.staffing_assignment_sync (
  id                    bigserial primary key,
  assignment_id         uuid not null references public.staffing_assignment(assignment_id) on delete restrict,
  at                    timestamptz not null default now(),
  status                text not null check (status in ('assigned','by_hand','failed','verified','unknown')),
  axiscare_visit_ref    text,
  axiscare_caregiver_id text,
  verified              boolean not null default false,
  detail                text,
  recorded_by           text not null
);

create table public.staffing_door_audit (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  op           text not null check (op in ('need_open','need_close','ask_record','ask_close','reply_record',
                                           'assign','release','sync_record')),
  acting_staff text not null,
  acting_seat  text not null,
  need_id      uuid,
  ref_id       uuid,
  outcome      text not null,
  detail       text
);

-- ---------------------------------------------------------------------------
-- guard triggers
-- ---------------------------------------------------------------------------
create function public.staffing_append_only_guard() returns trigger language plpgsql as $$
begin raise exception '%: rows are append-only (% refused)', tg_table_name, tg_op; end $$;

create function public.staffing_block_truncate() returns trigger language plpgsql as $$
begin raise exception '% cannot be truncated', tg_table_name; end $$;

-- need: the requirement is immutable; only open -> closed, once
create function public.staffing_need_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'staffing_need rows are never deleted'; end if;
  if old.state <> 'open' then raise exception 'staffing_need % is closed', old.need_id; end if;
  if (new.need_id, new.episode_id, new.kind, new.shift_date, new.weekday, new.start_time, new.end_time,
      new.capacity, new.min_care_level, new.axiscare_visit_ref, new.axiscare_schedule_ref, new.note,
      new.supersedes_need_id, new.origin_system, new.origin_ref, new.created_by, new.created_seat, new.created_at)
     is distinct from
     (old.need_id, old.episode_id, old.kind, old.shift_date, old.weekday, old.start_time, old.end_time,
      old.capacity, old.min_care_level, old.axiscare_visit_ref, old.axiscare_schedule_ref, old.note,
      old.supersedes_need_id, old.origin_system, old.origin_ref, old.created_by, old.created_seat, old.created_at) then
    raise exception 'staffing_need: the requirement never changes; open a new need that supersedes this one';
  end if;
  return new;
end $$;

-- ask: append-only except one close
create function public.staffing_ask_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'staffing_ask rows are never deleted'; end if;
  if old.closed_at is not null then raise exception 'staffing_ask % is already closed', old.ask_id; end if;
  -- caregiver_key is generated after BEFORE triggers run, so it is compared through its inputs instead
  if (to_jsonb(new) - 'closed_at' - 'closed_reason' - 'caregiver_key')
     is distinct from (to_jsonb(old) - 'closed_at' - 'closed_reason' - 'caregiver_key') then
    raise exception 'staffing_ask: an ask is a record of what was sent; only its close may be added';
  end if;
  return new;
end $$;

-- assignment: only active -> released, once
create function public.staffing_assignment_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'staffing_assignment rows are never deleted'; end if;
  if old.state <> 'active' then raise exception 'staffing_assignment % is already released', old.assignment_id; end if;
  -- caregiver_key is generated after BEFORE triggers run, so it is compared through its inputs instead
  if (to_jsonb(new) - 'state' - 'released_at' - 'released_by' - 'release_reason' - 'caregiver_key')
     is distinct from (to_jsonb(old) - 'state' - 'released_at' - 'released_by' - 'release_reason' - 'caregiver_key') then
    raise exception 'staffing_assignment: a decision is not edited; release it and decide again';
  end if;
  return new;
end $$;

create trigger staffing_need_guard_t before update or delete on public.staffing_need
  for each row execute function public.staffing_need_guard();
create trigger staffing_ask_guard_t before update or delete on public.staffing_ask
  for each row execute function public.staffing_ask_guard();
create trigger staffing_assignment_guard_t before update or delete on public.staffing_assignment
  for each row execute function public.staffing_assignment_guard();
create trigger staffing_reply_append_only_t before update or delete on public.staffing_reply
  for each row execute function public.staffing_append_only_guard();
create trigger staffing_sync_append_only_t before update or delete on public.staffing_assignment_sync
  for each row execute function public.staffing_append_only_guard();
create trigger staffing_audit_append_only_t before update or delete on public.staffing_door_audit
  for each row execute function public.staffing_append_only_guard();
create trigger staffing_need_no_truncate before truncate on public.staffing_need
  for each statement execute function public.staffing_block_truncate();
create trigger staffing_ask_no_truncate before truncate on public.staffing_ask
  for each statement execute function public.staffing_block_truncate();
create trigger staffing_reply_no_truncate before truncate on public.staffing_reply
  for each statement execute function public.staffing_block_truncate();
create trigger staffing_assignment_no_truncate before truncate on public.staffing_assignment
  for each statement execute function public.staffing_block_truncate();
create trigger staffing_sync_no_truncate before truncate on public.staffing_assignment_sync
  for each statement execute function public.staffing_block_truncate();
create trigger staffing_audit_no_truncate before truncate on public.staffing_door_audit
  for each statement execute function public.staffing_block_truncate();

-- ---------------------------------------------------------------------------
-- derived truth
-- ---------------------------------------------------------------------------
create view public.staffing_ask_current with (security_invoker = true) as
select a.*,
       r.reply_id as current_reply_id, r.classification as current_reply, r.raw_text as current_reply_text,
       r.received_at as current_reply_at,
       case when a.closed_at is null and r.reply_id is null then 'open'
            when r.classification = 'yes' then 'replied_yes'
            when r.classification = 'no' then 'replied_no'
            when r.classification = 'no_answer' then 'no_answer'
            when r.classification in ('question','unclear') and a.closed_at is null then 'needs_follow_up'
            else 'closed' end as ask_status
  from public.staffing_ask a
  left join lateral (
    select x.* from public.staffing_reply x
     where x.ask_id = a.ask_id
       and not exists (select 1 from public.staffing_reply s where s.supersedes_reply_id = x.reply_id)
     order by x.received_at desc, x.recorded_at desc limit 1) r on true;

create view public.staffing_need_status with (security_invoker = true) as
select n.need_id, n.episode_id, n.kind, n.shift_date, n.weekday, n.start_time, n.end_time, n.capacity,
       n.state, n.closed_reason, n.axiscare_visit_ref,
       coalesce(asg.filled, 0) as seats_filled,
       coalesce(ak.open_asks, 0) as open_asks,
       coalesce(ak.total_asks, 0) as total_asks,
       coalesce(ak.yes_unassigned, 0) as yes_unassigned,
       coalesce(ak.open_asks, 0) > 0 as asked,
       case when n.state = 'closed' then 'closed'
            when coalesce(asg.filled, 0) >= n.capacity then 'filled'
            when coalesce(ak.yes_unassigned, 0) > 0 then 'yes_pending'
            when coalesce(ak.open_asks, 0) > 0 then 'asked'
            when coalesce(ak.total_asks, 0) > 0 and coalesce(ak.follow_up, 0) = 0 then 'exhausted'
            when coalesce(ak.follow_up, 0) > 0 then 'follow_up'
            else 'needs_ask' end as status
  from public.staffing_need n
  left join (select need_id, count(*) as filled from public.staffing_assignment where state = 'active' group by need_id) asg
         on asg.need_id = n.need_id
  left join (
    select c.need_id,
           count(*) filter (where c.ask_status = 'open') as open_asks,
           count(*) as total_asks,
           count(*) filter (where c.ask_status = 'needs_follow_up') as follow_up,
           count(*) filter (where c.ask_status = 'replied_yes'
                              and not exists (select 1 from public.staffing_assignment s
                                               where s.need_id = c.need_id and s.state = 'active'
                                                 and s.caregiver_key = c.caregiver_key)) as yes_unassigned
      from public.staffing_ask_current c group by c.need_id) ak on ak.need_id = n.need_id;

-- ---------------------------------------------------------------------------
-- internals
-- ---------------------------------------------------------------------------
create function public.staffing_audit(p_op text, p_staff text, p_seat text, p_need uuid, p_ref uuid,
                                      p_outcome text, p_detail text) returns void
language sql security invoker as $$
  insert into public.staffing_door_audit (op, acting_staff, acting_seat, need_id, ref_id, outcome, detail)
  values (p_op, coalesce(p_staff, 'unspecified'), coalesce(p_seat, 'system'), p_need, p_ref, p_outcome, p_detail)
$$;

create function public.staffing_lock_need(p_need uuid) returns void
language sql security invoker as $$ select pg_advisory_xact_lock(hashtext('staffing_need'), hashtext(p_need::text)) $$;

create function public.staffing_lock_episode(p_episode uuid) returns void
language sql security invoker as $$ select pg_advisory_xact_lock(hashtext('staffing_episode'), hashtext(p_episode::text)) $$;

-- ---------------------------------------------------------------------------
-- Doors (security invoker; EXECUTE for service_role only)
-- ---------------------------------------------------------------------------
create function public.staffing_need_open(
  p_episode_id uuid, p_kind text, p_start_time time, p_end_time time,
  p_acting_staff text, p_acting_seat text,
  p_shift_date date default null, p_weekday text default null, p_capacity int default 1,
  p_min_care_level smallint default null, p_axiscare_visit_ref text default null,
  p_axiscare_schedule_ref text default null, p_note text default null,
  p_supersedes_need_id uuid default null,
  p_origin_system text default 'hub', p_origin_ref text default null
) returns jsonb
language plpgsql security invoker as $$
declare v uuid; v_old public.staffing_need%rowtype; v_existing uuid;
begin
  if not public.staffing_seat_ok(p_acting_seat) then return jsonb_build_object('outcome','invalid_seat'); end if;
  perform public.staffing_lock_episode(p_episode_id);
  if not exists (select 1 from public.journey_episode
                  where episode_id = p_episode_id and public.journey_state_is_active(state)) then
    return jsonb_build_object('outcome','episode_not_active');
  end if;
  if p_origin_ref is not null then
    select need_id into v_existing from public.staffing_need where origin_system = p_origin_system and origin_ref = p_origin_ref;
    if v_existing is not null then return jsonb_build_object('outcome','already_recorded','need_id', v_existing); end if;
  end if;
  if p_axiscare_visit_ref is not null then
    select need_id into v_existing from public.staffing_need where axiscare_visit_ref = p_axiscare_visit_ref and state = 'open';
    if v_existing is not null and v_existing is distinct from p_supersedes_need_id then
      perform public.staffing_audit('need_open', p_acting_staff, p_acting_seat, v_existing, null, 'conflict_visit', p_axiscare_visit_ref);
      return jsonb_build_object('outcome','conflict','detail','that AxisCare visit already backs an open need','need_id', v_existing);
    end if;
  end if;
  if p_supersedes_need_id is not null then
    perform public.staffing_lock_need(p_supersedes_need_id);
    select * into v_old from public.staffing_need where need_id = p_supersedes_need_id for update;
    if not found or v_old.episode_id <> p_episode_id then return jsonb_build_object('outcome','invalid_supersede'); end if;
    if v_old.state <> 'open' then return jsonb_build_object('outcome','invalid_supersede','detail','that need is closed'); end if;
  end if;
  v := gen_random_uuid();
  begin   -- one unit: closing the old need and opening the new one succeed or fail together
    if p_supersedes_need_id is not null then
      update public.staffing_need set state = 'closed', closed_reason = 'superseded', closed_at = now(),
                                      superseded_by_need_id = v
       where need_id = p_supersedes_need_id;
      update public.staffing_ask set closed_at = now(), closed_reason = 'superseded'
       where need_id = p_supersedes_need_id and closed_at is null;
    end if;
    insert into public.staffing_need (need_id, episode_id, kind, shift_date, weekday, start_time, end_time, capacity,
                                      min_care_level, axiscare_visit_ref, axiscare_schedule_ref, note, supersedes_need_id,
                                      origin_system, origin_ref, created_by, created_seat)
    values (v, p_episode_id, p_kind, p_shift_date, p_weekday, p_start_time, p_end_time, p_capacity, p_min_care_level,
            p_axiscare_visit_ref, p_axiscare_schedule_ref, p_note, p_supersedes_need_id,
            p_origin_system, p_origin_ref, p_acting_staff, p_acting_seat);
  exception when check_violation or not_null_violation or unique_violation then
    return jsonb_build_object('outcome','invalid','detail', sqlerrm);
  end;
  perform public.staffing_audit('need_open', p_acting_staff, p_acting_seat, v, p_supersedes_need_id, 'opened', p_kind);
  return jsonb_build_object('outcome','opened','need_id', v);
end $$;

create function public.staffing_need_close(
  p_need_id uuid, p_reason text, p_acting_staff text, p_acting_seat text
) returns jsonb
language plpgsql security invoker as $$
declare n public.staffing_need%rowtype;
begin
  if not public.staffing_seat_ok(p_acting_seat) then return jsonb_build_object('outcome','invalid_seat'); end if;
  if p_reason not in ('covered','cancelled','not_needed','shift_passed') then
    return jsonb_build_object('outcome','invalid_reason');
  end if;
  perform public.staffing_lock_need(p_need_id);
  select * into n from public.staffing_need where need_id = p_need_id for update;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if n.state <> 'open' then return jsonb_build_object('outcome','already_closed'); end if;
  update public.staffing_need set state = 'closed', closed_reason = p_reason, closed_at = now() where need_id = p_need_id;
  update public.staffing_ask set closed_at = now(), closed_reason = 'need_closed' where need_id = p_need_id and closed_at is null;
  perform public.staffing_audit('need_close', p_acting_staff, p_acting_seat, p_need_id, null, 'closed', p_reason);
  return jsonb_build_object('outcome','closed');
end $$;

create function public.staffing_ask_record(
  p_need_id uuid, p_caregiver_name text, p_channel text, p_message_status text, p_sent_at timestamptz,
  p_sender text, p_acting_staff text, p_acting_seat text,
  p_message_text text default null, p_caregiver_person_id uuid default null, p_caregiver_axiscare_id text default null,
  p_ghl_contact_id text default null, p_external_ref text default null,
  p_origin_system text default 'hub', p_origin_ref text default null
) returns jsonb
language plpgsql security invoker as $$
declare n public.staffing_need%rowtype; v uuid; v_existing uuid;
begin
  if not public.staffing_seat_ok(p_acting_seat) then return jsonb_build_object('outcome','invalid_seat'); end if;
  perform public.staffing_lock_need(p_need_id);
  select * into n from public.staffing_need where need_id = p_need_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if p_origin_ref is not null then
    select ask_id into v_existing from public.staffing_ask where origin_system = p_origin_system and origin_ref = p_origin_ref;
    if v_existing is not null then return jsonb_build_object('outcome','already_recorded','ask_id', v_existing); end if;
  end if;
  if n.state <> 'open' and p_acting_seat <> 'legacy_mirror' then
    return jsonb_build_object('outcome','need_closed');
  end if;
  begin
    insert into public.staffing_ask (need_id, caregiver_person_id, caregiver_axiscare_id, caregiver_name, channel,
                                     message_text, message_status, sent_at, sender, sent_by, seat, ghl_contact_id,
                                     external_ref, origin_system, origin_ref)
    values (p_need_id, p_caregiver_person_id, p_caregiver_axiscare_id, p_caregiver_name, p_channel,
            p_message_text, p_message_status, p_sent_at, p_sender, p_acting_staff, p_acting_seat, p_ghl_contact_id,
            p_external_ref, p_origin_system, p_origin_ref)
    returning ask_id into v;
  exception
    when unique_violation then
      perform public.staffing_audit('ask_record', p_acting_staff, p_acting_seat, p_need_id, null, 'already_asked', p_caregiver_name);
      return jsonb_build_object('outcome','already_asked','detail','this caregiver already has an open ask for this need');
    when check_violation or not_null_violation then
      return jsonb_build_object('outcome','invalid','detail', sqlerrm);
  end;
  if n.state <> 'open' then   -- legacy history recorded against a closed need arrives closed
    update public.staffing_ask set closed_at = n.closed_at, closed_reason = 'need_closed' where ask_id = v;
  end if;
  perform public.staffing_audit('ask_record', p_acting_staff, p_acting_seat, p_need_id, v, 'recorded', p_channel);
  return jsonb_build_object('outcome','recorded','ask_id', v);
end $$;

create function public.staffing_ask_close(
  p_ask_id uuid, p_reason text, p_acting_staff text, p_acting_seat text
) returns jsonb
language plpgsql security invoker as $$
declare a public.staffing_ask%rowtype;
begin
  if not public.staffing_seat_ok(p_acting_seat) then return jsonb_build_object('outcome','invalid_seat'); end if;
  if p_reason not in ('no_answer_final','withdrawn') then return jsonb_build_object('outcome','invalid_reason'); end if;
  select * into a from public.staffing_ask where ask_id = p_ask_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  perform public.staffing_lock_need(a.need_id);
  select * into a from public.staffing_ask where ask_id = p_ask_id for update;
  if a.closed_at is not null then return jsonb_build_object('outcome','already_closed'); end if;
  update public.staffing_ask set closed_at = now(), closed_reason = p_reason where ask_id = p_ask_id;
  perform public.staffing_audit('ask_close', p_acting_staff, p_acting_seat, a.need_id, p_ask_id, 'closed', p_reason);
  return jsonb_build_object('outcome','closed');
end $$;

create function public.staffing_reply_record(
  p_ask_id uuid, p_raw_text text, p_received_at timestamptz, p_channel text, p_classification text,
  p_classified_by text, p_acting_staff text, p_acting_seat text,
  p_availability_proposal jsonb default null, p_supersedes_reply_id uuid default null,
  p_origin_system text default 'hub', p_origin_ref text default null
) returns jsonb
language plpgsql security invoker as $$
declare a public.staffing_ask%rowtype; v uuid; v_existing uuid;
begin
  if not public.staffing_seat_ok(p_acting_seat) then return jsonb_build_object('outcome','invalid_seat'); end if;
  select * into a from public.staffing_ask where ask_id = p_ask_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  perform public.staffing_lock_need(a.need_id);
  if p_origin_ref is not null then
    select reply_id into v_existing from public.staffing_reply where origin_system = p_origin_system and origin_ref = p_origin_ref;
    if v_existing is not null then return jsonb_build_object('outcome','already_recorded','reply_id', v_existing); end if;
  end if;
  if p_supersedes_reply_id is not null and not exists (
       select 1 from public.staffing_reply r where r.reply_id = p_supersedes_reply_id and r.ask_id = p_ask_id
          and not exists (select 1 from public.staffing_reply s where s.supersedes_reply_id = r.reply_id)) then
    return jsonb_build_object('outcome','invalid_supersede','detail','that reply is not the current reply on this ask');
  end if;
  begin
    insert into public.staffing_reply (ask_id, received_at, channel, raw_text, classification, classified_by,
                                       availability_proposal, recorded_by, seat, supersedes_reply_id, origin_system, origin_ref)
    values (p_ask_id, p_received_at, p_channel, p_raw_text, p_classification, p_classified_by,
            p_availability_proposal, p_acting_staff, p_acting_seat, p_supersedes_reply_id, p_origin_system, p_origin_ref)
    returning reply_id into v;
  exception
    when unique_violation then return jsonb_build_object('outcome','conflict','detail','that reply was already reclassified');
    when check_violation or not_null_violation then return jsonb_build_object('outcome','invalid','detail', sqlerrm);
  end;
  perform public.staffing_audit('reply_record', p_acting_staff, p_acting_seat, a.need_id, v, 'recorded', p_classification);
  return jsonb_build_object('outcome','recorded','reply_id', v);
end $$;

-- the human placement decision. A yes reply is evidence; it never assigns by itself.
create function public.staffing_assign(
  p_need_id uuid, p_caregiver_name text, p_acting_staff text, p_acting_seat text,
  p_seat_no int default null, p_caregiver_person_id uuid default null, p_caregiver_axiscare_id text default null,
  p_basis_reply_id uuid default null, p_origin_system text default 'hub', p_origin_ref text default null
) returns jsonb
language plpgsql security invoker as $$
declare n public.staffing_need%rowtype; v uuid; v_seat int; v_existing uuid; v_basis record;
begin
  if not public.staffing_decider_ok(p_acting_seat) then
    return jsonb_build_object('outcome','invalid_seat','detail','an assignment is a human decision');
  end if;
  if p_acting_staff is null or length(btrim(p_acting_staff)) = 0 then return jsonb_build_object('outcome','staff_required'); end if;
  perform public.staffing_lock_need(p_need_id);
  select * into n from public.staffing_need where need_id = p_need_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if p_origin_ref is not null then
    select assignment_id into v_existing from public.staffing_assignment where origin_system = p_origin_system and origin_ref = p_origin_ref;
    if v_existing is not null then return jsonb_build_object('outcome','already_recorded','assignment_id', v_existing); end if;
  end if;
  if n.state <> 'open' and p_acting_seat <> 'legacy_mirror' then return jsonb_build_object('outcome','need_closed'); end if;
  if p_basis_reply_id is not null then
    select r.classification, a.need_id into v_basis
      from public.staffing_reply r join public.staffing_ask a on a.ask_id = r.ask_id where r.reply_id = p_basis_reply_id;
    if not found or v_basis.need_id <> p_need_id or v_basis.classification <> 'yes' then
      return jsonb_build_object('outcome','invalid_basis','detail','the basis must be a yes reply for this need');
    end if;
  end if;
  if p_seat_no is null then
    select min(s) into v_seat from generate_series(1, n.capacity) s
     where not exists (select 1 from public.staffing_assignment x where x.need_id = p_need_id and x.state = 'active' and x.seat_no = s);
    if v_seat is null then return jsonb_build_object('outcome','capacity_full'); end if;
  else
    if p_seat_no > n.capacity then return jsonb_build_object('outcome','capacity_full'); end if;
    v_seat := p_seat_no;
  end if;
  begin
    insert into public.staffing_assignment (need_id, seat_no, caregiver_person_id, caregiver_axiscare_id, caregiver_name,
                                            basis_reply_id, decided_by, decided_seat, origin_system, origin_ref)
    values (p_need_id, v_seat, p_caregiver_person_id, p_caregiver_axiscare_id, p_caregiver_name,
            p_basis_reply_id, p_acting_staff, p_acting_seat, p_origin_system, p_origin_ref)
    returning assignment_id into v;
  exception
    when unique_violation then
      return jsonb_build_object('outcome','conflict','detail','that seat is taken, or this caregiver is already assigned to this need');
    when check_violation or not_null_violation then return jsonb_build_object('outcome','invalid','detail', sqlerrm);
  end;
  perform public.staffing_audit('assign', p_acting_staff, p_acting_seat, p_need_id, v, 'assigned', 'seat ' || v_seat);
  return jsonb_build_object('outcome','assigned','assignment_id', v, 'seat_no', v_seat);
end $$;

create function public.staffing_assignment_release(
  p_assignment_id uuid, p_reason text, p_acting_staff text, p_acting_seat text
) returns jsonb
language plpgsql security invoker as $$
declare s public.staffing_assignment%rowtype;
begin
  if not public.staffing_decider_ok(p_acting_seat) then return jsonb_build_object('outcome','invalid_seat'); end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then return jsonb_build_object('outcome','reason_required'); end if;
  select * into s from public.staffing_assignment where assignment_id = p_assignment_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  perform public.staffing_lock_need(s.need_id);
  select * into s from public.staffing_assignment where assignment_id = p_assignment_id for update;
  if s.state <> 'active' then return jsonb_build_object('outcome','already_released'); end if;
  update public.staffing_assignment set state = 'released', released_at = now(), released_by = p_acting_staff,
                                        release_reason = p_reason
   where assignment_id = p_assignment_id;
  perform public.staffing_audit('release', p_acting_staff, p_acting_seat, s.need_id, p_assignment_id, 'released', p_reason);
  return jsonb_build_object('outcome','released');
end $$;

create function public.staffing_assignment_sync_record(
  p_assignment_id uuid, p_status text, p_recorded_by text,
  p_axiscare_visit_ref text default null, p_axiscare_caregiver_id text default null,
  p_verified boolean default false, p_detail text default null
) returns jsonb
language plpgsql security invoker as $$
declare s public.staffing_assignment%rowtype; v bigint;
begin
  select * into s from public.staffing_assignment where assignment_id = p_assignment_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  begin
    insert into public.staffing_assignment_sync (assignment_id, status, axiscare_visit_ref, axiscare_caregiver_id,
                                                 verified, detail, recorded_by)
    values (p_assignment_id, p_status, p_axiscare_visit_ref, p_axiscare_caregiver_id, p_verified, p_detail, p_recorded_by)
    returning id into v;
  exception when check_violation then return jsonb_build_object('outcome','invalid','detail', sqlerrm);
  end;
  perform public.staffing_audit('sync_record', p_recorded_by, 'system', s.need_id, p_assignment_id, p_status, p_detail);
  return jsonb_build_object('outcome','recorded');
end $$;

-- ---------------------------------------------------------------------------
-- privileges · RLS (Supabase grants ALL by default: revoke, then grant precisely)
-- ---------------------------------------------------------------------------
alter table public.staffing_need            enable row level security;
alter table public.staffing_ask             enable row level security;
alter table public.staffing_reply           enable row level security;
alter table public.staffing_assignment      enable row level security;
alter table public.staffing_assignment_sync enable row level security;
alter table public.staffing_door_audit      enable row level security;

revoke all on public.staffing_need, public.staffing_ask, public.staffing_reply, public.staffing_assignment,
              public.staffing_assignment_sync, public.staffing_door_audit
  from public, anon, authenticated, service_role;
revoke all on public.staffing_ask_current, public.staffing_need_status from public, anon, authenticated, service_role;
revoke all on sequence public.staffing_assignment_sync_id_seq, public.staffing_door_audit_id_seq
  from public, anon, authenticated, service_role;

grant select on public.staffing_need, public.staffing_ask, public.staffing_reply, public.staffing_assignment,
                public.staffing_assignment_sync to authenticated;
grant select on public.staffing_ask_current, public.staffing_need_status to authenticated, service_role;
grant select, insert, update on public.staffing_need, public.staffing_ask, public.staffing_assignment to service_role;
grant select, insert on public.staffing_reply, public.staffing_assignment_sync, public.staffing_door_audit to service_role;
grant usage, select on sequence public.staffing_assignment_sync_id_seq, public.staffing_door_audit_id_seq to service_role;

create policy staffing_need_read       on public.staffing_need            for select to authenticated using (true);
create policy staffing_ask_read        on public.staffing_ask             for select to authenticated using (true);
create policy staffing_reply_read      on public.staffing_reply           for select to authenticated using (true);
create policy staffing_assignment_read on public.staffing_assignment      for select to authenticated using (true);
create policy staffing_sync_read       on public.staffing_assignment_sync for select to authenticated using (true);

do $grants$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'staffing\_%' escape '\' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname in ('staffing_seat_ok','staffing_decider_ok','staffing_caregiver_key') then
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
    elsif r.proname in ('staffing_append_only_guard','staffing_block_truncate','staffing_need_guard',
                        'staffing_ask_guard','staffing_assignment_guard') then
      null;
    else
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $grants$;

-- ---------------------------------------------------------------------------
-- self-check
-- ---------------------------------------------------------------------------
do $verify$
declare t text; r record; bad text := ''; n int;
begin
  foreach t in array array['staffing_need','staffing_ask','staffing_reply','staffing_assignment',
                           'staffing_assignment_sync','staffing_door_audit'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then bad := bad || ' rls:' || t; end if;
    if has_table_privilege('anon', 'public.' || t, 'select') then bad := bad || ' anon:' || t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'insert') or has_table_privilege('authenticated', 'public.' || t, 'update')
       or has_table_privilege('authenticated', 'public.' || t, 'delete') then bad := bad || ' auth_write:' || t; end if;
    if has_table_privilege('service_role', 'public.' || t, 'delete') or has_table_privilege('service_role', 'public.' || t, 'truncate') then
      bad := bad || ' svc_delete:' || t; end if;
  end loop;
  foreach t in array array['staffing_reply','staffing_assignment_sync','staffing_door_audit'] loop
    if has_table_privilege('service_role', 'public.' || t, 'update') then bad := bad || ' svc_update:' || t; end if;
  end loop;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('staffing_need_open','staffing_need_close','staffing_ask_record',
         'staffing_ask_close','staffing_reply_record','staffing_assign','staffing_assignment_release',
         'staffing_assignment_sync_record');
  if n <> 8 then bad := bad || ' door_count:' || n; end if;
  for r in select p.oid::regprocedure as sig, p.proname, p.prosecdef from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and p.proname like 'staffing\_%' escape '\' loop
    if r.prosecdef then bad := bad || ' definer:' || r.proname; end if;
    if has_function_privilege('anon', r.sig, 'execute') then bad := bad || ' anon_exec:' || r.proname; end if;
    if r.proname not in ('staffing_seat_ok','staffing_decider_ok','staffing_caregiver_key')
       and has_function_privilege('authenticated', r.sig, 'execute') then bad := bad || ' auth_exec:' || r.proname; end if;
  end loop;
  if coalesce(obj_description('public.staffing_need'::regclass, 'pg_class'), '') not like 'staffing_foundation v1%' then
    bad := bad || ' version_marker'; end if;
  if bad <> '' then raise exception 'staffing_foundation self-check failed:%', bad; end if;
end $verify$;

commit;
