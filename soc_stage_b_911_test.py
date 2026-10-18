#!/usr/bin/env python3
# Rehearsal of 911 (soc_stage_b_911.py, Start of Care stage B): a FAKE management API whose database queries run in a
# throwaway LOCAL Postgres (pgserver) holding today's client_journey table and step catalog, and a FAKE supabase CLI.
# Never touches GitHub, Supabase, GoHighLevel or AxisCare. Runs from a fresh copy of this folder's committed build.
#   python3 soc_stage_b_911_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, glob, datetime, shutil
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t911-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN)
COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
HEAD = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
BASE = subprocess.run(["git", "-C", COPY, "log", "--reverse", "--format=%H", "350a89789d61a14623342a91b22944d501d3dc56.." + HEAD, "--", "supabase/functions/_shared/journey-rules.js"], capture_output=True, text=True).stdout.split()[0]
BASE = subprocess.run(["git", "-C", COPY, "rev-parse", BASE + "~1"], capture_output=True, text=True).stdout.strip()   # the commit before stage B
FNROOT = os.path.join(COPY, "supabase", "functions")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
CHANGED = ("client-journey/index.ts", "_shared/journey-rules.js")
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in CHANGED}
SQLSHA = sha(os.path.join(COPY, "soc_stage_b_911.sql"))
FNS = ["client-journey", "caregiver-journey", "caregiver-export", "offer-sign", "reference-send", "step2-handoff", "welcome-call"]
OLDBUILD = os.path.join(TMP, "oldfns"); subprocess.run(["git", "-C", COPY, "worktree", "add", "-q", "--detach", os.path.join(TMP, "old"), BASE], check=True)
shutil.copytree(os.path.join(TMP, "old", "supabase", "functions"), OLDBUILD)
CAT = json.load(open(os.path.join(COPY, "client-journey", "catalog-v1.json")))["steps"]
MED = ("med.emomed", "med.fusion", "med.notices", "med.careplan", "med.decision", "ready.state")

D = os.path.join(TMP, "pg"); os.makedirs(D)
srvpg = pgserver.get_server(D)
host = [kv[5:] for kv in srvpg.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
def seed(variant="old"):
    c = conn()
    c.run("drop schema if exists public cascade; create schema public")
    c.run("create table public.client_journey(journey_id serial primary key, subject text not null default 'client', client_name text, status text not null default 'open', created_at timestamptz not null default now(), payer text)")
    c.run("create table public.client_journey_step_def(key text primary key, catalog_version int not null default 1, def jsonb not null, active boolean not null default true, updated_at timestamptz not null default now(), updated_by text not null default 'seed')")
    for d in CAT: c.run("insert into public.client_journey_step_def(key, def) values (:k, cast(:d as jsonb))", k=d["key"], d=json.dumps(d))
    if variant == "other": c.run("insert into public.client_journey_step_def(key, def) values ('soc.lead', '{\"catalog\":\"nine\",\"title\":\"x\",\"stage\":\"lead\"}')")
    c.run("insert into public.client_journey(client_name, payer) values ('Edward Anderson', null), ('Pat Pay', 'private')")
    c.close()
def q1(sql_, **kw):
    c = conn(); r = c.run(sql_, **kw); c.close(); return r
has_col = lambda: q1("select count(*) from information_schema.columns where table_name = 'client_journey' and column_name = 'catalog'")[0][0] == 1
nine_n = lambda: q1("select count(*) from public.client_journey_step_def where def->>'catalog' = 'nine'")[0][0]
v1_n = lambda: q1("select count(*) from public.client_journey_step_def where coalesce(def->>'catalog', 'v1') = 'v1'")[0][0]

M = {}; CALLS = []
def reset(**m):
    M.clear(); M.update(dict(fail_deploy=None, gate=True, gates={}, live="old", drop=['_shared/duty.ts']), **m); CALLS.clear()
    p = os.path.join(TMP, "deploys")
    if os.path.exists(p): os.remove(p)
    open(os.path.join(TMP, "mode.json"), "w").write(json.dumps(M))
def deployed():
    p = os.path.join(TMP, "deploys")
    return [json.loads(l) for l in open(p).read().splitlines()] if os.path.exists(p) else []
def jsonable(v): return v.isoformat() if isinstance(v, (datetime.date, datetime.datetime)) else (str(v) if v.__class__.__name__ == "UUID" else v)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj, default=str).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        CALLS.append(("GET", self.path))
        m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", self.path)
        if m:
            fn = m.group(1); d = [x for x in deployed() if x[0] == fn]
            return self._send(200, {"verify_jwt": (not d[-1][1]) if d else M["gates"].get(fn, M["gate"]), "version": 40 + len(d)})
        self._send(404, {})
    def do_PATCH(self): CALLS.append(("PATCH", self.path)); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"null"); CALLS.append(("POST", self.path, b))
        if self.path.endswith("/database/query"):
            c = conn()
            try:
                rows = c.run(b["query"]); cols = [d_["name"] for d_ in (c.columns or [])]
                return self._send(201, [dict(zip(cols, [jsonable(v) for v in r])) for r in (rows or [])])
            except DatabaseError as e:
                try: c.run("rollback")
                except Exception: pass
                return self._send(400, {"message": str(e)[:600]})
            finally: c.close()
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
open(os.path.join(BIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, json, os, shutil
a = sys.argv[1:]; M = json.load(open({os.path.join(TMP, 'mode.json')!r}))
if os.environ.get('SUPABASE_ACCESS_TOKEN') != 'sbp_test': sys.exit(1)
deps = {os.path.join(TMP, 'deploys')!r}
if a[:2] == ['functions', 'deploy']:
    if M.get('fail_deploy') == a[2]: print('deploy failed: boom', file=sys.stderr); sys.exit(1)
    open(deps, 'a').write(json.dumps([a[2], '--no-verify-jwt' in a]) + '\\n'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    fn = a[2]
    done = os.path.exists(deps) and any(json.loads(l)[0] == fn for l in open(deps).read().splitlines())
    src = {FNROOT!r} if (done or M['live'] == 'new') else {OLDBUILD!r}
    shutil.copytree(src, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True)
    if M['live'] == 'other' and not done and fn == 'caregiver-journey': open(os.path.join(os.getcwd(), 'supabase', 'functions', 'caregiver-journey', 'index.ts'), 'a').write('// someone else')
    # like the real download: the live copy of a function holds only the files ITS build imported (911 found client-journey had no duty.ts)
    if not done and M['live'] != 'new' and fn == 'client-journey':
        for rel in M.get('drop', ['_shared/duty.ts']):
            p_ = os.path.join(os.getcwd(), 'supabase', 'functions', rel)
            if os.path.exists(p_): os.remove(p_)
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(BIN, "supabase"), 0o755)
def run(shas=SHAS, sqlsha=SQLSHA, main=HEAD, variant="old", reseed=True, **mode):
    if reseed: seed(variant)
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="911", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_MAIN_REF=main, SB_BASE=BASE, SB_SQL_SHA=sqlsha,
               SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas))
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "soc_stage_b_911.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=1200)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
writes = lambda: [x for x in CALLS if x[0] == "POST" and x[1].endswith("/database/query") and re.search(r"alter table|update public", x[2]["query"], re.I)]
V1 = len(CAT)
c, out = run(gates={"offer-sign": False})
ck("1 good run: the database changes, all 7 functions deployed in order with their gateway setting kept, DONE (switched off), no ✗",
   c == 0 and "RESULT: DONE" in out and "switched OFF" in out and "✗" not in out and [d[0] for d in deployed()] == FNS and dict(deployed())["offer-sign"] is True and dict(deployed())["client-journey"] is False, out)
ck("2 the database: the catalog column is there and every journey is on the old steps; the nine steps are in; the old steps untouched",
   has_col() and q1("select count(*) from public.client_journey where catalog <> 'v1'")[0][0] == 0 and nine_n() == 9 and v1_n() == V1, (has_col(), nine_n(), v1_n()))
ck("3 nothing is sent (only the database and the function setup)", all(x[1].endswith("/database/query") or "/functions/" in x[1] for x in CALLS))
c2, out2 = run(reseed=False, live="new")
ck("4 running it again is harmless: the database is already done, the same build redeployed", c2 == 0 and "already has stage B" in out2 and not writes() and "RESULT: DONE" in out2, out2)
c, out = run(shas={"_shared/journey-rules.js": "0" * 64})
ck("5 a build that isn't the reviewed one stops before anything changes", c != 0 and not deployed() and not writes() and not has_col(), out)
c, out = run(sqlsha="0" * 64)
ck("6 a database file that isn't the reviewed one stops before anything changes", c != 0 and not deployed() and not writes(), out)
c, out = run(main=BASE)
ck("7 not merged yet: stops before anything changes", c != 0 and "isn't the same as GitHub's main" in out and not deployed() and not writes(), out)
c, out = run(live="other")
ck("8 a live function has someone else's unreleased code: stops before anything changes, naming it", c != 0 and "coverage-run" not in out and "has code that isn't on GitHub's main" in out and not deployed() and not writes(), out)
c, out = run(variant="other")
ck("9 the database isn't the version this was built on: stops before anything changes", c != 0 and "isn't the version this was built on" in out and not deployed() and not writes() and not has_col(), out)
c, out = run(fail_deploy="offer-sign")
ck("10 a deploy fails midway: stops, says the database part is done and which functions are left", c != 0 and "STOPPED at offer-sign" in out and "still to deploy: offer-sign, reference-send" in out and has_col(), out)
c, out = run(reseed=False, live="old")
ck("11 ...and running again finishes it", c == 0 and "already has stage B" in out and [d[0] for d in deployed()] == FNS, out)
seed(); q1("create function public.boom_t() returns event_trigger language plpgsql as $$ begin raise exception 'refused'; end $$")
q1("create event trigger no_ddl on ddl_command_start execute function public.boom_t()")
c, out = run(reseed=False)
ck("12 a database error: nothing changed in the database, no deploy, said out loud", c != 0 and "nothing in the database changed" in out and not deployed() and not has_col() and nine_n() == 0, out)
q1("drop event trigger no_ddl")
seed(); cc = conn(); cc.run(open(os.path.join(COPY, "soc_stage_b_911.sql")).read()); cc.run("update public.client_journey set catalog = 'nine' where client_name = 'Pat Pay'")
try:
    cc.run(open(os.path.join(COPY, "soc_stage_b_911_rollback.sql")).read()); refused = False
except DatabaseError:
    refused = True; cc.run("rollback")
cc.run("update public.client_journey set catalog = 'v1'"); cc.run(open(os.path.join(COPY, "soc_stage_b_911_rollback.sql")).read()); cc.close()
ck("13 the undo refuses while a journey is on the nine steps, then puts the database back exactly", refused and not has_col() and nine_n() == 0 and v1_n() == V1)
c, out = run(drop=["_shared/duty.ts", "client-journey/care.ts"])
ck("15 a file the built-on code DID have is missing from the live copy: still stops, naming it", c != 0 and "client-journey/care.ts" in out and not deployed() and not writes(), out)
c, out = run()
ck("16 the case 911 hit for real: client-journey newly imports duty.ts, which the live copy doesn't have yet: runs", c == 0 and "RESULT: DONE" in out, out)
src = open(os.path.join(HERE, "soc_stage_b_911.py")).read()
ck("14 no em dash in what the step says", not re.search(r"—", "\n".join(l for l in src.split("\n") if "say(" in l or "bad(" in l or "stop(" in l)))
for n, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n + ("\n      " + note if note else ""))
print(f"{sum(1 for r in res if r[1])}/{len(res)} passed"); raise SystemExit(0 if all(r[1] for r in res) else 1)
