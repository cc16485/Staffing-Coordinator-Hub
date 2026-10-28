#!/usr/bin/env python3
# Rehearsal of 1165 (profile_intro_1165.py) against a FAKE Supabase (management API, functions) and a FAKE supabase CLI,
# from a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.  python3 profile_intro_1165_test.py
import json, os, subprocess, tempfile, threading, http.server, hashlib, re, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[-1500:]))
M = {}
LEARN = {"ok": True, "dry": True, "live": False, "sent": 0, "problems": ["AxisCare's visit history isn't ready: still learning a year of visits (through 2026-02-24)"], "would": [], "cards": []}
DONE = {"ok": True, "dry": True, "live": False, "sent": 0, "problems": [],
        "would": [{"caregiver": "Sarah T.", "client": "Dorothy Ray", "visit": "2026-10-30T09:00", "to": [{"name": "Linda Ray"}]}],
        "cards": [{"title": "Profile not ready: Jordan M. for Walt Green"}]}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if re.match(r"/v1/projects/\w+/functions/profile-intro-watch$", p): return self._send(200, {"version": 1, "verify_jwt": True})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJservice"}])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); self.rfile.read(n); p = self.path
        if p.startswith("/functions/v1/profile-intro-watch"):
            M.setdefault("posts", []).append(p)
            if self.headers.get("Authorization", "") != "Bearer eyJservice": return self._send(401, {"error": "not allowed"})
            seq = M.get("seq", [LEARN, LEARN, DONE]); i = min(len(M["posts"]) - 1, len(seq) - 1)
            return self._send(200, seq[i])
        M.setdefault("other", []).append(p); self._send(400, {"message": "unexpected " + p})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1165-"); WT = os.path.join(TMP, "wt")
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
SHAS = {k: sha(os.path.join(WT, "supabase/functions", k)) for k in ["profile-intro-watch/index.ts", "_shared/profile-intro.ts"]}
def go(**m):
    M.clear(); M.update(m)
    if os.path.exists(DEPLOYS): os.remove(DEPLOYS)
    rep = os.path.join(TMP, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="1165", SB_TOKEN="sbp_fake", SB_REPORT=rep, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(m.get("shas", SHAS)), SB_MAIN_REF="HEAD", SB_SETTLE="0", SB_RUNS="4",
               SB_NODE="none" if m.get("no_node") else (shutil.which("node") or ""))
    p = subprocess.run(["python3", os.path.join(WT, "profile_intro_1165.py")], cwd=WT, env=env, capture_output=True, text=True)
    dep = open(DEPLOYS).read().split("\n")[:-1] if os.path.exists(DEPLOYS) else []
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), dep
try:
    c, o, d = go()
    ck("clean run: DONE, exit 0", c == 0 and "1165: DONE" in o, o)
    ck("clean run: the tests ran (fake data only)", "the profile and change text tests pass" in o, o)
    ck("clean run: only profile-intro-watch deployed, keeping its gateway setting", d == ["profile-intro-watch jwt"], d)
    ck("clean run: practice runs until the year is learned, every one ?dry=1", len(M.get("posts", [])) == 3 and all("?dry=1" in x for x in M["posts"]) and "practice run 3: the whole year of visits is learned" in o, (M.get("posts"), o))
    ck("clean run: the practice list is shown", "1 would get a profile, 1 card(s)" in o and "Would send: Sarah T. to Dorothy Ray's family (Linda Ray)" in o and "Would make a card: Profile not ready: Jordan M. for Walt Green" in o, o)
    ck("clean run: nothing else was called", not M.get("other"), M.get("other"))
    c, o, d = go(seq=[LEARN], no_node=True)
    ck("never finishes learning: said loudly, NOT COMPLETE", c == 1 and "still isn't learned after 4 practice runs" in o and "NOT COMPLETE" in o and len(M["posts"]) == 4, o)
    c, o, d = go(seq=[{**DONE, "problems": ["AxisCare's upcoming visits couldn't be read: 500"]}], no_node=True)
    ck("AxisCare unreadable: said loudly, NOT COMPLETE", c == 1 and "couldn't read: AxisCare's upcoming visits couldn't be read: 500" in o and "NOT COMPLETE" in o, o)
    c, o, d = go(seq=[{**DONE, "sent": 2}], no_node=True)
    ck("if a run ever said it sent something: NOT COMPLETE", c == 1 and "NOT COMPLETE" in o, o)
    c, o, d = go(shas={**SHAS, "_shared/profile-intro.ts": "0" * 64}, no_node=True)
    ck("not the reviewed build: stops before anything changes", c == 2 and not d and "not the reviewed build" in o and not M.get("posts"), o)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
ok = sum(1 for r in res if r[1])
for n, g, note in res: print(("  ✓ " if g else "  ✗ ") + n + ("" if g else "\n      " + note))
print(f"\n{ok}/{len(res)} passed"); raise SystemExit(0 if ok == len(res) else 1)
