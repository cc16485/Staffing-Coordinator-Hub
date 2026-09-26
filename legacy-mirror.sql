-- =============================================================================
-- legacy-mirror.sql · Stage 3 shadow: coverage_cases -> canonical staffing objects
--
-- ONE-WAY and non-authoritative. app_data.coverage_cases stays the only
-- authority and is only READ. The canonical objects are written ONLY through the
-- staffing Doors, as the legacy_mirror seat, with each legacy record's id as its
-- origin reference, so every run is idempotent and re-runs pick up changes.
--
--   legacy_mirror_coverage(false)  dry run: what it would do; writes nothing
--   legacy_mirror_coverage(true)   mirrors; each case is its own unit (a failure
--                                  rolls back that case only and is reported)
--
-- Nothing is guessed. A case is left UNMAPPED, with the reason, when it has no
-- AxisCare client id, the client has no Hub person or active Journey episode,
-- the shift time is not HH:MM-HH:MM, it is a new-client interest check, it spans
-- several weekdays, or its visit already backs another OPEN case's need.
-- Only ongoing-sweep cases (cwo_) become recurring needs; every visit case is dated. Unconfirmed
-- Cara flags are skipped. A legacy reply whose original answer was overwritten
-- by a closing text is recorded as "unclear", never inferred.
-- =============================================================================
begin;

create or replace function public.legacy_mirror_coverage(p_commit boolean default false)
returns table (case_id text, outcome text, detail text)
language plpgsql security invoker as $$
declare
  c jsonb; a jsonb; m text[]; st text; v_person uuid; v_ep uuid; v_kind text; v_date date; v_wd text;
  v_start time; v_end time; v_visit text; v_need uuid; v_need_state text; r jsonb; v_ask uuid; v_cls text;
  v_raw text; v_cur_id uuid; v_cur_cls text; v_asg uuid; v_basis uuid; v_name text; v_chan text; v_sent timestamptz;
  v_recv timestamptz; v_origin text; v_close text; n_ask int; n_rep int; n_asg int; notes text[]; v_days text[];
  v_daymap constant jsonb := '{"monday":"mon","tuesday":"tue","wednesday":"wed","thursday":"thu","friday":"fri","saturday":"sat","sunday":"sun"}';
begin
  for c in
    select e from public.app_data ad,
           lateral jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end) e
     where ad.key = 'coverage_cases' and jsonb_typeof(e) = 'object'
     order by e->>'opened_at' nulls last, e->>'id'
  loop
    case_id := c->>'id';
    if case_id is null then continue; end if;
    st := coalesce(nullif(c->>'status', ''), 'open');

    -- ---- eligibility (identical in dry run and commit) ---------------------
    if st = 'flagged' then outcome := 'skipped'; detail := 'unconfirmed Cara flag, not a confirmed need'; return next; continue; end if;
    if c->>'kind' = 'interest' or c->>'reason' = 'new' then
      outcome := 'unmapped'; detail := 'new-client interest check: no Journey episode yet (Team Build step)'; return next; continue;
    end if;
    if nullif(c->>'client_axiscare_id', '') is null then
      outcome := 'unmapped'; detail := 'no AxisCare client id on the case'; return next; continue;
    end if;
    select p.person_id into v_person from public.person_source_id p
     where p.system = 'axiscare' and p.entity_type = 'client' and p.source_id = c->>'client_axiscare_id';
    if v_person is null then
      outcome := 'unmapped'; detail := 'AxisCare client ' || (c->>'client_axiscare_id') || ' is not linked to a Hub person'; return next; continue;
    end if;
    select e.episode_id into v_ep from public.journey_episode e
     where e.person_id = v_person and public.journey_state_is_active(e.state);
    if v_ep is null then outcome := 'unmapped'; detail := 'no active Journey episode for this client'; return next; continue; end if;
    m := regexp_match(coalesce(c->>'shift_time', ''), '^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$');
    if m is null then
      outcome := 'unmapped'; detail := 'shift time is not HH:MM-HH:MM (' || coalesce(nullif(c->>'shift_time', ''), 'blank') || ')';
      return next; continue;
    end if;
    v_start := m[1]::time; v_end := m[2]::time;
    v_visit := null; v_date := null; v_wd := null;
    -- only ongoing-sweep cases (cwo_) stand for a whole schedule; a visit case stays a dated need even when
    -- the watcher's shift_pattern says the visit's schedule has other open dates
    if case_id like 'cwo\_%' then
      select array_agg(distinct v_daymap->>lower(btrim(x))) into v_days
        from unnest(string_to_array(coalesce(c#>>'{shift_pattern,weekday}', ''), '/')) x where v_daymap ? lower(btrim(x));
      if v_days is null or array_length(v_days, 1) is null then
        outcome := 'unmapped'; detail := 'ongoing case with no recognisable weekday'; return next; continue;
      end if;
      if array_length(v_days, 1) > 1 then
        outcome := 'unmapped'; detail := 'ongoing case spans several weekdays (' || (c#>>'{shift_pattern,weekday}') || '): a person splits it into needs';
        return next; continue;
      end if;
      v_kind := 'recurring_slot'; v_wd := v_days[1];
    else
      if coalesce(c->>'shift_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
        outcome := 'unmapped'; detail := 'no shift date'; return next; continue;
      end if;
      v_kind := 'dated_shift'; v_date := (c->>'shift_date')::date;
      if coalesce(c->>'axiscare_visit_id', '') ~ '^s=[^:]+:d=\d{4}-\d{2}-\d{2}$' then v_visit := c->>'axiscare_visit_id'; end if;
    end if;
    v_close := case when st = 'dismissed' then 'cancelled'
                    when st in ('done','resolved') and c->>'resolved_how' = 'uncovered' then 'shift_passed'
                    when st in ('done','resolved') then 'covered' end;

    if not p_commit then
      outcome := 'would_mirror';
      detail := v_kind || ' ' || coalesce(v_date::text, v_wd) || ' ' || to_char(v_start, 'HH24:MI') || '-' || to_char(v_end, 'HH24:MI')
                || ' · ' || jsonb_array_length(coalesce(c->'asked', '[]'::jsonb)) || ' ask(s)'
                || case when nullif(c->>'covered_by', '') is not null then ' · covered (named)' else '' end
                || ' · legacy ' || st || coalesce(' -> need closed as ' || v_close, '');
      return next; continue;
    end if;

    -- ---- commit: this case is one unit ---------------------------------------
    begin
      n_ask := 0; n_rep := 0; n_asg := 0; notes := '{}';
      r := public.staffing_need_open(
             p_episode_id => v_ep, p_kind => v_kind, p_start_time => v_start, p_end_time => v_end,
             p_acting_staff => 'legacy mirror', p_acting_seat => 'legacy_mirror',
             p_shift_date => v_date, p_weekday => v_wd, p_axiscare_visit_ref => v_visit,
             p_note => 'mirrored from coverage case ' || case_id || coalesce('; legacy opened ' || (c->>'opened_at'), ''),
             p_origin_system => 'coverage_case', p_origin_ref => case_id);
      if r->>'outcome' = 'conflict' then raise exception 'DUPLICATE_VISIT %', r->>'need_id'; end if;
      if r->>'outcome' not in ('opened','already_recorded') then raise exception 'need: %', r; end if;
      v_need := (r->>'need_id')::uuid;
      select n.state into v_need_state from public.staffing_need n where n.need_id = v_need;
      if v_need_state = 'closed' and v_close is null then
        raise exception 'DIVERGED the legacy case is open again but its mirrored need is closed';
      end if;
      if v_close is not null and v_need_state = 'open' then       -- close first: history then arrives closed
        r := public.staffing_need_close(v_need, v_close, 'legacy mirror', 'legacy_mirror');
        if r->>'outcome' <> 'closed' then raise exception 'close: %', r; end if;
      end if;

      for a in select x from jsonb_array_elements(coalesce(c->'asked', '[]'::jsonb)) x where jsonb_typeof(x) = 'object' loop
        v_name := coalesce(nullif(btrim(a->>'name'), ''), '(unnamed caregiver)');
        v_chan := case when lower(coalesce(a->>'channel', '')) in ('sms','text','texted','txt') then 'sms'
                       when lower(coalesce(a->>'channel', '')) like '%call%' then 'call'
                       when lower(coalesce(a->>'channel', '')) like '%axis%' then 'axiscare_app'
                       when coalesce(a->>'channel', '') = '' and (a->>'auto' = 'true' or a->>'picked_by_coordinator' = 'true') then 'sms'
                       else 'other' end;
        v_sent := coalesce(nullif(a->>'at', '')::timestamptz, nullif(c->>'opened_at', '')::timestamptz, now());
        r := public.staffing_ask_record(
               p_need_id => v_need, p_caregiver_name => v_name, p_channel => v_chan,
               p_message_status => 'not_retained_legacy', p_sent_at => v_sent,
               p_sender => case when a->>'auto' = 'true' then 'coverage-run' else 'hub' end,
               p_acting_staff => 'legacy mirror', p_acting_seat => 'legacy_mirror',
               p_caregiver_axiscare_id => nullif(a->>'axiscare_id', ''), p_ghl_contact_id => nullif(a->>'ghl_contact_id', ''),
               p_origin_system => 'coverage_case', p_origin_ref => case_id || ':' || coalesce(a->>'id', md5(a::text)));
        if r->>'outcome' = 'already_asked' then notes := notes || ('repeat ask to ' || v_name || ' not mirrored'); continue; end if;
        if r->>'outcome' not in ('recorded','already_recorded') then raise exception 'ask: %', r; end if;
        if r->>'outcome' = 'recorded' then n_ask := n_ask + 1; end if;
        v_ask := (r->>'ask_id')::uuid;

        v_cls := case a->>'state' when 'yes' then 'yes' when 'no' then 'no' when 'inquiry' then 'question'
                                  when 'noanswer' then 'no_answer' when 'no_answer_final' then 'no_answer'
                                  when 'closed_notified' then case when a->>'was_yes' = 'true' then 'yes'
                                                                   when nullif(a->>'replied_at', '') is not null then 'unclear' end
                                  when 'closed_silent' then case when a->>'was_yes' = 'true' then 'yes'
                                                                 when nullif(a->>'replied_at', '') is not null then 'unclear' end
                 end;
        if v_cls is not null then
          select sac.current_reply_id, sac.current_reply into v_cur_id, v_cur_cls
            from public.staffing_ask_current sac where sac.ask_id = v_ask;
          if v_cur_cls is distinct from v_cls then
            v_recv := coalesce(nullif(a->>'replied_at', '')::timestamptz, v_sent);
            v_raw := coalesce(nullif(btrim(a->>'reply'), ''),
                              '(legacy record: no reply text kept; state was ' || (a->>'state') || ')');
            r := public.staffing_reply_record(
                   p_ask_id => v_ask, p_raw_text => v_raw, p_received_at => v_recv, p_channel => v_chan,
                   p_classification => v_cls,
                   p_classified_by => case when a->>'auto' = 'true' then 'engine' else 'staff' end,
                   p_acting_staff => 'legacy mirror', p_acting_seat => 'legacy_mirror',
                   p_supersedes_reply_id => v_cur_id,
                   p_origin_system => 'coverage_case',
                   p_origin_ref => case_id || ':' || coalesce(a->>'id', md5(a::text)) || ':' || v_cls || ':' || coalesce(a->>'replied_at', ''));
            if r->>'outcome' not in ('recorded','already_recorded') then raise exception 'reply: %', r; end if;
            if r->>'outcome' = 'recorded' then n_rep := n_rep + 1; end if;
          end if;
        end if;
        if a->>'state' = 'no_answer_final' and exists (select 1 from public.staffing_ask x where x.ask_id = v_ask and x.closed_at is null) then
          r := public.staffing_ask_close(v_ask, 'no_answer_final', 'legacy mirror', 'legacy_mirror');
        end if;
      end loop;

      if nullif(btrim(c->>'covered_by'), '') is not null and coalesce(c->>'resolved_how', 'covered') = 'covered' then
        v_origin := case_id || ':assign:' || lower(btrim(c->>'covered_by'));
        if not exists (select 1 from public.staffing_assignment s where s.origin_system = 'coverage_case' and s.origin_ref = v_origin) then
          for v_asg in select s.assignment_id from public.staffing_assignment s
                        where s.need_id = v_need and s.state = 'active' and s.origin_system = 'coverage_case' loop
            r := public.staffing_assignment_release(v_asg, 'legacy covered_by changed', 'legacy mirror', 'legacy_mirror');
          end loop;
          select sac.current_reply_id into v_basis from public.staffing_ask_current sac
           where sac.need_id = v_need and sac.current_reply = 'yes'
             and lower(btrim(sac.caregiver_name)) = lower(btrim(c->>'covered_by')) limit 1;
          r := public.staffing_assign(
                 p_need_id => v_need, p_caregiver_name => btrim(c->>'covered_by'),
                 p_acting_staff => 'legacy mirror (decision made in the coverage case)', p_acting_seat => 'legacy_mirror',
                 p_caregiver_axiscare_id => nullif(c#>>'{axiscare_assignment,caregiver_id}', ''),
                 p_basis_reply_id => v_basis, p_origin_system => 'coverage_case', p_origin_ref => v_origin);
          if r->>'outcome' not in ('assigned','already_recorded') then raise exception 'assign: %', r; end if;
          n_asg := n_asg + 1;
          if jsonb_typeof(c->'axiscare_assignment') = 'object' and (r->>'assignment_id') is not null then
            r := public.staffing_assignment_sync_record(
                   p_assignment_id => (r->>'assignment_id')::uuid,
                   p_status => case when c#>>'{axiscare_assignment,status}' in ('assigned','by_hand','failed','verified','unknown')
                                    then c#>>'{axiscare_assignment,status}' else 'unknown' end,
                   p_recorded_by => 'legacy mirror',
                   p_axiscare_visit_ref => nullif(c#>>'{axiscare_assignment,visit_id}', ''),
                   p_axiscare_caregiver_id => nullif(c#>>'{axiscare_assignment,caregiver_id}', ''),
                   p_verified => coalesce((c#>>'{axiscare_assignment,verified}')::boolean, false),
                   p_detail => nullif(c#>>'{axiscare_assignment,detail}', ''));
          end if;
        end if;
      end if;

      outcome := 'mirrored';
      detail := 'need ' || v_need || ' · +' || n_ask || ' ask(s) +' || n_rep || ' reply(s) +' || n_asg || ' assignment(s)'
                || case when array_length(notes, 1) > 0 then ' · ' || array_to_string(notes, '; ') else '' end;
      return next;
    exception when others then
      if sqlerrm like 'DUPLICATE_VISIT%' then
        outcome := 'unmapped'; detail := 'its AxisCare visit already backs the need mirrored from another case (' || substr(sqlerrm, 17) || ')';
      elsif sqlerrm like 'DIVERGED%' then
        outcome := 'diverged'; detail := substr(sqlerrm, 10);
      else
        outcome := 'error'; detail := sqlerrm;
      end if;
      return next;
    end;
  end loop;
end $$;

comment on function public.legacy_mirror_coverage(boolean) is
  'legacy_mirror v1 · one-way shadow of app_data.coverage_cases into the staffing objects; legacy stays authoritative';
revoke all on function public.legacy_mirror_coverage(boolean) from public, anon, authenticated, service_role;
grant execute on function public.legacy_mirror_coverage(boolean) to service_role;

do $verify$
begin
  if (select prosecdef from pg_proc where oid = 'public.legacy_mirror_coverage(boolean)'::regprocedure) then
    raise exception 'legacy_mirror self-check failed: definer'; end if;
  if has_function_privilege('authenticated', 'public.legacy_mirror_coverage(boolean)', 'execute')
     or has_function_privilege('anon', 'public.legacy_mirror_coverage(boolean)', 'execute') then
    raise exception 'legacy_mirror self-check failed: browser can execute'; end if;
end $verify$;

commit;
