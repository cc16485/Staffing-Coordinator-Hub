-- ============================================================================
-- journey-episode-phaseA-rollback.sql   ·   Stage 2 · Phase A rollback
-- ----------------------------------------------------------------------------
-- Valid ONLY while Phase A is unused and empty (shadow): nothing reads or writes
-- these objects, so removing them has zero production impact. Drops everything
-- Phase A created, in dependency order, and NOTHING else. person_identity and
-- the standard roles are NOT touched.
--
-- Dependency order:
--   Door functions  → (independent; drop first)
--   trigger + guard → (on journey_episode)
--   episode_source  → (FK child of journey_episode; drop before the parent)
--   episode_door_audit
--   journey_episode → (self-FK; drop last)
-- Indexes and RLS policies are dropped implicitly with their tables.
-- Intended to run inside ONE transaction (atomic).
-- ============================================================================

drop function if exists episode_open_provisional(text,text,text,text,text);
drop function if exists episode_resolve(uuid,uuid,text,text);
drop function if exists episode_attach_source(uuid,text,text,text,text,text);
drop function if exists episode_set_state(uuid,text,text,text);
drop function if exists episode_void(uuid,text,uuid,text,text);

drop trigger   if exists journey_episode_guard_t on journey_episode;
drop function  if exists journey_episode_guard();

drop table if exists episode_source;        -- FK child of journey_episode
drop table if exists episode_door_audit;
drop table if exists journey_episode;        -- self-FK; last
