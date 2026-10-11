-- =============================================================================
-- 582 · PHASE 1 SLICE 3 · WHO MAY DO WHAT (the authority table behind the door)
-- =============================================================================
-- Approved 2026-10-11 (Phase 1 design section 16, decisions 1-4).
--   action_registry       every action behind the door (seeded from _shared/registry.js; a test proves they match)
--   action_authority      one row per action and kind of caller: person (with the office roles allowed), job, or
--                         employee (later, by employee id), and a level:
--                           person:          never | allowed
--                           job / employee:  never | read | recommend | approve | autonomous
--                         The door (contract.ts) reads it on every call. No row = refused.
--   action_authority_log  every change: before and after, who, when, why. Append-only.
--   authority_set(...)    THE ONLY WAY to change a row: an owner (desk_is_owner), signed in. It writes the log row
--                         and one event row ('authority_changed'). Owners Hub shows the table read-only for now
--                         (decision 1); nothing calls this yet except an owner by hand.
-- Guards: the three tables refuse every insert, update and delete (the server key included) unless it comes through
-- authority_set or this installer; truncate is refused always. Office roles may read; nobody else.
-- Seed (decision: nobody gains or loses anything): the four actions, person = the three office roles as today,
-- job = never, employee = never.
-- Sends nothing. Changes no existing table. Safe to run again. One transaction.
-- Rollback: action_authority_582_rollback.sql (drops the three tables and the function; the record keeps its rows).
-- =============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public.desk_is_owner()') is null then raise exception '582 refused: desk_is_owner() is missing (My Desk 463). Nothing was changed.'; end if;
  if to_regprocedure('public.hub_office_ok()') is null then raise exception '582 refused: hub_office_ok() is missing (Slice 1, 578). Nothing was changed.'; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'op_events_request_started_uq') then
    raise exception '582 refused: the once-only lock on op_events is missing (Slice 1, 578). Nothing was changed.';
  end if;
end $pre$;

create table if not exists public.action_registry (
  action      text primary key check (action ~ '^[a-z_]+\.[a-z_]+$'),
  contract    text not null,
  label       text not null,
  area        text not null default '',
  audience    text not null default 'none' check (audience in ('none', 'staff', 'caregiver', 'applicant', 'family')),
  mutating    boolean not null,
  registered_at timestamptz not null default now()
);
create table if not exists public.action_authority (
  action      text not null references public.action_registry(action),
  actor_kind  text not null check (actor_kind in ('person', 'job', 'employee')),
  actor_id    text not null default '',          -- '' = every caller of that kind; later an employee id or a job name
  level       text not null,
  roles       text[] not null default '{}',      -- person rows: the office roles allowed
  note        text not null default '',
  set_by      text not null,
  set_at      timestamptz not null default now(),
  primary key (action, actor_kind, actor_id),
  constraint action_authority_level_chk check (
    (actor_kind = 'person' and level in ('never', 'allowed'))
    or (actor_kind in ('job', 'employee') and level in ('never', 'read', 'recommend', 'approve', 'autonomous'))),
  constraint action_authority_roles_chk check (actor_kind = 'person' or roles = '{}'),
  constraint action_authority_allowed_roles_chk check (level <> 'allowed' or cardinality(roles) > 0)
);
create table if not exists public.action_authority_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  action      text not null,
  actor_kind  text not null,
  actor_id    text not null default '',
  old_level   text,
  old_roles   text[],
  new_level   text not null,
  new_roles   text[] not null default '{}',
  note        text not null default '',
  set_by      text not null
);
create index if not exists action_authority_log_action_ix on public.action_authority_log (action, at desc);

-- ── guards: changes only through authority_set or this installer ─────────────────────────────────────────────────────
create or replace function public.action_authority_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'TRUNCATE' then raise exception '% cannot be truncated (582)', tg_table_name using errcode = 'P0001'; end if;
  if tg_table_name = 'action_authority_log' and tg_op <> 'INSERT' then
    raise exception 'action_authority_log is append-only: % is not allowed (582)', tg_op using errcode = 'P0001';
  end if;
  if coalesce(current_setting('cc.authority_door', true), '') <> '582' then
    raise exception '% can only be changed by an owner through authority_set (582)', tg_table_name using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists action_registry_guard on public.action_registry;
create trigger action_registry_guard before insert or update or delete on public.action_registry for each row execute function public.action_authority_guard();
drop trigger if exists action_registry_guard_t on public.action_registry;
create trigger action_registry_guard_t before truncate on public.action_registry for each statement execute function public.action_authority_guard();
drop trigger if exists action_authority_guard on public.action_authority;
create trigger action_authority_guard before insert or update or delete on public.action_authority for each row execute function public.action_authority_guard();
drop trigger if exists action_authority_guard_t on public.action_authority;
create trigger action_authority_guard_t before truncate on public.action_authority for each statement execute function public.action_authority_guard();
drop trigger if exists action_authority_log_guard on public.action_authority_log;
create trigger action_authority_log_guard before insert or update or delete on public.action_authority_log for each row execute function public.action_authority_guard();
drop trigger if exists action_authority_log_guard_t on public.action_authority_log;
create trigger action_authority_log_guard_t before truncate on public.action_authority_log for each statement execute function public.action_authority_guard();

-- ── the one way to change a row ──────────────────────────────────────────────────────────────────────────────────────
create or replace function public.authority_set(p_action text, p_actor_kind text, p_actor_id text, p_level text, p_roles text[], p_note text)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_email text; v_name text; v_old record; v_roles text[] := coalesce(p_roles, '{}');
begin
  if auth.uid() is null then return jsonb_build_object('outcome', 'refused', 'reason', 'sign in first'); end if;
  if not public.desk_is_owner() then return jsonb_build_object('outcome', 'refused', 'reason', 'owners only'); end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then return jsonb_build_object('outcome', 'refused', 'reason', 'say why (a note is required)'); end if;
  if not exists (select 1 from public.action_registry where action = p_action) then return jsonb_build_object('outcome', 'refused', 'reason', 'that action is not registered'); end if;
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  select coalesce(nullif(p.full_name, ''), split_part(v_email, '@', 1)) into v_name from public.persons p where p.person_id = public.desk_me();
  select level, roles into v_old from public.action_authority where action = p_action and actor_kind = p_actor_kind and actor_id = coalesce(p_actor_id, '');
  perform set_config('cc.authority_door', '582', true);
  begin
    insert into public.action_authority (action, actor_kind, actor_id, level, roles, note, set_by, set_at)
    values (p_action, p_actor_kind, coalesce(p_actor_id, ''), p_level, case when p_actor_kind = 'person' then v_roles else '{}' end, left(p_note, 300), v_email, now())
    on conflict (action, actor_kind, actor_id) do update set level = excluded.level, roles = excluded.roles, note = excluded.note, set_by = excluded.set_by, set_at = excluded.set_at;
    insert into public.action_authority_log (action, actor_kind, actor_id, old_level, old_roles, new_level, new_roles, note, set_by)
    values (p_action, p_actor_kind, coalesce(p_actor_id, ''), v_old.level, v_old.roles, p_level, case when p_actor_kind = 'person' then v_roles else '{}' end, left(p_note, 300), v_email);
  exception when check_violation then
    perform set_config('cc.authority_door', '', true);
    return jsonb_build_object('outcome', 'refused', 'reason', 'that level does not fit that kind of caller');
  end;
  perform set_config('cc.authority_door', '', true);
  insert into public.op_events (actor_email, actor_name, actor_kind, actor_id, via, verb, item_id, area, summary, data, action, outcome)
  values (v_email, coalesce(v_name, split_part(v_email, '@', 1)), 'person', coalesce(public.desk_me()::text, ''), 'admin', 'authority_changed', p_action, 'admin',
          left(coalesce(split_part(v_name, ' ', 1), 'An owner') || ' changed who may ' || (select label from public.action_registry where action = p_action) || ': '
               || p_actor_kind || ' from ' || coalesce(v_old.level, 'no row') || ' to ' || p_level, 400),
          jsonb_build_object('actor_kind', p_actor_kind, 'actor_id', coalesce(p_actor_id, ''), 'old_level', v_old.level, 'new_level', p_level),
          'authority.set', 'done');
  return jsonb_build_object('outcome', 'done', 'old_level', v_old.level, 'new_level', p_level);
end $$;

-- ── who may read; nobody writes directly ─────────────────────────────────────────────────────────────────────────────
alter table public.action_registry enable row level security;
alter table public.action_authority enable row level security;
alter table public.action_authority_log enable row level security;
revoke all on public.action_registry, public.action_authority, public.action_authority_log from public, anon, authenticated, service_role;
revoke all on sequence public.action_authority_log_id_seq from public, anon, authenticated, service_role;
grant select on public.action_registry, public.action_authority, public.action_authority_log to authenticated, service_role;
drop policy if exists action_registry_read on public.action_registry;
create policy action_registry_read on public.action_registry for select to authenticated using (public.hub_office_ok());
drop policy if exists action_authority_read on public.action_authority;
create policy action_authority_read on public.action_authority for select to authenticated using (public.hub_office_ok());
drop policy if exists action_authority_log_read on public.action_authority_log;
create policy action_authority_log_read on public.action_authority_log for select to authenticated using (public.hub_office_ok());
revoke all on function public.authority_set(text, text, text, text, text[], text) from public, anon, service_role;
grant execute on function public.authority_set(text, text, text, text, text[], text) to authenticated;
revoke all on function public.action_authority_guard() from public, anon, authenticated, service_role;

-- ── the seed: nobody gains or loses anything ─────────────────────────────────────────────────────────────────────────
select set_config('cc.authority_door', '582', true);
insert into public.action_registry (action, contract, label, area, audience, mutating) values
  ('client_fact.record',        'client-fact', 'record a fact about a client',        'clients', 'none', true),
  ('client_fact.record_person', 'client-fact', 'record a person on the Journey',      'clients', 'none', true),
  ('client_fact.care_began',    'client-fact', 'check whether care has begun',       'clients', 'none', false),
  ('call_place.place',          'call-place',  'say who an unmatched call was with', 'comms',   'none', true)
on conflict (action) do update set contract = excluded.contract, label = excluded.label, area = excluded.area, audience = excluded.audience, mutating = excluded.mutating;
insert into public.action_authority (action, actor_kind, actor_id, level, roles, note, set_by)
select a.action, k.kind, '', case when k.kind = 'person' then 'allowed' else 'never' end,
       case when k.kind = 'person' then array['owner_admin', 'care_coordinator', 'staffing_coordinator'] else '{}'::text[] end,
       '582 seed: as before Slice 3', '582 installer'
  from public.action_registry a cross join (values ('person'), ('job'), ('employee')) k(kind)
 where a.action in ('client_fact.record', 'client_fact.record_person', 'client_fact.care_began', 'call_place.place')
on conflict (action, actor_kind, actor_id) do nothing;   -- a row an owner already changed is never overwritten by a re-run
insert into public.action_authority_log (action, actor_kind, actor_id, old_level, old_roles, new_level, new_roles, note, set_by)
select x.action, x.actor_kind, x.actor_id, null, null, x.level, x.roles, x.note, x.set_by
  from public.action_authority x
 where x.set_by = '582 installer' and not exists (select 1 from public.action_authority_log l where l.action = x.action and l.actor_kind = x.actor_kind and l.actor_id = x.actor_id);
select set_config('cc.authority_door', '', true);

-- ── self-check ───────────────────────────────────────────────────────────────────────────────────────────────────────
do $v$
begin
  if (select count(*) from public.action_registry) < 4 then raise exception '582 self-check: the registry is not seeded'; end if;
  if (select count(*) from public.action_authority where actor_kind = 'person' and level = 'allowed'
        and action in ('client_fact.record', 'client_fact.record_person', 'client_fact.care_began', 'call_place.place')) <> 4 then
    raise exception '582 self-check: the four person rows are not all allowed';
  end if;
  if exists (select 1 from public.action_authority where actor_kind = 'employee' and level <> 'never' and set_by = '582 installer') then
    raise exception '582 self-check: the seed gave an AI employee authority';
  end if;
  if not (select prosecdef from pg_proc where proname = 'authority_set' and pronamespace = 'public'::regnamespace limit 1) then
    raise exception '582 self-check: authority_set must run as its owner';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public'
              and table_name in ('action_registry', 'action_authority', 'action_authority_log')
              and (grantee in ('anon', 'PUBLIC') or (grantee in ('authenticated', 'service_role') and privilege_type <> 'SELECT'))) then
    raise exception '582 self-check: someone other than authority_set could write the authority tables, or anon could read them';
  end if;
  if (select count(*) from pg_trigger where tgname like 'action_%guard%' and not tgisinternal) <> 6 then
    raise exception '582 self-check: the six guards are not all in place';
  end if;
  raise notice '582 installed: who may do what, owner-controlled, every change logged';
end $v$;

commit;
