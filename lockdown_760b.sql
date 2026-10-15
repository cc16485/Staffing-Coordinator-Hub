-- =============================================================================
-- 760b · Hub CRM Build Plan, decision 8, step C part 2. Approved by Samantha 2026-10-15 ("Yes, build the lockdown"); she
-- reviews the PRs before anything goes live. Her answer on Angiel: both hubs, care coordinator.
--
-- (a) A signed-in login with NO hub list gets NO hub, instead of every hub.
--     One change, in public.jwt_hub_access(): for a browser login (role authenticated or anon) a missing list now reads
--     as an empty list. Every rule written as "jwt_hub_access() is null or ..." (can_access_data_key, desk_hub_ok and so
--     hub_office_ok and desk_is_owner, and the rest the report lists) then denies instead of allows, with no edit to
--     each. The server's own jobs (service_role, or no sign-in at all) read exactly as before.
-- (b) The caller-recognition tables become office only: the read-everything rule (using true) that identity-layer.sql
--     and identity-operations.sql gave every signed-in login is replaced by public.hub_office_ok(), the database twin of
--     OFFICE_ROLES in _shared/staff-auth.ts (owner_admin, care_coordinator, staffing_coordinator, on the Care
--     Coordinator Hub). The two views over those tables stop reading as their owner, so they follow the same rule.
--
-- One transaction: all of it goes in, or none of it. No GRANT is added. No table data is changed. Undo: lockdown_760b_rollback.sql.
-- 760 live run 2026-10-15: no login has a blank list today, so nobody is locked out by (a).
-- Must run AFTER every office login has an explicit hub list and has signed in again (their old sign-in carries the
-- old claim for up to an hour). The installer refuses while any active office login still has a blank list.
-- =============================================================================
begin;

do $pre$ begin
  if exists (select 1 from auth.users u
             join public.auth_identities ai on ai.auth_user_id = u.id and ai.project_ref = 'zngsgedlsxinbygwmxwn'
             join public.staff_roles s on s.person_id = ai.person_id and s.entity = 'cc_ihs'
             where u.raw_app_meta_data -> 'hub_access' is null) then
    raise exception '760b: a staff login still has a blank hub list; it would be locked out. Give it an explicit list first.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'hub_office_ok' and pronamespace = 'public'::regnamespace and prosecdef) then
    raise exception '760b: public.hub_office_ok() is missing or not SECURITY DEFINER (op_events_harden_578)';
  end if;
end $pre$;

-- (a) ─────────────────────────────────────────────────────────────────────────
-- built on the live definition (read by 760 on 2026-10-15): select nullif(auth.jwt() -> 'app_metadata' -> 'hub_access', 'null'::jsonb)
create or replace function public.jwt_hub_access() returns jsonb language sql stable as $$
  select case when coalesce(auth.jwt() ->> 'role', '') in ('authenticated', 'anon')
              then coalesce(nullif(auth.jwt() -> 'app_metadata' -> 'hub_access', 'null'::jsonb), '[]'::jsonb)
              else nullif(auth.jwt() -> 'app_metadata' -> 'hub_access', 'null'::jsonb) end;
$$;

-- (b) ─────────────────────────────────────────────────────────────────────────
do $b$
declare t text; p record;
begin
  foreach t in array array['person_identity', 'person_source_id', 'person_role', 'person_relationship', 'phone_index',
                           'identity_scan_cache', 'identity_review', 'identity_vocabulary'] loop
    continue when to_regclass('public.' || t) is null;
    for p in select policyname, cmd from pg_policies
             where schemaname = 'public' and tablename = t and permissive = 'PERMISSIVE' and qual = 'true'
               and cmd in ('SELECT', 'ALL') and roles && array['authenticated', 'public']::name[] loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('drop policy if exists %I on public.%I', t || '_office_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.hub_office_ok())', t || '_office_read', t);
  end loop;
end $b$;
do $vw$ declare v text; begin
  foreach v in array array['identity_completeness', 'ghl_contact_collisions', 'phone_safe_for_outreach'] loop
    if to_regclass('public.' || v) is not null then execute format('alter view public.%I set (security_invoker = true)', v); end if;
  end loop; end $vw$;

-- self-check: nothing on these tables still reads everything for a signed-in login
do $v$ begin
  if exists (select 1 from pg_policies where schemaname = 'public'
             and tablename in ('person_identity', 'person_source_id', 'person_role', 'person_relationship', 'phone_index',
                               'identity_scan_cache', 'identity_review', 'identity_vocabulary')
             and permissive = 'PERMISSIVE' and qual = 'true' and cmd in ('SELECT', 'ALL')) then
    raise exception '760b self-check: a read-everything rule is still in place';
  end if;
  if public.jwt_hub_access() is not null then
    raise exception '760b self-check: with no sign-in the hub list must still read as nothing, exactly as before';
  end if;
end $v$;

commit;
