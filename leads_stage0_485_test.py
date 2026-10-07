#!/usr/bin/env python3
# Rehearsal of 485 (the leads facts move-over) from a FRESH copy at the commit being tested, against a FAKE Supabase: a throwaway
# local Postgres and a fake Management API. Never touches a real project. (python3 leads_stage0_485_test.py; REHEARSE_COMMIT pins a commit)
import json, os, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
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
T = tempfile.mkdtemp(prefix="reh485-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
FNROOT = os.path.join(W, "supabase", "functions"); sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
PINS = {"_shared/lead-rules.js": sha(os.path.join(FNROOT, "_shared", "lead-rules.js"))}
LEADS = [
  {"id": "a1", "client_first_name": "Evelyn", "client_last_name": "Marsh", "urgency": "7days", "days_needed": "Mon, Wed, Fri", "times_needed": "9-1", "number_of_hours": "12", "status": "Contacted", "created_at": "2026-09-30T14:00:00Z", "comm_log": [{"at": "x"}]},
  {"id": "a2", "client_first_name": "Clifford", "client_last_name": "Haney", "urgency": "researching", "status": "Contacted", "nurture_sequence": "not_ready", "nurture_started_at": "2026-09-02T15:00:00Z"},
  {"id": "a3", "client_first_name": "Lost", "client_last_name": "Family", "status": "Lost", "lost_reason": "Went to a facility", "urgency": "today"},
  {"id": "a4", "first_name": "Ruth", "last_name": "Keller", "status": "New", "interest_notes": "Website form submission (no message left)."},
  {"id": "a5", "client_first_name": "Already", "client_last_name": "New", "desired_start": {"kind": "asap"}, "schedule": {"days": ["Mon"], "times": "", "hours_per_week": None}},
  {"id": "TEST-J1", "is_test": True, "client_first_name": "Linda", "client_last_name": "Boyd (TEST)", "status": "Contacted", "urgency": "48hours"}]
def db(q):
    c = conn()
    try: r = c.run(q); return r[0][0] if r else None
    finally: c.close()
def fresh(leads=None):
    c = conn(); setup(c)
    c.run("create table public.app_data(key text primary key, data jsonb, version int default 1)")
    c.run("insert into public.app_data values ('leads', :l::jsonb, 4)", l=json.dumps(leads if leads is not None else LEADS))
    c.run("create or replace function public.app_data_version_bump() returns trigger language plpgsql as $f$ begin new.version := coalesce(old.version,0)+1; return new; end $f$")
    c.run("create trigger bump before update on public.app_data for each row execute function public.app_data_version_bump()")
    c.close()
def run(**over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(PINS)); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "leads_stage0_485.py")], env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
try:
    fresh(); code, out = run(SB_FN_SHAS=json.dumps({"_shared/lead-rules.js": "0" * 64}))
    ck("a changed rules file is refused before anything runs", code == 2 and "not the reviewed build" in out and db("select version from app_data where key='leads'") == 4, out)
    fresh(); code, out = run(SB_TOKEN="nope")
    ck("no token: stops", code == 2 and "no Supabase access token" in out, out)
    fresh(); code, out = run()
    L = {x["id"]: x for x in db("select data from app_data where key='leads'")}
    ck("DONE", code == 0 and "RESULT: DONE" in out and "4 of 6 leads get something" in out, out)
    ck("...Evelyn: start this week from the radio, schedule from the text, old fields still there", L["a1"]["desired_start"]["kind"] == "this_week" and L["a1"]["desired_start"]["from"] == "urgency:7days" and L["a1"]["schedule"]["days_text"] == "Mon, Wed, Fri"
       and L["a1"]["schedule"]["hours_per_week"] == 12 and L["a1"]["urgency"] == "7days" and L["a1"]["days_needed"] == "Mon, Wed, Fri" and L["a1"]["comm_log"] == [{"at": "x"}], L["a1"])
    ck("...Clifford: waiting · family not ready since the drip began, with a check-back in the future", L["a2"]["waiting"]["reason"] == "not_ready" and L["a2"]["waiting"]["since"] == "2026-09-02" and L["a2"]["waiting"]["check_back"] > "2026-10-06"
       and L["a2"]["desired_start"]["kind"] == "planning" and L["a2"]["nurture_sequence"] == "not_ready", L["a2"])
    ck("...the lost family: reason key chose_facility, label untouched", L["a3"]["lost_reason_key"] == "chose_facility" and L["a3"]["lost_reason"] == "Went to a facility" and L["a3"]["desired_start"]["kind"] == "asap", L["a3"])
    ck("...a brand-new website lead with nothing asked gets nothing (not punished)", L["a4"] == LEADS[3], L["a4"])
    ck("...a lead that already had the new facts is untouched", L["a5"] == LEADS[4], L["a5"])
    ck("...the TEST lead is moved too and named as TEST in the report", L["TEST-J1"]["desired_start"]["kind"] == "asap" and "Linda Boyd (TEST) (TEST)" in out, out)
    ck("...the report names each family and what it got", "Evelyn Marsh → start: this week (from urgency:7days); schedule: Mon, Wed, Fri 9-1 · 12 hrs/wk" in out and "Clifford Haney → " in out and "waiting: family not ready since 2026-09-02" in out, out)
    ck("...one write: the version went up by exactly one", db("select version from app_data where key='leads'") == 5, db("select version from app_data where key='leads'"))
    ck("...proof: nothing else changed, run-again finds nothing", "nothing else on any lead changed" in out and "run again: nothing left to move over" in out, out)
    code, out = run()
    ck("run again: DONE, nothing changed, version unchanged", code == 0 and "every lead already had the new facts" in out and db("select version from app_data where key='leads'") == 5, out)
    fresh(leads=[]); code, out = run()
    ck("no leads at all: nothing to do, exit 0", code == 0 and "nothing to do" in out, out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
