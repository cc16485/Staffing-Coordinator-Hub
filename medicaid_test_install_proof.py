#!/usr/bin/env python3
# Desktop 267 against fake Supabase services. Never touches production.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
H = os.path.dirname(os.path.abspath(__file__))
FNROOT = os.path.join(H, "supabase", "functions")
def sha(p): return hashlib.sha256(open(os.path.join(FNROOT, p), "rb").read()).hexdigest()
SHAS = {"profile-check": sha("profile-check/index.ts"), "_shared/care-level.ts": sha("_shared/care-level.ts")}
GOOD = {"results": [{"fixture": "DCN item appears for Medicaid", "pass": True}, {"fixture": "PACE is not Medicaid: no DCN item, no Medicaid authorization item", "pass": True}]}
S = {"vj": True, "flip": False, "reads": 0, "selftest": GOOD, "status": 200}
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.endswith("/functions/profile-check"):
            S["reads"] += 1
            return self.send(200, {"verify_jwt": (not S["vj"]) if (S["flip"] and S["reads"] > 1) else S["vj"]})
        if self.path.endswith("/api-keys"): return self.send(200, [{"name": "anon", "api_key": "ANON"}])
        if "/functions/v1/profile-check?selftest=1" in self.path:
            return self.send(S["status"], S["selftest"]) if self.headers.get("apikey") == "ANON" else self.send(401, {})
        self.send(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-500:]))
def run(shas=SHAS):
    rep = os.path.join(H, "_mti.txt"); S["reads"] = 0
    p = subprocess.run(["python3", "medicaid_test_install.py"], cwd=H, capture_output=True, text=True,
        env=dict(os.environ, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas), SB_REPORT=rep, SB_TOKEN="sbp_x", SB_REF="r", SB_SKIP_FUNCTION="1", SB_API_BASE=base, SB_FN_BASE=base))
    t = open(rep).read() if os.path.exists(rep) else ""
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
rc, t = run(dict(SHAS, **{"profile-check": "0" * 64}))
ck("a changed function stops before anything runs", rc == 2 and "would deploy" not in t, t[-200:])
rc, t = run()
ck("installs: deployed the same way (sign-in checked), live self-test passes including PACE", rc == 0 and "would deploy profile-check\n" in t + "\n" and "--no-verify-jwt" not in t and "including: PACE is not Medicaid" in t and "RESULT: INSTALLED" in t, t)
S["flip"] = True; rc, t = run(); S["flip"] = False
ck("if deploying changed how it checks callers, it says so loudly", rc == 5 and "Tell Claude today" in t, t[-300:])
S["selftest"] = {"results": [GOOD["results"][0]]}; rc, t = run(); S["selftest"] = GOOD
ck("an old copy still live (no PACE check) is caught", rc == 6 and "an old copy is still live" in t, t[-300:])
S["selftest"] = {"results": [{"fixture": "x", "pass": False}] + GOOD["results"]}; rc, t = run(); S["selftest"] = GOOD
ck("a failing self-test check is reported by name", rc == 6 and "• x" in t, t[-300:])
srv.shutdown()
print("\nDESKTOP 267 · PACE IS NOT MEDICAID · INSTALL PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED"); print("shas:", json.dumps(SHAS))
