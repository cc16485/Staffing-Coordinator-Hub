#!/usr/bin/env python3
# Rehearsal of 1120 (overlap_1120.py) against a FAKE Supabase (management API, functions, SQL) and a FAKE supabase CLI, from
# a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.  python3 ask_list_1120_test.py
# (SB_HUB_REPO = a care-coordinator-hub clone with origin/main, for match-rules.js; default ../cc-hub-cara-p1)
import json, os, subprocess, tempfile, threading, http.server, hashlib, re, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
HUBREPO = os.environ.get("SB_HUB_REPO", os.path.join(HERE, "..", "cc-hub-cara-p1"))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[-1500:]))
M = {}
FNS = ["coverage-run"]
ALLF = FNS
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if "/api-keys" in self.path: return self._send(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJservice"}])
        m = re.match(r"/v1/projects/\w+/functions/([a-z-]+)$", self.path)
        if m and m.group(1) in FNS: return self._send(200, {"version": 7, "verify_jwt": False})
        if m and m.group(1) == "caregiver-preview": return self._send(200, {"version": 1, "verify_jwt": True})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_DELETE(self):
        M.setdefault("deleted", []).append(self.path); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/coverage-run") and self.headers.get("Authorization") == "Bearer eyJservice":
            M.setdefault("probes", []).append(body)
            return self._send(200, {"read_only": True, "read_range": ["a", "b"], "visits_read": 42, "working": [{"name": "Edna Night", "clocked_in_now": True, "conflicts": ["Clocked in now with Dan (scheduled 10pm to 6am)"]}],
                "cases": [{"client": "Dan P", "shift": "2026-10-25 22:00-06:00", "ready": 9, "working_listed_as_do_not_ask": ["Edna Night: Already working then: Clocked in now with Dan"], "working_in_ready": M.get("bad_ready", [])}]})
        if p.startswith("/functions/v1/"):
            return self._send(401, {"error": "not allowed"})
        q = body["query"]
        if "key = 'ops_settings'" in q:
            n_ = M.setdefault("reads", 0); M["reads"] = n_ + 1
            st = dict(M.get("settings", {"cara_list_live": True, "cara_today_live": True}))
            if M.get("flip_after") and n_ >= 1: st["visit_reasons_live"] = True
            return self._send(200, [{"data": st}])
        if "add column if not exists handoff_asked" in q: M["ddl"] = True; return self._send(400, {"message": "boom"}) if M.get("ddl_fail") else self._send(201, [])
        if "as cols" in q: return self._send(200, [{"cols": M.get("cols", 2)}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1120-"); WT = os.path.join(TMP, "wt")
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
FILES = ["coverage-run/index.ts", "_shared/overlap.ts", "_shared/ask-list.ts", "_shared/cara-waves.ts"]
SHAS = {k: sha(os.path.join(WT, "supabase/functions", k)) for k in FILES}
def go(**m):
    M.clear(); M.update(m)
    if os.path.exists(DEPLOYS): os.remove(DEPLOYS)
    rep = os.path.join(TMP, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="1120", SB_TOKEN="sbp_fake", SB_REPORT=rep, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(m.get("shas", SHAS)), SB_MAIN_REF="HEAD", SB_SETTLE="0", SB_HUB_REPO=HUBREPO,
               SB_NODE="none" if m.get("no_node") else (shutil.which("node") or ""))
    p = subprocess.run(["python3", os.path.join(WT, "overlap_1120.py")], cwd=WT, env=env, capture_output=True, text=True)
    dep = open(DEPLOYS).read().split() if os.path.exists(DEPLOYS) else []
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), dep
try:
    c, o, d = go()
    ck("clean run: DONE, exit 0", c == 0 and "1120: DONE" in o, o)
    ck("clean run: coverage-run re-deployed, gateway setting kept, no database change", d == ["coverage-run"] and not M.get("ddl"), [d, o])
    ck("real-system check: two read-only probes (right now, tomorrow 8am to 4pm), nothing sent", len(M.get("probes", [])) == 2 and all(p["action"] == "overlap_probe" for p in M["probes"]) and M["probes"][1]["time"] == "08:00-16:00", M.get("probes"))
    ck("the report names who is working then, with their hours, and that each open shift's Ready list holds none of them", "Edna Night  [CLOCKED IN NOW]: Clocked in now with Dan" in o and "Ready to ask holds nobody working then" in o, o)
    c, o, d = go(bad_ready=["Edna Night"], no_node=True)
    ck("someone working then still on a Ready list: said loudly, not DONE", c == 1 and "still holds people working then: Edna Night" in o, o)
    c, o, d = go(flip_after=True, no_node=True)
    ck("a switch changed during the step: said loudly, not DONE", c == 1 and "a switch changed during the step" in o, o)
    c, o, d = go(shas={**SHAS, "coverage-run/index.ts": "0" * 64}, no_node=True)
    ck("not the reviewed build: stops before anything changes", c == 2 and not d and "not the reviewed build" in o, o)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
ok = sum(1 for r in res if r[1])
for n, g, note in res: print(("  ✓ " if g else "  ✗ ") + n + ("" if g else "\n      " + note))
print(f"\n{ok}/{len(res)} passed"); raise SystemExit(0 if ok == len(res) else 1)
