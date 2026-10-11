-- =============================================================================
-- 578 · PHASE 1, SLICE 1: ONE RECORD. The event table (op_events) becomes the uniform, trustworthy audit record.
-- Samantha approved the Phase 1 design on 2026-10-10 (Cara Phase 1 Design, decisions 1, 4, 5 and the added requirements).
--
-- What this does, and only this (one transaction, safe to run again, existing rows untouched):
--   1. The table's definition finally lives in the repository (it was only in Desktop step 159).
--   2. New columns for the contract standard: actor_kind, actor_id, via, action, request_id, approval, outcome, evidence.
--      Existing rows read as actor_kind 'person' when they carry an email, else 'job' (a backfill, values only).
--   3. Indexes for the questions people ask: by item, by actor, by action, by request id.
--   4. Append-only for everyone: a guard refuses UPDATE, DELETE and TRUNCATE, the server role included.
--   5. A door for pages: public.record_event(...) stamps the actor from the signed-in session and ignores anything the
--      page says about who it is. Pages lose the right to insert directly.
--   6. Who may read: office members of Caring Companions only (the same helpers My Desk uses), not every sign-in on
--      the shared project. The server role keeps insert and select.
-- NOT here: no retention or deletion (her decision 5: a documented policy first). Undo: op_events_harden_578_rollback.sql.
-- =============================================================================
do $pre$ begin
  if not exists (select 1 from pg_class where oid = 'public.op_events'::regclass) then
    raise exception '578: public.op_events does not exist (Desktop 159 never ran)';
  end if;
  if not exists (select 1 from pg_proc where proname = 'desk_hub_ok' and pronamespace = 'public'::regnamespace) then
    raise exception '578: public.desk_hub_ok() is missing (My Desk 463 was not installed)';
  end if;
end $pre$;

-- 1 + 2 · the shape -----------------------------------------------------------------------------------------------
alter table public.op_events
  add column if not exists actor_kind text not null default 'person',   -- person | employee | job | system
  add column if not exists actor_id   text not null default '',         -- person_id, employee id, or the job's name
  add column if not exists via        text not null default '',         -- hub | phone | link | server | cron | owner_key
  add column if not exists action     text not null default '',         -- contract.action, e.g. coverage.confirm
  add column if not exists request_id text not null default '',         -- once-only key for mutating calls
  add column if not exists approval   jsonb not null default '{}'::jsonb, -- {by_email, by_name, at, seen}
  add column if not exists outcome    text not null default '',         -- started | done | already | refused | off | uncertain | failed | preview
  add column if not exists evidence   jsonb not null default '[]'::jsonb; -- [{kind, id}] pointers, never copies

alter table public.op_events
  drop constraint if exists op_events_actor_kind_chk,
  add constraint op_events_actor_kind_chk check (actor_kind in ('person', 'employee', 'job', 'system')),
  drop constraint if exists op_events_outcome_chk,
  add constraint op_events_outcome_chk check (outcome in ('', 'started', 'done', 'already', 'refused', 'off', 'uncertain', 'failed', 'preview')),
  drop constraint if exists op_events_summary_len_chk,
  add constraint op_events_summary_len_chk check (char_length(summary) <= 400);

-- backfill the kind for rows written before today: a row with an email was a person; 'Cara' or 'system' was a job
update public.op_events set actor_kind = case when actor_email <> '' then 'person' when actor_name in ('system') then 'system' else 'job' end
  where actor_kind = 'person' and actor_email = '';

-- 3 · indexes --------------------------------------------------------------------------------------------------------
create index if not exists op_events_item_idx    on public.op_events (item_id, at desc);
create index if not exists op_events_actor_idx   on public.op_events (actor_email, at desc);
create index if not exists op_events_action_idx  on public.op_events (action, at desc) where action <> '';
create index if not exists op_events_request_idx on public.op_events (request_id) where request_id <> '';
-- Concurrency control (Samantha, 2026-10-10: two simultaneous requests must never execute the same action twice).
-- A contract writes its 'started' row BEFORE any effect. Only one 'started' row may exist per request id, so of two
-- callers racing with the same id, the database lets exactly one through; the other sees a unique-key refusal and
-- answers 'already' without doing anything. The later 'done' / 'refused' / 'uncertain' row carries the same request id.
create unique index if not exists op_events_request_started_uq on public.op_events (request_id) where request_id <> '' and outcome = 'started';

-- 4 · append-only for everyone --------------------------------------------------------------------------------------
create or replace function public.op_events_keep() returns trigger
language plpgsql as $$
begin
  raise exception 'op_events is append-only: % is not allowed (578)', tg_op using errcode = 'P0001';
end $$;
drop trigger if exists op_events_keep_row on public.op_events;
create trigger op_events_keep_row before update or delete on public.op_events for each row execute function public.op_events_keep();
drop trigger if exists op_events_keep_table on public.op_events;
create trigger op_events_keep_table before truncate on public.op_events for each statement execute function public.op_events_keep();

-- 5 · the door for pages --------------------------------------------------------------------------------------------
-- Office member of Caring Companions? Same test as the Phase 0 owner rule, widened to the three office roles.
create or replace function public.hub_office_ok() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select public.desk_hub_ok() and exists (
    select 1 from public.staff_roles r
    where r.person_id = public.desk_me() and r.entity = 'cc_ihs' and r.role in ('owner_admin', 'care_coordinator', 'staffing_coordinator'))
$$;
revoke all on function public.hub_office_ok() from public, anon;
grant execute on function public.hub_office_ok() to authenticated, service_role;

create or replace function public.record_event(
  p_verb text, p_item_id text default '', p_area text default '', p_summary text default '', p_data jsonb default '{}'::jsonb,
  p_via text default 'hub', p_action text default '', p_request_id text default '', p_outcome text default '', p_evidence jsonb default '[]'::jsonb
) returns bigint
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_email text; v_name text; v_pid uuid; v_id bigint;
begin
  -- the actor is the signed-in session, never the caller's words
  if auth.uid() is null then raise exception 'record_event: sign in first' using errcode = '28000'; end if;
  if not public.hub_office_ok() then raise exception 'record_event: office members only' using errcode = '42501'; end if;
  if p_verb is null or btrim(p_verb) = '' then raise exception 'record_event: a verb is required' using errcode = '22023'; end if;
  if p_via not in ('hub', 'phone', 'admin', 'link') then raise exception 'record_event: via must be hub, phone, admin or link' using errcode = '22023'; end if;
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_pid := public.desk_me();
  select coalesce(nullif(p.full_name, ''), split_part(v_email, '@', 1)) into v_name from public.persons p where p.person_id = v_pid;
  if v_name is null then v_name := split_part(v_email, '@', 1); end if;
  insert into public.op_events (actor_email, actor_name, actor_kind, actor_id, via, verb, item_id, area, summary, data, action, request_id, outcome, evidence)
  values (v_email, v_name, 'person', coalesce(v_pid::text, ''), p_via, left(p_verb, 80), left(coalesce(p_item_id, ''), 200), left(coalesce(p_area, ''), 80),
          left(coalesce(p_summary, ''), 400), coalesce(p_data, '{}'::jsonb), left(coalesce(p_action, ''), 120), left(coalesce(p_request_id, ''), 80),
          case when coalesce(p_outcome, '') in ('', 'started', 'done', 'already', 'refused', 'off', 'uncertain', 'failed', 'preview') then coalesce(p_outcome, '') else '' end,
          case when jsonb_typeof(coalesce(p_evidence, '[]'::jsonb)) = 'array' then p_evidence else '[]'::jsonb end)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_event(text, text, text, text, jsonb, text, text, text, text, jsonb) from public, anon;
grant execute on function public.record_event(text, text, text, text, jsonb, text, text, text, text, jsonb) to authenticated, service_role;

-- pages may no longer insert directly; the door does it with the real actor
drop policy if exists op_events_insert_auth on public.op_events;
revoke insert on public.op_events from authenticated;

-- 6 · who may read -----------------------------------------------------------------------------------------------------
drop policy if exists op_events_select_auth on public.op_events;
create policy op_events_select_office on public.op_events for select to authenticated using (public.hub_office_ok());
revoke all on public.op_events from anon, public;
revoke update, delete, truncate on public.op_events from authenticated;
grant select on public.op_events to authenticated;
grant select, insert on public.op_events to service_role;
revoke update, delete, truncate on public.op_events from service_role;

-- self-check ------------------------------------------------------------------------------------------------------------
do $v$ begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'op_events'
      and column_name in ('actor_kind', 'actor_id', 'via', 'action', 'request_id', 'approval', 'outcome', 'evidence')) <> 8 then
    raise exception '578 self-check: the eight new columns are not all there';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.op_events'::regclass and tgname in ('op_events_keep_row', 'op_events_keep_table')) <> 2 then
    raise exception '578 self-check: the append-only guards are not both in place';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'op_events' and policyname = 'op_events_insert_auth') then
    raise exception '578 self-check: pages can still insert directly';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'op_events' and policyname = 'op_events_select_office') then
    raise exception '578 self-check: the office read rule is missing';
  end if;
  if not (select prosecdef from pg_proc where proname = 'record_event' and pronamespace = 'public'::regnamespace limit 1) then
    raise exception '578 self-check: record_event must run as its owner';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.op_events'::regclass) then
    raise exception '578 self-check: row security is off on op_events';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'op_events' and indexname = 'op_events_request_started_uq') then
    raise exception '578 self-check: the one-started-row-per-request rule is missing';
  end if;
end $v$;
