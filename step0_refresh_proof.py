#!/usr/bin/env python3
# Desktop 268 (0.0 live refresh) against a fake Management API whose database is a real disposable Postgres.
# Proves: every query runs, nothing is written, phones print as last 4 only, tokens in job commands never print,
# and the read guard refuses a write. Never touches production.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
c = Cluster("s0r"); P = setup_supabase_like(c); s = c.su
s.run("create table if not exists op_events (id bigserial, verb text, at timestamptz default now())")
s.run("insert into op_events(verb) values ('lead_inquiry')")
for q in [
  "create schema if not exists cron", "create table cron.job (jobid serial, jobname text, schedule text, active boolean, command text)",
  "insert into cron.job(jobname,schedule,active,command) values ('lead-followup','*/15 * * * *',true,$$select net.http_post(url:='https://x.supabase.co/functions/v1/lead-followup', headers:=jsonb_build_object('Authorization','Bearer eyJSECRETTOKEN123'))$$),('daily-campaign-auto','0 15 * * *',true,$$select net.http_post(url:='https://x.supabase.co/functions/v1/campaign-auto')$$)",
  "create schema if not exists auth", "create table auth.users (id uuid default gen_random_uuid(), email text, raw_app_meta_data jsonb, last_sign_in_at timestamptz)",
  "insert into auth.users(email,raw_app_meta_data,last_sign_in_at) values ('krystal@mo-care.com','{\"hub_access\":[\"cc\"]}',now()),('angiel@mo-care.com','{\"hub_access\":[\"cc\"]}',null)",
  "create table if not exists applicant_alerts (name text, phone text, email text, alert_on text[], active boolean)",
  "insert into applicant_alerts values ('Office','+14172348494','office@x.com','{lead}',true)",
  "create table if not exists journey_seat_member (email text, seat text)", "insert into journey_seat_member values ('krystal@mo-care.com','client_intake')",
  "create table if not exists circle_contacts (id bigserial, stopped_at timestamptz)", "insert into circle_contacts(stopped_at) values (null),(now())",
]: s.run(q)
def app(k, v): s.run("insert into app_data(key,data) values (:k, cast(:v as jsonb)) on conflict (key) do update set data=excluded.data", k=k, v=json.dumps(v))
app("ops_settings", {"coverage_alert_phones": ["+14172348494"], "timekeeper_watch_live": False, "promises_live": True, "fallback_phone": "+14175551234", "notes_blob": {"a": 1}})
app("campaign_settings", [{"id": "settings", "enabled": True, "aud_clients": True, "aud_client_contacts": True}])
app("coordinator_staff", [{"name": "Krystal Land", "email": "Krystal@mo-care.com"}])
app("coverage_cases", [{"flag_source": "text message", "opened_at": "2026-09-20T10:00:00Z"}])
app("leads", [{"id": "L1", "do_not_contact": True, "ack_sent_at": "2026-09-25T10:00:00Z"}, {"id": "L2", "nudge_1_at": "2026-09-26T10:00:00Z"}])
app("staffing_tasks", [{"kind": "coverage", "status": "open", "about": "Linda Carter", "message": "Ashley called out tomorrow", "from_name": "Krystal", "created_at": "2026-09-21T09:00:00Z"},
                       {"kind": "hours", "status": "open", "about": "Bill", "message": "more hours"}])
app("duty_windows", [{"area": "staffing", "person": "", "recur": {"days": [6, 0], "from": "08:00", "to": "16:00"}}])
app("on_call_schedule", [{"name": "Samantha Troutman", "start_date": "2026-07-28", "end_date": "2027-10-29"}])
fp0 = s.run("select md5(string_agg(key||data::text, ',' order by key)) from app_data")[0][0]
seen = []
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, bool, str, dict, list, type(None))) else str(v))
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        q = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))["query"]; seen.append(q)
        cc = c.conn()
        try:
            cc.run("set transaction read only")
            rows = cc.run(q); cols = [d["name"] for d in (cc.columns or [])]
            b = json.dumps([{k: J(v) for k, v in zip(cols, r)} for r in (rows or [])]).encode(); self.send_response(200)
        except Exception as e:
            b = json.dumps({"message": str(e)[:300]}).encode(); self.send_response(400)
        finally: cc.close()
        self.end_headers(); self.wfile.write(b)
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
rep = os.path.join(H, "_s0r.txt")
p = subprocess.run(["python3", "step0_refresh.py"], cwd=H, capture_output=True, text=True,
                   env=dict(os.environ, SB_TOKEN="sbp_x", SB_REF="r", SB_REPORT=rep, SB_API_BASE=f"http://127.0.0.1:{srv.server_address[1]}"))
t = open(rep).read(); os.remove(rep)
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-700:]))
ck("runs to the end with no failed query", p.returncode == 0 and "✗" not in t and "DONE" in t, t)
ck("nothing in the database changed", s.run("select md5(string_agg(key||data::text, ',' order by key)) from app_data")[0][0] == fp0)
ck("phone numbers print only as their last 4 digits", "…8494" in t and "…1234" in t and "4172348494" not in t and "+1417" not in t, t)
ck("tokens inside scheduled-job commands never print", "eyJSECRETTOKEN" not in t and "lead-followup                        */15" in t and "→ lead-followup" in t, t)
ck("switches shown; the two new 0a switches reported as not present yet", "timekeeper_watch_live" in t and "inquiry_followups_live" in t and "not present yet" in t and "(dict, not shown)" in t, t)
ck("campaign audiences to clients and families shown as ON", "ACTIVE CLIENTS               ON" in t and "CLIENT CONTACTS (families)   ON" in t, t)
ck("admin accounts and seats listed as facts, with no inference about Shared Admin", "krystal@mo-care.com" in t and "client_intake" in t and "NOT inferred" in t, t)
ck("open old call-out messages listed (only kind coverage), none changed", "1 open" in t and "Linda Carter" in t and "more hours" not in t, t)
ck("opt-out counts and inquiry-message activity reported", "do-not-contact: 1 of 2" in t and "stopped: 1 of 2" in t and "1 acknowledgments" in t and "1 day-1" in t, t)
ck("every query sent was a read", all(q.lstrip().lower().startswith(("select", "with")) for q in seen), seen)
g = subprocess.run(["python3", "-c", "import os;os.environ.update(SB_REPORT='/dev/null');exec(open('step0_refresh.py').read().split('say(\"STEP 0')[0]);print(read('update app_data set data=null'))"], cwd=H, capture_output=True, text=True)
ck("the read guard refuses a write", "refused: not a read-only query" in g.stdout, g.stdout + g.stderr)
srv.shutdown(); c.close()
print("\nDESKTOP 268 · STEP 0 LIVE REFRESH · PROOF\n" + "=" * 60); ok = True
for n, g2, note in res: ok &= g2; print(("PASS  " if g2 else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED"); print("sha:", hashlib.sha256(open(os.path.join(H, "step0_refresh.py"), "rb").read()).hexdigest())
