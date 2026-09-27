-- =============================================================================
-- client-status-returning.sql · a returning family's new Journey is kept (One client profile 5b, 2026-09-27)
--
-- Step 5b D lets a person link a returning family's new inquiry to their EXISTING AxisCare record (instead
-- of Convert making a second client). Connecting that inquiry opens their new Journey. When AxisCare later
-- flips them back to Active, Owner / Decision answers "Returning client", which used to open ANOTHER Journey
-- and so was refused. Now: an open / converted Journey already there is kept as the return; the active
-- client role starts as before. An established active Journey still refuses (unchanged, proven rule).
--
-- Replaces client_status_decide only (same signature, same privileges). Nothing else changes; no rows move.
-- =============================================================================
begin;

create or replace function public.client_status_decide(
  p_review_id uuid, p_decision text, p_date date, p_reason text, p_note text, p_staff text, p_seat text
) returns jsonb
language plpgsql security invoker as $$
declare
  staff text := nullif(btrim(p_staff), '');
  v_note text := nullif(btrim(p_note), '');
  rv public.client_status_review%rowtype;
  today date := (now() at time zone 'America/Chicago')::date;
  v_ep uuid; v_state text; r jsonb; v_ended_role boolean := false; v_role_id bigint; v_new_ep uuid; evid text; res jsonb;
begin
  if p_seat is null or p_seat not in ('client_intake','owner_decision') then return jsonb_build_object('outcome','invalid_seat'); end if;
  if staff is null then return jsonb_build_object('outcome','staff_required'); end if;
  if p_decision is null or p_decision not in ('care_ended','on_hold','no_change','returning') then
    return jsonb_build_object('outcome','invalid_decision'); end if;
  select * into rv from public.client_status_review where review_id = p_review_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  perform pg_advisory_xact_lock(hashtext('client_status_person'), hashtext(rv.person_id::text));
  select * into rv from public.client_status_review where review_id = p_review_id for update;
  if rv.status <> 'open' then return jsonb_build_object('outcome','already_decided','decision', rv.decision); end if;

  if p_decision in ('care_ended','returning') then
    if p_date is null or p_date > today or p_date < date '2020-01-01' then
      return jsonb_build_object('outcome','date_required','detail',
        case when p_decision = 'care_ended' then 'the day care ended (not in the future)' else 'the day care resumed (not in the future)' end);
    end if;
  end if;
  if p_decision = 'care_ended' then
    if p_reason is null or p_reason not in ('discharged','facility','moved','deceased','other') then
      return jsonb_build_object('outcome','reason_required'); end if;
    if p_reason = 'other' and v_note is null then return jsonb_build_object('outcome','note_required'); end if;
  end if;
  if p_decision = 'no_change' and v_note is null then return jsonb_build_object('outcome','note_required'); end if;
  if p_decision = 'returning' and p_seat <> 'owner_decision' then
    return jsonb_build_object('outcome','seat_required','seat','owner_decision',
      'detail','opening a returning client''s new Journey is an Owner / Decision matter'); end if;

  evid := 'AxisCare status ' || coalesce(rv.old_label, '?') || ' -> ' || rv.new_label || ' (seen '
          || to_char(rv.observed_at at time zone 'America/Chicago', 'YYYY-MM-DD') || '); confirmed by ' || staff
          || coalesce(': ' || p_reason, '') || coalesce(' · ' || v_note, '');
  begin
    if p_decision = 'care_ended' then
      select episode_id into v_ep from public.journey_episode
       where person_id = rv.person_id and public.journey_state_is_active(state) limit 1;
      if v_ep is not null then
        r := public.episode_set_state(v_ep, 'ended', 'documented', p_date, null, null, evid, 'client_status', staff, p_seat);
        if r->>'outcome' <> 'state_set' then raise exception 'client_status:%', r::text; end if;
      end if;
      update public.person_role set status = 'former', ended_at = p_date,
             end_reason = case p_reason when 'facility' then 'moved to a facility' when 'moved' then 'moved away' else p_reason end,
             updated_at = now()
       where person_id = rv.person_id and role = 'client' and status = 'active';
      v_ended_role := found;
      res := jsonb_build_object('journey_ended', v_ep, 'client_role_ended', v_ended_role);
    elsif p_decision = 'returning' then
      /* 5b (2026-09-27): a returning family's NEW inquiry, linked by a person to their existing AxisCare
         record, already opened their new Journey (open / converted). That Journey is the return: keep it,
         never open a second. An ESTABLISHED active Journey still refuses, exactly as before. */
      select episode_id, state into v_ep, v_state from public.journey_episode
       where person_id = rv.person_id and public.journey_state_is_active(state) limit 1;
      if v_ep is not null and v_state in ('open','converted') then
        v_new_ep := v_ep;
      else
        r := public.episode_open_for_person(rv.person_id, 'established', 'documented', evid, p_date, null, null,
                                             'unobserved', 'returning client confirmed from an AxisCare status change', null,
                                             'client_status', staff, p_seat);
        if r->>'outcome' <> 'opened' then raise exception 'client_status:%', r::text; end if;
        v_new_ep := (r->>'episode_id')::uuid;
      end if;
      if not exists (select 1 from public.person_role where person_id = rv.person_id and role = 'client' and status = 'active') then
        insert into public.person_role (person_id, role, status, started_at) values (rv.person_id, 'client', 'active', p_date)
        returning id into v_role_id;
      end if;
      res := jsonb_build_object('journey_opened', v_new_ep, 'journey_already_open', coalesce(v_new_ep = v_ep, false), 'client_role_started', v_role_id is not null);
    else
      res := '{}'::jsonb;
    end if;
    update public.client_status_review
       set status = 'decided', decision = p_decision, decided_on = case when p_decision in ('care_ended','returning') then p_date end,
           reason = case when p_decision = 'care_ended' then p_reason end, note = v_note, decided_by = staff, decided_seat = p_seat,
           decided_at = now(), result = res
     where review_id = p_review_id;
  exception when raise_exception then
    if sqlerrm like 'client_status:%' then
      return jsonb_build_object('outcome','refused','detail', substr(sqlerrm, 15)::jsonb, 'note','nothing was saved');
    end if;
    raise;
  end;
  return jsonb_build_object('outcome','decided','decision', p_decision) || res;
end $$;

revoke all on function public.client_status_decide(uuid, text, date, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.client_status_decide(uuid, text, date, text, text, text, text) to service_role;

do $verify$
begin
  if (select prosecdef from pg_proc where proname = 'client_status_decide') then
    raise exception 'client-status-returning self-check failed: definer'; end if;
  if has_function_privilege('authenticated', 'public.client_status_decide(uuid,text,date,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.client_status_decide(uuid,text,date,text,text,text,text)', 'execute') then
    raise exception 'client-status-returning self-check failed: privileges'; end if;
  if position('journey_already_open' in (select prosrc from pg_proc where proname = 'client_status_decide')) = 0 then
    raise exception 'client-status-returning self-check failed: not the new version'; end if;
end $verify$;

commit;
