#!/usr/bin/env python3
# Rehearsal of 468 from a FRESH copy of this repository at the commit being tested, against a FAKE Supabase (a throwaway
# local Postgres with app_data, domains and persons; a fake deploy command; fake function settings). Never touches a real project.
import json, os, subprocess, sys, tempfile, threading, http.server, hashlib, shutil, datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
M = {"ver": {"care-notes": 9, "coverage-watch": 30}, "deploy_fail": False}
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer sbp_fake": return self._send(401, {})
        for fn in M["ver"]:
            if self.path == f"/v1/projects/{REF}/functions/{fn}": return self._send(200, {"version": M["ver"][fn], "verify_jwt": fn == "care-notes"})
        return self._send(404, {})
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        if self.path.startswith("/bump/"): M["ver"][self.path[6:]] += 1; return self._send(200, {})
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
            return self._send(400, {"message": "Failed to run sql query: ERROR: " + m})
        finally: cc.close()
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
T = tempfile.mkdtemp(prefix="reh468-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
FNROOT = os.path.join(W, "supabase", "functions"); sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PINS = {"care-notes": sha(os.path.join(FNROOT, "care-notes", "index.ts")), "coverage-watch": sha(os.path.join(FNROOT, "coverage-watch", "index.ts")), "_shared/loops": sha(os.path.join(FNROOT, "_shared", "loops.ts"))}
LOG = os.path.join(T, "deploys.txt"); CLI = os.path.join(T, "supabase")
open(CLI, "w").write(f"#!/bin/sh\necho \"$@\" >> {LOG}\n[ -f {T}/fail ] && {{ echo boom >&2; exit 1; }}\nfn=$3\ncurl -s -o /dev/null -X POST {URL}/bump/$fn\nexit 0\n"); os.chmod(CLI, 0o755)
now = dt.datetime.now(dt.timezone.utc); I = lambda h: (now + dt.timedelta(hours=h)).isoformat().replace("+00:00", "Z")
chi_day = lambda d: (now - dt.timedelta(hours=5) + dt.timedelta(days=d)).strftime("%Y-%m-%d")
ITEMS = [
  {"id": "old_train", "kind": "request", "title": "Verify training records — Robin", "status": "open", "owner": "krystal@mo-care.com", "due": I(-24 * 19), "history": [{"at": I(-500), "by": "x", "text": "made"}]},
  {"id": "old_test", "kind": "client_issue", "title": "TEST: Follow up", "status": "open", "due": "2026-09-12T23:59", "escalation": {"to": "s", "level": "urgent"}},
  {"id": "ops_ref_abc", "kind": "request", "title": "No email for this reference: matilda", "status": "open", "due": I(-24 * 11)},
  {"id": "ops_cov_x", "kind": "coverage", "title": "Uncovered shift", "status": "open", "coverage_case_id": "k1", "due": I(-24 * 9)},
  {"id": "ops_cov_censusdown_2026-09-19", "kind": "coverage", "title": "Cara is HOLDING all callouts", "status": "open", "due": I(-24 * 17)},
  {"id": "recent", "kind": "request", "title": "Recent late", "status": "open", "due": I(-24 * 3)},
  {"id": "cn1", "kind": "care_note", "title": "Possible concern on Patsy's visit", "status": "open", "owner": "", "due": I(-24 * 2)},
  {"id": "cn2", "kind": "care_note", "title": "Possible concern 2", "status": "open", "due": I(5)},
  {"id": "cn_owned", "kind": "care_note", "title": "Owned", "status": "open", "owner": "samantha@mo-care.com", "due": I(5)},
  {"id": "fam_ahead", "kind": "family_call", "case_id": "k2", "title": "Call Ashley Gruss's family: the Thu, Oct 8, 2:30pm-5:30pm shift wasn't covered", "detail": "Nobody covered this shift. A person calls the family.", "status": "open", "due": I(-1)},
  {"id": "fam_past", "kind": "family_call", "case_id": "k3", "title": "Call X's family: the Mon shift wasn't covered", "detail": "Nobody covered this shift.", "status": "open", "due": I(-1)},
  {"id": "done_old", "kind": "request", "title": "already done", "status": "done", "due": I(-24 * 30)}]
CASES = [{"id": "k1", "status": "open"}, {"id": "k2", "status": "done", "shift_date": chi_day(2), "shift_time": "14:30-17:30"}, {"id": "k3", "status": "done", "shift_date": chi_day(-2), "shift_time": "09:00-10:00"}]
def fresh_db(owner=True, ops='{"fresh_start_last":{"id":"fs_old","ids":["a"]}}'):
    c = conn(); setup(c)
    c.run("create table public.app_data(key text primary key, data jsonb, version int default 1)")
    c.run("insert into public.app_data values ('ops_items', :d::jsonb, 1), ('coverage_cases', :c::jsonb, 1), ('ops_settings', :o::jsonb, 1)", d=json.dumps(ITEMS), c=json.dumps(CASES), o=ops)
    c.run("create table public.domains(entity text, code text, owner_person uuid, primary key (entity, code))")
    if owner: c.run("insert into public.domains values ('cc_ihs', 'client_care', :k)", k=KRY)
    c.close()
    for f in (LOG, os.path.join(T, "fail")):
        if os.path.exists(f): os.remove(f)
def run(**over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_SUPA_CLI=CLI, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(PINS), SB_SETTLE="0"); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "needs_attention_468.py")], env=env, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
def items():
    c = conn()
    try: d = c.run("select data from app_data where key = 'ops_items'")[0][0]
    finally: c.close()
    d = json.loads(d) if isinstance(d, str) else d
    return {i["id"]: i for i in d}
def ops():
    c = conn()
    try: d = c.run("select data from app_data where key = 'ops_settings'")[0][0]
    finally: c.close()
    return json.loads(d) if isinstance(d, str) else d
try:
    fresh_db()
    code, out = run(SB_FN_SHAS=json.dumps(dict(PINS, **{"care-notes": "0" * 64})))
    ck("a changed function is refused before anything runs", code == 2 and "not the reviewed build" in out and not os.path.exists(LOG) and items()["old_train"]["status"] == "open", out)
    fresh_db(); open(os.path.join(T, "fail"), "w").write("1"); code, out = run()
    ck("a failed deploy: stops, nothing in Needs Attention changed", code == 6 and "nothing in Needs Attention was changed" in out and items()["old_train"]["status"] == "open", out)
    fresh_db(); code, out = run(); it = items()
    ck("happy path: DONE", code == 0 and "RESULT: DONE" in out, out)
    ck("...more than a week late closes like Fresh start (training checks and the TEST item and the September census card too)",
       all(it[k]["status"] == "done" and it[k]["resolution_code"] == "fresh_start" and it[k]["fresh_start"].startswith("fs_468_") for k in ("old_train", "old_test", "ops_cov_censusdown_2026-09-19")), [it[k] for k in ("old_train", "old_test")])
    ck("...with a note and a history line, and an open escalation cleared", "more than a week past due" in it["old_train"]["close_note"] and it["old_train"]["history"][-1]["text"].startswith("Cleared in the fresh start") and len(it["old_train"]["history"]) == 2 and it["old_test"]["escalation"]["cleared_at"], it["old_test"])
    ck("...left open: a reference card (it would come back), a card whose case is open, anything under a week late", it["ops_ref_abc"]["status"] == "open" and it["ops_cov_x"]["status"] == "open" and it["recent"]["status"] == "open")
    ck("...unowned shift-note flags go to Client Care (Krystal); an owned one is left with its owner", it["cn1"]["owner"] == "krystal@mo-care.com" and it["cn1"]["owner_name"] == "Krystal Land" and it["cn2"]["owner"] == "krystal@mo-care.com" and it["cn_owned"]["owner"] == "samantha@mo-care.com" and "Given to Client Care" in it["cn1"]["history"][-1]["text"], it["cn1"])
    ck("...a family-call card for a shift still ahead says \"won't be covered\"; one already past is left alone", "won't be covered" in it["fam_ahead"]["title"] and "Nobody is covering this shift." in it["fam_ahead"]["detail"] and "wasn't covered" in it["fam_past"]["title"], [it["fam_ahead"]["title"], it["fam_past"]["title"]])
    ck("...a done item is untouched", it["done_old"] == [i for i in ITEMS if i["id"] == "done_old"][0])
    o = ops()
    ck("...Undo is ready: the batch is fresh_start_last, the earlier one kept as fresh_start_prev", o["fresh_start_last"]["id"].startswith("fs_468_") and sorted(o["fresh_start_last"]["ids"]) == sorted(["old_train", "old_test", "ops_cov_censusdown_2026-09-19"]) and o["fresh_start_prev"]["id"] == "fs_old", o)
    ck("...both functions deployed, gateway settings kept", "deploy care-notes" in open(LOG).read() and "--no-verify-jwt" in [l for l in open(LOG).read().splitlines() if "coverage-watch" in l][0] and "--no-verify-jwt" not in [l for l in open(LOG).read().splitlines() if "care-notes" in l][0])
    for s_ in ("Client Care is owned by Krystal Land", "to close (Fresh start, Undo for 7 days): 3", "left open, the Hub reopens them by itself", "to give to Client Care: 2", "to reword: 1", "read back closed in this batch", "read back with Krystal Land", "Undo is ready"):
        ck(f"...the report says: {s_}", s_ in out, out)
    ck("...prints no email or key", "@" not in out.replace("(an email)", "") and "sbp_" not in out, out)
    code, out = run()
    ck("run again: nothing more to close, DONE", code == 0 and "to close (Fresh start, Undo for 7 days): 0" in out, out)
    fresh_db(owner=False); code, out = run(); it = items()
    ck("nobody owns Client Care: says so, flags stay unassigned, the rest still happens", code == 0 and "nobody owns Client Care yet" in out and not it["cn1"].get("owner") and it["old_train"]["status"] == "done", out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d in res: print(("PASS" if okk else "FAIL"), "·", n, d)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
