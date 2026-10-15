-- 750 · ONE "CARE BEGAN" RULE (CRM plan step A, Samantha 2026-10-15, "yes to all 10": care began = the first AxisCare visit
-- with a clock-in and a clock-out, or a hand record with a reason). care_began_for_episode stops counting the "first shift
-- completed" checkbox on the First shift checklist. Everything else in the function is unchanged (client-fact-care-began-fix.sql).
-- 749 (read only, 2026-10-15) found no first shift recorded anywhere, so no client's answer changes today.
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
      select q.id
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
      end if;
      -- CRM plan step A (Samantha 2026-10-15): the "first shift completed" checkbox on the First shift checklist no longer
      -- counts (a tick with no clock-out and no reason). Care began = AxisCare's first completed visit, or a hand record.
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
    raise exception '750 self-check: the rule became reachable from a browser'; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'care_began_for_episode' and p.prosrc like '%first_shift_done%') then
    raise exception '750 self-check: the checkbox still counts'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'care_began_for_episode' and p.prosecdef and p.prosrc like '%did not start from an inquiry%') then
    raise exception '750 self-check: the rule is not in place'; end if;
  raise notice '750: care began = AxisCare''s first completed visit or a hand record';
end $verify$;

commit;
