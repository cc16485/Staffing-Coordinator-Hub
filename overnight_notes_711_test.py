#!/usr/bin/env python3
# Rehearsal of 711 from a fresh worktree: fake Supabase tool + fake management API + fake function. python3 overnight_notes_711_test.py
import json, os, subprocess, sys, tempfile, threading, hashlib, http.server, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); res = []
def ck(n, c, note=""): res.append((n, bool(c), "" if c else str(note)[:600]))
W = tempfile.mkdtemp(prefix="r711-") + "/w"
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", W, "HEAD"], check=True)
FNROOT = W + "/supabase/functions"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
S = {"dry": 0, "deployed": False}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.endswith("/functions/missed-notes"): return self.send(200, {"version": 9 if S["deployed"] else 8, "verify_jwt": True})
        if "/api-keys" in self.path: return self.send(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJsvc"}])
        self.send(404, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); self.rfile.read(n)
        if "/database/query" in self.path: return self.send(201, [{"status": "open", "n": 3}, {"status": "unresolved", "n": 2}])
        if "missed-notes?auth_check" in self.path: return self.send(401, {"error": "not allowed"})
        if "missed-notes?dry=1" in self.path:
            S["dry"] += 1; ok = self.headers.get("Authorization") == "Bearer eyJsvc"
            return self.send(200 if ok else 401, {"ok": True, "dry": True, "groups_checked": 12, "overnight_noted": 2} if ok else {})
        self.send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"
cli = tempfile.mkdtemp() + "/supabase"
open(cli, "w").write(f"""#!/bin/zsh
if [[ "$2" == download ]]; then mkdir -p supabase/functions/missed-notes supabase/functions/_shared
  cp {FNROOT}/missed-notes/index.ts supabase/functions/missed-notes/; cp {FNROOT}/_shared/*.ts supabase/functions/_shared/; exit 0; fi
touch {cli}.deployed; exit 0
"""); os.chmod(cli, 0o755)
def run(shas, extra={}):
    rep = tempfile.mktemp(suffix=".txt")
    env = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_SUPA_CLI=cli, SB_FNROOT=FNROOT, SB_STEP="711", SB_FN_SHAS=json.dumps(shas), SB_API_BASE=BASE, SB_FN_BASE=BASE, SB_SETTLE="0", **extra)
    p = subprocess.run([sys.executable, W + "/overnight_notes_711.py"], env=env, capture_output=True, text=True, cwd=tempfile.mkdtemp())
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
SHAS = {"missed-notes/index.ts": sha(FNROOT + "/missed-notes/index.ts")}
c, rep = run({"missed-notes/index.ts": "0" * 64})
ck("a build that isn't the reviewed one: stops before anything changes", c == 2 and not os.path.exists(cli + ".deployed") and "nothing runs" in rep, rep)
S["deployed"] = True
c, rep = run(SHAS)
ck("the reviewed build: deploys, sign-in check on, practice look with the server key, DONE", c == 0 and os.path.exists(cli + ".deployed") and "gateway sign-in check on" in rep
   and "2 overnight half(s) covered" in rep and "RESULT: DONE" in rep and S["dry"] == 1, rep)
ck("the report shows what's on record (read only) and never the key", "open 3, unresolved 2" in rep and "eyJsvc" not in rep, rep)
subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", W]); srv.shutdown()
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}"); sys.exit(0 if all(r[1] for r in res) else 1)
