-- =============================================================================
-- 443 · SAFE SAVES STEP 6: START FORMS IMPORT THEMSELVES. Samantha approved the safe saves plan 2026-10-04 ("yes to all")
-- and chose option 1 ("go with 1"): only start forms from people we sent a start link to (a job offer has their email
-- or phone) are imported; everything else is a Needs Attention card. Her Oct 2 rules: already in Background &
-- References, already hired, or marked not hired = a card only, nothing updated, nobody added back. The decisions live
-- in the Hub's own intake-import-rules.js (run by the server only when its fingerprint is approved).
--
--   hire_intake.auto_import_at / _result / _candidate_id   what the check did with each start form
--   candidate_import_apply(intake_id, record, by)          the ONLY writer: adds the candidate (a number from the 421
--       counter) AND marks the start form imported (seen_at) in one step, all or nothing, one at a time; refuses a
--       form that is already imported (any candidate or roster record carries its id) or already seen
--   intake_import_log / intake_import_runs                 what it would do (practice) or did, and each run (staff read)
--   intake_import_practice(run, rows)                      the newest "would do" list replaces the last one
-- Never reads or writes the SSN. Sends nothing. Safe to run again.
-- =============================================================================
alter table public.hire_intake add column if not exists auto_import_at timestamptz;
alter table public.hire_intake add column if not exists auto_import_result text;
alter table public.hire_intake add column if not exists auto_import_candidate_id bigint;

create table if not exists public.intake_import_runs (
  id bigserial primary key, at timestamptz not null default now(), run_id text not null,
  mode text not null check (mode in ('practice', 'live')), caller text, ok boolean not null,
  seen int not null default 0, imported int not null default 0, cards int not null default 0, done int not null default 0, error text
);
create table if not exists public.intake_import_log (
  id bigserial primary key, at timestamptz not null default now(), run_id text,
  mode text not null check (mode in ('practice', 'live')),
  intake_id text not null, who text,
  action text not null check (action in ('import', 'card', 'done')),
  reason text, result text not null check (result in ('would', 'done', 'failed')),
  candidate_id bigint, detail text
);
create index if not exists intake_import_log_at_ix on public.intake_import_log (at desc);
create index if not exists intake_import_runs_at_ix on public.intake_import_runs (at desc);
alter table public.intake_import_runs enable row level security;
alter table public.intake_import_log enable row level security;
revoke all on public.intake_import_runs, public.intake_import_log from public, anon, authenticated;
revoke all on sequence public.intake_import_runs_id_seq, public.intake_import_log_id_seq from public, anon, authenticated;
grant select on public.intake_import_runs, public.intake_import_log to authenticated;
grant all on public.intake_import_runs, public.intake_import_log to service_role;
grant usage, select on sequence public.intake_import_runs_id_seq, public.intake_import_log_id_seq to service_role;
drop policy if exists intake_import_runs_read on public.intake_import_runs;
create policy intake_import_runs_read on public.intake_import_runs for select to authenticated using (true);
drop policy if exists intake_import_log_read on public.intake_import_log;
create policy intake_import_log_read on public.intake_import_log for select to authenticated using (true);

create or replace function public.candidate_import_apply(p_intake_id text, p_record jsonb, p_by text default 'auto', p_run text default null)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $fn$
declare cd jsonb; cg jsonb; seen timestamptz; nxt bigint; maxid bigint; rec jsonb; v_who text; found_row boolean;
begin
  if p_intake_id is null or p_intake_id = '' or jsonb_typeof(p_record) <> 'object' then
    raise exception 'candidate_import_apply: a start form and a record are needed' using errcode = '22023';
  end if;
  if p_record->>'intake_id' is distinct from p_intake_id then
    raise exception 'candidate_import_apply: the record was not built from this start form' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('intake_import'));
  insert into public.app_data (key, data, updated_at) values ('candidates', '[]'::jsonb, now()) on conflict (key) do nothing;
  select data into cd from public.app_data where key = 'candidates' for update;
  select data into cg from public.app_data where key = 'caregivers' for update;
  select true, h.seen_at into found_row, seen from public.hire_intake h where h.id::text = p_intake_id for update;
  if not coalesce(found_row, false) then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  if exists (select 1 from jsonb_array_elements(coalesce(cd, '[]'::jsonb)) x where x->>'intake_id' = p_intake_id)
     or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(cg) = 'array' then cg else '[]'::jsonb end) x where x->>'intake_id' = p_intake_id) then
    update public.hire_intake set auto_import_at = coalesce(auto_import_at, now()), auto_import_result = coalesce(auto_import_result, 'done') where id::text = p_intake_id;
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;
  if seen is not null then return jsonb_build_object('ok', false, 'reason', 'seen'); end if;
  select coalesce(max((v->>'id')::bigint), 0) into maxid from jsonb_array_elements(coalesce(cd, '[]'::jsonb)) v
   where jsonb_typeof(v) = 'object' and (v->>'id') ~ '^[0-9]{1,15}$';
  insert into public.app_data_id_counter (key, last_id) values ('candidates', 0) on conflict (key) do nothing;
  select last_id into nxt from public.app_data_id_counter where key = 'candidates' for update;
  nxt := greatest(coalesce(nxt, 0), maxid) + 1;
  update public.app_data_id_counter set last_id = nxt, updated_at = now() where key = 'candidates';
  rec := (p_record - '_rev' - 'id') || jsonb_build_object('id', nxt);
  update public.app_data set data = coalesce(cd, '[]'::jsonb) || jsonb_build_array(rec), updated_at = now() where key = 'candidates';
  update public.hire_intake set seen_at = now(), auto_import_at = now(), auto_import_result = 'imported', auto_import_candidate_id = nxt where id::text = p_intake_id;
  v_who := trim(coalesce(rec->>'first', '') || ' ' || left(coalesce(rec->>'last', ''), 1));
  insert into public.intake_import_log (run_id, mode, intake_id, who, action, reason, result, candidate_id, detail)
  values (p_run, 'live', p_intake_id, v_who, 'import', 'new', 'done', nxt, 'by ' || left(coalesce(p_by, 'auto'), 120));
  return jsonb_build_object('ok', true, 'candidate_id', nxt);
end $fn$;

create or replace function public.intake_import_practice(p_run text, p_rows jsonb)
returns int
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $pr$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('intake_import'));
  delete from public.intake_import_log where result = 'would';
  insert into public.intake_import_log (run_id, mode, intake_id, who, action, reason, result, detail)
  select p_run, 'practice', r->>'intake_id', left(r->>'who', 80), r->>'action', r->>'reason', 'would', left(r->>'detail', 300)
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r where r->>'action' in ('import', 'card', 'done') and coalesce(r->>'intake_id', '') <> '';
  get diagnostics n = row_count;
  return n;
end $pr$;

revoke all on function public.candidate_import_apply(text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.intake_import_practice(text, jsonb) from public, anon, authenticated;
grant execute on function public.candidate_import_apply(text, jsonb, text, text) to service_role;
grant execute on function public.intake_import_practice(text, jsonb) to service_role;
do $v$ begin
  if has_function_privilege('authenticated', 'public.candidate_import_apply(text, jsonb, text, text)', 'execute') then
    raise exception '443 self-check: only the server may call candidate_import_apply';
  end if;
  if to_regclass('public.app_data_id_counter') is null then raise exception '443 self-check: safe saving (421) is not installed'; end if;
end $v$;
