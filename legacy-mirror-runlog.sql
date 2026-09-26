-- =============================================================================
-- legacy-mirror-runlog.sql · Stage 3 shadow · run log + scheduled wrapper
--
--   legacy_mirror_parity     view: legacy coverage cases vs the canonical shadow
--   legacy_mirror_run        append-only: one row per mirror run with seen /
--                            mirrored / unmapped / skipped / errors / diverged,
--                            rows written, parity mismatches, legacy-untouched
--   legacy_mirror_scheduled  what the schedule calls: never overlaps a running
--                            mirror, and records every run INCLUDING a total
--                            failure, so a dead mirror cannot look healthy
-- Additive. The schedule itself is created separately, on authorization.
-- GUARD: refuses if the run log already holds rows (rerun only while empty).
-- =============================================================================
begin;

do $guard$
declare n bigint;
begin
  if to_regclass('public.legacy_mirror_run') is not null then
    lock table public.legacy_mirror_run in access exclusive mode;
    select count(*) into n from public.legacy_mirror_run;
    if n > 0 then raise exception 'legacy_mirror_runlog refused: legacy_mirror_run contains % row(s). Nothing was changed.', n; end if;
  end if;
end $guard$;

drop function if exists public.legacy_mirror_scheduled(text);
drop table if exists public.legacy_mirror_run;
drop view if exists public.legacy_mirror_parity;
drop function if exists public.legacy_mirror_run_guard();

create view public.legacy_mirror_parity with (security_invoker = true) as
with lc as (
  select e from public.app_data ad,
         lateral jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end) e
   where ad.key = 'coverage_cases' and jsonb_typeof(e) = 'object' and e->>'id' is not null
),
leg as (
  select e->>'id' as cid, coalesce(nullif(e->>'status', ''), 'open') as st,
         jsonb_array_length(coalesce(e->'asked', '[]'::jsonb)) as n_asks,
         (select count(*) from jsonb_array_elements(coalesce(e->'asked', '[]'::jsonb)) a
           where a->>'state' = 'yes' or a->>'was_yes' = 'true') as n_yes,
         (select count(*) from jsonb_array_elements(coalesce(e->'asked', '[]'::jsonb)) a where a->>'state' = 'waiting') as n_waiting,
         lower(nullif(btrim(e->>'covered_by'), '')) as covered
    from lc
),
can as (
  select n.origin_ref as cid, n.need_id, n.state, s.status, s.open_asks,
         (select count(*) from public.staffing_ask a where a.need_id = n.need_id) as n_asks,
         (select count(*) from public.staffing_ask_current a where a.need_id = n.need_id and a.current_reply = 'yes') as n_yes,
         (select lower(string_agg(x.caregiver_name, ',' order by x.caregiver_name)) from public.staffing_assignment x
           where x.need_id = n.need_id and x.state = 'active') as covered
    from public.staffing_need n join public.staffing_need_status s using (need_id)
   where n.origin_system = 'coverage_case'
)
select leg.cid as case_id,
       leg.st as legacy_status,
       coalesce(can.state || ' / ' || can.status, 'not mirrored') as canonical,
       case when can.need_id is null then null
            else ((leg.st = 'open' and can.state = 'open') or (leg.st in ('done','resolved','dismissed') and can.state = 'closed')) end as status_match,
       case when can.need_id is null then null else leg.n_asks = can.n_asks end as asks_match,
       case when can.need_id is null then null else leg.n_yes = can.n_yes end as yes_match,
       case when can.need_id is null or leg.st <> 'open' then null else (leg.n_waiting > 0) = (can.open_asks > 0) end as asked_match,
       case when can.need_id is null then null else leg.covered is not distinct from can.covered end as covered_match,
       leg.n_asks || '/' || coalesce(can.n_asks::text, '-') as asks_legacy_vs_canonical
  from leg left join can using (cid);

create table public.legacy_mirror_run (
  run_id            bigserial primary key,
  started_at        timestamptz not null,
  finished_at       timestamptz not null default now(),
  trigger_source    text not null check (trigger_source in ('schedule','manual')),
  outcome           text not null check (outcome in ('ok','errors','failed','skipped_busy')),
  cases_seen        int, mirrored int, unmapped int, skipped int, errors int, diverged int,
  needs_written     int, asks_written int, replies_written int, assignments_written int,
  parity_mismatches int, not_mirrored int,
  legacy_unchanged  boolean,
  detail            text
);
comment on table public.legacy_mirror_run is 'legacy_mirror_runlog v1 · one append-only row per coverage mirror run';

create function public.legacy_mirror_run_guard() returns trigger language plpgsql as $$
begin raise exception 'legacy_mirror_run is append-only (% refused)', tg_op; end $$;
create trigger legacy_mirror_run_append_only_t before update or delete on public.legacy_mirror_run
  for each row execute function public.legacy_mirror_run_guard();
create trigger legacy_mirror_run_no_truncate before truncate on public.legacy_mirror_run
  for each statement execute function public.legacy_mirror_run_guard();

create function public.legacy_mirror_scheduled(p_trigger text default 'schedule') returns jsonb
language plpgsql security invoker as $$
declare
  t0 timestamptz := clock_timestamp(); md0 text; md1 text;
  n0 int[]; n1 int[]; o record; v_detail text; v_row public.legacy_mirror_run%rowtype;
  c_seen int := 0; c_m int := 0; c_u int := 0; c_s int := 0; c_e int := 0; c_d int := 0; errs text[] := '{}';
begin
  if p_trigger not in ('schedule','manual') then raise exception 'unknown trigger %', p_trigger; end if;
  if not pg_try_advisory_xact_lock(hashtext('legacy_mirror_coverage')) then
    insert into public.legacy_mirror_run (started_at, trigger_source, outcome, detail)
    values (t0, p_trigger, 'skipped_busy', 'another mirror run was in progress')
    returning * into v_row;
    return to_jsonb(v_row);
  end if;
  select md5(data::text) into md0 from public.app_data where key = 'coverage_cases';
  select array[(select count(*) from public.staffing_need)::int, (select count(*) from public.staffing_ask)::int,
               (select count(*) from public.staffing_reply)::int, (select count(*) from public.staffing_assignment)::int] into n0;
  begin
    for o in select * from public.legacy_mirror_coverage(true) loop
      c_seen := c_seen + 1;
      case o.outcome when 'mirrored' then c_m := c_m + 1; when 'unmapped' then c_u := c_u + 1; when 'skipped' then c_s := c_s + 1;
                     when 'diverged' then c_d := c_d + 1; else c_e := c_e + 1; errs := errs || (o.case_id || ': ' || o.detail); end case;
    end loop;
  exception when others then
    insert into public.legacy_mirror_run (started_at, trigger_source, outcome, detail)
    values (t0, p_trigger, 'failed', 'mirror did not run: ' || sqlerrm)
    returning * into v_row;
    return to_jsonb(v_row);
  end;
  select md5(data::text) into md1 from public.app_data where key = 'coverage_cases';
  select array[(select count(*) from public.staffing_need)::int, (select count(*) from public.staffing_ask)::int,
               (select count(*) from public.staffing_reply)::int, (select count(*) from public.staffing_assignment)::int] into n1;
  insert into public.legacy_mirror_run (started_at, trigger_source, outcome, cases_seen, mirrored, unmapped, skipped, errors, diverged,
                                        needs_written, asks_written, replies_written, assignments_written,
                                        parity_mismatches, not_mirrored, legacy_unchanged, detail)
  values (t0, p_trigger, case when c_e > 0 then 'errors' else 'ok' end, c_seen, c_m, c_u, c_s, c_e, c_d,
          n1[1] - n0[1], n1[2] - n0[2], n1[3] - n0[3], n1[4] - n0[4],
          (select count(*) from public.legacy_mirror_parity p where p.canonical <> 'not mirrored'
             and (p.status_match is false or p.asks_match is false or p.yes_match is false
                  or p.asked_match is false or p.covered_match is false)),
          (select count(*) from public.legacy_mirror_parity p where p.canonical = 'not mirrored'),
          md0 is not distinct from md1,
          nullif(left(array_to_string(errs, ' | '), 2000), ''))
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

alter table public.legacy_mirror_run enable row level security;
revoke all on public.legacy_mirror_run from public, anon, authenticated, service_role;
revoke all on sequence public.legacy_mirror_run_run_id_seq from public, anon, authenticated, service_role;
revoke all on public.legacy_mirror_parity from public, anon, authenticated, service_role;
grant select on public.legacy_mirror_run to authenticated;                -- the office can see mirror health
grant select, insert on public.legacy_mirror_run to service_role;
grant usage, select on sequence public.legacy_mirror_run_run_id_seq to service_role;
grant select on public.legacy_mirror_parity to service_role;
create policy legacy_mirror_run_read on public.legacy_mirror_run for select to authenticated using (true);
revoke all on function public.legacy_mirror_scheduled(text) from public, anon, authenticated, service_role;
grant execute on function public.legacy_mirror_scheduled(text) to service_role;
revoke all on function public.legacy_mirror_run_guard() from public, anon, authenticated, service_role;

do $verify$
begin
  if (select prosecdef from pg_proc where oid = 'public.legacy_mirror_scheduled(text)'::regprocedure) then
    raise exception 'legacy_mirror_runlog self-check failed: definer'; end if;
  if has_function_privilege('authenticated', 'public.legacy_mirror_scheduled(text)', 'execute')
     or has_table_privilege('authenticated', 'public.legacy_mirror_run', 'insert')
     or has_table_privilege('service_role', 'public.legacy_mirror_run', 'update')
     or has_table_privilege('service_role', 'public.legacy_mirror_run', 'delete')
     or has_table_privilege('anon', 'public.legacy_mirror_run', 'select') then
    raise exception 'legacy_mirror_runlog self-check failed: privileges'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.legacy_mirror_run'::regclass) then
    raise exception 'legacy_mirror_runlog self-check failed: rls'; end if;
end $verify$;

commit;
