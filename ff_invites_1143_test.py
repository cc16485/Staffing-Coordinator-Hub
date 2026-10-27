#!/usr/bin/env python3
# Rehearsal of 1143 (ff_invites_1143.py) against a FAKE Supabase (management API, functions, SQL, cron) and a FAKE supabase CLI,
# from a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.  python3 ff_invites_1143_test.py
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
        if m:
            vj = VJ().get(m.group(1), True)
            return self._send(200, {"version": 2 if M.get("deployed") else 1, "verify_jwt": vj})
        if re.match(r"/v1/projects/\w+/secrets", p):
            names = ["HUB_JOB_SECRET", "AXISCARE_TOKEN", "AXISCARE_SITE", "GHL_TOKEN", "GHL_LOCATION_ID"] if not M.get("no_secret") else ["AXISCARE_TOKEN"]
            return self._send(200, [{"name": n} for n in names])
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJservice"}])
        if p.startswith("/rest/v1/ff_"): M.setdefault("rest", []).append(p); return self._send(401, {"message": "permission denied"})
        self._send(404, {})
    def do_PATCH(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
        m = re.match(r"/v1/projects/\w+/functions/([a-z-]+)$", self.path)
        if m: M.setdefault("patched", {})[m.group(1)] = body.get("verify_jwt")
        self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/ff-card-request"):
            M.setdefault("card", []).append(body)
            return self._send(404, {"error": "We couldn't find this Refer a Friend link."})
        if p.startswith("/functions/v1/ff-invite-check"):
            auth = self.headers.get("Authorization", "")
            M.setdefault("posts", []).append([p, auth])
            if auth != "Bearer eyJservice": return self._send(401, {"error": "not allowed"})
            if "auth_check" in p: return self._send(200, {"ok": True, "caller": "owner"})
            return self._send(200, M.get("run", RUN))
        q = body["query"]
        M.setdefault("sql", []).append(q)
        if "to_regclass('public.ff_invite_runs')" in q: return self._send(200, [{"t": not M.get("no_table"), "j": 0 if M.get("no_table") else 1}])
        if q.startswith("begin;"):
            if "create table if not exists public.ff_invites" in q and "'ff_program_paused', false" in q and "ff_invites_live', false" not in q: M["sql_ran"] = True; return self._send(201, [])
            return self._send(400, {"message": "unexpected change"})
        if "data->>'ff_program_paused'" in q: return self._send(200, [{"live": "true" if M.get("live") else "false", "paused": "false"}])
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
def VJ():
    out = {}
    if os.path.exists(DEPLOYS):
        for l in open(DEPLOYS).read().split("\n"):
            if l: fn, j = l.split(" "); out[fn] = (j == "jwt")
    out.update(M.get("patched", {}))
    return out
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1143-"); WT = os.path.join(TMP, "wt")
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
FILES = ["ff-invite-check/index.ts", "_shared/ff-invite-rules.ts", "_shared/ff-invite-send.ts", "ff-card-request/index.ts"]
SHAS = {k: sha(os.path.join(WT, "supabase/functions", k)) for k in FILES}
SQLSHA = sha(os.path.join(WT, "ff_invites_send_1143.sql"))
def go(**m):
    M.clear(); M.update(m)
    for f_ in (DEPLOYS, FLAG):
        if os.path.exists(f_): os.remove(f_)
    rep = os.path.join(TMP, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="1143", SB_TOKEN="sbp_fake", SB_REPORT=rep, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(m.get("shas", SHAS)), SB_SQL_SHA=m.get("sqlsha", SQLSHA), SB_MAIN_REF="HEAD", SB_SETTLE="0", SB_POLL="0.05",
               SB_NODE="none" if m.get("no_node") else (shutil.which("node") or ""))
    # the fake management API answers "deployed" once the fake CLI has deployed
    def watch():
        import time
        while not M.get("_stop"):
            if os.path.exists(FLAG): M["deployed"] = True
            time.sleep(0.02)
    w = threading.Thread(target=watch, daemon=True); w.start()
    p = subprocess.run(["python3", os.path.join(WT, "ff_invites_1143.py")], cwd=WT, env=env, capture_output=True, text=True)
    M["_stop"] = True
    dep = open(DEPLOYS).read().split("\n")[:-1] if os.path.exists(DEPLOYS) else []
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), dep
try:
    c, o, d = go()
    ck("clean run: DONE, exit 0, Invitations OFF", c == 0 and "1143: DONE" in o and "Invitations are installed and OFF" in o, o)
    ck("clean run: the tests ran (fake data only)", "the invitation, card request and campaign guard tests pass" in o, o)
    ck("clean run: the database change went in as one piece, and never touches ff_invites_live", M.get("sql_ran") and "Invitations are OFF" in o, o)
    ck("clean run: ff-invite-check re-deployed (gateway kept on), ff-card-request deployed public (gateway off)", d == ["ff-invite-check jwt", "ff-card-request nojwt"] and "ff-card-request deployed: version 2, gateway sign-in check off" in o, [d, o])
    ck("clean run: the public can't run it, use the owner actions, or read the three records", "the public can't run the check (401)" in o and "the public can't use the owner actions (401)" in o and all(f"the public can't read {t} (401)" in o for t in ("ff_invite_runs", "ff_invites", "ff_card_requests")), o)
    ck("clean run: a made-up card code is refused (nobody emailed)", "refuses a made-up code and emails nobody (404)" in o and M.get("card", [{}])[0].get("code") == "ZZZZ-ZZ", o)
    ck("clean run: today's list with Invitations off: sent nothing, the ready list shown", "sent nothing" in o and "Caregiver: Ann Able · text and email" in o and "Family: Dana Ridge (for Rose Ridge) · email" in o, o)
    ck("clean run: no schedule change, no other database query", not M.get("scheduled") and not M.get("other_sql"), [M.get("other_sql"), M.get("scheduled")])
    c, o, d = go(live=True, no_node=True)
    ck("Invitations already ON: no proof run (it would send), still DONE", c == 0 and "no proof run was made" in o and not any(a == "Bearer eyJservice" and "auth_check" not in p for p, a in M.get("posts", [])), o)
    c, o, d = go(run={**RUN, "sent": 2}, no_node=True)
    ck("if the run ever sent with Invitations off: NOT COMPLETE", c == 1 and "NOT COMPLETE" in o, o)
    c, o, d = go(no_table=True, no_node=True)
    ck("1141 not run: stops before anything changes", c == 4 and not d and not M.get("sql_ran"), o)
    c, o, d = go(no_secret=True, no_node=True)
    ck("no GoHighLevel key: stops before anything changes", c == 4 and not d and not M.get("sql_ran"), o)
    c, o, d = go(shas={**SHAS, "ff-card-request/index.ts": "0" * 64}, no_node=True)
    ck("not the reviewed build: stops before anything changes", c == 2 and not d and "not the reviewed build" in o and not M.get("sql_ran"), o)
    c, o, d = go(sqlsha="0" * 64, no_node=True)
    ck("the database change not the reviewed one: stops before anything changes", c == 2 and not d and not M.get("sql_ran"), o)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
ok = sum(1 for r in res if r[1])
for n, g, note in res: print(("  ✓ " if g else "  ✗ ") + n + ("" if g else "\n      " + note))
print(f"\n{ok}/{len(res)} passed"); raise SystemExit(0 if ok == len(res) else 1)
