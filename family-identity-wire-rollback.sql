-- Rollback for family-identity-wire.sql. Removes the triggers and the pass. If the one-time pass (or the triggers) has
-- already linked people, set p_end_links := true below to also end every family link they made (history stays).
begin;
drop trigger if exists family_circle_member_sync on public.circle_contacts;
drop trigger if exists family_circle_sync on public.care_circles;
drop function if exists public.family_circle_member_sync();
drop function if exists public.family_circle_sync();
drop function if exists public.person_link_family_practice();
drop function if exists public.person_link_family_all();
drop function if exists public.family_actor(jsonb);
-- to also end the links: uncomment
-- update public.person_relationship r set active = false, ended_at = current_date
--   from public.person_source_id s where s.system = 'hub' and s.entity_type = 'contact' and s.person_id = r.person_id and r.active;
commit;
