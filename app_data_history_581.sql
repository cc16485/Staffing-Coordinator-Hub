-- =============================================================================
-- 581 · PHASE 1 SLICE 2 · CHANGE HISTORY FOR THE OPERATIONAL RECORDS
-- =============================================================================
-- Why (Phase 1 design, section 2, approved 2026-10-10): the change history that
-- 418 put on candidates and caregivers is the only "who touched this and when"
-- the Hub has. Work items, leads, coverage cases and the rest are saved through
-- upsert_app_data_item, which records nothing. This extends the SAME table and
-- the SAME watcher to the operational keys, so every save of them leaves:
--   at, key, record_id, change ('added' | 'removed' | 'changed'),
--   fields_changed (field NAMES only, never values), bulk_removed,
--   actor (the signed-in email, else the user id, else 'server'), role, origin.
--
-- The keys (the design's list; family circles are their own tables with their
-- own link log, so they are not app_data and not here):
--   lists of records (one line per record added / removed / changed):
--     candidates, caregivers            (unchanged from 418)
--     ops_items                         work items
--     leads                             leads
--     coverage_cases                    call-off / coverage cases
--     timekeeper_cases                  missed clock-in cases
--     staffing_plans                    staffing plans
--     visit_changes                     visit changes
--   one settings record (one 'changed' line naming the settings that changed):
--     ops_settings                      the office settings and switches
-- Every other key (logs, heartbeats, watch states, recordings) is untouched:
-- the triggers' WHEN clause does not even call the watcher for them.
--
-- Names: kept (first + last only) for added / removed people in candidates,
-- caregivers and leads, as 418 does. For every other key no name is kept.
-- No phone, email, SSN, date of birth, note text or any field value is copied.
--
-- IT ONLY WATCHES, exactly as 418: after the save, never changes or blocks it.
-- If anything inside fails, the save still goes through and one 'trigger_error'
-- line is written instead (and if even that fails, a database-log warning).
--
-- Speed: the 418 watcher indexed the whole old and new list by id on every save.
-- That is fine for 60 people but not for a long work-item list saved one item at
-- a time. This one first compares the two lists position by position and only
-- indexes the records at positions that differ (one record for a normal save of
-- one item). The result is the same: a record that sits unchanged at the same
-- position in both lists cannot have been added, removed or changed. (When a
-- record is removed from the middle, every later position differs and it falls
-- back to the full comparison, which is what 418 always did.)
--
-- Who can read it: unchanged from 418 (signed in, and only for a key you can
-- read; anon nothing; browsers never write; the server can).
--
-- RETENTION: unchanged. Kept; no automatic purge (Phase 1 design section 11:
-- seven years is the planning baseline, nothing is archived or deleted without
-- an approved, separate step).
--
-- Safe to run again. One transaction. Rollback: app_data_history_581_rollback.sql
-- (puts the 418 watcher back: candidates and caregivers only; history lines
-- already written stay).
-- =============================================================================

begin;

do $pre$
begin
  if to_regclass('public.app_data_item_change') is null then
    raise exception '581 refused: the 418 change history is not installed (app_data_item_change missing). Nothing was changed.';
  end if;
end $pre$;

comment on table public.app_data_item_change is
  '418 + 581 · record-only history of app_data saves for candidates, caregivers and the operational keys (ops_items, leads, coverage_cases, timekeeper_cases, staffing_plans, visit_changes, ops_settings): added/removed/changed per record, field names only, never values. Written only by app_data_item_change_capture(). No auto-purge.';
-- the History drawer (Slice 4) reads one record's lines newest first
create index if not exists app_data_item_change_key_rec_at_ix on public.app_data_item_change (key, record_id, at desc);

create or replace function public.app_data_item_change_capture() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $fn$
declare
  k text; od jsonb; nd jsonb; om jsonb; nm jsonb; claims jsonb; hdrs jsonb; f text[];
  v_actor text := 'server'; v_role text := 'database'; v_origin text; gone int; bulk boolean; named boolean;
begin
  if tg_op = 'DELETE' then k := old.key; else k := new.key; end if;
  if k is null or k not in ('candidates', 'caregivers', 'ops_items', 'leads', 'coverage_cases', 'timekeeper_cases',
                            'staffing_plans', 'visit_changes', 'ops_settings') then return null; end if;
  begin
    /* who and from where (each read on its own, so a bad header can never stop the record) */
    begin claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then claims := null; end;
    begin hdrs := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then hdrs := null; end;
    v_role := coalesce(nullif(claims->>'role', ''), 'database');
    v_actor := left(coalesce(nullif(claims->>'email', ''), nullif(claims->>'sub', ''), 'server'), 200);
    v_origin := left(coalesce(nullif(hdrs->>'origin', ''), substring(hdrs->>'referer' from '^(https?://[^/?#]+)')), 200);

    /* the settings record: one object; one line naming the settings that changed */
    if k = 'ops_settings' then
      od := case when tg_op in ('UPDATE', 'DELETE') and jsonb_typeof(old.data) = 'object' then old.data else '{}'::jsonb end;
      nd := case when tg_op in ('INSERT', 'UPDATE') and jsonb_typeof(new.data) = 'object' then new.data else '{}'::jsonb end;
      if od = nd then return null; end if;
      select array_agg(s.fk order by s.fk) into f
        from (select jsonb_object_keys(od) as fk union select jsonb_object_keys(nd)) s
       where (od->s.fk) is distinct from (nd->s.fk);
      if f is not null then
        insert into public.app_data_item_change (key, record_id, change, fields_changed, actor, role, origin)
        values (k, null, 'changed', f, v_actor, v_role, v_origin);
      end if;
      return null;
    end if;

    /* lists of records */
    od := case when tg_op in ('UPDATE', 'DELETE') and jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end;
    nd := case when tg_op in ('INSERT', 'UPDATE') and jsonb_typeof(new.data) = 'array' then new.data else '[]'::jsonb end;
    if od = nd then return null; end if;
    named := k in ('candidates', 'caregivers', 'leads');

    /* only the records at positions that differ, each side keyed by id */
    with d as (
      select o.e as oe, n.e as ne
        from jsonb_array_elements(od) with ordinality o(e, i)
        full join jsonb_array_elements(nd) with ordinality n(e, i) on n.i = o.i
       where o.e is distinct from n.e)
    select coalesce(jsonb_object_agg(oe->>'id', oe) filter (where jsonb_typeof(oe) = 'object' and coalesce(oe->>'id', '') <> ''), '{}'::jsonb),
           coalesce(jsonb_object_agg(ne->>'id', ne) filter (where jsonb_typeof(ne) = 'object' and coalesce(ne->>'id', '') <> ''), '{}'::jsonb)
      into om, nm from d;

    select count(*) into gone from jsonb_object_keys(om) i where not nm ? i;
    bulk := gone > 2;

    insert into public.app_data_item_change (key, record_id, change, fields_changed, bulk_removed, actor, role, origin, names)
    select k, i, 'removed', null::text[], bulk, v_actor, v_role, v_origin, case when named then public.app_data_item_name(om->i) end
      from jsonb_object_keys(om) i where not nm ? i
    union all
    select k, i, 'added', null::text[], false, v_actor, v_role, v_origin, case when named then public.app_data_item_name(nm->i) end
      from jsonb_object_keys(nm) i where not om ? i
    union all
    select k, i, 'changed', fc.fields, false, v_actor, v_role, v_origin, null::text
      from jsonb_object_keys(nm) i
      cross join lateral (
        select array_agg(s.fk order by s.fk) as fields
          from (select jsonb_object_keys(om->i) as fk union select jsonb_object_keys(nm->i)) s
         where (om->i->s.fk) is distinct from (nm->i->s.fk)) fc
     where om ? i and (om->i) is distinct from (nm->i) and fc.fields is not null;
  exception when others then
    begin
      insert into public.app_data_item_change (key, change, actor, role, origin, error)
      values (k, 'trigger_error', coalesce(v_actor, 'server'), v_role, v_origin, left(sqlerrm, 200));
    exception when others then
      raise warning 'app_data_item_change: could not even record the error (the save itself went through): %', sqlerrm;
    end;
  end;
  return null;
end $fn$;

drop trigger if exists app_data_item_change_t on public.app_data;
create trigger app_data_item_change_t after insert or update of data on public.app_data
  for each row when (new.key in ('candidates', 'caregivers', 'ops_items', 'leads', 'coverage_cases', 'timekeeper_cases',
                                 'staffing_plans', 'visit_changes', 'ops_settings'))
  execute function public.app_data_item_change_capture();
drop trigger if exists app_data_item_change_del_t on public.app_data;
create trigger app_data_item_change_del_t after delete on public.app_data
  for each row when (old.key in ('candidates', 'caregivers', 'ops_items', 'leads', 'coverage_cases', 'timekeeper_cases',
                                 'staffing_plans', 'visit_changes', 'ops_settings'))
  execute function public.app_data_item_change_capture();

revoke all on function public.app_data_item_change_capture() from public, anon, authenticated, service_role;

do $verify$
declare d text;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'app_data_item_change_capture' and p.prosecdef) then
    raise exception '581 self-check: the watcher must run as its owner';
  end if;
  select pg_get_triggerdef(oid) into d from pg_trigger where tgrelid = 'public.app_data'::regclass and tgname = 'app_data_item_change_t';
  if d is null or d !~ 'ops_items' or d !~ 'ops_settings' or d !~ 'candidates' then
    raise exception '581 self-check: the watcher is not attached to the operational keys';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.app_data'::regclass
        and tgname in ('app_data_item_change_t', 'app_data_item_change_del_t') and not tgisinternal) <> 2 then
    raise exception '581 self-check: the watcher is not attached';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.app_data_item_change'::regclass) then
    raise exception '581 self-check: row security is off';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'app_data_item_change'
              and ((grantee in ('authenticated', 'PUBLIC') and privilege_type <> 'SELECT') or grantee = 'anon')) then
    raise exception '581 self-check: a browser could write the history, or anon could read it';
  end if;
  raise notice '581 installed: the change history now watches candidates, caregivers and the 7 operational keys';
end $verify$;

commit;
