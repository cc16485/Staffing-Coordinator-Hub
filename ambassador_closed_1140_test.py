#!/usr/bin/env python3
# Rehearsal of 1140 (ambassador_closed_1140.py) against a FAKE Supabase (management API, functions, SQL) and a FAKE supabase CLI,
# from a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.  python3 ambassador_app_1134_test.py
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
        if m and m.group(1) == "lead-intake": return self._send(200, {"version": 75, "verify_jwt": False})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/lead-intake"):
            M.setdefault("posts", []).append([p, body])
            if "token=tok" in p:
                if M.get("still_open"): return self._send(200, {"status": "application received"})
                return self._send(400, {"error": "Our Community Ambassador program has closed, so we can't take applications anymore.", "closed": True})
            return self._send(401, {"error": "unauthorized"})
        q = body["query"]
        if "key = 'leads'" in q:
            n_ = M.get("lead_reads", 0); M["lead_reads"] = n_ + 1
            return self._send(200, [{"n": 40 + (1 if M.get("grow") and n_ >= 1 else 0)}])
        if "key = 'referral_orgs'" in q and "as name" in q: return self._send(200, [{"name": "Samantha Test", "status": "applied"}])
        if "key = 'referral_orgs'" in q: return self._send(200, [{"amb": 1}])
        M.setdefault("other_sql", []).append(q)
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1140-"); WT = os.path.join(TMP, "wt")
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
FILES = ["lead-intake/index.ts"]
SHAS = {k: sha(os.path.join(WT, "supabase/functions", k)) for k in FILES}
def go(**m):
    M.clear(); M.update(m)
    if os.path.exists(DEPLOYS): os.remove(DEPLOYS)
    rep = os.path.join(TMP, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="1140", SB_TOKEN="sbp_fake", SB_REPORT=rep, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(m.get("shas", SHAS)), SB_MAIN_REF="HEAD", SB_BASE="HEAD~1", SB_SETTLE="0",
               SB_FORM_TOKEN="tok", SB_NODE="none" if m.get("no_node") else (shutil.which("node") or ""))
    p = subprocess.run(["python3", os.path.join(WT, "ambassador_closed_1140.py")], cwd=WT, env=env, capture_output=True, text=True)
    dep = open(DEPLOYS).read().split("\n")[:-1] if os.path.exists(DEPLOYS) else []
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), dep
try:
    c, o, d = go()
    ck("clean run: DONE, exit 0", c == 0 and "1140: DONE" in o, o)
    ck("clean run: the tests ran (fake data only)", "the closed application, partner link, web referral and app sign-up tests pass" in o, o)
    ck("clean run: lead-intake only, re-deployed with the gateway check kept off", d == ["lead-intake nojwt"] and "gateway sign-in check off (kept)" in o, [d, o])
    ck("clean run: lists the applications already on file, kept as they are", "ambassador applications already on file: 1 (kept as they are)" in o and "Samantha Test (applied)" in o, o)
    ck("clean run: only read-only SQL, no database change", not M.get("other_sql"), M.get("other_sql"))
    ck("clean run: wrong key = nothing; a real-looking application is refused as closed; nothing saved or added", "a caller with the wrong key gets nothing (401)" in o and "refused: the program has closed" in o and "no inquiry was added by this step (40)" in o and "no ambassador application was saved by this step (1)" in o, o)
    c, o, d = go(still_open=True, no_node=True)
    ck("if the live server still took the application: said loudly, not DONE", c == 1 and "the closed proof answered 200" in o and "NOT COMPLETE" in o, o)
    c, o, d = go(grow=True, no_node=True)
    ck("the count moved during the step: said, not DONE", c == 1 and "the inquiry count moved from 40 to 41" in o, o)
    c, o, d = go(shas={**SHAS, "lead-intake/index.ts": "0" * 64}, no_node=True)
    ck("not the reviewed build: stops before anything changes", c == 2 and not d and "not the reviewed build" in o, o)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
ok = sum(1 for r in res if r[1])
for n, g, note in res: print(("  ✓ " if g else "  ✗ ") + n + ("" if g else "\n      " + note))
print(f"\n{ok}/{len(res)} passed"); raise SystemExit(0 if ok == len(res) else 1)
