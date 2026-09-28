-- =============================================================================
-- GATE 2b · CHANGE HISTORY FOR LEADS (approved 2026-09-28)
-- =============================================================================
-- Every field that changes on any lead is recorded: which lead, which field,
-- from what, to what, when, and by whom (the signed-in person) or "a server
-- function / the database" when no person made the save. It watches the saved
-- lead list itself (app_data key 'leads'), so it sees the Hub AND every server
-- function that saves leads.
--
-- IT ONLY WATCHES. The watcher runs after the save, never changes it, and if
-- anything inside it fails the save still goes through (the failure becomes a
-- warning in the database log). It is attached only to the 'leads' row; every
-- other app_data key is untouched.
--
-- Long running lists (call log, contact events, documents, AI suggestions) are
-- recorded as "3 items -> 4 items", not copied. Blank, empty, [] and false are
-- treated as the same "blank", so a form filling in an empty box never shows as
-- a change.
--
-- When a lead is permanently deleted (1 or 2 at a time, the Hub's delete), its
-- history is removed with it and a tombstone row says who removed it and when
-- (no values). If many leads vanish at once, that looks like an accident, so the
-- history is KEPT and each disappearance is recorded.
--
-- Who can read it: exactly who can read leads (can_access_data_key('leads')).
-- Nobody can edit, delete or empty it except the watcher's own delete-with-the-lead.
-- =============================================================================

begin;

create table public.lead_change (
  id           bigserial primary key,
  lead_id      text        not null,
  field        text        not null,
  kind         text        not null default 'changed' check (kind in ('changed','added','removed','removed_in_bulk')),
  old_value    jsonb,
  new_value    jsonb,
  changed_at   timestamptz not null default now(),
  changed_by   text,
  changed_via  text        not null check (changed_via in ('person','server','database'))
);
comment on table public.lead_change is 'Gate 2b · append-only history of lead field changes, written only by lead_change_capture()';
create index lead_change_lead_ix on public.lead_change (lead_id, changed_at desc);

-- append-only: only the watcher's own "history goes with the lead" may delete
create function public.lead_change_guard() returns trigger language plpgsql as $g$
begin
  if tg_op = 'DELETE' and current_setting('lead_change.purge', true) = 'on' then return old; end if;
  raise exception 'lead_change is append-only (% refused)', tg_op;
end $g$;
create trigger lead_change_append_only_t before update or delete on public.lead_change
  for each row execute function public.lead_change_guard();
create trigger lead_change_no_truncate before truncate on public.lead_change
  for each statement execute function public.lead_change_guard();

-- one value as it is kept in the history
create function public.lead_change_keep(k text, v jsonb) returns jsonb
language sql immutable set search_path = pg_catalog, public as $k$
  select case
    when v is null then null
    when jsonb_typeof(v) = 'array' and (k in ('comm_log','contact_events','docs','ai_suggestions','ai_care_flags')
         or exists (select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) in ('object','array')))
      then jsonb_build_object('items', jsonb_array_length(v))
    when pg_column_size(v) > 4000 then jsonb_build_object('too_long_to_keep', true, 'bytes', pg_column_size(v))
    else v end
$k$;
create function public.lead_change_blank(v jsonb) returns boolean
language sql immutable set search_path = pg_catalog, public as $b$
  select v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb or v = '{}'::jsonb or v = 'false'::jsonb
$b$;

create function public.lead_change_capture() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $fn$
declare
  claims jsonb; who text; via text; gone text[]; bulk boolean; od jsonb; nd jsonb; om jsonb;
begin
  if new.key is distinct from 'leads' then return new; end if;
  begin
    /* read each version of the list once (not once per query) */
    od := case when tg_op = 'UPDATE' and jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end;
    nd := case when jsonb_typeof(new.data) = 'array' then new.data else '[]'::jsonb end;
    if od = nd then return new; end if;
    /* the old list keyed by lead id, so each lead is found directly */
    select coalesce(jsonb_object_agg(x->>'id', x), '{}'::jsonb) into om from jsonb_array_elements(od) x
     where jsonb_typeof(x) = 'object' and x ? 'id';
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    who := nullif(claims->>'email', '');
    via := case when claims is null then 'database'
                when claims->>'role' = 'service_role' then 'server'
                when who is not null then 'person' else 'server' end;

    -- the leads before and after this save, by id (no temp tables: plain queries only)
    insert into public.lead_change (lead_id, field, kind, old_value, new_value, changed_by, changed_via)
    with pairs as (select x->>'id' as id, om->(x->>'id') as oe, x as ne from jsonb_array_elements(nd) x
                    where jsonb_typeof(x) = 'object' and x ? 'id' and om ? (x->>'id') and (om->(x->>'id')) is distinct from x),
         fields as (select p.id, p.oe, p.ne, k.key from pairs p
                      cross join lateral (select jsonb_object_keys(p.oe) as key union select jsonb_object_keys(p.ne)) k)
    select f.id, f.key, 'changed', public.lead_change_keep(f.key, f.oe->f.key), public.lead_change_keep(f.key, f.ne->f.key), who, via
      from fields f
     where (f.oe->f.key) is distinct from (f.ne->f.key)
       and not (public.lead_change_blank(f.oe->f.key) and public.lead_change_blank(f.ne->f.key));

    -- new leads: one line, no values (the record itself is the lead)
    if tg_op = 'UPDATE' then
      insert into public.lead_change (lead_id, field, kind, changed_by, changed_via)
      select d.id, '*', 'added', who, via from (
        select x->>'id' as id from jsonb_array_elements(nd) x
         where jsonb_typeof(x) = 'object' and x ? 'id'
        except
        select y->>'id' from jsonb_array_elements(od) y
         where jsonb_typeof(y) = 'object' and y ? 'id') d;

      -- leads that disappeared
      select array_agg(d.id) into gone from (
        select y->>'id' as id from jsonb_array_elements(od) y
         where jsonb_typeof(y) = 'object' and y ? 'id'
        except
        select x->>'id' from jsonb_array_elements(nd) x
         where jsonb_typeof(x) = 'object' and x ? 'id') d;
      if gone is not null then
        bulk := array_length(gone, 1) > 2;
        if not bulk then
          perform set_config('lead_change.purge', 'on', true);
          delete from public.lead_change where lead_id = any(gone);
          perform set_config('lead_change.purge', 'off', true);
        end if;
        insert into public.lead_change (lead_id, field, kind, changed_by, changed_via)
        select g, '*', case when bulk then 'removed_in_bulk' else 'removed' end, who, via from unnest(gone) g;
      end if;
    end if;
  exception when others then
    perform set_config('lead_change.purge', 'off', true);
    raise warning 'lead_change_capture skipped (the save itself went through): %', sqlerrm;
  end;
  return new;
end $fn$;

create trigger lead_change_capture_t after insert or update of data on public.app_data
  for each row when (new.key = 'leads') execute function public.lead_change_capture();

-- reading: exactly who can read leads; writing: nobody but the watcher
alter table public.lead_change enable row level security;
revoke all on public.lead_change from public, anon, authenticated, service_role;
revoke all on sequence public.lead_change_id_seq from public, anon, authenticated, service_role;
grant select on public.lead_change to authenticated, service_role;
create policy lead_change_read on public.lead_change for select to authenticated
  using (public.can_access_data_key('leads'));
revoke all on function public.lead_change_capture() from public, anon, authenticated, service_role;
revoke all on function public.lead_change_guard() from public, anon, authenticated, service_role;
revoke all on function public.lead_change_keep(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.lead_change_blank(jsonb) from public, anon, authenticated, service_role;

do $verify$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'lead_change_capture' and p.prosecdef) then
    raise exception 'lead_change self-check: the watcher must run as its owner';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'lead_change_capture_t' and tgrelid = 'public.app_data'::regclass) then
    raise exception 'lead_change self-check: the watcher is not attached';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.lead_change'::regclass) then
    raise exception 'lead_change self-check: row security is off';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'lead_change'
              and grantee in ('anon','authenticated','PUBLIC') and privilege_type <> 'SELECT')
     or exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'lead_change'
              and grantee = 'anon') then
    raise exception 'lead_change self-check: someone other than the watcher could write it';
  end if;
  raise notice 'lead_change installed: watching leads only, read by whoever can read leads';
end $verify$;

commit;
