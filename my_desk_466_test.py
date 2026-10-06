#!/usr/bin/env python3
# Rehearsal of 466 from a FRESH copy of this repository at the commit being tested, against a FAKE Supabase: database
# calls run on a throwaway local Postgres with 463 + 465 installed; a fake deploy command; a fake care-notes function
# that answers the practice run. Never touches a real project.
import json, os, subprocess, sys, tempfile, threading, http.server, hashlib, shutil, stat
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
src465 = open(os.path.join(HERE, "my_desk_465_sql_test.py")).read()
exec(src465[src465.index("def setup465"):src465.index("c = conn(); setup465(c)")])
from pg8000.native import DatabaseError
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANON, SVC = "eyJanon" + "a" * 40, "eyJsvc" + "s" * 40
M = {"version": 7, "verify_jwt": False, "practice": None, "calls": []}
PRACTICE = {"ok": True, "practice": True, "window_hours": 48, "visits_finished": 31, "days_with_words": 22, "asked": 22, "flagged": 3, "urgent": 1,
            "ai_could_not_read": 0, "by_kind": {}, "stopped_early": False, "kind_switch": False, "kind_asked": 22, "kind_found": 2, "kind_not_in_note": 1, "kind_ai_failed": 0, "kind_already": 0, "kind_suggested": 0}
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer sbp_fake": return self._send(401, {})
        if self.path.startswith(f"/v1/projects/{REF}/api-keys"): return self._send(200, [{"name": "anon", "api_key": ANON}, {"name": "service_role", "api_key": SVC}])
        if self.path == f"/v1/projects/{REF}/functions/care-notes": return self._send(200, {"version": M["version"], "verify_jwt": M["verify_jwt"]})
        return self._send(404, {})
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.path.startswith("/functions/v1/care-notes"):
            M["calls"].append(self.path); a = self.headers.get("Authorization")
            if "practice=1" in self.path and a == "Bearer " + SVC: return self._send(200, M["practice"] if M["practice"] is not None else PRACTICE)
            return self._send(401, {"error": "not allowed"})
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
T = tempfile.mkdtemp(prefix="reh466-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
FNROOT = os.path.join(W, "supabase", "functions")
PIN = hashlib.sha256(open(os.path.join(FNROOT, "care-notes", "index.ts"), "rb").read()).hexdigest()
LOG = os.path.join(T, "deploys.txt"); CLI = os.path.join(T, "supabase")
open(CLI, "w").write(f"#!/bin/sh\necho \"$@\" >> {LOG}\n[ -f {T}/deploy_fails ] && {{ echo 'boom' >&2; exit 1; }}\nexit 0\n"); os.chmod(CLI, 0o755)
def db(q):
    c = conn()
    try: return c.run(q)[0][0]
    finally: c.close()
def fresh_db(ops='{"care_notes_flag_live": true}', with465=True):
    c = conn(); setup465(c)
    if with465: c.run("begin"); c.run(open(os.path.join(HERE, "my_desk_465.sql")).read()); c.run("commit")
    c.run("create table public.app_data(key text primary key, data jsonb, version int default 1)")
    c.run("insert into public.app_data values ('ops_settings', :d::jsonb, 1)", d=ops)
    c.run("drop schema if exists cron cascade; create schema cron; create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text, active boolean default true)")
    c.run("insert into cron.job(jobname, schedule, command) values ('care-notes-flag', '15 */2 * * *', 'x')")
    c.close()
    for f in (LOG, os.path.join(T, "deploy_fails")):
        if os.path.exists(f): os.remove(f)
    M.update(version=7, practice=None, calls=[])
def run(**over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=CLI, SB_FNROOT=FNROOT,
               SB_FN_SHAS=json.dumps({"care-notes": PIN}), SB_SETTLE="0"); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "my_desk_466.py")], env=env, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
deployed = lambda: os.path.exists(LOG) and "functions deploy care-notes" in open(LOG).read()
try:
    fresh_db()
    code, out = run(SB_FN_SHAS=json.dumps({"care-notes": "0" * 64}))
    ck("a changed function is refused before anything runs", code == 2 and "not the reviewed build" in out and not deployed(), out)
    fresh_db(with465=False)
    code, out = run()
    ck("465 not run: stops, nothing deployed", code == 3 and "(465) isn't there" in out and not deployed(), out)
    fresh_db(); open(os.path.join(T, "deploy_fails"), "w").write("1")
    code, out = run()
    ck("a failed deploy: stops, says the reader is unchanged", code == 6 and "unchanged" in out, out)
    fresh_db()
    # the fake deploy bumps the version the way a real one does
    open(CLI, "w").write(f"#!/bin/sh\necho \"$@\" >> {LOG}\ncurl -s -o /dev/null -X POST {URL}/bump || true\nexit 0\n")
    orig = Hd.do_POST
    def do_POST(self):
        if self.path == "/bump": M["version"] += 1; self.rfile.read(int(self.headers.get("Content-Length", 0) or 0)); return self._send(200, {})
        return orig(self)
    Hd.do_POST = do_POST
    code, out = run()
    ck("happy path: INSTALLED WITH THE SWITCH OFF", code == 0 and "INSTALLED WITH THE SWITCH OFF" in out and deployed(), out)
    ck("...deployed with the gateway setting kept (no JWT check, as it was)", "--no-verify-jwt" in open(LOG).read())
    for s_ in ("Kind Words jar (463) and its delivery", "kind-word suggestions switch: off", "now running version 8 (was 7)", "the public key → refused (401)",
               "the server can save a suggestion", "can't see a suggestion", "on nobody's desk until a person says yes", "found 2 it could quote word for word", "1 thrown away"):
        ck(f"...the report says: {s_}", s_ in out, out)
    ck("...the switch is still off and the proof left nothing behind", db("select coalesce((data->>'kind_words_suggest_live')::boolean, false) from app_data where key = 'ops_settings'") is False
       and db("select count(*) from kind_words") == 0, out)
    ck("...prints no key", "eyJ" not in out and "sbp_" not in out, out)
    fresh_db(ops='{"care_notes_flag_live": false, "kind_words_suggest_live": true}')
    code, out = run()
    ck("switch already on, shift-note flags off: left alone, and it says suggestions wait for the shift-note run", code == 0 and "ON (left as it is)" in out and "wait until shift-note flags run too" in out
       and db("select (data->>'kind_words_suggest_live')::boolean from app_data where key = 'ops_settings'") is True, out)
    fresh_db(); c = conn(); c.run("create policy kw_open on public.kind_words for select to authenticated using (true)"); c.close()
    code, out = run()
    ck("proof not right (a stranger could read suggestions): NOT DONE", code == 8 and "CHECK THE ✗ LINES" in out, out)
    fresh_db(); M["practice"] = {"error": "AxisCare credentials not set on this project"}
    code, out = run()
    ck("the practice run fails: NOT DONE, says so", code == 8 and "did not answer" in out, out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d in res: print(("PASS" if okk else "FAIL"), "·", n, d)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
