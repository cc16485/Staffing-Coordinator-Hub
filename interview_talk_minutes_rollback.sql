-- Rollback for interview_talk_minutes.sql: the live interview_where as read by 399.
CREATE OR REPLACE FUNCTION public.interview_where()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'name', s.location_name, 'line1', s.location_line1, 'line2', s.location_line2,
    'phone', s.phone, 'note', s.note, 'photo', s.photo_url,
    'minutes', (select minutes from public.activity_types where key = 'interview'))
  from public.scheduling_settings s where s.id = 1;
$function$;
