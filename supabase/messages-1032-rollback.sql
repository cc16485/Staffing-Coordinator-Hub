-- Rollback for messages-1032.sql. Run only after reference-chase is back on the 1031 build (it writes these columns).
alter table public.reference_requests drop column if exists texted_at;
alter table public.reference_requests drop column if exists reminder_texted_at;

-- step2_patch: run slice4-step2.sql's function again to take profile_reminders back out (harmless to leave).
