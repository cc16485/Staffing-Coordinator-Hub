-- applicant_msgs_587_rollback.sql: removes the three 587 functions. The new columns stay (harmless: nothing reads them
-- without 587's message code). The cancel screen falls back to interview_cancel by itself.
begin;
drop function if exists public.interview_cancel_with_reason(uuid, text, text);
drop function if exists public.interview_cancel_by_reply(uuid, text);
drop function if exists public.interview_record_reply(uuid, text, text);
commit;
notify pgrst, 'reload schema';
