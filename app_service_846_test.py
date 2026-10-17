#!/usr/bin/env python3
# Rehearsal of 846 against a FAKE Supabase. Never touches a real project.
import json, os, subprocess, tempfile, threading, http.server, hashlib, re
HERE = os.path.dirname(os.path.abspath(__file__)); sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900])); S = {}
GOOD = {"date": "2026-11-15", "reason_found": True, "create_status": 200, "visit_id": "v9", "read_status": 200, "service_code": "PP - App", "service_description": "Private Pay - Family App Visit",
        "reason": "Booked by family in app", "billable_rate_mode": "Hourly", "charge_rate": 30, "caregiver": None, "delete_status": 200, "removed": True}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if "/api-keys" in self.path: return self._send(200, [{"name": "service_role", "api_key": "eyJsvc"}])
        if self.path.endswith("/functions/family-gateway"): return self._send(200, {"verify_jwt": False})
        if self.path.endswith("/functions/app-service-probe"): return self._send(404 if S["deleted"] else 200, {})
        self._send(404, {})
    def do_DELETE(self): S["deleted"] = True; self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"{}")
        if self.path.endswith("/database/query"):
            q = b["query"]; S["sql"].append(q)
            if q.startswith("select"): return self._send(200, [{"svc": "PP - WC", "reason": "Booked by family in app"}])
            S["svc"] = "PP - App"; return self._send(201, [{"svc": "PP - App"}])
        if self.path == "/functions/v1/app-service-probe": S["probe"] = b; return self._send(200, S["answer"])
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"; TMP = tempfile.mkdtemp(); BIN = os.path.join(TMP, "supabase")
FILES = ["supabase/functions/family-gateway/index.ts", "supabase/functions/_shared/family-app.ts", "supabase/functions/app-service-probe/index.ts"]; PINS = {f: sha(os.path.join(HERE, f)) for f in FILES}
def run(answer=GOOD, dfail=False, pins=PINS):
    S.clear(); S.update(deleted=False, sql=[], answer=answer, svc="PP - WC", probe=None); rep = os.path.join(TMP, "r.txt")
    open(BIN, "w").write("#!/bin/sh\necho \"$@\" >> %s/log\nexit %d\n" % (TMP, 1 if dfail else 0)); os.chmod(BIN, 0o755)
    if os.path.exists(f"{TMP}/log"): os.remove(f"{TMP}/log")
    p = subprocess.run(["python3", os.path.join(HERE, "app_service_846.py")], env=dict(os.environ, SB_TOKEN="sbp_t", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
        SB_SUPA_CLI=BIN, SB_REPO=HERE, SB_PINS=json.dumps(pins), SB_SETTLE="0"), capture_output=True, text=True, timeout=60)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), (open(f"{TMP}/log").read() if os.path.exists(f"{TMP}/log") else "")
c, out, log = run()
ck("1 good: gateway redeployed (no sign-in check), PP - App proven + removed, setting switched, checker deleted", c == 0 and "family-gateway" in log and "--no-verify-jwt" in log and S["svc"] == "PP - App" and S["deleted"] and S["probe"] == {"service": "PP - App", "reason": "Booked by family in app"} and "846: DONE" in out, out)
c, out, log = run(answer={**GOOD, "create_status": 400, "create_error": {"errors": ["Unknown serviceCode"]}, "visit_id": None})
ck("2 AxisCare refuses PP - App: NOT switched, stays PP - WC", c == 1 and S["svc"] == "PP - WC" and "refused" in out, out)
c, out, log = run(answer={**GOOD, "service_code": "PP - WC"})
ck("3 read back as another service: NOT switched", c == 1 and S["svc"] == "PP - WC", out)
c, out, log = run(answer={**GOOD, "removed": False})
ck("4 not removed: says which visit to delete, NOT switched", c == 1 and "please delete Test Client 5" in out and S["svc"] == "PP - WC", out)
c, out, log = run(dfail=True)
ck("5 gateway won't deploy: stops, nothing switched, no checker", c == 1 and S["svc"] == "PP - WC" and S["probe"] is None, out)
c, out, log = run(pins={**PINS, FILES[1]: "0" * 64})
ck("6 not the reviewed build: nothing done", c == 2 and not log and not S["sql"], out)
for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  846 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed"); raise SystemExit(0 if all(r[1] for r in res) else 1)
