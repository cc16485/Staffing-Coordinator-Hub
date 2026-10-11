-- =============================================================================
-- 582 ROLLBACK · remove the authority tables (only if ever needed)
-- =============================================================================
-- Run ONLY after the two functions are back on their pre-582 versions (the 582 report lists them): the door refuses
-- every call when its authority row is missing, so the new functions must not be live without these tables.
-- The record (op_events) keeps every row the door wrote. One transaction.
-- =============================================================================
begin;
drop function if exists public.authority_set(text, text, text, text, text[], text);
drop table if exists public.action_authority_log;
drop table if exists public.action_authority;
drop table if exists public.action_registry;
drop function if exists public.action_authority_guard();
commit;
