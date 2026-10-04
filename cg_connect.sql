-- =============================================================================
-- 438 · CAREGIVER AUTO-CONNECT (redone on the server). Samantha approved the plan 2026-10-03 ("yes to all"):
-- https://claude.ai/artifact/FJUZg3aU2neZBgGNDbCCLm . Her rules from 2026-10-01 are unchanged; they live in the one
-- copy the Hub page also runs (cc.mo-care.com/caregiver-connect-rules.js, run by the server only when its
-- fingerprint is approved).
--
-- What this adds (SHARED HUB PROJECT; safe to run again; one transaction):
--   caregiver_connect_apply(op)   the ONLY writer. One person per call, all or nothing, one at a time:
--       link     write the AxisCare id on one Hub caregiver record (its _rev must be the one the job saw, and it must
--                not already belong to someone else)
--       move     add the caregiver record (the "Move to caregiver" record, built by the rules file) AND take the
--                candidate out of Background & References, together or not at all
--       create   start a new, empty Hub caregiver record for them
--       unlink / unmove / uncreate   "Not this person": undo one of the above and remember the pair, so the hourly
--                job never makes the same match again (a move or new record is undone only while nobody has changed
--                that record since; otherwise it says so)
--     Every op REFUSES to give an AxisCare caregiver a second Hub record (one AxisCare id, one record), so two runs at
--     once, or a person and the job at once, can never double anyone up.
--   caregiver_connect_practice(run, rows, mode)   the current list, replaced in one step each hour: while the switch is
--                off, everything the job WOULD do; once on, the caregivers who need a person to look.
--   caregiver_connect_log      every change and every "would", with who, how and when (staff can read)
--   caregiver_connect_undo     the candidate record as it was before a move (server only; it is what an undo puts back)
--   caregiver_connect_blocked  pairs a person undid (staff can read)
--   caregiver_connect_runs     one line per hourly run: practice or live, counts, or why it could not run
--
-- Numbers: a new caregiver record gets its number from app_data_id_counter (421), so a number is never given twice.
-- The 421 version trigger stamps _rev and the 418 history records the change, as for every other save.
-- Nothing here messages anyone or writes to AxisCare. The switch (ops_settings.cg_connect_live) stays OFF: practice.
-- =============================================================================

create table if not exists public.caregiver_connect_runs (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  run_id        text not null,
  mode          text not null check (mode in ('practice', 'live')),
  caller        text,
  ok            boolean not null,
  census_total  int,
  census_active int,
  linked        int not null default 0,
  moved         int not null default 0,
  created       int not null default 0,
  review        int not null default 0,
  refused       int not null default 0,
  error         text,
  note          text
);
create index if not exists caregiver_connect_runs_at_ix on public.caregiver_connect_runs (at desc);

create table if not exists public.caregiver_connect_log (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  run_id       text,
  mode         text not null check (mode in ('practice', 'live', 'manual')),
  action       text not null check (action in ('link', 'move', 'create', 'review', 'unlink', 'unmove', 'uncreate')),
  result       text not null check (result in ('would', 'done', 'refused')),
  axiscare_id  text,
  ax_name      text,
  how          text,                      -- phone | email | new | manual
  record_kind  text,                      -- caregiver | candidate
  record_id    text,                      -- the Hub record (or candidate) it was about
  record_name  text,
  caregiver_id text,                      -- the Hub caregiver record it ended up as
  why          text,                      -- review: why it was not automatic · refused: why it was refused
  options      jsonb,                     -- review: the possible records [{where, id, name, why}]
  by           text not null default 'auto',
  rev_after    bigint,                    -- the record's _rev right after this change (an undo needs it unchanged)
  undone_at    timestamptz,
  undone_by    text,
  undo_of      bigint
);
create index if not exists caregiver_connect_log_at_ix on public.caregiver_connect_log (at desc);
create index if not exists caregiver_connect_log_ax_ix on public.caregiver_connect_log (axiscare_id, at desc);
create index if not exists caregiver_connect_log_run_ix on public.caregiver_connect_log (run_id);

create table if not exists public.caregiver_connect_undo (
  log_id  bigint primary key references public.caregiver_connect_log (id) on delete cascade,
  before  jsonb not null
);

create table if not exists public.caregiver_connect_blocked (
  axiscare_id text not null,
  kind        text not null check (kind in ('caregiver', 'candidate', 'new')),
  record_id   text not null default '',
  at          timestamptz not null default now(),
  by          text,
  log_id      bigint,
  primary key (axiscare_id, kind, record_id)
);

alter table public.caregiver_connect_runs enable row level security;
alter table public.caregiver_connect_log enable row level security;
alter table public.caregiver_connect_undo enable row level security;
alter table public.caregiver_connect_blocked enable row level security;
revoke all on public.caregiver_connect_runs, public.caregiver_connect_log, public.caregiver_connect_undo, public.caregiver_connect_blocked
  from public, anon, authenticated;
revoke all on sequence public.caregiver_connect_runs_id_seq, public.caregiver_connect_log_id_seq from public, anon, authenticated;
grant select on public.caregiver_connect_runs, public.caregiver_connect_log, public.caregiver_connect_blocked to authenticated;
grant all on public.caregiver_connect_runs, public.caregiver_connect_log, public.caregiver_connect_undo, public.caregiver_connect_blocked to service_role;
grant usage, select on sequence public.caregiver_connect_runs_id_seq, public.caregiver_connect_log_id_seq to service_role;
drop policy if exists caregiver_connect_runs_read on public.caregiver_connect_runs;
create policy caregiver_connect_runs_read on public.caregiver_connect_runs for select to authenticated using (true);
drop policy if exists caregiver_connect_log_read on public.caregiver_connect_log;
create policy caregiver_connect_log_read on public.caregiver_connect_log for select to authenticated using (true);
drop policy if exists caregiver_connect_blocked_read on public.caregiver_connect_blocked;
create policy caregiver_connect_blocked_read on public.caregiver_connect_blocked for select to authenticated using (true);

-- ── the one writer ───────────────────────────────────────────────────────────
create or replace function public.caregiver_connect_apply(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $fn$
declare
  op text := p->>'op';
  ax text := nullif(trim(coalesce(p->>'axiscare_id', '')), '');
  v_by text := left(coalesce(nullif(p->>'by', ''), 'auto'), 200);
  v_mode text := case when p->>'mode' = 'manual' then 'manual' else 'live' end;
  v_run text := p->>'run_id';
  v_how text := left(coalesce(p->>'how', ''), 40);
  cg jsonb; cd jsonb; rec jsonb; cand jsonb; newarr jsonb; outdata jsonb;
  rid text; cid text; n int; nxt bigint; maxid bigint; v_rev bigint; lid bigint; L record; v_name text; v_ax text;
begin
  if op is null or op not in ('link', 'move', 'create', 'unlink', 'unmove', 'uncreate') then
    raise exception 'caregiver_connect_apply: unknown op %', coalesce(op, '(none)') using errcode = '22023';
  end if;
  -- one at a time, everywhere (the job, a second run, a person on the Connect card)
  perform pg_advisory_xact_lock(hashtext('caregiver_connect'));
  insert into public.app_data (key, data, updated_at) values ('candidates', '[]'::jsonb, now()) on conflict (key) do nothing;
  insert into public.app_data (key, data, updated_at) values ('caregivers', '[]'::jsonb, now()) on conflict (key) do nothing;
  select data into cd from public.app_data where key = 'candidates' for update;
  select data into cg from public.app_data where key = 'caregivers' for update;
  if jsonb_typeof(cd) <> 'array' or jsonb_typeof(cg) <> 'array' then
    raise exception 'caregiver_connect_apply: the caregiver or candidate list is not a list' using errcode = '22023';
  end if;

  -- ── undo ("Not this person") ──
  if op in ('unlink', 'unmove', 'uncreate') then
    select * into L from public.caregiver_connect_log where id = (p->>'log_id')::bigint for update;
    if not found or L.result <> 'done' or L.action <> substr(op, 3) then
      return jsonb_build_object('ok', false, 'reason', 'not_found', 'message', 'That connection was not found.');
    end if;
    if L.undone_at is not null then
      return jsonb_build_object('ok', false, 'reason', 'already_undone', 'message', 'That connection was already undone.');
    end if;
    rid := L.caregiver_id;
    select count(*) into n from jsonb_array_elements(cg) x where x->>'id' = rid;
    select x into rec from jsonb_array_elements(cg) x where x->>'id' = rid limit 1;
    if n <> 1 or coalesce(rec->>'axiscare_id', '') <> coalesce(L.axiscare_id, '') then
      return jsonb_build_object('ok', false, 'reason', 'changed_since', 'message', 'That Hub record is no longer connected to this caregiver, so nothing was changed.');
    end if;
    if op = 'unlink' then
      rec := (rec - 'axiscare_id' - 'connected' - '_rev') || jsonb_build_object('connect_undone', jsonb_build_object('at', now(), 'by', v_by, 'axiscare_id', L.axiscare_id));
      select coalesce(jsonb_agg(case when x->>'id' = rid then rec || jsonb_build_object('id', x->'id') else x end), '[]'::jsonb) into newarr from jsonb_array_elements(cg) x;
      update public.app_data set data = newarr, updated_at = now() where key = 'caregivers';
      insert into public.caregiver_connect_blocked (axiscare_id, kind, record_id, by, log_id) values (L.axiscare_id, 'caregiver', rid, v_by, L.id)
        on conflict (axiscare_id, kind, record_id) do update set at = now(), by = excluded.by, log_id = excluded.log_id;
    else
      -- a moved or new record is undone only while nobody has changed it since
      if public.app_data_rev(rec) <> coalesce(L.rev_after, 0) then
        return jsonb_build_object('ok', false, 'reason', 'changed_since',
          'message', 'Someone has changed that Hub record since it was connected, so it was not undone. Tell Claude.');
      end if;
      if op = 'unmove' then
        select u.before into cand from public.caregiver_connect_undo u where u.log_id = L.id;
        if cand is null then
          return jsonb_build_object('ok', false, 'reason', 'not_found', 'message', 'The Background & References record from before the move was not kept, so nothing was changed. Tell Claude.');
        end if;
        if exists (select 1 from jsonb_array_elements(cd) x where x->>'id' = cand->>'id') then
          return jsonb_build_object('ok', false, 'reason', 'changed_since', 'message', 'They are already back in Background & References.');
        end if;
        update public.app_data set data = cd || jsonb_build_array(cand - '_rev'), updated_at = now() where key = 'candidates';
        insert into public.caregiver_connect_blocked (axiscare_id, kind, record_id, by, log_id) values (L.axiscare_id, 'candidate', cand->>'id', v_by, L.id)
          on conflict (axiscare_id, kind, record_id) do update set at = now(), by = excluded.by, log_id = excluded.log_id;
      else
        insert into public.caregiver_connect_blocked (axiscare_id, kind, record_id, by, log_id) values (L.axiscare_id, 'new', '', v_by, L.id)
          on conflict (axiscare_id, kind, record_id) do update set at = now(), by = excluded.by, log_id = excluded.log_id;
      end if;
      select coalesce(jsonb_agg(x), '[]'::jsonb) into newarr from jsonb_array_elements(cg) x where x->>'id' is distinct from rid;
      update public.app_data set data = newarr, updated_at = now() where key = 'caregivers';
    end if;
    update public.caregiver_connect_log set undone_at = now(), undone_by = v_by where id = L.id;
    insert into public.caregiver_connect_log (run_id, mode, action, result, axiscare_id, ax_name, how, record_kind, record_id, record_name, caregiver_id, by, undo_of)
    values (v_run, 'manual', op, 'done', L.axiscare_id, L.ax_name, 'manual', L.record_kind, L.record_id, L.record_name, L.caregiver_id, v_by, L.id)
    returning id into lid;
    return jsonb_build_object('ok', true, 'log_id', lid);
  end if;

  -- ── link / move / create ──
  if ax is null then raise exception 'caregiver_connect_apply: no AxisCare id' using errcode = '22023'; end if;
  v_name := left(coalesce(p->>'ax_name', ''), 200);
  if exists (select 1 from jsonb_array_elements(cg) x where jsonb_typeof(x) = 'object' and x->>'axiscare_id' = ax) then
    insert into public.caregiver_connect_log (run_id, mode, action, result, axiscare_id, ax_name, how, record_kind, record_id, why, by)
    values (v_run, v_mode, op, 'refused', ax, v_name, v_how, case when op = 'move' then 'candidate' else 'caregiver' end,
            coalesce(p->>'caregiver_id', p->>'candidate_id'), 'already connected to a Hub record', v_by);
    return jsonb_build_object('ok', false, 'reason', 'already_connected', 'message', 'This caregiver is already connected to a Hub record, so nothing was changed.');
  end if;

  if op = 'link' then
    rid := p->>'caregiver_id';
    select count(*) into n from jsonb_array_elements(cg) x where x->>'id' = rid;
    select x into rec from jsonb_array_elements(cg) x where x->>'id' = rid limit 1;
    if n <> 1 or coalesce(rec->>'axiscare_id', '') <> ''
       or (p ? 'base_rev' and jsonb_typeof(p->'base_rev') <> 'null' and public.app_data_rev(rec) <> (p->>'base_rev')::bigint) then
      insert into public.caregiver_connect_log (run_id, mode, action, result, axiscare_id, ax_name, how, record_kind, record_id, record_name, why, by)
      values (v_run, v_mode, 'link', 'refused', ax, v_name, v_how, 'caregiver', rid, trim(coalesce(rec->>'first', '') || ' ' || coalesce(rec->>'last', '')),
              case when n = 0 then 'that Hub record is gone' when n > 1 then 'two Hub records share that number'
                   when coalesce(rec->>'axiscare_id', '') <> '' then 'that Hub record is already connected to someone else'
                   else 'someone changed that Hub record a moment ago; tried again next hour' end, v_by);
      return jsonb_build_object('ok', false, 'reason', case when n = 0 then 'gone' when n > 1 then 'duplicate_id' when coalesce(rec->>'axiscare_id', '') <> '' then 'taken' else 'changed' end,
                                'message', 'That Hub record changed or is taken, so nothing was changed.');
    end if;
    rec := (rec - '_rev') || jsonb_build_object('axiscare_id', ax, 'connected', coalesce(p->'connected', jsonb_build_object('at', now(), 'by', v_by, 'how', v_how)));
    select coalesce(jsonb_agg(case when x->>'id' = rid then rec || jsonb_build_object('id', x->'id') else x end), '[]'::jsonb) into newarr from jsonb_array_elements(cg) x;
    update public.app_data set data = newarr, updated_at = now() where key = 'caregivers' returning data into outdata;
    select public.app_data_rev(x) into v_rev from jsonb_array_elements(outdata) x where x->>'id' = rid limit 1;
    insert into public.caregiver_connect_log (run_id, mode, action, result, axiscare_id, ax_name, how, record_kind, record_id, record_name, caregiver_id, by, rev_after)
    values (v_run, v_mode, 'link', 'done', ax, v_name, v_how, 'caregiver', rid, trim(coalesce(rec->>'first', '') || ' ' || coalesce(rec->>'last', '')), rid, v_by, v_rev)
    returning id into lid;
    return jsonb_build_object('ok', true, 'log_id', lid, 'caregiver_id', rid);
  end if;

  -- move and create add one record with a number from the counter
  rec := p->'record';
  if jsonb_typeof(rec) <> 'object' or rec->>'axiscare_id' is distinct from ax then
    raise exception 'caregiver_connect_apply: the new record must carry this AxisCare id' using errcode = '22023';
  end if;
  if op = 'move' then
    cid := p->>'candidate_id';
    select count(*) into n from jsonb_array_elements(cd) x where x->>'id' = cid;
    select x into cand from jsonb_array_elements(cd) x where x->>'id' = cid limit 1;
    if n <> 1 or rec->>'candidate_id' is distinct from cid
       or (p ? 'cand_base_rev' and jsonb_typeof(p->'cand_base_rev') <> 'null' and public.app_data_rev(cand) <> (p->>'cand_base_rev')::bigint) then
      insert into public.caregiver_connect_log (run_id, mode, action, result, axiscare_id, ax_name, how, record_kind, record_id, record_name, why, by)
      values (v_run, v_mode, 'move', 'refused', ax, v_name, v_how, 'candidate', cid, trim(coalesce(cand->>'first', '') || ' ' || coalesce(cand->>'last', '')),
              case when n = 0 then 'they are no longer in Background & References' when n > 1 then 'two candidates share that number'
                   when rec->>'candidate_id' is distinct from cid then 'the record was not built from this candidate'
                   else 'someone changed their Background & References record a moment ago; tried again next hour' end, v_by);
      return jsonb_build_object('ok', false, 'reason', case when n = 0 then 'gone' when n > 1 then 'duplicate_id' else 'changed' end,
                                'message', 'Their Background & References record changed, so nothing was changed.');
    end if;
  end if;
  select coalesce(max((v->>'id')::bigint), 0) into maxid from jsonb_array_elements(cg) v
   where jsonb_typeof(v) = 'object' and (v->>'id') ~ '^[0-9]{1,15}$';
  insert into public.app_data_id_counter (key, last_id) values ('caregivers', 0) on conflict (key) do nothing;
  select last_id into nxt from public.app_data_id_counter where key = 'caregivers' for update;
  nxt := greatest(coalesce(nxt, 0), maxid) + 1;
  update public.app_data_id_counter set last_id = nxt, updated_at = now() where key = 'caregivers';
  rec := (rec - '_rev' - 'id') || jsonb_build_object('id', nxt);
  update public.app_data set data = cg || jsonb_build_array(rec), updated_at = now() where key = 'caregivers' returning data into outdata;
  select public.app_data_rev(x) into v_rev from jsonb_array_elements(outdata) x where x->>'id' = nxt::text limit 1;
  if op = 'move' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into newarr from jsonb_array_elements(cd) x where x->>'id' is distinct from cid;
    update public.app_data set data = newarr, updated_at = now() where key = 'candidates';
  end if;
  insert into public.caregiver_connect_log (run_id, mode, action, result, axiscare_id, ax_name, how, record_kind, record_id, record_name, caregiver_id, by, rev_after)
  values (v_run, v_mode, op, 'done', ax, v_name, v_how, case when op = 'move' then 'candidate' else 'caregiver' end,
          case when op = 'move' then cid else nxt::text end,
          trim(coalesce(rec->>'first', '') || ' ' || coalesce(rec->>'last', '')), nxt::text, v_by, v_rev)
  returning id into lid;
  if op = 'move' then insert into public.caregiver_connect_undo (log_id, before) values (lid, cand); end if;
  return jsonb_build_object('ok', true, 'log_id', lid, 'caregiver_id', nxt);
end $fn$;

-- ── the current list: the newest "would do" (practice) or "needs a look" (live) list replaces the last one ──
drop function if exists public.caregiver_connect_practice(text, jsonb);
create or replace function public.caregiver_connect_practice(p_run text, p_rows jsonb, p_mode text default 'practice')
returns int
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $pr$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('caregiver_connect'));
  delete from public.caregiver_connect_log where result = 'would';
  insert into public.caregiver_connect_log (run_id, mode, action, result, axiscare_id, ax_name, how, record_kind, record_id, record_name, why, options, by)
  select p_run, case when p_mode = 'live' then 'live' else 'practice' end, r->>'action', 'would', r->>'axiscare_id', left(r->>'ax_name', 200), r->>'how', r->>'record_kind', r->>'record_id',
         left(r->>'record_name', 200), r->>'why', case when jsonb_typeof(r->'options') = 'array' then r->'options' end, 'auto'
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where r->>'action' in ('link', 'move', 'create', 'review') and (p_mode <> 'live' or r->>'action' = 'review');
  get diagnostics n = row_count;
  return n;
end $pr$;

revoke all on function public.caregiver_connect_apply(jsonb) from public, anon, authenticated;
revoke all on function public.caregiver_connect_practice(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.caregiver_connect_apply(jsonb) to service_role;
grant execute on function public.caregiver_connect_practice(text, jsonb, text) to service_role;

do $verify$
begin
  if to_regprocedure('public.app_data_rev(jsonb)') is null or to_regclass('public.app_data_id_counter') is null then
    raise exception '438 self-check: safe saving (421) is not installed';
  end if;
  if not exists (select 1 from pg_proc where proname = 'caregiver_connect_apply' and pronamespace = 'public'::regnamespace and prosecdef) then
    raise exception '438 self-check: caregiver_connect_apply must run as its owner';
  end if;
  if has_function_privilege('authenticated', 'public.caregiver_connect_apply(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.caregiver_connect_apply(jsonb)', 'execute') then
    raise exception '438 self-check: only the server may call caregiver_connect_apply';
  end if;
  if has_table_privilege('authenticated', 'public.caregiver_connect_undo', 'select') then
    raise exception '438 self-check: the undo copies must be server only';
  end if;
end $verify$;
