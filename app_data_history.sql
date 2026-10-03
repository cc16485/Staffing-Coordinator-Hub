-- =============================================================================
-- 418 · CHANGE HISTORY FOR CANDIDATES AND CAREGIVERS (safe saves, part 1)
-- =============================================================================
-- Why: Aimee Driggers was imported, then vanished from the saved candidate list,
-- and nothing could say when, from which page, or who saved over her. From now
-- on every save of app_data 'candidates' or 'caregivers' leaves one line per
-- person who was added, removed or changed:
--   at, key, record_id, change ('added' | 'removed' | 'changed'),
--   fields_changed (the NAMES of the fields that changed, never their values),
--   bulk_removed (true when more than 2 people vanished in one save, which looks
--   like a stale page saving over the list),
--   actor (the signed-in person's email, else their user id, else 'server'),
--   role (authenticated / service_role / anon, or 'database' for a direct save),
--   origin (the page's address, e.g. https://sc.mo-care.com; only the site part
--   of a referer is kept, never its path or query),
--   names (first + last, for added and removed people only).
-- No phone, email, SSN, date of birth or any field value is ever copied here.
--
-- IT ONLY WATCHES. It runs after the save, never changes it and never blocks it.
-- If anything inside it fails, the save still goes through and one line with
-- change = 'trigger_error' (and the short error text) is written instead; if even
-- that fails, the save still goes through (a warning goes to the database log).
-- Every other app_data key is untouched (the triggers only fire for these two).
--
-- Cost: one pass over the old and the new list (about 60 people each), keyed by
-- id. A save that changes nothing (same list) returns at once.
--
-- Who can read it: whoever can read that key (can_access_data_key(key)), signed
-- in only. anon: nothing. Browsers cannot write it; the server (service_role)
-- can, for a later clean-up.
--
-- RETENTION: kept forever for now, no automatic purge. At ~60 people and a
-- handful of real changes a day this is tiny. If it ever needs trimming, a
-- server job may delete rows older than (say) 2 years; that is a separate,
-- reviewed change.
--
-- Safe to run again (create if missing / replace / drop-and-recreate the
-- triggers and the policy). One transaction.
-- =============================================================================

begin;

create table if not exists public.app_data_item_change (
  id              bigserial primary key,
  at              timestamptz not null default now(),
  key             text        not null,
  record_id       text,
  change          text        not null check (change in ('added', 'removed', 'changed', 'trigger_error')),
  fields_changed  text[],
  bulk_removed    boolean     not null default false,
  actor           text        not null default 'server',
  role            text,
  origin          text,
  names           text,
  error           text
);
comment on table public.app_data_item_change is
  '418 · record-only history of app_data candidates/caregivers saves (added/removed/changed per person, field names only, never values). Written only by app_data_item_change_capture(). No auto-purge.';
create index if not exists app_data_item_change_key_at_ix on public.app_data_item_change (key, at desc);
create index if not exists app_data_item_change_record_ix on public.app_data_item_change (record_id);

-- a person's name as kept in the history: first + last only, nothing else
create or replace function public.app_data_item_name(x jsonb) returns text
language sql immutable set search_path = pg_catalog, public as $n$
  select left(coalesce(
    nullif(btrim(concat_ws(' ', coalesce(x->>'first', x->>'first_name'), coalesce(x->>'last', x->>'last_name'))), ''),
    nullif(btrim(x->>'name'), '')), 120)
$n$;

create or replace function public.app_data_item_change_capture() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $fn$
declare
  k text; od jsonb; nd jsonb; om jsonb; nm jsonb; claims jsonb; hdrs jsonb;
  v_actor text := 'server'; v_role text := 'database'; v_origin text; gone int; bulk boolean;
begin
  if tg_op = 'DELETE' then k := old.key; else k := new.key; end if;
  if k is null or k not in ('candidates', 'caregivers') then return null; end if;
  begin
    od := case when tg_op in ('UPDATE', 'DELETE') and jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end;
    nd := case when tg_op in ('INSERT', 'UPDATE') and jsonb_typeof(new.data) = 'array' then new.data else '[]'::jsonb end;
    if od = nd then return null; end if;

    /* who and from where (each read on its own, so a bad header can never stop the record) */
    begin claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then claims := null; end;
    begin hdrs := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then hdrs := null; end;
    v_role := coalesce(nullif(claims->>'role', ''), 'database');
    v_actor := left(coalesce(nullif(claims->>'email', ''), nullif(claims->>'sub', ''), 'server'), 200);
    v_origin := left(coalesce(nullif(hdrs->>'origin', ''), substring(hdrs->>'referer' from '^(https?://[^/?#]+)')), 200);

    /* each list keyed by id, read once */
    select coalesce(jsonb_object_agg(x->>'id', x), '{}'::jsonb) into om
      from jsonb_array_elements(od) x where jsonb_typeof(x) = 'object' and coalesce(x->>'id', '') <> '';
    select coalesce(jsonb_object_agg(x->>'id', x), '{}'::jsonb) into nm
      from jsonb_array_elements(nd) x where jsonb_typeof(x) = 'object' and coalesce(x->>'id', '') <> '';

    select count(*) into gone from jsonb_object_keys(om) i where not nm ? i;
    bulk := gone > 2;

    insert into public.app_data_item_change (key, record_id, change, fields_changed, bulk_removed, actor, role, origin, names)
    select k, i, 'removed', null::text[], bulk, v_actor, v_role, v_origin, public.app_data_item_name(om->i)
      from jsonb_object_keys(om) i where not nm ? i
    union all
    select k, i, 'added', null::text[], false, v_actor, v_role, v_origin, public.app_data_item_name(nm->i)
      from jsonb_object_keys(nm) i where not om ? i
    union all
    select k, i, 'changed', f.fields, false, v_actor, v_role, v_origin, null::text
      from jsonb_object_keys(nm) i
      cross join lateral (
        select array_agg(s.fk order by s.fk) as fields
          from (select jsonb_object_keys(om->i) as fk union select jsonb_object_keys(nm->i)) s
         where (om->i->s.fk) is distinct from (nm->i->s.fk)) f
     where om ? i and (om->i) is distinct from (nm->i) and f.fields is not null;
  exception when others then
    begin
      insert into public.app_data_item_change (key, change, actor, role, origin, error)
      values (k, 'trigger_error', coalesce(v_actor, 'server'), v_role, v_origin, left(sqlerrm, 200));
    exception when others then
      raise warning 'app_data_item_change: could not even record the error (the save itself went through): %', sqlerrm;
    end;
  end;
  return null;
end $fn$;

drop trigger if exists app_data_item_change_t on public.app_data;
create trigger app_data_item_change_t after insert or update of data on public.app_data
  for each row when (new.key in ('candidates', 'caregivers')) execute function public.app_data_item_change_capture();
drop trigger if exists app_data_item_change_del_t on public.app_data;
create trigger app_data_item_change_del_t after delete on public.app_data
  for each row when (old.key in ('candidates', 'caregivers')) execute function public.app_data_item_change_capture();

-- reading: signed in, and only for a key you can read; anon nothing; browsers never write
alter table public.app_data_item_change enable row level security;
revoke all on public.app_data_item_change from public, anon, authenticated;
revoke all on sequence public.app_data_item_change_id_seq from public, anon, authenticated;
grant select on public.app_data_item_change to authenticated;
grant select, insert, update, delete on public.app_data_item_change to service_role;
grant usage, select on sequence public.app_data_item_change_id_seq to service_role;
drop policy if exists app_data_item_change_read on public.app_data_item_change;
create policy app_data_item_change_read on public.app_data_item_change for select to authenticated
  using (public.can_access_data_key(key));
revoke all on function public.app_data_item_change_capture() from public, anon, authenticated, service_role;
revoke all on function public.app_data_item_name(jsonb) from public, anon, authenticated, service_role;

do $verify$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'app_data_item_change_capture' and p.prosecdef) then
    raise exception 'app_data_item_change self-check: the watcher must run as its owner';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.app_data'::regclass
        and tgname in ('app_data_item_change_t', 'app_data_item_change_del_t') and not tgisinternal) <> 2 then
    raise exception 'app_data_item_change self-check: the watcher is not attached';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.app_data_item_change'::regclass) then
    raise exception 'app_data_item_change self-check: row security is off';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'app_data_item_change'
              and ((grantee in ('authenticated', 'PUBLIC') and privilege_type <> 'SELECT') or grantee = 'anon')) then
    raise exception 'app_data_item_change self-check: a browser could write it, or anon could read it';
  end if;
  raise notice 'app_data_item_change installed: watching candidates and caregivers only';
end $verify$;

commit;
