-- =============================================================================
-- staffing-foundation-parts.sql · READ ONLY (component list)
-- One md5 over every staffing object's definition and the effective privileges of
-- anon / authenticated / service_role. Identical installs give identical values,
-- so the same query run in production proves parity with the proven build.
-- =============================================================================
with
tabs(t) as (values ('staffing_need'),('staffing_ask'),('staffing_reply'),('staffing_assignment'),('staffing_assignment_sync'),('staffing_door_audit')),
views(v) as (values ('staffing_ask_current'),('staffing_need_status')),
roles(r) as (values ('anon'),('authenticated'),('service_role')),
privs(p) as (values ('select'),('insert'),('update'),('delete'),('truncate')),
fns as (
  select p.oid, p.oid::regprocedure::text as sig, p.prosrc, p.prosecdef, p.provolatile
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'staffing\_%' escape '\'
),
parts(k, p) as (
  select 'col', c.table_name || '|' || c.column_name || '|' || c.data_type || '|' || c.is_nullable
                || '|' || coalesce(c.column_default, '')
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name in (select t from tabs union select v from views)
  union all
  select 'constraint', con.conrelid::regclass::text || '|' || con.conname || '|' || pg_get_constraintdef(con.oid)
    from pg_constraint con where con.conrelid in (select ('public.' || t)::regclass from tabs where to_regclass('public.' || t) is not null)
  union all
  select 'index', i.tablename || '|' || i.indexname || '|' || i.indexdef
    from pg_indexes i where i.schemaname = 'public' and i.tablename in (select t from tabs)
  union all
  select 'trigger', tg.tgrelid::regclass::text || '|' || tg.tgname || '|' || pg_get_triggerdef(tg.oid)
    from pg_trigger tg where not tg.tgisinternal
     and tg.tgrelid in (select ('public.' || t)::regclass from tabs where to_regclass('public.' || t) is not null)
  union all
  select 'function', f.sig || '|' || md5(f.prosrc) || '|' || f.prosecdef || '|' || f.provolatile::text from fns f
  union all
  select 'view', c.relname || '|' || md5(pg_get_viewdef(c.oid)) || '|' || coalesce(array_to_string(c.reloptions, ','), '')
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v' and c.relname in (select v from views)
  union all
  select 'table_priv', x.t || '|' || r.r || '|' || pv.p || '|' || has_table_privilege(r.r, 'public.' || x.t, pv.p)
    from (select t from tabs union select v from views) x(t), roles r, privs pv
   where to_regclass('public.' || x.t) is not null
  union all
  select 'function_priv', f.sig || '|' || r.r || '|' || has_function_privilege(r.r, f.oid, 'execute') from fns f, roles r
  union all
  select 'rls', c.relname || '|' || c.relrowsecurity || '|' || c.relforcerowsecurity
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in (select t from tabs)
  union all
  select 'policy', pol.tablename || '|' || pol.policyname || '|' || pol.cmd || '|' || pol.roles::text || '|' || coalesce(pol.qual, '')
    from pg_policies pol where pol.schemaname = 'public' and pol.tablename in (select t from tabs)
  union all
  select 'comment', coalesce(obj_description(('public.' || t)::regclass, 'pg_class'), '')
    from tabs where t = 'staffing_need' and to_regclass('public.staffing_need') is not null
)
select k, p from parts order by k, p;
