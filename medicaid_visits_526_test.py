#!/usr/bin/env python3
# Rehearsal of 526 (Medicaid visits from AxisCare) from a FRESH copy at the commit being tested, against a FAKE Supabase: a throwaway
# local Postgres a fake Management API, a fake supabase CLI and a fake medicaid-visits.
# Never touches a real project. (REHEARSE_COMMIT pins a commit)
import json, os, re, subprocess, sys, tempfile, threading, http.server, shutil, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
S = {"exists": False, "vj": None, "practice_calls": 0, "drift": False}
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body, default=str).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer sbp_fake" and "/v1/" in self.path: return self._send(401, {})
        if self.path == f"/v1/projects/{REF}/functions/medicaid-visits": return self._send(200, {"version": 1, "verify_jwt": S["vj"]}) if S["exists"] else self._send(404, {})
        if self.path.startswith(f"/v1/projects/{REF}/api-keys?reveal=true"): return self._send(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJsvc"}])
        self._send(404, {})
    def do_PATCH(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        if self.path == f"/v1/projects/{REF}/functions/medicaid-visits": S["vj"] = json.loads(raw).get("verify_jwt"); return self._send(200, {})
        self._send(404, {})
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        if self.path.startswith("/deployed"): S["exists"] = True; S["vj"] = "novj=0" in self.path; return self._send(200, {})
        if self.path.startswith("/functions/v1/medicaid-visits"):
            if self.headers.get("Authorization") != "Bearer eyJsvc": return self._send(401, {"error": "not allowed"})
            if "dry=1" in self.path: S["practice_calls"] += 1; return self._send(200, {"ok": True, "dry": True, "live": False, "clients": 2, "checked": 2, "axiscare_failed": S.get("axfail", 0), "staffing": "sally@mo-care.com", "medicaid": "angiel@mo-care.com",
                "at_risk": [{"name": "Ann Risk", "in_a_row": 2, "days_without": 4}], "reviews": []})
            return self._send(200, {"ok": True})
        if not self.path.endswith(f"/v1/projects/{REF}/database/query"): return self._send(404, {})
        if self.headers.get("Authorization") != "Bearer sbp_fake": return self._send(401, {"message": "bad token"})
        cc = conn()
        try:
            rows = cc.run(json.loads(raw)["query"]); cols = [c["name"] for c in (cc.columns or [])]
            return self._send(201, [dict(zip(cols, r)) for r in (rows or [])])
        except DatabaseError as e:
            try: cc.run("rollback")
            except Exception: pass
            return self._send(400, {"message": str(e)[:200]})
        finally: cc.close()
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
T = tempfile.mkdtemp(prefix="reh526-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
FNROOT = os.path.join(W, "supabase", "functions"); sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
PINS = {"medicaid-visits/index.ts": sha(os.path.join(FNROOT, "medicaid-visits", "index.ts")), "_shared/visit-rules.js": sha(os.path.join(FNROOT, "_shared", "visit-rules.js"))}
LOG = os.path.join(T, "cli.txt"); CLI = os.path.join(T, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
echo "$@" >> {LOG}
[ -f {T}/fail ] && [ "$2" = "deploy" ] && {{ echo boom >&2; exit 1; }}
if [ "$2" = "deploy" ]; then curl -s -o /dev/null -X POST "{URL}/deployed?novj=$(echo "$@" | grep -c -- --no-verify-jwt)"; exit 0; fi
if [ "$2" = "download" ]; then mkdir -p supabase/functions; cp -R {FNROOT}/$3 supabase/functions/; cp -R {FNROOT}/_shared supabase/functions/; [ -f {T}/drift ] && echo "// other" >> supabase/functions/$3/index.ts; exit 0; fi
exit 0
"""); os.chmod(CLI, 0o755)
def fresh(vault=True):
    c = conn(); setup(c)
    c.run("create table if not exists public.app_data(key text primary key, data jsonb, version int default 1)"); c.run("delete from public.app_data"); c.run("insert into public.app_data values ('ops_settings', '{}'::jsonb, 1)")
    for r_ in ("service_role", "authenticated", "anon"): c.run(f"do $$ begin if not exists (select 1 from pg_roles where rolname='{r_}') then create role {r_}; end if; end $$")
    c.run("drop schema if exists cron cascade; create schema cron; create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text, active boolean default true)")
    c.run("create function cron.schedule(n text, s text, cmd text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (n, s, cmd) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$")
    c.run("create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$")
    c.run("drop schema if exists vault cascade; create schema vault; create table vault.decrypted_secrets(name text, decrypted_secret text)")
    if vault: c.run("insert into vault.decrypted_secrets values ('hub_job_secret', 'x')")
    c.close(); S.update({"exists": False, "vj": None, "practice_calls": 0, "axfail": 0})
    for f in (LOG, os.path.join(T, "fail"), os.path.join(T, "drift")):
        if os.path.exists(f): os.remove(f)
def run(**over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=CLI, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(PINS), SB_SETTLE="0"); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "medicaid_visits_526.py")], env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
def q1(s):
    c = conn()
    try: r = c.run(s); return r
    finally: c.close()
log = lambda: open(LOG).read() if os.path.exists(LOG) else ""
try:
    fresh(); code, out = run()
    ck("DONE: the function (gateway check on) and the weekday run; the switch untouched", code == 0 and "RESULT: DONE" in out and "✗" not in out and S["exists"] and S["vj"] is True and log().count("functions deploy") == 1, out)
    ck("...scheduled every weekday at 9:45am Central with the jobs' secret", q1("select schedule from cron.job where jobname = 'medicaid-visits-weekdays'") == [["45 14 * * 1-5"]] and "x-cron-secret" in q1("select command from cron.job")[0][0], q1("select * from cron.job"))
    ck("...the practice run reads AxisCare and reports who is at risk, where cards would go; writes nothing", S["practice_calls"] == 1 and "at risk today: Ann Risk (2 in a row" in out and "Staffing (sally@mo-care.com) and the Medicaid coordinator (angiel@mo-care.com)" in out, out)
    ck("...it refuses anyone without the schedule's secret", "refuses anyone without the schedule's secret" in out, out)
    ck("...the switch is reported and left as it is (off)", "Missed-visit watch\" is OFF (it stays as it is" in out and q1("select data->>'visit_watch_live' from app_data where key = 'ops_settings'") == [[None]], out)
    ck("...no key or token in the report", not re.search(r"eyJ|sbp_", out), out)
    code, out = run()
    ck("run again: safe (already this build, not redeployed; the schedule replaced, not doubled)", code == 0 and "already this build" in out and log().count("functions deploy") == 1 and q1("select count(*) from cron.job where jobname = 'medicaid-visits-weekdays'") == [[1]], out)
    fresh(); S["axfail"] = 2; code, out = run()
    ck("AxisCare not answering in the practice run: flagged", code == 9 and "AxisCare did not answer" in out, out)
    fresh(); S["exists"] = True; S["vj"] = True; open(os.path.join(T, "drift"), "w").write("1"); code, out = run()
    ck("a different medicaid-visits already live: stops before anything changes", code == 3 and "a different medicaid-visits is already live" in out and q1("select count(*) from cron.job") == [[0]], out)
    fresh(vault=False); code, out = run()
    ck("without the jobs' secret: nothing changes", code == 3 and "secret" in out and "deploy" not in log(), out)
    fresh(); open(os.path.join(T, "fail"), "w").write("1"); code, out = run()
    ck("a failed deploy stops and says what stays", code == 6 and "did not deploy cleanly" in out, out)
    fresh(); code, out = run(SB_FN_SHAS=json.dumps(dict(PINS, **{"medicaid-visits/index.ts": "0" * 64})))
    ck("a changed build is refused before anything runs", code == 2 and "not the reviewed build" in out and "deploy" not in log(), out)
    fresh(); code, out = run(SB_TOKEN="nope")
    ck("no token: nothing runs", code == 2 and "deploy" not in log(), out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
