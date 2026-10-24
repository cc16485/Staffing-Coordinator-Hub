#!/usr/bin/env python3
# Rehearsal of 1096 (cara_board_1096.py) against a FAKE Supabase (management API, functions, SQL) and a FAKE supabase CLI, from
# a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.  python3 cara_p1_1093_test.py
# (SB_HUB_REPO = a care-coordinator-hub clone with origin/main, for match-rules.js; default ../cc-hub-cara-p1)
import json, os, subprocess, tempfile, threading, http.server, hashlib, re, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
HUBREPO = os.environ.get("SB_HUB_REPO", os.path.join(HERE, "..", "cc-hub-cara-p1"))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[-1500:]))
M = {}
FNS = ["coverage-run", "coverage-assign", "callin-alert", "family-app-office"]
ALLF = FNS + ["shift-offer"]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if "/api-keys" in self.path: return self._send(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJservice"}])
        m = re.match(r"/v1/projects/\w+/functions/([a-z-]+)$", self.path)
        if m and m.group(1) in FNS: return self._send(200, {"version": 7, "verify_jwt": m.group(1) != "callin-alert"})
        if m and m.group(1) == "shift-offer": return self._send(200, {"version": 1, "verify_jwt": False})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_DELETE(self):
        M.setdefault("deleted", []).append(self.path); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/shift-offer"):
            return self._send(401 if body.get("action") == "preview" else 403, {"error": "no"})
        if p.startswith("/functions/v1/"):
            return self._send(401, {"error": "not allowed"})
        q = body["query"]
        if "key = 'ops_settings'" in q: return self._send(200, [{"data": M.get("settings", {"coverage_flag_live": True})}])
        if "create table if not exists public.shift_offer_codes" in q: M["ddl"] = True; return self._send(400, {"message": "boom"}) if M.get("ddl_fail") else self._send(201, [])
        if "relrowsecurity" in q: return self._send(200, [{"rls": True, "enjoys": 1, "anon_read": M.get("anon_read", False), "auth_read": False}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1096-"); WT = os.path.join(TMP, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); DEPLOYS = os.path.join(TMP, "deploys")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]
if a[:2] == ['functions', 'deploy']: open({DEPLOYS!r}, 'a').write(a[2] + '\\n'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree(os.path.join({WT!r}, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
FILES = [f + "/index.ts" for f in ALLF] + ["_shared/cara-list.ts", "_shared/cara-skills.ts", "_shared/shift-offer.ts", "_shared/shift-links.ts", "_shared/coverage-fill.ts", "_shared/family-app-office.ts"]
SHAS = {k: sha(os.path.join(WT, "supabase/functions", k)) for k in FILES}
def go(**m):
    M.clear(); M.update(m)
    if os.path.exists(DEPLOYS): os.remove(DEPLOYS)
    rep = os.path.join(TMP, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="1096", SB_TOKEN="sbp_fake", SB_REPORT=rep, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(m.get("shas", SHAS)), SB_MAIN_REF="HEAD", SB_SETTLE="0", SB_HUB_REPO=HUBREPO,
               SB_NODE="none" if m.get("no_node") else (shutil.which("node") or ""))
    p = subprocess.run(["python3", os.path.join(WT, "cara_board_1096.py")], cwd=WT, env=env, capture_output=True, text=True)
    dep = open(DEPLOYS).read().split() if os.path.exists(DEPLOYS) else []
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), dep
try:
    c, o, d = go()
    ck("clean run: DONE, exit 0", c == 0 and "1096: DONE" in o, o)
    ck("clean run: the tests ran (fake data only)", "the board, shift page and coverage tests pass" in o, o)
    ck("clean run: the database step ran and was checked (server only, the What they enjoy column)", M.get("ddl") and "server only (no anonymous or signed-in reading)" in o, o)
    ck("clean run: the four functions deployed with their gateway settings kept, and the new shift-offer with its check off", sorted(d) == sorted(ALLF) and "callin-alert is live as version 7, gateway sign-in check off (kept)" in o and "shift-offer deployed: version 1, gateway sign-in check off" in o, [d, o])
    ck("clean run: every switch off before and after, including the two new ones", "every Cara switch is off" in o and "cara_board_live, shift_page_live" in o and "still off" in o, o)
    ck("clean run: a made-up link refused, the preview needs a sign-in", "a made-up link is refused (403)" in o and "the office preview needs a Hub sign-in (401)" in o, o)
    c, o, d = go(settings={"shift_page_live": True}, no_node=True)
    ck("the shift page switch already on: stops before anything changes", c == 2 and not d and not M.get("ddl") and "already on (shift_page_live)" in o, [d, o])
    c, o, d = go(ddl_fail=True, no_node=True)
    ck("the database step fails: stops, no function deployed", c != 0 and not d and "the database step failed" in o, [d, o])
    c, o, d = go(anon_read=True, no_node=True)
    ck("the code table readable by the public: said loudly, not DONE", c == 1 and "database check failed" in o and "NOT COMPLETE" in o, o)
    c, o, d = go(shas={**SHAS, "shift-offer/index.ts": "0" * 64}, no_node=True)
    ck("not the reviewed build: stops before anything changes", c == 2 and not d and not M.get("ddl") and "not the reviewed build" in o, o)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
ok = sum(1 for r in res if r[1])
for n, g, note in res: print(("  ✓ " if g else "  ✗ ") + n + ("" if g else "\n      " + note))
print(f"\n{ok}/{len(res)} passed"); raise SystemExit(0 if ok == len(res) else 1)
