#!/usr/bin/env python3
# Rehearsal of 464 from a FRESH copy of this repository at the commit being tested, against a FAKE Supabase (a throwaway
# local Postgres set up like the real one, with 463 installed and a stand-in job scheduler) and fake live Hub pages.
# CC_HUB: the working copy whose new pages are served. Never touches a real project.
import json, os, subprocess, sys, tempfile, threading, http.server, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
CC = os.environ.get("CC_HUB", os.path.join(HERE, "..", "cc-hub-live"))
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
M = {"hub": "new"}
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else (body.encode() if isinstance(body, str) else json.dumps(body).encode())
        self.send_response(code); self.send_header("Content-Type", ctype); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/hub/desk.js": return self._send(200, open(os.path.join(CC, "desk.js")).read(), "text/javascript") if M["hub"] == "new" else self._send(404, "")
        if p == "/hub/index.html": return self._send(200, open(os.path.join(CC, "index.html")).read() if M["hub"] == "new" else "<html>old</html>", "text/html")
        return self._send(404, {})
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if not self.path.endswith(f"/v1/projects/{REF}/database/query"): return self._send(404, {})
        if self.headers.get("Authorization") != "Bearer sbp_fake": return self._send(401, {"message": "bad token"})
        q = json.loads(raw)["query"]; cc = conn()
        try:
            rows = cc.run(q); cols = [c["name"] for c in (cc.columns or [])]
            return self._send(201, [dict(zip(cols, r)) for r in (rows or [])])
        except DatabaseError as e:
            m = e.args[0].get("M") if e.args and isinstance(e.args[0], dict) else str(e)
            try: cc.run("rollback")
            except Exception: pass
            return self._send(400, {"message": "Failed to run sql query: ERROR:  P0001: " + m})
        finally: cc.close()
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
T = tempfile.mkdtemp(prefix="reh464-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
def db(q, **kw):
    c = conn()
    try: return c.run(q, **kw)[0][0]
    finally: c.close()
def fresh_db(cron=True, with463=True, ops='{"afternoon_interviews":{"from":"14:00"}}'):
    c = conn(); setup(c)
    if with463: c.run("begin"); c.run(open(os.path.join(HERE, "my_desk_463.sql")).read()); c.run("commit")
    c.run("create table public.app_data(key text primary key, data jsonb, version int default 1)")
    c.run("insert into public.app_data values ('ops_settings', :d::jsonb, 1)", d=ops)
    c.run("drop schema if exists cron cascade")
    if cron:
        c.run("create schema cron; create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text)")
        c.run("create function cron.schedule(n text, s text, cmd text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (n, s, cmd) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$")
        c.run("create function cron.unschedule(n text) returns boolean language sql as $$ with d as (delete from cron.job where jobname = n returning 1) select exists (select 1 from d) $$")
    c.close()
def run(**over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_HUB_BASE=URL + "/hub/"); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "my_desk_464.py")], env=env, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
access = lambda: db("select data->'desk_access' from app_data where key = 'ops_settings'")
jobs = lambda: db("select count(*) from cron.job where jobname = 'desk-tidy-nightly'")
try:
    fresh_db()
    M["hub"] = "old"; code, out = run()
    ck("the Hub not live yet: stops, nothing changed", code == 3 and "doesn't have the My Desk tab yet" in out and access() is None and jobs() == 0, out)
    M["hub"] = "new"; fresh_db(with463=False); code, out = run()
    ck("463 not run: stops, nothing changed", code == 3 and "storage (463) isn't all there" in out, out)
    fresh_db(cron=False); code, out = run()
    ck("no job scheduler: stops, nothing changed", code == 3 and "scheduler isn't there" in out and access() is None, out)
    fresh_db(); code, out = run()
    ck("happy path: DONE", code == 0 and "RESULT: DONE" in out, out)
    a = access(); a = json.loads(a) if isinstance(a, str) else a
    ck("...Samantha and Krystal are ticked", a["mode"] == "some" and sorted(a["people"]) == ["krystal@mo-care.com", "samantha@mo-care.com"], a)
    ck("...the rest of the Hub settings are untouched", db("select data->'afternoon_interviews'->>'from' from app_data where key = 'ops_settings'") == "14:00")
    ck("...the tidy is scheduled nightly", jobs() == 1 and db("select command from cron.job where jobname = 'desk-tidy-nightly'") == "select public.desk_tidy()")
    for s in ("live Hub has the My Desk tab", "switched on for Samantha and Krystal", "scheduled for 3:20 AM Central", "reads back exactly", "the tidy runs", "only the server can run the tidy", "reads back as Samantha and Krystal"):
        ck(f"...the report says: {s}", s in out, out)
    ck("...prints no email or key", "@" not in out.replace("(an email)", "") and "sbp_" not in out, out)
    code, out = run()
    ck("run again: DONE, leaves who sees it alone, one schedule", code == 0 and "already set" in out and jobs() == 1, out)
    fresh_db(ops='{"desk_access":{"mode":"off","people":[]}}'); code, out = run()
    ck("if someone already set who sees it (even off), 464 never overrides it", code == 0 and json.loads(json.dumps(access()))["mode"] == "off", out)
    # proof not right: the tidy is open to pages -> switched back off
    fresh_db(); c = conn(); c.run("grant execute on function public.desk_tidy() to authenticated"); c.close()
    code, out = run()
    ck("proof not right: NOT DONE, My Desk switched back off and the schedule removed", code == 8 and "switched back off" in out and access() is None and jobs() == 0, out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d in res: print(("PASS" if okk else "FAIL"), "·", n, d)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
