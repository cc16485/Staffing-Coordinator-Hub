#!/usr/bin/env python3
# Rehearsal of 1098 (caregiver_preview_1098.py) against a FAKE Supabase (management API, functions, SQL) and a FAKE supabase CLI, from
# a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.  python3 caregiver_preview_1098_test.py
# (SB_HUB_REPO = a care-coordinator-hub clone with origin/main, for match-rules.js; default ../cc-hub-cara-p1)
import json, os, subprocess, tempfile, threading, http.server, hashlib, re, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
HUBREPO = os.environ.get("SB_HUB_REPO", os.path.join(HERE, "..", "cc-hub-cara-p1"))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[-1500:]))
M = {}
FNS = ["coverage-run", "coverage-assign", "callin-alert", "shift-offer", "family-offer", "family-gateway", "pilot-readiness"]
ALLF = FNS + ["caregiver-preview"]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if "/api-keys" in self.path: return self._send(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJservice"}])
        m = re.match(r"/v1/projects/\w+/functions/([a-z-]+)$", self.path)
        if m and m.group(1) == "pilot-readiness" and M.get("pr_missing"): return self._send(404, {})
        if m and m.group(1) in FNS: return self._send(200, {"version": 7, "verify_jwt": m.group(1) not in ("callin-alert", "shift-offer", "family-gateway")})
        if m and m.group(1) == "caregiver-preview": return self._send(200, {"version": 1, "verify_jwt": True})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_DELETE(self):
        M.setdefault("deleted", []).append(self.path); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/shift-offer"): return self._send(403, {"error": "no"})
        if p.startswith("/functions/v1/"):
            return self._send(401, {"error": "not allowed"})
        q = body["query"]
        if "key = 'ops_settings'" in q:
            n_ = M.setdefault("reads", 0); M["reads"] = n_ + 1
            st = dict(M.get("settings", {"cara_list_live": True, "cara_today_live": True}))
            if M.get("flip_after") and n_ >= 1: st["caregiver_preview_live"] = True
            return self._send(200, [{"data": st}])
        if "create table if not exists public.client_caregiver_profile" in q: M["ddl"] = True; return self._send(400, {"message": "boom"}) if M.get("ddl_fail") else self._send(201, [])
        if "as open_grants" in q: return self._send(200, [{"rows": M.get("rows", 0), "had": M.get("had", 0), "open_grants": M.get("grants", 0)}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1098-"); WT = os.path.join(TMP, "wt")
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
FILES = [f + "/index.ts" for f in ALLF] + ["_shared/caregiver-preview.ts", "_shared/cara-skills.ts", "_shared/family-offer-db.ts"]
SHAS = {k: sha(os.path.join(WT, "supabase/functions", k)) for k in FILES}
def go(**m):
    M.clear(); M.update(m)
    if os.path.exists(DEPLOYS): os.remove(DEPLOYS)
    rep = os.path.join(TMP, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="1098", SB_TOKEN="sbp_fake", SB_REPORT=rep, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(m.get("shas", SHAS)), SB_MAIN_REF="HEAD", SB_SETTLE="0", SB_HUB_REPO=HUBREPO,
               SB_NODE="none" if m.get("no_node") else (shutil.which("node") or ""))
    p = subprocess.run(["python3", os.path.join(WT, "caregiver_preview_1098.py")], cwd=WT, env=env, capture_output=True, text=True)
    dep = open(DEPLOYS).read().split() if os.path.exists(DEPLOYS) else []
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), dep
try:
    c, o, d = go()
    ck("clean run: DONE, exit 0", c == 0 and "1098: DONE" in o, o)
    ck("clean run: the tests ran (fake data only)", "the Caregiver Preview, shift page, Booking App and coverage tests pass" in o, o)
    ck("clean run: the Cara switches that are on are left exactly as they are (and said)", "Cara switches on now (left exactly as they are): cara_list_live, cara_today_live" in o and "the Cara switches are as they were" in o, o)
    ck("clean run: the database step ran and was checked (record there, no browser access, carried across)", M.get("ddl") and "the Caregiver Preview record is there, no browser access; 0 Family Circle entries carried across" in o, o)
    ck("clean run: the seven readers re-deployed with their gateway settings kept; the new caregiver-preview with the sign-in check on", sorted(d) == sorted(ALLF) and "shift-offer is live as version 7, gateway sign-in check off (kept)" in o and "caregiver-preview deployed: version 1, gateway sign-in check on" in o, [d, o])
    ck("clean run: no sign-in = nothing; a made-up shift link still refused", "caregiver-preview: needs a Hub sign-in (401)" in o and "a made-up link is still refused (403)" in o, o)
    c, o, d = go(pr_missing=True, no_node=True)
    ck("pilot-readiness not installed live (as on 10-24): left alone, the rest goes ahead, DONE", c == 0 and "1098: DONE" in o and "pilot-readiness is not installed live, so it is left alone" in o and "pilot-readiness" not in d and "caregiver-preview" in d, [d, o])
    c, o, d = go(rows=1, had=1, no_node=True)
    ck("existing Family Circle entries: counted as carried across", c == 0 and "1 Family Circle entry carried across" in o, o)
    c, o, d = go(settings={"caregiver_preview_live": True}, no_node=True)
    ck("the Caregiver Preview switch already on: stops before anything changes", c == 2 and not d and not M.get("ddl") and "already on" in o, [d, o])
    c, o, d = go(ddl_fail=True, no_node=True)
    ck("the database step fails: stops, no function deployed", c != 0 and not d and "the database step failed" in o, [d, o])
    c, o, d = go(grants=2, no_node=True)
    ck("the record open to browsers, or fewer rows than Family Circles had: said loudly, not DONE", c == 1 and "database check failed" in o and "NOT COMPLETE" in o, o)
    c, o, d = go(flip_after=True, no_node=True)
    ck("a switch changed during the step: said loudly, not DONE", c == 1 and "a switch changed during the step" in o, o)
    c, o, d = go(shas={**SHAS, "caregiver-preview/index.ts": "0" * 64}, no_node=True)
    ck("not the reviewed build: stops before anything changes", c == 2 and not d and not M.get("ddl") and "not the reviewed build" in o, o)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
ok = sum(1 for r in res if r[1])
for n, g, note in res: print(("  ✓ " if g else "  ✗ ") + n + ("" if g else "\n      " + note))
print(f"\n{ok}/{len(res)} passed"); raise SystemExit(0 if ok == len(res) else 1)
