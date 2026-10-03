-- =============================================================================
-- 421 · SAFE SAVES PART 2: one person at a time, numbers given by the database
-- =============================================================================
-- Why: Aimee Driggers was lost because her Import got candidate number 10, a
-- number an older candidate already had (each Hub tab counted numbers on its
-- own), and the Hub saved the WHOLE list every time, so a page that opened
-- earlier could save its old list over newer work. From now on:
--
-- 1. app_data.version: a counter on every app_data row, bumped by the database
--    whenever that row's data changes (a writer cannot set it).
--
-- 2. Each person in 'candidates' and 'caregivers' carries _rev: a counter the
--    DATABASE bumps whenever that person's record changes, whoever saved it
--    (this function, upsert_app_data_item, an old whole-list save, a server
--    job). A record that has no _rev yet counts as 0, so nothing is rewritten
--    at install: a person gets _rev 1 the first time their record changes.
--    (Stamping 0 on everyone now would rewrite both lists, put ~60 'changed'
--    lines in the 418 history and race with the office saving; it buys
--    nothing because "missing" and 0 mean the same thing.) A save that
--    carries an OLDER _rev for a record it did not change gets the current
--    _rev back, so an old page can never wind a record's counter backwards.
--
-- 3. app_data_items_apply(key, changes, expected): the Hub's new save for
--    candidates and caregivers. It sends only what changed:
--      {op:'put', id, record, base_rev}  one person's whole record
--      {op:'add', record, tmp}           a new person; the database gives the number
--      {op:'remove', id, base_rev}       take one person off the list
--      {op:'allow_bulk_remove'}          see below
--    All or nothing, under a row lock (waits at most 3 seconds). A put or
--    remove whose base_rev is not that person's current _rev is a CONFLICT:
--    nothing is saved and the answer lists who and their current record, so
--    the page can reload and ask the person to redo their change. Removing
--    more than 2 people in one save is refused unless the save says
--    allow_bulk_remove (recorded either way). Every refusal leaves a line in
--    app_data_conflict_log (when, key, who, which numbers, why).
--    NEW NUMBERS ARE NEVER REUSED: app_data_id_counter keeps the highest
--    number ever given per list. A removed person's number stays retired,
--    because reference requests, welcome calls and caregiver profiles keep
--    pointing at it (exactly how Aimee's references ended up on #10). The
--    counter starts above every number already in the list, in the 418
--    history, and in those tables.
--
-- 4. app_data_save(key, data, expected_version): a whole-value save for the
--    OTHER keys (settings and the like) that refuses when someone else saved
--    since the page loaded and hands back the current data + version. It runs
--    as the caller, so every existing read/write rule on app_data still
--    applies. Created now; the Hub starts using it in a later step (3c).
--
-- Works alongside the 418 history (it still records added / removed / changed
-- per person; '_rev' shows among the changed field names), lead_change_capture
-- (leads only) and trg_touch_app_data (updated_at). Every other key and every
-- other hub is untouched; the only change they see is the version counter.
-- No grant or revoke on app_data itself. Safe to run again. One transaction.
-- =============================================================================

begin;
set local lock_timeout = '5s';

-- ── 1. the version counter ───────────────────────────────────────────────────
alter table public.app_data add column if not exists version bigint not null default 0;
comment on column public.app_data.version is
  '421 · bumped by the database (app_data_version_t) every time this row''s data changes; writers cannot set it.';

-- a person's _rev (missing or not a whole number = 0)
create or replace function public.app_data_rev(x jsonb) returns bigint
language sql immutable set search_path = pg_catalog, public as $r$
  select coalesce(case when (x->>'_rev') ~ '^[0-9]{1,15}$' then (x->>'_rev')::bigint end, 0)
$r$;

-- the new list with each person's _rev set by the rule above (order and everything else untouched)
create or replace function public.app_data_stamp_revs(od jsonb, nd jsonb) returns jsonb
language sql immutable set search_path = pg_catalog, public as $s$
  with o as (
    select x->>'id' as id, x, count(*) over (partition by x->>'id') as n
      from jsonb_array_elements(od) x
     where jsonb_typeof(x) = 'object' and coalesce(x->>'id', '') <> ''
  ), om as (select id, x from o where n = 1),
  nn as (
    select x, ord, case when jsonb_typeof(x) = 'object' then x->>'id' end as id,
           count(*) over (partition by case when jsonb_typeof(x) = 'object' then x->>'id' end) as n
      from jsonb_array_elements(nd) with ordinality t(x, ord)
  )
  select coalesce(jsonb_agg(
           case
             when nn.id is null or nn.id = '' or nn.n <> 1 or om.id is null then nn.x
             when (nn.x - '_rev') = (om.x - '_rev') then
               case when om.x ? '_rev' then nn.x || jsonb_build_object('_rev', om.x->'_rev') else nn.x - '_rev' end
             else nn.x || jsonb_build_object('_rev', public.app_data_rev(om.x) + 1)
           end order by nn.ord), '[]'::jsonb)
    from nn left join om on om.id = nn.id
$s$;

create or replace function public.app_data_version_bump() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $v$
begin
  if tg_op = 'INSERT' then
    new.version := 0;
    return new;
  end if;
  if new.data is distinct from old.data then
    new.version := coalesce(old.version, 0) + 1;
    if new.key in ('candidates', 'caregivers') and jsonb_typeof(new.data) = 'array' and jsonb_typeof(old.data) = 'array' then
      begin
        new.data := public.app_data_stamp_revs(old.data, new.data);
      exception when others then
        raise warning 'app_data_version_bump: could not stamp _rev on % (the save itself goes through): %', new.key, sqlerrm;
      end;
    end if;
  else
    new.version := old.version;
  end if;
  return new;
end $v$;

drop trigger if exists app_data_version_t on public.app_data;
create trigger app_data_version_t before insert or update on public.app_data
  for each row execute function public.app_data_version_bump();

-- ── 2. numbers are never reused ──────────────────────────────────────────────
create table if not exists public.app_data_id_counter (
  key        text primary key,
  last_id    bigint      not null default 0,
  updated_at timestamptz not null default now()
);
comment on table public.app_data_id_counter is
  '421 · the highest person number ever given per list (candidates, caregivers). Only app_data_items_apply writes it. A number is never given twice, even after that person is removed.';
alter table public.app_data_id_counter enable row level security;
revoke all on public.app_data_id_counter from public, anon, authenticated;

-- start each counter above every number already used anywhere we know of
do $seed$
declare k text; m bigint; t text; q text;
begin
  foreach k in array array['candidates', 'caregivers'] loop
    select coalesce(max((x->>'id')::bigint), 0) into m
      from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) x
     where a.key = k and jsonb_typeof(x) = 'object' and (x->>'id') ~ '^[0-9]{1,15}$' and (x->>'id')::bigint <= 1000000;
    if to_regclass('public.app_data_item_change') is not null then
      execute $q$select greatest($1, coalesce(max(record_id::bigint), 0)) from public.app_data_item_change
                  where key = $2 and record_id ~ '^[0-9]{1,15}$' and record_id::bigint <= 1000000$q$ into m using m, k;
    end if;
    if k = 'candidates' then
      -- roster records keep the candidate number they came from
      select greatest(m, coalesce(max((x->>'candidate_id')::bigint), 0)) into m
        from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) x
       where a.key = 'caregivers' and jsonb_typeof(x) = 'object' and (x->>'candidate_id') ~ '^[0-9]{1,15}$' and (x->>'candidate_id')::bigint <= 1000000;
      foreach t in array array['reference_requests', 'welcome_calls', 'caregiver_profiles'] loop
        if to_regclass('public.' || t) is not null and exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = t and column_name = 'candidate_id') then
          q := format($f$select greatest($1, coalesce(max(candidate_id::text::bigint), 0)) from public.%I
                         where candidate_id::text ~ '^[0-9]{1,15}$' and candidate_id::text::bigint <= 1000000$f$, t);
          execute q into m using m;
        end if;
      end loop;
    end if;
    insert into public.app_data_id_counter (key, last_id) values (k, m)
      on conflict (key) do update set last_id = greatest(public.app_data_id_counter.last_id, excluded.last_id), updated_at = now();
  end loop;
end $seed$;

-- ── 3. the refusal log ───────────────────────────────────────────────────────
create table if not exists public.app_data_conflict_log (
  id     bigserial   primary key,
  at     timestamptz not null default now(),
  key    text        not null,
  actor  text        not null default 'server',
  ids    text[],
  reason text        not null,
  detail jsonb
);
comment on table public.app_data_conflict_log is
  '421 · one line per save app_data_items_apply refused (conflict, gone, duplicate_id, bulk_remove_refused, version) or a bulk removal it was told to allow (bulk_remove_allowed). Record numbers only, never record contents.';
create index if not exists app_data_conflict_log_key_at_ix on public.app_data_conflict_log (key, at desc);
alter table public.app_data_conflict_log enable row level security;
revoke all on public.app_data_conflict_log from public, anon, authenticated;
revoke all on sequence public.app_data_conflict_log_id_seq from public, anon, authenticated;
grant select on public.app_data_conflict_log to authenticated;
drop policy if exists app_data_conflict_log_read on public.app_data_conflict_log;
create policy app_data_conflict_log_read on public.app_data_conflict_log for select to authenticated
  using (public.can_access_data_key(key));

-- ── 4. the per-person save ───────────────────────────────────────────────────
create or replace function public.app_data_items_apply(p_key text, p_changes jsonb, p_expected jsonb default null)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '3s'
as $fn$
declare
  claims jsonb; v_role text; v_actor text;
  cur jsonb; v_version bigint; ch jsonb; op text; idt text; tmpt text;
  puts jsonb := '{}'; rems text[] := '{}'; adds jsonb := '[]'; touched text[] := '{}'; tmps text[] := '{}';
  allow_bulk boolean := false; conflicts jsonb := '[]'; bad_ids text[] := '{}';
  idx jsonb := '{}'; cnt jsonb := '{}'; x jsonb; c_rec jsonb; n_same int;
  newarr jsonb := '[]'; nxt bigint; maxid bigint; ids jsonb := '{}'; revs jsonb := '{}'; outdata jsonb; v_new bigint;
begin
  begin claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then claims := null; end;
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), claims->>'role', '');
  if v_role <> 'authenticated' then
    raise exception 'app_data_items_apply: sign in first' using errcode = '42501';
  end if;
  v_actor := left(coalesce(nullif(claims->>'email', ''), nullif(claims->>'sub', ''), 'unknown'), 200);
  if p_key is null or p_key not in ('candidates', 'caregivers') then
    raise exception 'app_data_items_apply: only candidates and caregivers are saved this way (got %)', coalesce(p_key, 'nothing') using errcode = '22023';
  end if;
  if not public.can_access_data_key(p_key) then
    raise exception 'app_data_items_apply: you do not have access to %', p_key using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'app_data_items_apply: changes must be a list' using errcode = '22023';
  end if;

  -- read and check every change before touching anything
  for ch in select value from jsonb_array_elements(p_changes) loop
    op := case when jsonb_typeof(ch) = 'object' then ch->>'op' end;
    if op = 'allow_bulk_remove' then allow_bulk := true; continue; end if;
    if op in ('put', 'remove') then
      idt := ch->>'id';
      if idt is null or idt = '' then raise exception 'app_data_items_apply: a % has no id', op using errcode = '22023'; end if;
      if idt = any(touched) then raise exception 'app_data_items_apply: record % appears twice in one save', idt using errcode = '22023'; end if;
      touched := touched || idt;
      if op = 'put' then
        if jsonb_typeof(ch->'record') <> 'object' then raise exception 'app_data_items_apply: put % has no record', idt using errcode = '22023'; end if;
        puts := puts || jsonb_build_object(idt, ch);
      else
        rems := rems || idt;
      end if;
    elsif op = 'add' then
      tmpt := ch->>'tmp';
      if tmpt is null or tmpt = '' then raise exception 'app_data_items_apply: an add has no tmp' using errcode = '22023'; end if;
      if tmpt = any(tmps) then raise exception 'app_data_items_apply: tmp % appears twice', tmpt using errcode = '22023'; end if;
      if jsonb_typeof(ch->'record') <> 'object' then raise exception 'app_data_items_apply: add % has no record', tmpt using errcode = '22023'; end if;
      tmps := tmps || tmpt;
      adds := adds || jsonb_build_array(ch);
    else
      raise exception 'app_data_items_apply: unknown change %', coalesce(op, '(none)') using errcode = '22023';
    end if;
  end loop;

  -- the list, locked until this save ends (a second save waits here, at most 3 seconds)
  insert into public.app_data (key, data, updated_at) values (p_key, '[]'::jsonb, now()) on conflict (key) do nothing;
  select data, version into cur, v_version from public.app_data where key = p_key for update;
  if cur is null then cur := '[]'::jsonb; end if;
  if jsonb_typeof(cur) <> 'array' then
    raise exception 'app_data_items_apply: % is not a list', p_key using errcode = '22023';
  end if;

  if p_expected is not null and jsonb_typeof(p_expected) = 'object' and p_expected ? 'version'
     and (p_expected->>'version') is distinct from v_version::text then
    insert into public.app_data_conflict_log (key, actor, ids, reason, detail)
    values (p_key, v_actor, touched, 'version', jsonb_build_object('expected', p_expected->'version', 'current', v_version));
    return jsonb_build_object('ok', false, 'reason', 'version', 'version', v_version, 'conflicts', '[]'::jsonb);
  end if;

  -- each current person by number (and how many share it)
  for x in select value from jsonb_array_elements(cur) loop
    if jsonb_typeof(x) = 'object' and coalesce(x->>'id', '') <> '' then
      cnt := cnt || jsonb_build_object(x->>'id', coalesce((cnt->>(x->>'id'))::int, 0) + 1);
      idx := idx || jsonb_build_object(x->>'id', x);
    end if;
  end loop;

  foreach idt in array touched loop
    ch := coalesce(puts->idt, (select value from jsonb_array_elements(p_changes) where value->>'op' = 'remove' and value->>'id' = idt limit 1));
    n_same := coalesce((cnt->>idt)::int, 0);
    c_rec := idx->idt;
    if n_same = 0 then
      conflicts := conflicts || jsonb_build_array(jsonb_build_object('id', ch->'id', 'reason', 'gone', 'current_record', null));
      bad_ids := bad_ids || idt;
    elsif n_same > 1 then
      conflicts := conflicts || jsonb_build_array(jsonb_build_object('id', ch->'id', 'reason', 'duplicate_id', 'current_record', null));
      bad_ids := bad_ids || idt;
    elsif ch ? 'base_rev' and jsonb_typeof(ch->'base_rev') <> 'null'
          and public.app_data_rev(jsonb_build_object('_rev', ch->'base_rev')) <> public.app_data_rev(c_rec) then
      conflicts := conflicts || jsonb_build_array(jsonb_build_object('id', ch->'id', 'reason', 'changed', 'current_record', c_rec));
      bad_ids := bad_ids || idt;
    end if;
  end loop;

  if jsonb_array_length(conflicts) > 0 then
    insert into public.app_data_conflict_log (key, actor, ids, reason, detail)
    values (p_key, v_actor, bad_ids,
            case when exists (select 1 from jsonb_array_elements(conflicts) c where c->>'reason' = 'duplicate_id') then 'duplicate_id'
                 when exists (select 1 from jsonb_array_elements(conflicts) c where c->>'reason' = 'changed') then 'conflict'
                 else 'gone' end,
            jsonb_build_object('puts', (select count(*) from jsonb_object_keys(puts)), 'removes', cardinality(rems), 'adds', jsonb_array_length(adds)));
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'version', v_version, 'conflicts', conflicts);
  end if;

  if cardinality(rems) > 2 and not allow_bulk then
    insert into public.app_data_conflict_log (key, actor, ids, reason, detail)
    values (p_key, v_actor, rems, 'bulk_remove_refused', jsonb_build_object('removes', cardinality(rems)));
    return jsonb_build_object('ok', false, 'reason', 'bulk_remove', 'removes', cardinality(rems), 'version', v_version, 'conflicts', '[]'::jsonb);
  end if;

  -- apply: keep order, swap in the puts, drop the removes, then the adds with fresh numbers
  for x in select value from jsonb_array_elements(cur) loop
    idt := case when jsonb_typeof(x) = 'object' then x->>'id' end;
    if idt is not null and idt = any(rems) then continue; end if;
    if idt is not null and puts ? idt then
      newarr := newarr || jsonb_build_array(((puts->idt->'record') - '_rev') || jsonb_build_object('id', x->'id'));
    else
      newarr := newarr || jsonb_build_array(x);
    end if;
  end loop;

  if jsonb_array_length(adds) > 0 then
    select coalesce(max((v->>'id')::bigint), 0) into maxid from jsonb_array_elements(cur) v
     where jsonb_typeof(v) = 'object' and (v->>'id') ~ '^[0-9]{1,15}$';
    insert into public.app_data_id_counter (key, last_id) values (p_key, 0) on conflict (key) do nothing;
    select last_id into nxt from public.app_data_id_counter where key = p_key for update;
    nxt := greatest(coalesce(nxt, 0), maxid);
    for ch in select value from jsonb_array_elements(adds) loop
      nxt := nxt + 1;
      newarr := newarr || jsonb_build_array(((ch->'record') - '_rev' - 'id') || jsonb_build_object('id', nxt));
      ids := ids || jsonb_build_object(ch->>'tmp', nxt);
    end loop;
    update public.app_data_id_counter set last_id = nxt, updated_at = now() where key = p_key;
  end if;

  update public.app_data set data = newarr, updated_at = now() where key = p_key
    returning data, version into outdata, v_new;

  -- each saved person's _rev as the database stamped it
  for x in select value from jsonb_array_elements(outdata) loop
    idt := case when jsonb_typeof(x) = 'object' then x->>'id' end;
    if idt is not null and (puts ? idt or exists (select 1 from jsonb_each_text(ids) e where e.value = idt)) then
      revs := revs || jsonb_build_object(idt, public.app_data_rev(x));
    end if;
  end loop;

  if cardinality(rems) > 2 then
    insert into public.app_data_conflict_log (key, actor, ids, reason, detail)
    values (p_key, v_actor, rems, 'bulk_remove_allowed', jsonb_build_object('removes', cardinality(rems)));
  end if;

  return jsonb_build_object('ok', true, 'version', v_new, 'ids', ids, 'revs', revs, 'removed', to_jsonb(rems));
end $fn$;

-- ── 5. the whole-value save for other keys (Hub adoption is step 3c) ─────────
create or replace function public.app_data_save(p_key text, p_data jsonb, p_expected_version bigint)
returns jsonb
language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '3s'
as $sv$
declare claims jsonb; v_role text; cur_data jsonb; cur_version bigint; v_new bigint;
begin
  begin claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then claims := null; end;
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), claims->>'role', '');
  if v_role <> 'authenticated' then
    raise exception 'app_data_save: sign in first' using errcode = '42501';
  end if;
  if p_key is null or p_key = '' or p_data is null then
    raise exception 'app_data_save: a key and data are needed' using errcode = '22023';
  end if;
  if p_key in ('candidates', 'caregivers') then
    raise exception 'app_data_save: % is saved one person at a time (app_data_items_apply)', p_key using errcode = '22023';
  end if;
  if not public.can_access_data_key(p_key) then
    raise exception 'app_data_save: you do not have access to %', p_key using errcode = '42501';
  end if;
  select data, version into cur_data, cur_version from public.app_data where key = p_key for update;
  if not found then
    if coalesce(p_expected_version, 0) <> 0 then
      return jsonb_build_object('ok', false, 'reason', 'version', 'version', null, 'data', null);
    end if;
    insert into public.app_data (key, data, updated_at) values (p_key, p_data, now()) returning version into v_new;
    return jsonb_build_object('ok', true, 'version', v_new);
  end if;
  if p_expected_version is null or cur_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'version', 'version', cur_version, 'data', cur_data);
  end if;
  update public.app_data set data = p_data, updated_at = now() where key = p_key returning version into v_new;
  if not found then
    raise exception 'app_data_save: % could not be saved', p_key using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true, 'version', v_new);
end $sv$;

-- who may call what: signed-in staff only; the helpers are internal
revoke all on function public.app_data_items_apply(text, jsonb, jsonb) from public, anon;
grant execute on function public.app_data_items_apply(text, jsonb, jsonb) to authenticated;
revoke all on function public.app_data_save(text, jsonb, bigint) from public, anon;
grant execute on function public.app_data_save(text, jsonb, bigint) to authenticated;
revoke all on function public.app_data_rev(jsonb) from public, anon, authenticated;
revoke all on function public.app_data_stamp_revs(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.app_data_version_bump() from public, anon, authenticated;

do $verify$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_data' and column_name = 'version') then
    raise exception '421 self-check: app_data.version is missing';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.app_data'::regclass and tgname = 'app_data_version_t' and not tgisinternal) <> 1 then
    raise exception '421 self-check: the version trigger is not attached';
  end if;
  if not exists (select 1 from pg_proc where proname = 'app_data_items_apply' and pronamespace = 'public'::regnamespace and prosecdef) then
    raise exception '421 self-check: app_data_items_apply must run as its owner';
  end if;
  if exists (select 1 from pg_proc where proname = 'app_data_save' and pronamespace = 'public'::regnamespace and prosecdef) then
    raise exception '421 self-check: app_data_save must run as the caller';
  end if;
  if has_function_privilege('anon', 'public.app_data_items_apply(text, jsonb, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.app_data_save(text, jsonb, bigint)', 'execute') then
    raise exception '421 self-check: anon could call the new saves';
  end if;
  if not has_function_privilege('authenticated', 'public.app_data_items_apply(text, jsonb, jsonb)', 'execute') then
    raise exception '421 self-check: signed-in staff cannot call app_data_items_apply';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.app_data_conflict_log'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.app_data_id_counter'::regclass) then
    raise exception '421 self-check: row security is off on a new table';
  end if;
  raise notice '421 installed: version counter, per-person _rev, app_data_items_apply, app_data_save';
end $verify$;

commit;
