-- =============================================================================
-- lead-journey-spam.sql · a spam inquiry's Journey is voided (Lead numbers S1, approved 2026-09-28)
--
-- "Mark as spam" (a website submission that was not a real inquiry) stores lead.spam = {at, by, note, before}
-- and sets the lead Lost + archived + do-not-contact. The lead mirror then:
--   - never opens a Journey for a lead already marked spam
--   - holds an EMPTY Journey (provisional, no person confirmed) open for 7 days after the mark, so "Not spam"
--     can undo a mistake (a voided Journey is final; a lost one can't be voided, so it is not closed as lost)
--   - then voids it through episode_void, the foundation's own door (workflow 'lead_spam')
--   - reports a confirmed client's Journey and leaves it alone
-- Always on (her approval); the folding rule keeps its own switch. Replaces lead_journey_mirror (the
-- lead-journey-fold.sql version, one addition), lead_journey_mirror_scheduled (counts the new outcomes) and the
-- parity view (a spam inquiry matches while waiting or voided). No table changes.
-- =============================================================================
begin;

do $guard$ begin
  if to_regprocedure('public.lead_fold_intent(jsonb)') is null
     or position('lead_fold_live' in (select prosrc from pg_proc where oid = 'public.lead_journey_mirror(boolean)'::regprocedure)) = 0 then
    raise exception 'lead_journey_spam refused: the duplicate-folding version of the lead mirror is not installed. Nothing was changed.'; end if;
  if position('lead_spam' in (select prosrc from pg_proc where oid = 'public.lead_journey_mirror(boolean)'::regprocedure)) > 0 then
    raise exception 'lead_journey_spam refused: already installed. Nothing was changed.'; end if;
end $guard$;

create or replace function public.lead_journey_mirror(p_commit boolean default false)
returns table (lead_id text, outcome text, detail text)
language plpgsql security invoker as $$
declare
  l jsonb; st text; v_ep uuid; v_state text; v_person uuid; v_began date; r jsonb; v_seen text[] := '{}';
  v_fold jsonb; v_live boolean; v_target uuid; v_why text; v_spam_at timestamptz;
  v_today date := (now() at time zone 'America/Chicago')::date; x record;
begin
  /* 5b F (2026-09-27): folding is off until Owner / Decision switches it on (Desktop 265) */
  select coalesce((data->>'lead_fold_live')::boolean, false) into v_live
    from public.app_data where key = 'ops_settings' and jsonb_typeof(data) = 'object';
  v_live := coalesce(v_live, false);
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

    /* Lead numbers S1 (2026-09-28): a person marked this inquiry as spam (not a real inquiry). Its Journey
       should not exist at all: none is opened; an EMPTY one (provisional, no person confirmed) is voided,
       but only a week after the mark, so "Not spam" can undo a mistake first (a voided Journey is final,
       and a lost one can't be voided, so it is never closed as lost meanwhile). A confirmed client's
       Journey is reported and left alone. */
    if jsonb_typeof(l->'spam') = 'object' and nullif(btrim(coalesce(l->'spam'->>'at','')), '') is not null then
      begin v_spam_at := (l->'spam'->>'at')::timestamptz; exception when others then v_spam_at := now(); end;
      v_why := 'marked spam (not a real inquiry)';
      if v_ep is null then
        outcome := 'spam_skipped'; detail := v_why || '; no Journey opened'; return next; continue;
      elsif v_state = 'voided' then
        outcome := 'unchanged'; detail := v_why || ' (voided)'; return next; continue;
      elsif v_state = 'provisional' and v_person is null then
        if v_spam_at > now() - interval '7 days' then
          outcome := 'spam_waiting'; detail := v_why || '; its Journey is voided a week after the mark, so a mistake can be undone first';
          return next; continue;
        end if;
        if not p_commit then outcome := 'would_void'; detail := v_why; return next; continue; end if;
        begin
          r := public.episode_void(v_ep, v_why || ' (a person marked it; seen by the lead mirror on ' || v_today || ')', null,
                                   'lead_spam', 'lead mirror', 'system');
          if r->>'outcome' <> 'voided' then raise exception 'void: %', r; end if;
          outcome := 'voided'; detail := 'episode ' || v_ep || ' (spam)'; return next;
        exception when others then
          outcome := 'error'; detail := sqlerrm; return next;
        end;
        continue;
      elsif public.journey_state_is_active(v_state) then
        outcome := 'diverged'; detail := v_why || ', but its Journey belongs to a confirmed client (' || v_state || '); not touched, Owner / Decision'; return next; continue;
      else
        outcome := 'unchanged'; detail := v_why || ' (' || v_state || '; it was closed before it was marked spam)'; return next; continue;
      end if;
    end if;

    /* 5b F: a person folded this inquiry into another (Mark as duplicate, or "Fold into" on the
       same-family question). Its Journey should never have been a separate one: an EMPTY one (no person
       confirmed) is voided and points at the Journey kept; none is opened for it; anything else is
       reported and left alone. */
    v_fold := public.lead_fold_intent(l);
    if v_live and v_fold is not null then
      v_why := 'folded into ' || case when v_fold->>'kind' = 'client' then 'AxisCare client #' || (v_fold->>'ref')
                                      else 'inquiry ' || (v_fold->>'ref') end;
      if v_ep is null then
        outcome := 'fold_skipped'; detail := v_why || '; no Journey opened'; return next; continue;
      elsif v_state = 'voided' then
        outcome := 'unchanged'; detail := v_why || ' (voided)'; return next; continue;
      elsif v_state = 'provisional' and v_person is null then
        v_target := public.lead_fold_target(v_fold);
        if v_target = v_ep then v_target := null; end if;
        if not p_commit then
          outcome := 'would_void'; detail := v_why || case when v_target is null then '; no active Journey to point at' else '; points at episode ' || v_target end;
          return next; continue;
        end if;
        begin
          r := public.episode_void(v_ep, v_why || ' (a person marked it; seen by the lead mirror on ' || v_today || ')', v_target,
                                   'lead_fold', 'lead mirror', 'system');
          if r->>'outcome' <> 'voided' then raise exception 'void: %', r; end if;
          outcome := 'voided'; detail := 'episode ' || v_ep || coalesce(' -> ' || v_target, ''); return next;
        exception when others then
          outcome := 'error'; detail := sqlerrm; return next;
        end;
        continue;
      elsif public.journey_state_is_active(v_state) then
        outcome := 'diverged'; detail := v_why || ', but its Journey is not empty (' || v_state || '); not touched, Owner / Decision'; return next; continue;
      else
        outcome := 'unchanged'; detail := v_why || ' (' || v_state || ')'; return next; continue;
      end if;
    end if;

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

-- the scheduled run: identical except it counts voided (as closed) and fold_skipped (as skipped)
create or replace function public.lead_journey_mirror_scheduled(p_trigger text default 'schedule') returns jsonb
language plpgsql security invoker as $$
declare
  t0 timestamptz := clock_timestamp(); md0 text; md1 text; e0 int; f0 int; o record;
  c_seen int := 0; c_o int := 0; c_c int := 0; c_u int := 0; c_d int := 0; c_e int := 0; c_s int := 0;
  errs text[] := '{}'; v_row public.lead_journey_mirror_run%rowtype;
begin
  if p_trigger not in ('schedule','manual') then raise exception 'unknown trigger %', p_trigger; end if;
  if not pg_try_advisory_xact_lock(hashtext('lead_journey_mirror')) then
    insert into public.lead_journey_mirror_run (started_at, trigger_source, outcome, detail)
    values (t0, p_trigger, 'skipped_busy', 'another lead mirror run was in progress') returning * into v_row;
    return to_jsonb(v_row);
  end if;
  select md5(data::text) into md0 from public.app_data where key = 'leads';
  select count(*) into e0 from public.journey_episode; select count(*) into f0 from public.episode_fact;
  begin
    for o in select * from public.lead_journey_mirror(true) loop
      if o.outcome <> 'diverged' or o.detail not like 'lead no longer%' then c_seen := c_seen + 1; end if;
      case o.outcome
        when 'opened' then c_o := c_o + 1; when 'opened_lost' then c_o := c_o + 1; c_c := c_c + 1;
        when 'closed_lost' then c_c := c_c + 1; when 'unchanged' then c_u := c_u + 1;
        when 'voided' then c_c := c_c + 1; when 'fold_skipped' then c_s := c_s + 1;
        when 'spam_skipped' then c_s := c_s + 1; when 'spam_waiting' then c_u := c_u + 1;
        when 'diverged' then c_d := c_d + 1; when 'skipped' then c_s := c_s + 1;
        else c_e := c_e + 1; errs := errs || (o.lead_id || ': ' || o.detail);
      end case;
    end loop;
  exception when others then
    insert into public.lead_journey_mirror_run (started_at, trigger_source, outcome, detail)
    values (t0, p_trigger, 'failed', 'mirror did not run: ' || sqlerrm) returning * into v_row;
    return to_jsonb(v_row);
  end;
  select md5(data::text) into md1 from public.app_data where key = 'leads';
  insert into public.lead_journey_mirror_run (started_at, trigger_source, outcome, leads_seen, opened, closed, unchanged,
                                              diverged, errors, skipped, episodes_written, facts_written,
                                              parity_mismatches, leads_without_episode, leads_unchanged, detail)
  values (t0, p_trigger, case when c_e > 0 then 'errors' else 'ok' end, c_seen, c_o, c_c, c_u, c_d, c_e, c_s,
          (select count(*) from public.journey_episode) - e0, (select count(*) from public.episode_fact) - f0,
          (select count(*) from public.lead_journey_parity p where p.state_match is false or p.began_match is false),
          (select count(*) from public.lead_journey_parity p where p.episode_state = 'no episode'),
          md0 is not distinct from md1, nullif(left(array_to_string(errs, ' | '), 2000), ''))
  returning * into v_row;
  return to_jsonb(v_row);
end $$;
-- parity: a folded inquiry whose Journey was voided matches
create or replace view public.lead_journey_parity with (security_invoker = true) as
with ld as (
  select nullif(btrim(e->>'id'), '') as lead_id, lower(coalesce(nullif(btrim(e->>'status'), ''), 'new')) as st,
         public.lead_inquiry_date(e) as inquiry,
         public.lead_fold_intent(e) is not null as folded,
         (jsonb_typeof(e->'spam') = 'object' and nullif(btrim(coalesce(e->'spam'->>'at','')), '') is not null) as spam
    from public.app_data ad,
         lateral jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end) e
   where ad.key = 'leads' and jsonb_typeof(e) = 'object' and nullif(btrim(e->>'id'), '') is not null
),
ep as (
  select s.source_ref as lead_id, e.episode_id, e.state, r.began_lo
    from public.episode_source s join public.journey_episode e using (episode_id)
    join public.episode_range r using (episode_id)
   where s.system = 'lead' and s.role = 'origin'
)
select coalesce(ld.lead_id, ep.lead_id) as lead_id,
       coalesce(ld.st, '(not in leads list)') as lead_status,
       coalesce(ep.state, 'no episode') as episode_state,
       case when ld.lead_id is null or ep.episode_id is null then null
            when ld.folded and ep.state = 'voided' then true
            when ld.spam and ep.state in ('voided','provisional') then true
            else (ld.st = 'lost') = (ep.state = 'lost') end as state_match,
       case when ld.lead_id is null or ep.episode_id is null then null
            else ld.inquiry is not distinct from (case when ep.began_lo = '-infinity'::date then null else ep.began_lo end) end as began_match
  from ld full join ep using (lead_id);

revoke all on function public.lead_journey_mirror(boolean) from public, anon, authenticated, service_role;
revoke all on function public.lead_journey_mirror_scheduled(text) from public, anon, authenticated, service_role;
grant execute on function public.lead_journey_mirror(boolean) to service_role;
grant execute on function public.lead_journey_mirror_scheduled(text) to service_role;
revoke all on public.lead_journey_parity from public, anon, authenticated, service_role;
grant select on public.lead_journey_parity to service_role;

do $verify$
declare f text;
begin
  foreach f in array array['public.lead_journey_mirror(boolean)','public.lead_journey_mirror_scheduled(text)'] loop
    if (select prosecdef from pg_proc where oid = f::regprocedure) then raise exception 'lead_journey_spam self-check failed: definer %', f; end if;
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'lead_journey_spam self-check failed: browser can execute %', f; end if;
  end loop;
  if position('lead_spam' in (select prosrc from pg_proc where oid = 'public.lead_journey_mirror(boolean)'::regprocedure)) = 0
     or position('lead_fold_live' in (select prosrc from pg_proc where oid = 'public.lead_journey_mirror(boolean)'::regprocedure)) = 0
     or position('spam_waiting' in (select prosrc from pg_proc where oid = 'public.lead_journey_mirror_scheduled(text)'::regprocedure)) = 0 then
    raise exception 'lead_journey_spam self-check failed: not the new version'; end if;
  raise notice 'lead_journey_spam installed: spam inquiries never get a Journey; an empty one is voided a week after the mark';
end $verify$;

commit;
