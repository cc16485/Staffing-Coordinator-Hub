#!/usr/bin/env python3
# Rehearsal of 1142 (ff_invites_1142.py) against a FAKE Supabase (management API, functions, SQL, cron) and a FAKE supabase CLI,
# from a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.  python3 ff_invites_1142_test.py
import json, os, subprocess, tempfile, threading, http.server, hashlib, re, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[-1500:]))
M = {}
RUN = {"ok": True, "saved": True, "sent": 0, "live": False, "problems": [], "summary": {"caregivers": {"ready": 1, "waiting": 1, "held": 0}, "families": {"ready": 1, "waiting": 0, "held": 1},
       "clients_without_family_email": 0, "not_invited_by_payer": {"Medicaid": 3}},
       "rows": [{"kind": "caregiver", "key": "cg_1", "name": "Ann Able", "status": "ready", "why": [], "channels": ["text", "email"]},
                {"kind": "caregiver", "key": "cg_2", "name": "Bea Best", "status": "waiting", "why": ["Active since Nov 1: 30 days on Dec 1"], "channels": ["text", "email"]},
                {"kind": "family", "key": "fam_1", "name": "Dana Ridge", "client": "Rose Ridge", "status": "ready", "why": [], "channels": ["email"]},
                {"kind": "family", "key": "fam_2", "name": "Gina Gold", "client": "Gil Gold", "status": "held", "why": ["Open red shift-note flag (Nov 18)"], "channels": []}]}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        m = re.match(r"/v1/projects/\w+/functions/([a-z-]+)$", p)
        if m: return self._send(200, {"version": 2 if M.get("deployed") else 1, "verify_jwt": True})
        if re.match(r"/v1/projects/\w+/secrets", p):
            names = ["HUB_JOB_SECRET", "AXISCARE_TOKEN", "AXISCARE_SITE"] if not M.get("no_secret") else ["AXISCARE_TOKEN"]
            return self._send(200, [{"name": n} for n in names])
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJservice"}])
        if p.startswith("/rest/v1/ff_invite_runs"): return self._send(401, {"message": "permission denied"})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/ff-invite-check"):
            auth = self.headers.get("Authorization", "")
            M.setdefault("posts", []).append([p, auth])
            if auth != "Bearer eyJservice": return self._send(401, {"error": "not allowed"})
            if "auth_check" in p: return self._send(200, {"ok": True, "caller": "owner"})
            return self._send(200, M.get("run", RUN))
        q = body["query"]
        M.setdefault("sql", []).append(q)
        if "to_regclass('public.ff_invite_runs')" in q: return self._send(200, [{"t": not M.get("no_table"), "j": 0 if M.get("no_table") else 1, "live": "true" if M.get("live") else "false"}])
        if q.startswith("begin;"):
            if "create table if not exists public.ff_invite_runs" in q and "'ff_invites_live', false" in q: M["sql_ran"] = True; return self._send(201, [])
            return self._send(400, {"message": "unexpected change"})
        if "data->>'ff_invites_live'" in q: return self._send(200, [{"live": "true" if M.get("live") else "false"}])
        if "cron.unschedule" in q: return self._send(200, [])
        if "cron.schedule(" in q: M["scheduled"] = q; return self._send(200, [{"id": 7}])
        if "from cron.job" in q: return self._send(200, [{"schedule": "20 15 * * *", "command": "select net.http_post(... 'x-cron-secret' ...)"}])
        if "net.http_post" in q and "auth_check=1" in q: return self._send(200, [{"id": 42}])
        if "net._http_response" in q: return self._send(200, [{"status_code": 200, "content": json.dumps({"ok": True, "caller": "cron"})}])
        M.setdefault("other_sql", []).append(q)
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1142-"); WT = os.path.join(TMP, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); DEPLOYS = os.path.join(TMP, "deploys"); FLAG = os.path.join(TMP, "deployed")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]
if a[:2] == ['functions', 'deploy']: open({DEPLOYS!r}, 'a').write(a[2] + ' ' + ('nojwt' if '--no-verify-jwt' in a else 'jwt') + '\\n'); open({FLAG!r}, 'w').write('1'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree(os.path.join({WT!r}, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
FILES = ["ff-invite-check/index.ts", "_shared/ff-invite-rules.ts", "_shared/audience-guard.ts"]
SHAS = {k: sha(os.path.join(WT, "supabase/functions", k)) for k in FILES}
SQLSHA = sha(os.path.join(WT, "ff_invites_1141.sql"))
def go(**m):
    M.clear(); M.update(m)
    for f_ in (DEPLOYS, FLAG):
        if os.path.exists(f_): os.remove(f_)
    rep = os.path.join(TMP, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="1142", SB_TOKEN="sbp_fake", SB_REPORT=rep, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(m.get("shas", SHAS)), SB_SQL_SHA=m.get("sqlsha", SQLSHA), SB_MAIN_REF="HEAD", SB_SETTLE="0", SB_POLL="0.05",
               SB_NODE="none" if m.get("no_node") else (shutil.which("node") or ""))
    # the fake management API answers "deployed" once the fake CLI has deployed
    def watch():
        import time
        while not M.get("_stop"):
            if os.path.exists(FLAG): M["deployed"] = True
            time.sleep(0.02)
    w = threading.Thread(target=watch, daemon=True); w.start()
    p = subprocess.run(["python3", os.path.join(WT, "ff_invites_1142.py")], cwd=WT, env=env, capture_output=True, text=True)
    M["_stop"] = True
    dep = open(DEPLOYS).read().split("\n")[:-1] if os.path.exists(DEPLOYS) else []
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), dep
try:
    c, o, d = go()
    ck("clean run: DONE, exit 0", c == 0 and "1142: DONE" in o, o)
    ck("clean run: the tests ran (fake data only)", "the invite check and campaign guard tests pass" in o, o)
    ck("clean run: checks 1141's table and schedule first, the switch read", "1141's list table and daily schedule are there · the switch is OFF" in o, o)
    ck("clean run: only ff-invite-check re-deployed, its gateway check kept on", d == ["ff-invite-check jwt"] and "gateway sign-in check on (kept)" in o, [d, o])
    ck("clean run: NO database change and NO schedule change", not M.get("sql_ran") and not M.get("scheduled") and not any(q.startswith("begin;") or "cron.schedule(" in q or "cron.unschedule" in q for q in M.get("sql", [])), M.get("sql"))
    ck("clean run: the public key is refused and the public can't read the list", "it refuses the public key (401)" in o and "the public can't read the list (401)" in o, o)
    ck("clean run: today's list is shown again: counts, ready with how, held and waiting with why", "Caregivers: 1 ready · 1 waiting · 0 held" in o and "Caregiver: Ann Able · text and email" in o
       and "Family: Gina Gold (for Gil Gold) · Open red shift-note flag (Nov 18)" in o and "Medicaid 3" in o, o)
    ck("clean run: no other database query", not M.get("other_sql"), M.get("other_sql"))
    c, o, d = go(run={**RUN, "ok": False, "problems": ["the client issues couldn't be read, so no family is listed as ready"], "summary": RUN["summary"]}, no_node=True)
    ck("if the issues still can't be read: said loudly, NOT COMPLETE", c == 1 and "couldn't read: the client issues couldn't be read" in o and "NOT COMPLETE" in o, o)
    c, o, d = go(run={**RUN, "sent": 3}, no_node=True)
    ck("if the run ever said it sent something: NOT COMPLETE", c == 1 and "NOT COMPLETE" in o, o)
    c, o, d = go(no_table=True, no_node=True)
    ck("1141 not run: stops before anything changes", c == 4 and not d and "run 1141 first" in o, o)
    c, o, d = go(shas={**SHAS, "ff-invite-check/index.ts": "0" * 64}, no_node=True)
    ck("not the reviewed build: stops before anything changes", c == 2 and not d and "not the reviewed build" in o, o)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
ok = sum(1 for r in res if r[1])
for n, g, note in res: print(("  ✓ " if g else "  ✗ ") + n + ("" if g else "\n      " + note))
print(f"\n{ok}/{len(res)} passed"); raise SystemExit(0 if ok == len(res) else 1)
