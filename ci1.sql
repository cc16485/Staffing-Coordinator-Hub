-- =============================================================================
-- CI1 · CALL-INS: THE SAFE FILL (Desktop 434). Samantha approved the call-ins plan 2026-10-03 ("yes to all").
-- SHARED HUB PROJECT. Safe to run again. One transaction (the installer wraps it).
-- =============================================================================
-- Why: a coverage case lives inside app_data 'coverage_cases', and every writer (the Hub board, coverage-run,
-- coverage-reply, coverage-watch, coverage-assign) saves a WHOLE copy of a case it read earlier. So:
--   * two people confirming at once both "won", the second overwriting the first (and in AxisCare too);
--   * a stale copy could undo a fill (put a covered case back to open), or wipe a YES that arrived meanwhile.
-- This adds, for 'coverage_cases' only:
--   1. coverage_cases_guard: a BEFORE UPDATE rule on the app_data row that, case by case, keeps
--        R1  a closed case closed, unless the save carries reopened_from = that close's resolved_at (a person saw the
--            close and reopened it: the Hub's Reopen and "They backed out" set it);
--        R2  the FIRST close: a second close with a different resolved_at is refused (the case keeps the first);
--        R4  a reopen: a close that is the very one this case was reopened from is refused (a stale copy);
--        R3  every caregiver's answer: an ask missing from the save is put back, and an ask whose reply the save
--            lacks gets the reply back (state, reply, replied_at).
--      Whatever it keeps or puts back is written to coverage_case_guard_log (when, case, rule, what). Writers are not
--      refused as a whole: everything else in their save goes in.
--   2. coverage_case_patch(id, patch, expect): changes only the given fields of one case, under the row lock, and only
--      when the case still matches `expect` (e.g. {"status":"open"}); otherwise it changes nothing and hands back the
--      case as it is now. The server's Confirm and Close use it, so exactly one person's confirm wins.
--   3. coverage_case_add_ask / coverage_case_remove_ask: record a caregiver ask BEFORE texting, under the lock, only if
--      that person (same number, or same AxisCare id) hasn't been asked on this case; removed again if the text fails.
--      Two coordinators sending at once can no longer text the same caregiver twice.
-- Nothing else changes: other keys, other hubs, the shape of a case, and every writer keep working as before.
-- =============================================================================
set local lock_timeout = '5s';

create table if not exists public.coverage_case_guard_log (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  case_id text,
  rule    text not null,
  detail  jsonb not null default '{}'::jsonb
);
comment on table public.coverage_case_guard_log is
  'CI1 · what the coverage case guard kept or put back when a save carried an older copy of a case (R1 closed stays closed, R2 first close wins, R3 answers kept, R4 a reopen stays open).';
alter table public.coverage_case_guard_log enable row level security;
drop policy if exists coverage_case_guard_log_read on public.coverage_case_guard_log;
create policy coverage_case_guard_log_read on public.coverage_case_guard_log for select to authenticated using (true);
revoke all on public.coverage_case_guard_log from anon, authenticated;
grant select on public.coverage_case_guard_log to authenticated;
grant all on public.coverage_case_guard_log to service_role;
grant usage, select on sequence public.coverage_case_guard_log_id_seq to service_role;

create or replace function public.coverage_case_closed(x jsonb) returns boolean
language sql immutable set search_path = pg_catalog, public as $c$
  select coalesce(x->>'status', '') in ('done', 'resolved')
$c$;

/* R3 · keep every caregiver's answer. */
create or replace function public.coverage_asks_merge(p_case text, oa jsonb, na jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $m$
declare
  o jsonb; n jsonb; outa jsonb := '[]'::jsonb; ids text[] := '{}'; restored int := 0; replies int := 0;
  allow_remove text := coalesce(current_setting('cc.coverage_remove_ask', true), '');
begin
  if jsonb_typeof(oa) is distinct from 'array' then return na; end if;
  if jsonb_typeof(na) is distinct from 'array' then na := '[]'::jsonb; end if;
  for n in select x from jsonb_array_elements(na) x loop
    if jsonb_typeof(n) = 'object' and coalesce(n->>'id', '') <> '' then
      ids := ids || (n->>'id');
      select x into o from jsonb_array_elements(oa) x where jsonb_typeof(x) = 'object' and x->>'id' = n->>'id' limit 1;
      if o is not null and coalesce(o->>'replied_at', '') <> '' and coalesce(n->>'replied_at', '') = '' then
        n := n || jsonb_build_object('state', o->'state', 'replied_at', o->'replied_at')
               || case when o ? 'reply' then jsonb_build_object('reply', o->'reply') else '{}'::jsonb end
               || case when o ? 'was_yes' then jsonb_build_object('was_yes', o->'was_yes') else '{}'::jsonb end;
        replies := replies + 1;
      end if;
      o := null;
    end if;
    outa := outa || jsonb_build_array(n);
  end loop;
  for o in select x from jsonb_array_elements(oa) x loop
    if jsonb_typeof(o) = 'object' and coalesce(o->>'id', '') <> '' and not (o->>'id' = any(ids)) and o->>'id' <> allow_remove then
      outa := outa || jsonb_build_array(o); restored := restored + 1;
    end if;
  end loop;
  if restored > 0 or replies > 0 then
    insert into public.coverage_case_guard_log(case_id, rule, detail)
      values (p_case, 'R3_answers_kept', jsonb_build_object('asks_put_back', restored, 'replies_put_back', replies));
  end if;
  return outa;
end $m$;

create or replace function public.coverage_cases_guard(od jsonb, nd jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $g$
declare
  e jsonb; o jsonb; outd jsonb := '[]'::jsonb; dup text[];
begin
  if jsonb_typeof(od) is distinct from 'array' or jsonb_typeof(nd) is distinct from 'array' then return nd; end if;
  /* ids that appear more than once on either side are left exactly as written (no guessing) */
  select coalesce(array_agg(id), '{}') into dup from (
    select x->>'id' id from jsonb_array_elements(od) x where jsonb_typeof(x) = 'object' group by 1 having count(*) > 1
    union select x->>'id' from jsonb_array_elements(nd) x where jsonb_typeof(x) = 'object' group by 1 having count(*) > 1) d;
  for e in select x from jsonb_array_elements(nd) x loop
    o := null;
    if jsonb_typeof(e) = 'object' and coalesce(e->>'id', '') <> '' and not (e->>'id' = any(dup)) then
      select x into o from jsonb_array_elements(od) x where jsonb_typeof(x) = 'object' and x->>'id' = e->>'id' limit 1;
    end if;
    if o is null or o = e then outd := outd || jsonb_build_array(e); continue; end if;
    /* R1 · closed stays closed, unless this save reopens exactly that close */
    if public.coverage_case_closed(o) and not public.coverage_case_closed(e)
       and not (coalesce(o->>'resolved_at', '') <> '' and coalesce(e->>'reopened_from', '') = o->>'resolved_at') then
      insert into public.coverage_case_guard_log(case_id, rule, detail) values (o->>'id', 'R1_closed_stays_closed',
        jsonb_build_object('kept_status', o->'status', 'kept_covered_by', o->'covered_by', 'save_status', e->'status'));
      outd := outd || jsonb_build_array(o); continue;
    end if;
    /* R2 · the first close wins */
    if public.coverage_case_closed(o) and public.coverage_case_closed(e)
       and coalesce(e->>'resolved_at', '') <> coalesce(o->>'resolved_at', '') then
      insert into public.coverage_case_guard_log(case_id, rule, detail) values (o->>'id', 'R2_first_close_wins',
        jsonb_build_object('kept_covered_by', o->'covered_by', 'kept_how', o->'resolved_how', 'save_covered_by', e->'covered_by', 'save_how', e->'resolved_how'));
      outd := outd || jsonb_build_array(o); continue;
    end if;
    /* R4 · a reopen stays open against the stale copy of the close it reopened */
    if not public.coverage_case_closed(o) and public.coverage_case_closed(e)
       and coalesce(o->>'reopened_from', '') <> '' and coalesce(e->>'resolved_at', '') = o->>'reopened_from' then
      insert into public.coverage_case_guard_log(case_id, rule, detail) values (o->>'id', 'R4_reopen_stays_open',
        jsonb_build_object('save_covered_by', e->'covered_by'));
      outd := outd || jsonb_build_array(o); continue;
    end if;
    /* R3 · every answer kept */
    if o ? 'asked' then e := e || jsonb_build_object('asked', public.coverage_asks_merge(o->>'id', o->'asked', e->'asked')); end if;
    outd := outd || jsonb_build_array(e);
  end loop;
  return outd;
end $g$;

create or replace function public.coverage_cases_guard_trg() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $t$
begin
  if new.key = 'coverage_cases' and new.data is distinct from old.data then
    begin
      new.data := public.coverage_cases_guard(old.data, new.data);
    exception when others then
      raise warning 'coverage_cases_guard: could not check this save (it goes through as written): %', sqlerrm;
    end;
  end if;
  return new;
end $t$;
drop trigger if exists coverage_cases_guard_t on public.app_data;
create trigger coverage_cases_guard_t before update on public.app_data
  for each row when (new.key = 'coverage_cases') execute function public.coverage_cases_guard_trg();

/* one case: change only these fields, only if it still matches `expect` */
create or replace function public.coverage_case_patch(p_id text, p_patch jsonb, p_expect jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $p$
declare d jsonb; i int; item jsonb; k text; nitem jsonb;
begin
  if coalesce(p_id, '') = '' or jsonb_typeof(p_patch) is distinct from 'object' then return jsonb_build_object('outcome', 'bad_request'); end if;
  perform set_config('lock_timeout', '3s', true);
  select data into d from public.app_data where key = 'coverage_cases' for update;
  if jsonb_typeof(d) is distinct from 'array' then return jsonb_build_object('outcome', 'not_found'); end if;
  select (t.ord - 1)::int, t.x into i, item from jsonb_array_elements(d) with ordinality t(x, ord)
   where jsonb_typeof(t.x) = 'object' and t.x->>'id' = p_id limit 1;
  if item is null then return jsonb_build_object('outcome', 'not_found'); end if;
  for k in select jsonb_object_keys(coalesce(p_expect, '{}'::jsonb)) loop
    if coalesce(item->k, 'null'::jsonb) is distinct from coalesce(p_expect->k, 'null'::jsonb) then
      return jsonb_build_object('outcome', 'conflict', 'item', item);
    end if;
  end loop;
  nitem := item || p_patch;
  update public.app_data set data = jsonb_set(d, array[i::text], nitem), updated_at = now() where key = 'coverage_cases';
  select x into nitem from public.app_data a, jsonb_array_elements(a.data) x where a.key = 'coverage_cases' and x->>'id' = p_id limit 1;
  return jsonb_build_object('outcome', 'ok', 'item', nitem);
end $p$;

/* one ask, recorded BEFORE the text goes, only once per person per case */
create or replace function public.coverage_case_add_ask(p_id text, p_ask jsonb) returns text
language plpgsql security definer set search_path = pg_catalog, public as $a$
declare d jsonb; i int; item jsonb; ph text; ax text;
begin
  if coalesce(p_id, '') = '' or jsonb_typeof(p_ask) is distinct from 'object' or coalesce(p_ask->>'id', '') = '' then return 'bad_request'; end if;
  perform set_config('lock_timeout', '3s', true);
  select data into d from public.app_data where key = 'coverage_cases' for update;
  select (t.ord - 1)::int, t.x into i, item from jsonb_array_elements(coalesce(d, '[]'::jsonb)) with ordinality t(x, ord)
   where jsonb_typeof(t.x) = 'object' and t.x->>'id' = p_id limit 1;
  if item is null then return 'not_found'; end if;
  if coalesce(item->>'status', '') <> 'open' then return 'not_open'; end if;
  ph := right(regexp_replace(coalesce(p_ask->>'phone', ''), '\D', '', 'g'), 10);
  ax := coalesce(p_ask->>'axiscare_id', '');
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(item->'asked') = 'array' then item->'asked' else '[]'::jsonb end) a
              where (length(ph) = 10 and right(regexp_replace(coalesce(a->>'phone', ''), '\D', '', 'g'), 10) = ph)
                 or (ax <> '' and coalesce(a->>'axiscare_id', '') = ax)
                 or a->>'id' = p_ask->>'id') then
    return 'already_asked';
  end if;
  item := item || jsonb_build_object('asked', case when jsonb_typeof(item->'asked') = 'array' then item->'asked' else '[]'::jsonb end || jsonb_build_array(p_ask));
  if coalesce(item->>'callout_started_at', '') = '' then item := item || jsonb_build_object('callout_started_at', p_ask->'at'); end if;
  update public.app_data set data = jsonb_set(d, array[i::text], item), updated_at = now() where key = 'coverage_cases';
  return 'added';
end $a$;

create or replace function public.coverage_case_remove_ask(p_id text, p_ask_id text) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $r$
declare d jsonb; i int; item jsonb; na jsonb;
begin
  perform set_config('lock_timeout', '3s', true);
  select data into d from public.app_data where key = 'coverage_cases' for update;
  select (t.ord - 1)::int, t.x into i, item from jsonb_array_elements(coalesce(d, '[]'::jsonb)) with ordinality t(x, ord)
   where jsonb_typeof(t.x) = 'object' and t.x->>'id' = p_id limit 1;
  if item is null or jsonb_typeof(item->'asked') is distinct from 'array' then return false; end if;
  select coalesce(jsonb_agg(a), '[]'::jsonb) into na from jsonb_array_elements(item->'asked') a where a->>'id' is distinct from p_ask_id;
  if na = item->'asked' then return false; end if;
  perform set_config('cc.coverage_remove_ask', p_ask_id, true);   -- the guard lets exactly this ask go
  update public.app_data set data = jsonb_set(d, array[i::text], item || jsonb_build_object('asked', na)), updated_at = now() where key = 'coverage_cases';
  perform set_config('cc.coverage_remove_ask', '', true);
  return true;
end $r$;

revoke all on function public.coverage_case_patch(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.coverage_case_add_ask(text, jsonb) from public, anon, authenticated;
revoke all on function public.coverage_case_remove_ask(text, text) from public, anon, authenticated;
revoke all on function public.coverage_cases_guard(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.coverage_asks_merge(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.coverage_case_patch(text, jsonb, jsonb) to service_role;
grant execute on function public.coverage_case_add_ask(text, jsonb) to service_role;
grant execute on function public.coverage_case_remove_ask(text, text) to service_role;
