#!/usr/bin/env python3
# Rehearsal of 1185 (careplan_stage1_1185.py): a FAKE management API whose database queries run in a throwaway LOCAL Postgres
# (pgserver) holding the nine-step catalog's step 4, and a FAKE supabase CLI whose live copies start as main's build.
# Never touches Supabase, AxisCare or the drafting service.   python3 careplan_stage1_1185_install_test.py
import json, os, subprocess, tempfile, threading, http.server, hashlib, glob, datetime
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1200]))
TMP = tempfile.mkdtemp(prefix="t1185-"); D = os.path.join(TMP, "pg"); os.makedirs(D)
srvpg = pgserver.get_server(D)
host = [kv[5:] for kv in srvpg.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
NINE = json.load(open(os.path.join(HERE, "client-journey", "catalog-nine.json")))
STEPS = NINE["steps"] if isinstance(NINE, dict) and "steps" in NINE else NINE
def seed(with_check=False, no_step=False):
    c = conn(); c.run("drop schema if exists public cascade; create schema public")
    c.run("create table public.client_journey_step_def(key text primary key, catalog_version int not null default 1, def jsonb not null, active boolean not null default true, updated_at timestamptz not null default now(), updated_by text)")
    for d in STEPS:
        d = json.loads(json.dumps(d))
        if d.get("key") == "soc.setup":
            if no_step: continue
            if not with_check: d["checks"] = [x for x in d["checks"] if x.get("key") != "plan_approved"]
        c.run("insert into public.client_journey_step_def(key, def) values (:k, cast(:d as jsonb))", k=d["key"], d=json.dumps(d))
    c.close()
def keys():
    c = conn(); r = c.run("select string_agg(c->>'key', ',' order by i) from public.client_journey_step_def d, jsonb_array_elements(d.def->'checks') with ordinality t(c, i) where d.key = 'soc.setup'"); c.close(); return r[0][0] or ""
M = {}
def jsonable(v): return v.isoformat() if isinstance(v, (datetime.date, datetime.datetime)) else v
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJfake.anon.key"}])
        if p.endswith("/secrets"): return self._send(200, [{"name": n} for n in (["ANTHROPIC_API_KEY", "AXISCARE_TOKEN"] if M.get("secrets", True) else ["OTHER"])])
        for fn in ("ai-draft-careplan", "client-journey"):
            if p.endswith("/functions/" + fn): return self._send(200, {"version": 7, "verify_jwt": fn == "ai-draft-careplan"})
        return self._send(404, {})
    def do_PATCH(self): return self._send(200, {})
    def do_OPTIONS(self): self.send_response(200); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"
        if self.path.startswith("/fn/"): return self._send(M.get("public", 401), {"error": "Not signed in"})
        q = json.loads(raw)["query"]
        if M.get("fail_sql") and "update public.client_journey_step_def" in q: return self._send(400, {"message": "permission denied"})
        try:
            c = conn(); rows = c.run(q); cols = [x["name"] for x in (c.columns or [])]; c.close()
            return self._send(201, [{k: jsonable(v) for k, v in zip(cols, r)} for r in (rows or [])])
        except DatabaseError as e: return self._send(400, {"message": str(e)[:300]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
LOG = os.path.join(TMP, "cli.log"); STATE = os.path.join(TMP, "deployed"); CLI = os.path.join(TMP, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
# fake tool: before a deploy, download gives main's build (BAD_LIVE=1: a hand edit nobody merged); after, the local build
cmd="$2"; fn="$3"; root="{HERE}"
if [ "$cmd" = "download" ]; then
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  if grep -qx "$fn" "{STATE}" 2>/dev/null; then
    cp -R "$root/supabase/functions/$fn/." "supabase/functions/$fn/"; cp "$root"/supabase/functions/_shared/*.ts "$root"/supabase/functions/_shared/*.js supabase/functions/_shared/ 2>/dev/null
    for d in $(cd "$root" && grep -ho "\.\./\.\./[a-z-]*/" "supabase/functions/$fn/index.ts" | sort -u); do mkdir -p "$d" && cp -R "$root/supabase/functions/$fn/$d." "$d" 2>/dev/null; done
  else
    git -C "$root" show "origin/main:supabase/functions/$fn/index.ts" > "supabase/functions/$fn/index.ts"
    if [ "$BAD_LIVE" = "1" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$fn $*" >> "{LOG}"; echo "$fn" >> "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
FNS = {k: sha(os.path.join(HERE, "supabase/functions", k)) for k in ("ai-draft-careplan/index.ts", "client-journey/index.ts", "_shared/careplan-draft.ts")}
SQLS = {"careplan_stage1_1185.sql": sha(os.path.join(HERE, "careplan_stage1_1185.sql"))}
def run(fns=None, sqls=None, env=None, **mode):
    M.clear(); M.update(mode); open(LOG, "w").close(); open(STATE, "w").close()
    rep = os.path.join(TMP, "r.txt"); os.path.exists(rep) and os.remove(rep)
    e = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_SUPA_CLI=CLI, SB_FNROOT=os.path.join(HERE, "supabase/functions"),
             SB_FN_SHAS=json.dumps(fns or FNS), SB_SQL_SHAS=json.dumps(sqls or SQLS), SB_FN_BASE=URL + "/fn", SB_SETTLE="0", PYTHONPATH=HERE, **(env or {}))
    p = subprocess.run(["python3", os.path.join(HERE, "careplan_stage1_1185.py")], env=e, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
deployed = lambda: open(LOG).read()

seed(); before = keys(); code, out = run()
ck("fresh: exit 0, DONE; both functions deployed, each keeping its sign-in setting", code == 0 and "RESULT: DONE" in out and "ai-draft-careplan functions deploy" in deployed() and "client-journey functions deploy" in deployed()
   and "--no-verify-jwt" in [l for l in deployed().splitlines() if l.startswith("client-journey")][0] and "--no-verify-jwt" not in [l for l in deployed().splitlines() if l.startswith("ai-draft-careplan")][0], out)
ck("step 4 gets 'Care plan approved in the Hub' right after 'Care tasks in AxisCare'; nothing else in it changes", keys() == before.replace("ax_tasks", "ax_tasks,plan_approved") and "ax_tasks,plan_approved" in out, [before, keys()])
ck("the proof: live copies are this build, the public key is refused, the Hub can reach it", all(s in out for s in ["ai-draft-careplan: the live copy is exactly this build", "client-journey: the live copy is exactly this build", "refuses anyone not signed in", "the Hub can reach it"]), out)
ck("prints no key or secret", "eyJfake" not in out and "sbp_test" not in out)
code, out = run()
ck("run again: says the check is already there, still exactly one, still DONE", code == 0 and "already there" in out and keys().count("plan_approved") == 1, out)
seed(); code, out = run(fns={**FNS, "client-journey/index.ts": "0" * 64})
ck("not the reviewed build: stops before changing anything", code == 2 and not deployed() and "plan_approved" not in keys(), out)
seed(); code, out = run(sqls={"careplan_stage1_1185.sql": "0" * 64})
ck("not the reviewed SQL: stops before changing anything", code == 3 and not deployed() and "plan_approved" not in keys(), out)
seed(no_step=True); code, out = run()
ck("no nine-step Start of Care in the catalog: stops before changing anything", code == 3 and "comes with 911" in out and not deployed(), out)
seed(); code, out = run(secrets=False)
ck("the drafting key is missing: stops before changing anything", code == 3 and "ANTHROPIC_API_KEY is not set" in out and not deployed(), out)
seed(); code, out = run(env={"BAD_LIVE": "1"})
ck("a live copy nobody merged: stops before changing anything and says so", code == 3 and "never on main" in out and not deployed() and "plan_approved" not in keys(), out)
seed(); code, out = run(fail_sql=True)
ck("the database refuses the change: says nothing changed, deploys nothing", code == 6 and "did not go in (nothing changed)" in out and not deployed(), out)
seed(); code, out = run(public=200)
ck("the draft answers the public key: a ✗ line, not DONE", code == 9 and "answered the public key" in out, out)
sqltxt = open(os.path.join(HERE, "careplan_stage1_1185.sql")).read().lower()
ck("the SQL only touches step 4's checks (no delete, drop, truncate, other tables)", not any(w in sqltxt for w in ["delete ", "drop ", "truncate", "insert into"]) and sqltxt.count("update public.") == 1)
srv.shutdown()
for n, c, note in res: print(("PASS" if c else "FAIL") + " · " + n + ("" if c else "\n     " + note))
print(sum(c for _, c, _ in res), "/", len(res)); raise SystemExit(0 if all(c for _, c, _ in res) else 1)
