-- =============================================================================
-- 442 · SAFE SAVES STEP 5: LOCK THE DOOR ON WHOLE-LIST SAVES OF CANDIDATES AND CAREGIVERS. Samantha approved the safe
-- saves plan 2026-10-04 ("yes to all"): https://claude.ai/artifact/Y8Kmn4hR7rmWt9keXG6uGd
--
-- Since 421 every page saves a candidate or caregiver ONE PERSON AT A TIME (app_data_items_apply), and since step 3
-- sc.mo-care.com saves nothing. These RESTRICTIVE rules make the database refuse anything else from a signed-in page:
-- a whole-list save (upsert / update / insert) of 'candidates' or 'caregivers', a per-item save of them through
-- upsert_app_data_item (it runs as the caller), or a delete of either list. They AND with the existing rules, so
-- nothing else about app_data changes (every other key saves exactly as before).
-- Still allowed: app_data_items_apply (the one-person-at-a-time save), caregiver_connect_apply and
-- caregiver_sweep_patch, which run as their owner, and the server's own jobs (service role).
-- No GRANT or REVOKE. Safe to run again. Undo: people_lock_rollback.sql.
-- =============================================================================
drop policy if exists app_data_people_lock_ins on public.app_data;
drop policy if exists app_data_people_lock_upd on public.app_data;
drop policy if exists app_data_people_lock_del on public.app_data;
create policy app_data_people_lock_ins on public.app_data as restrictive for insert to authenticated, anon
  with check (key not in ('candidates', 'caregivers'));
create policy app_data_people_lock_upd on public.app_data as restrictive for update to authenticated, anon
  using (key not in ('candidates', 'caregivers')) with check (key not in ('candidates', 'caregivers'));
create policy app_data_people_lock_del on public.app_data as restrictive for delete to authenticated, anon
  using (key not in ('candidates', 'caregivers'));
do $v$ begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'app_data' and policyname like 'app_data_people_lock_%' and permissive = 'RESTRICTIVE') <> 3 then
    raise exception '442 self-check: the three restrictive rules are not all in place';
  end if;
  if (select relforcerowsecurity from pg_class where oid = 'public.app_data'::regclass) then
    raise exception '442 self-check: row security is FORCED on app_data, so the safe-save functions would be locked out too';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.app_data'::regclass) then
    raise exception '442 self-check: row security is off on app_data, so the rules would do nothing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'app_data_items_apply' and pronamespace = 'public'::regnamespace and prosecdef) then
    raise exception '442 self-check: app_data_items_apply must run as its owner, or the one-person save would be locked out too';
  end if;
end $v$;
