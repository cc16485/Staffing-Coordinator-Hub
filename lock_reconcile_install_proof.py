#!/usr/bin/env python3
# Proof of Desktop 303's installer against a fake Supabase (locked and still-open function). Never touches production.
import os, sys, json, hashlib, subprocess, tempfile, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
H = os.path.dirname(os.path.abspath(__file__)); FN = os.path.join(H, "supabase/functions")
SHA = hashlib.sha256(open(os.path.join(FN, "lead-reconcile/index.ts"), "rb").read()).hexdigest()
MODE = {"locked": True}
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.endswith("/functions/lead-reconcile"): return self.send(200, {"version": 17, "verify_jwt": True})
        if "/api-keys" in self.path: return self.send(200, [{"name": "anon", "api_key": "ANONKEY"}, {"name": "service_role", "api_key": "SVCKEY"}])
        self.send(404, {})
    def do_OPTIONS(self): self.send(200, {})
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        a = self.headers.get("Authorization") or ""
        if not a: return self.send(401, {"msg": "no jwt"})
        if MODE["locked"] and a != "Bearer SVCKEY": return self.send(403, {"error": "owner scripts only"})
        self.send(200, {"invisible_sample": [{"name": "SHOULD NEVER BE PRINTED"}]})
from http.server import ThreadingHTTPServer
srv = ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start(); base = f"http://127.0.0.1:{srv.server_port}"
res = []
def ck(n, c, note=""): res.append((n, bool(c), "" if c else str(note)[:500]))
def run(sha):
    rep = tempfile.mktemp()
    p = subprocess.run([sys.executable, os.path.join(H, "lock_reconcile_install.py")], capture_output=True, text=True,
        env=dict(os.environ, SB_FNROOT=FN, SB_FN_SHA=sha, SB_REPORT=rep, SB_TOKEN="t", SB_SKIP_DEPLOY="1", SB_API_BASE=base, SB_FN_BASE=base))
    out = open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
    return p.returncode, out + p.stdout
rc, out = run("0" * 64); ck("a function file that isn't the reviewed build: stops", rc == 2, out)
rc, out = run(SHA); ck("locked: every line is a ✓ (no sign-in 401, public key 403, private key 200)", rc == 0 and "✗" not in out and "RESULT: LOCKED" in out, out)
ck("no contact name is ever printed, and no key is printed", "SHOULD NEVER BE PRINTED" not in out and "ANONKEY" not in out and "SVCKEY" not in out, out)
MODE["locked"] = False
rc, out = run(SHA); ck("if the function were still open, the report says so (✗ public key answered) without printing what it said", rc == 6 and "✗ the Hub's public key is refused (200)" in out and "SHOULD NEVER BE PRINTED" not in out, out)
srv.shutdown()
for n, ok, note in res: print(("PASS" if ok else "FAIL") + " · " + n + ("" if ok else "  ::  " + note))
print(f"{sum(1 for r in res if r[1])}/{len(res)}"); print("lead-reconcile/index.ts sha256", SHA)
