-- =============================================================================
-- GATE 4a · PEOPLE ON THE JOURNEY (approved 2026-09-28)
-- =============================================================================
-- Everyone we learn about sits on the family's Journey from the first call: name,
-- relationship (and organization for professionals), roles, how and when to reach
-- them, and permission to discuss care (asked by a person, never assumed: who asked
-- and when). The CALLER stays owned by the inquiry until Gate 5: their row here holds
-- only roles and permission (is_caller), never a copy of their name or phone.
-- Append-only like facts: every change is a new version of that person (person_key),
-- a stale edit is refused, removal and correction need a reason. Nothing here links
-- anyone to anyone else, sends anything, or touches AxisCare or the Family Circle.
-- Written only through people_on_journey_record() (reached through client-fact by office
-- staff). Read by exactly who can read leads.
-- =============================================================================
begin;

create table public.journey_person (
  row_id                uuid primary key default gen_random_uuid(),
  person_key            uuid not null,
  episode_id            uuid not null references public.journey_episode(episode_id) on delete restrict,
  is_caller             boolean not null default false,
  name                  text,
  relationship          text,
  organization          text,
  roles                 text[] not null default '{}'
                          check (roles <@ array['primary','decision_maker','poa','billing','emergency','professional']::text[]),
  phone                 text,
  email                 text,
  reach_way             text check (reach_way in ('call','text','email')),
  reach_time            text,
  permission            text not null default 'not_asked' check (permission in ('yes','no','not_asked')),
  permission_asked_by   text,
  permission_asked_at   timestamptz,
  change_kind           text not null check (change_kind in ('first','update','correction','removed')),
  reason                text,
  supersedes_row_id     uuid references public.journey_person(row_id) on delete restrict,
  recorded_by           text not null check (length(btrim(recorded_by)) > 0),
  recorded_at           timestamptz not null default now(),
  constraint journey_person_caller_holds_no_details check (not is_caller or (name is null and phone is null and email is null)),
  constraint journey_person_named check (is_caller or change_kind = 'removed' or length(btrim(coalesce(name,''))) > 0),
  constraint journey_person_permission_asked check (permission = 'not_asked' or (length(btrim(coalesce(permission_asked_by,''))) > 0 and permission_asked_at is not null)),
  constraint journey_person_chain check (case change_kind
    when 'first' then supersedes_row_id is null
    else supersedes_row_id is not null end),
  constraint journey_person_reason check (change_kind not in ('correction','removed') or length(btrim(coalesce(reason,''))) > 0)
);
comment on table public.journey_person is 'Gate 4a · append-only people on a Journey; the current version of a person is the one nothing replaces';
create unique index journey_person_supersedes_once on public.journey_person (supersedes_row_id) where supersedes_row_id is not null;
create unique index journey_person_one_root on public.journey_person (person_key) where supersedes_row_id is null;
create unique index journey_person_one_caller on public.journey_person (episode_id) where is_caller and supersedes_row_id is null;
create index journey_person_episode_ix on public.journey_person (episode_id);

create table public.journey_person_door_audit (
  id bigserial primary key, at timestamptz not null default now(), outcome text not null,
  episode_id uuid, person_key uuid, change_kind text, acting_staff text, row_id uuid
);

create function public.people_on_journey_guard() returns trigger language plpgsql as $g$
begin raise exception '% is append-only (% refused)', tg_table_name, tg_op; end $g$;
create trigger journey_person_append_only_t before update or delete on public.journey_person for each row execute function public.people_on_journey_guard();
create trigger journey_person_no_truncate before truncate on public.journey_person for each statement execute function public.people_on_journey_guard();
create trigger journey_person_audit_append_only_t before update or delete on public.journey_person_door_audit for each row execute function public.people_on_journey_guard();
create trigger journey_person_audit_no_truncate before truncate on public.journey_person_door_audit for each statement execute function public.people_on_journey_guard();

create view public.journey_person_current with (security_invoker = true) as
select p.* from public.journey_person p
 where p.change_kind <> 'removed'
   and not exists (select 1 from public.journey_person s where s.supersedes_row_id = p.row_id);

create function public.people_on_journey_record(
  p_episode_id uuid, p_person_key uuid, p_is_caller boolean, p_name text, p_relationship text, p_organization text,
  p_roles text[], p_phone text, p_email text, p_reach_way text, p_reach_time text, p_permission text,
  p_permission_asked_by text, p_permission_asked_at timestamptz, p_change_kind text, p_supersedes_row_id uuid,
  p_reason text, p_recorded_by text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $d$
declare
  v_state text; v_head uuid; v_key uuid := p_person_key; v_id uuid; v_code text; v_msg text; v_caller boolean := coalesce(p_is_caller, false);
  v_by text := nullif(btrim(coalesce(p_recorded_by,'')),''); v_perm text := coalesce(nullif(btrim(coalesce(p_permission,'')),''), 'not_asked');
begin
  perform pg_advisory_xact_lock(hashtextextended('jp|' || coalesce(p_episode_id::text,'') || '|' || coalesce(p_person_key::text,'new'), 0));
  <<check>> begin
    if v_by is null then v_code := 'staff_required'; v_msg := 'who is recording this is missing'; exit check; end if;
    select state into v_state from public.journey_episode where episode_id = p_episode_id;
    if not found then v_code := 'no_such_journey'; v_msg := 'that Journey does not exist'; exit check; end if;
    if v_state = 'voided' then v_code := 'journey_voided'; v_msg := 'that Journey was voided'; exit check; end if;
    if p_change_kind is null or p_change_kind not in ('first','update','correction','removed') then v_code := 'invalid_change_kind'; v_msg := 'change must be first, update, correction or removed'; exit check; end if;
    if p_change_kind in ('correction','removed') and nullif(btrim(coalesce(p_reason,'')),'') is null then v_code := 'reason_required'; v_msg := 'a correction or removal needs a reason'; exit check; end if;
    if not coalesce(p_roles, '{}') <@ array['primary','decision_maker','poa','billing','emergency','professional']::text[] then v_code := 'invalid_role'; v_msg := 'that is not one of the roles'; exit check; end if;
    if v_perm not in ('yes','no','not_asked') then v_code := 'invalid_permission'; v_msg := 'permission must be yes, no or not asked yet'; exit check; end if;
    if v_perm <> 'not_asked' and (nullif(btrim(coalesce(p_permission_asked_by,'')),'') is null or p_permission_asked_at is null) then
      v_code := 'permission_needs_who_and_when'; v_msg := 'say who asked about permission, and when'; exit check; end if;
    if p_reach_way is not null and p_reach_way not in ('call','text','email') then v_code := 'invalid_reach_way'; v_msg := 'best way must be call, text or email'; exit check; end if;
    if v_caller and (p_name is not null or p_phone is not null or p_email is not null) then v_code := 'caller_details_stay_on_inquiry'; v_msg := 'the caller''s name and contact details stay on the inquiry'; exit check; end if;
    if not v_caller and p_change_kind <> 'removed' and nullif(btrim(coalesce(p_name,'')),'') is null then v_code := 'name_required'; v_msg := 'a person needs a name'; exit check; end if;
    if p_change_kind = 'first' then
      if p_supersedes_row_id is not null or p_person_key is not null then v_code := 'first_replaces_nothing'; v_msg := 'a new person replaces nothing'; exit check; end if;
      if v_caller and exists (select 1 from public.journey_person_current where episode_id = p_episode_id and is_caller) then
        v_code := 'caller_already_recorded'; v_msg := 'the caller is already on this Journey; change them instead'; exit check; end if;
      v_key := gen_random_uuid();
    else
      if p_person_key is null or p_supersedes_row_id is null then v_code := 'supersedes_required'; v_msg := 'say which person and which version this replaces'; exit check; end if;
      select row_id into v_head from public.journey_person p where p.person_key = p_person_key and p.episode_id = p_episode_id
         and not exists (select 1 from public.journey_person s where s.supersedes_row_id = p.row_id);
      if v_head is null then v_code := 'wrong_person'; v_msg := 'that person is not on this Journey'; exit check; end if;
      if v_head <> p_supersedes_row_id then v_code := 'stale'; v_msg := 'someone changed this person after you opened them; look at their change first'; exit check; end if;
      if (select is_caller from public.journey_person where row_id = v_head) <> v_caller then v_code := 'wrong_person'; v_msg := 'a person cannot switch between caller and not'; exit check; end if;
    end if;
  end check;
  if v_code is not null then
    insert into public.journey_person_door_audit (outcome, episode_id, person_key, change_kind, acting_staff) values ('refused:' || v_code, p_episode_id, p_person_key, left(p_change_kind, 20), v_by);
    return jsonb_build_object('outcome', 'refused', 'reason', v_code, 'message', v_msg);
  end if;
  insert into public.journey_person (person_key, episode_id, is_caller, name, relationship, organization, roles, phone, email, reach_way, reach_time,
                                     permission, permission_asked_by, permission_asked_at, change_kind, reason, supersedes_row_id, recorded_by)
  values (v_key, p_episode_id, v_caller, case when v_caller then null else nullif(btrim(coalesce(p_name,'')),'') end,
          nullif(btrim(coalesce(p_relationship,'')),''), nullif(btrim(coalesce(p_organization,'')),''), coalesce(p_roles, '{}'),
          case when v_caller then null else nullif(btrim(coalesce(p_phone,'')),'') end, case when v_caller then null else nullif(btrim(coalesce(p_email,'')),'') end,
          p_reach_way, nullif(btrim(coalesce(p_reach_time,'')),''), v_perm,
          case when v_perm = 'not_asked' then null else nullif(btrim(coalesce(p_permission_asked_by,'')),'') end,
          case when v_perm = 'not_asked' then null else p_permission_asked_at end,
          p_change_kind, nullif(btrim(coalesce(p_reason,'')),''), p_supersedes_row_id, v_by)
  returning row_id into v_id;
  insert into public.journey_person_door_audit (outcome, episode_id, person_key, change_kind, acting_staff, row_id) values ('recorded', p_episode_id, v_key, p_change_kind, v_by, v_id);
  return jsonb_build_object('outcome', 'recorded', 'person_key', v_key, 'row_id', v_id);
exception when unique_violation then
  insert into public.journey_person_door_audit (outcome, episode_id, person_key, change_kind, acting_staff) values ('refused:stale', p_episode_id, p_person_key, left(p_change_kind, 20), v_by);
  return jsonb_build_object('outcome', 'refused', 'reason', 'stale', 'message', 'someone changed this person after you opened them; look at their change first');
end $d$;

alter table public.journey_person enable row level security;
alter table public.journey_person_door_audit enable row level security;
revoke all on public.journey_person, public.journey_person_door_audit, public.journey_person_current from public, anon, authenticated, service_role;
revoke all on sequence public.journey_person_door_audit_id_seq from public, anon, authenticated, service_role;
grant select on public.journey_person, public.journey_person_door_audit, public.journey_person_current to authenticated, service_role;
create policy journey_person_read on public.journey_person for select to authenticated using (public.can_access_data_key('leads'));
create policy journey_person_audit_read on public.journey_person_door_audit for select to authenticated using (public.can_access_data_key('leads'));
revoke all on function public.people_on_journey_record(uuid,uuid,boolean,text,text,text,text[],text,text,text,text,text,text,timestamptz,text,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.people_on_journey_record(uuid,uuid,boolean,text,text,text,text[],text,text,text,text,text,text,timestamptz,text,uuid,text,text) to service_role;
revoke all on function public.people_on_journey_guard() from public, anon, authenticated, service_role;

do $verify$ begin
  if has_function_privilege('authenticated', 'public.people_on_journey_record(uuid,uuid,boolean,text,text,text,text[],text,text,text,text,text,text,timestamptz,text,uuid,text,text)', 'execute') then
    raise exception 'journey_person self-check: the door is reachable from a browser'; end if;
  if has_table_privilege('authenticated','public.journey_person','insert') or has_table_privilege('service_role','public.journey_person','insert')
     or has_table_privilege('anon','public.journey_person','select') then raise exception 'journey_person self-check: someone other than the door could write, or a visitor could read'; end if;
  raise notice 'journey_person installed: one door, read by whoever can read leads';
end $verify$;
commit;
