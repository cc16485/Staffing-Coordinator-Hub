-- Rollback for level-1033.sql. The evidence table is kept (it is the audit trail of what was verified); only the door goes.
-- To remove the table too, run: drop table public.caregiver_level_evidence;  (after taking a copy)
drop function if exists public.level_patch(text, text, bigint, jsonb);
