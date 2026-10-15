-- 760b undo: puts back today's rules exactly. A missing hub list reads as every hub again, and every
-- signed-in login can read the caller-recognition tables again (using true, as identity-layer.sql and
-- identity-operations.sql left them). The installer checks before 760b runs that every read-everything rule on these
-- tables is named <table>_read, so this puts back exactly what was there. One transaction.
begin;

create or replace function public.jwt_hub_access() returns jsonb language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' -> 'hub_access', 'null'::jsonb);
$$;
do $r$
declare t text;
begin
  foreach t in array array['person_identity', 'person_source_id', 'person_role', 'person_relationship', 'phone_index',
                           'identity_scan_cache', 'identity_review', 'identity_vocabulary'] loop
    continue when to_regclass('public.' || t) is null;
    execute format('drop policy if exists %I on public.%I', t || '_office_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
  end loop;
end $r$;
do $vw$ declare v text; begin
  foreach v in array array['identity_completeness', 'ghl_contact_collisions', 'phone_safe_for_outreach'] loop
    if to_regclass('public.' || v) is not null then execute format('alter view public.%I reset (security_invoker)', v); end if;
  end loop; end $vw$;

commit;
