-- =============================================================================
-- GATE 2a FIX · "has care begun" must not read an inquiry's date as care (2026-09-28)
-- =============================================================================
-- Found by Desktop 294's live count (38 of 38 Journeys "had begun care"): a Journey that
-- started from an inquiry records the INQUIRY date as its beginning (the lead mirror opens it
-- with the inquiry date). Rule 2 now applies only to Journeys that did not start from an
-- inquiry. Rule 1 (an actual start on the First shift checklist) is unchanged.
-- Replaces one function; its grants are kept. No table or fact changes.
-- =============================================================================
begin;

create or replace function public.care_began_for_episode(p_episode_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $f$
declare
  v_person uuid; v_since date; v_best date; v_basis text; r record; v_hand date; v_ax date; e record;
begin
  select person_id into v_person from public.journey_episode where episode_id = p_episode_id;
  if not found then return jsonb_build_object('began', false, 'reason', 'no_such_episode'); end if;
  -- when this inquiry began: its origin lead's date, else the episode's record date
  select public.lead_inquiry_date(x) into v_since
    from public.episode_source s
    join public.app_data a on a.key = 'leads'
    cross join lateral jsonb_array_elements(a.data) x
   where s.episode_id = p_episode_id and s.system = 'lead' and s.role = 'origin' and x->>'id' = s.source_ref
   limit 1;
  if v_since is null then select (created_at at time zone 'America/Chicago')::date into v_since from public.journey_episode where episode_id = p_episode_id; end if;
  if v_person is not null then
    for r in
      select q.id, q.first_shift_done, q.first_shift_done_at
        from public.client_queue q
        join public.person_source_id ps on ps.system = 'axiscare' and ps.entity_type = 'client' and ps.source_id = q.axiscare_client_id
       where ps.person_id = v_person and (q.added_at is null or (q.added_at at time zone 'America/Chicago')::date >= v_since)
    loop
      select (evidence->>'date')::date into v_hand from public.launch_evidence
       where launch_id = r.id and fact = 'first_shift' and source = 'person' and coalesce(evidence->>'date','') ~ '^\d{4}-\d{2}-\d{2}$'
       order by 1 limit 1;
      select coalesce(nullif(evidence->>'clock_in_date','')::date, ((nullif(coalesce(evidence->>'clock_in_at', evidence->>'at'),''))::timestamptz at time zone 'America/Chicago')::date)
        into v_ax from public.launch_evidence
       where launch_id = r.id and fact = 'first_shift' and source = 'axiscare' limit 1;
      if v_hand is not null then
        if v_best is null or v_hand < v_best then v_best := v_hand; v_basis := 'recorded by hand'; end if;
      elsif v_ax is not null then
        if v_best is null or v_ax < v_best then v_best := v_ax; v_basis := 'AxisCare''s first clock-in'; end if;
      elsif r.first_shift_done and r.first_shift_done_at is not null then
        if v_best is null or (r.first_shift_done_at at time zone 'America/Chicago')::date < v_best then
          v_best := (r.first_shift_done_at at time zone 'America/Chicago')::date; v_basis := '"first shift completed" on the checklist'; end if;
      end if;
      v_hand := null; v_ax := null;
    end loop;
  end if;
  if v_best is not null then return jsonb_build_object('began', true, 'on', v_best, 'basis', v_basis); end if;
  -- 2 · the Journey's recorded beginning, ONLY for a Journey that did not start from an inquiry
  --     (a client already in care when observed, or admitted with no inquiry). An inquiry's Journey
  --     records the INQUIRY date as its beginning, which is not when care began.
  if exists (select 1 from public.episode_source s where s.episode_id = p_episode_id and s.system = 'lead' and s.role = 'origin') then
    return jsonb_build_object('began', false);
  end if;
  select began_basis, began_lo, began_hi into e from public.episode_range where episode_id = p_episode_id;
  if e.began_basis in ('documented','observed_window','before_observation') then
    return jsonb_build_object('began', true, 'on', coalesce(e.began_lo, e.began_hi), 'basis', 'the Journey (' || e.began_basis || ')');
  end if;
  return jsonb_build_object('began', false);
exception when others then
  return jsonb_build_object('began', null, 'reason', 'could_not_check');
end $f$;

do $verify$
begin
  if has_function_privilege('authenticated', 'public.care_began_for_episode(uuid)', 'execute')
     or has_function_privilege('anon', 'public.care_began_for_episode(uuid)', 'execute') then
    raise exception 'care-began fix self-check: the rule became reachable from a browser'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'care_began_for_episode' and p.prosecdef
                    and p.prosrc like '%did not start from an inquiry%') then
    raise exception 'care-began fix self-check: the new rule is not in place'; end if;
  raise notice 'care-began rule fixed: an inquiry''s own date no longer counts as care';
end $verify$;

commit;
