#!/usr/bin/env python3
# Rehearsal of 770 (lead_readiness_770.py) against a FAKE Supabase (management API, database, functions) and a FAKE supabase
# CLI, from a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.
#   python3 lead_record_769_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_SHA = subprocess.run(["git", "-C", HERE, "rev-parse", "68fb677"], capture_output=True, text=True).stdout.strip()   # origin/main before 770
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; M = {}
def reset(**m):
    S.clear(); S.update(sql=[], posts=[]); M.clear()
    M.update(dict(secrets=["ANTHROPIC_API_KEY", "HUB_JOB_SECRET"], vault=1, gate=401, cron_ok=True, dry=200, sql_fail=False, deployed=False), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if p.endswith("/secrets"): return self._send(200, [{"name": n} for n in M["secrets"]])
        if m := re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p):
            if m.group(1) == "lead-readiness" and not (M["deployed"] or os.path.exists(os.path.join(TMP, "already"))): return self._send(404, {})
            return self._send(200, {"version": 1, "verify_jwt": True})
        if p.startswith("/rest/v1/lead_readiness"): return self._send(401, {"message": "no"})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"):
            S["posts"].append((p, self.headers.get("Authorization"), body))
            if "auth_check" in p: return self._send(M["gate"], {"error": "not allowed"})
            if p.rstrip("/").endswith("/lead-readiness"):
                if self.headers.get("Authorization") != "Bearer eyJsvcKEY": return self._send(401, {})
                return self._send(M["dry"], {"ok": True, "open": 31, "read": 8, "errors": 0} if M["dry"] == 200 else {"error": "boom"})
            return self._send(404, {})
        q = body["query"]; S["sql"].append(q)
        if q.startswith("with l as"):
            return self._send(200, [{"open_leads": 31, "vault": M["vault"]}])
        if q.startswith("begin;"):
            if M["sql_fail"]: return self._send(400, {"message": "syntax error"})
            return self._send(200, [])
        if "cron.unschedule" in q: return self._send(200, [])
        if "cron.schedule(" in q: S["cron"] = q; return self._send(200, [{"id": 7}])
        if q.startswith("select schedule, command from cron.job"): return self._send(200, [{"schedule": "7-59/15 * * * *", "command": S.get("cron", "") if M["cron_ok"] else "x"}])
        if "net.http_post" in q: return self._send(200, [{"id": 55}])
        if "net._http_response" in q: return self._send(200, [{"status_code": 200, "content": json.dumps({"ok": True, "caller": "cron"})}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t770-")
WT = os.path.join(TMP, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil, urllib.request
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']: open(os.path.join({TMP!r}, 'deployed'), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    if os.path.exists(os.path.join({TMP!r}, 'deployed')) or os.path.exists(os.path.join({TMP!r}, 'already')):
        shutil.copytree(os.path.join({WT!r}, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True)
        if os.path.exists(os.path.join({TMP!r}, 'drift')): open(os.path.join(os.getcwd(), 'supabase', 'functions', 'lead-readiness', 'index.ts'), 'a').write('// someone else')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = {"lead-readiness": sha(os.path.join(WT, "supabase/functions/lead-readiness/index.ts")), "_shared/lead-readiness": sha(os.path.join(WT, "supabase/functions/_shared/lead-readiness.ts"))}
SQLSHA = sha(os.path.join(WT, "lead_readiness_770.sql"))
def run(env_over=None, already=False, drift=False, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    for f in (LOG, rep, os.path.join(TMP, "deployed")): os.path.exists(f) and os.remove(f)
    for flag, on in (("already", already), ("drift", drift)):
        fp = os.path.join(TMP, flag); (open(fp, "w").write("x") if on else (os.path.exists(fp) and os.remove(fp)))
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_REPO=WT, SB_BASE=BASE_SHA, SB_SHAS=json.dumps(PIN), SB_SQL_SHA=SQLSHA, SB_SETTLE="0", SB_POLL="0.05")
    env.update(env_over or {})
    # the fake API learns the function exists once the fake CLI deploys it
    import time
    stop = [False]
    def watch():
        while not stop[0]:
            if os.path.exists(os.path.join(TMP, "deployed")): M["deployed"] = True
            time.sleep(0.02)
    w = threading.Thread(target=watch, daemon=True); w.start()
    p = subprocess.run(["python3", os.path.join(WT, "lead_readiness_770.py")], env=env, capture_output=True, text=True, timeout=600)
    stop[0] = True
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
changes = lambda: [q for q in S["sql"] if not q.lstrip().lower().startswith(("with", "select schedule", "select status_code"))]
try:
    c, out = run()
    ck("clean run from a fresh copy: exit 0, RESULT: DONE", c == 0 and "RESULT: DONE" in out, out[-1800:])
    ck("the tests run in Part 1 (from the fresh copy)", "lead_readiness_test.mjs: 13/13 passed" in out and ("lead_readiness_770_test.mjs: 8/8 passed" in out or "was not re-run" in out), out[:1500])
    ck("Part 1 says the counts only", "31 open families to read" in out, out[:1500])
    ck("deploys lead-readiness (new) with the gateway sign-in check on", deploys() == ["lead-readiness"] and "--no-verify-jwt" not in cli(), cli())
    ck("the database change runs as one all-or-nothing statement", any(q.startswith("begin;") and q.rstrip().endswith("commit;") and "lead_readiness" in q for q in S["sql"]))
    ck("scheduled every 15 minutes with the vault secret", "7-59/15 * * * *" in S.get("cron", "") and "hub_job_secret" in S.get("cron", "") and "every 15 minutes" in out)
    ck("proof: refuses the public key, the schedule gets in, a first run with counts", "refuses the public key (401)" in out and "its schedule gets in" in out and "31 open famil(ies), 8 read now" in out, out[-1500:])
    ck("proof: the public can't read the readings", "the public can't read the readings (401)" in out, out[-900:])
    ck("no key, token or email in the report", not re.search(r"eyJ\w|sbp_\w|@mo-care", out), out)
    c, out = run(already=True)
    ck("run again: nothing deployed again, still DONE", c == 0 and not deploys() and "already this build" in out and "RESULT: DONE" in out, out[-900:])
    c, out = run(already=True, drift=True)
    ck("lead-readiness live with a change not from GitHub: STOPS before any change", c == 3 and not deploys() and not changes(), out[-600:])
    c, out = run(env_over={"SB_SHAS": json.dumps(dict(PIN, **{"lead-readiness": "0" * 64}))})
    ck("not the reviewed build: nothing runs", c == 2 and not deploys() and not S["sql"], out[-400:])
    c, out = run(env_over={"SB_SQL_SHA": "0" * 64})
    ck("database change not the reviewed build: nothing runs", c == 2 and not S["sql"], out[-400:])
    c, out = run(secrets=["HUB_JOB_SECRET"])
    ck("no AI key: stops before any change", c == 4 and not deploys() and not changes(), out[-400:])
    c, out = run(vault=0)
    ck("no jobs' secret in the vault: stops before any change", c == 4 and not deploys() and not changes(), out[-400:])
    c, out = run(sql_fail=True)
    ck("the database change fails: stops, nothing deployed, nothing scheduled", c == 6 and not deploys() and not S.get("cron"), out[-400:])
    c, out = run(gate=200)
    ck("the reader answering the public key is caught", c == 8 and "PARTLY DONE" in out, out[-600:])
    c, out = run(dry=500)
    ck("a first run that fails is caught", c == 8 and "first run didn't answer" in out, out[-600:])
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
