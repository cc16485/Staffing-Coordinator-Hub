-- =============================================================================
-- journey-connect-rollback.sql · removes Step 2 ONLY while no connection exists
-- Restores the lead mirror to its original text.
-- =============================================================================
begin;
do $guard$
declare n bigint;
begin
  if to_regclass('public.lead_journey_connection') is not null then
    lock table public.lead_journey_connection in access exclusive mode;
    select count(*) into n from public.lead_journey_connection;
    if n > 0 then raise exception 'rollback refused: % lead connection(s) exist. Nothing was changed.', n; end if;
  end if;
end $guard$;
drop function if exists public.lead_journey_connect(text, text, text, text, text, text);
drop table if exists public.lead_journey_connection;
drop function if exists public.lead_journey_connection_guard();
-- original lead mirror, exactly as lead-journey-mirror.sql defines it
create or replace function public.lead_journey_mirror(p_commit boolean default false)
returns table (lead_id text, outcome text, detail text)
language plpgsql security invoker as $$
declare
  l jsonb; st text; v_ep uuid; v_state text; v_began date; r jsonb; v_seen text[] := '{}';
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
    v_ep := null; v_state := null;
    select s.episode_id, e.state into v_ep, v_state
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

    -- an episode already exists for this lead
    if st = 'lost' and public.journey_state_is_active(v_state) then
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
commit;
