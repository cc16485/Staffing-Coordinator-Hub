#!/usr/bin/env python3
# Desktop 263 against fake Supabase services whose database is a real disposable Postgres. Never touches production.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
MIGF = os.path.join(H, "client-status-returning.sql"); MIG_SHA = hashlib.sha256(open(MIGF, "rb").read()).hexdigest()
FNROOT = os.path.join(H, "supabase", "functions")
def sha(p): return hashlib.sha256(open(os.path.join(FNROOT, p), "rb").read()).hexdigest()
SHAS = {"client-lookup": sha("client-lookup/index.ts"), "_shared/client-lookup.ts": sha("_shared/client-lookup.ts")}
c = Cluster("kfi"); P = setup_supabase_like(c); s = c.su
s.run("""create table person_role (id bigserial primary key, person_id uuid not null references person_identity(id), role text not null,
         status text not null default 'active' check (status in ('active','former','prospective')), started_at date, ended_at date, end_reason text,
         updated_at timestamptz not null default now())""")
rc, out = c.psql(MIG); assert rc == 0, out[-400:]
rc, out = c.psql(open(os.path.join(H, "client-status.sql")).read()); assert rc == 0, out[-400:]
S = {"cors": True, "open": set()}
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, bool, str, dict, list, type(None))) else str(v))
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj, headers=None):
        b = json.dumps(obj).encode(); self.send_response(code)
        for k, v in (headers or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self):
        if self.path.startswith("/functions/v1/client-lookup") and S["cors"]: return self.send(200, "ok", {"Access-Control-Allow-Origin": "*"})
        self.send(404, {})
    def do_GET(self):
        if self.path.endswith("/api-keys"): return self.send(200, [{"name": "anon", "api_key": "ANON"}, {"name": "service_role", "api_key": "SVC"}])
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
        if self.path.startswith("/functions/v1/client-lookup"):
            who = "anon" if self.headers.get("apikey") == "ANON" else "none"
            return self.send(200, {"ok": True, "matches": []}) if who in S["open"] else self.send(401, {"error": "sign in to the hub first"})
        self.send(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-600:]))
def run(shas=SHAS, mig_sha=MIG_SHA):
    rep = os.path.join(H, "_kfi.txt")
    p = subprocess.run(["python3", "known_family_install.py"], cwd=H, capture_output=True, text=True, env=dict(os.environ, SB_MIGFILE=MIGF, SB_MIG_SHA=mig_sha,
        SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas), SB_REPORT=rep, SB_TOKEN="sbp_x", SB_REF="r", SB_SKIP_FUNCTION="1", SB_API_BASE=base, SB_FN_BASE=base))
    t = open(rep).read() if os.path.exists(rep) else ""
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
fixed = lambda: "journey_already_open" in s.run("select prosrc from pg_proc where proname='client_status_decide'")[0][0]
rc, t = run(mig_sha="0" * 64)
ck("a changed migration stops before anything runs", rc == 2 and not fixed(), t[-200:])
rc, t = run(dict(SHAS, **{"_shared/client-lookup.ts": "0" * 64}))
ck("a changed matching rule stops before anything runs", rc == 2 and not fixed(), t[-200:])
rc, t = run()
ck("installs: the returning-client fix is live, the lookup reachable, and it refuses the unsigned and the public key",
   rc == 0 and fixed() and "✓ \"Returning client\" now keeps" in t and "✓ the hub can reach the lookup" in t and "including the public key" in t and "RESULT: INSTALLED" in t, t)
rc, t = run()
ck("a rerun is harmless", rc == 0 and "RESULT: INSTALLED" in t, t[-300:])
S["open"] = {"anon"}; rc, t = run()
ck("if the public key could use the lookup, it says so", rc == 9 and "the public key got HTTP 200" in t, t[-300:])
S["open"] = set(); S["cors"] = False; rc, t = run()
ck("a CORS failure is reported, not hidden", rc == 9 and "✗ CORS preflight" in t, t[-300:])
srv.shutdown(); c.close()
print("\nDESKTOP 263 · IS THIS FAMILY ALREADY KNOWN? · INSTALL PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED"); print("migration:", MIG_SHA); print("shas:", json.dumps(SHAS))
