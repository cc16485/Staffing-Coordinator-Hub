#!/usr/bin/env python3
# Rehearsal of 1073 (quiet_cards_1073.py) against a FAKE Supabase (management API, functions) and a FAKE supabase CLI, from a
# fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.  python3 quiet_cards_1073_test.py
import json, os, subprocess, tempfile, threading, http.server, hashlib, re, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
M = {}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if "/api-keys" in self.path: return self._send(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJservice"}])
        if re.match(r"/v1/projects/\w+/functions/(coverage-watch)$", self.path): return self._send(200, {"version": 7, "verify_jwt": False})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"):
            if self.headers.get("Authorization") == "Bearer eyJservice" and "auth_check=1" in p and "coverage-watch" in p: return self._send(200, {"ok": True, "caller": "service"})
            return self._send(401, {"error": "not allowed"})
        q = body["query"]
        if "quieter_cards_live" in q: return self._send(200, [{"quiet": None, "loops": "true"}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1073-"); WT = os.path.join(TMP, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); FLAG = os.path.join(TMP, "deployed")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]
if a[:2] == ['functions', 'deploy']: open({FLAG!r}, 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree(os.path.join({WT!r}, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
SHAS = {k: sha(os.path.join(WT, "supabase/functions", k)) for k in ("coverage-watch/index.ts", "_shared/quiet-cards.ts", "_shared/loops.ts")}
def go(**m):
    M.clear(); M.update(m)
    if os.path.exists(FLAG): os.remove(FLAG)
    rep = os.path.join(TMP, "report.txt")
    class W(threading.Thread):
        def run(self_):
            while not getattr(self_, "stop", False):
                if os.path.exists(FLAG): M["deployed"] = True
                threading.Event().wait(0.2)
    w = W(daemon=True); w.start()
    env = dict(os.environ, SB_STEP="1073", SB_TOKEN="sbp_fake", SB_REPORT=rep, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(m.get("shas", SHAS)), SB_MAIN_REF="HEAD", SB_SETTLE="0")
    p = subprocess.run(["python3", os.path.join(WT, "quiet_cards_1073.py")], cwd=WT, env=env, capture_output=True, text=True)
    w.stop = True
    return p.returncode, open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
try:
    c, o = go()
    ck("clean run: DONE, exit 0, quieter cards stay off", c == 0 and "1073: DONE" in o and "installed and OFF" in o, o)
    ck("clean run: tests ran and a stranger was refused", "one weekly list" in o and "coverage-watch: a caller with no key gets nothing (401)" in o, o)
    ck("clean run: deployed with its gateway setting kept", "coverage-watch deployed" in o and "gateway sign-in check off (kept)" in o, o)
    ck("clean run: the server key is let in, nothing run by hand", "the server key is let in" in o, o)
    ck("clean run: says what is on and off now, and changes neither", "quieter cards on: false" in o and "(loops) on: true" in o, o)
    c, o = go(shas={"coverage-watch/index.ts": "0" * 64})
    ck("not the reviewed build: stops before anything changes", c == 2 and not os.path.exists(FLAG) and "not the reviewed build" in o, o)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
ok = sum(1 for r in res if r[1])
for n, g, note in res: print(("  ✓ " if g else "  ✗ ") + n + ("" if g else "\n      " + note))
print(f"\n{ok}/{len(res)} passed"); raise SystemExit(0 if ok == len(res) else 1)
