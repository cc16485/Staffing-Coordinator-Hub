-- =============================================================================
-- 650 · CALL FOLLOW-UP CARDS, PRACTICE (slice A, approved 2026-10-12, decisions 1-4)
-- =============================================================================
-- The AI employee reads every answered call (call-tasks, every 10 minutes, after call-pull) and writes down the
-- follow-up cards it WOULD make. In practice nothing reaches Work's Needs Attention: the readings are shown on a
-- Practice list in Work beside the cards people made for the same person. Cards go live only in slice C, after her
-- authority grant and her switch.
--   call_task_reading   one row per call read (per reader version): who (by the identity layer, never a guess),
--                       the call type, the would-be cards (title, why, area, due), the earlier would-be cards this
--                       call answered, and why there was no card. NO transcript, phone number or email is stored:
--                       the call is pointed at by its GoHighLevel message id and its call record.
--   call_who(phone)     who a phone number belongs to, the same rule as the call record (one person, one lead, or
--                       nobody; two or more is 'several', never a guess), plus the name and what they are to us.
-- Append-only. Office roles read; the server writes; nobody changes or deletes a row. Sends nothing.
-- One transaction. Safe to run again. Rollback: call_tasks_650_rollback.sql.
-- =============================================================================
begin;

do $pre$
begin
  if to_regclass('public.call_pull_seen') is null then raise exception '650 refused: call_pull_seen is missing (372). Nothing was changed.'; end if;
  if to_regclass('public.phone_index') is null or to_regclass('public.person_identity') is null then
    raise exception '650 refused: the identity layer (phone_index, person_identity) is missing. Nothing was changed.'; end if;
  if to_regprocedure('public.hub_office_ok()') is null then raise exception '650 refused: hub_office_ok() is missing (578). Nothing was changed.'; end if;
end $pre$;

create table if not exists public.call_task_reading (
  id             bigserial primary key,
  read_at        timestamptz not null default now(),
  message_id     text not null check (length(message_id) between 4 and 80),
  version        text not null check (length(version) between 1 and 40),     -- the reader's prompt version
  mode           text not null check (mode in ('practice', 'live')),
  call_at        timestamptz,
  direction      text check (direction in ('in', 'out')),
  seconds        int,
  caller         text check (caller is null or length(caller) <= 80),        -- first name + last initial, as call_pull_seen
  match          text not null check (match in ('one', 'several', 'none')),
  person_id      uuid,
  lead_id        text check (lead_id is null or length(lead_id) <= 100),
  who_name       text check (who_name is null or length(who_name) <= 120),
  who_roles      text[] not null default '{}',
  call_type      text not null check (length(call_type) <= 40),
  tasks          jsonb not null default '[]'::jsonb check (jsonb_typeof(tasks) = 'array' and jsonb_array_length(tasks) <= 3),
  resolves       jsonb not null default '[]'::jsonb check (jsonb_typeof(resolves) = 'array'),
  no_task_reason text check (no_task_reason is null or length(no_task_reason) <= 200),
  model          text not null,
  error          text check (error is null or length(error) <= 300),
  unique (message_id, version)
);
comment on table public.call_task_reading is '650 · what the AI employee read in each call and the follow-up cards it would make (practice) or made (live). No transcript, phone or email.';
create index if not exists call_task_reading_call_ix on public.call_task_reading (call_at desc);
create index if not exists call_task_reading_person_ix on public.call_task_reading (person_id, call_at desc) where person_id is not null;

create or replace function public.call_task_reading_keep() returns trigger language plpgsql as $$
begin raise exception 'call_task_reading is append-only: % is not allowed (650)', tg_op using errcode = 'P0001'; end $$;
drop trigger if exists call_task_reading_keep_row on public.call_task_reading;
create trigger call_task_reading_keep_row before update or delete on public.call_task_reading for each row execute function public.call_task_reading_keep();
drop trigger if exists call_task_reading_keep_table on public.call_task_reading;
create trigger call_task_reading_keep_table before truncate on public.call_task_reading for each statement execute function public.call_task_reading_keep();

-- who a phone number belongs to: the call record's rule, read only
create or replace function public.call_who(p_phone text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $f$
declare v_digits text; v_people uuid[]; v_leads text[]; v_person uuid; v_lead text; v_name text; v_roles text[] := '{}';
begin
  v_digits := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  if length(v_digits) <> 10 then return jsonb_build_object('match', 'none'); end if;
  select array_agg(distinct person_id) into v_people from public.phone_index where phone = '+1' || v_digits;
  select array_agg(distinct l->>'id') into v_leads
    from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) l
   where a.key = 'leads' and jsonb_typeof(l) = 'object' and not coalesce((l->>'archived')::boolean, false)
     and (right(regexp_replace(coalesce(l->>'phone', ''), '\D', '', 'g'), 10) = v_digits
          or right(regexp_replace(coalesce(l->>'client_phone', ''), '\D', '', 'g'), 10) = v_digits);
  if coalesce(array_length(v_people, 1), 0) > 1 or coalesce(array_length(v_leads, 1), 0) > 1 then return jsonb_build_object('match', 'several'); end if;
  if coalesce(array_length(v_people, 1), 0) = 0 and coalesce(array_length(v_leads, 1), 0) = 0 then return jsonb_build_object('match', 'none'); end if;
  v_person := v_people[1]; v_lead := v_leads[1];
  if v_person is not null then
    select display_name into v_name from public.person_identity where id = v_person;
    select coalesce(array_agg(distinct entity_type order by entity_type), '{}') into v_roles from public.person_source_id
     where person_id = v_person and not coalesce(needs_review, false);
  end if;
  if v_name is null and v_lead is not null then
    select nullif(btrim(concat_ws(' ', l->>'first_name', l->>'last_name')), '') into v_name
      from public.app_data a, jsonb_array_elements(a.data) l where a.key = 'leads' and l->>'id' = v_lead limit 1;
    v_roles := array_append(v_roles, 'lead');
  end if;
  return jsonb_build_object('match', 'one', 'person_id', v_person, 'lead_id', v_lead, 'name', left(v_name, 120), 'roles', to_jsonb(v_roles));
end $f$;

alter table public.call_task_reading enable row level security;
revoke all on public.call_task_reading from public, anon, authenticated, service_role;
revoke all on sequence public.call_task_reading_id_seq from public, anon, authenticated, service_role;
grant select on public.call_task_reading to authenticated;
grant select, insert on public.call_task_reading to service_role;
grant usage on sequence public.call_task_reading_id_seq to service_role;
drop policy if exists call_task_reading_office on public.call_task_reading;
create policy call_task_reading_office on public.call_task_reading for select to authenticated using (public.hub_office_ok());
revoke all on function public.call_who(text) from public, anon, authenticated;
grant execute on function public.call_who(text) to service_role;
revoke all on function public.call_task_reading_keep() from public, anon, authenticated, service_role;

do $v$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.call_task_reading'::regclass) then raise exception '650 self-check: row security is off'; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'call_task_reading'
              and (grantee in ('anon', 'PUBLIC') or (grantee = 'authenticated' and privilege_type <> 'SELECT')
                   or (grantee = 'service_role' and privilege_type not in ('SELECT', 'INSERT')))) then
    raise exception '650 self-check: someone could change the readings, or anon could read them';
  end if;
  if has_function_privilege('authenticated', 'public.call_who(text)', 'execute') then raise exception '650 self-check: pages could look up phone numbers'; end if;
  raise notice '650 installed: the call follow-up readings (practice)';
end $v$;

commit;
