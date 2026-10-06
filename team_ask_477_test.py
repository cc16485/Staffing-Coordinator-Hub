#!/usr/bin/env python3
# Rehearsal of 477 from a FRESH copy at the commit being tested, against a FAKE Supabase: a throwaway local Postgres with a
# stand-in job scheduler, vault and net; a fake deploy; a fake talk-notify. Never touches a real project.
import json, os, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANON, SVC = "eyJanon" + "a" * 40, "eyJsvc" + "s" * 40
M = {"version": None, "secrets": ["GHL_TOKEN", "GHL_LOCATION_ID"]}
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer sbp_fake": return self._send(401, {})
        if self.path.startswith(f"/v1/projects/{REF}/api-keys"): return self._send(200, [{"name": "anon", "api_key": ANON}, {"name": "service_role", "api_key": SVC}])
        if self.path == f"/v1/projects/{REF}/secrets": return self._send(200, [{"name": n} for n in M["secrets"]])
        if self.path == f"/v1/projects/{REF}/functions/talk-notify": return self._send(200, {"version": M["version"], "verify_jwt": True}) if M["version"] else self._send(404, {})
        return self._send(404, {})
    def do_OPTIONS(self):
        self.send_response(200); self.end_headers()
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        if self.path == "/bump": M["version"] = (M["version"] or 0) + 1; return self._send(200, {})
        if self.path.startswith("/functions/v1/team-ask"): return self._send(401, {"error": "not allowed"})
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
T = tempfile.mkdtemp(prefix="reh477-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
FNROOT = os.path.join(W, "supabase", "functions"); sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
PINS = {"team-ask": sha(os.path.join(FNROOT, "team-ask", "index.ts"))}
LOG = os.path.join(T, "deploys.txt"); CLI = os.path.join(T, "supabase")
open(CLI, "w").write(f"#!/bin/sh\necho \"$@\" >> {LOG}\n[ -f {T}/fail ] && {{ echo boom >&2; exit 1; }}\ncurl -s -o /dev/null -X POST {URL}/bump\nexit 0\n"); os.chmod(CLI, 0o755)
def db(q):
    c = conn()
    try: r = c.run(q); return r[0][0] if r else None
    finally: c.close()
def fresh(vault=True, ops='{}'):
    c = conn(); setup(c)
    c.run("create table public.app_data(key text primary key, data jsonb, version int default 1)"); c.run("insert into public.app_data values ('ops_settings', :d::jsonb, 1)", d=ops)
    c.run("drop schema if exists cron cascade; create schema cron; create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text, active boolean default true)")
    c.run("create function cron.schedule(n text, s text, cmd text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (n, s, cmd) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$")
    c.run("create function cron.unschedule(n text) returns boolean language sql as $$ with d as (delete from cron.job where jobname = n returning 1) select exists (select 1 from d) $$")
    c.run("drop schema if exists vault cascade; create schema vault; create table vault.decrypted_secrets(name text, decrypted_secret text)")
    if vault: c.run("insert into vault.decrypted_secrets values ('hub_job_secret', 'j' || repeat('x', 63))")
    c.run("drop schema if exists net cascade; create schema net; create table net._http_response(id bigserial primary key, status_code int, content text)")
    c.run("create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$ insert into net._http_response(status_code, content) values (case when headers->>'x-cron-secret' like 'j%' then 200 else 401 end, case when headers->>'x-cron-secret' like 'j%' then '{\"ok\":true,\"items\":0,\"emailed\":0}' else '{\"error\":\"not allowed\"}' end) returning id $$")
    c.close()
    for f in (LOG, os.path.join(T, "fail")):
        if os.path.exists(f): os.remove(f)
    M.update(version=None, secrets=["GHL_TOKEN", "GHL_LOCATION_ID"])
def run(**over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=CLI, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(PINS), SB_SETTLE="0", SB_POLL="0.2", SB_POLL_MAX="5"); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "team_ask_477.py")], env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
deployed = lambda: os.path.exists(LOG) and "functions deploy team-ask" in open(LOG).read()
live = lambda: db("select data->>'team_ask_live' from app_data where key = 'ops_settings'")
try:
    fresh(); code, out = run(SB_FN_SHAS=json.dumps({"team-ask": "0" * 64}))
    ck("a changed function is refused before anything runs", code == 2 and "not the reviewed build" in out and not deployed(), out)
    fresh(); M["secrets"] = ["OTHER"]; code, out = run()
    ck("no GoHighLevel secrets: stops before deploying", code == 4 and not deployed(), out)
    fresh(); open(os.path.join(T, "fail"), "w").write("1"); code, out = run()
    ck("a failed deploy: stops and says texting works as before", code == 6 and "works as before" in out, out)
    fresh(ops='{"team_ask_live": true}'); code, out = run()
    ck("DONE: team-ask deployed, unsigned page refused, preflight answered", code == 0 and deployed() and "RESULT: DONE" in out and "refused (401)" in out, out)
    ck("...the switch is left ON as it was", live() == "true" and "unchanged (ON)" in out, out)
    ck("...keys never printed", ANON not in out and SVC not in out, out)
    fresh(ops='{}'); code, out = run()
    ck("switch OFF stays OFF, and the report says nothing can be sent until it is on", code == 0 and live() is None and "is OFF" in out, out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
