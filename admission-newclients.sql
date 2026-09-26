-- =============================================================================
-- admission-newclients.sql · Step 3 · "Who is this?" for a new client with NO lead
--
-- One human action on the New Clients card admits an AxisCare client who did not
-- come through an inquiry: confirm who they are (an existing person, or a new one)
-- and say why there was no lead. In one transaction:
--   * the person's active Journey is kept if they have one; otherwise a Journey is
--     opened honestly: converted, began on or before the day AxisCare showed them,
--     earlier history not observed. Nothing about the past is invented.
--   * if the Journey step is refused, the identity confirmation is rolled back too.
-- A client who DID come from an inquiry is not admitted here: choosing that inquiry
-- sends the coordinator through Step 2 (lead_journey_connect), which also closes the
-- admission case, so there is one path for lead-sourced clients.
--
--   client_admission_journey      append-only record of each no-lead admission's Journey
--   client_admission_admit        the Door (service_role only; the hub reaches it through
--                                 the client-admit function as the signed-in seat holder)
--   client_admission_lead_options read-only view: for each open case, the unconnected
--                                 inquiries it might have come from, with a name hint only
-- Additive: client_admission_confirm / _dismiss and all existing rows are untouched.
-- GUARD: refuses if client_admission_journey already holds rows.
-- =============================================================================
begin;

do $guard$
declare n bigint;
begin
  if to_regclass('public.client_admission_journey') is not null then
    lock table public.client_admission_journey in access exclusive mode;
    select count(*) into n from public.client_admission_journey;
    if n > 0 then raise exception 'admission_newclients refused: client_admission_journey contains % row(s). Nothing was changed.', n; end if;
  end if;
end $guard$;

drop view if exists public.client_admission_lead_options;
drop function if exists public.client_admission_admit(uuid, text, uuid, text, text, text, text, text);
drop table if exists public.client_admission_journey;
drop function if exists public.client_admission_journey_guard();

create table public.client_admission_journey (
  case_id         uuid primary key references public.client_admission_case(case_id) on delete restrict,
  decision        text not null check (decision in ('existing_journey','new_journey')),
  episode_id      uuid not null references public.journey_episode(episode_id) on delete restrict,
  no_lead_reason  text not null check (length(btrim(no_lead_reason)) > 0),
  decided_by      text not null check (length(btrim(decided_by)) > 0),
  decided_seat    text not null check (decided_seat in ('client_intake','owner_decision')),
  decided_at      timestamptz not null default now()
);
comment on table public.client_admission_journey is
  'admission_newclients v1 · append-only; which Journey each no-lead admission carries';

create function public.client_admission_journey_guard() returns trigger language plpgsql as $$
begin raise exception '% is append-only (% refused)', tg_table_name, tg_op; end $$;
create trigger client_admission_journey_append_only_t before update or delete on public.client_admission_journey
  for each row execute function public.client_admission_journey_guard();
create trigger client_admission_journey_no_truncate before truncate on public.client_admission_journey
  for each statement execute function public.client_admission_journey_guard();

create function public.client_admission_admit(
  p_case_id uuid, p_decision text, p_person_id uuid, p_display_name text,
  p_no_lead_reason text, p_acting_staff text, p_acting_seat text, p_note text default null
) returns jsonb
language plpgsql security invoker as $$
declare
  r jsonb; lr jsonb; c public.client_admission_case%rowtype; v_person uuid; v_ep uuid; v_dec text;
  staff text := nullif(btrim(p_acting_staff), '');
  nlr text := nullif(btrim(p_no_lead_reason), '');
begin
  if p_acting_seat is null or p_acting_seat not in ('client_intake','owner_decision') then
    return jsonb_build_object('outcome','invalid_seat'); end if;
  if staff is null then return jsonb_build_object('outcome','staff_required'); end if;
  if nlr is null then
    return jsonb_build_object('outcome','no_lead_reason_required',
      'detail','say why this client has no inquiry; if they came from one, connect that inquiry instead');
  end if;
  begin
    r := public.client_admission_confirm(p_case_id, p_decision, staff, p_acting_seat, p_person_id, p_display_name, p_note);
    if r->>'outcome' <> 'confirmed' then return r; end if;
    v_person := (r->>'person_id')::uuid;
    select * into c from public.client_admission_case where case_id = p_case_id;
    select episode_id into v_ep from public.journey_episode
     where person_id = v_person and public.journey_state_is_active(state) limit 1;
    if v_ep is not null then
      v_dec := 'existing_journey';
    else
      lr := public.episode_open_for_person(v_person, 'converted', 'before_observation',
              'first seen as a new AxisCare client (' || c.observed_label || '); admitted through case ' || p_case_id,
              p_began_not_after => (c.observed_at at time zone 'America/Chicago')::date,
              p_prior_history => 'unobserved', p_prior_evidence => 'history before this admission was not observed',
              p_evidence_ref => 'client_admission_case:' || p_case_id,
              p_workflow => 'client_admission', p_acting_staff => staff, p_acting_seat => p_acting_seat);
      if lr->>'outcome' <> 'opened' then raise exception 'admit_journey:%', lr::text; end if;
      v_ep := (lr->>'episode_id')::uuid; v_dec := 'new_journey';
    end if;
    insert into public.client_admission_journey (case_id, decision, episode_id, no_lead_reason, decided_by, decided_seat)
    values (p_case_id, v_dec, v_ep, nlr, staff, p_acting_seat);
    return jsonb_build_object('outcome','admitted','person_id', v_person, 'episode_id', v_ep, 'journey', v_dec);
  exception when raise_exception then
    if sqlerrm like 'admit_journey:%' then
      return jsonb_build_object('outcome','journey_refused','detail', substr(sqlerrm, 15)::jsonb,
        'note','nothing was saved: the identity confirmation was rolled back with it');
    end if;
    raise;
  end;
end $$;

-- the inquiries a new client could have come from: open cases x unresolved lead Journeys
create view public.client_admission_lead_options with (security_invoker = true) as
select c.case_id, c.axiscare_client_id, c.axiscare_name, d.episode_id, s.source_ref as lead_id, d.label, d.detail,
       case when lower(btrim(d.label)) = lower(btrim(coalesce(c.axiscare_name, c.observed_label))) then 'name'
            when split_part(lower(btrim(d.label)), ' ', -1) <> ''
             and split_part(lower(btrim(d.label)), ' ', -1)
               = split_part(lower(btrim(coalesce(c.axiscare_name, c.observed_label))), ' ', -1) then 'last_name'
       end as match
  from public.client_admission_case c
  join public.journey_directory d on d.kind = 'inquiry'
  join public.journey_episode e on e.episode_id = d.episode_id and e.state = 'provisional' and e.person_id is null
  join public.episode_source s on s.episode_id = d.episode_id and s.system = 'lead' and s.role = 'origin'
 where c.status = 'open';

alter table public.client_admission_journey enable row level security;
revoke all on public.client_admission_journey from public, anon, authenticated, service_role;
revoke all on public.client_admission_lead_options from public, anon, authenticated, service_role;
grant select on public.client_admission_journey to authenticated;
grant select, insert on public.client_admission_journey to service_role;
grant select on public.client_admission_lead_options to authenticated, service_role;
create policy client_admission_journey_read on public.client_admission_journey for select to authenticated using (true);
revoke all on function public.client_admission_admit(uuid, text, uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.client_admission_admit(uuid, text, uuid, text, text, text, text, text) to service_role;
revoke all on function public.client_admission_journey_guard() from public, anon, authenticated, service_role;

do $verify$
begin
  if (select prosecdef from pg_proc where oid = 'public.client_admission_admit(uuid,text,uuid,text,text,text,text,text)'::regprocedure) then
    raise exception 'admission_newclients self-check failed: definer'; end if;
  if has_function_privilege('authenticated', 'public.client_admission_admit(uuid,text,uuid,text,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.client_admission_admit(uuid,text,uuid,text,text,text,text,text)', 'execute')
     or has_table_privilege('authenticated', 'public.client_admission_journey', 'insert')
     or has_table_privilege('service_role', 'public.client_admission_journey', 'update')
     or has_table_privilege('anon', 'public.client_admission_journey', 'select')
     or has_table_privilege('anon', 'public.client_admission_lead_options', 'select') then
    raise exception 'admission_newclients self-check failed: privileges'; end if;
end $verify$;

commit;
