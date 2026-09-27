#!/usr/bin/env python3
# Desktop 264 against fake Supabase services. Never touches production.
import os, json, threading, subprocess, hashlib, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
H = os.path.dirname(os.path.abspath(__file__))
FNROOT = os.path.join(H, "supabase", "functions")
def sha(p): return hashlib.sha256(open(os.path.join(FNROOT, p), "rb").read()).hexdigest()
FNS = ["assessment-intake", "call-followup", "lead-intake", "call-disposition", "cc-booking", "client-lookup"]
SHAS = {**{f: sha(f + "/index.ts") for f in FNS}, "_shared/returning.ts": sha("_shared/returning.ts"), "_shared/client-lookup.ts": sha("_shared/client-lookup.ts")}
LIVE = {"assessment-intake": False, "call-followup": False, "lead-intake": False, "call-disposition": False, "cc-booking": False, "client-lookup": True}
S = {"vj": dict(LIVE), "flip_after": None, "reads": {}, "open": set()}
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = urllib.parse.urlparse(self.path)
        if p.path.startswith("/v1/projects/r/functions/"):
            fn = p.path.rsplit("/", 1)[1]
            S["reads"][fn] = S["reads"].get(fn, 0) + 1
            if fn not in S["vj"]: return self.send(404, {"message": "not found"})
            v = S["vj"][fn]
            if S["flip_after"] == fn and S["reads"][fn] > 1: v = not v
            return self.send(200, {"slug": fn, "verify_jwt": v})
        return self.fn()
    def do_POST(self): self.rfile.read(int(self.headers.get("Content-Length") or 0)); return self.fn()
    def fn(self):
        p = urllib.parse.urlparse(self.path)
        if p.path.startswith("/functions/v1/"):
            fn = p.path.rsplit("/", 1)[1]
            return self.send(200, {"ok": True}) if fn in S["open"] else self.send(401, {"error": "unauthorized"})
        self.send(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-700:]))
def run(shas=SHAS):
    rep = os.path.join(H, "_rei.txt"); S["reads"] = {}
    p = subprocess.run(["python3", "returning_entries_install.py"], cwd=H, capture_output=True, text=True,
        env=dict(os.environ, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas), SB_REPORT=rep, SB_TOKEN="sbp_x", SB_REF="r", SB_SKIP_FUNCTION="1", SB_API_BASE=base, SB_FN_BASE=base))
    t = open(rep).read() if os.path.exists(rep) else ""
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
rc, t = run(dict(SHAS, **{"_shared/returning.ts": "0" * 64}))
ck("a changed rule file stops before anything runs", rc == 2 and "would deploy" not in t, t[-200:])
del S["vj"]["cc-booking"]; rc, t = run(); S["vj"]["cc-booking"] = False
ck("if how a function checks callers can't be read, nothing is deployed", rc == 3 and "cc-booking" in t and "would deploy" not in t, t[-300:])
S["vj"]["client-lookup"] = False; rc, t = run(); S["vj"]["client-lookup"] = True
ck("if the lookup isn't checking sign-ins, nothing is deployed", rc == 3 and "would deploy" not in t, t[-300:])
rc, t = run()
ck("each webhook is deployed WITHOUT sign-in checking, exactly as today; the lookup WITH it",
   rc == 0 and all(f"would deploy {f} --no-verify-jwt" in t for f in FNS if f != "client-lookup") and "would deploy client-lookup\n" in t + "\n" and "client-lookup --no-verify-jwt" not in t, t)
ck("installed: callers checked as before, all 5 front doors refuse a wrong token, the lookup refuses the unsigned",
   "✓ every function checks callers exactly as before" in t and "all 5 front doors are up and still refuse a wrong token" in t and "RESULT: INSTALLED" in t, t[-400:])
S["flip_after"] = "lead-intake"; rc, t = run(); S["flip_after"] = None
ck("if a deploy changed how the web form checks callers, it says so loudly", rc == 6 and "lead-intake" in t and "Tell Claude today" in t, t[-300:])
S["open"] = {"call-disposition"}; rc, t = run(); S["open"] = set()
ck("a front door that accepts a wrong token is reported", rc == 7 and "call-disposition → HTTP 200" in t, t[-300:])
S["open"] = {"client-lookup"}; rc, t = run(); S["open"] = set()
ck("a lookup that answers the unsigned is reported", rc == 8, t[-300:])
srv.shutdown()
print("\nDESKTOP 264 · FRONT DOORS INSTALL · PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED"); print("shas:", json.dumps(SHAS))
