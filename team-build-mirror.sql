-- =============================================================================
-- team-build-mirror.sql · linked Team Builder plans -> canonical staffing objects
--
-- ONE-WAY and non-authoritative: app_data.staffing_plans stays the authority and
-- is only READ. Only plans a person has linked to a Journey (team_build_link)
-- are mirrored, into that Journey's episode, through the staffing Doors as the
-- legacy_mirror seat. Each need's source reference is plan|day|slot|HH:MM-HH:MM,
-- so an edited shift time opens a NEW need that supersedes the old one.
--   * a slot or day no longer on the plan -> its open need is cancelled
--   * cell "asked" -> an ask to that caregiver (text not retained: asked by phone/text)
--   * cell "declined" -> that ask plus a "no" reply
--   * cell "confirmed" -> an assignment decided by the staff member on the cell;
--     a different confirmed name releases the previous assignment (kept)
--   * cell "penciled" -> nothing (a draft idea, not an ask or a decision)
--   * plan marked complete -> its open needs close as covered
-- A plan whose Journey is no longer active is reported, not forced.
--
--   team_build_mirror(false|true), team_build_parity, team_build_mirror_run,
--   team_build_mirror_scheduled()   (same run-log pattern as the other mirrors)
-- GUARD: refuses if the run log already holds rows.
-- =============================================================================
begin;

do $guard$
declare n bigint;
begin
  if to_regclass('public.team_build_mirror_run') is not null then
    lock table public.team_build_mirror_run in access exclusive mode;
    select count(*) into n from public.team_build_mirror_run;
    if n > 0 then raise exception 'team_build_mirror refused: team_build_mirror_run contains % row(s). Nothing was changed.', n; end if;
  end if;
end $guard$;

drop function if exists public.team_build_mirror_scheduled(text);
drop table if exists public.team_build_mirror_run;
drop view if exists public.team_build_parity;
drop function if exists public.team_build_mirror(boolean);
drop function if exists public.team_build_run_guard();

create function public.team_build_mirror(p_commit boolean default false)
returns table (plan_id text, outcome text, detail text)
language plpgsql security invoker as $$
declare
  p jsonb; v_ep uuid; d text; s jsonb; cell jsonb; v_st time; v_en time; v_ref text; v_base text; v_need uuid;
  v_old uuid; r jsonb; v_ask uuid; v_name text; v_by text; n_need int; n_ask int; n_asg int; n_close int; x record;
  v_at timestamptz; v_valid text[];
begin
  for p in
    select e from public.app_data ad,
           lateral jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end) e
     where ad.key = 'staffing_plans' and jsonb_typeof(e) = 'object'
     order by e->>'created_at' nulls last, e->>'id'
  loop
    plan_id := p->>'id';
    if plan_id is null then continue; end if;
    select l.episode_id into v_ep from public.team_build_link_current l where l.plan_id = p->>'id';
    if v_ep is null then outcome := 'not_linked'; detail := 'no Journey linked yet (link it in Team Builder)'; return next; continue; end if;
    if not exists (select 1 from public.journey_episode e where e.episode_id = v_ep and public.journey_state_is_active(e.state)) then
      if exists (select 1 from public.staffing_need n where n.origin_system = 'team_builder'
                  and split_part(n.origin_ref, '|', 1) = p->>'id' and n.state = 'open') then
        outcome := 'diverged'; detail := 'its Journey is no longer active but it still has open needs';
      else
        outcome := 'unchanged'; detail := 'its Journey is no longer active';
      end if;
      return next; continue;
    end if;
    if not p_commit then
      outcome := 'would_mirror';
      detail := coalesce(jsonb_array_length(p->'days'), 0) || ' day(s) × ' || coalesce(jsonb_array_length(p->'slots'), 0) || ' shift(s) · '
                || (select count(*) from jsonb_each(coalesce(p->'cells', '{}'::jsonb)) c where c.value->>'status' = 'yes') || ' confirmed · '
                || (select count(*) from jsonb_each(coalesce(p->'cells', '{}'::jsonb)) c where c.value->>'status' in ('asked','no')) || ' asked/declined'
                || case when p->>'status' = 'done' then ' · plan complete' else '' end;
      return next; continue;
    end if;

    begin   -- one plan is one unit
      n_need := 0; n_ask := 0; n_asg := 0; n_close := 0; v_valid := '{}';
      for d in select jsonb_array_elements_text(coalesce(p->'days', '[]'::jsonb)) loop
        for s in select x2 from jsonb_array_elements(coalesce(p->'slots', '[]'::jsonb)) x2 loop
          if coalesce(s->>'start', '') !~ '^\d{2}:\d{2}$' or coalesce(s->>'end', '') !~ '^\d{2}:\d{2}$'
             or d not in ('mon','tue','wed','thu','fri','sat','sun') then continue; end if;
          v_st := (s->>'start')::time; v_en := (s->>'end')::time;
          v_base := (p->>'id') || '|' || d || '|' || (s->>'k');
          v_ref := v_base || '|' || (s->>'start') || '-' || (s->>'end');
          v_valid := v_valid || v_ref;
          select n.need_id into v_need from public.staffing_need n where n.origin_system = 'team_builder' and n.origin_ref = v_ref;
          if v_need is null then
            select n.need_id into v_old from public.staffing_need n
             where n.origin_system = 'team_builder' and n.state = 'open' and n.origin_ref like replace(replace(replace(v_base, '\', '\\'), '%', '\%'), '_', '\_') || '|%';
            r := public.staffing_need_open(
                   p_episode_id => v_ep, p_kind => 'recurring_slot', p_start_time => v_st, p_end_time => v_en,
                   p_acting_staff => 'team builder mirror', p_acting_seat => 'legacy_mirror', p_weekday => d,
                   p_capacity => 1, p_min_care_level => case when p->>'level' ~ '^[123]$' then (p->>'level')::smallint end,
                   p_note => 'Team Builder plan ' || (p->>'id') || ' · ' || coalesce(s->>'label', ''),
                   p_supersedes_need_id => v_old, p_origin_system => 'team_builder', p_origin_ref => v_ref);
            if r->>'outcome' not in ('opened','already_recorded') then raise exception 'need: %', r; end if;
            v_need := (r->>'need_id')::uuid; n_need := n_need + 1;
          end if;
          if (select n.state from public.staffing_need n where n.need_id = v_need) <> 'open' then continue; end if;

          cell := p->'cells'->(d || '|' || (s->>'k'));
          v_name := nullif(btrim(cell->>'name'), '');
          v_by := coalesce(nullif(btrim(cell->>'by'), ''), 'Team Builder');
          v_at := coalesce(nullif(cell->>'at', '')::timestamptz, nullif(p->>'created_at', '')::timestamptz, now());
          -- asks to someone no longer named in this cell are withdrawn
          for x in select a.ask_id from public.staffing_ask a
                    where a.need_id = v_need and a.closed_at is null and a.origin_system = 'team_builder'
                      and (v_name is null or lower(btrim(a.caregiver_name)) <> lower(v_name)) loop
            r := public.staffing_ask_close(x.ask_id, 'withdrawn', 'team builder mirror', 'legacy_mirror');
          end loop;
          -- an assignment no longer confirmed on the cell is released (kept)
          for x in select a.assignment_id from public.staffing_assignment a
                    where a.need_id = v_need and a.state = 'active' and a.origin_system = 'team_builder'
                      and (cell->>'status' is distinct from 'yes' or lower(btrim(a.caregiver_name)) <> lower(v_name)) loop
            r := public.staffing_assignment_release(x.assignment_id, 'changed in Team Builder', 'team builder mirror', 'legacy_mirror');
          end loop;
          if v_name is null or cell->>'status' not in ('asked','no','yes') then continue; end if;

          if cell->>'status' in ('asked','no') then
            r := public.staffing_ask_record(
                   p_need_id => v_need, p_caregiver_name => v_name, p_channel => 'other',
                   p_message_status => 'not_retained_legacy', p_sent_at => v_at, p_sender => 'team-builder',
                   p_acting_staff => v_by, p_acting_seat => 'legacy_mirror',
                   p_origin_system => 'team_builder', p_origin_ref => v_ref || '|ask|' || lower(v_name) || '|' || coalesce(cell->>'at', ''));
            if r->>'outcome' not in ('recorded','already_recorded','already_asked') then raise exception 'ask: %', r; end if;
            if r->>'outcome' = 'recorded' then n_ask := n_ask + 1; end if;
            if cell->>'status' = 'no' then
              select a.ask_id into v_ask from public.staffing_ask a
               where a.need_id = v_need and lower(btrim(a.caregiver_name)) = lower(v_name) and a.origin_system = 'team_builder'
               order by a.sent_at desc limit 1;
              if v_ask is not null and not exists (select 1 from public.staffing_ask_current c where c.ask_id = v_ask and c.current_reply = 'no') then
                r := public.staffing_reply_record(
                       p_ask_id => v_ask, p_raw_text => '(declined, recorded in Team Builder)', p_received_at => v_at,
                       p_channel => 'other', p_classification => 'no', p_classified_by => 'staff',
                       p_acting_staff => v_by, p_acting_seat => 'legacy_mirror',
                       p_supersedes_reply_id => (select c.current_reply_id from public.staffing_ask_current c where c.ask_id = v_ask),
                       p_origin_system => 'team_builder', p_origin_ref => v_ref || '|no|' || lower(v_name) || '|' || coalesce(cell->>'at', ''));
                if r->>'outcome' not in ('recorded','already_recorded') then raise exception 'reply: %', r; end if;
              end if;
            end if;
          else   -- confirmed
            if not exists (select 1 from public.staffing_assignment a where a.need_id = v_need and a.state = 'active'
                            and lower(btrim(a.caregiver_name)) = lower(v_name)) then
              r := public.staffing_assign(
                     p_need_id => v_need, p_caregiver_name => v_name, p_acting_staff => v_by, p_acting_seat => 'legacy_mirror',
                     p_origin_system => 'team_builder', p_origin_ref => v_ref || '|assign|' || lower(v_name) || '|' || coalesce(cell->>'at', ''));
              if r->>'outcome' not in ('assigned','already_recorded') then raise exception 'assign: %', r; end if;
              n_asg := n_asg + 1;
            end if;
          end if;
        end loop;
      end loop;

      -- needs for shifts/days no longer on the plan are cancelled
      for x in select n.need_id from public.staffing_need n
                where n.origin_system = 'team_builder' and n.state = 'open'
                  and split_part(n.origin_ref, '|', 1) = p->>'id' and not (n.origin_ref = any(v_valid)) loop
        r := public.staffing_need_close(x.need_id, 'cancelled', 'team builder mirror', 'legacy_mirror');
        n_close := n_close + 1;
      end loop;
      if p->>'status' = 'done' then
        for x in select n.need_id from public.staffing_need n
                  where n.origin_system = 'team_builder' and n.state = 'open' and split_part(n.origin_ref, '|', 1) = p->>'id' loop
          r := public.staffing_need_close(x.need_id, 'covered', 'team builder mirror', 'legacy_mirror');
          n_close := n_close + 1;
        end loop;
      end if;
      outcome := 'mirrored';
      detail := '+' || n_need || ' need(s) +' || n_ask || ' ask(s) +' || n_asg || ' assignment(s) · ' || n_close || ' closed';
      return next;
    exception when others then
      outcome := 'error'; detail := sqlerrm; return next;
    end;
  end loop;
end $$;

create view public.team_build_parity with (security_invoker = true) as
with plans as (
  select e from public.app_data ad,
         lateral jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end) e
   where ad.key = 'staffing_plans' and jsonb_typeof(e) = 'object' and e->>'id' is not null
),
legacy as (
  select p.e->>'id' as plan_id, coalesce(p.e->>'status', 'building') as plan_status,
         (select count(*) from jsonb_array_elements_text(coalesce(p.e->'days', '[]'::jsonb)) d,
                               jsonb_array_elements(coalesce(p.e->'slots', '[]'::jsonb)) s) as slots,
         (select count(*) from jsonb_each(coalesce(p.e->'cells', '{}'::jsonb)) c where c.value->>'status' = 'yes') as confirmed
    from plans p
),
canon as (
  select split_part(n.origin_ref, '|', 1) as plan_id,
         count(distinct n.need_id) filter (where n.state = 'open') as open_needs,
         count(distinct a.assignment_id) filter (where n.state = 'open' and a.state = 'active') as assigned_open
    from public.staffing_need n
    left join public.staffing_assignment a on a.need_id = n.need_id
   where n.origin_system = 'team_builder'
   group by split_part(n.origin_ref, '|', 1)
)
select l.plan_id, l.plan_status, (lk.plan_id is not null) as linked,
       l.slots, coalesce(c.open_needs, 0) as open_needs, l.confirmed, coalesce(c.assigned_open, 0) as assigned,
       case when lk.plan_id is null or l.plan_status = 'done' then null else l.slots = coalesce(c.open_needs, 0) end as needs_match,
       case when lk.plan_id is null or l.plan_status = 'done' then null else l.confirmed = coalesce(c.assigned_open, 0) end as assigned_match
  from legacy l
  left join public.team_build_link_current lk on lk.plan_id = l.plan_id
  left join canon c on c.plan_id = l.plan_id;

create table public.team_build_mirror_run (
  run_id           bigserial primary key,
  started_at       timestamptz not null,
  finished_at      timestamptz not null default now(),
  trigger_source   text not null check (trigger_source in ('schedule','manual')),
  outcome          text not null check (outcome in ('ok','errors','failed','skipped_busy')),
  plans_seen       int, mirrored int, not_linked int, diverged int, errors int,
  needs_written    int, asks_written int, assignments_written int,
  parity_mismatches int,
  plans_unchanged  boolean,
  detail           text
);
comment on table public.team_build_mirror_run is 'team_build_mirror v1 · one append-only row per Team Build mirror run';
create function public.team_build_run_guard() returns trigger language plpgsql as $$
begin raise exception 'team_build_mirror_run is append-only (% refused)', tg_op; end $$;
create trigger team_build_run_append_only_t before update or delete on public.team_build_mirror_run
  for each row execute function public.team_build_run_guard();
create trigger team_build_run_no_truncate before truncate on public.team_build_mirror_run
  for each statement execute function public.team_build_run_guard();

create function public.team_build_mirror_scheduled(p_trigger text default 'schedule') returns jsonb
language plpgsql security invoker as $$
declare
  t0 timestamptz := clock_timestamp(); md0 text; md1 text; n0 int[]; o record;
  c_seen int := 0; c_m int := 0; c_nl int := 0; c_d int := 0; c_e int := 0; errs text[] := '{}';
  v_row public.team_build_mirror_run%rowtype;
begin
  if p_trigger not in ('schedule','manual') then raise exception 'unknown trigger %', p_trigger; end if;
  if not pg_try_advisory_xact_lock(hashtext('team_build_mirror')) then
    insert into public.team_build_mirror_run (started_at, trigger_source, outcome, detail)
    values (t0, p_trigger, 'skipped_busy', 'another Team Build mirror run was in progress') returning * into v_row;
    return to_jsonb(v_row);
  end if;
  select md5(data::text) into md0 from public.app_data where key = 'staffing_plans';
  select array[(select count(*) from public.staffing_need where origin_system = 'team_builder')::int,
               (select count(*) from public.staffing_ask where origin_system = 'team_builder')::int,
               (select count(*) from public.staffing_assignment where origin_system = 'team_builder')::int] into n0;
  begin
    for o in select * from public.team_build_mirror(true) loop
      c_seen := c_seen + 1;
      case o.outcome when 'mirrored' then c_m := c_m + 1; when 'not_linked' then c_nl := c_nl + 1;
                     when 'diverged' then c_d := c_d + 1; when 'unchanged' then null;
                     else c_e := c_e + 1; errs := errs || (o.plan_id || ': ' || o.detail); end case;
    end loop;
  exception when others then
    insert into public.team_build_mirror_run (started_at, trigger_source, outcome, detail)
    values (t0, p_trigger, 'failed', 'mirror did not run: ' || sqlerrm) returning * into v_row;
    return to_jsonb(v_row);
  end;
  select md5(data::text) into md1 from public.app_data where key = 'staffing_plans';
  insert into public.team_build_mirror_run (started_at, trigger_source, outcome, plans_seen, mirrored, not_linked, diverged, errors,
                                            needs_written, asks_written, assignments_written, parity_mismatches, plans_unchanged, detail)
  values (t0, p_trigger, case when c_e > 0 then 'errors' else 'ok' end, c_seen, c_m, c_nl, c_d, c_e,
          (select count(*) from public.staffing_need where origin_system = 'team_builder') - n0[1],
          (select count(*) from public.staffing_ask where origin_system = 'team_builder') - n0[2],
          (select count(*) from public.staffing_assignment where origin_system = 'team_builder') - n0[3],
          (select count(*) from public.team_build_parity t where t.needs_match is false or t.assigned_match is false),
          md0 is not distinct from md1, nullif(left(array_to_string(errs, ' | '), 2000), ''))
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

alter table public.team_build_mirror_run enable row level security;
revoke all on public.team_build_mirror_run from public, anon, authenticated, service_role;
revoke all on sequence public.team_build_mirror_run_run_id_seq from public, anon, authenticated, service_role;
revoke all on public.team_build_parity from public, anon, authenticated, service_role;
grant select on public.team_build_mirror_run to authenticated;
grant select, insert on public.team_build_mirror_run to service_role;
grant usage, select on sequence public.team_build_mirror_run_run_id_seq to service_role;
grant select on public.team_build_parity to service_role;
create policy team_build_mirror_run_read on public.team_build_mirror_run for select to authenticated using (true);
revoke all on function public.team_build_mirror(boolean) from public, anon, authenticated, service_role;
revoke all on function public.team_build_mirror_scheduled(text) from public, anon, authenticated, service_role;
revoke all on function public.team_build_run_guard() from public, anon, authenticated, service_role;
grant execute on function public.team_build_mirror(boolean) to service_role;
grant execute on function public.team_build_mirror_scheduled(text) to service_role;

do $verify$
declare f text;
begin
  foreach f in array array['public.team_build_mirror(boolean)','public.team_build_mirror_scheduled(text)'] loop
    if (select prosecdef from pg_proc where oid = f::regprocedure) then raise exception 'team_build_mirror self-check failed: definer %', f; end if;
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'team_build_mirror self-check failed: browser can execute %', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.team_build_mirror_run', 'insert')
     or has_table_privilege('service_role', 'public.team_build_mirror_run', 'update')
     or has_table_privilege('anon', 'public.team_build_mirror_run', 'select') then
    raise exception 'team_build_mirror self-check failed: run log privileges'; end if;
end $verify$;

commit;
