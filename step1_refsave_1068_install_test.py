#!/usr/bin/env python3
# Rehearsal of 1068 (step1_refsave_1068.py) from a fresh copy, against a FAKE Supabase and a FAKE supabase CLI.
# Never touches a real project.   python3 step1_refsave_1068_install_test.py [base sha]
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
BASESHA = sys.argv[1] if len(sys.argv) > 1 else "9dcce6716f68df0720698bc0afec60f26064ed8d"
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[-900:]))
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if "/api-keys" in self.path: return self._send(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJsvc"}])
        if re.match(r"/v1/projects/\w+/functions/[\w-]+$", self.path): return self._send(200, {"version": 40, "verify_jwt": False})
        self._send(404, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); self.rfile.read(n)
        if self.path.startswith("/functions/v1/step1-sign"): return self._send(400, {"ok": False, "error": "This link is not valid"})
        self._send(400, {"message": "unexpected"})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1068-"); W = os.path.join(TMP, "w"); BASE = os.path.join(TMP, "base"); os.makedirs(BASE)
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", W, "HEAD"], check=True)
subprocess.run(f"git -C {HERE} archive {BASESHA} supabase/functions | tar -x -C {BASE}", shell=True, check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); os.makedirs(os.path.join(TMP, "deployed"))
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]
if a[:2] == ['functions', 'deploy']: open(os.path.join({TMP!r}, 'deployed', a[2]), 'w').write(' '.join(a)); sys.exit(0)
if a[:2] == ['functions', 'download']:
    src = os.path.join({W!r}, 'supabase', 'functions') if os.path.exists(os.path.join({TMP!r}, 'deployed', a[2])) or os.path.exists(os.path.join({TMP!r}, 'drift')) else os.path.join({BASE!r}, 'supabase', 'functions')
    shutil.copytree(src, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
"""); os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
SHAS = {"step1-sign/index.ts": sha(os.path.join(W, "supabase/functions/step1-sign/index.ts"))}
def run(**over):
    rep = os.path.join(TMP, "report.txt")
    env = dict(os.environ, SB_STEP="1068", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"),
               SB_FNROOT=os.path.join(W, "supabase/functions"), SB_BASE=BASESHA, SB_SHAS=json.dumps(SHAS), SB_MAIN_REF="HEAD", SB_NODE=subprocess.run(["which", "node"], capture_output=True, text=True).stdout.strip())
    env.update(over)
    p = subprocess.run(["python3", os.path.join(W, "step1_refsave_1068.py")], cwd=W, env=env, capture_output=True, text=True, timeout=600)
    return p.returncode, p.stdout + p.stderr
try:
    open(os.path.join(TMP, "drift"), "w").write("1")
    c, out = run(); ck("live is not the starting build: stops before deploying", c != 0 and "not the build this change started from" in out and not os.path.exists(os.path.join(TMP, "deployed", "step1-sign")), out)
    os.remove(os.path.join(TMP, "drift"))
    c, out = run(SB_SHAS=json.dumps({"step1-sign/index.ts": "0" * 64})); ck("a different build: nothing runs", c != 0 and "not the reviewed build" in out, out)
    c, out = run(); dep = open(os.path.join(TMP, "deployed", "step1-sign")).read() if os.path.exists(os.path.join(TMP, "deployed", "step1-sign")) else ""
    ck("tests pass from a fresh copy, deploys step1-sign keeping the gateway setting, proof passes, DONE", c == 0 and "tests pass" in out and "--no-verify-jwt" in dep and "1068: DONE" in out and "✗" not in out, out)
    c, out = run(); ck("safe to run again: sees the fix is already live, deploys nothing, DONE", c == 0 and "already this fix" in out and "nothing to deploy" in out and "1068: DONE" in out, out)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", W]); srv.shutdown()
for s, n, note in [("PASS" if ok else "FAIL", n, note) for n, ok, note in res]: print(s, n, ("\n   " + note) if note else "")
print(f"{sum(1 for r in res if r[1])}/{len(res)} passed")
