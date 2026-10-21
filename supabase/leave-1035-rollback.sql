-- Rollback for leave-1035.sql. Run only after reference-chase and caregiver-journey are back on the build before 1035
-- (they read closed_at). Dropping closed_at reopens every closed request to the chase.
drop function if exists public.leave_patch(text, text, bigint, jsonb);
alter table public.reference_requests drop column if exists closed_reason;
alter table public.reference_requests drop column if exists closed_at;
