-- =============================================================================
-- 576 · PHASE 0: THE OWNERS HUB'S PRIVATE RECORDS ARE PRIVATE IN THE DATABASE, NOT ONLY ON THE PAGE.
-- Samantha approved the eight P0 security fixes on 2026-10-10 (Cara Implementation Plan, section 3).
--
-- owners.html keeps finance, budget, offboarding and file-audit records in app_data and admits (line ~713) that the
-- only lock is a list of two emails in the page. These RESTRICTIVE rules make the database itself refuse any read or
-- write of those keys by a signed-in page unless the caller holds the owner_admin role for Caring Companions, using
-- the same owner test My Desk already relies on (public.desk_is_owner(), 463). They AND with the existing rules, so
-- nothing else about app_data changes.
--
-- NOT locked: discipline_actions. Coordinators issue and read write-ups through it in the CC Hub (write-ups tab,
-- corrective-action approvals), so locking it to owners would break their work. Approval of a write-up is already
-- gated separately (approve_discipline). Left as is on purpose; listed for Samantha.
--
-- Still allowed: the server's own jobs (service role bypasses row security) and the weekly backup.
-- No GRANT or REVOKE. Safe to run again. Undo: owner_keys_lock_576_rollback.sql.
-- =============================================================================
do $pre$ begin
  if not exists (select 1 from pg_proc where proname = 'desk_is_owner' and pronamespace = 'public'::regnamespace) then
    raise exception '576: public.desk_is_owner() is missing (My Desk 463 was not installed), so the owner test cannot be used';
  end if;
end $pre$;

drop policy if exists app_data_owner_keys_sel on public.app_data;
drop policy if exists app_data_owner_keys_ins on public.app_data;
drop policy if exists app_data_owner_keys_upd on public.app_data;
drop policy if exists app_data_owner_keys_del on public.app_data;

create policy app_data_owner_keys_sel on public.app_data as restrictive for select to authenticated, anon
  using (key not in ('finance_snapshots', 'owner_settings', 'budget_lines', 'budget_actuals', 'offboardings', 'file_audits') or public.desk_is_owner());
create policy app_data_owner_keys_ins on public.app_data as restrictive for insert to authenticated, anon
  with check (key not in ('finance_snapshots', 'owner_settings', 'budget_lines', 'budget_actuals', 'offboardings', 'file_audits') or public.desk_is_owner());
create policy app_data_owner_keys_upd on public.app_data as restrictive for update to authenticated, anon
  using (key not in ('finance_snapshots', 'owner_settings', 'budget_lines', 'budget_actuals', 'offboardings', 'file_audits') or public.desk_is_owner())
  with check (key not in ('finance_snapshots', 'owner_settings', 'budget_lines', 'budget_actuals', 'offboardings', 'file_audits') or public.desk_is_owner());
create policy app_data_owner_keys_del on public.app_data as restrictive for delete to authenticated, anon
  using (key not in ('finance_snapshots', 'owner_settings', 'budget_lines', 'budget_actuals', 'offboardings', 'file_audits') or public.desk_is_owner());

do $v$ begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'app_data' and policyname like 'app_data_owner_keys_%' and permissive = 'RESTRICTIVE') <> 4 then
    raise exception '576 self-check: the four restrictive rules are not all in place';
  end if;
  if (select relforcerowsecurity from pg_class where oid = 'public.app_data'::regclass) then
    raise exception '576 self-check: row security is FORCED on app_data, so the server''s own jobs would be locked out too';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.app_data'::regclass) then
    raise exception '576 self-check: row security is off on app_data, so the rules would do nothing';
  end if;
  if not (select prosecdef from pg_proc where proname = 'desk_is_owner' and pronamespace = 'public'::regnamespace) then
    raise exception '576 self-check: desk_is_owner() must run as its owner to read staff_roles';
  end if;
end $v$;
