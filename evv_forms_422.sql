-- =============================================================================
-- 422 · EVV CORRECTION FORMS: the completed, signed form, who it is for, and the AxisCare check
-- =============================================================================
-- Samantha (2026-10-03): "the EVV form does not save the completed form, it has a text only completion. We need the
-- real form that was completed and signed by caregiver and client to be saved and able to be viewed by office staff...
-- also would be nice if it is saved in the client and caregivers profiles as well".
--
-- The signed form is ALREADY kept whole in public.evv_submissions (every answer + both signatures as PNG images).
-- This adds, on the same row:
--   who it is for, confirmed by the office:  caregiver_axiscare_id, caregiver_linked_name,
--                                            client_axiscare_id, client_linked_name, linked_by, linked_at
--   what the office decided:                 outcome ('accepted' | 'dismissed'; older rows stay null)
--   the AxisCare check (read only):          axiscare_visit_id, axiscare_checked_at, axiscare_seen, axiscare_done_at
--
-- Permissions (one table only; never a blanket GRANT):
--   * signed-in staff (authenticated): SELECT and UPDATE, as before (they read and process forms in the Hub).
--     TRUNCATE / REFERENCES / TRIGGER removed (TRUNCATE ignores row security; no page needs them).
--   * the public form (anon): INSERT only, as before. SELECT / UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER
--     removed if present. A new guard makes a public insert start as "waiting" with every office-only field empty,
--     so nobody can send a form that claims to be accepted, linked or checked.
--   * DELETE for authenticated is left exactly as it is (retention is not changed here).
-- Row security stays ON; the existing read / update rules are kept, and created only if missing.
-- One transaction; safe to run again (every step checks first).
-- =============================================================================
begin;

do $$ begin
  if to_regclass('public.evv_submissions') is null then raise exception '422: public.evv_submissions does not exist'; end if;
end $$;

alter table public.evv_submissions
  add column if not exists caregiver_axiscare_id text,
  add column if not exists caregiver_linked_name text,
  add column if not exists client_axiscare_id    text,
  add column if not exists client_linked_name    text,
  add column if not exists linked_by             text,
  add column if not exists linked_at             timestamptz,
  add column if not exists outcome               text,
  add column if not exists axiscare_visit_id     text,
  add column if not exists axiscare_checked_at   timestamptz,
  add column if not exists axiscare_seen         text,
  add column if not exists axiscare_done_at      timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'evv_submissions_outcome_422' and conrelid = 'public.evv_submissions'::regclass) then
    alter table public.evv_submissions add constraint evv_submissions_outcome_422 check (outcome is null or outcome in ('accepted', 'dismissed'));
  end if;
end $$;

create index if not exists evv_submissions_caregiver_ax_422 on public.evv_submissions (caregiver_axiscare_id) where caregiver_axiscare_id is not null;
create index if not exists evv_submissions_client_ax_422    on public.evv_submissions (client_axiscare_id)    where client_axiscare_id is not null;

-- A public (anon) insert can only ever be a new, waiting, unlinked form.
create or replace function public.evv_submissions_public_insert_guard()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  if current_user = 'anon' then
    new.processed := false;
    new.processed_by := null;  new.processed_at := null;  new.outcome := null;
    new.caregiver_axiscare_id := null;  new.caregiver_linked_name := null;
    new.client_axiscare_id := null;     new.client_linked_name := null;
    new.linked_by := null;  new.linked_at := null;
    new.axiscare_visit_id := null;  new.axiscare_checked_at := null;  new.axiscare_seen := null;  new.axiscare_done_at := null;
  end if;
  return new;
end
$fn$;
drop trigger if exists evv_submissions_public_insert_guard_422 on public.evv_submissions;
create trigger evv_submissions_public_insert_guard_422 before insert on public.evv_submissions
  for each row execute function public.evv_submissions_public_insert_guard();

-- Permissions: this table only.
alter table public.evv_submissions enable row level security;
revoke select, update, delete, truncate, references, trigger on public.evv_submissions from anon;
grant insert on public.evv_submissions to anon;
revoke truncate, references, trigger on public.evv_submissions from authenticated;
grant select, update on public.evv_submissions to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'evv_submissions' and cmd = 'INSERT' and 'anon' = any(roles)) then
    create policy "anon_insert_evv_submissions" on public.evv_submissions for insert to anon with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'evv_submissions' and cmd = 'SELECT' and 'authenticated' = any(roles)) then
    create policy "auth_select_evv_submissions" on public.evv_submissions for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'evv_submissions' and cmd = 'UPDATE' and 'authenticated' = any(roles)) then
    create policy "auth_update_evv_submissions" on public.evv_submissions for update to authenticated using (true) with check (true);
  end if;
end $$;

-- Read back: refuse to finish (whole transaction undone) unless it is exactly as intended.
do $$
declare v_missing text;
begin
  select string_agg(c, ', ') into v_missing from unnest(array['caregiver_axiscare_id','caregiver_linked_name','client_axiscare_id','client_linked_name',
    'linked_by','linked_at','outcome','axiscare_visit_id','axiscare_checked_at','axiscare_seen','axiscare_done_at']) c
   where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'evv_submissions' and column_name = c);
  if v_missing is not null then raise exception '422: columns missing after the change: %', v_missing; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.evv_submissions'::regclass) then raise exception '422: row security is off'; end if;
  if has_table_privilege('anon', 'public.evv_submissions', 'SELECT') or has_table_privilege('anon', 'public.evv_submissions', 'UPDATE')
     or has_table_privilege('anon', 'public.evv_submissions', 'DELETE') or has_table_privilege('anon', 'public.evv_submissions', 'TRUNCATE') then
    raise exception '422: the public can still do more than send a form';
  end if;
  if not has_table_privilege('anon', 'public.evv_submissions', 'INSERT') then raise exception '422: the public form could not send any more'; end if;
  if not (has_table_privilege('authenticated', 'public.evv_submissions', 'SELECT') and has_table_privilege('authenticated', 'public.evv_submissions', 'UPDATE')) then
    raise exception '422: signed-in staff cannot read and update forms';
  end if;
  if has_table_privilege('authenticated', 'public.evv_submissions', 'TRUNCATE') then raise exception '422: staff can still empty the table'; end if;
end $$;

commit;
