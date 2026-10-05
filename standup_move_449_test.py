#!/usr/bin/env python3
# Rehearsal of 449, run the way the Desktop step runs it: from a FRESH copy of this repository at the commit being
# tested, against a FAKE Supabase whose database calls run on a throwaway local Postgres set up like the real one, and
# fake live pages. Never touches a real project. CC_HUB / TEAM_HUB: the working copies whose new pages are served.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "standup_move_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])          # conn() and setup() on a throwaway database
from pg8000.native import DatabaseError
CC = os.environ.get("CC_HUB", os.path.join(HERE, "..", "cc-hub-live")); TH = os.environ.get("TEAM_HUB", os.path.join(HERE, "..", "team-hub"))
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
M = {"hub": "new", "team": "new"}; SEEN = []
OLD_QA = "<script>sb.rpc('submit_standup_note_public', {})</script>"
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else (body.encode() if isinstance(body, str) else json.dumps(body).encode())
        self.send_response(code); self.send_header("Content-Type", ctype); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/hub/standup-board.js": return self._send(200, open(os.path.join(CC, "standup-board.js")).read(), "text/javascript") if M["hub"] == "new" else self._send(404, "")
        if p == "/hub/index.html": return self._send(200, open(os.path.join(CC, "index.html")).read() if M["hub"] == "new" else "<html>old</html>", "text/html")
        if p == "/team/quick-add.html": return self._send(200, open(os.path.join(TH, "quick-add.html")).read() if M["team"] == "new" else OLD_QA, "text/html")
        return self._send(404, {})
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if not self.path.endswith(f"/v1/projects/{REF}/database/query"): return self._send(404, {})
        if self.headers.get("Authorization") != "Bearer sbp_fake": return self._send(401, {"message": "bad token"})
        q = json.loads(raw)["query"]; SEEN.append(q); cc = conn()
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
T = tempfile.mkdtemp(prefix="reh449-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PINS = {f: sha(os.path.join(W, f)) for f in ("standup_move.sql", "standup_move_proof.sql", "standup_move_rollback.sql")}
def db(q):
    c = conn()
    try: return c.run(q)[0][0]
    finally: c.close()
def fresh_db():
    c = conn(); setup(c); c.close()
anon_can = lambda: db("select has_function_privilege('anon', 'submit_standup_note_public(text,text,text,text,text)'::regprocedure, 'execute')")
mapped = lambda: db("select count(*) from app_data_key_hub_map where hub_slug = 'care_coordinator' and data_key in ('standup_notes','team_meetings')")
def run(skip_sql_test=True, **over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_REPO=W, SB_HUB_BASE=URL + "/hub/", SB_TEAM_BASE=URL + "/team/",
               SB_SQL_SHA=PINS["standup_move.sql"], SB_PROOF_SHA=PINS["standup_move_proof.sql"], SB_ROLLBACK_SHA=PINS["standup_move_rollback.sql"],
               SB_REHEARSAL_SKIP_SQL_TEST="1" if skip_sql_test else "0")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "standup_move_449.py")], env=env, capture_output=True, text=True, timeout=900)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
try:
    fresh_db()
    code, out = run(SB_SQL_SHA="0" * 64)
    ck("a changed SQL file is refused before anything runs", code == 2 and "not the reviewed build" in out and anon_can(), out)
    M["hub"] = "old"; code, out = run()
    ck("the Hub not live yet: stops, nothing changed", code == 3 and "isn't showing the new Stand-Up tab" in out and anon_can() and mapped() == 0, out)
    M["hub"] = "new"; M["team"] = "old"; code, out = run()
    ck("the old quick-add page still live: stops, nothing changed (the door isn't closed under a page people use)", code == 3 and "quick-add page is still the live one" in out and anon_can() and mapped() == 0, out)
    M["team"] = "new"; n0 = len(SEEN); code, out = run(skip_sql_test=False)
    ck("happy path: DONE (with the database test re-run from the fresh copy)", code == 0 and "RESULT: DONE" in out and "standup_move_sql_test.py: 25 passed, 0 failed" in out, out)
    ck("...the door is closed, the CC Hub can reach both lists, the room is copied", not anon_can() and mapped() == 2 and db("select data->'team_video_room'->>'copied_from' from app_data where key = 'ops_settings'") == "team_hub_settings")
    ck("...the report says what it proved", all(s in out for s in ("can't be called from outside", "CC Hub-only person can read the board (1 of 1)", "add an item to the board (went in)",
        "old Staffing hub still can't see the board", "Team Hub's own settings stay out", "same room as the Team Hub's")), out)
    ck("...and prints no room name, email or key", "abc123xyz" not in out and "@" not in out.replace("(an email)", "") and "sbp_" not in out, out)
    ck("...the proof left the board as it was", db("select data from app_data where key = 'standup_notes'") == [{"id": "s1", "summary": "Night call-out"}])
    code, out = run()
    ck("run again: DONE, and says it was already in place", code == 0 and "RESULT: DONE" in out and "CC Hub already included" in out and "already closed" in out, out)
    # a proof that isn't exactly right takes the change back off
    fresh_db()
    c = conn(); c.run("create policy no_board_writes on app_data as restrictive for update to authenticated using (key <> 'standup_notes')"); c.close()
    code, out = run()
    ck("proof not right (the CC Hub can't add): NOT DONE, and the change is taken back off", code == 8 and "RESULT: NOT DONE" in out and "taken back off" in out and anon_can() and mapped() == 0
       and "team_video_room" not in db("select data from app_data where key = 'ops_settings'"), out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d in res: print(("PASS" if okk else "FAIL"), "·", n, d)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
