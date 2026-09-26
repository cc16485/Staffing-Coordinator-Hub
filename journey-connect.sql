-- =============================================================================
-- journey-connect.sql · Step 2 of the Lead to Client Plan
-- A lead's Journey becomes the client's Journey when a person confirms which
-- AxisCare client the lead is.
--
-- The confirmation is the coordinator's deliberate act, made with both records
-- in view (a typed AxisCare id shown side by side with the lead, or the Convert
-- button that creates the AxisCare client from this lead). A name match made by
-- software never counts. In ONE transaction the Door:
--   * finds the person already linked to that AxisCare client id, or creates
--     one (identity recorded as human-confirmed, with who and how);
--   * closes an open admission case for that id as confirmed, if one exists;
--   * resolves the lead's provisional Journey to that person and marks it
--     converted: the SAME Journey (same episode_id), so its Start Contract and
--     history carry on into New Clients and the client profile;
--   * records the connection (append-only).
-- If any part is refused, nothing is saved and the reason is returned.
--
--   lead_journey_connection   append-only: which lead Journey became which client, by whom, how
--   lead_journey_connect      the Door (service_role only; the hub reaches it through the
--                             journey-connect function as the signed-in seat holder)
--   lead_journey_mirror       REPLACED with one change: a lead marked Lost no longer closes a
--                             Journey that has been confirmed as a client's (reported instead)
-- Additive: no existing row changes except the documented open -> confirmed admission case.
-- GUARD: refuses if lead_journey_connection already holds rows.
-- =============================================================================
begin;

do $guard$
declare n bigint;
begin
  if to_regclass('public.lead_journey_connection') is not null then
    lock table public.lead_journey_connection in access exclusive mode;
    select count(*) into n from public.lead_journey_connection;
    if n > 0 then raise exception 'journey_connect refused: lead_journey_connection contains % row(s). Nothing was changed.', n; end if;
  end if;
end $guard$;

drop function if exists public.lead_journey_connect(text, text, text, text, text, text);
drop table if exists public.lead_journey_connection;
drop function if exists public.lead_journey_connection_guard();

create table public.lead_journey_connection (
  episode_id          uuid primary key references public.journey_episode(episode_id) on delete restrict,
  lead_id             text not null unique check (length(btrim(lead_id)) > 0),
  axiscare_client_id  text not null check (length(btrim(axiscare_client_id)) > 0),
  person_id           uuid not null references public.person_identity(id) on delete restrict,
  how                 text not null check (how in ('typed','convert','confirmed_match')),
  person_created      boolean not null,
  admission_case_id   uuid references public.client_admission_case(case_id) on delete restrict,
  confirmed_by        text not null check (length(btrim(confirmed_by)) > 0),
  confirmed_seat      text not null check (confirmed_seat in ('client_intake','owner_decision')),
  confirmed_at        timestamptz not null default now()
);
comment on table public.lead_journey_connection is
  'journey_connect v1 · append-only; a lead Journey confirmed by a person as a given AxisCare client';

create function public.lead_journey_connection_guard() returns trigger language plpgsql as $$
begin raise exception '% is append-only (% refused)', tg_table_name, tg_op; end $$;
create trigger lead_journey_connection_append_only_t before update or delete on public.lead_journey_connection
  for each row execute function public.lead_journey_connection_guard();
create trigger lead_journey_connection_no_truncate before truncate on public.lead_journey_connection
  for each statement execute function public.lead_journey_connection_guard();

create function public.lead_journey_connect(
  p_lead_id text, p_axiscare_client_id text, p_axiscare_name text, p_how text,
  p_acting_staff text, p_acting_seat text
) returns jsonb
language plpgsql security invoker as $$
declare
  staff text := nullif(btrim(p_acting_staff), '');
  ax text := nullif(btrim(p_axiscare_client_id), '');
  lid text := nullif(btrim(p_lead_id), '');
  l jsonb; v_ep uuid; v_state text; v_bound uuid; v_person uuid; v_created boolean := false;
  v_case public.client_admission_case%rowtype; v_active uuid; v_name text; r jsonb;
begin
  if p_acting_seat is null or p_acting_seat not in ('client_intake','owner_decision') then return jsonb_build_object('outcome','invalid_seat'); end if;
  if staff is null then return jsonb_build_object('outcome','staff_required'); end if;
  if p_how is null or p_how not in ('typed','convert','confirmed_match') then return jsonb_build_object('outcome','invalid_how'); end if;
  if lid is null or ax is null then return jsonb_build_object('outcome','lead_and_id_required'); end if;
  perform pg_advisory_xact_lock(hashtext('axiscare_client'), hashtext(ax));

  select e into l from public.app_data ad,
         lateral jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end) e
   where ad.key = 'leads' and jsonb_typeof(e) = 'object' and e->>'id' = lid limit 1;
  if l is null then return jsonb_build_object('outcome','lead_not_found'); end if;
  if coalesce(btrim(l->>'axiscare_client_id'), '') <> ax then
    return jsonb_build_object('outcome','lead_id_mismatch',
      'detail','the lead record does not carry this AxisCare id; save it on the lead first');
  end if;

  select s.episode_id, e.state, e.person_id into v_ep, v_state, v_bound
    from public.episode_source s join public.journey_episode e using (episode_id)
   where s.system = 'lead' and s.role = 'origin' and s.source_ref = lid;
  if v_ep is null then return jsonb_build_object('outcome','no_journey','detail','this lead has no Journey yet'); end if;

  select person_id into v_person from public.person_source_id
   where system = 'axiscare' and entity_type = 'client' and source_id = ax limit 1;
  if v_bound is not null then
    if v_bound = v_person then return jsonb_build_object('outcome','already_connected','episode_id', v_ep, 'person_id', v_person); end if;
    return jsonb_build_object('outcome','journey_taken','detail','this lead''s Journey already belongs to someone else');
  end if;
  if v_state <> 'provisional' then
    return jsonb_build_object('outcome','journey_closed','state', v_state); end if;

  select * into v_case from public.client_admission_case where axiscare_client_id = ax and status = 'open';
  if found and v_case.needs_owner_decision and p_acting_seat <> 'owner_decision' then
    return jsonb_build_object('outcome','seat_required','seat','owner_decision','reason', v_case.escalation_reason);
  end if;

  begin
    if v_person is null then
      v_name := coalesce(nullif(btrim(p_axiscare_name), ''),
                         nullif(btrim(concat_ws(' ', l->>'client_first_name', l->>'client_last_name')), ''),
                         nullif(btrim(concat_ws(' ', l->>'first_name', l->>'last_name')), ''), 'AxisCare client ' || ax);
      insert into public.person_identity (display_name) values (v_name) returning id into v_person;
      insert into public.person_source_id (person_id, system, entity_type, source_id, confidence, needs_review, evidence, imported_at)
      values (v_person, 'axiscare', 'client', ax, 'confirmed', false,
              'human-confirmed: ' || staff || ' (' || p_acting_seat || ') connected lead ' || lid || ' to this AxisCare client (' || p_how || ')', now());
      v_created := true;
    end if;
    insert into public.person_role (person_id, role, status)
    select v_person, 'client', 'active'
     where not exists (select 1 from public.person_role where person_id = v_person and role = 'client' and status = 'active');

    if v_case.case_id is not null then
      update public.client_admission_case
         set status = case when v_created then 'confirmed_new' else 'confirmed_existing' end,
             resolved_person_id = v_person, resolved_by = staff, resolved_seat = p_acting_seat, resolved_at = now(),
             resolution_note = 'confirmed through lead ' || lid || ' (' || p_how || ')'
       where case_id = v_case.case_id;
      perform public.client_admission_log(v_case.case_id, ax, 'confirm', staff, p_acting_seat, 'via_lead', v_person::text);
    end if;

    select episode_id into v_active from public.journey_episode
     where person_id = v_person and public.journey_state_is_active(state) limit 1;
    if v_active is not null then
      raise exception 'connect_journey:%', jsonb_build_object('outcome','person_has_active_journey','active_episode_id', v_active,
        'detail','this AxisCare client already has an active Journey; connecting a second one is an Owner / Decision matter')::text;
    end if;
    r := public.episode_resolve(v_ep, v_person, 'unobserved',
           'history before this inquiry was not observed; connected by ' || staff || ' from lead ' || lid,
           'journey_connect', staff, p_acting_seat);
    if r->>'outcome' <> 'resolved' then raise exception 'connect_journey:%', r::text; end if;
    r := public.episode_set_state(v_ep, 'converted', p_workflow => 'journey_connect', p_acting_staff => staff, p_acting_seat => p_acting_seat);
    if r->>'outcome' <> 'state_set' then raise exception 'connect_journey:%', r::text; end if;
    insert into public.lead_journey_connection (episode_id, lead_id, axiscare_client_id, person_id, how, person_created,
                                                admission_case_id, confirmed_by, confirmed_seat)
    values (v_ep, lid, ax, v_person, p_how, v_created, v_case.case_id, staff, p_acting_seat);
    return jsonb_build_object('outcome','connected','episode_id', v_ep, 'person_id', v_person,
                              'person_created', v_created, 'admission_case_closed', v_case.case_id is not null);
  exception when raise_exception then
    if sqlerrm like 'connect_journey:%' then
      return jsonb_build_object('outcome','refused','detail', substr(sqlerrm, 17)::jsonb,
                                'note','nothing was saved; the whole connection was rolled back');
    end if;
    raise;
  end;
end $$;

-- lead mirror: identical to lead-journey-mirror.sql except the marked Lost rule
create or replace function public.lead_journey_mirror(p_commit boolean default false)
returns table (lead_id text, outcome text, detail text)
language plpgsql security invoker as $$
declare
  l jsonb; st text; v_ep uuid; v_state text; v_person uuid; v_began date; r jsonb; v_seen text[] := '{}';
  v_today date := (now() at time zone 'America/Chicago')::date; x record;
begin
  for l in
    select e from public.app_data ad,
           lateral jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end) e
     where ad.key = 'leads' and jsonb_typeof(e) = 'object'
     order by e->>'created_at' nulls last, e->>'id'
  loop
    lead_id := nullif(btrim(l->>'id'), '');
    if lead_id is null then outcome := 'skipped'; detail := 'lead has no id'; return next; continue; end if;
    v_seen := v_seen || lead_id;
    st := lower(coalesce(nullif(btrim(l->>'status'), ''), 'new'));
    v_began := public.lead_inquiry_date(l);
    v_ep := null; v_state := null; v_person := null;
    select s.episode_id, e.state, e.person_id into v_ep, v_state, v_person
      from public.episode_source s join public.journey_episode e using (episode_id)
     where s.system = 'lead' and s.source_ref = lead_id and s.role = 'origin';

    if v_ep is null then
      if not p_commit then
        outcome := 'would_open';
        detail := 'provisional, inquiry ' || coalesce(v_began::text, 'date unknown') || ' · lead ' || st
                  || case when st = 'lost' then ' -> closed as lost' else '' end;
        return next; continue;
      end if;
      begin
        r := public.episode_open_provisional(p_origin_system => 'lead', p_origin_ref => lead_id, p_began_on => v_began,
                                             p_workflow => 'lead_journey_mirror', p_acting_staff => 'lead mirror',
                                             p_acting_seat => 'system');
        if r->>'outcome' <> 'opened' then raise exception 'open: %', r; end if;
        v_ep := (r->>'episode_id')::uuid;
        if st = 'lost' then
          r := public.episode_set_state(v_ep, 'lost', 'observed_window', null, coalesce(v_began, v_today), v_today,
                                        'lead marked Lost in the leads list; seen by the lead mirror on ' || v_today,
                                        'lead_journey_mirror', 'lead mirror', 'system');
          if r->>'outcome' <> 'state_set' then raise exception 'close: %', r; end if;
          outcome := 'opened_lost';
        else
          outcome := 'opened';
        end if;
        detail := 'episode ' || v_ep || ' · inquiry ' || coalesce(v_began::text, 'date unknown');
        return next;
      exception when others then
        outcome := 'error'; detail := sqlerrm; return next;
      end;
      continue;
    end if;

    -- an episode already exists for this lead. Once admission has confirmed it as a
    -- client's Journey, the leads list no longer governs it: a Lost lead is reported, never applied.
    if st = 'lost' and public.journey_state_is_active(v_state) and v_person is not null then
      outcome := 'diverged'; detail := 'the lead is Lost but its Journey belongs to a confirmed client; not touched'; return next;
    elsif st = 'lost' and public.journey_state_is_active(v_state) then
      if not p_commit then outcome := 'would_close'; detail := 'lead is now Lost'; return next; continue; end if;
      begin
        r := public.episode_set_state(v_ep, 'lost', 'observed_window', null, coalesce(v_began, v_today), v_today,
                                      'lead marked Lost in the leads list; seen by the lead mirror on ' || v_today,
                                      'lead_journey_mirror', 'lead mirror', 'system');
        if r->>'outcome' <> 'state_set' then raise exception 'close: %', r; end if;
        outcome := 'closed_lost'; detail := 'episode ' || v_ep; return next;
      exception when others then
        outcome := 'error'; detail := sqlerrm; return next;
      end;
    elsif st <> 'lost' and not public.journey_state_is_active(v_state) then
      outcome := 'diverged'; detail := 'the lead is ' || st || ' again but its episode is ' || v_state; return next;
    else
      outcome := 'unchanged';
      detail := case when st = 'converted' and v_state = 'provisional'
                     then 'converted: waiting for a person to confirm who this is' else v_state end;
      return next;
    end if;
  end loop;

  -- episodes whose lead is no longer in the list: reported, never touched
  for x in select s.source_ref, e.state from public.episode_source s join public.journey_episode e using (episode_id)
            where s.system = 'lead' and s.role = 'origin' and not (s.source_ref = any(v_seen)) loop
    lead_id := x.source_ref; outcome := 'diverged'; detail := 'lead no longer in the leads list (episode ' || x.state || ')';
    return next;
  end loop;
end $$;

alter table public.lead_journey_connection enable row level security;
revoke all on public.lead_journey_connection from public, anon, authenticated, service_role;
grant select on public.lead_journey_connection to authenticated;
grant select, insert on public.lead_journey_connection to service_role;
create policy lead_journey_connection_read on public.lead_journey_connection for select to authenticated using (true);
revoke all on function public.lead_journey_connect(text, text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.lead_journey_connect(text, text, text, text, text, text) to service_role;
revoke all on function public.lead_journey_connection_guard() from public, anon, authenticated, service_role;

do $verify$
begin
  if (select prosecdef from pg_proc where oid = 'public.lead_journey_connect(text,text,text,text,text,text)'::regprocedure)
     or (select prosecdef from pg_proc where oid = 'public.lead_journey_mirror(boolean)'::regprocedure) then
    raise exception 'journey_connect self-check failed: definer'; end if;
  if has_function_privilege('authenticated', 'public.lead_journey_connect(text,text,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.lead_journey_connect(text,text,text,text,text,text)', 'execute')
     or has_table_privilege('authenticated', 'public.lead_journey_connection', 'insert')
     or has_table_privilege('service_role', 'public.lead_journey_connection', 'update')
     or has_table_privilege('anon', 'public.lead_journey_connection', 'select') then
    raise exception 'journey_connect self-check failed: privileges'; end if;
  if position('belongs to a confirmed client' in (select prosrc from pg_proc where oid = 'public.lead_journey_mirror(boolean)'::regprocedure)) = 0 then
    raise exception 'journey_connect self-check failed: lead mirror not replaced'; end if;
end $verify$;

commit;
