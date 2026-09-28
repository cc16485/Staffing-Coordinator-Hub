#!/usr/bin/env python3
# Proof of Desktop 307 against a fake Supabase and a fake CLI that records how each function is deployed. Never touches production.
import os, sys, json, hashlib, subprocess, tempfile, threading, stat
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
H = os.path.dirname(os.path.abspath(__file__)); FN = os.path.join(H, "supabase/functions")
NAMES = ["care-level", "client-convert", "family-circles", "careplan-tasks", "schedule-push", "coverage-assign", "call-disposition"]
SHAS = {n: hashlib.sha256(open(os.path.join(FN, n, "index.ts"), "rb").read()).hexdigest() for n in NAMES}
SHSHA = hashlib.sha256(open(os.path.join(FN, "_shared", "axiscare-call-note.ts"), "rb").read()).hexdigest()
SETTING = {n: n not in ("call-disposition", "coverage-assign") for n in NAMES}   # two called without a sign-in in this fake
ST = {"record": True, "open": set()}
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        n = self.path.rsplit("/", 1)[-1]
        if n in SETTING: return self.send(200, {"verify_jwt": SETTING[n], "version": 3})
        self.send(404, {})
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.path.endswith("/database/query"): return self.send(200, [{"ok": ST["record"]}])
        n = self.path.rsplit("/", 1)[-1]
        return self.send(200 if n in ST["open"] else 401, {})
srv = ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start(); base = f"http://127.0.0.1:{srv.server_port}"
log = tempfile.mktemp(); cli = tempfile.mktemp()
open(cli, "w").write(f"#!/bin/sh\necho \"$@\" >> {log}\nexit 0\n"); os.chmod(cli, 0o755)
res = []
def ck(n, c, note=""): res.append((n, bool(c), "" if c else str(note)[:500]))
def run(shas=SHAS):
    rep = tempfile.mktemp(); open(log, "w").close()
    p = subprocess.run([sys.executable, os.path.join(H, "c2a_deploy.py")], capture_output=True, text=True,
        env=dict(os.environ, SB_FNROOT=FN, SB_FN_SHAS=json.dumps(shas), SB_SHARED_SHA=SHSHA, SB_REPORT=rep, SB_TOKEN="t", SB_SUPA_CLI=cli, SB_API_BASE=base, SB_FN_BASE=base))
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(log).read()
bad = dict(SHAS); bad["care-level"] = "0" * 64
rc, out, calls = run(bad); ck("a function that isn't the reviewed build: stops, nothing deployed", rc == 2 and not calls.strip(), out)
ST["record"] = False; rc, out, calls = run(); ST["record"] = True
ck("before the record is installed (Desktop 305): stops, nothing deployed", rc == 4 and not calls.strip(), out)
rc, out, calls = run()
ck("the real run: every line is a ✓", rc == 0 and "✗" not in out and "RESULT: DEPLOYED" in out, out)
ck("each function keeps its sign-in setting: the two GoHighLevel/server ones are deployed without the gateway check, the rest with it",
   all((("--no-verify-jwt" in l) == (not SETTING[l.split()[2]])) for l in calls.strip().splitlines()) and len(calls.strip().splitlines()) == 7, calls)
ST["open"] = {"care-level"}; rc, out, calls = run(); ST["open"] = set()
ck("if a function answered a caller with no sign-in, the report says so", rc == 6 and "✗ care-level" in out, out)
srv.shutdown()
for n, ok, note in res: print(("PASS" if ok else "FAIL") + " · " + n + ("" if ok else "  ::  " + note))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
print(json.dumps(SHAS)); print("shared", SHSHA)
