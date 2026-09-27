#!/usr/bin/env python3
# Desktop 262 (identity-backfill caller lock) against fake Supabase services. Never touches production.
import os, json, threading, subprocess, hashlib, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
H = os.path.dirname(os.path.abspath(__file__))
FNROOT = os.path.join(H, "supabase", "functions")
SHAS = {"identity-backfill": hashlib.sha256(open(os.path.join(FNROOT, "identity-backfill", "index.ts"), "rb").read()).hexdigest()}
OK_CIRCLES = {"mode": "DRY RUN", "clients": 290, "circles_created": 0, "errors": 0, "sample": 0}
S = {"verify_jwt": True, "anon_open": set(), "circles": dict(OK_CIRCLES), "svc_ok": True, "calls": []}
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.endswith("/api-keys"): return self.send(200, [{"name": "anon", "api_key": "ANON"}, {"name": "service_role", "api_key": "SVC"}])
        if self.path.endswith("/functions/identity-backfill"): return self.send(200, {"slug": "identity-backfill", "verify_jwt": S["verify_jwt"]})
        if self.path.startswith("/functions/v1/identity-backfill"):
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query); key = self.headers.get("apikey")
            S["calls"].append((key, self.path, "commit" in qs))
            if key == "SVC": return self.send(200, dict(OK_CIRCLES, sample=[{"name": "Ruth"}])) if S["svc_ok"] else self.send(403, {"error": "no"})
            if qs.get("circles") == ["1"]: return self.send(200, S["circles"])
            mode = next(iter(qs), "")
            return self.send(200, {"names": ["x"]}) if mode in S["anon_open"] else self.send(403, {"error": "service_role required"})
        self.send(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-400:]))
def run(shas=SHAS):
    rep = os.path.join(H, "_ibl.txt"); S["calls"] = []
    p = subprocess.run(["python3", "identity_backfill_lock_install.py"], cwd=H, capture_output=True, text=True,
        env=dict(os.environ, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas), SB_REPORT=rep, SB_TOKEN="sbp_x", SB_REF="r",
                 SB_SKIP_FUNCTION="1", SB_API_BASE=base, SB_FN_BASE=base))
    t = open(rep).read() if os.path.exists(rep) else ""
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
writes = lambda: any(c for _, _, c in S["calls"])
rc, t = run({"identity-backfill": "0" * 64})
ck("a changed function stops before anything runs", rc == 2 and not S["calls"], t[-200:])
S["verify_jwt"] = False; rc, t = run()
ck("a function that doesn't check keys are genuine is reported", rc == 5 and "not checking that keys are genuine" in t, t[-300:])
S["verify_jwt"] = True; S["anon_open"] = {"grade"}; rc, t = run()
ck("if the public key still reaches a mode, it says which", rc == 7 and "?grade=1 → HTTP 200" in t, t[-300:])
S["anon_open"] = set(); S["circles"] = dict(OK_CIRCLES, waiting=[{"name": "Ruth"}]); rc, t = run()
ck("if the nightly circles sync would show names, it says so", rc == 8 and "show names" in t, t[-300:])
S["circles"] = {"error": "boom"}; rc, t = run()
ck("if the nightly circles sync would break, it says so", rc == 8, t[-300:])
S["circles"] = dict(OK_CIRCLES); S["svc_ok"] = False; rc, t = run()
ck("if the service key were shut out too, it says so", rc == 9 and "service key was not let through" in t, t[-300:])
S["svc_ok"] = True; rc, t = run()
ck("locked: 8 modes refused to the public key, circles counts only, service key through, RESULT LOCKED",
   rc == 0 and "(tried 8)" in t and "counts only (290 clients read" in t and "still get through" in t and "RESULT: LOCKED" in t, t)
ck("the install itself never asks for a write (every call is a preview or a refused one)", not any(c for k, _, c in S["calls"] if k == "SVC")
   and sum(1 for k, _, _ in S["calls"] if k == "ANON") == 9, S["calls"])
srv.shutdown()
print("\nDESKTOP 262 · IDENTITY-BACKFILL LOCK · PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED"); print("shas:", json.dumps(SHAS))
