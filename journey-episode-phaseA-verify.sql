-- ============================================================================
-- Phase A landing verification  (READ ONLY — writes nothing)
-- Run in the Supabase SQL editor AFTER running journey-episode-phaseA.sql.
-- One result grid of (check, detail). Expected values noted in comments.
-- ============================================================================
select 'tables created' as check,
       coalesce(string_agg(tablename, ', ' order by tablename), '(none)') as detail
  from pg_tables where schemaname='public'
   and tablename in ('journey_episode','episode_source','episode_door_audit')
  -- expect: episode_door_audit, episode_source, journey_episode

union all
select 'functions created',
       coalesce(string_agg(proname, ', ' order by proname), '(none)')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'
   and proname in ('journey_episode_guard','episode_open_provisional','episode_resolve',
                   'episode_attach_source','episode_set_state','episode_void')
  -- expect: all 6

union all
select 'journey_episode rows', count(*)::text from journey_episode
  -- expect: 0  (shadow, empty)

union all
select 'RLS enabled (journey_episode)',
       (select case when relrowsecurity then 'yes' else 'no' end from pg_class where relname='journey_episode')
  -- expect: yes

union all
select 'RLS enabled (episode_source)',
       (select case when relrowsecurity then 'yes' else 'no' end from pg_class where relname='episode_source')
  -- expect: yes

union all
select 'door is service_role-only',
       case when bool_and(has_function_privilege('service_role', p.oid, 'execute'))
             and not bool_or(has_function_privilege('authenticated', p.oid, 'execute'))
            then 'yes' else 'NO — check grants' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'
   and proname in ('episode_open_provisional','episode_resolve','episode_attach_source','episode_set_state','episode_void')
  -- expect: yes  (service_role can EXECUTE, authenticated cannot)

union all
select 'guard trigger present',
       case when exists (select 1 from pg_trigger where tgname='journey_episode_guard_t') then 'yes' else 'no' end
  -- expect: yes

union all
select 'key indexes present',
       coalesce(string_agg(indexname, ', ' order by indexname), '(none)')
  from pg_indexes
 where indexname in ('journey_episode_one_active_uq','journey_episode_person_seq_uq',
                     'episode_source_uq','episode_source_one_origin_uq')
  -- expect: all 4

order by 1;
