-- 449 undo: puts back exactly what 449 changed (the quick-add function callable with the public key again, the two
-- map rows off, the copied video room name out of the CC Hub settings). Run only if 449 needs taking back.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname = 'submit_standup_note_public' loop
    execute format('grant execute on function %s to anon, authenticated', r.f);
  end loop;
end $$;
delete from public.app_data_key_hub_map
 where hub_slug = 'care_coordinator' and data_key in ('standup_notes', 'team_meetings');
update public.app_data set data = data - 'team_video_room'
 where key = 'ops_settings' and jsonb_typeof(data) = 'object' and data->'team_video_room'->>'copied_from' = 'team_hub_settings';
