#!/usr/bin/env python3
# Rehearsal of 723 (axis_follow_723.py) against a FAKE Supabase (management API, functions) and a FAKE supabase CLI.
# Never touches a real project.   python3 availability_720_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; M = {}
def reset(**m):
    S.clear(); S.update(sql=[], posts=[]); M.clear()
    M.update(dict(vault=1, preview_v=3, approved=True, anon_ok=False, cron_ok=True, vj={"roster-axis-follow": True}, sqlfail=False, priv=False, live_sw=False), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if m := re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p):
            fn = m.group(1)
            return self._send(200, {"version": 7, "verify_jwt": M["vj"].get(fn, True)})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"):
            S["posts"].append((p, self.headers.get("Authorization"), body))
            if p.startswith("/functions/v1/team-ask") or p.startswith("/functions/v1/hire-profile"): return self._send(401, {"error": "sign in"})
            if p.startswith("/functions/v1/roster-axis-follow"):
                if "auth_check" in p: return self._send(200 if M["anon_ok"] else 401, {"error": "not allowed"})
                return self._send(200, {"ok": True, "mode": "practice", "changes": 27, "to_inactive": 26, "to_active": 1, "not_in_axiscare": 2, "no_number": 3})
            if p.startswith("/functions/v1/onboard-goal-watch"):
                if "auth_check" in p: return self._send(200 if M["anon_ok"] else 401, {"error": "not allowed"})
                return self._send(200, {"ok": True, "dry": True, "plans_with_goal": 3, "onboarding": 4, "behind": 1})
            return self._send(404, {})
        q = body["query"]; S["sql"].append(q)
        if "vault.decrypted_secrets where name" in q and "count(*)" in q: return self._send(200, [{"vault": M["vault"]}])
        if q.startswith("begin;") and "caregiver_active_patch" in q: return self._send(400, {"message": "boom"}) if M["sqlfail"] else self._send(201, [])
        if "has_function_privilege" in q: return self._send(200, [{"a": M["priv"], "b": False}])
        if "roster_follow_axis_live" in q: return self._send(200, [{"live": "true" if M["live_sw"] else "off"}])
        if "cron.unschedule" in q: return self._send(200, [])
        if "cron.schedule(" in q: return self._send(200, [{"id": 5}])
        if "from cron.job where jobname" in q: return self._send(200, [{"schedule": "0 8 * * *" if "roster-axis-follow" in q else "0 14 * * 1-5", "command": "select net.http_post(... 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets ...))"}])
        if q.startswith("select net.http_post"): return self._send(200, [{"id": 77}])
        if "net._http_response" in q: return self._send(200, [{"status_code": 200 if M["cron_ok"] else 401, "content": json.dumps({"ok": True, "caller": "cron"} if M["cron_ok"] else {"error": "not allowed"})}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t723-")
BASE = os.path.join(TMP, "base"); os.makedirs(BASE)
subprocess.run(f"git -C {HERE} archive 7efbd65 supabase/functions | tar -x -C {BASE}", shell=True, check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log"); os.makedirs(os.path.join(TMP, "deployed"))
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']: open(os.path.join({TMP!r}, 'deployed', a[2]), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    src = os.path.join({HERE!r}, 'supabase', 'functions') if os.path.exists(os.path.join({TMP!r}, 'deployed', a[2])) else os.path.join({BASE!r}, 'supabase', 'functions')
    if os.path.exists(os.path.join({TMP!r}, 'drift')) and a[2] == 'roster-axis-follow' and not os.path.exists(os.path.join({TMP!r}, 'deployed', a[2])):
        shutil.copytree(src, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True)
        open(os.path.join(os.getcwd(), 'supabase', 'functions', 'roster-axis-follow', 'index.ts'), 'a').write('// someone else')
        sys.exit(0)
    shutil.copytree(src, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
FN = ["roster-axis-follow/index.ts", "_shared/axis-census.ts", "_shared/job-auth.ts", "_shared/events.ts"]
FNSHAS = {f: sha(os.path.join(HERE, "supabase/functions", f)) for f in FN}
def run(env_over=None, drift=False, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    for d in (LOG,): os.path.exists(d) and os.remove(d)
    shutil.rmtree(os.path.join(TMP, "deployed")); os.makedirs(os.path.join(TMP, "deployed"))
    dp = os.path.join(TMP, "drift"); (open(dp, "w").write("x") if drift else (os.path.exists(dp) and os.remove(dp)))
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"),
               SB_FNROOT=os.path.join(HERE, "supabase/functions"), SB_SETTLE="0", SB_FN_SHAS=json.dumps(FNSHAS), PYTHONPATH=HERE)
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(HERE, "axis_follow_723.py")], env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
c, out = run()
ck("clean run: exit 0, RESULT: DONE", c == 0 and "RESULT: DONE" in out, out[-1500:])
ck("deploys roster-axis-follow only; no SQL change, no schedule change", deploys() == ["roster-axis-follow"] and not any(q.startswith("begin;") or "cron.schedule(" in q for q in S["sql"]), [deploys(), S["sql"]])
ck("one practice run (not dry), and the counts are reported", [p for p, _, _ in S["posts"] if "auth_check" not in p] == ["/functions/v1/roster-axis-follow"] and "26 active in the Hub but not in AxisCare" in out, out)
ck("no key or token in the report", not re.search(r"eyJ\w|sbp_\w", out), out)
c, out = run(live_sw=True)
ck("switch already on: no practice run", c == 0 and not [p for p, _, _ in S["posts"] if "auth_check" not in p] and "practice run is skipped" in out, out[-500:])
c, out = run(drift=True)
ck("live with a change not on GitHub: STOPS, nothing deployed", c == 3 and not deploys(), out[-600:])
c, out = run(env_over={"SB_FN_SHAS": json.dumps(dict(FNSHAS, **{"roster-axis-follow/index.ts": "0" * 64}))})
ck("not the reviewed build: nothing runs", c == 2 and not deploys(), out[-400:])
c, out = run(anon_ok=True)
ck("letting the public in: caught", c == 9 and "let the public key in" in out, out[-500:])
shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
