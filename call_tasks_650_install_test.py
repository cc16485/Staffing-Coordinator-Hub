#!/usr/bin/env python3
# Rehearsal of 650 (call_tasks_650.py) against a FAKE Supabase (management API, the function, REST) and a FAKE supabase
# CLI. Never touches a real project.   python3 call_tasks_650_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; M = {}
ROWS = [{"t": "Sun Oct 11 06:36 pm", "direction": "in", "caller": "Steve A.", "who_name": "Steve Algiere", "call_type": "client_or_family", "tasks": [{"title": "Call Steve Algiere back about arranging a ride", "due": "2026-10-12"}], "no_task_reason": None, "error": None, "resolves": []},
        {"t": "Sun Oct 11 06:37 pm", "direction": "out", "caller": "Steve A.", "who_name": "Steve Algiere", "call_type": "client_or_family", "tasks": [{"title": "Schedule Angiel 2-3 hours with Steve this week: DMV trip", "due": "2026-10-16"}], "no_task_reason": None, "error": None, "resolves": [{"message_id": "ipo", "task_index": 0}]},
        {"t": "Mon Oct 12 08:29 am", "direction": "in", "caller": "Kristie M.", "who_name": None, "call_type": "caregiver", "tasks": [], "no_task_reason": "nothing left to do", "error": None, "resolves": []}]
def reset(**m):
    S.clear(); S.update(sql=[], posts=[]); M.clear()
    M.update(dict(secrets=True, vault=1, pre=True, install="ok", runs=[{"read": 3, "cards": 2, "errors": 0}, {"read": 0, "cards": 0, "errors": 0}], mine=0, leak=0, anon_ok=False, cron_ok=True, live=False, pull_vj=True), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if p.endswith("/secrets"): return self._send(200, [{"name": n} for n in (["ANTHROPIC_API_KEY", "GHL_LOCATION_ID", "HUB_JOB_SECRET", "GHL_TOKEN"] if M["secrets"] else ["GHL_TOKEN"])])
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if m := re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p):
            if m.group(1) == "call-pull": return self._send(200, {"version": 9, "verify_jwt": M["pull_vj"]})
            return self._send(200, {"version": 1, "verify_jwt": M["pull_vj"]})
        if p.startswith("/rest/v1/call_task_reading"): return self._send(200, [{"message_id": "x"}] if M["anon_ok"] else [])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/call-tasks"):
            S["posts"].append((p, self.headers.get("Authorization"), body))
            if "auth_check" in p: return self._send(200 if M["anon_ok"] else 401, {"error": "not allowed"} if not M["anon_ok"] else {"ok": True})
            r = M["runs"].pop(0) if M["runs"] else {"read": 0, "cards": 0, "errors": 0}
            return self._send(200, dict(ok=True, **r))
        q = body["query"]; S["sql"].append(q)
        if q.lstrip().startswith("-- ====") and "650 · CALL FOLLOW-UP CARDS" in q:
            return self._send(400, {"message": "ERROR: 650 refused"}) if M["install"] == "fail" else self._send(201, [])
        if "vault.decrypted_secrets where name" in q and "count(*)" in q: return self._send(200, [{"n": M["vault"]}])
        if "to_regclass('public.call_pull_seen')" in q: return self._send(200, [{"seen": M["pre"], "ident": True, "office": True, "recent": 7, "already": False}])
        if q.startswith("update public.app_data set data = data || jsonb_build_object('call_tasks_practice'"): return self._send(200, [{"p": "true", "s": "2026-10-09T15:00:00Z", "live": None}])
        if "data->>'call_tasks_live' as live" in q: return self._send(200, [{"live": "true" if M["live"] else None}])
        if "cron.unschedule" in q: return self._send(200, [])
        if "cron.schedule(" in q: return self._send(200, [{"id": 5}])
        if "from cron.job where jobname" in q: return self._send(200, [{"schedule": "5-59/10 * * * *", "command": "select net.http_post(... 'x-cron-secret' ...)"}])
        if q.startswith("select net.http_post"): return self._send(200, [{"id": 77}])
        if "net._http_response" in q: return self._send(200, [{"status_code": 200 if M["cron_ok"] else 401, "content": json.dumps({"ok": True, "caller": "cron"} if M["cron_ok"] else {"error": "not allowed"})}])
        if "md5(data::text)" in q: return self._send(200, [{"m": "abc", "n": 427}])
        if "from public.call_task_reading where version" in q: return self._send(200, ROWS)
        if "x->>'kind' = 'call_followup'" in q: return self._send(200, [{"n": M["mine"]}])
        if "from public.call_task_reading where tasks::text" in q: return self._send(200, [{"n": M["leak"]}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t650-")
FAKEBIN = os.path.join(tmp, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(tmp, "cli.log")
open(os.path.join(FAKEBIN, "node"), "w").write("#!/bin/sh\necho '39/39 passed'\n")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']: sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree(os.path.join({HERE!r}, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
for f in ("node", "supabase"): os.chmod(os.path.join(FAKEBIN, f), 0o755)
FN = ["call-tasks/index.ts", "_shared/call-tasks.ts", "_shared/job-auth.ts", "_shared/staff-auth.ts"]
FNSHAS = {f: sha(os.path.join(HERE, "supabase/functions", f)) for f in FN}
SQLSHAS = {f: sha(os.path.join(HERE, f)) for f in ("call_tasks_650.sql", "call_tasks_650_rollback.sql")}
def run(env_over=None, **mode):
    reset(**mode); rep = os.path.join(tmp, "r.txt")
    if os.path.exists(LOG): os.remove(LOG)
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"),
               SB_FNROOT=os.path.join(HERE, "supabase/functions"), SB_SETTLE="0", SB_POLL="0", SB_FN_SHAS=json.dumps(FNSHAS), SB_SQL_SHAS=json.dumps(SQLSHAS), PYTHONPATH=HERE)
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(HERE, "call_tasks_650.py")], env=env, capture_output=True, text=True, timeout=120)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
installed = lambda: any(q.lstrip().startswith("-- ====") and "650 · CALL FOLLOW-UP CARDS" in q for q in S["sql"])
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
c, out = run()
ck("happy path: exit 0, RESULT: DONE", c == 0 and "RESULT: DONE" in out, out)
ck("order: table, then the reader deployed (call-pull's gateway setting kept), then practice on and the schedule", installed() and "functions deploy call-tasks" in cli() and "--no-verify-jwt" not in cli()
   and [i for i, q in enumerate(S["sql"]) if "650 · CALL FOLLOW-UP CARDS" in q][0] < [i for i, q in enumerate(S["sql"]) if "call_tasks_practice', true" in q][0], cli())
ck("practice is turned on and cards in Work stay off; the schedule is 5 minutes after call-pull", "practice reading is ON" in out and "Cards in Work: OFF" in out and "5 minutes after call-pull" in out, out)
ck("proofs: public key refused, schedule gets in", "refuses the public key (401)" in out and "its schedule gets in" in out, out)
ck("the first reading runs as the owner, 6 calls a run, until nothing is left", [b for _, _, b in S["posts"] if b.get("limit")] == [{"limit": 6}] * 2 and all(a == "Bearer eyJsvcKEY" for p_, a, b in S["posts"] if b.get("limit")), S["posts"])
ck("the report lists each call and what it would have made, including Steve's DMV card and the answered voicemail", "first reading: 3 call(s) read, 2 card(s)" in out and "WOULD MAKE: Schedule Angiel 2-3 hours with Steve this week: DMV trip  (due 2026-10-16)" in out
   and "answers 1 earlier card(s)" in out and "no card: nothing left to do" in out, out)
ck("the Work check and the privacy checks pass", "NOTHING was added to Work by the reader" in out and "no phone number or email is kept" in out and "public cannot read the readings" in out, out)
ck("no key is printed", "eyJsvcKEY" not in out and "eyJanonKEY" not in out and "sbp_test" not in out, out)
c, out = run(secrets=False)
ck("a missing secret: STOP before anything changes", c == 3 and "needed secret is missing" in out and not installed(), out)
c, out = run(vault=0)
ck("the jobs' vault secret missing: STOP before anything changes", c == 3 and not installed(), out)
c, out = run(pre=False)
ck("call_pull_seen missing: STOP before anything changes", c == 3 and not installed(), out)
c, out = run(env_over={"SB_FN_SHAS": json.dumps(dict(FNSHAS, **{"_shared/call-tasks.ts": "0" * 64}))})
ck("a file that is not the reviewed build: STOP, no query at all", c == 2 and not S["sql"], out)
c, out = run(install="fail")
ck("the table refused: STOP, nothing deployed, practice not turned on", c == 5 and "deploy" not in cli() and not any("call_tasks_practice" in q for q in S["sql"]), out)
c, out = run(mine=1)
ck("a call follow-up card found in Work: reported, not passed", c == 9 and "call follow-up card(s) exist in Work" in out, out)
c, out = run(leak=1)
ck("a phone number or email kept: reported", c == 9 and "holds a phone number or email" in out, out)
c, out = run(anon_ok=True)
ck("the public key gets in, or can read the readings: reported", c == 9 and "refuses the public key (200)" in out, out)
c, out = run(cron_ok=False)
ck("the schedule cannot get in: reported", c == 9 and "its schedule gets in (401)" in out, out)
c, out = run(live=True)
ck("call_tasks_live found on: STOP before anything changes (it must stay off until slice C)", c == 3 and "should be off until slice C" in out and not installed(), out)
shutil.rmtree(tmp, ignore_errors=True)
failed = [r for r in res if not r[1]]
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
print(f"\n{len(res) - len(failed)}/{len(res)} passed" + (" · FAIL" if failed else ""))
raise SystemExit(1 if failed else 0)
