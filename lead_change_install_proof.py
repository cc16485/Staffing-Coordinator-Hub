#!/usr/bin/env python3
# Gate 2b · proof of the INSTALLER on a disposable Postgres. Never touches production.
import os, sys, json, hashlib, subprocess, shutil, glob, tempfile
import pgserver
from pg8000.native import Connection

H = os.path.dirname(os.path.abspath(__file__))
SQL = os.path.join(H, "lead-change.sql")
SHA = hashlib.sha256(open(SQL, "rb").read()).hexdigest()
res = []
def ck(n, c, note=""): res.append((n, bool(c), "" if c else str(note)[:400]))

def cluster(upsert_style="update"):
    d = tempfile.mkdtemp(prefix="lcinst_"); srv = pgserver.get_server(d)
    host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
    sock = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
    s = Connection(user="postgres", database="postgres", unix_sock=sock)
    for r in ["anon", "authenticated"]: s.run(f"do $$ begin create role {r} nologin; exception when duplicate_object then null; end $$;")
    s.run("do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;")
    s.run("grant usage on schema public to anon, authenticated, service_role")
    s.run("alter default privileges in schema public grant all on tables to anon, authenticated, service_role")
    s.run("create table app_data (key text primary key, data jsonb)")
    s.run("create table app_data_key_hub_map (data_key text, hub_slug text)")
    s.run("insert into app_data_key_hub_map values ('leads','care_coordinator')")
    s.run("create function jwt_hub_access() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb -> 'app_metadata' -> 'hub_access' $$")
    s.run("create function can_access_data_key(k text) returns boolean language sql stable security definer as $$ select public.jwt_hub_access() is null or exists (select 1 from public.app_data_key_hub_map m where m.data_key = k and public.jwt_hub_access() ? m.hub_slug) $$")
    if upsert_style == "update":
        s.run("""create function upsert_app_data_item(target_key text, item jsonb) returns void language plpgsql security definer as $$
          begin update public.app_data set data = data || jsonb_build_array(item) where key = target_key; end $$""")
    else:
        s.run("""create function upsert_app_data_item(target_key text, item jsonb) returns void language plpgsql security definer as $$
          declare d jsonb; begin select data into d from public.app_data where key = target_key; delete from public.app_data where key = target_key;
          insert into public.app_data values (target_key, d || jsonb_build_array(item)); end $$""")
    s.run("""create function delete_app_data_item(target_key text, item_id text) returns void language plpgsql security definer as $$
      begin update public.app_data set data = (select coalesce(jsonb_agg(e), '[]') from jsonb_array_elements(data) e where e->>'id' <> item_id) where key = target_key; end $$""")
    s.run("""insert into app_data values ('leads', '[{"id":"L1","first_name":"Mark","client_city":"Nixa"},{"id":"L2","first_name":"Tonya"}]')""")
    return d, srv, sock, s

def run(sock, sha=SHA):
    rep = tempfile.mktemp(suffix=".txt")
    p = subprocess.run([sys.executable, os.path.join(H, "lead_change_install.py")], capture_output=True, text=True,
                       env=dict(os.environ, SB_MIGFILE=SQL, SB_EXPECTED_SHA=sha, SB_REPORT=rep, SB_LOCAL_SOCK=sock))
    return p.returncode, open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr

d, srv, sock, s = cluster()
fp = lambda: s.run("select md5(data::text) from app_data where key='leads'")[0][0]
f0 = fp()
rc, out = run(sock, sha="0" * 64)
ck("a file that isn't the proven build: stops before touching anything", rc == 2 and s.run("select to_regclass('public.lead_change')")[0][0] is None, out)
rc, out = run(sock)
ck("the real run: installs, and every line of the report is a ✓", rc == 0 and "✗" not in out and "RESULT: INSTALLED" in out, out)
ck("…its live proof saw the made-up lead added and changed", "1 'added' line and 1 change" in out, out)
ck("…and rolled all of it back: the leads are byte-for-byte as before, no history line kept", fp() == f0 and s.run("select count(*) from lead_change")[0][0] == 0)
s.run("set role authenticated"); s.run("select set_config('request.jwt.claims', :c, false)", c=json.dumps({"role":"authenticated","email":"kat@cc.test","app_metadata":{"hub_access":["care_coordinator"]}}))
s.run("""select public.upsert_app_data_item('leads', '{"id":"L3","first_name":"New"}')"""); s.run("reset role")
ck("after install a real save is recorded", s.run("select count(*) from lead_change where lead_id='L3' and kind='added'")[0][0] == 1)
rc, out = run(sock)
ck("running it again: sees it's already installed and stops", rc == 4 and "✗ not installed yet" in out, out)
s.close(); srv.cleanup(); shutil.rmtree(d, ignore_errors=True)

d, srv, sock, s = cluster("delete_insert")
rc, out = run(sock)
ck("a save path that deletes and re-inserts the row (the watcher couldn't see it): stops, nothing installed",
   rc == 4 and "✗ the Hub's save changes the leads row in place" in out and s.run("select to_regclass('public.lead_change')")[0][0] is None, out)
s.close(); srv.cleanup(); shutil.rmtree(d, ignore_errors=True)

for n, ok, note in res: print(("PASS" if ok else "FAIL") + " · " + n + ("" if ok else "  ::  " + note))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
print("lead-change.sql sha256", SHA)
