-- interview_talk_minutes.sql (Desktop 406, 2026-10-01). Samantha: "say 20 minutes for the interview, we want a 30
-- minutes slot to give the interviewer time in between". activity_types.minutes stays the calendar slot (30); the new
-- talk_minutes is what applicants are told (20). interview_where (the apply page) returns the told length.
-- Rollback: interview_talk_minutes_rollback.sql (the column stays; it is only read when present).
alter table public.activity_types add column if not exists talk_minutes integer;
update public.activity_types set talk_minutes = 20 where key = 'interview' and talk_minutes is null;
update public.activity_types set minutes = 30 where key = 'interview';

CREATE OR REPLACE FUNCTION public.interview_where()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'name', s.location_name, 'line1', s.location_line1, 'line2', s.location_line2,
    'phone', s.phone, 'note', s.note, 'photo', s.photo_url,
    -- 2026-10-01 (Samantha): applicants are told the interview length (talk_minutes, 20), not the calendar slot (30)
    'minutes', (select coalesce(talk_minutes, minutes) from public.activity_types where key = 'interview'))
  from public.scheduling_settings s where s.id = 1;
$function$;
