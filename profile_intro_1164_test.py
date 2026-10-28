#!/usr/bin/env python3
# Rehearsal of 1164 (profile_intro_1164.py) against a FAKE Supabase (management API, functions, SQL, cron) and a FAKE supabase CLI,
# from a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.  python3 profile_intro_1164_test.py
import json, os, subprocess, tempfile, threading, http.server, hashlib, re, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[-1500:]))
M = {}
RUN = {"ok": True, "dry": True, "saved": False, "live": False, "sent": 0, "problems": ["AxisCare's visit history isn't ready: still learning a year of visits (through 2026-02-24)"],
       "would": [], "cards": []}
ALSO = ["caregiver-intro", "coverage-run", "late-watch", "late-alert", "client-journey"]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        m = re.match(r"/v1/projects/\w+/functions/([a-z-]+)$", p)
        if m: return self._send(200, {"version": 3, "verify_jwt": m.group(1) != "late-watch"})
        if re.match(r"/v1/projects/\w+/secrets", p):
            names = ["HUB_JOB_SECRET", "AXISCARE_TOKEN", "AXISCARE_SITE"] if not M.get("no_secret") else ["AXISCARE_TOKEN"]
            return self._send(200, [{"name": n} for n in names])
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJservice"}])
        if p.startswith("/rest/v1/profile_intro_runs"): return self._send(401, {"message": "permission denied"})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/profile-intro-watch"):
            auth = self.headers.get("Authorization", "")
            M.setdefault("posts", []).append(p)
            if auth != "Bearer eyJservice": return self._send(401, {"error": "not allowed"})
            if "auth_check" in p: return self._send(200, {"ok": True, "caller": "owner"})
            return self._send(200, M.get("run", RUN))
        q = body["query"]
        M.setdefault("sql", []).append(q)
        if "vault.decrypted_secrets where name" in q and "count(*)" in q: return self._send(200, [{"n": 1}])
        if q.startswith("begin;"):
            if "create table if not exists public.profile_intro_runs" in q and "jsonb_build_object('profile_intro_live', false)" in q: M["sql_ran"] = True; return self._send(201, [])
            return self._send(400, {"message": "unexpected change"})
        if "data->>'profile_intro_live'" in q: return self._send(200, [{"live": "true" if M.get("live") else "false", "by": "Samantha Troutman"}])
        if "from client_journey_step_def where key = 'soc.start'" in q: return self._send(200, [{"n": 1}])
        if "cron.unschedule" in q: return self._send(200, [])
        if "cron.schedule(" in q: M["scheduled"] = q; return self._send(200, [{"id": 7}])
        if "from cron.job" in q: return self._send(200, [{"schedule": "*/15 * * * *", "command": "select net.http_post(... 'x-cron-secret' ...)"}])
        if "net.http_post" in q and "auth_check=1" in q: return self._send(200, [{"id": 42}])
        if "net._http_response" in q: return self._send(200, [{"status_code": 200, "content": json.dumps({"ok": True, "caller": "cron"})}])
        M.setdefault("other_sql", []).append(q)
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1164-"); WT = os.path.join(TMP, "wt")
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
FILES = ["profile-intro-watch/index.ts", "_shared/profile-intro.ts", "_shared/family-change-text.ts", "_shared/outreach.ts", "_shared/send-problems.ts",
         "caregiver-intro/index.ts", "client-journey/index.ts"]
SHAS = {k: sha(os.path.join(WT, "supabase/functions", k)) for k in FILES}
SQLSHA = sha(os.path.join(WT, "profile_intro_1164.sql"))
def go(**m):
    M.clear(); M.update(m)
    if os.path.exists(DEPLOYS): os.remove(DEPLOYS)
    rep = os.path.join(TMP, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="1164", SB_TOKEN="sbp_fake", SB_REPORT=rep, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(m.get("shas", SHAS)), SB_SQL_SHA=m.get("sqlsha", SQLSHA), SB_MAIN_REF="HEAD", SB_SETTLE="0", SB_POLL="0.05",
               SB_NODE="none" if m.get("no_node") else (shutil.which("node") or ""))
    p = subprocess.run(["python3", os.path.join(WT, "profile_intro_1164.py")], cwd=WT, env=env, capture_output=True, text=True)
    dep = open(DEPLOYS).read().split("\n")[:-1] if os.path.exists(DEPLOYS) else []
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), dep
try:
    c, o, d = go()
    ck("clean run: DONE, exit 0", c == 0 and "1164: DONE" in o, o)
    ck("clean run: the tests ran (fake data only)", "the profile, change text and opt-out tests pass" in o, o)
    ck("clean run: the database change went in as one piece; approval on record; the switch OFF", M.get("sql_ran") and "your approval is on record, in your words · the switch is OFF" in o, o)
    ck("clean run: step 7 said", "\"Family told\" ticks itself" in o, o)
    ck("clean run: the new job and the five it touches deployed, each keeping its gateway setting", d == ["profile-intro-watch jwt", "caregiver-intro jwt", "coverage-run jwt", "late-watch nojwt", "late-alert jwt", "client-journey jwt"], d)
    ck("clean run: every 15 minutes with the jobs' secret", "*/15 * * * *" in (M.get("scheduled") or "") and "x-cron-secret" in (M.get("scheduled") or ""), o)
    ck("clean run: public key refused, schedule gets in, public can't read the list", "it refuses the public key (401)" in o and "its schedule gets in" in o and "the public can't read the list (401)" in o, o)
    ck("clean run: the proof run is ?dry=1 and sent nothing", any("?dry=1" in x for x in M.get("posts", [])) and "a practice run works it out and sends nothing" in o, M.get("posts"))
    ck("clean run: still learning the year is said plainly, not as a failure", "still learning a year of visits" in o and "within about an hour" in o, o)
    ck("clean run: no other database query", not M.get("other_sql"), M.get("other_sql"))
    c, o, d = go(run={**RUN, "problems": [], "would": [{"caregiver": "Sarah T.", "client": "Dorothy Ray", "visit": "2026-10-30T09:00", "to": [{"name": "Linda Ray"}]}],
                      "cards": [{"title": "Profile not ready: Jordan M. for Walt Green"}]}, no_node=True)
    ck("the practice list is shown", c == 0 and "Would send: Sarah T. to Dorothy Ray's family (Linda Ray)" in o and "Would make a card: Profile not ready: Jordan M. for Walt Green" in o, o)
    c, o, d = go(run={**RUN, "problems": ["AxisCare's upcoming visits couldn't be read: 500"]}, no_node=True)
    ck("AxisCare unreadable: said loudly, NOT COMPLETE", c == 1 and "couldn't read: AxisCare's upcoming visits couldn't be read: 500" in o and "NOT COMPLETE" in o, o)
    c, o, d = go(run={**RUN, "sent": 2}, no_node=True)
    ck("if the run ever said it sent something: NOT COMPLETE", c == 1 and "NOT COMPLETE" in o, o)
    c, o, d = go(live=True, no_node=True)
    ck("switch already ON (a rerun after she turned it on): still DONE, and the proof is still a dry run", c == 0 and "the switch is ON" in o and any("?dry=1" in x for x in M.get("posts", [])), o)
    c, o, d = go(no_secret=True, no_node=True)
    ck("the jobs' secret missing: stops before anything changes", c == 4 and not d and not M.get("sql_ran"), o)
    c, o, d = go(shas={**SHAS, "_shared/profile-intro.ts": "0" * 64}, no_node=True)
    ck("not the reviewed build: stops before anything changes", c == 2 and not d and "not the reviewed build" in o and not M.get("sql_ran"), o)
    c, o, d = go(sqlsha="0" * 64, no_node=True)
    ck("the database change not the reviewed one: stops before anything changes", c == 2 and not d and not M.get("sql_ran"), o)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
ok = sum(1 for r in res if r[1])
for n, g, note in res: print(("  ✓ " if g else "  ✗ ") + n + ("" if g else "\n      " + note))
print(f"\n{ok}/{len(res)} passed"); raise SystemExit(0 if ok == len(res) else 1)
