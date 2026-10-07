#!/usr/bin/env python3
# Rehearsal of 495, run the way the Desktop step runs it: from a FRESH copy of this repository at the commit being
# tested, against a FAKE Supabase whose database calls run on a throwaway local Postgres set up like the real one.
# Never touches a real project.
import json, os, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
src495 = open(os.path.join(HERE, "my_desk_495_sql_test.py")).read()
exec(src495[src495.index("def setup495"):src495.index("c = conn(); setup495(c)")])          # conn(), setup() and the made-up people on a throwaway database
from pg8000.native import DatabaseError
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
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
T = tempfile.mkdtemp(prefix="reh495-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PINS = {f: sha(os.path.join(W, f)) for f in ("my_desk_495.sql", "my_desk_495_proof.sql", "my_desk_495_rollback.sql")}
def db(q):
    c = conn()
    try: return c.run(q)[0][0]
    finally: c.close()
def fresh_db():
    c = conn(); setup495(c); c.close()
tables = lambda: db("select count(*) from pg_class where relnamespace = 'public'::regnamespace and (relname like 'desk\\_%' or relname like 'kind\\_word%') and relkind = 'r'")
def run(skip_sql_test=True, **over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_REPO=W,
               SB_SQL_SHA=PINS["my_desk_495.sql"], SB_PROOF_SHA=PINS["my_desk_495_proof.sql"], SB_ROLLBACK_SHA=PINS["my_desk_495_rollback.sql"],
               SB_REHEARSAL_SKIP_SQL_TEST="1" if skip_sql_test else "0")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "my_desk_495.py")], env=env, capture_output=True, text=True, timeout=1200)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
try:
    fresh_db()
    gone = lambda: db("select to_regclass('public.desk_repeats') is null")
    code, out = run(SB_SQL_SHA="0" * 64)
    ck("a changed SQL file is refused before anything runs", code == 2 and "not the reviewed build" in out and gone(), out)
    c = conn(); c.run("drop table public.desk_pages cascade"); c.close()
    code, out = run()
    ck("463 missing: stops, nothing changed", code == 3 and "463" in out and gone(), out)
    fresh_db()
    code, out = run(skip_sql_test=False)
    ck("happy path: DONE (with the database test re-run from the fresh copy)", code == 0 and "RESULT: DONE" in out and "my_desk_495_sql_test.py:" in out, out)
    for s_ in ("public key cannot read it", "cannot put one on Samantha's desk", "SIGNED repeating task on Krystal's desk", "she cannot stop, change or delete it", "who stopped it and when are stamped"):
        ck(f"...the report proves: {s_}", s_ in out, out)
    ck("...prints no email or key", "@" not in out.replace("(an email)", "") and "sbp_" not in out, out)
    ck("...the proof left nothing behind", db("select count(*) from desk_repeats") == 0)
    code, out = run()
    ck("run again: DONE, says it was already in", code == 0 and "already in" in out, out)
    fresh_db(); c = conn(); c.run("delete from staff_roles where role = 'owner_admin' and person_id = :s", s=SAM); c.close()
    code, out = run()
    ck("proof not right (Samantha not an owner): NOT DONE, and the table is taken back out", code == 8 and "taken back out" in out and gone(), out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d in res: print(("PASS" if okk else "FAIL"), "·", n, d)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
