#!/usr/bin/env python3
# Rehearsal of 995 (lead_owner_guard_995.sql, audit step 8): the guard in a throwaway LOCAL Postgres (pgserver) set up
# like the live app_data (invoker save function, row security, My Desk's owner test), then saves tried AS Krystal (a Care
# Coordinator), AS Samantha (an owner) and as a server job, with the switch off and on. Never touches Supabase.
#   python3 lead_owner_guard_995_test.py
import json, os, tempfile, glob
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
D = tempfile.mkdtemp(prefix="t995-"); srv = pgserver.get_server(D)
host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
c = Connection(user="postgres", database="postgres", unix_sock=SOCK)
SAM, KRY = "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"
U = {SAM: "a0000000-0000-0000-0000-000000000001", KRY: "a0000000-0000-0000-0000-000000000002"}
LEADS = [{"id": "l1", "client_first_name": "Rose", "assigned_coordinator": "Angiel", "original_owner": {"name": "Angiel", "at": "x", "how": "turn"}, "note": ""},
         {"id": "l2", "client_first_name": "Bea", "assigned_coordinator": "", "note": ""}]
def seed(settings):
    for q in ["drop schema if exists public cascade", "create schema public", "drop schema if exists auth cascade", "create schema auth",
      "do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if; if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if; end $$",
      "grant usage on schema public, auth to authenticated, anon",
      "create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$",
      "create function auth.uid() returns uuid language sql stable as $$ select nullif(coalesce(current_setting('request.jwt.claim.sub', true), auth.jwt()->>'sub'), '')::uuid $$",
      "create table public.app_data(key text primary key, data jsonb)", "grant select, insert, update on public.app_data to authenticated",
      "alter table public.app_data enable row level security",
      "create policy open_all on public.app_data for all to authenticated using (true) with check (true)",
      """create function public.upsert_app_data_item(target_key text, item jsonb) returns void language plpgsql security invoker as $$
declare d jsonb; begin select data into d from app_data where key = target_key for update;
  update app_data set data = (select coalesce(jsonb_agg(case when x->>'id' = item->>'id' then item else x end), '[]'::jsonb) from jsonb_array_elements(d) x) where key = target_key; end $$""",
      "grant execute on function public.upsert_app_data_item(text, jsonb) to authenticated",
      "create table public.auth_identities(auth_user_id uuid, person_id uuid)", "create table public.staff_roles(person_id uuid, entity text, role text)",
      "create function public.desk_me() returns uuid language sql stable security definer set search_path = pg_catalog, public as $$ select person_id from public.auth_identities where auth_user_id = auth.uid() limit 1 $$",
      "create function public.desk_is_owner() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$ select exists (select 1 from public.staff_roles r where r.person_id = public.desk_me() and r.entity = 'cc_ihs' and r.role = 'owner_admin') $$"]:
        c.run(q)
    for p in (SAM, KRY): c.run("insert into public.auth_identities values (cast(:u as uuid), cast(:p as uuid))", u=U[p], p=p)
    c.run("insert into public.staff_roles values (cast(:p as uuid), 'cc_ihs', 'owner_admin')", p=SAM)
    c.run("insert into public.staff_roles values (cast(:p as uuid), 'cc_ihs', 'care_coordinator')", p=KRY)
    c.run("insert into public.app_data values ('leads', cast(:d as jsonb))", d=json.dumps(LEADS))
    c.run("insert into public.app_data values ('ops_settings', cast(:d as jsonb))", d=json.dumps(settings))
    c.run(open(os.path.join(HERE, "lead_owner_guard_995.sql")).read())
def save(who, item):
    """save one lead as who (KRY / SAM / None = a server job); returns None when saved, else the error text"""
    try:
        c.run("begin")
        if who:
            c.run("select set_config('request.jwt.claims', :j, true)", j=json.dumps({"sub": U[who], "role": "authenticated"}))
            c.run("select set_config('request.jwt.claim.sub', :s, true)", s=U[who]); c.run("set local role authenticated")
        else: c.run("select set_config('request.jwt.claims', :j, true)", j=json.dumps({"role": "service_role"}))
        c.run("select public.upsert_app_data_item('leads', cast(:i as jsonb))", i=json.dumps(item)); c.run("commit"); return None
    except DatabaseError as e:
        c.run("rollback"); return str(e)
def lead(i): return next(x for x in c.run("select data from public.app_data where key = 'leads'")[0][0] if x["id"] == i)
L1 = lambda **k: {**LEADS[0], **k}
try:
    seed({"owner_guard_live": False, "lead_rotation_live": True})
    ck("off · Krystal can still change an owner (as today)", save(KRY, L1(assigned_coordinator="Krystal")) is None and lead("l1")["assigned_coordinator"] == "Krystal")
    seed({"owner_guard_live": True, "lead_rotation_live": True})
    e = save(KRY, L1(assigned_coordinator="Krystal"))
    ck("on · Krystal moving Angiel's lead to herself is refused, with the reason and the client's name", e and "LEAD_OWNER_GUARD" in e and "Rose" in e and lead("l1")["assigned_coordinator"] == "Angiel", e)
    ck("on · first names only: 'angiel rose' is the same owner, so it saves", save(KRY, L1(assigned_coordinator="angiel rose")) is None)
    ck("on · Krystal's ordinary edit (a note) saves", save(KRY, L1(note="called back")) is None and lead("l1")["note"] == "called back")
    ck("on · a lead with no owner can be given one by anyone (a new lead by turn)", save(KRY, {**LEADS[1], "assigned_coordinator": "Krystal"}) is None)
    ck("on · Samantha (an owner) changes the owner", save(SAM, L1(assigned_coordinator="Krystal")) is None and lead("l1")["assigned_coordinator"] == "Krystal")
    e = save(SAM, L1(assigned_coordinator="Krystal", original_owner={"name": "Krystal"}))
    ck("on · nobody, not even Samantha, changes the original owner from a browser", e and "LEAD_OWNER_GUARD" in e and lead("l1")["original_owner"]["name"] == "Angiel", e)
    ck("on · an empty original owner can be filled (the Hub does that when the owner first changes)", save(KRY, {**lead("l2"), "original_owner": {"name": "Krystal"}}) is None)
    ck("on · a server job (lead-watch, cc-team) is never stopped", save(None, L1(assigned_coordinator="Angiel", original_owner={"name": "Zed"})) is None and lead("l1")["original_owner"]["name"] == "Zed")
    seed({"owner_guard_live": True, "lead_rotation_live": False})
    ck("on, lead turns off · Krystal can take a lead the old way", save(KRY, L1(assigned_coordinator="Krystal")) is None)
    e = save(KRY, L1(assigned_coordinator="Krystal", original_owner={"name": "Krystal"}))
    ck("on, lead turns off · the original owner still never changes", e and "LEAD_OWNER_GUARD" in e, e)
    c.run("update public.app_data set data = '[]'::jsonb where key = 'ops_settings'")
    ck("settings not a map · treated as off (saves go through)", save(KRY, L1(assigned_coordinator="Krystal", original_owner={"name": "Krystal"})) is None)
    c.run(open(os.path.join(HERE, "lead_owner_guard_995.sql")).read())
    ck("running the install again is safe (one trigger)", c.run("select count(*) from pg_trigger where tgname = 'lead_owner_guard' and not tgisinternal")[0][0] == 1)
    c.run(open(os.path.join(HERE, "lead_owner_guard_995_rollback.sql")).read())
    ck("the undo removes the trigger and the function", c.run("select count(*) from pg_trigger where tgname = 'lead_owner_guard'")[0][0] == 0 and c.run("select count(*) from pg_proc where proname = 'lead_owner_guard'")[0][0] == 0)
    # ── the step itself (lead_owner_guard_995.py) against this database, through a fake management API ──
    import threading, http.server, subprocess
    PSQL = os.path.join(os.path.dirname(pgserver.__file__), "pginstall", "bin", "psql")
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_POST(self):
            q = json.loads(self.rfile.read(int(self.headers["Content-Length"])))["query"]
            p_ = subprocess.run([PSQL, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", host, "-U", "postgres", "-d", "postgres", "-c", q], capture_output=True, text=True)
            out = p_.stdout.strip()
            body, code = (json.dumps([{"r": out}] if out else []), 200) if p_.returncode == 0 else (json.dumps({"message": p_.stderr}), 400)
            self.send_response(code); self.end_headers(); self.wfile.write(body.encode())
    hs = http.server.HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=hs.serve_forever, daemon=True).start()
    LEADS[0] = {k: v for k, v in LEADS[0].items() if k != "original_owner"}   # like live: owned leads from before turns have no first owner
    seed({"owner_guard_live": False, "lead_rotation_live": False})
    c.run(open(os.path.join(HERE, "lead_owner_guard_995_rollback.sql")).read())
    c.run("create table auth.users(id uuid primary key, banned_until timestamptz, raw_app_meta_data jsonb default '{}')")
    c.run("create table public.persons(person_id uuid primary key, full_name text, primary_email text, active boolean default true)")
    for pid, n, e in ((SAM, "Samantha Troutman", "samantha@mo-care.com"), (KRY, "Krystal Land", "krystal@mo-care.com")):
        c.run("insert into public.persons values (cast(:p as uuid), :n, :e, true)", p=pid, n=n, e=e); c.run("insert into auth.users(id) values (cast(:u as uuid))", u=U[pid])
    rep = os.path.join(D, "rep.txt")
    pr = subprocess.run(["python3", os.path.join(HERE, "lead_owner_guard_995.py")], capture_output=True, text=True,
        env={**os.environ, "SB_API_BASE": f"http://127.0.0.1:{hs.server_port}", "SB_TOKEN": "sbp_fake", "SB_REPORT": rep, "SB_STEP": "995"})
    out = pr.stdout
    ck("the step · installs, proves Krystal is refused and Samantha is not, and leaves the switch as it was", pr.returncode == 0 and "acting as Krystal Land (a Care Coordinator" in out and "no, can move a lead" in out
       and "acting as Samantha Troutman (an owner" in out and "yes, can move a lead" in out and "the refusal says why" in out and "exactly as it was" in out and "RESULT: DONE" in out, out[-1800:] + pr.stderr[-400:])
    st = c.run("select data from public.app_data where key = 'ops_settings'")[0][0]
    ck("the step · the switch is still off and no lead changed (the test first owner was undone too)", st.get("owner_guard_live") is False and lead("l1")["assigned_coordinator"] == "Angiel" and "original_owner" not in lead("l1"), st)
    pr2 = subprocess.run(["python3", os.path.join(HERE, "lead_owner_guard_995.py")], capture_output=True, text=True,
        env={**os.environ, "SB_API_BASE": f"http://127.0.0.1:{hs.server_port}", "SB_TOKEN": "sbp_fake", "SB_REPORT": rep, "SB_STEP": "995"})
    ck("the step · safe to run again", pr2.returncode == 0 and "already installed" in pr2.stdout, pr2.stdout[-600:])
    hs.shutdown()
finally:
    try: srv.cleanup()
    except Exception: pass
for n, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n + ("" if okk else "\n      " + note))
bad = sum(1 for r in res if not r[1]); print(f"{len(res) - bad}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
