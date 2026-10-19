#!/usr/bin/env python3
# Rehearsal of 1004 (who_gets_what_1004.py, read only): the step against a throwaway LOCAL Postgres (pgserver) through a
# fake management API. Two set-ups: one where nobody is set up (so everything falls to Samantha), one set up for the team.
# Proves it reads only (the database is identical after) and never prints a full phone number. Never touches Supabase.
#   python3 who_gets_what_1004_test.py
import json, os, tempfile, glob, subprocess, threading, http.server, hashlib
import pgserver
from pg8000.native import Connection
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[-1500:]))
D = tempfile.mkdtemp(prefix="t1004-"); srv = pgserver.get_server(D)
host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
c = Connection(user="postgres", database="postgres", unix_sock=SOCK)
PSQL = os.path.join(os.path.dirname(pgserver.__file__), "pginstall", "bin", "psql")
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        q = json.loads(self.rfile.read(int(self.headers["Content-Length"])))["query"]
        p_ = subprocess.run([PSQL, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", host, "-U", "postgres", "-d", "postgres", "-c", q], capture_output=True, text=True)
        out = p_.stdout.strip(); body, code = (json.dumps([{"r": out}] if out else []), 200) if p_.returncode == 0 else (json.dumps({"message": p_.stderr}), 400)
        self.send_response(code); self.end_headers(); self.wfile.write(body.encode())
hs = http.server.HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=hs.serve_forever, daemon=True).start()
S_, K_, Z_ = "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", "00000000-0000-0000-0000-000000000003"
def seed(team):
    for q in ["drop schema if exists public cascade", "create schema public",
      "create table public.persons(person_id uuid primary key, full_name text, primary_email text, active boolean default true)",
      "create table public.staff_roles(person_id uuid, entity text, role text)",
      "create table public.domains(entity text, code text, name text, owner_person uuid, escalation_person uuid, active boolean default true)",
      "create table public.app_data(key text primary key, data jsonb)",
      "create table public.applicant_alerts(id serial, name text, email text, phone text, alert_on text)"]:
        c.run(q)
    for pid, n, e in ((S_, "Samantha Troutman", "samantha@mo-care.com"), (K_, "Krystal Land", "krystal@mo-care.com"), (Z_, "Zach Troutman", "zach@mo-care.com")):
        c.run("insert into public.persons values (cast(:p as uuid), :n, :e, true)", p=pid, n=n, e=e)
    for pid in (S_, Z_): c.run("insert into public.staff_roles values (cast(:p as uuid), 'cc_ihs', 'owner_admin')", p=pid)
    if team: c.run("insert into public.staff_roles values (cast(:p as uuid), 'cc_ihs', 'springfield_lead')", p=K_)
    for code, name, own in (("scheduling_coverage", "Scheduling and coverage", S_ if not team else K_), ("money", "Money", S_), ("client_care", "Client care", None)):
        c.run("insert into public.domains values ('cc_ihs', :c, :n, cast(:o as uuid), null, true)", c=code, n=name, o=own)
    st = {"fallback_phone": "+14175551234", "leadership_backup": "zach@mo-care.com", "bonus": {"decider": "samantha@mo-care.com", "payroll": "krystal@mo-care.com"}}
    if team: st.update({"coverage_alert_admins": ["krystal@mo-care.com"], "morning_brief_recipients": ["krystal@mo-care.com"], "afternoon_interviews": {"from": "14:00", "name": "Krystal"}, "duty_default_in_charge": "krystal@mo-care.com"})
    else: st.update({"coverage_alert_admins": ["samantha@mo-care.com"], "duty_default_owner_escalation": "samantha@mo-care.com"})
    c.run("insert into public.app_data values ('ops_settings', cast(:d as jsonb))", d=json.dumps(st))
    c.run("insert into public.app_data values ('duty_windows', cast(:d as jsonb))", d=json.dumps([{"area": "in_charge", "person": "krystal@mo-care.com"}, {"area": "staffing", "person": "x"}]))
    c.run("insert into public.applicant_alerts(name, email, phone, alert_on) values ('Samantha', 'samantha@mo-care.com', '4175559999', 'lead')")
def dbsum(): return hashlib.sha256(json.dumps([c.run("select to_jsonb(t) from public.%s t order by 1::text" % t) for t in ("persons", "staff_roles", "domains", "app_data", "applicant_alerts")], default=str).encode()).hexdigest()
def run():
    rep = os.path.join(D, "rep.txt")
    p = subprocess.run(["python3", os.path.join(HERE, "who_gets_what_1004.py")], capture_output=True, text=True,
        env={**os.environ, "SB_API_BASE": f"http://127.0.0.1:{hs.server_port}", "SB_TOKEN": "sbp_fake", "SB_REPORT": rep, "SB_STEP": "1004"})
    return p.returncode, p.stdout + p.stderr
try:
    seed(False); before = dbsum(); code, out = run()
    ck("not set up · finishes, read only (the database is identical after)", code == 0 and "RESULT: DONE" in out and dbsum() == before, out)
    ck("not set up · Scheduling owned by Samantha, Money by Samantha, Client care unowned and no lead -> Samantha", "Scheduling and coverage (scheduling_coverage): Samantha Troutman (the owner)" in out and "Client care (client_care): Samantha (nobody owns it and there is no Springfield lead, so Samantha)" in out, out)
    ck("not set up · the 'points at Samantha' list names the alerts, the morning brief fallback, the Leadership default, the new-lead list and no Springfield lead", all(x in out for x in ("coverage and clock-in alerts (on the list)", "the morning brief (built-in fallback)", "Leadership seat when nobody is scheduled", "new-lead alerts (on the list)", "no Springfield lead, so every unowned routine notice")), out)
    ck("phones · only the last 4 digits ever show", "ending 1234" in out and "4175551234" not in out and "5559999" not in out, out)
    seed(True); code, out = run()
    ck("set up for the team · Krystal is lead, owns Scheduling, gets unowned Client care; only Money stays with Samantha", code == 0 and "Springfield lead: Krystal Land" in out and "Client care (client_care): Krystal Land (nobody owns it, so the Springfield lead)" in out and "Money routine notices (the owner)" in out and "coverage and clock-in alerts" not in out.split("POINTS AT SAMANTHA")[1], out)
    ck("set up for the team · duty windows counted per seat", "in_charge 1, staffing 1" in out, out)
finally:
    hs.shutdown()
    try: srv.cleanup()
    except Exception: pass
for n, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n + ("" if okk else "\n      " + note))
bad = sum(1 for r in res if not r[1]); print(f"{len(res) - bad}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
