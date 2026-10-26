#!/usr/bin/env python3
# Rehearsal of 1132 (partner_revenue_1132.py) against a FAKE Supabase and a FAKE supabase CLI, from a fresh worktree of this
# commit (as the Desktop step runs it). Never touches a real project.  python3 partner_revenue_1132_test.py
import json, os, subprocess, tempfile, threading, http.server, hashlib, re, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[-1500:]))
M = {}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        m = re.match(r"/v1/projects/\w+/functions/([a-z-]+)$", self.path)
        if m and m.group(1) == "partner-revenue":
            if M.get("exists") or M.get("deployed"): return self._send(200, {"version": 2 if M.get("deployed") else 1, "verify_jwt": True})
            return self._send(404, {})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
        if self.path.startswith("/functions/v1/partner-revenue"):
            M.setdefault("posts", []).append(self.path); return self._send(M.get("answer", 401), {"error": "x"})
        M.setdefault("sql", []).append(body.get("query")); return self._send(400, {"message": "no sql expected"})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1132-"); WT = os.path.join(TMP, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); DEPLOYS = os.path.join(TMP, "deploys")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]
if a[:2] == ['functions', 'deploy']: open({DEPLOYS!r}, 'a').write(a[2] + ' ' + ('nojwt' if '--no-verify-jwt' in a else 'jwt') + '\\n'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree(os.path.join({WT!r}, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
FILES = ["partner-revenue/index.ts", "_shared/partner-revenue.ts", "_shared/packet-visits.ts", "_shared/staff-auth.ts", "_shared/business-days.ts"]
SHAS = {k: sha(os.path.join(WT, "supabase/functions", k)) for k in FILES}
def go(**m):
    M.clear(); M.update(m)
    if os.path.exists(DEPLOYS): os.remove(DEPLOYS)
    rep = os.path.join(TMP, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="1132", SB_TOKEN="sbp_fake", SB_REPORT=rep, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(m.get("shas", SHAS)), SB_MAIN_REF="HEAD", SB_SETTLE="0",
               SB_NODE="none" if m.get("no_node") else (shutil.which("node") or ""))
    p = subprocess.run(["python3", os.path.join(WT, "partner_revenue_1132.py")], cwd=WT, env=env, capture_output=True, text=True)
    dep = open(DEPLOYS).read().split("\n")[:-1] if os.path.exists(DEPLOYS) else []
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), dep
try:
    c, o, d = go()
    ck("clean run: DONE, exit 0", c == 0 and "1132: DONE" in o, o)
    ck("clean run: the tests ran (fake data only)", "the partner revenue tests pass" in o, o)
    ck("clean run: partner-revenue is new, deployed once with the gateway sign-in check ON", "partner-revenue is new" in o and d == ["partner-revenue jwt"], [d, o])
    ck("clean run: no database change at all", not M.get("sql"), M.get("sql"))
    ck("clean run: no sign-in = nothing, twice", o.count("gets nothing (401)") == 2, o)
    c, o, d = go(exists=True, no_node=True)
    ck("run again: says it already exists and replaces it with the reviewed build", "already exists (version 1)" in o and d == ["partner-revenue jwt"], o)
    c, o, d = go(answer=200, no_node=True)
    ck("a function that answers without a sign-in: said loudly, not DONE", c == 1 and "answered a caller with no sign-in with 200" in o, o)
    c, o, d = go(shas={**SHAS, "partner-revenue/index.ts": "0" * 64}, no_node=True)
    ck("not the reviewed build: stops before anything changes", c == 2 and not d and "not the reviewed build" in o, o)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
ok = sum(1 for r in res if r[1])
for n, g, note in res: print(("  ✓ " if g else "  ✗ ") + n + ("" if g else "\n      " + note))
print(f"\n{ok}/{len(res)} passed"); raise SystemExit(0 if ok == len(res) else 1)
