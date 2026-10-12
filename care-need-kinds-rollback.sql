-- Rollback for care-need-kinds.sql: the 25 kinds become inactive (the checklist stops offering them). Nothing is deleted:
-- any fact already recorded against them stays on the record.
update public.fact_kind set active = false where created_by = 'match_needs';
