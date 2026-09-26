-- =============================================================================
-- lead-journey-mirror.sql · inquiries open provisional Journey episodes
--
-- ONE-WAY and non-authoritative: app_data.leads stays the authority and is only
-- READ. Each lead opens exactly one provisional episode through the
-- episode_open_provisional Door (origin = the lead id, begin = the inquiry date,
-- documented). A lead marked Lost closes its episode as "lost" with an honest
-- observed window (between the inquiry and the day the mirror saw it lost).
-- No person is ever resolved here: identity stays a human decision.
-- A lead deleted from the list, or un-lost after its episode closed, is reported
-- as "diverged" and left alone.
--
--   lead_journey_mirror(false|true)    dry run / mirror; each lead is its own unit
--   lead_journey_parity                view: leads vs their episodes
--   lead_journey_mirror_run            append-only run log
--   lead_journey_mirror_scheduled()    what the schedule calls (no overlap; failures logged)
-- GUARD: refuses if the run log already holds rows.
-- =============================================================================
begin;

do $guard$
declare n bigint;
begin
  if to_regclass('public.lead_journey_mirror_run') is not null then
    lock table public.lead_journey_mirror_run in access exclusive mode;
    select count(*) into n from public.lead_journey_mirror_run;
    if n > 0 then raise exception 'lead_journey_mirror refused: lead_journey_mirror_run contains % row(s). Nothing was changed.', n; end if;
  end if;
end $guard$;

drop function if exists public.lead_journey_mirror_scheduled(text);
drop table if exists public.lead_journey_mirror_run;
drop view if exists public.lead_journey_parity;
drop function if exists public.lead_journey_mirror(boolean);
drop function if exists public.lead_journey_run_guard();
drop function if exists public.lead_inquiry_date(jsonb);

-- the inquiry date in Central time, or null when created_at is missing or unreadable
create function public.lead_inquiry_date(p_lead jsonb) returns date
language plpgsql stable as $$
begin
  if coalesce(p_lead->>'created_at', '') !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return ((p_lead->>'created_at')::timestamptz at time zone 'America/Chicago')::date;
exception when others then return null;
end $$;

create function public.lead_journey_mirror(p_commit boolean default false)
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

create view public.lead_journey_parity with (security_invoker = true) as
with ld as (
  select nullif(btrim(e->>'id'), '') as lead_id, lower(coalesce(nullif(btrim(e->>'status'), ''), 'new')) as st,
         public.lead_inquiry_date(e) as inquiry
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
            else (ld.st = 'lost') = (ep.state = 'lost') end as state_match,
       case when ld.lead_id is null or ep.episode_id is null then null
            else ld.inquiry is not distinct from (case when ep.began_lo = '-infinity'::date then null else ep.began_lo end) end as began_match
  from ld full join ep using (lead_id);

create table public.lead_journey_mirror_run (
  run_id           bigserial primary key,
  started_at       timestamptz not null,
  finished_at      timestamptz not null default now(),
  trigger_source   text not null check (trigger_source in ('schedule','manual')),
  outcome          text not null check (outcome in ('ok','errors','failed','skipped_busy')),
  leads_seen       int, opened int, closed int, unchanged int, diverged int, errors int, skipped int,
  episodes_written int, facts_written int,
  parity_mismatches int, leads_without_episode int,
  leads_unchanged  boolean,
  detail           text
);
comment on table public.lead_journey_mirror_run is 'lead_journey_mirror v1 · one append-only row per lead mirror run';

create function public.lead_journey_run_guard() returns trigger language plpgsql as $$
begin raise exception 'lead_journey_mirror_run is append-only (% refused)', tg_op; end $$;
create trigger lead_journey_run_append_only_t before update or delete on public.lead_journey_mirror_run
  for each row execute function public.lead_journey_run_guard();
create trigger lead_journey_run_no_truncate before truncate on public.lead_journey_mirror_run
  for each statement execute function public.lead_journey_run_guard();

create function public.lead_journey_mirror_scheduled(p_trigger text default 'schedule') returns jsonb
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

alter table public.lead_journey_mirror_run enable row level security;
revoke all on public.lead_journey_mirror_run from public, anon, authenticated, service_role;
revoke all on sequence public.lead_journey_mirror_run_run_id_seq from public, anon, authenticated, service_role;
revoke all on public.lead_journey_parity from public, anon, authenticated, service_role;
grant select on public.lead_journey_mirror_run to authenticated;
grant select, insert on public.lead_journey_mirror_run to service_role;
grant usage, select on sequence public.lead_journey_mirror_run_run_id_seq to service_role;
grant select on public.lead_journey_parity to service_role;
create policy lead_journey_mirror_run_read on public.lead_journey_mirror_run for select to authenticated using (true);
revoke all on function public.lead_journey_mirror(boolean) from public, anon, authenticated, service_role;
revoke all on function public.lead_journey_mirror_scheduled(text) from public, anon, authenticated, service_role;
revoke all on function public.lead_journey_run_guard() from public, anon, authenticated, service_role;
revoke all on function public.lead_inquiry_date(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.lead_journey_mirror(boolean) to service_role;
grant execute on function public.lead_journey_mirror_scheduled(text) to service_role;
grant execute on function public.lead_inquiry_date(jsonb) to service_role;

do $verify$
declare f text;
begin
  foreach f in array array['public.lead_journey_mirror(boolean)','public.lead_journey_mirror_scheduled(text)'] loop
    if (select prosecdef from pg_proc where oid = f::regprocedure) then raise exception 'lead_journey_mirror self-check failed: definer %', f; end if;
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'lead_journey_mirror self-check failed: browser can execute %', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.lead_journey_mirror_run', 'insert')
     or has_table_privilege('service_role', 'public.lead_journey_mirror_run', 'update')
     or has_table_privilege('service_role', 'public.lead_journey_mirror_run', 'delete')
     or has_table_privilege('anon', 'public.lead_journey_mirror_run', 'select') then
    raise exception 'lead_journey_mirror self-check failed: run log privileges'; end if;
end $verify$;

commit;
