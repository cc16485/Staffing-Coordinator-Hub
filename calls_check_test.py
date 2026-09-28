import os, glob, tempfile, subprocess, sys, json
import pgserver
from pg8000.native import Connection
d=tempfile.mkdtemp(prefix="p0_"); srv=pgserver.get_server(d)
host=[kv[5:] for kv in srv.get_uri().split("?",1)[1].split("&") if kv.startswith("host=")][0]
sock=[p for p in glob.glob(os.path.join(host,".s.PGSQL.*")) if not p.endswith(".lock")][0]
s=Connection(user="postgres",database="postgres",unix_sock=sock)
s.run("create table app_data (key text primary key, data jsonb)")
s.run("insert into app_data values ('call_followup_log',:a),('leads',:b),('post_call_followups',:c)",
  a=json.dumps([{"at":"2026-07-24T10:00:00Z","stage":"received"},{"at":"2026-07-31T12:30:00Z","stage":"skipped"}]),
  b=json.dumps([{"id":"L1","first_name":"SECRETNAME","call_transcript":"PHI TEXT","ai_suggestions":[{"reviewed":False},{"reviewed":True}]},{"id":"L2"}]),
  c=json.dumps([{"status":"pending_approval","transcript":"PHI"},{"status":"sent"}]))
rep=tempfile.mktemp(); p=subprocess.run([sys.executable,"/Users/samantha/Claude/Projects/Staffing-Coordinator-Hub/calls_check.py"],env=dict(os.environ,SB_REPORT=rep,SB_LOCAL_SOCK=sock),capture_output=True,text=True)
out=open(rep).read(); print(out)
ok=[p.returncode==0,"calls received: 1 · last entry: 2026-07-31 12:30" in out,"holding a call transcript: 1" in out,"leads with AI suggestions: 1 · suggestions: 2 · not reviewed: 1" in out,
    "drafted follow-ups: 2 · waiting for approval: 1 · holding a transcript: 1" in out,"recordings table: not present" in out,"SECRETNAME" not in out and "PHI" not in out]
print(ok,f"{sum(ok)}/{len(ok)}")
