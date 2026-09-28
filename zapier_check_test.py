import os, glob, tempfile, subprocess, sys, json
import pgserver
from pg8000.native import Connection
d=tempfile.mkdtemp(prefix="z0_"); srv=pgserver.get_server(d)
host=[kv[5:] for kv in srv.get_uri().split("?",1)[1].split("&") if kv.startswith("host=")][0]
sock=[p for p in glob.glob(os.path.join(host,".s.PGSQL.*")) if not p.endswith(".lock")][0]
s=Connection(user="postgres",database="postgres",unix_sock=sock)
s.run("create table app_data (key text primary key, data jsonb)")
URL="https://hooks.zapier.com/hooks/catch/111/SECRETPATH/"
s.run("insert into app_data values ('settings',:a),('team_hub_settings',:b),('notes',:c),('leads','[]')",
      a=json.dumps({"zapier_cand_webhook":URL,"zapier_attend_webhook":"","ac_orient_webhook":URL}), b=json.dumps([{"id":"hub_config","access_webhook_url":URL}]), c=json.dumps({"t":URL}))
rep=tempfile.mktemp(); p=subprocess.run([sys.executable,"/Users/samantha/Claude/Projects/Staffing-Coordinator-Hub/zapier_check.py"],env=dict(os.environ,SB_REPORT=rep,SB_LOCAL_SOCK=sock),capture_output=True,text=True)
out=open(rep).read(); print(out)
ok=[p.returncode==0, "candidate: yes" in out, "attendance: no" in out, "AxisCare orientation shift: yes" in out, "Team Access Automation address: yes" in out, "  notes" in out, "SECRETPATH" not in out]
print(ok, f"{sum(ok)}/{len(ok)}")
