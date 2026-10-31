#!/usr/bin/env python3
# Rehearsal of 1212 (prn_oncall_weekly_1212.py, every-week on call) against a FAKE Supabase and a FAKE supabase CLI, from a fresh
# worktree of this commit (as the Desktop step runs it). Never touches a real project.
#   python3 prn_oncall_weekly_1212_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; M = {}
def reset(**m):
    S.clear(); S.update(sql=[], posts=[], net={}, nid=0, cron=None); M.clear()
    M.update(dict(signup=None, vault=1, sqlfail=False, fill_ok=True, gate=401, cron_caller="cron"), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p)
        if m: return self._send(200, {"version": 7, "verify_jwt": m.group(1) == "prn-week"})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"):
            S["posts"].append((p, self.headers.get("Authorization"), body))
            return self._send(M["gate"], {"error": "not allowed"})
        q = body["query"]; S["sql"].append(q)
        if q.startswith("select data->'prn_oncall_signup_live'"): return self._send(200, [{"prn_oncall_signup_live": M["signup"], "prn_oncall_first_live": None}])
        if "vault.decrypted_secrets where name = 'hub_job_secret')::int as vault" in q: return self._send(200, [{"vault": M["vault"], "job": 0}])
        if q.startswith("begin;"): return self._send(400, {"message": "boom"}) if M["sqlfail"] else self._send(201, [])
        if q.startswith("select cron.unschedule"): return self._send(201, [])
        if q.startswith("select cron.schedule("):
            S["cron"] = re.match(r"select cron.schedule\('prn-oncall-fill', '([^']+)', '(.*)'\) as id$", q, re.S); return self._send(201, [{"id": 1}])
        if q.startswith("select schedule, command from cron.job"):
            return self._send(200, [{"schedule": S["cron"].group(1), "command": S["cron"].group(2).replace("''", "'")}] if S["cron"] else [])
        if q.startswith("select net.http_post"):
            S["nid"] += 1; S["net"][S["nid"]] = re.search(r"url := '([^']+)'", q).group(1); return self._send(201, [{"id": S["nid"]}])
        if q.startswith("select status_code, content from net._http_response"):
            url = S["net"][int(re.search(r"id = (\d+)", q).group(1))]
            if "auth_check" in url: return self._send(200, [{"status_code": 200, "content": json.dumps({"ok": True, "caller": M["cron_caller"]})}])
            return self._send(200, [{"status_code": 200 if M["fill_ok"] else 500, "content": json.dumps({"caller": "cron", "ok": True, "added": 0, "skipped": 0, "failed": 0} if M["fill_ok"] else {"error": "boom"})}])
        if q.startswith("select count(*)::int n from public.prn_oncall_series"): return self._send(200, [{"n": 0}])
        if q.startswith("select (select count(*) from information_schema.tables"): return self._send(200, [{"t": 1, "c": 1, "i": 1, "a": False}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1212-"); WT = os.path.join(TMP, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']: sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree(os.path.join({WT!r}, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = {k: sha(os.path.join(WT, "supabase/functions", k)) for k in ("_shared/prn-oncall.ts", "prn-week/index.ts", "prn-page/index.ts")}
def run(env_over=None, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    for f in (LOG, rep): os.path.exists(f) and os.remove(f)
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_STEP="1212", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(PIN), SB_SETTLE="0", SB_POLL="0.05", SB_MAIN_REF="HEAD")
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "prn_oncall_weekly_1212.py")], cwd=WT, env=env, capture_output=True, text=True, timeout=900)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
writes = lambda: [q for q in S["sql"] if q.startswith(("begin;", "select cron.schedule", "select cron.unschedule"))]
try:
    c, out = run()
    ck("clean run from a fresh copy: exit 0, DONE", c == 0 and "1212: DONE" in out, out[-1500:])
    ck("Part 1: the reviewed build, the tests (all eight), switches left as they are, gateway settings kept, the vault secret", "the reviewed build is what is on GitHub's main" in out
       and "more-hours tests pass" in out and "both off (members see nothing new yet)" in out and "prn-week on, prn-page off" in out and "the jobs' secret is there" in out, out[:2500])
    ck("Part 2: the SQL in one transaction, both functions deployed keeping their gateway setting", any("create table if not exists public.prn_oncall_series" in q for q in S["sql"] if q.startswith("begin;"))
       and deploys() == ["prn-week", "prn-page"] and cli().count("--no-verify-jwt") == 1 and re.search(r"deploy prn-page .*--no-verify-jwt", cli()), cli())
    cmd = S["cron"].group(2).replace("''", "'") if S["cron"] else ""
    ck("the daily fill is scheduled every day at 11:20 UTC, to prn-week?fill=1 with the vault secret", S["cron"] and S["cron"].group(1) == "20 11 * * *" and "/functions/v1/prn-week?fill=1" in cmd and "x-cron-secret" in cmd and "hub_job_secret" in cmd, cmd)
    ck("Part 3: refuses outsiders, the public key and a forged link; the schedule gets in; a fill run; the records; switches unchanged", "prn-week refuses anyone not signed in" in out and "the daily fill refuses the public key (401)" in out
       and "the page refuses a forged link (401)" in out and "its daily schedule gets in" in out and "a fill run now: 0 week(s) added" in out and "the public can't read them" in out and "switches are as they were" in out, out[-1500:])
    ck("no key, token or email in the report; no em dash", not re.search(r"eyJ\w|sbp_\w|@mo-care", out) and "—" not in out, out)
    c, out = run(signup=True)
    ck("sign-up already on: said so, still runs, left on", c == 0 and "prn_oncall_signup_live ON (members see Every week as soon as this finishes)" in out and "1212: DONE" in out, out[:2000])
    c, out = run(env_over={"SB_SHAS": json.dumps({"prn-week/index.ts": "0" * 64})})
    ck("not the reviewed build: nothing runs", c == 2 and not deploys() and not S["sql"], out[-400:])
    c, out = run(vault=0)
    ck("no vault secret: STOPS before any change", c == 4 and not deploys() and not writes(), out[-500:])
    c, out = run(sqlfail=True)
    ck("the SQL fails: undone as a whole, nothing deployed", c == 6 and not deploys() and "undone as a whole" in out, out[-500:])
    c, out = run(gate=200)
    ck("a function answering the public key is caught", c == 1 and "✗ prn-week refuses" in out and "NOT COMPLETE" in out, out[-700:])
    c, out = run(fill_ok=False)
    ck("a fill run that fails is caught", c == 1 and "✗ a fill run now" in out, out[-700:])
    c, out = run(cron_caller="owner")
    ck("the schedule not getting in as itself is caught", c == 1 and "✗ its daily schedule gets in" in out, out[-700:])
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT])
    shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
