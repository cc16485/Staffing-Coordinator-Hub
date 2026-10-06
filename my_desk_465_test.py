#!/usr/bin/env python3
# Rehearsal of 465, run the way the Desktop step runs it: from a FRESH copy of this repository at the commit being
# tested, against a FAKE Supabase whose database calls run on a throwaway local Postgres set up like the real one.
# Never touches a real project.
import json, os, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_465_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
src465 = open(os.path.join(HERE, "my_desk_465_sql_test.py")).read()
exec(src465[src465.index("def setup465"):src465.index("c = conn(); setup465(c)")])          # conn(), setup() and the made-up people on a throwaway database
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
T = tempfile.mkdtemp(prefix="reh465-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PINS = {f: sha(os.path.join(W, f)) for f in ("my_desk_465.sql", "my_desk_465_proof.sql", "my_desk_465_rollback.sql")}
def db(q):
    c = conn()
    try: return c.run(q)[0][0]
    finally: c.close()
def fresh_db():
    c = conn(); setup(c); c.close()
tables = lambda: db("select count(*) from pg_class where relnamespace = 'public'::regnamespace and (relname like 'desk\\_%' or relname like 'kind\\_word%') and relkind = 'r'")
def run(skip_sql_test=True, **over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_REPO=W,
               SB_SQL_SHA=PINS["my_desk_465.sql"], SB_PROOF_SHA=PINS["my_desk_465_proof.sql"], SB_ROLLBACK_SHA=PINS["my_desk_465_rollback.sql"],
               SB_REHEARSAL_SKIP_SQL_TEST="1" if skip_sql_test else "0")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "my_desk_465.py")], env=env, capture_output=True, text=True, timeout=1200)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
try:
    def fresh_db():
        c = conn(); setup465(c); c.close()
    fresh_db()
    code, out = run(SB_SQL_SHA="0" * 64)
    ck("a changed SQL file is refused before anything runs", code == 2 and "not the reviewed build" in out and db("select to_regprocedure('public.kind_word_deliver(uuid)') is null"), out)
    c = conn(); c.run("drop table public.domains"); c.close()
    code, out = run()
    ck("no domains table: stops, nothing changed", code == 3 and "domains" in out and db("select to_regprocedure('public.kind_word_deliver(uuid)') is null"), out)
    fresh_db()
    code, out = run(skip_sql_test=False)
    ck("happy path: DONE (with the database test re-run from the fresh copy)", code == 0 and "RESULT: DONE" in out and "my_desk_465_sql_test.py:" in out, out)
    for s_ in ("Client Care's owner is Krystal", "only the server tucks it", "not hers", "lands on Krystal's desk", "and all of them are in the jar", "but not what is under Samantha's"):
        ck(f"...the report proves: {s_}", s_ in out, out)
    ck("...prints no email or key", "@" not in out.replace("(an email)", "") and "sbp_" not in out, out)
    ck("...the proof left nothing behind", db("select (select count(*) from kind_words) + (select count(*) from kind_word_drops)") == 0)
    code, out = run()
    ck("run again: DONE, says it was already in", code == 0 and "already in" in out, out)
    fresh_db(); c = conn(); c.run("delete from domains"); c.run("delete from staff_roles where role = 'owner_admin' and person_id = :s", s=SAM); c.close()
    code, out = run()
    ck("proof not right (Samantha not an owner): NOT DONE, and 463's behaviour is put back", code == 8 and "went back to how 463 left them" in out and db("select to_regprocedure('public.kind_word_deliver(uuid)') is null"), out)
finally: cc.close()
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
T = tempfile.mkdtemp(prefix="reh465-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PINS = {f: sha(os.path.join(W, f)) for f in ("my_desk_465.sql", "my_desk_465_proof.sql", "my_desk_465_rollback.sql")}
def db(q):
    c = conn()
    try: return c.run(q)[0][0]
    finally: c.close()
def fresh_db():
    c = conn(); setup(c); c.close()
tables = lambda: db("select count(*) from pg_class where relnamespace = 'public'::regnamespace and (relname like 'desk\\_%' or relname like 'kind\\_word%') and relkind = 'r'")
def run(skip_sql_test=True, **over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_REPO=W,
               SB_SQL_SHA=PINS["my_desk_465.sql"], SB_PROOF_SHA=PINS["my_desk_465_proof.sql"], SB_ROLLBACK_SHA=PINS["my_desk_465_rollback.sql"],
               SB_REHEARSAL_SKIP_SQL_TEST="1" if skip_sql_test else "0")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "my_desk_465.py")], env=env, capture_output=True, text=True, timeout=1200)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
try:
    fresh_db()
    code, out = run(SB_SQL_SHA="0" * 64)
    ck("a changed SQL file is refused before anything runs", code == 2 and "not the reviewed build" in out and tables() == 0, out)
    code, out = run(SB_TOKEN="nope")
    ck("no token: stops, nothing changed", code == 2 and tables() == 0, out)
    c = conn(); c.run("alter table staff_roles rename to staff_roles_x"); c.close()
    code, out = run()
    ck("role table missing: stops, nothing changed", code == 3 and "aren't there as expected" in out and tables() == 0, out)
    c = conn(); c.run("alter table staff_roles_x rename to staff_roles"); c.run("create table public.desk_lines(id int)"); c.close()
    code, out = run()
    ck("a half-made earlier try: stops, nothing changed", code == 3 and "1 of the 7" in out, out)
    c = conn(); c.run("drop table public.desk_lines"); c.close()
    code, out = run(skip_sql_test=False)
    ck("happy path: DONE (with the database test re-run from the fresh copy)", code == 0 and "RESULT: DONE" in out and "my_desk_465_sql_test.py:" in out and "checks passed" in out, out)
    ck("...all 7 tables are in", tables() == 7)
    for s in ("Samantha is an Owner", "public key can't read", "Krystal can write on her own page", "can't read or write on Samantha's desk", "can read Krystal's desk",
              "can't change Krystal's lines", "leave Krystal a signed note", "but not change its words", "can't mark it seen for Krystal", "stop-by is recorded",
              "star a finished line", "can't give stars", "clip a kind word", "suggested kind word is kind", "own desk stays closed"):
        ck(f"...the report proves: {s}", s in out, out)
    ck("...lists the team by first name, with Angiel's missing role shown", "· Angiel: Hub role none · can sign in · no CC Hub access" in out or "· Angiel: Hub role none" in out, out)
    ck("...prints no email or key", "@" not in out.replace("(an email)", "") and "sbp_" not in out, out)
    ck("...the proof left nothing behind", db("select (select count(*) from desk_lines) + (select count(*) from desk_stickies) + (select count(*) from desk_visits) + (select count(*) from kind_words)") == 0)
    code, out = run()
    ck("run again: DONE, and says it was already there", code == 0 and "already there" in out and "RESULT: DONE" in out, out)
    # a proof that isn't exactly right takes new storage back out
    fresh_db()
    c = conn(); c.run("delete from staff_roles where role = 'owner_admin' and entity = 'cc_ihs' and person_id = :s", s=SAM); c.close()
    code, out = run()
    ck("proof not right (Samantha not an owner): NOT DONE, and the new storage is taken back out", code == 8 and "RESULT: NOT DONE" in out and "taken back out" in out and tables() == 0, out)
    ck("...and people, sign-ins and roles are untouched", db("select count(*) from persons") == 5 and db("select count(*) from staff_roles") == 3)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d in res: print(("PASS" if okk else "FAIL"), "·", n, d)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
