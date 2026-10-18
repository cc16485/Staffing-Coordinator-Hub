#!/usr/bin/env python3
# Rehearsal of 913 (tc5_probe_913.py): a FAKE management API, a FAKE supabase CLI and a FAKE probe endpoint. Never touches
# GitHub, Supabase or AxisCare. Runs from a fresh copy of this folder's committed build.   python3 tc5_probe_913_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1400]))
TMP = tempfile.mkdtemp(prefix="t913-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN); COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
HEAD = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions")
SHAS = {"axiscare-tc5-probe/index.ts": hashlib.sha256(open(os.path.join(FNROOT, "axiscare-tc5-probe/index.ts"), "rb").read()).hexdigest()}
M = {}; CALLS = []
GOOD = {"plan": {"day": "Monday", "start": "2026-11-23", "end": "2026-11-29", "service_code": "PP-PC"}, "placeholder": {"id": 50}}
DONE = {"open_shift": {"accepted_without_caregiver": True, "create": {"status": 201}, "readback_schedule": {"found": 1}, "readback_visits": {"found": 1, "unassigned": 1}, "clean": True, "created_ids": ["700"]},
        "preferred": {"preferredCaregiver": {"status": 400, "took": False, "errors": ["unknown"]}, "referredCaregiver": {"status": 200, "took": True}, "works_with": "referredCaregiver", "restore": {"restored": True}}}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        CALLS.append(("GET", self.path))
        if "/api-keys" in self.path: return self._send(200, [{"name": "service_role", "api_key": "eyJsvc"}, {"name": "anon", "api_key": "eyJanon"}])
        if re.match(r"/v1/projects/\w+/functions/[\w-]+$", self.path): return self._send(200, {"verify_jwt": True, "version": 1})
        self._send(404, {})
    def do_PATCH(self): CALLS.append(("PATCH", self.path)); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"null"); CALLS.append(("POST", self.path, b, self.headers.get("Authorization")))
        if self.path.endswith("/functions/v1/axiscare-tc5-probe"):
            if M.get("refuse"): return self._send(409, {"client": {"name": "Someone Real"}, "refused": "not test client 5"})
            if b.get("go"): return self._send(200, dict(GOOD, **M.get("result", DONE)))
            return self._send(200, dict(GOOD, would="..."))
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
open(os.path.join(BIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil, json
a = sys.argv[1:]; M = json.load(open({os.path.join(TMP, 'mode.json')!r}))
if os.environ.get('SUPABASE_ACCESS_TOKEN') != 'sbp_test': sys.exit(1)
if a[:2] == ['functions', 'deploy']:
    if M.get('fail_deploy'): sys.exit(1)
    open({os.path.join(TMP, 'deploys')!r}, 'a').write(a[2] + '\\n'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree({FNROOT!r}, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(BIN, "supabase"), 0o755)
def run(shas=SHAS, main=HEAD, **mode):
    M.clear(); M.update(mode); CALLS.clear(); open(os.path.join(TMP, "mode.json"), "w").write(json.dumps(M))
    dp = os.path.join(TMP, "deploys")
    if os.path.exists(dp): os.remove(dp)
    rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="913", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_MAIN_REF=main, SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas))
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "tc5_probe_913.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), (open(dp).read().split() if os.path.exists(dp) else [])
probe_calls = lambda: [c for c in CALLS if c[0] == "POST" and c[1].endswith("axiscare-tc5-probe")]
c, out, dep = run()
ck("1 good run: deployed, looked first (go false), then ran (go true), both answers reported in words, DONE", c == 0 and dep == ["axiscare-tc5-probe"] and [x[2].get("go") for x in probe_calls()] == [False, True]
   and "ACCEPTED a schedule with no caregiver" in out and "1 of them with no caregiver" in out and "nothing left on Test Client 5" in out and "set with referredCaregiver" in out and "put back" in out and "RESULT: DONE." in out, out)
ck("2 the probe is called with the service key only (owner script)", all(x[3] == "Bearer eyJsvc" for x in probe_calls()))
ck("3 the key never appears in the report", "eyJsvc" not in out)
c, out, dep = run(result={"open_shift": {"accepted_without_caregiver": False, "create": {"status": 400, "errors": ["caregiverId is required"]}}, "preferred": {"skipped": "no placeholder"}})
ck("4 AxisCare refuses open shifts: said plainly, with what the Hub will do instead", c == 0 and "REFUSED a schedule with no caregiver" in out and "list them for the coordinator" in out and "DONE WITH NOTES" in out, out)
c, out, dep = run(result={"open_shift": dict(DONE["open_shift"], clean=False, after_cleanup={"schedules_left": 1, "visits_left": 1}), "preferred": dict(DONE["preferred"], restore={"restored": False, "status": 400})})
ck("5 cleanup or restore didn't finish: loud, with exactly what to remove in AxisCare", "cleanup did NOT finish" in out and "remove Test Client 5's 9-11am schedule" in out and "NOT put back" in out and "DONE WITH NOTES" in out, out)
c, out, dep = run(refuse=True)
ck("6 client 290 isn't Test Client 5 any more: stops, nothing tried", c != 0 and "nothing was tried" in out and len(probe_calls()) == 1, out)
c, out, dep = run(shas={"axiscare-tc5-probe/index.ts": "0" * 64})
ck("7 a build that isn't the reviewed one stops before anything", c != 0 and not dep and not probe_calls(), out)
c, out, dep = run(main=HEAD + "~1")
ck("8 not merged yet: stops before anything", c != 0 and "isn't the same as GitHub's main" in out and not dep, out)
c, out, dep = run(fail_deploy=True)
ck("9 the deploy fails: nothing touched AxisCare", c != 0 and not probe_calls() and "nothing touched AxisCare" in out, out)
src = open(os.path.join(HERE, "tc5_probe_913.py")).read()
ck("10 no em dash in what the step says", not re.search(r"—", "\n".join(l for l in src.split("\n") if "say(" in l or "bad(" in l or "stop(" in l)))
for n, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n + ("\n      " + note if note else ""))
print(f"{sum(1 for r in res if r[1])}/{len(res)} passed"); raise SystemExit(0 if all(r[1] for r in res) else 1)
