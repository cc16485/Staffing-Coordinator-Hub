-- 995 · DATABASE-ENFORCED OWNER CHANGES (audit step 8, Samantha 2026-10-18: "Start audit step 8: database-enforced owner
-- changes, built switched off"). The Hub already lets only Samantha or Zachary change who owns a lead while lead turns are
-- on; this makes the database refuse it too, whatever page or tool a browser sign-in uses.
--   · on every browser save of the 'leads' slot (a signed-in office person, never the server's own jobs):
--       - while ops_settings.owner_guard_live AND ops_settings.lead_rotation_live are both on: a lead that already has an
--         owner may only get a different owner from an owner (desk_is_owner: Samantha or Zachary)
--       - while ops_settings.owner_guard_live is on: a lead's original owner (the bonus recipient) never changes from a
--         browser, not even an owner's (the Hub never changes it; only an empty one may be filled)
--   · refused = the whole save is refused with a message that starts LEAD_OWNER_GUARD: (the Hub shows it and reloads)
--   · off (owner_guard_live not exactly true): every save goes through exactly as today
-- No GRANT or REVOKE. No data changes. Safe to run again.
create or replace function public.lead_owner_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $f$
declare s jsonb; jr text; turns boolean; owner boolean; bad text;
begin
  if NEW.key is distinct from 'leads' or TG_OP <> 'UPDATE' then return NEW; end if;
  jr := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  if jr not in ('authenticated', 'anon') then return NEW; end if;          /* the server's own jobs are never stopped */
  select data into s from public.app_data where key = 'ops_settings';
  if coalesce(s ->> 'owner_guard_live', '') <> 'true' then return NEW; end if;
  turns := coalesce(s ->> 'lead_rotation_live', '') = 'true';
  owner := public.desk_is_owner();
  select string_agg(coalesce(nullif(trim(concat_ws(' ', o ->> 'client_first_name', o ->> 'client_last_name')), ''), nullif(trim(concat_ws(' ', o ->> 'first_name', o ->> 'last_name')), ''), o ->> 'id'), ', ')
    into bad
    from jsonb_array_elements(case when jsonb_typeof(OLD.data) = 'array' then OLD.data else '[]'::jsonb end) o
    join jsonb_array_elements(case when jsonb_typeof(NEW.data) = 'array' then NEW.data else '[]'::jsonb end) n on n ->> 'id' = o ->> 'id'
   where (turns and not owner
          and lower(split_part(btrim(coalesce(o ->> 'assigned_coordinator', '')), ' ', 1)) <> ''
          and lower(split_part(btrim(coalesce(o ->> 'assigned_coordinator', '')), ' ', 1)) <> lower(split_part(btrim(coalesce(n ->> 'assigned_coordinator', '')), ' ', 1)))
      or (coalesce(o #>> '{original_owner,name}', '') <> '' and coalesce(o #>> '{original_owner,name}', '') is distinct from coalesce(n #>> '{original_owner,name}', ''));
  if bad is not null then
    raise exception 'LEAD_OWNER_GUARD: Only Samantha or Zachary can change who owns a lead, and a lead''s first owner never changes. Nothing was saved (%).', left(bad, 160)
      using errcode = '42501';
  end if;
  return NEW;
end $f$;
comment on function public.lead_owner_guard() is '995 (2026-10-18, audit step 8): with ops_settings.owner_guard_live on, a browser save of leads cannot change an owner unless an owner saves it (while lead turns are on), and never changes a lead''s original owner.';
drop trigger if exists lead_owner_guard on public.app_data;
create trigger lead_owner_guard before update on public.app_data for each row when (NEW.key = 'leads') execute function public.lead_owner_guard();
revoke all on function public.lead_owner_guard() from public, anon, authenticated;
