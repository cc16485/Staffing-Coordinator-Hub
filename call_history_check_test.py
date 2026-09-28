import os, glob, tempfile, subprocess, sys, json, datetime as dt
import pgserver
from pg8000.native import Connection
d=tempfile.mkdtemp(prefix="k0_"); srv=pgserver.get_server(d)
host=[kv[5:] for kv in srv.get_uri().split("?",1)[1].split("&") if kv.startswith("host=")][0]
sock=[p for p in glob.glob(os.path.join(host,".s.PGSQL.*")) if not p.endswith(".lock")][0]
s=Connection(user="postgres",database="postgres",unix_sock=sock)
now=dt.datetime.now(dt.timezone.utc); ago=lambda n:(now-dt.timedelta(days=n)).isoformat()
s.run("create table app_data (key text primary key, data jsonb)")
s.run("create table axiscare_change_log (id bigserial, at timestamptz default now(), kind text)")
s.run("insert into axiscare_change_log (kind) values ('call_summary'),('client_note')")
s.run("insert into app_data values ('ops_settings',:o),('call_disposition_log',:c),('axiscare_call_note_log',:a),('leads',:l)",
  o=json.dumps({"axiscare_call_notes_live":True}),
  c=json.dumps([{"at":ago(2),"routed":"coverage case opened"},{"at":ago(40),"routed":"coverage case opened"},{"at":ago(120),"routed":"suppress"}]),
  a=json.dumps([{"at":ago(1),"outcome":"posted"},{"at":ago(3),"outcome":"skipped","detail":"caller not recognised — no person on this number"},
               {"at":ago(50),"outcome":"skipped","detail":"shared line — 2 people"},{"at":ago(100),"outcome":"dry_run"}]),
  l=json.dumps([{"id":"A","phone":"(417) 555-0100","client_phone":"4175550100","comm_log":[{"by":"call summary","at":ago(5),"body":"📝 SECRET SUMMARY"}]},
               {"id":"B","phone":"417-555-0101"},{"id":"C","client_phone":"4175550101"},{"id":"D","phone":"4175550100","archived":True}]))
rep=tempfile.mktemp(); p=subprocess.run([sys.executable,"/Users/samantha/Claude/Projects/Staffing-Coordinator-Hub/call_history_check.py"],env=dict(os.environ,SB_REPORT=rep,SB_LOCAL_SOCK=sock),capture_output=True,text=True)
out=open(rep).read(); print(out)
ok=[p.returncode==0,"AxisCare call-log push is live: yes" in out,"in the log: 3 · last 30 days: 1 · last 90 days: 2" in out,"coverage case opened: 2" in out,
    "summaries seen: 4 · last 30 days: 2 · last 90 days: 3" in out,"into AxisCare's call log: 1 · practice runs: 1" in out,"caller not recognised 1 · shared line 1" in out,
    "1 summaries across 1 leads" in out,"(since 2026-09-28): 1" in out,"phone numbers on more than one open lead: 1" in out,"SECRET" not in out and "0100" not in out]
print(ok,f"{sum(ok)}/{len(ok)}")
