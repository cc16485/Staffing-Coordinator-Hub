-- 1204 · CALMER SHIFT-NOTE FLAGS (2026-10-30, Samantha approved plan VGeWn63w7ue8WE7GS4ogJ6 with all three recommendations).
-- One new Hub data key, client_flag_normals: the topics the office marked as usual for a client ("Normal for Patsy").
-- Read and written by the Care Coordinator Hub only (the same hub map as care_plan_reviews); care-notes reads it with the
-- service key. Starts empty. No other change. Safe to run again. Rollback: calm_flags_1204_rollback.sql.
begin;
insert into public.app_data (key, data) values ('client_flag_normals', '[]'::jsonb) on conflict (key) do nothing;
insert into public.app_data_key_hub_map (data_key, hub_slug) values ('client_flag_normals', 'care_coordinator') on conflict do nothing;
do $v$
begin
  if not exists (select 1 from public.app_data where key = 'client_flag_normals') then raise exception '1204 self-check: the key is missing'; end if;
  if (select count(*) from public.app_data_key_hub_map where data_key = 'client_flag_normals') <> 1 then raise exception '1204 self-check: the key should belong to the Care Coordinator Hub only'; end if;
end
$v$;
commit;
