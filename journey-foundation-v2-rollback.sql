-- =============================================================================
-- journey-foundation-v2-rollback.sql · removes the v2 Journey foundation
-- Same empty-foundation guard as the migration: if ANY Journey table holds a
-- row, it refuses and changes nothing. It never drops with CASCADE.
--
-- RECOVERY: after this runs, no Journey foundation exists. To return to the
-- deployed Phase A state, run journey-episode-phaseA.sql (archived). To go
-- forward again, run journey-foundation-v2.sql.
-- =============================================================================
begin;

do $guard$
declare t text; n bigint;
begin
  foreach t in array array['journey_episode','episode_source','episode_fact',
                           'episode_review','episode_door_audit'] loop
    if to_regclass('public.' || t) is not null then
      execute format('lock table public.%I in access exclusive mode', t);
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        raise exception 'journey_foundation_v2 rollback refused: public.% contains % row(s). Nothing was changed.', t, n;
      end if;
    end if;
  end loop;
end $guard$;

drop view if exists public.journey_episode_current, public.episode_order,
                    public.episode_range, public.episode_fact_current;
drop table if exists public.episode_review, public.episode_fact, public.episode_source,
                     public.journey_episode, public.episode_door_audit;
do $drop$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'journey_episode_guard','episode_open_provisional','episode_resolve',
         'episode_attach_source','episode_set_state','episode_void',
         'journey_state_is_active','journey_state_is_terminal','journey_state_is_frozen',
         'journey_bound_lo','journey_bound_hi','journey_seat_ok','journey_lock_person',
         'journey_overlap','journey_open_review','journey_audit','journey_block_truncate',
         'episode_fact_guard','episode_append_only_guard','episode_review_guard',
         'episode_open_for_person','episode_record_fact','episode_record_historical',
         'episode_review_resolve')
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $drop$;

do $verify$
begin
  if to_regclass('public.journey_episode') is not null or to_regclass('public.episode_fact') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and (p.proname like 'episode\_%' escape '\' or p.proname like 'journey\_%' escape '\')) then
    raise exception 'journey_foundation_v2 rollback self-check failed: Journey objects remain';
  end if;
end $verify$;

commit;
