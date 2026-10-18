#!/usr/bin/env python3
# Rehearsal of 910 (soc_stage_a_910.py, Start of Care stage A): a FAKE management API whose database queries run in a
# throwaway LOCAL Postgres (pgserver) holding today's client_journey payer rule and step catalog, and a FAKE supabase CLI.
# Never touches GitHub, Supabase, GoHighLevel or AxisCare. Runs from a fresh copy of this folder's committed build.
#   python3 soc_stage_a_910_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, glob, datetime, shutil
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t910-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN)
COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
HEAD = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
BASE = subprocess.run(["git", "-C", COPY, "log", "-1", "--format=%H", HEAD, "--", "supabase/functions/_shared/journey-rules.js"], capture_output=True, text=True).stdout.strip()
BASE = subprocess.run(["git", "-C", COPY, "rev-parse", BASE + "~1"], capture_output=True, text=True).stdout.strip()   # the commit before stage A
FNROOT = os.path.join(COPY, "supabase", "functions")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
CHANGED = ("client-journey/index.ts", "_shared/journey-rules.js", "client-agreement/index.ts", "_shared/family-change-text.ts")
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in CHANGED}
SQLSHA = sha(os.path.join(COPY, "soc_stage_a_910.sql"))
FNS = ["client-journey", "client-agreement", "coverage-run", "late-alert", "late-watch",
       "caregiver-journey", "caregiver-export", "offer-sign", "reference-send", "step2-handoff", "welcome-call"]
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
    c.run("create table public.client_journey(journey_id serial primary key, subject text not null default 'client', client_name text, status text not null default 'open', created_at timestamptz not null default now(), payer text check (payer in ('private', 'medicaid', 'va', 'ltc', 'other')))")
    c.run("create table public.client_journey_step_def(key text primary key, catalog_version int not null default 1, def jsonb not null, active boolean not null default true, updated_at timestamptz not null default now(), updated_by text not null default 'seed')")
    for d in CAT:
        dd = dict(d)
        if variant == "other" and d["key"] == "intake.payer": dd["answer"]["fields"][0]["options"] = dd["answer"]["fields"][0]["options"][:2]
        c.run("insert into public.client_journey_step_def(key, def) values (:k, cast(:d as jsonb))", k=d["key"], d=json.dumps(dd))
    c.run("insert into public.client_journey(client_name, payer, created_at) values ('Old IHS client', 'medicaid', '2026-10-01T15:00:00Z'), ('Pat Pay', 'private', '2026-10-10T15:00:00Z')")
    c.close()
def q1(sql_, **kw):
    c = conn(); r = c.run(sql_, **kw); c.close(); return r
def opts(): return [x["v"] for x in json.loads(q1("select (def->'answer'->'fields'->0->'options')::text from public.client_journey_step_def where key = 'intake.payer'")[0][0])]
marked = lambda: q1("select count(*) from public.client_journey_step_def where def->>'opened_before' = '2026-10-17'")[0][0]
guide_ok = lambda: "'guide'" in q1("select pg_get_constraintdef(oid) from pg_constraint where conname = 'client_journey_payer_check'")[0][0]

M = {}; CALLS = []
def reset(**m):
    M.clear(); M.update(dict(fail_deploy=None, gate=True, gates={}, live="old"), **m); CALLS.clear()
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
    if M['live'] == 'other' and not done and fn == 'coverage-run': open(os.path.join(os.getcwd(), 'supabase', 'functions', 'coverage-run', 'index.ts'), 'a').write('// someone else')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(BIN, "supabase"), 0o755)
def run(shas=SHAS, sqlsha=SQLSHA, main=HEAD, variant="old", reseed=True, **mode):
    if reseed: seed(variant)
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="910", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_MAIN_REF=main, SB_BASE=BASE, SB_SQL_SHA=sqlsha,
               SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas))
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "soc_stage_a_910.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=1200)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
writes = lambda: [x for x in CALLS if x[0] == "POST" and x[1].endswith("/database/query") and re.search(r"alter table|update public", x[2]["query"], re.I)]
OLD_OPTS = ["private", "medicaid", "va", "ltc", "other"]

c, out = run(gates={"coverage-run": False})
ck("1 good run: the database changes, all 11 functions deployed in order with their gateway setting kept, DONE, no ✗",
   c == 0 and "RESULT: DONE" in out and "✗" not in out and [d[0] for d in deployed()] == FNS and dict(deployed())["coverage-run"] is True and dict(deployed())["client-journey"] is False, out)
ck("2 the database: GUIDE allowed, the payer question offers GUIDE and not Medicaid, the 6 Medicaid steps marked, nothing else touched",
   guide_ok() and opts() == ["private", "va", "ltc", "guide", "other"] and marked() == 6
   and q1("select count(*) from public.client_journey_step_def where def ? 'opened_before' and key not in ('" + "', '".join(MED) + "')")[0][0] == 0, (opts(), marked()))
q1("insert into public.client_journey(client_name, payer) values ('Gina Guide', 'guide')")
ck("3 a GUIDE journey can be saved now, and the old IHS journey is still there, untouched", q1("select count(*) from public.client_journey where payer = 'guide'")[0][0] == 1
   and q1("select count(*) from public.client_journey where client_name = 'Old IHS client' and payer = 'medicaid'")[0][0] == 1)
ck("4 nothing is sent (only the database and the function setup)", all(x[1].endswith("/database/query") or "/functions/" in x[1] for x in CALLS))
c2, out2 = run(reseed=False, live="new")
ck("5 running it again is harmless: the database is already done, the same build redeployed", c2 == 0 and "already has stage A" in out2 and not writes() and "RESULT: DONE" in out2, out2)
c, out = run(shas={"_shared/journey-rules.js": "0" * 64})
ck("6 a build that isn't the reviewed one stops before anything changes", c != 0 and not deployed() and not writes() and opts() == OLD_OPTS, out)
c, out = run(sqlsha="0" * 64)
ck("7 a database file that isn't the reviewed one stops before anything changes", c != 0 and not deployed() and not writes(), out)
c, out = run(main=BASE)
ck("8 not merged yet: stops before anything changes", c != 0 and "isn't the same as GitHub's main" in out and not deployed() and not writes(), out)
c, out = run(live="other")
ck("9 a live function has someone else's unreleased code: stops before anything changes, naming it", c != 0 and "coverage-run has code that isn't on GitHub's main" in out and not deployed() and not writes(), out)
c, out = run(variant="other")
ck("10 the database isn't the version this was built on: stops before anything changes", c != 0 and "isn't the version this was built on" in out and not deployed() and not writes(), out)
seed(); q1("insert into public.client_journey(client_name, payer, created_at) values ('New Medicaid', 'medicaid', '2026-10-17T16:00:00Z')")
c, out = run(reseed=False)
ck("11 an open Medicaid journey opened on Oct 17 or later: stops (it would lose its steps), nothing changed", c != 0 and "would lose their Medicaid steps" in out and not deployed() and not writes() and marked() == 0, out)
c, out = run(fail_deploy="coverage-run")
ck("12 a deploy fails midway: stops, says the database part is done and which functions are left", c != 0 and "STOPPED at coverage-run" in out and "still to deploy: coverage-run, late-alert" in out and guide_ok(), out)
c, out = run(reseed=False, live="old")
ck("13 ...and running again finishes it", c == 0 and "already has stage A" in out and [d[0] for d in deployed()] == FNS, out)
seed(); q1("create function public.boom_t() returns event_trigger language plpgsql as $$ begin raise exception 'refused'; end $$")
q1("create event trigger no_ddl on ddl_command_start execute function public.boom_t()")
c, out = run(reseed=False)
ck("14 a database error: nothing changed in the database, no deploy, said out loud", c != 0 and "nothing in the database changed" in out and not deployed() and opts() == OLD_OPTS and not guide_ok(), out)
q1("drop event trigger no_ddl")
seed(); c = conn(); s_ = open(os.path.join(COPY, "soc_stage_a_910.sql")).read(); c.run(s_); c.run(open(os.path.join(COPY, "soc_stage_a_910_rollback.sql")).read()); c.close()
ck("15 the undo file puts the database back exactly", opts() == OLD_OPTS and marked() == 0 and not guide_ok())
src = open(os.path.join(HERE, "soc_stage_a_910.py")).read()
ck("16 no em dash in what the step says", not re.search(r"—", "\n".join(l for l in src.split("\n") if "say(" in l or "bad(" in l or "stop(" in l)))
for n, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n + ("\n      " + note if note else ""))
print(f"{sum(1 for r in res if r[1])}/{len(res)} passed"); raise SystemExit(0 if all(r[1] for r in res) else 1)
