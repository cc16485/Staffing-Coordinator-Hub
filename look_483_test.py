#!/usr/bin/env python3
# Rehearsal of the 483 look against a throwaway local Postgres behind a fake Supabase query API. Never touches a real project.
import json, os, subprocess, sys, tempfile, threading, http.server
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
REF = "zngsgedlsxinbygwmxwn"
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
WRITES = []
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body, default=str).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        if self.headers.get("Authorization") != "Bearer sbp_fake": return self._send(401, {"message": "bad token"})
        q = json.loads(raw)["query"]
        if any(w in q.lower() for w in (" insert ", "update ", "delete ", " drop ", "create ", "alter ", "truncate")) or q.lower().startswith(("insert", "update", "delete")): WRITES.append(q)
        cc = conn()
        try:
            rows = cc.run(q); cols = [c["name"] for c in (cc.columns or [])]
            return self._send(201, [dict(zip(cols, r)) for r in (rows or [])])
        except DatabaseError as e:
            return self._send(400, {"message": str(e)[:200]})
        finally: cc.close()
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
c = conn()
c.run("drop schema if exists public cascade; drop schema if exists cron cascade; create schema public; create schema cron")
c.run("create table cron.job(jobid int, jobname text, schedule text, active boolean)")
c.run("insert into cron.job values (1,'client-start-run','35 * * * *',true),(2,'client-journey-sweep','*/10 * * * *',true)")
c.run("create table public.app_data(key text primary key, data jsonb)")
c.run("create table public.client_queue(id serial primary key, client_name text, axiscare_client_id text, status text, episode_n int, source text, added_at timestamptz default now(), caregiver_assigned_name text, caregiver_assigned boolean, caregiver_called boolean, client_called boolean, schedule_added boolean, evv_verified boolean, first_shift_done boolean, followup_client_done boolean, followup_caregiver_done boolean)")
c.run("create table public.client_admission_case(axiscare_client_id text, axiscare_name text, observed_label text, opened_at timestamptz, status text)")
c.run("create table public.client_journey(client_name text, payer text, is_test boolean, status text, created_at timestamptz default now())")
leads = [
  {"id": "L1", "client_first_name": "Mary", "client_last_name": "Medicaid", "funding_source": "Medicaid IHS", "status": "Contacted", "assigned_coordinator": "angiel@mo-care.com", "phone": "417-555-1234", "email": "fam@example.com",
   "axiscare_client_id": "301", "soc": {"pathway": "A1", "started_at": "2026-09-20T10:00:00Z", "steps": [{"id": "p0", "label": "Intake call", "done_at": "2026-09-21T10:00:00Z", "done_by": "angiel@mo-care.com"}, {"id": "p1", "label": "Explain HCBS"}]}},
  {"id": "L2", "client_first_name": "Pete", "client_last_name": "Private", "funding_source": "private pay", "status": "New", "created_at": "2026-10-01"},
  {"id": "L3", "first_name": "Old", "last_name": "Lost", "status": "Lost", "soc": {"pathway": "PP", "steps": []}},
  {"id": "L4", "client_first_name": "Cass", "client_last_name": "Cds", "funding_source": "CDS", "status": "New"},
  {"id": "L5", "client_first_name": "Rita", "client_last_name": "Ready", "funding_source": "private", "status": "Converted", "axiscare_client_id": "302",
   "soc": {"pathway": "PP", "started_at": "2026-09-01", "ready_for_staffing_at": "2026-09-10", "launch_upserted_at": "2026-09-10", "steps": [{"id": "p0", "label": "Assessment", "done_at": "2026-09-02", "done_by": "krystal@mo-care.com"}]}}]
c.run("insert into public.app_data values ('leads', :d), ('ops_settings', :o), ('ops_items', :i)", d=json.dumps(leads), o=json.dumps({"client_start_live": True}),
      i=json.dumps([{"id": "cstart_L1", "kind": "client_start", "title": "Mary's start is stuck", "owner": "angiel@mo-care.com"},
                    {"id": "p1", "kind": "project", "template": "client_start", "title": "Ed Anderson coming home", "steps": [{"done": True}, {}]},
                    {"id": "x", "kind": "client_start", "status": "done", "title": "closed one"}]))
c.run("insert into public.client_queue(client_name, axiscare_client_id, status, episode_n, source, caregiver_assigned, caregiver_assigned_name) values ('Rita Ready','302','open',1,'soc_handoff',true,'Cara Giver'),('Done Person','303','complete',1,'webhook',true,null)")
c.run("insert into public.client_admission_case values ('296','Edward Anderson','Active','2026-09-29','open'),('290','Old Closed','Active','2026-09-01','closed')")
c.run("insert into public.client_journey(client_name,payer,is_test,status) values ('Linda Boyd (TEST)','medicaid',true,'open')")
before = c.run("select key, md5(data::text) from public.app_data order by key") + c.run("select count(*) from public.client_queue")
T = tempfile.mkdtemp(prefix="look483-"); rep = os.path.join(T, "r.txt")
def run(**over):
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(HERE, "look_483.py")], env=env, capture_output=True, text=True, timeout=120)
    return p.returncode, open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
code, out = run()
ck("it finishes", code == 0, out)
ck("switches read", "client_start_live: ON" in out and "client_journey_live: off" in out, out)
ck("jobs listed", "client-start-run" in out and "client-journey-sweep" in out, out)
ck("Mary with her checklist, ticked step and next", "Mary Medicaid · Medicaid · path A1 · 1/2 ticked · before staffing" in out and "next unticked: Explain HCBS" in out and "✓ Intake call" in out, out)
ck("Rita shows as handed to First shift", "Rita Ready · Private · path PP · 1/1 ticked · handed to First shift" in out, out)
ck("Lost lead left out", "Old Lost" not in out, out)
ck("leads without checklist counted, CDS named", "Pete Private · New · Private" in out and "Cass Cds · New · CDS" in out, out)
ck("open launch with its lead and ticks", "Rita Ready · AxisCare #302 · episode 1 · from soc_handoff" in out and "lead: Rita Ready (checklist)" in out and "ticked: caregiver_assigned" in out, out)
ck("complete launch left out", "Done Person" not in out, out)
ck("Ed's admission card", "Edward Anderson · AxisCare #296 · waiting since 2026-09-29" in out and "Old Closed" not in out, out)
ck("open work counted, closed left out", "1 'start is stuck' items" in out and "Ed Anderson coming home · client_start · 1/2" in out, out)
ck("existing TEST journey listed", "Linda Boyd (TEST) · medicaid · TEST" in out, out)
ck("no phone or email printed", "555" not in out and "@" not in out and "example.com" not in out, out)
ck("nothing written", not WRITES and before == c.run("select key, md5(data::text) from public.app_data order by key") + c.run("select count(*) from public.client_queue"), WRITES)
code, out = run(SB_TOKEN="")
ck("no token: stops before reading", code == 2 and "Nothing was read" in out, out)
for n, okk, note in res: print(("PASS" if okk else "FAIL") + " · " + n + ("" if okk else "\n" + note))
f = sum(1 for r in res if not r[1]); print(f"{len(res) - f} passed, {f} failed"); sys.exit(1 if f else 0)
