#!/usr/bin/env python3
# Rehearsal of 1094 (cara_p1b_1094.py) against a FAKE Supabase (management API, functions, SQL) and a FAKE supabase CLI, from
# a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.  python3 cara_p1_1093_test.py
# (SB_HUB_REPO = a care-coordinator-hub clone with origin/main, for match-rules.js; default ../cc-hub-cara-p1)
import json, os, subprocess, tempfile, threading, http.server, hashlib, re, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
HUBREPO = os.environ.get("SB_HUB_REPO", os.path.join(HERE, "..", "cc-hub-cara-p1"))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[-1500:]))
M = {}
FNS = ["coverage-run", "coverage-reply", "coverage-watch", "call-disposition", "match-dark"]   # the fake serves all five
DEP = ["coverage-run"]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if "/api-keys" in self.path: return self._send(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJservice"}])
        m = re.match(r"/v1/projects/\w+/functions/([a-z-]+)$", self.path)
        if m and m.group(1) in FNS: return self._send(200, {"version": 7, "verify_jwt": m.group(1) != "coverage-watch"})
        if m and m.group(1) == "shift-confirm" and M.get("sc_live"): return self._send(200, {"version": 1, "verify_jwt": True})
        if self.path.startswith("/functions/v1/match-dark") and self.headers.get("Authorization") == "Bearer eyJservice": return self._send(200, [])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_DELETE(self):
        M.setdefault("deleted", []).append(self.path); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"):
            if self.headers.get("Authorization") == "Bearer eyJservice" and "auth_check=1" in p: return self._send(200, {"ok": True, "caller": "owner"})
            return self._send(401, {"error": "not allowed"})
        q = body["query"]
        if "key = 'ops_settings'" in q: return self._send(200, [{"data": M.get("settings", {"coverage_flag_live": True})}])
        if "cron.job" in q: return self._send(200, [{"jobname": "shift-confirm-daily"}] if M.get("sc_cron") else [])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1094-"); WT = os.path.join(TMP, "wt")
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
FILES = [f + "/index.ts" for f in DEP] + ["_shared/cara-list.ts", "_shared/cara-skills.ts", "_shared/cara-urgency.ts", "_shared/cara-visit-match.ts", "_shared/cara-reply.ts", "_shared/match-dark.ts"]
SHAS = {k: sha(os.path.join(WT, "supabase/functions", k)) for k in FILES}
def go(**m):
    M.clear(); M.update(m)
    if os.path.exists(DEPLOYS): os.remove(DEPLOYS)
    rep = os.path.join(TMP, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="1094", SB_TOKEN="sbp_fake", SB_REPORT=rep, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(m.get("shas", SHAS)), SB_MAIN_REF="HEAD", SB_SETTLE="0", SB_HUB_REPO=HUBREPO,
               SB_NODE="none" if m.get("no_node") else (shutil.which("node") or ""))
    p = subprocess.run(["python3", os.path.join(WT, "cara_p1b_1094.py")], cwd=WT, env=env, capture_output=True, text=True)
    dep = open(DEPLOYS).read().split() if os.path.exists(DEPLOYS) else []
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), dep
try:
    c, o, d = go()
    ck("clean run: DONE, exit 0", c == 0 and "1094: DONE" in o, o)
    ck("clean run: the tests ran (fake data only)", "Cara Phase 1 tests and the coverage tests pass" in o, o)
    ck("clean run: only coverage-run deployed, gateway setting kept", d == ["coverage-run"] and "coverage-run is live as version 7, gateway sign-in check on (kept)" in o, [d, o])
    ck("clean run: every switch off before and after; nothing touched them", "every Cara Phase 1 switch is off" in o and "still all off" in o, o)
    ck("clean run: strangers refused, the server key let in", all(f"{f}: a caller with no key gets nothing (401)" in o for f in DEP) and "coverage-run: the server key is let in" in o, o)
    ck("clean run: shift-confirm never live = nothing removed", "shift-confirm was never live" in o and not M.get("deleted"), o)
    c, o, d = go(sc_live=True, no_node=True)
    ck("shift-confirm live and nothing schedules it: removed (retired)", c == 0 and any(x.endswith("/functions/shift-confirm") for x in M.get("deleted", [])) and "shift-confirm removed" in o, [M.get("deleted"), o])
    c, o, d = go(sc_live=True, sc_cron=True, no_node=True)
    ck("shift-confirm live AND scheduled: left alone, said so, not DONE", c == 1 and not M.get("deleted") and "a schedule calls it (shift-confirm-daily)" in o and "NOT COMPLETE" in o, o)
    c, o, d = go(settings={"cara_today_live": True}, no_node=True)
    ck("a Cara switch already on: stops before anything changes", c == 2 and not d and "already on (cara_today_live)" in o, [d, o])
    c, o, d = go(shas={**SHAS, "coverage-run/index.ts": "0" * 64}, no_node=True)
    ck("not the reviewed build: stops before anything changes", c == 2 and not d and "not the reviewed build" in o, o)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
ok = sum(1 for r in res if r[1])
for n, g, note in res: print(("  ✓ " if g else "  ✗ ") + n + ("" if g else "\n      " + note))
print(f"\n{ok}/{len(res)} passed"); raise SystemExit(0 if ok == len(res) else 1)
