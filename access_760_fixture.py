# 760 · a throwaway local Postgres set up like the shared hub project, for the access report rehearsal and the
# part 2 (lock-down) rehearsal. Made-up people only. Import and call make().
import os, json, glob, shutil, tempfile, uuid
import pgserver
from pg8000.native import Connection, DatabaseError
REF = "zngsgedlsxinbygwmxwn"
P = {k: str(uuid.uuid4()) for k in ("sam", "zach", "kry", "ang", "lone")}   # person ids
U = {k: str(uuid.uuid4()) for k in ("sam", "zach", "kry", "ang", "lone")}   # sign-in ids
KEYS = {"leads": ["care_coordinator"], "care_assessments": ["care_coordinator"], "medicaid_plans": ["care_coordinator"],
        "caregivers": ["care_coordinator", "staffing"], "candidates": ["staffing"], "ops_settings": ["care_coordinator", "team_hub"],
        "finance_snapshots": ["team_hub"], "budget_lines": ["team_hub"], "calls_cache": ["server_only"]}

def make():
    D = tempfile.mkdtemp(prefix="cc760-"); shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
    srv = pgserver.get_server(D)
    host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
    sock = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
    c = Connection(user="postgres", database="postgres", unix_sock=sock)
    c.run("drop schema if exists public cascade; drop schema if exists auth cascade; create schema public; create schema auth")
    for r in ("anon", "authenticated", "service_role"):
        try: c.run(f"create role {r}")
        except DatabaseError: pass
    c.run("alter role service_role bypassrls")
    c.run("grant usage on schema public, auth to anon, authenticated, service_role")
    c.run("create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz default now(), last_sign_in_at timestamptz, email_confirmed_at timestamptz default now(), banned_until timestamptz)")
    c.run("""create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$""")
    c.run("grant execute on function auth.uid() to anon, authenticated")
    c.run("""create function public.jwt_hub_access() returns jsonb language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'app_metadata' -> 'hub_access' $$""")
    c.run("create table public.persons(person_id uuid primary key, full_name text not null, primary_email text unique, active boolean not null default true)")
    c.run("create table public.auth_identities(person_id uuid references public.persons on delete cascade, project_ref text, auth_user_id uuid, login_email text, primary key (person_id, project_ref))")
    c.run("create table public.entity_memberships(person_id uuid references public.persons on delete cascade, entity text, active boolean not null default true, ended_at date, primary key (person_id, entity))")
    c.run("create table public.staff_roles(person_id uuid references public.persons on delete cascade, entity text, role text, primary key (person_id, entity, role))")
    c.run("revoke all on public.persons, public.auth_identities, public.staff_roles, public.entity_memberships from anon, authenticated")
    c.run("grant select on public.persons, public.auth_identities, public.staff_roles, public.entity_memberships to authenticated")
    people = [("sam", "Samantha Example", "samantha@mo-care.com", ["care_coordinator", "staffing", "team_hub"], "owner_admin"),
              ("zach", "Zach Example", "zach@mo-care.com", ["care_coordinator", "staffing", "team_hub"], "owner_admin"),
              ("kry", "Krystal Example", "krystal@mo-care.com", None, "care_coordinator"),
              ("ang", "Angiel Example", "angiel@mo-care.com", ["staffing"], "staffing_coordinator"),
              ("lone", None, "rn@example.invalid", ["rn_review"], None)]
    for k, name, email, hubs, role in people:
        md = {"provider": "email"} | ({"hub_access": hubs} if hubs is not None else {})
        c.run("insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, last_sign_in_at) values (:u, :e, :m, '{}', now())", u=U[k], e=email, m=json.dumps(md))
        if name:
            c.run("insert into public.persons values (:p, :n, :e, true)", p=P[k], n=name, e=email)
            c.run("insert into public.auth_identities values (:p, :r, :u, :e)", p=P[k], r=REF, u=U[k], e=email)
            c.run("insert into public.entity_memberships values (:p, 'cc_ihs', true, null)", p=P[k])
            c.run("insert into public.staff_roles values (:p, 'cc_ihs', :r)", p=P[k], r=role)
    # the shared record store, its key map and the live-shaped rules (013/016 + 576)
    c.run("create table public.app_data(key text primary key, data jsonb, updated_at timestamptz default now())")
    c.run("create table public.app_data_key_hub_map(data_key text, hub_slug text, primary key (data_key, hub_slug))")
    for k, hubs in KEYS.items():
        c.run("insert into public.app_data values (:k, :d)", k=k, d=json.dumps([{"secret": "SECRET-" + k}]))
        for h in hubs: c.run("insert into public.app_data_key_hub_map values (:k, :h)", k=k, h=h)
    c.run("grant select, insert, update, delete on public.app_data to authenticated")
    c.run("""create function public.can_access_data_key(k text) returns boolean language sql stable security definer set search_path = public as $$
      select public.jwt_hub_access() is null or exists (select 1 from public.app_data_key_hub_map m where m.data_key = k and public.jwt_hub_access() ? m.hub_slug) $$""")
    c.run("""create function public.desk_me() returns uuid language sql stable security definer set search_path = pg_catalog, public as $$
      select ai.person_id from public.auth_identities ai where ai.auth_user_id = auth.uid() and ai.project_ref = 'zngsgedlsxinbygwmxwn' limit 1 $$""")
    c.run("""create function public.desk_hub_ok() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
      select auth.uid() is not null and (public.jwt_hub_access() is null or public.jwt_hub_access() ? 'care_coordinator') $$""")
    c.run("""create function public.desk_is_owner() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
      select public.desk_hub_ok() and exists (select 1 from public.staff_roles r where r.person_id = public.desk_me() and r.entity = 'cc_ihs' and r.role = 'owner_admin') $$""")
    c.run("alter table public.app_data enable row level security")
    c.run('create policy "Hub-scoped read/write" on public.app_data for all to authenticated using (public.can_access_data_key(key)) with check (public.can_access_data_key(key))')
    ok = "key not in ('finance_snapshots', 'owner_settings', 'budget_lines', 'budget_actuals', 'offboardings', 'file_audits') or public.desk_is_owner()"
    c.run(f"create policy app_data_owner_keys_sel on public.app_data as restrictive for select to authenticated, anon using ({ok})")
    # the caller-recognition tables exactly as identity-layer.sql section 8 leaves them
    c.run("create table public.person_identity(id uuid primary key default gen_random_uuid(), display_name text)")
    c.run("create table public.person_source_id(person_id uuid, system text, source_id text, needs_review boolean default false)")
    c.run("create table public.person_role(person_id uuid, role text, status text)")
    c.run("create table public.person_relationship(person_id uuid, client_person_id uuid, kind text, active boolean default true)")
    c.run("create table public.phone_index(person_id uuid, phone text)")
    pid = c.run("insert into public.person_identity (display_name) values ('SECRET Client One'), ('SECRET Daughter') returning id")
    c.run("insert into public.phone_index values (:a, '4175550100'), (:b, '4175550100')", a=pid[0][0], b=pid[1][0])
    c.run("insert into public.person_role values (:a, 'client', 'active')", a=pid[0][0])
    c.run("insert into public.person_relationship values (:b, :a, 'daughter', true)", a=pid[0][0], b=pid[1][0])
    c.run("insert into public.person_source_id values (:a, 'axiscare', '123', false)", a=pid[0][0])
    c.run("""do $$ declare t text; begin
      foreach t in array array['person_identity','person_source_id','person_role','person_relationship','phone_index'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on public.%I from anon', t);
        execute format('grant select on public.%I to authenticated', t);
        execute format('grant all on public.%I to service_role', t);
        execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
      end loop; end $$""")
    c.run("""create view public.identity_completeness as select (select count(*)::int from public.person_identity) as persons,
      (select count(*)::int from public.phone_index) as phones""")
    c.run("revoke all on public.identity_completeness from anon; grant select on public.identity_completeness to authenticated")
    c.run("""create function public.identify_caller(p_phone text) returns table(person_id uuid, match_count int) language sql stable security definer
      set search_path = public as $$ select p.person_id, (count(*) over ())::int from public.phone_index p where p.phone = right(regexp_replace(p_phone, '\\D', '', 'g'), 10) $$""")
    c.run("revoke all on function public.identify_caller(text) from public, anon; grant execute on function public.identify_caller(text) to authenticated")
    # a table left wide open (row rules off) and one closed, so the sweep proves it tells them apart
    c.run("create table public.open_notes(id int, body text)"); c.run("insert into public.open_notes values (1, 'SECRET open')")
    c.run("grant select on public.open_notes to authenticated")
    c.run("create table public.closed_notes(id int)"); c.run("revoke all on public.closed_notes from anon, authenticated")
    return c, sock
