-- =============================================================================
-- SLICE 9 · EVIDENCE HARDENING (Samantha "yes to all, go", 2026-10-11). Hub project.
--
-- What it adds (her four decisions):
--   1. evidence_history: the VALUE history for audit evidence (what a check result, date, proof, signature status or plan
--      record said before and after each change, who changed it and when). It is its own narrow table, separate from the
--      Phase 1 change history (app_data_item_change), which keeps field NAMES only and is not touched here.
--      Fed by three watchers that only watch (never block a save; a failure writes one 'trigger_error' line instead):
--        · app_data: candidates and caregivers (evidence fields only), medicaid_plans, ghe_forms
--        · evv_submissions and client_care_change (every column; signature images are kept as a fingerprint only)
--      GHE answers (f, checks, radios) and every signature image are kept as an md5 fingerprint, never copied.
--   1b. journey_row_version: the earlier version of every client_journey and client_journey_step row (both the client and
--      the caregiver journeys and their readiness steps), saved whenever a row changes or is removed.
--   2. GHE forms lock at the participant's signature: once a form has the participant's signature its answers, client,
--      visit date, nurse, score and the nurse and participant signatures cannot change and the form cannot be removed.
--      The supervising RN can still sign once (an LPN's form is reviewed after the visit), and the workflow fields
--      (status, reviewer, ready, uploaded, Fusion check, superseded) still move. A correction is an Amend: a new form that
--      names the one it corrects, with a reason; the signed one stays.
--   3. Documents: signed-in browsers can no longer delete or overwrite files in lead-docs or agency-docs. The Hub's
--      Remove now hides the document and keeps the file. Each rule taken away is kept in evidence_storage_rule_removed
--      so the rollback can put it back exactly.
--   + bg_reviews: the review history can only grow (an update that shortens or rewrites earlier lines is refused).
--
-- Who can read the new tables: the server only (the exports). Browsers neither read nor write them. Nothing in them can
-- be updated, deleted or truncated, by anyone. No automatic purge (Phase 1 design section 11: seven years baseline).
-- Safe to run again. One transaction. Rollback: slice9-rollback.sql (removes the watchers, the GHE lock and the bg_reviews
-- guard, and puts the storage rules back; the history already written stays).
-- =============================================================================
begin;

do $pre$ begin
  if to_regclass('public.app_data') is null then raise exception 'slice 9 refused: app_data is missing. Nothing was changed.'; end if;
  if to_regclass('public.client_journey_step') is null then raise exception 'slice 9 refused: client_journey_step is missing. Nothing was changed.'; end if;
  if to_regclass('public.client_care_change') is null then raise exception 'slice 9 refused: client_care_change is missing. Nothing was changed.'; end if;
  if to_regclass('public.evv_submissions') is null then raise exception 'slice 9 refused: evv_submissions is missing. Nothing was changed.'; end if;
  if to_regclass('public.bg_reviews') is null then raise exception 'slice 9 refused: bg_reviews is missing. Nothing was changed.'; end if;
end $pre$;

-- ── the tables ─────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.evidence_history (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  source     text not null,              -- 'app_data:caregivers', 'app_data:ghe_forms', 'evv_submissions', 'client_care_change', ...
  record_id  text,
  change     text not null check (change in ('added', 'removed', 'changed', 'trigger_error')),
  field      text,                       -- the field for 'changed'; null for added/removed (the kept fields are in the value)
  old_value  jsonb,
  new_value  jsonb,
  actor      text not null default 'server',
  role       text not null default 'database',
  error      text
);
create index if not exists evidence_history_rec_ix on public.evidence_history (source, record_id, at desc);
comment on table public.evidence_history is 'Slice 9: value history of audit evidence (before and after, who, when). Append-only, server-only, no purge. Signatures and GHE answers are md5 fingerprints.';

create table if not exists public.journey_row_version (
  id         bigserial primary key,
  saved_at   timestamptz not null default now(),
  source     text not null check (source in ('client_journey', 'client_journey_step')),
  journey_id uuid,
  step_key   text,
  op         text not null check (op in ('UPDATE', 'DELETE')),
  row_before jsonb not null,             -- the whole row as it was before the change
  actor      text not null default 'server',
  role       text not null default 'database'
);
create index if not exists journey_row_version_ix on public.journey_row_version (journey_id, step_key, saved_at desc);
comment on table public.journey_row_version is 'Slice 9: the earlier version of every client_journey and client_journey_step row (client and caregiver journeys). Append-only, server-only.';

create table if not exists public.evidence_storage_rule_removed (
  id          bigserial primary key,
  removed_at  timestamptz not null default now(),
  policyname  text not null,
  cmd         text not null,
  roles       text[] not null,
  permissive  text not null,
  qual        text,
  with_check  text,
  replaced_by text[],
  restored_at timestamptz
);
comment on table public.evidence_storage_rule_removed is 'Slice 9: the storage rules that let browsers delete or overwrite lead-docs / agency-docs files, kept so the rollback can put them back exactly.';

-- append-only: no update, delete or truncate, for anyone (restored_at on the storage table is the one column the
-- rollback may set)
create or replace function public.evidence_append_only() returns trigger language plpgsql as $f$
begin
  if tg_table_name = 'evidence_storage_rule_removed' and tg_op = 'UPDATE'
     and (to_jsonb(new) - 'restored_at') = (to_jsonb(old) - 'restored_at') then return new; end if;
  raise exception '% is permanent: it cannot be %d', tg_table_name, lower(tg_op) using errcode = '42501';
end $f$;
do $g$ declare t text; begin
  foreach t in array array['evidence_history', 'journey_row_version', 'evidence_storage_rule_removed'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_keep', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.evidence_append_only()', t || '_keep', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.evidence_append_only()', t || '_no_truncate', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('revoke all on sequence public.%I from public, anon, authenticated', t || '_id_seq');
    execute format('grant select, insert on public.%I to service_role', t);
    execute format('grant usage, select on sequence public.%I to service_role', t || '_id_seq');
  end loop;
end $g$;
grant update (restored_at) on public.evidence_storage_rule_removed to service_role;

-- ── which fields are evidence, and how a value is kept ─────────────────────────────────────────────────────────────────
create or replace function public.evidence_field_kept(p_key text, p_field text) returns boolean
language sql immutable set search_path = pg_catalog as $f$
  select case
    when p_field is null or p_field ~* '(ssn|dob|birth|_number$|_no$|_phone$|_email$|_name$|_history$)' then false
    when p_key in ('candidates', 'caregivers') then
         p_field ~ '^(oig|fcsr|edl|ncsr|sor|ems|cnr|bgc|bg|mvr|fp|tb|cpr|dl|i9|w4|orient|alz|ojt_online|annual|eligibility)(_|$)'
      or p_field ~ '^r[1-5](s|_proof|_pdf|_status|_date|_at|_by|_verified[a-z_]*)$'
      or p_field ~ '^step2_(verified_at|verified_by|checklist|done_at|done_by|done_how|receipt|i9_s2_by|i9_s2_at)$'
      or p_field ~ '^approved_to_work'
      or p_field ~ '(_expires|_expiry|_exp)$'
      or p_field in ('hire_date', 'axiscare_id', 'status', 'level', 'cred', 'th_synced', 'first_contact')
    when p_key = 'medicaid_plans' then p_field in ('fusion_verified', 'pdf', 'pdf_earlier', 'start', 'changes', 'plan_start', 'plan_end',
         'generated', 'services', 'received_on', 'confirmed_by', 'confirmed_at', 'name_confirmed', 'dcn', 'reuploads', 'ghe_months')
    when p_key = 'ghe_forms' then p_field in ('status', 'f', 'checks', 'radios', 'client', 'client_id', 'visit_date', 'nurse', 'total',
         'sig_nurse', 'sig_part', 'sig_sup', 'rn_reviewer', 'rn_reviewed_at', 'rn_reviewed_by', 'ready_at', 'ready_by', 'uploaded_on',
         'uploaded_by', 'upload_due', 'uploaded_on_time', 'fusion_checked', 'amends', 'amend_reason', 'amended_by', 'superseded_by', 'superseded_at')
    else true end
$f$;

-- signatures, GHE answers and anything very long are kept as a fingerprint (md5 + length), never copied
create or replace function public.evidence_value(p_key text, p_field text, v jsonb) returns jsonb
language sql immutable set search_path = pg_catalog as $f$
  select case
    when v is null or jsonb_typeof(v) = 'null' then v
    when p_field like 'sig\_%' or p_field in ('signature', 'signature_png')
      or (p_key = 'ghe_forms' and p_field in ('f', 'checks', 'radios'))
      or length(v::text) > 8000
      then jsonb_build_object('md5', md5(v::text), 'len', length(v::text))
    else v end
$f$;

create or replace function public.evidence_subset(p_key text, rec jsonb) returns jsonb
language sql immutable set search_path = pg_catalog, public as $f$
  select case when jsonb_typeof(rec) <> 'object' then null
    else coalesce((select jsonb_object_agg(e.key, public.evidence_value(p_key, e.key, e.value)) from jsonb_each(rec) e
                    where public.evidence_field_kept(p_key, e.key)), '{}'::jsonb) end
$f$;

-- who made the change (the same reading as the 581 watcher)
create or replace function public.evidence_actor() returns text[]
language plpgsql stable set search_path = pg_catalog as $f$
declare claims jsonb;
begin
  begin claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then claims := null; end;
  return array[left(coalesce(nullif(claims->>'email', ''), nullif(claims->>'sub', ''), 'server'), 200), coalesce(nullif(claims->>'role', ''), 'database')];
end $f$;

-- ── watcher 1: app_data (candidates, caregivers, medicaid_plans, ghe_forms) ────────────────────────────────────────────
create or replace function public.evidence_capture_app_data() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $f$
declare k text; od jsonb; nd jsonb; om jsonb; nm jsonb; who text[] := array['server', 'database']; src text;
begin
  if tg_op = 'DELETE' then k := old.key; else k := new.key; end if;
  if k is null or k not in ('candidates', 'caregivers', 'medicaid_plans', 'ghe_forms') then return null; end if;
  src := 'app_data:' || k;
  begin
    who := public.evidence_actor();
    od := case when tg_op in ('UPDATE', 'DELETE') and jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end;
    nd := case when tg_op in ('INSERT', 'UPDATE') and jsonb_typeof(new.data) = 'array' then new.data else '[]'::jsonb end;
    if od = nd then return null; end if;
    /* only the records at positions that differ (the 581 speed rule), each side keyed by id */
    with d as (
      select o.e as oe, n.e as ne
        from jsonb_array_elements(od) with ordinality o(e, i)
        full join jsonb_array_elements(nd) with ordinality n(e, i) on n.i = o.i
       where o.e is distinct from n.e)
    select coalesce(jsonb_object_agg(oe->>'id', oe) filter (where jsonb_typeof(oe) = 'object' and coalesce(oe->>'id', '') <> ''), '{}'::jsonb),
           coalesce(jsonb_object_agg(ne->>'id', ne) filter (where jsonb_typeof(ne) = 'object' and coalesce(ne->>'id', '') <> ''), '{}'::jsonb)
      into om, nm from d;

    insert into public.evidence_history (source, record_id, change, field, old_value, new_value, actor, role)
    select src, i, 'removed', null, public.evidence_subset(k, om->i), null, who[1], who[2]
      from jsonb_object_keys(om) i where not nm ? i
    union all
    select src, i, 'added', null, null, public.evidence_subset(k, nm->i), who[1], who[2]
      from jsonb_object_keys(nm) i where not om ? i
    union all
    select src, i, 'changed', s.fk, public.evidence_value(k, s.fk, om->i->s.fk), public.evidence_value(k, s.fk, nm->i->s.fk), who[1], who[2]
      from jsonb_object_keys(nm) i
      cross join lateral (select x.fk from (select jsonb_object_keys(om->i) as fk union select jsonb_object_keys(nm->i)) x
                           where public.evidence_field_kept(k, x.fk) and (om->i->x.fk) is distinct from (nm->i->x.fk)) s
     where om ? i and (om->i) is distinct from (nm->i);
  exception when others then
    begin
      insert into public.evidence_history (source, change, actor, role, error) values (src, 'trigger_error', coalesce(who[1], 'server'), coalesce(who[2], 'database'), left(sqlerrm, 200));
    exception when others then raise warning 'evidence_history: could not even record the error (the save itself went through): %', sqlerrm;
    end;
  end;
  return null;
end $f$;
drop trigger if exists evidence_app_data_t on public.app_data;
create trigger evidence_app_data_t after insert or update of data on public.app_data
  for each row when (new.key in ('candidates', 'caregivers', 'medicaid_plans', 'ghe_forms'))
  execute function public.evidence_capture_app_data();
drop trigger if exists evidence_app_data_del_t on public.app_data;
create trigger evidence_app_data_del_t after delete on public.app_data
  for each row when (old.key in ('candidates', 'caregivers', 'medicaid_plans', 'ghe_forms'))
  execute function public.evidence_capture_app_data();

-- ── watcher 2: whole rows (evv_submissions, client_care_change); argument 1 is the id column ───────────────────────────
create or replace function public.evidence_capture_row() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $f$
declare o jsonb; n jsonb; rid text; who text[] := array['server', 'database']; src text := tg_table_name;
begin
  begin
    who := public.evidence_actor();
    if tg_op in ('UPDATE', 'DELETE') then o := to_jsonb(old); end if;
    if tg_op in ('INSERT', 'UPDATE') then n := to_jsonb(new); end if;
    rid := coalesce(n, o)->>tg_argv[0];
    if tg_op = 'INSERT' then
      insert into public.evidence_history (source, record_id, change, actor, role) values (src, rid, 'added', who[1], who[2]);
    elsif tg_op = 'DELETE' then
      insert into public.evidence_history (source, record_id, change, old_value, actor, role)
      values (src, rid, 'removed', (select jsonb_object_agg(e.key, public.evidence_value(src, e.key, e.value)) from jsonb_each(o) e), who[1], who[2]);
    else
      insert into public.evidence_history (source, record_id, change, field, old_value, new_value, actor, role)
      select src, rid, 'changed', x.fk, public.evidence_value(src, x.fk, o->x.fk), public.evidence_value(src, x.fk, n->x.fk), who[1], who[2]
        from (select jsonb_object_keys(o) as fk union select jsonb_object_keys(n)) x
       where x.fk <> 'updated_at' and (o->x.fk) is distinct from (n->x.fk);
    end if;
  exception when others then
    begin
      insert into public.evidence_history (source, record_id, change, actor, role, error) values (src, rid, 'trigger_error', coalesce(who[1], 'server'), coalesce(who[2], 'database'), left(sqlerrm, 200));
    exception when others then raise warning 'evidence_history: could not even record the error (the change itself went through): %', sqlerrm;
    end;
  end;
  return null;
end $f$;
drop trigger if exists evidence_evv_t on public.evv_submissions;
create trigger evidence_evv_t after insert or update or delete on public.evv_submissions
  for each row execute function public.evidence_capture_row('id');
drop trigger if exists evidence_care_change_t on public.client_care_change;
create trigger evidence_care_change_t after insert or update or delete on public.client_care_change
  for each row execute function public.evidence_capture_row('change_id');

-- ── watcher 3: earlier versions of journey and readiness rows ──────────────────────────────────────────────────────────
create or replace function public.journey_row_version_keep() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $f$
declare o jsonb := to_jsonb(old); who text[] := array['server', 'database'];
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at') = (o - 'updated_at') then return null; end if;
  begin
    who := public.evidence_actor();
    insert into public.journey_row_version (source, journey_id, step_key, op, row_before, actor, role)
    values (tg_table_name, (o->>'journey_id')::uuid, o->>'step_key', tg_op, o, who[1], who[2]);
  exception when others then
    begin
      insert into public.evidence_history (source, record_id, change, actor, role, error)
      values (tg_table_name, o->>'journey_id', 'trigger_error', coalesce(who[1], 'server'), coalesce(who[2], 'database'), left(sqlerrm, 200));
    exception when others then raise warning 'journey_row_version: could not even record the error (the change itself went through): %', sqlerrm;
    end;
  end;
  return null;
end $f$;
drop trigger if exists journey_row_version_t on public.client_journey;
create trigger journey_row_version_t after update or delete on public.client_journey
  for each row execute function public.journey_row_version_keep();
drop trigger if exists journey_row_version_t on public.client_journey_step;
create trigger journey_row_version_t after update or delete on public.client_journey_step
  for each row execute function public.journey_row_version_keep();

-- ── decision 2: a GHE form locks at the participant's signature ────────────────────────────────────────────────────────
create or replace function public.ghe_forms_lock() returns trigger
language plpgsql set search_path = pg_catalog, public as $f$
declare nm jsonb; it jsonb; ni jsonb; fld text; who text;
  locked text[] := array['checks', 'radios', 'client', 'client_id', 'visit_date', 'nurse', 'total', 'sig_nurse', 'sig_part'];
begin
  if tg_op = 'UPDATE' and new.key = old.key and new.data = old.data then return new; end if;
  nm := case when tg_op = 'UPDATE' and new.key = 'ghe_forms' and jsonb_typeof(new.data) = 'array'
             then coalesce((select jsonb_object_agg(e->>'id', e) from jsonb_array_elements(new.data) e
                             where jsonb_typeof(e) = 'object' and coalesce(e->>'id', '') <> ''), '{}'::jsonb)
             else '{}'::jsonb end;
  for it in select e from jsonb_array_elements(case when jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end) e
             where jsonb_typeof(e) = 'object' and coalesce(e->>'sig_part', '') <> '' loop
    who := coalesce(nullif(it->>'client', ''), 'a client') || ', visit ' || coalesce(nullif(it->>'visit_date', ''), '(no date)');
    ni := nm->(it->>'id');
    if ni is null then
      raise exception 'The signed GHE form for % cannot be removed. It stays as signed; use Amend to correct it.', who using errcode = '42501';
    end if;
    if ni = it then continue; end if;
    foreach fld in array locked loop
      if (it->fld) is distinct from (ni->fld) then
        raise exception 'The GHE form for % was signed by the participant, so its % cannot change. Use Amend to make a corrected copy; the signed form stays.', who, fld using errcode = '42501';
      end if;
    end loop;
    /* the answers: all locked, except the supervising RN's signature date until the RN signs */
    if (coalesce(it->'f', '{}'::jsonb) - 'ghe_sig_sup_date') is distinct from (coalesce(ni->'f', '{}'::jsonb) - 'ghe_sig_sup_date')
       or (coalesce(it->>'sig_sup', '') <> '' and (it->'f'->'ghe_sig_sup_date') is distinct from (ni->'f'->'ghe_sig_sup_date')) then
      raise exception 'The GHE form for % was signed by the participant, so its answers cannot change. Use Amend to make a corrected copy; the signed form stays.', who using errcode = '42501';
    end if;
    /* the supervising RN signs once (an LPN form is reviewed after the visit); after that it is locked too */
    if coalesce(it->>'sig_sup', '') <> '' and (it->'sig_sup') is distinct from (ni->'sig_sup') then
      raise exception 'The GHE form for % already has the supervising nurse''s signature, which cannot change. Use Amend to make a corrected copy.', who using errcode = '42501';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $f$;
drop trigger if exists ghe_forms_lock_t on public.app_data;
create trigger ghe_forms_lock_t before update or delete on public.app_data
  for each row when (old.key = 'ghe_forms') execute function public.ghe_forms_lock();

-- ── bg_reviews: the history only grows ────────────────────────────────────────────────────────────────────────────────
create or replace function public.bg_reviews_history_keep() returns trigger
language plpgsql set search_path = pg_catalog as $f$
declare o jsonb := coalesce(old.history, '[]'::jsonb); n jsonb := coalesce(new.history, '[]'::jsonb);
begin
  if jsonb_typeof(o) <> 'array' then return new; end if;
  if jsonb_typeof(n) <> 'array' or jsonb_array_length(n) < jsonb_array_length(o)
     or exists (select 1 from jsonb_array_elements(o) with ordinality x(e, i) where (n->(x.i::int - 1)) is distinct from x.e) then
    raise exception 'A background review''s history can only have lines added; an earlier line cannot be changed or removed.' using errcode = '42501';
  end if;
  return new;
end $f$;
drop trigger if exists bg_reviews_history_keep_t on public.bg_reviews;
create trigger bg_reviews_history_keep_t before update of history on public.bg_reviews
  for each row execute function public.bg_reviews_history_keep();

revoke all on function public.evidence_capture_app_data(), public.evidence_capture_row(), public.journey_row_version_keep(),
  public.ghe_forms_lock(), public.bg_reviews_history_keep(), public.evidence_append_only(), public.evidence_actor() from public, anon, authenticated;

-- ── decision 3: browsers cannot delete or overwrite lead-docs / agency-docs files ──────────────────────────────────────
-- Every storage rule that lets a signed-in browser (or everyone) DELETE or UPDATE in those two buckets is kept in
-- evidence_storage_rule_removed and then removed. A rule for ALL is split into the same rule for SELECT and INSERT first,
-- so reading and adding files keep working exactly as before. The server (service role) is not affected.
do $st$
declare p record; nm text[]; rs text;
begin
  if to_regclass('storage.objects') is null then raise notice 'slice 9: no storage schema here; storage rules skipped'; return; end if;
  for p in select * from pg_policies
            where schemaname = 'storage' and tablename = 'objects' and cmd in ('DELETE', 'UPDATE', 'ALL')
              and (roles && array['authenticated', 'public', 'anon']::name[])
              and (coalesce(qual, '') ~ '''(lead-docs|agency-docs)''' or coalesce(with_check, '') ~ '''(lead-docs|agency-docs)''') loop
    nm := null;
    rs := (select string_agg(quote_ident(r), ', ') from unnest(p.roles) r);
    if p.cmd = 'ALL' then
      nm := array[left(p.policyname, 40) || ' (read, slice 9)', left(p.policyname, 40) || ' (add, slice 9)'];
      execute format('drop policy if exists %I on storage.objects', nm[1]);
      execute format('drop policy if exists %I on storage.objects', nm[2]);
      execute format('create policy %I on storage.objects as %s for select to %s using (%s)', nm[1], p.permissive, rs, coalesce(p.qual, 'true'));
      execute format('create policy %I on storage.objects as %s for insert to %s with check (%s)', nm[2], p.permissive, rs, coalesce(p.with_check, p.qual, 'true'));
    end if;
    insert into public.evidence_storage_rule_removed (policyname, cmd, roles, permissive, qual, with_check, replaced_by)
    values (p.policyname, p.cmd, p.roles::text[], p.permissive, p.qual, p.with_check, nm);
    execute format('drop policy %I on storage.objects', p.policyname);
    raise notice 'slice 9: removed the storage rule "%" (%)', p.policyname, p.cmd;
  end loop;
end $st$;

-- ── self-check ─────────────────────────────────────────────────────────────────────────────────────────────────────────
do $v$ declare n int; begin
  select count(*) into n from pg_trigger where not tgisinternal and tgname in ('evidence_app_data_t', 'evidence_app_data_del_t', 'evidence_evv_t',
    'evidence_care_change_t', 'journey_row_version_t', 'ghe_forms_lock_t', 'bg_reviews_history_keep_t');
  if n <> 8 then raise exception 'slice 9 self-check: expected 8 watchers and guards, found %', n; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public'
              and table_name in ('evidence_history', 'journey_row_version', 'evidence_storage_rule_removed')
              and grantee in ('anon', 'authenticated', 'PUBLIC')) then
    raise exception 'slice 9 self-check: a browser role can reach the evidence tables';
  end if;
  if to_regclass('storage.objects') is not null and exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
       and cmd in ('DELETE', 'UPDATE', 'ALL') and (roles && array['authenticated', 'public', 'anon']::name[])
       and (coalesce(qual, '') ~ '''(lead-docs|agency-docs)''' or coalesce(with_check, '') ~ '''(lead-docs|agency-docs)''')) then
    raise exception 'slice 9 self-check: a browser can still delete or overwrite lead-docs or agency-docs files';
  end if;
  raise notice 'slice 9 installed: evidence history, journey row versions, the GHE lock, the bg_reviews guard and the document rules';
end $v$;

commit;
