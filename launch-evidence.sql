-- =============================================================================
-- launch-evidence.sql · Change 1: New Clients reads what AxisCare already knows
-- The proof behind each launch step that AxisCare can answer (schedule,
-- caregiver, first shift, EVV), and the reason whenever a person records one
-- of those steps by hand instead.
--
--   launch_evidence          append-only: one row per fact per source per launch
--   launch_evidence_record   the Door (service_role only; the hub reaches it through
--                            the launch-evidence function)
--
-- The Door ticks the matching EXISTING client_queue box only while it is still
-- empty, with the evidence time (for the first shift: the clock-in time, which
-- is when care began). It never un-ticks, never renames a caregiver a person
-- typed, and never touches a completed launch. No client_queue column is added.
-- launch_id is deliberately not a foreign key: the New Clients "Remove" button
-- deletes client_queue rows and must keep working; the evidence stays as history.
-- Additive. GUARD: refuses if launch_evidence already holds rows, or if
-- client_queue is missing a column the Door writes.
-- =============================================================================
begin;

do $guard$
declare n bigint; missing text;
begin
  if to_regclass('public.launch_evidence') is not null then
    lock table public.launch_evidence in access exclusive mode;
    select count(*) into n from public.launch_evidence;
    if n > 0 then raise exception 'launch_evidence refused: launch_evidence contains % row(s). Nothing was changed.', n; end if;
  end if;
  select string_agg(c, ', ') into missing
    from unnest(array['id','status','axiscare_client_id','caregiver_assigned','caregiver_assigned_at','caregiver_assigned_name',
                      'schedule_added','schedule_added_at','evv_verified','evv_verified_at','first_shift_done','first_shift_done_at']) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'client_queue' and column_name = c);
  if missing is not null then
    raise exception 'launch_evidence refused: client_queue is missing column(s) %. Nothing was changed.', missing;
  end if;
end $guard$;

drop function if exists public.launch_evidence_record(uuid, text, jsonb, text, text, text);
drop function if exists public.launch_evidence_stamp(text);
drop table if exists public.launch_evidence;
drop function if exists public.launch_evidence_guard();

create table public.launch_evidence (
  id                  bigserial primary key,
  launch_id           uuid not null,
  axiscare_client_id  text,
  fact                text not null check (fact in ('schedule','caregiver','first_shift','evv')),
  source              text not null check (source in ('axiscare','person')),
  ticked              boolean not null,
  evidence            jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  reason              text,
  recorded_by         text not null check (length(btrim(recorded_by)) > 0),
  recorded_at         timestamptz not null default now(),
  check (source <> 'person' or length(btrim(coalesce(reason, ''))) >= 5)
);
create unique index launch_evidence_once on public.launch_evidence (launch_id, fact, source);
create index launch_evidence_launch on public.launch_evidence (launch_id);
comment on table public.launch_evidence is
  'launch_evidence v1 · append-only; the AxisCare evidence (or a person''s reason) behind each New Clients launch step';

create function public.launch_evidence_guard() returns trigger language plpgsql as $$
begin raise exception '% is append-only (% refused)', tg_table_name, tg_op; end $$;
create trigger launch_evidence_append_only_t before update or delete on public.launch_evidence
  for each row execute function public.launch_evidence_guard();
create trigger launch_evidence_no_truncate before truncate on public.launch_evidence
  for each statement execute function public.launch_evidence_guard();

-- An AxisCare stamp as a moment in time. Stamps without a zone are the site's
-- local time (Springfield), never the database's UTC.
create function public.launch_evidence_stamp(p text) returns timestamptz
language plpgsql immutable as $$
declare s text := nullif(btrim(p), '');
begin
  if s is null then return null; end if;
  if s ~ '(Z|z|[+-]\d{2}:?\d{2})$' then return s::timestamptz; end if;
  return (s::timestamp) at time zone 'America/Chicago';
exception when others then return null;
end $$;

-- p_records: [{fact, name?, at?, detail{}}]. source 'axiscare': the evaluation
-- from launch-evidence.js. source 'person': exactly one fact, with a reason; a
-- hand-recorded first shift carries detail.date (the day care began).
create function public.launch_evidence_record(
  p_launch_id uuid, p_axiscare_client_id text, p_records jsonb, p_source text, p_staff text, p_reason text
) returns jsonb
language plpgsql security invoker as $$
declare
  staff text := nullif(btrim(p_staff), '');
  ax text := nullif(btrim(p_axiscare_client_id), '');
  q record; r jsonb; f text; col text; tick_at timestamptz; was boolean; d date; nm text;
  v_recorded text[] := '{}'; v_ticked text[] := '{}'; v_skipped text[] := '{}';
begin
  if p_source is null or p_source not in ('axiscare','person') then return jsonb_build_object('outcome','invalid_source'); end if;
  if staff is null then return jsonb_build_object('outcome','staff_required'); end if;
  if p_launch_id is null then return jsonb_build_object('outcome','launch_required'); end if;
  if p_records is null or jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) = 0 then
    return jsonb_build_object('outcome','nothing_to_record'); end if;
  if p_source = 'person' then
    if length(btrim(coalesce(p_reason, ''))) < 5 then return jsonb_build_object('outcome','reason_required'); end if;
    if jsonb_array_length(p_records) <> 1 then return jsonb_build_object('outcome','one_fact_at_a_time'); end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('launch_evidence'), hashtext(p_launch_id::text));

  select id, status, axiscare_client_id, caregiver_assigned_name into q from public.client_queue where id = p_launch_id for update;
  if not found then return jsonb_build_object('outcome','launch_not_found'); end if;
  if coalesce(q.status, '') = 'complete' then return jsonb_build_object('outcome','launch_complete'); end if;
  if p_source = 'axiscare' and (ax is null or coalesce(btrim(q.axiscare_client_id), '') <> ax) then
    return jsonb_build_object('outcome','axiscare_id_changed',
      'detail','the launch no longer carries the AxisCare id this evidence was read for; nothing was saved');
  end if;

  begin
    for r in select value from jsonb_array_elements(p_records) loop
      f := r->>'fact';
      col := case f when 'schedule' then 'schedule_added' when 'caregiver' then 'caregiver_assigned'
                    when 'first_shift' then 'first_shift_done' when 'evv' then 'evv_verified' end;
      if col is null then raise exception 'launch_evidence:%', jsonb_build_object('outcome','invalid_fact','fact', f)::text; end if;
      if jsonb_typeof(coalesce(r->'detail', '{}'::jsonb)) <> 'object' then
        raise exception 'launch_evidence:%', jsonb_build_object('outcome','invalid_detail','fact', f)::text; end if;

      tick_at := now();
      if f = 'first_shift' and p_source = 'axiscare' then
        tick_at := public.launch_evidence_stamp(r->>'at');
        if tick_at is null or nullif(r->'detail'->>'visit_id', '') is null
           or public.launch_evidence_stamp(r->'detail'->>'clock_out_at') is null then
          raise exception 'launch_evidence:%', jsonb_build_object('outcome','evidence_incomplete','fact', f,
            'detail','a first shift needs the visit, its clock-in and its clock-out')::text;
        end if;
        if public.launch_evidence_stamp(r->'detail'->>'clock_out_at') < tick_at or tick_at > now() + interval '10 minutes' then
          raise exception 'launch_evidence:%', jsonb_build_object('outcome','evidence_inconsistent','fact', f)::text; end if;
      elsif f = 'evv' and p_source = 'axiscare' and nullif(r->'detail'->>'visit_id', '') is null then
        raise exception 'launch_evidence:%', jsonb_build_object('outcome','evidence_incomplete','fact', f)::text;
      elsif f = 'first_shift' and p_source = 'person' then
        begin d := (r->'detail'->>'date')::date; exception when others then d := null; end;
        if d is null or d > (now() at time zone 'America/Chicago')::date or d < date '2020-01-01' then
          raise exception 'launch_evidence:%', jsonb_build_object('outcome','date_required','fact', f,
            'detail','say which day care began (not in the future)')::text;
        end if;
        tick_at := (d::timestamp + time '12:00') at time zone 'America/Chicago';
      end if;

      if exists (select 1 from public.launch_evidence where launch_id = p_launch_id and fact = f and source = p_source) then
        v_skipped := v_skipped || f; continue;
      end if;

      execute format('select coalesce(%I, false) from public.client_queue where id = $1', col) into was using p_launch_id;
      if not was then
        execute format('update public.client_queue set %I = true, %I = $2 where id = $1 and coalesce(%I, false) = false',
                       col, col || '_at', col) using p_launch_id, tick_at;
        v_ticked := v_ticked || f;
      end if;
      if f = 'caregiver' then
        nm := nullif(btrim(r->>'name'), '');
        if nm is not null and nullif(btrim(q.caregiver_assigned_name), '') is null then
          update public.client_queue set caregiver_assigned_name = left(nm, 120) where id = p_launch_id;
        end if;
      end if;
      insert into public.launch_evidence (launch_id, axiscare_client_id, fact, source, ticked, evidence, reason, recorded_by)
      values (p_launch_id, coalesce(ax, q.axiscare_client_id), f, p_source, not was,
              coalesce(r->'detail', '{}'::jsonb) || case when r ? 'at' then jsonb_build_object('at', r->>'at') else '{}'::jsonb end,
              case when p_source = 'person' then btrim(p_reason) end, staff);
      v_recorded := v_recorded || f;
    end loop;
  exception when raise_exception then
    if sqlerrm like 'launch_evidence:%' then
      return jsonb_build_object('outcome','refused','detail', substr(sqlerrm, 17)::jsonb, 'note','nothing was saved');
    end if;
    raise;
  end;
  return jsonb_build_object('outcome', case when cardinality(v_recorded) > 0 then 'recorded' else 'nothing_new' end,
                            'recorded', to_jsonb(v_recorded), 'ticked', to_jsonb(v_ticked), 'already_recorded', to_jsonb(v_skipped));
end $$;

alter table public.launch_evidence enable row level security;
revoke all on public.launch_evidence from public, anon, authenticated, service_role;
revoke all on sequence public.launch_evidence_id_seq from public, anon, authenticated, service_role;
grant select on public.launch_evidence to authenticated;
grant select, insert on public.launch_evidence to service_role;
grant usage on sequence public.launch_evidence_id_seq to service_role;
create policy launch_evidence_read on public.launch_evidence for select to authenticated using (true);
revoke all on function public.launch_evidence_record(uuid, text, jsonb, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.launch_evidence_record(uuid, text, jsonb, text, text, text) to service_role;
revoke all on function public.launch_evidence_stamp(text) from public, anon, authenticated, service_role;
grant execute on function public.launch_evidence_stamp(text) to service_role;
revoke all on function public.launch_evidence_guard() from public, anon, authenticated, service_role;

do $verify$
begin
  if (select prosecdef from pg_proc where oid = 'public.launch_evidence_record(uuid,text,jsonb,text,text,text)'::regprocedure) then
    raise exception 'launch_evidence self-check failed: definer'; end if;
  if has_function_privilege('authenticated', 'public.launch_evidence_record(uuid,text,jsonb,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.launch_evidence_record(uuid,text,jsonb,text,text,text)', 'execute')
     or has_table_privilege('authenticated', 'public.launch_evidence', 'insert')
     or has_table_privilege('service_role', 'public.launch_evidence', 'update')
     or has_table_privilege('service_role', 'public.launch_evidence', 'delete')
     or has_table_privilege('anon', 'public.launch_evidence', 'select') then
    raise exception 'launch_evidence self-check failed: privileges'; end if;
  if public.launch_evidence_stamp('2026-09-22T09:02:00') <> timestamptz '2026-09-22 14:02:00+00'
     or public.launch_evidence_stamp('2026-09-22T14:02:00Z') <> timestamptz '2026-09-22 14:02:00+00'
     or public.launch_evidence_stamp('not a time') is not null then
    raise exception 'launch_evidence self-check failed: stamps'; end if;
end $verify$;

commit;
