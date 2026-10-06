#!/usr/bin/env python3
# Rehearsal of 476 from a FRESH copy at the commit being tested, against a FAKE Supabase (a throwaway local Postgres).
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
T = tempfile.mkdtemp(prefix="reh476-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
d = lambda n: (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=5) + dt.timedelta(days=n))
PLANS = [{"id": "tb_x08746980", "client": "Ed", "status": "building", "level": 2, "days": ["mon","tue","wed","thu","fri","sat","sun"],
  "slots": [{"k": "s1", "label": "Shift 1", "start": "09:00", "end": "17:00"}, {"k": "s2", "label": "Shift 2", "start": "09:00", "end": "17:00"}],
  "cells": {"mon|s2": {"name": "Kim Aide", "status": "penciled"}}}, {"id": "tb_other", "client": "Example"}]
OPS = [{"id": "ops_1", "kind": "request", "status": "open", "title": "Something else"}]
K, S = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
def fresh(roles=True):
    c = conn(); setup(c); c.run("create table public.app_data(key text primary key, data jsonb, version int default 1)")
    c.run("create table public.op_events(actor_email text, actor_name text, verb text, item_id text, area text, summary text, data jsonb)")
    c.run("insert into public.app_data values ('staffing_plans', :d::jsonb, 1)", d=json.dumps(PLANS))
    c.run("insert into public.app_data values ('ops_items', :d::jsonb, 1)", d=json.dumps(OPS))
    c.run(f"insert into public.persons(person_id, full_name, primary_email) values ('{K}', 'Krystal Land', 'Krystal@mo-care.com'), ('{S}', 'Sally Staffing', 'sally@mo-care.com')")
    if roles: c.run(f"insert into public.staff_roles values ('{K}', 'cc_ihs', 'care_coordinator'), ('{S}', 'cc_ihs', 'staffing_coordinator')")
    else: c.run("delete from public.staff_roles where person_id in (select person_id from public.persons where lower(primary_email) = 'krystal@mo-care.com')")
    c.close()
def run():
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    p = subprocess.run([sys.executable, os.path.join(W, "ed_project_476.py")], env=dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL), capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
def get(k):
    c = conn()
    try: x = c.run(f"select data from app_data where key = '{k}'")[0][0]
    finally: c.close()
    return json.loads(x) if isinstance(x, str) else x
try:
    fresh(); code, out = run(); P = {p["id"]: p for p in get("staffing_plans")}; O = get("ops_items"); pj = next((i for i in O if i["id"] == "ops_proj_ed_anderson_476"), None)
    ck("DONE", code == 0 and "RESULT: DONE" in out, out)
    ck("plan: named Ed Anderson, Mornings 9-2 and Evenings 4-9, keys kept, Kim still penciled on Monday evening", P["tb_x08746980"]["client"] == "Ed Anderson" and [(s["k"], s["label"], s["start"], s["end"]) for s in P["tb_x08746980"]["slots"]] == [("s1","Mornings","09:00","14:00"),("s2","Evenings","16:00","21:00")] and P["tb_x08746980"]["cells"]["mon|s2"]["name"] == "Kim Aide" and P["tb_x08746980"]["level"] == 2, P["tb_x08746980"])
    ck("the other plan untouched", P["tb_other"] == {"id": "tb_other", "client": "Example"})
    ck("project: Krystal owns it, Sally on the team (also_for), ready Oct 13, sign-off, all hands", pj and pj["owner"] == "krystal@mo-care.com" and pj["team"] == ["sally@mo-care.com"] and pj["also_for"] == ["sally@mo-care.com"] and pj["ready_by"] == "2026-10-13" and pj["signoff"]["needed"] and pj["all_hands"]["on"] and pj["kind"] == "project", pj)
    ck("8 steps, Pamela in step 1, recruiting Sally's, shifts both, all due by Oct 13", pj and len(pj["steps"]) == 8 and "Pamela Anderson (daughter), ask for 48 hours notice" in pj["steps"][0]["label"] and pj["steps"][3]["who"] == ["sally@mo-care.com"] and pj["steps"][4]["who"] == ["krystal@mo-care.com", "sally@mo-care.com"] and all(s["due"] <= "2026-10-13" for s in pj["steps"]), pj and pj["steps"])
    ck("the other work item untouched; one event recorded", O[0]["id"] == "ops_1" and len(O) == 2)
    ck("the report keeps emails out", "@mo-care.com" not in out, out)
    code, out = run()
    ck("run again: nothing changed, no second project", code == 0 and "plan is already named" in out and "already there" in out and len(get("ops_items")) == 2, out)
    fresh(roles=False); code, out = run()
    ck("Krystal without an office role: stops, nothing changed", code == 6 and get("staffing_plans")[0]["client"] == "Ed" and len(get("ops_items")) == 1, out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
