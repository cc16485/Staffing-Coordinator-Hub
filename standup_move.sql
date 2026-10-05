-- 449 · STAND-UP AND TEAM MEETINGS MOVE INTO THE CC HUB (Today). Samantha approved 2026-10-04/05 with the suggested
-- choices (plan https://claude.ai/artifact/2BZP14QkBcLjPy34dXJ9Ab). Safe to run again; undo: standup_move_rollback.sql.
-- 1. The old no-sign-in quick-add page wrote to the board through submit_standup_note_public with the public key, so
--    anyone with its link could post. That page is retired; nobody but the server may call the function any more.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname = 'submit_standup_note_public' loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.f);
  end loop;
end $$;
-- 2. CC Hub staff can reach the two lists (Team Hub keeps them as well). Nothing else is opened.
insert into public.app_data_key_hub_map (data_key, hub_slug)
values ('standup_notes', 'care_coordinator'), ('team_meetings', 'care_coordinator')
on conflict (data_key, hub_slug) do nothing;
-- 3. The team video room: its name is copied into the CC Hub's own settings, so the Hub never needs the Team Hub's
--    settings list (which also holds that hub's links). Only when the Hub doesn't have one yet.
update public.app_data o
   set data = o.data || jsonb_build_object('team_video_room',
         jsonb_build_object('room_name', v.room, 'copied_from', 'team_hub_settings', 'copied_at', now()))
  from (select x->>'room_name' as room
          from public.app_data t, jsonb_array_elements(case when jsonb_typeof(t.data) = 'array' then t.data else '[]'::jsonb end) x
         where t.key = 'team_hub_settings' and x->>'id' = 'video_room' and x->>'room_name' ~ '^[A-Za-z0-9_-]{12,80}$'
         limit 1) v
 where o.key = 'ops_settings' and jsonb_typeof(o.data) = 'object' and not (o.data ? 'team_video_room');
