-- J1 (2026-09-29) · the interview-audio keep setting can be changed only by the server (a Desktop step).
-- Before: every signed-in account on the shared project could UPDATE recordings_settings.keep_audio_days (policy
-- "for all ... using (true)"), then the purge would delete all transcribed audio older than the new number.
-- Nothing in any Hub reads or writes this table; only recordings_due_for_purge() (security definer) reads it.
-- After: signed-in accounts may still read the number; only the server role changes it. The value is not touched.
-- Rollback (exactly the old state):
--   drop policy if exists recordings_settings_read on public.recordings_settings;
--   create policy recordings_settings_auth on public.recordings_settings for all to authenticated using (true) with check (true);
--   grant update on public.recordings_settings to authenticated;
begin;
drop policy if exists recordings_settings_auth on public.recordings_settings;
drop policy if exists recordings_settings_read on public.recordings_settings;
create policy recordings_settings_read on public.recordings_settings for select to authenticated using (true);
revoke insert, update, delete, truncate on public.recordings_settings from anon, authenticated;
grant select on public.recordings_settings to authenticated;
grant all on public.recordings_settings to service_role;
commit;
