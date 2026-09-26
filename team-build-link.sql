-- =============================================================================
-- team-build-link.sql · link a Team Builder plan to its Journey (hub-initiated)
--
--   journey_seat_member   routing configuration: which signed-in staff hold the
--                         Client Intake / Owner / Decision seats. Journey data
--                         never names a person as a seat; this table does.
--   team_build_link       append-only: which Journey episode a plan belongs to.
--                         A re-link supersedes (never edits) and needs Owner /
--                         Decision; it is refused once needs exist under the
--                         current link, because needs never move between Journeys.
--   team_build_link_set   the Door (service_role only; the hub reaches it through
--                         the journey-link-plan edge function as the signed-in person)
--   team_build_link_current, journey_directory   read-only views for the hub
-- GUARD: refuses if the link table already holds rows. Membership is routing
-- config, so a rerun keeps its rows.
-- =============================================================================
begin;

do $guard$
declare n bigint;
begin
  if to_regclass('public.team_build_link') is not null then
    lock table public.team_build_link in access exclusive mode;
    select count(*) into n from public.team_build_link;
    if n > 0 then raise exception 'team_build_link refused: team_build_link contains % row(s). Nothing was changed.', n; end if;
  end if;
end $guard$;

drop view if exists public.journey_directory, public.team_build_link_current;
drop function if exists public.team_build_link_set(text, uuid, text, text);
drop table if exists public.team_build_link;
drop function if exists public.team_build_link_guard();

create table if not exists public.journey_seat_member (
  email     text not null check (email = lower(btrim(email)) and email like '%@%'),
  seat      text not null check (seat in ('client_intake','owner_decision')),
  added_by  text not null default current_user,
  added_at  timestamptz not null default now(),
  primary key (email, seat)
);
comment on table public.journey_seat_member is
  'routing configuration · who currently holds each Journey seat; changed only by the owner (SQL), never by the hub';

create table public.team_build_link (
  link_id        uuid primary key default gen_random_uuid(),
  plan_id        text not null check (length(btrim(plan_id)) > 0),
  episode_id     uuid not null references public.journey_episode(episode_id) on delete restrict,
  linked_by      text not null,
  linked_seat    text not null check (linked_seat in ('client_intake','owner_decision')),
  linked_at      timestamptz not null default now(),
  supersedes_link_id uuid references public.team_build_link(link_id) on delete restrict,
  note           text
);
comment on table public.team_build_link is 'team_build_link v1 · append-only; the current link of a plan is the one nothing supersedes';
create unique index team_build_link_supersedes_once on public.team_build_link (supersedes_link_id) where supersedes_link_id is not null;
create index team_build_link_plan_ix on public.team_build_link (plan_id);

create function public.team_build_link_guard() returns trigger language plpgsql as $$
begin raise exception 'team_build_link is append-only (% refused)', tg_op; end $$;
create trigger team_build_link_append_only_t before update or delete on public.team_build_link
  for each row execute function public.team_build_link_guard();
create trigger team_build_link_no_truncate before truncate on public.team_build_link
  for each statement execute function public.team_build_link_guard();

create view public.team_build_link_current with (security_invoker = true) as
select l.* from public.team_build_link l
 where not exists (select 1 from public.team_build_link s where s.supersedes_link_id = l.link_id);

create function public.team_build_link_set(
  p_plan_id text, p_episode_id uuid, p_acting_staff text, p_acting_seat text
) returns jsonb
language plpgsql security invoker as $$
declare cur public.team_build_link%rowtype; v uuid;
begin
  if p_acting_seat not in ('client_intake','owner_decision') then return jsonb_build_object('outcome','invalid_seat'); end if;
  if p_acting_staff is null or length(btrim(p_acting_staff)) = 0 then return jsonb_build_object('outcome','staff_required'); end if;
  perform pg_advisory_xact_lock(hashtext('team_build_link'), hashtext(p_plan_id));
  if not exists (select 1 from public.app_data ad,
                   lateral jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end) e
                  where ad.key = 'staffing_plans' and e->>'id' = p_plan_id) then
    return jsonb_build_object('outcome','plan_not_found');
  end if;
  if not exists (select 1 from public.journey_episode where episode_id = p_episode_id and public.journey_state_is_active(state)) then
    return jsonb_build_object('outcome','episode_not_active');
  end if;
  select l.* into cur from public.team_build_link_current l where l.plan_id = p_plan_id;
  if found then
    if cur.episode_id = p_episode_id then return jsonb_build_object('outcome','already_linked','link_id', cur.link_id); end if;
    if exists (select 1 from public.staffing_need n where n.origin_system = 'team_builder' and n.episode_id = cur.episode_id
                 and split_part(n.origin_ref, '|', 1) = p_plan_id) then
      return jsonb_build_object('outcome','has_needs',
        'detail','needs from this plan already belong to its current Journey; they cannot move');
    end if;
    if p_acting_seat <> 'owner_decision' then
      return jsonb_build_object('outcome','seat_required','seat','owner_decision',
        'detail','changing which Journey a plan belongs to is an Owner / Decision call');
    end if;
  end if;
  insert into public.team_build_link (plan_id, episode_id, linked_by, linked_seat, supersedes_link_id)
  values (p_plan_id, p_episode_id, p_acting_staff, p_acting_seat, cur.link_id)
  returning link_id into v;
  return jsonb_build_object('outcome', case when cur.link_id is null then 'linked' else 'relinked' end, 'link_id', v);
end $$;

-- who each active Journey is, for the hub's picker (client name, or the lead's names)
create view public.journey_directory with (security_invoker = true) as
with lead_rows as (
  select e->>'id' as lead_id,
         nullif(btrim(concat_ws(' ', e->>'client_first_name', e->>'client_last_name')), '') as client_name,
         nullif(btrim(concat_ws(' ', e->>'first_name', e->>'last_name')), '') as contact_name,
         lower(coalesce(nullif(e->>'status', ''), 'new')) as status
    from public.app_data ad,
         lateral jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end) e
   where ad.key = 'leads' and jsonb_typeof(e) = 'object'
)
select e.episode_id,
       case when e.person_id is not null then 'client' else 'inquiry' end as kind,
       coalesce(p.display_name, lr.client_name, case when lr.contact_name is not null then 'inquiry from ' || lr.contact_name end,
                'unnamed inquiry') as label,
       case when e.person_id is not null then (select 'AxisCare ' || string_agg(s.source_id, ', ') from public.person_source_id s
                                                where s.person_id = e.person_id and s.system = 'axiscare' and s.entity_type = 'client')
            else 'inquiry ' || coalesce(r.began_lo::text, 'date unknown') || coalesce(' · ' || lr.status, '') end as detail,
       e.state
  from public.journey_episode e
  join public.episode_range r using (episode_id)
  left join public.person_identity p on p.id = e.person_id
  left join public.episode_source es on es.episode_id = e.episode_id and es.system = 'lead' and es.role = 'origin'
  left join lead_rows lr on lr.lead_id = es.source_ref
 where public.journey_state_is_active(e.state);

alter table public.journey_seat_member enable row level security;
alter table public.team_build_link     enable row level security;
revoke all on public.journey_seat_member, public.team_build_link from public, anon, authenticated, service_role;
revoke all on public.team_build_link_current, public.journey_directory from public, anon, authenticated, service_role;
grant select on public.journey_seat_member to authenticated, service_role;
grant select on public.team_build_link to authenticated;
grant select, insert on public.team_build_link to service_role;
grant select on public.team_build_link_current, public.journey_directory to authenticated, service_role;
do $p$ begin
  create policy journey_seat_member_read on public.journey_seat_member for select to authenticated using (true);
exception when duplicate_object then null; end $p$;
create policy team_build_link_read on public.team_build_link for select to authenticated using (true);
revoke all on function public.team_build_link_set(text, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.team_build_link_set(text, uuid, text, text) to service_role;
revoke all on function public.team_build_link_guard() from public, anon, authenticated, service_role;

do $verify$
begin
  if (select prosecdef from pg_proc where oid = 'public.team_build_link_set(text,uuid,text,text)'::regprocedure) then
    raise exception 'team_build_link self-check failed: definer'; end if;
  if has_function_privilege('authenticated', 'public.team_build_link_set(text,uuid,text,text)', 'execute')
     or has_table_privilege('authenticated', 'public.team_build_link', 'insert')
     or has_table_privilege('authenticated', 'public.journey_seat_member', 'insert')
     or has_table_privilege('service_role', 'public.journey_seat_member', 'insert')
     or has_table_privilege('service_role', 'public.team_build_link', 'update')
     or has_table_privilege('anon', 'public.team_build_link', 'select') then
    raise exception 'team_build_link self-check failed: privileges'; end if;
end $verify$;

commit;
