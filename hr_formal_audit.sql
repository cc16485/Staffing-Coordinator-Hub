-- =============================================================================
-- hr_formal_audit.sql · THE WRITE-UP AUDIT TRAIL (HR Agent build step 6, Samantha 2026-10-18: "build step 6")
-- Installed by Desktop step 963 (hr_formal_963.py). Safe to run again.
-- Every write-up lives in app_data 'discipline_actions' (owner-only since 946). This trigger compares the list before and
-- after every save and writes one row per write-up that was added, changed or removed: who (the signed-in person, or
-- 'server' for the Hub's own jobs), when, what kind of change, and every field that changed with its old and new value
-- (the notice text included, so every draft change is kept). Nothing can edit or delete the log from a page.
-- Decision 7 and the build plan's rules: "a full audit trail of evidence, draft changes, decisions and approvals".
-- =============================================================================
create table if not exists public.hr_formal_log (
  id bigserial primary key,
  item_id text not null,
  caregiver text,
  at timestamptz not null default now(),
  by_email text not null,
  action text not null check (action in ('added','changed','removed')),
  changes jsonb not null default '{}'::jsonb
);
create index if not exists hr_formal_log_item on public.hr_formal_log (item_id, at);
alter table public.hr_formal_log enable row level security;
revoke all on public.hr_formal_log from anon, authenticated;
grant select on public.hr_formal_log to authenticated;
grant all on public.hr_formal_log to service_role;
grant usage, select on sequence public.hr_formal_log_id_seq to service_role;
drop policy if exists hr_formal_log_owner_read on public.hr_formal_log;
create policy hr_formal_log_owner_read on public.hr_formal_log for select to authenticated using (public.desk_is_owner());
comment on table public.hr_formal_log is '963 (2026-10-18): every change to a write-up (app_data discipline_actions), written by a trigger. Owners read it; nobody edits it.';

create or replace function public.hr_formal_audit() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $f$
declare
  who text := coalesce(nullif(lower((select email from auth.users where id = auth.uid())), ''), 'server');
  o jsonb := case when tg_op = 'UPDATE' then coalesce(old.data, '[]'::jsonb) else '[]'::jsonb end;
  n jsonb := coalesce(new.data, '[]'::jsonb);
  r record;
  diff jsonb;
begin
  if jsonb_typeof(o) <> 'array' then o := '[]'::jsonb; end if;
  if jsonb_typeof(n) <> 'array' then n := '[]'::jsonb; end if;
  for r in
    select coalesce(a.id, b.id) as id, a.v as before, b.v as after
      from (select x->>'id' as id, x as v from jsonb_array_elements(o) x where x->>'id' is not null) a
      full join (select x->>'id' as id, x as v from jsonb_array_elements(n) x where x->>'id' is not null) b on a.id = b.id
     where a.v is distinct from b.v
  loop
    if r.before is null then
      insert into public.hr_formal_log (item_id, caregiver, by_email, action, changes) values (r.id, r.after->>'caregiver', who, 'added', jsonb_build_object('item', r.after));
    elsif r.after is null then
      insert into public.hr_formal_log (item_id, caregiver, by_email, action, changes) values (r.id, r.before->>'caregiver', who, 'removed', jsonb_build_object('item', r.before));
    else
      select coalesce(jsonb_object_agg(k, jsonb_build_array(r.before->k, r.after->k)), '{}'::jsonb) into diff
        from (select jsonb_object_keys(r.before) k union select jsonb_object_keys(r.after)) ks
       where (r.before->k) is distinct from (r.after->k);
      insert into public.hr_formal_log (item_id, caregiver, by_email, action, changes) values (r.id, r.after->>'caregiver', who, 'changed', diff);
    end if;
  end loop;
  return new;
end $f$;
revoke all on function public.hr_formal_audit() from public, anon, authenticated;
drop trigger if exists hr_formal_audit on public.app_data;
create trigger hr_formal_audit after insert or update of data on public.app_data
  for each row when (new.key = 'discipline_actions') execute function public.hr_formal_audit();
