#!/usr/bin/env python3
# Rehearsal of 908 (resume_cc_908.py, Resume care from a Care Coordinator): a FAKE management API whose database queries run
# in a throwaway LOCAL Postgres (pgserver) holding today's client_status_decide, and a FAKE supabase CLI. Never touches
# GitHub, Supabase, GoHighLevel or AxisCare. Runs from a fresh copy of this folder's committed build.
#   python3 resume_cc_908_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, glob, datetime, shutil
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t908-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN)
COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
HEAD = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
BASE = subprocess.run(["git", "-C", COPY, "log", "-1", "--format=%H", HEAD, "--", "supabase/functions/client-journey/care.ts"], capture_output=True, text=True).stdout.strip()
BASE = subprocess.run(["git", "-C", COPY, "rev-parse", BASE + "~1"], capture_output=True, text=True).stdout.strip()   # the commit before care.ts changed
FNROOT = os.path.join(COPY, "supabase", "functions")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in ("client-journey/index.ts", "client-journey/care.ts")}
SQLSHA = sha(os.path.join(COPY, "client-status-returning-cc.sql"))
OLDBUILD = os.path.join(TMP, "oldfns"); subprocess.run(["git", "-C", COPY, "worktree", "add", "-q", "--detach", os.path.join(TMP, "old"), BASE], check=True)
shutil.copytree(os.path.join(TMP, "old", "supabase", "functions"), OLDBUILD)

D = os.path.join(TMP, "pg"); os.makedirs(D)
srvpg = pgserver.get_server(D)
host = [kv[5:] for kv in srvpg.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
def seed(which="client-status-returning.sql"):
    c = conn()
    c.run("drop schema if exists public cascade; create schema public")
    for r in ("anon", "authenticated", "service_role"):
        if not c.run("select 1 from pg_roles where rolname = :r", r=r): c.run(f"create role {r}")
    c.run("create table public.client_status_review(review_id uuid primary key, person_id uuid, status text, decision text, decided_on date, reason text, note text, decided_by text, decided_seat text, decided_at timestamptz, result jsonb, old_label text, new_label text, observed_at timestamptz, axiscare_client_id text)")
    if which == "other":
        c.run("create function public.client_status_decide(uuid, text, date, text, text, text, text) returns jsonb language plpgsql as $$ begin return '{}'::jsonb; end $$")
    elif which:
        s = open(os.path.join(COPY, which)).read()
        c.run(s[s.index("create or replace function"):s.index("do $verify$")])
    c.close()
def q1(sql_, **kw):
    c = conn(); r = c.run(sql_, **kw); c.close(); return r
src_ = lambda: q1("select prosrc from pg_proc where proname = 'client_status_decide'")[0][0]

M = {}; CALLS = []
def reset(**m):
    M.clear(); M.update(dict(fail_deploy=None, gate=True, live="old"), **m); CALLS.clear()
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
            d = [x for x in deployed() if x[0] == m.group(1)]
            return self._send(200, {"verify_jwt": (not d[-1][1]) if d else M["gate"], "version": 40 + len(d)})
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
    new = os.path.exists(deps) and open(deps).read().strip()
    src = {FNROOT!r} if (new or M['live'] == 'new') else {OLDBUILD!r}
    shutil.copytree(src, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True)
    if M['live'] == 'other' and not new: open(os.path.join(os.getcwd(), 'supabase', 'functions', 'client-journey', 'care.ts'), 'a').write('// someone else')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(BIN, "supabase"), 0o755)
def run(shas=SHAS, sqlsha=SQLSHA, main=HEAD, seedwith="client-status-returning.sql", reseed=True, **mode):
    if reseed: seed(seedwith)
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="908", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_MAIN_REF=main, SB_BASE=BASE, SB_SQL_SHA=sqlsha,
               SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas))
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "resume_cc_908.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
writes = lambda: [x for x in CALLS if x[0] == "POST" and x[1].endswith("/database/query") and re.search(r"create or replace", x[2]["query"], re.I)]

c, out = run()
ck("1 good run: the database rule changes, client-journey deployed (gateway kept), DONE, no ✗", c == 0 and "RESULT: DONE" in out and "✗" not in out and deployed() == [["client-journey", False]], out)
ck("2 the live rule is the new one: Returning client from either seat", "908: a returning client" in src_() and "Owner / Decision matter" not in src_())
priv = q1("select has_function_privilege('authenticated','public.client_status_decide(uuid,text,date,text,text,text,text)','execute'), has_function_privilege('anon','public.client_status_decide(uuid,text,date,text,text,text,text)','execute')")[0]
ck("3 privileges kept: browsers can't call the rule directly", list(priv) == [False, False], priv)
ck("4 nothing is sent (only the database and the function setup)", all(x[1].endswith("/database/query") or "/functions/" in x[1] for x in CALLS))
c2, out2 = run(reseed=False, live="new")
ck("5 running it again is harmless: the rule is already changed, client-journey redeployed the same build", c2 == 0 and "already lets a Care Coordinator" in out2 and not writes() and "RESULT: DONE" in out2, out2)
c, out = run(shas={"client-journey/care.ts": "0" * 64})
ck("6 a build that isn't the reviewed one stops before anything changes", c != 0 and not deployed() and not writes() and "Owner / Decision matter" in src_(), out)
c, out = run(sqlsha="0" * 64)
ck("7 a database file that isn't the reviewed one stops before anything changes", c != 0 and not deployed() and not writes(), out)
c, out = run(main=BASE)
ck("8 not merged yet: stops before anything changes", c != 0 and "isn't the same as GitHub's main" in out and not deployed() and not writes(), out)
c, out = run(live="other")
ck("9 the live client-journey has someone else's unreleased code: stops before anything changes", c != 0 and "someone else's unreleased change" in out and not deployed() and not writes(), out)
c, out = run(seedwith="other")
ck("10 the live database rule isn't the expected version: stops before anything changes", c != 0 and "isn't the version this was built on" in out and not deployed() and not writes(), out)
c, out = run(fail_deploy="client-journey")
ck("11 the deploy fails: stops and says the rule changed but nobody sees a difference; running again finishes", c != 0 and "STOPPED at client-journey" in out and "Running this step again finishes it" in out, out)
c, out = run(reseed=False, live="old")
ck("12 ...and the rerun finishes it", c == 0 and "already lets a Care Coordinator" in out and deployed() == [["client-journey", False]], out)
seed(); q1("create table public.boom(x int)"); q1("create function public.boom_t() returns event_trigger language plpgsql as $$ begin raise exception 'refused'; end $$")
q1("create event trigger no_ddl on ddl_command_start execute function public.boom_t()")
c, out = run(reseed=False)
ck("13 a database error: nothing changed in the database, no deploy, said out loud", c != 0 and "nothing in the database changed" in out and not deployed() and "Owner / Decision matter" in src_(), out)
q1("drop event trigger no_ddl")
src = open(os.path.join(HERE, "resume_cc_908.py")).read()
ck("14 no em dash in what the step says", not re.search(r"—", "\n".join(l for l in src.split("\n") if "say(" in l or "bad(" in l or "stop(" in l)))
for n, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n + ("\n      " + note if note else ""))
print(f"{sum(1 for r in res if r[1])}/{len(res)} passed"); raise SystemExit(0 if all(r[1] for r in res) else 1)
