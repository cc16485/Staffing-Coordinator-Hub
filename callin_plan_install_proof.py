#!/usr/bin/env python3
# Desktop 258 against fake Supabase services whose database is a real disposable Postgres. Never touches production.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
MIGF = os.path.join(H, "client-callin-plan.sql"); MIG_SHA = hashlib.sha256(open(MIGF, "rb").read()).hexdigest()
FNROOT = os.path.join(H, "supabase", "functions")
def sha(p): return hashlib.sha256(open(os.path.join(FNROOT, p), "rb").read()).hexdigest()
SHAS = {"callin-plan": sha("callin-plan/index.ts"), "coverage-run": sha("coverage-run/index.ts"), "_shared/callin-plan.ts": sha("_shared/callin-plan.ts")}
c = Cluster("cpi"); s = c.su
for r in ["anon", "authenticated"]: s.run(f"do $$ begin create role {r} nologin; exception when duplicate_object then null; end $$;")
s.run("do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;")
s.run("grant usage on schema public to anon, authenticated, service_role")
S = {"page": "<html> cipProfileLoad </html>", "cors": True}
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, bool, str, dict, list, type(None))) else str(v))
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj, raw=False, headers=None):
        b = (obj if raw else json.dumps(obj)).encode(); self.send_response(code)
        for k, v in (headers or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self):
        if self.path.startswith("/functions/v1/callin-plan") and S["cors"]: return self.send(200, "ok", True, {"Access-Control-Allow-Origin": "*"})
        self.send(404, {})
    def do_GET(self):
        if self.path.startswith("/?v="): return self.send(200, S["page"], True)
        self.send(404, {})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if self.path.endswith("/database/query"):
            q = body["query"]
            if q.lstrip().startswith("-- ===="):
                rc, out = c.psql(q); return self.send(200, []) if rc == 0 else self.send(400, {"message": out[-400:]})
            cc = c.conn()
            try:
                rows = cc.run(q); cols = [d["name"] for d in (cc.columns or [])]
                return self.send(200, [{k: J(v) for k, v in zip(cols, r)} for r in (rows or [])])
            except Exception as e: return self.send(400, {"message": str(e)[:300]})
            finally: cc.close()
        if self.path.startswith("/functions/v1/callin-plan"): return self.send(401, {"error": "sign in"})
        self.send(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-900:]))
def run(shas=SHAS, mig_sha=MIG_SHA):
    rep = os.path.join(H, "_cpi.txt")
    p = subprocess.run(["python3", "callin_plan_install.py"], cwd=H, capture_output=True, text=True, env=dict(os.environ, SB_MIGFILE=MIGF, SB_MIG_SHA=mig_sha,
        SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas), SB_REPORT=rep, SB_TOKEN="sbp_x", SB_REF="r", SB_SKIP_FUNCTION="1", SB_API_BASE=base, SB_FN_BASE=base, SB_HUB_URL=base))
    t = open(rep).read() if os.path.exists(rep) else ""
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
exists = lambda: s.run("select to_regclass('public.client_callin_entries')")[0][0] is not None
rc, t = run(mig_sha="0" * 64)
ck("a changed migration stops before anything runs", rc == 2 and not exists(), t[-200:])
rc, t = run(dict(SHAS, **{"coverage-run": "0" * 64}))
ck("a changed function stops before anything runs", rc == 2 and not exists(), t[-200:])
S["page"] = "<html>old hub</html>"; rc, t = run()
ck("a live hub without the new screen stops it (merge first); nothing applied", rc == 3 and "does not have the call-in plan screen" in t and not exists(), t[-300:])
S["page"] = "<html> cipProfileLoad </html>"; rc, t = run()
ck("installs: migration committed with an empty table, the screen reaches its service, unsigned requests refused",
   rc == 0 and exists() and "(0 entries)" in t and "✓ the Client 360 section can reach its service" in t and "✓ the service refuses anyone not signed in" in t and "RESULT: INSTALLED" in t, t)
rc, t = run()
ck("a rerun before anyone has entered a plan is harmless", rc == 0 and "RESULT: INSTALLED" in t, t[-300:])
s.run("insert into client_callin_entries(request_id,axiscare_client_id,client_name,source_who,entered_by,note) values (gen_random_uuid(),'501','LeeAnn Walker','LeeAnn','k@x','n')")
rc, t = run()
ck("once staff have entered plans, a rerun refuses and changes nothing", rc == 4 and "refused" in t and s.run("select count(*) from client_callin_entries")[0][0] == 1, t[-300:])
S["cors"] = False; s.run("drop table client_callin_entries cascade"); s.run("drop function client_callin_add(jsonb,text,text)"); rc, t = run()
ck("a CORS failure is reported, not hidden", rc == 9 and "✗ CORS preflight" in t, t[-300:])
srv.shutdown(); c.close()
print("\nDESKTOP 258 · CALL-IN PLAN INSTALL · PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED"); print("migration:", MIG_SHA); print("shas:", json.dumps(SHAS))
