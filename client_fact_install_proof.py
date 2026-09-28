#!/usr/bin/env python3
# Gate 2a · proof of the INSTALLER on a disposable Postgres built from the real Journey foundation. Never touches production.
import os, sys, json, hashlib, subprocess, shutil, glob, tempfile
import pgserver
from pg8000.native import Connection

H = os.path.dirname(os.path.abspath(__file__))
SQL = os.path.join(H, "client-fact.sql"); SHA = hashlib.sha256(open(SQL, "rb").read()).hexdigest()
JOURNEY = open(os.path.join(H, "journey-foundation-v2.sql")).read()
MIRROR = open(os.path.join(H, "lead-journey-mirror.sql")).read()
res = []
def ck(n, c, note=""): res.append((n, bool(c), "" if c else str(note)[:500]))

def cluster(break_evidence=False):
    d = tempfile.mkdtemp(prefix="cfinst_"); srv = pgserver.get_server(d)
    host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
    sock = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
    s = Connection(user="postgres", database="postgres", unix_sock=sock)
    for r in ["anon", "authenticated"]: s.run(f"do $$ begin create role {r} nologin; exception when duplicate_object then null; end $$;")
    s.run("do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;")
    s.run("grant usage on schema public to anon, authenticated, service_role")
    for k in ["tables", "sequences", "functions"]: s.run(f"alter default privileges in schema public grant all on {k} to anon, authenticated, service_role")
    s.run("create table person_identity (id uuid primary key default gen_random_uuid(), display_name text)")
    s.run("create table person_source_id (id bigserial primary key, person_id uuid references person_identity(id), system text, entity_type text, source_id text, confidence text default 'confirmed')")
    s.run("create table client_queue (id uuid primary key default gen_random_uuid(), axiscare_client_id text, episode_n int, status text, added_at timestamptz, first_shift_done boolean default false, first_shift_done_at timestamptz)")
    s.run("create table launch_evidence (id uuid primary key default gen_random_uuid(), launch_id " + ("text" if break_evidence else "uuid") + ", fact text, source text, evidence jsonb, reason text, recorded_by text)")
    s.run("""create table app_data (key text primary key, data jsonb)"""); s.run("""insert into app_data values ('leads','[{"id":"L1","created_at":"2026-09-01T10:00:00Z"}]')""")
    s.run("create table app_data_key_hub_map (data_key text, hub_slug text)"); s.run("insert into app_data_key_hub_map values ('leads','care_coordinator')")
    s.run("create function jwt_hub_access() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb -> 'app_metadata' -> 'hub_access' $$")
    s.run("create function can_access_data_key(k text) returns boolean language sql stable security definer as $$ select public.jwt_hub_access() is null or exists (select 1 from public.app_data_key_hub_map m where m.data_key = k and public.jwt_hub_access() ? m.hub_slug) $$")
    f = os.path.join(d, "j.sql"); open(f, "w").write(JOURNEY)
    psql = os.path.join(os.path.dirname(pgserver.__file__), "pginstall", "bin", "psql")
    port = sock.rsplit(".", 1)[1]
    p = subprocess.run([psql, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", host, "-p", port, "-U", "postgres", "-d", "postgres", "-f", f], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr[-400:]
    i = MIRROR.index("create function public.lead_inquiry_date"); j = MIRROR.index("end $$;", i) + len("end $$;"); s.run(MIRROR[i:j])
    s.run("set role service_role")
    s.run("select public.episode_open_provisional(p_origin_system => 'lead', p_origin_ref => 'L1')")
    s.run("reset role")
    return d, srv, sock, s

def run(sock, sha=SHA):
    rep = tempfile.mktemp(suffix=".txt")
    p = subprocess.run([sys.executable, os.path.join(H, "client_fact_install.py")], capture_output=True, text=True,
                       env=dict(os.environ, SB_MIGFILE=SQL, SB_EXPECTED_SHA=sha, SB_REPORT=rep, SB_LOCAL_SOCK=sock, SB_SKIP_FUNCTION="1"))
    return p.returncode, open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr

d, srv, sock, s = cluster()
cnt = lambda: s.run("select (select count(*) from journey_episode), (select count(*) from episode_fact)")[0]
c0 = cnt()
rc, out = run(sock, sha="0" * 64)
ck("a file that isn't the proven build: stops before touching anything", rc == 2 and s.run("select to_regclass('public.client_fact')")[0][0] is None, out)
rc, out = run(sock)
ck("the real run: installs, and every line of the report is a ✓", rc == 0 and "✗" not in out and "RESULT: INSTALLED" in out, out)
ck("…the care-began rule ran for every Journey with none it couldn't check", "0 could not be checked" in out, out)
ck("…the door's live proof recorded, replaced, and refused a stale save and an unknown kind", "refused a stale save and an unknown kind" in out, out)
ck("…and all of it was undone: no kinds, facts or door log lines; the Journey untouched",
   s.run("select (select count(*) from fact_kind)+(select count(*) from client_fact)+(select count(*) from client_fact_door_audit)")[0][0] == 0 and cnt() == c0)
rc, out = run(sock)
ck("running it again: sees it's already installed and stops", rc == 4 and "✗ not installed yet" in out, out)
s.close(); srv.cleanup(); shutil.rmtree(d, ignore_errors=True)

d, srv, sock, s = cluster(break_evidence=True)
rc, out = run(sock)
ck("if the checklist's evidence doesn't have the shape the rule reads: stops, nothing installed",
   rc == 4 and "✗ its evidence table matches" in out and s.run("select to_regclass('public.client_fact')")[0][0] is None, out)
s.close(); srv.cleanup(); shutil.rmtree(d, ignore_errors=True)

for n, ok, note in res: print(("PASS" if ok else "FAIL") + " · " + n + ("" if ok else "  ::  " + note))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
print("client-fact.sql sha256", SHA)
print("client-fact/index.ts sha256", hashlib.sha256(open(os.path.join(H, "supabase/functions/client-fact/index.ts"), "rb").read()).hexdigest())
