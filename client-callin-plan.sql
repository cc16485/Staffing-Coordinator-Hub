-- =============================================================================
-- client-callin-plan.sql · "When a caregiver calls in": each client's call-in plan (2026-09-27)
--
-- Samantha, 2026-09-27: "a notes section ... so we can also go and manually look and see who
-- put in the info and where they got the info on how the client or the clients family would
-- like a call in to be handled." Approved: four coverage choices, an only-ask list, an outside
-- backup, notes; any signed-in staff may add; every entry kept.
--
--   client_callin_entries   APPEND-ONLY. One row per update. The plan fields (coverage need,
--                           only-ask list, backup) are the whole plan as of that entry; the
--                           note is what was said at that time. Who entered it, and who told
--                           us and how, on every row. Tied to the AxisCare client id.
--   client_callin_current   the latest entry per client (the plan in force)
--   client_callin_add(entry, staff email, staff name)   the one door (service_role)
--
-- Nothing reads the note to make a decision. Cara acts only on coverage_need and only_ask.
-- GUARD: refuses if the table already holds entries (a rerun can't disturb real history).
-- =============================================================================
begin;

do $guard$
declare n bigint;
begin
  if to_regclass('public.client_callin_entries') is not null then
    lock table public.client_callin_entries in access exclusive mode;
    select count(*) into n from public.client_callin_entries;
    if n > 0 then raise exception 'client_callin refused: % entr(ies) already recorded. Nothing was changed.', n; end if;
  end if;
end $guard$;

create table if not exists public.client_callin_entries (
  id                  bigserial primary key,
  request_id          uuid not null unique,
  axiscare_client_id  text not null check (axiscare_client_id ~ '^[0-9]+$'),
  client_name         text not null check (length(btrim(client_name)) > 0),
  coverage_need       text check (coverage_need in ('must_cover','if_we_can','family_covers','flexible')),
  only_ask            jsonb not null default '[]'::jsonb check (jsonb_typeof(only_ask) = 'array'),
  backup_name         text,
  backup_phone        text check (backup_phone is null or backup_phone ~ '^[0-9]{10}$'),
  backup_relationship text,
  note                text check (note is null or length(note) <= 2000),
  source_who          text not null check (length(btrim(source_who)) > 0),
  source_how          text check (source_how in ('phone','in_person','assessment','care_plan_review','text','email')),
  entered_by          text not null check (length(btrim(entered_by)) > 0),
  entered_by_name     text,
  entered_at          timestamptz not null default now()
);
create index if not exists client_callin_entries_client on public.client_callin_entries (axiscare_client_id, entered_at desc, id desc);

create or replace function public.client_callin_guard() returns trigger language plpgsql as $$
begin raise exception '% is append-only (% refused)', tg_table_name, tg_op; end $$;
drop trigger if exists client_callin_append_only on public.client_callin_entries;
create trigger client_callin_append_only before update or delete on public.client_callin_entries
  for each row execute function public.client_callin_guard();
drop trigger if exists client_callin_no_truncate on public.client_callin_entries;
create trigger client_callin_no_truncate before truncate on public.client_callin_entries
  for each statement execute function public.client_callin_guard();

create or replace view public.client_callin_current with (security_invoker = true) as
  select distinct on (axiscare_client_id) *
    from public.client_callin_entries
   order by axiscare_client_id, entered_at desc, id desc;

create or replace function public.client_callin_add(p jsonb, p_staff text, p_staff_name text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_ax text := btrim(coalesce(p->>'axiscare_client_id', ''));
  v_name text := btrim(coalesce(p->>'client_name', ''));
  v_need text := nullif(btrim(coalesce(p->>'coverage_need', '')), '');
  v_only jsonb := coalesce(p->'only_ask', '[]'::jsonb);
  v_bname text := nullif(btrim(coalesce(p->>'backup_name', '')), '');
  v_bphone text := nullif(regexp_replace(coalesce(p->>'backup_phone', ''), '[^0-9]', '', 'g'), '');
  v_brel text := nullif(btrim(coalesce(p->>'backup_relationship', '')), '');
  v_note text := nullif(btrim(coalesce(p->>'note', '')), '');
  v_who text := btrim(coalesce(p->>'source_who', ''));
  v_how text := nullif(btrim(coalesce(p->>'source_how', '')), '');
  v_req uuid;
  v_clean jsonb := '[]'::jsonb;
  v_item jsonb;
  v_id bigint;
begin
  if btrim(coalesce(p_staff, '')) = '' then return jsonb_build_object('outcome', 'staff_required'); end if;
  begin v_req := (p->>'request_id')::uuid; exception when others then v_req := null; end;
  if v_req is null then return jsonb_build_object('outcome', 'request_id_required'); end if;
  if v_ax !~ '^[0-9]+$' then return jsonb_build_object('outcome', 'axiscare_id_required'); end if;
  if v_name = '' then return jsonb_build_object('outcome', 'client_name_required'); end if;
  if v_need is not null and v_need not in ('must_cover','if_we_can','family_covers','flexible') then
    return jsonb_build_object('outcome', 'unknown_coverage_need'); end if;
  if jsonb_typeof(v_only) <> 'array' or jsonb_array_length(v_only) > 12 then return jsonb_build_object('outcome', 'only_ask_invalid'); end if;
  for v_item in select * from jsonb_array_elements(v_only) loop
    if btrim(coalesce(v_item->>'axiscare_id', '')) !~ '^[0-9]+$' or btrim(coalesce(v_item->>'name', '')) = '' then
      return jsonb_build_object('outcome', 'only_ask_invalid'); end if;
    if not v_clean @> jsonb_build_array(jsonb_build_object('axiscare_id', btrim(v_item->>'axiscare_id'))) then
      v_clean := v_clean || jsonb_build_array(jsonb_build_object('axiscare_id', btrim(v_item->>'axiscare_id'), 'name', btrim(v_item->>'name')));
    end if;
  end loop;
  if v_bphone is not null and length(v_bphone) = 11 and left(v_bphone, 1) = '1' then v_bphone := substr(v_bphone, 2); end if;
  if v_bphone is not null and v_bphone !~ '^[0-9]{10}$' then return jsonb_build_object('outcome', 'backup_phone_invalid'); end if;
  if (v_bphone is not null or v_brel is not null) and v_bname is null then return jsonb_build_object('outcome', 'backup_name_required'); end if;
  if v_note is not null and length(v_note) > 2000 then return jsonb_build_object('outcome', 'note_too_long'); end if;
  if v_who = '' then return jsonb_build_object('outcome', 'source_required'); end if;
  if v_how is not null and v_how not in ('phone','in_person','assessment','care_plan_review','text','email') then
    return jsonb_build_object('outcome', 'unknown_source_how'); end if;
  if v_need is null and jsonb_array_length(v_clean) = 0 and v_bname is null and v_note is null then
    return jsonb_build_object('outcome', 'nothing_to_record'); end if;

  perform pg_advisory_xact_lock(hashtext('client_callin'), hashtext(v_ax));
  select id into v_id from public.client_callin_entries where request_id = v_req;
  if v_id is not null then return jsonb_build_object('outcome', 'already_recorded', 'id', v_id); end if;
  insert into public.client_callin_entries (request_id, axiscare_client_id, client_name, coverage_need, only_ask,
      backup_name, backup_phone, backup_relationship, note, source_who, source_how, entered_by, entered_by_name)
    values (v_req, v_ax, v_name, v_need, v_clean, v_bname, v_bphone, v_brel, v_note, v_who, v_how,
      lower(btrim(p_staff)), nullif(btrim(coalesce(p_staff_name, '')), ''))
    returning id into v_id;
  return jsonb_build_object('outcome', 'recorded', 'id', v_id);
end $$;

alter table public.client_callin_entries enable row level security;
revoke all on public.client_callin_entries from public, anon, authenticated, service_role;
revoke all on public.client_callin_current from public, anon, authenticated, service_role;
grant select on public.client_callin_entries to authenticated;
grant select on public.client_callin_current to authenticated, service_role;
grant select, insert on public.client_callin_entries to service_role;
grant usage on sequence public.client_callin_entries_id_seq to service_role;
drop policy if exists client_callin_read on public.client_callin_entries;
create policy client_callin_read on public.client_callin_entries for select to authenticated using (true);
revoke all on function public.client_callin_add(jsonb, text, text) from public, anon, authenticated, service_role;
grant execute on function public.client_callin_add(jsonb, text, text) to service_role;
revoke all on function public.client_callin_guard() from public, anon, authenticated, service_role;

do $verify$
begin
  if has_function_privilege('authenticated', 'public.client_callin_add(jsonb,text,text)', 'execute')
     or has_function_privilege('anon', 'public.client_callin_add(jsonb,text,text)', 'execute')
     or has_table_privilege('authenticated', 'public.client_callin_entries', 'insert')
     or has_table_privilege('anon', 'public.client_callin_entries', 'select')
     or has_table_privilege('service_role', 'public.client_callin_entries', 'update')
     or has_table_privilege('service_role', 'public.client_callin_entries', 'delete')
     or not has_table_privilege('authenticated', 'public.client_callin_current', 'select') then
    raise exception 'client_callin self-check failed: privileges'; end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.client_callin_entries'::regclass and not tgisinternal) <> 2 then
    raise exception 'client_callin self-check failed: append-only guards'; end if;
end $verify$;

commit;
