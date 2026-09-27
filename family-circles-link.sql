-- =============================================================================
-- family-circles-link.sql · Change 6a: Family Circles belong to a client, not a typed name
--
--   care_circles  + axiscare_client_id, linked_by, linked_at, link_how
--                 one ACTIVE circle per AxisCare client (unique index)
--   circle_contacts + axiscare_removed_at (on AxisCare's contacts no more; never deleted)
--   family_circle_link_log   append-only: every link and unlink, who and why
--   family_circle_link(circle, axiscare id, staff, how)   the door (service_role)
--   family_circle_unlink(circle, staff, reason)           the door (service_role)
--
-- Install links ONLY circles the nightly AxisCare sync itself made or fed (it has a
-- contact whose source is 'axiscare'), whose name EXACTLY equals exactly one AxisCare
-- client's name, where no other active circle has that name or that client. That is
-- the sync's own match, not a new guess. Every other circle waits for a person.
-- A circle nobody has linked is never texted (circle-send and Cara refuse it).
-- Additive; no row is deleted. GUARD: refuses if the link log already holds rows.
-- =============================================================================
begin;

do $guard$
declare n bigint;
begin
  if to_regclass('public.care_circles') is null or to_regclass('public.circle_contacts') is null then
    raise exception 'family_circles refused: care_circles / circle_contacts not found. Nothing was changed.';
  end if;
  if to_regclass('public.family_circle_link_log') is not null then
    lock table public.family_circle_link_log in access exclusive mode;
    select count(*) into n from public.family_circle_link_log where action <> 'install_link';
    if n > 0 then raise exception 'family_circles refused: % link(s) made by people already. Nothing was changed.', n; end if;
  end if;
end $guard$;

alter table public.care_circles add column if not exists axiscare_client_id text;
alter table public.care_circles add column if not exists linked_by text;
alter table public.care_circles add column if not exists linked_at timestamptz;
alter table public.care_circles add column if not exists link_how text;
alter table public.circle_contacts add column if not exists axiscare_removed_at timestamptz;
create unique index if not exists care_circles_one_active_per_client
  on public.care_circles (axiscare_client_id) where active is true and axiscare_client_id is not null;

drop function if exists public.family_circle_link(text, text, text, text);
drop function if exists public.family_circle_unlink(text, text, text);
create table if not exists public.family_circle_link_log (
  id                 bigserial primary key,
  circle_id          text not null,
  axiscare_client_id text,
  action             text not null check (action in ('install_link','link','unlink')),
  staff              text not null check (length(btrim(staff)) > 0),
  reason             text,
  at                 timestamptz not null default now()
);
create or replace function public.family_circle_link_log_guard() returns trigger language plpgsql as $$
begin raise exception '% is append-only (% refused)', tg_table_name, tg_op; end $$;
drop trigger if exists family_circle_link_log_append_only on public.family_circle_link_log;
create trigger family_circle_link_log_append_only before update or delete on public.family_circle_link_log
  for each row execute function public.family_circle_link_log_guard();
drop trigger if exists family_circle_link_log_no_truncate on public.family_circle_link_log;
create trigger family_circle_link_log_no_truncate before truncate on public.family_circle_link_log
  for each statement execute function public.family_circle_link_log_guard();

-- the sync's own exact matches (see header)
with ax as (
  select lower(btrim(pi.display_name)) as nm, s.source_id as ax,
         count(*) over (partition by lower(btrim(pi.display_name))) as same_name
    from public.person_source_id s join public.person_identity pi on pi.id = s.person_id
   where s.system = 'axiscare' and s.entity_type = 'client'),
cand as (
  select c.id, a.ax from public.care_circles c join ax a on a.nm = lower(btrim(c.client_name)) and a.same_name = 1
   where c.active is true and c.axiscare_client_id is null
     and exists (select 1 from public.circle_contacts m where m.circle_id::text = c.id::text and m.source = 'axiscare')
     and (select count(*) from public.care_circles c2 where c2.active is true and lower(btrim(c2.client_name)) = a.nm) = 1
     and not exists (select 1 from public.care_circles c3 where c3.axiscare_client_id = a.ax)),
done as (
  update public.care_circles c set axiscare_client_id = cand.ax, linked_by = 'install (sync''s own exact match)',
         linked_at = now(), link_how = 'install_exact_sync'
    from cand where c.id = cand.id returning c.id, c.axiscare_client_id)
insert into public.family_circle_link_log (circle_id, axiscare_client_id, action, staff, reason)
select id::text, axiscare_client_id, 'install_link', 'install', 'the nightly AxisCare sync''s own exact name match' from done;

create function public.family_circle_link(p_circle_id text, p_axiscare_client_id text, p_staff text, p_how text)
returns jsonb language plpgsql security invoker as $$
declare staff text := nullif(btrim(p_staff), ''); ax text := nullif(btrim(p_axiscare_client_id), '');
        c record; other text; v_person uuid;
begin
  if staff is null then return jsonb_build_object('outcome','staff_required'); end if;
  if ax is null or ax !~ '^\d+$' then return jsonb_build_object('outcome','axiscare_id_required'); end if;
  perform pg_advisory_xact_lock(hashtext('family_circle'), hashtext(ax));
  select id::text as id, client_name, active, axiscare_client_id into c from public.care_circles where id::text = p_circle_id for update;
  if not found or c.active is not true then return jsonb_build_object('outcome','circle_not_found'); end if;
  if c.axiscare_client_id = ax then return jsonb_build_object('outcome','already_linked'); end if;
  if c.axiscare_client_id is not null then
    return jsonb_build_object('outcome','linked_elsewhere','axiscare_client_id', c.axiscare_client_id,
      'detail','this circle is linked to another client; unlink it first, with a reason'); end if;
  select person_id into v_person from public.person_source_id where system = 'axiscare' and entity_type = 'client' and source_id = ax limit 1;
  if v_person is null then return jsonb_build_object('outcome','not_a_hub_client','detail','that AxisCare client has no person in the hub yet (answer "Who is this?" first)'); end if;
  select id::text into other from public.care_circles where active is true and axiscare_client_id = ax limit 1;
  if other is not null then return jsonb_build_object('outcome','client_has_a_circle','circle_id', other,
    'detail','that client already has a Family Circle; add these people there instead'); end if;
  update public.care_circles set axiscare_client_id = ax, linked_by = staff, linked_at = now(), link_how = coalesce(nullif(btrim(p_how), ''), 'person')
   where id::text = p_circle_id;
  insert into public.family_circle_link_log (circle_id, axiscare_client_id, action, staff, reason) values (p_circle_id, ax, 'link', staff, p_how);
  return jsonb_build_object('outcome','linked','axiscare_client_id', ax);
end $$;

create function public.family_circle_unlink(p_circle_id text, p_staff text, p_reason text)
returns jsonb language plpgsql security invoker as $$
declare staff text := nullif(btrim(p_staff), ''); c record;
begin
  if staff is null then return jsonb_build_object('outcome','staff_required'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then return jsonb_build_object('outcome','reason_required'); end if;
  select id::text as id, axiscare_client_id into c from public.care_circles where id::text = p_circle_id for update;
  if not found then return jsonb_build_object('outcome','circle_not_found'); end if;
  if c.axiscare_client_id is null then return jsonb_build_object('outcome','not_linked'); end if;
  update public.care_circles set axiscare_client_id = null, linked_by = staff, linked_at = now(), link_how = 'unlinked' where id::text = p_circle_id;
  insert into public.family_circle_link_log (circle_id, axiscare_client_id, action, staff, reason) values (p_circle_id, c.axiscare_client_id, 'unlink', staff, btrim(p_reason));
  return jsonb_build_object('outcome','unlinked');
end $$;

alter table public.family_circle_link_log enable row level security;
revoke all on public.family_circle_link_log from public, anon, authenticated, service_role;
grant select on public.family_circle_link_log to authenticated;
grant select, insert on public.family_circle_link_log to service_role;
grant usage on sequence public.family_circle_link_log_id_seq to service_role;
drop policy if exists family_circle_link_log_read on public.family_circle_link_log;
create policy family_circle_link_log_read on public.family_circle_link_log for select to authenticated using (true);
revoke all on function public.family_circle_link(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.family_circle_unlink(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.family_circle_link(text, text, text, text) to service_role;
grant execute on function public.family_circle_unlink(text, text, text) to service_role;
revoke all on function public.family_circle_link_log_guard() from public, anon, authenticated, service_role;

do $verify$
begin
  if has_function_privilege('authenticated', 'public.family_circle_link(text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.family_circle_link(text,text,text,text)', 'execute')
     or has_table_privilege('authenticated', 'public.family_circle_link_log', 'insert')
     or has_table_privilege('service_role', 'public.family_circle_link_log', 'update') then
    raise exception 'family_circles self-check failed: privileges'; end if;
  if (select count(*) from public.care_circles where active is true and axiscare_client_id is not null)
     <> (select count(distinct axiscare_client_id) from public.care_circles where active is true and axiscare_client_id is not null) then
    raise exception 'family_circles self-check failed: two active circles on one client'; end if;
end $verify$;

commit;
