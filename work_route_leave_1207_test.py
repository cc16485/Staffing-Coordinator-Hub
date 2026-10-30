#!/usr/bin/env python3
# Rehearsal of 1207 (work_route_leave_1207.py: work-route respects Leave with) against a FAKE Supabase and a FAKE supabase CLI,
# from a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.
#   python3 work_route_leave_1207_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_SHA = subprocess.run(["git", "-C", HERE, "merge-base", "HEAD", "origin/main"], capture_output=True, text=True).stdout.strip()   # main before this change
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; M = {}
TMP = tempfile.mkdtemp(prefix="t1207-")
flag = lambda n: os.path.exists(os.path.join(TMP, n))
def reset(**m):
    S.clear(); S.update(sql=[], wrote=False); M.clear(); M.update(dict(gate=401, hb_ok="true", hb_fresh=True, settings={"escalated_simple_live": False, "routing_live": True}), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if "/api-keys" in self.path: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if re.match(r"/v1/projects/\w+/functions/work-route$", self.path): return self._send(200, {"version": 12, "verify_jwt": True})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"): return self._send(M["gate"], {"error": "not allowed"})
        q = body["query"]; S["sql"].append(q)
        if q.startswith("select data from public.app_data where key = 'ops_settings'"): return self._send(200, [{"data": M["settings"]}])
        if "automation_heartbeats" in q:
            at = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=5 if M["hb_fresh"] else -3600)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
            return self._send(200, [{"ok": M["hb_ok"], "at": at}])
        S["wrote"] = True
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
WT = os.path.join(TMP, "wt"); BASEWT = os.path.join(TMP, "base")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", BASEWT, BASE_SHA], check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n'); T = {TMP!r}
if a[:2] == ['functions', 'deploy']: open(os.path.join(T, 'deployed'), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    src = {WT!r} if (os.path.exists(os.path.join(T, 'deployed')) or os.path.exists(os.path.join(T, 'already'))) else {BASEWT!r}
    shutil.copytree(os.path.join(src, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True)
    if os.path.exists(os.path.join(T, 'drift')): open(os.path.join(os.getcwd(), 'supabase', 'functions', 'work-route', 'index.ts'), 'a').write('// someone else')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = {"work-route": sha(os.path.join(WT, "supabase/functions/work-route/index.ts"))}
def run(env_over=None, already=False, drift=False, tests=False, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    for f in (LOG, rep, os.path.join(TMP, "deployed")): os.path.exists(f) and os.remove(f)
    for fl, on in (("already", already), ("drift", drift)):
        fp = os.path.join(TMP, fl); (open(fp, "w").write("x") if on else (os.path.exists(fp) and os.remove(fp)))
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_REPO=WT, SB_BASE=BASE_SHA, SB_SHAS=json.dumps(PIN), SB_SETTLE="0", SB_POLL="0.05", SB_POLL_MAX="0.3", SB_NODE="" if tests else "none")
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "work_route_leave_1207.py")], env=env, capture_output=True, text=True, timeout=900)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
try:
    c, out = run(tests=True)
    ck("clean run (tests included): exit 0, RESULT: DONE", c == 0 and "RESULT: DONE" in out and "duty_phase3_test.mjs: 52/52" in out, out[-1800:])
    ck("deploys work-route only, gateway check kept on", deploys() == ["work-route"] and "--no-verify-jwt" not in cli(), cli())
    ck("Part 1 says both switches and that it changes neither", "Escalated to you, made simple: OFF · routing: ON (this step changes neither)" in out, out[:1500])
    ck("proof: live copy matches, public key refused, ran on its own and OK, switches as before", "the live copy is exactly the reviewed build" in out and "refuses the public key (401)" in out
       and "ran on its own after the deploy and reports OK" in out and "every switch is exactly as it was" in out, out[-1200:])
    ck("no database write, no setting written", not S["wrote"])
    ck("no key, token or email in the report; no em dash", not re.search(r"eyJ\w|sbp_\w|@mo-care", out) and "—" not in out, out)
    c, out = run(already=True)
    ck("run again: nothing deployed again, still DONE", c == 0 and not deploys() and "already this build" in out, out[-800:])
    c, out = run(drift=True)
    ck("work-route live with a change not from GitHub: STOPS before any change", c == 3 and not deploys(), out[-500:])
    c, out = run(env_over={"SB_SHAS": json.dumps({"work-route": "0" * 64})})
    ck("not the reviewed build: nothing runs", c == 2 and not deploys() and not S["sql"], out[-400:])
    c, out = run(gate=200)
    ck("work-route answering the public key is caught", c == 8 and "CHECK THE" in out, out[-500:])
    c, out = run(hb_ok="false")
    ck("a run that is not OK is caught", c == 8 and "✗ work-route ran on its own" in out, out[-500:])
    c, out = run(hb_fresh=False)
    ck("no run after the deploy is caught", c == 8 and "✗ work-route ran on its own" in out, out[-500:])
finally:
    for w in (WT, BASEWT): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w])
    shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
