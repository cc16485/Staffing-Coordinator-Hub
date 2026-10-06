#!/usr/bin/env python3
# Rehearsal of 471 from a FRESH copy at the commit being tested, against a FAKE Supabase (a throwaway local Postgres).
import json, os, subprocess, sys, tempfile, threading, http.server, shutil, datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
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
T = tempfile.mkdtemp(prefix="reh471-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
d = lambda n: (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=5) + dt.timedelta(days=n))
LEADS = [
  {"id": "a", "first_name": "Shawn", "last_name": "Alcorn", "status": "Assessment Scheduled", "assessment_at": "Monday, September 14, 2026 1:30 PM", "phone": "4175551212"},
  {"id": "b", "first_name": "Test Dementia", "last_name": "Lead", "status": "Assessment Scheduled"},
  {"id": "c", "first_name": "Tammy", "last_name": "Smith", "status": "Assessment Scheduled", "assessment_at": d(2).strftime("%A, %B %-d, %Y") + " 2:00 PM"},
  {"id": "e", "first_name": "Old", "last_name": "Iso", "status": "Assessment Scheduled", "assessment_at": d(-3).strftime("%Y-%m-%dT10:00"), "do_not_contact": False},
  {"id": "f", "first_name": "Won", "last_name": "Already", "status": "Converted"},
  {"id": "g", "first_name": "Gone", "last_name": "Archived", "status": "Assessment Scheduled", "archived": True},
  {"id": "h", "first_name": "Todays", "last_name": "Visit", "status": "Assessment Scheduled", "assessment_at": d(0).strftime("%Y-%m-%d")}]
def fresh():
    c = conn(); setup(c); c.run("create table public.app_data(key text primary key, data jsonb, version int default 1)")
    c.run("insert into public.app_data values ('leads', :d::jsonb, 1)", d=json.dumps(LEADS)); c.close()
def run():
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    p = subprocess.run([sys.executable, os.path.join(W, "spam_471.py")], env=dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL), capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
def leads():
    c = conn()
    try: x = c.run("select data from app_data where key = 'leads'")[0][0]
    finally: c.close()
    x = json.loads(x) if isinstance(x, str) else x
    return {l["id"]: l for l in x}
try:
    fresh(); code, out = run(); L = leads()
    ck("DONE", code == 0 and "RESULT: DONE" in out, out)
    ck("past date, no date and a past ISO date are marked spam the Hub's way", all(L[k]["status"] == "Lost" and L[k]["lost_reason"] == "Spam (not a real inquiry)" and L[k]["archived"] is True and L[k]["do_not_contact"] is True and L[k]["spam"]["by"] == "samantha@mo-care.com" for k in "abe"), [L[k] for k in "abe"])
    ck("...what each was before is kept, so Not spam can put it back", L["a"]["spam"]["before"]["status"] == "Assessment Scheduled" and L["a"]["spam"]["before"]["archived"] is False and L["e"]["spam"]["before"]["do_not_contact"] is False, L["a"]["spam"])
    ck("left alone: an assessment ahead, one today, a won lead, an archived one", L["c"]["status"] == "Assessment Scheduled" and "spam" not in L["c"] and L["h"]["status"] == "Assessment Scheduled" and L["f"]["status"] == "Converted" and "spam" not in L["g"])
    ck("the report names them and keeps phone numbers out", "Shawn Alcorn · assessment Monday, September 14" in out and "Test Dementia Lead · assessment no date saved" in out and "left alone (assessment still ahead): 2" in out and "4175551212" not in out, out)
    code, out = run()
    ck("run again: nothing more to mark", code == 0 and "to mark as spam (past date or no date): 0" in out and leads()["a"]["spam"]["at"] == L["a"]["spam"]["at"], out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
