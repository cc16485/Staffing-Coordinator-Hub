import os, glob, tempfile, subprocess, sys, json, datetime as dt
import pgserver
from pg8000.native import Connection
d=tempfile.mkdtemp(prefix="i0_"); srv=pgserver.get_server(d)
host=[kv[5:] for kv in srv.get_uri().split("?",1)[1].split("&") if kv.startswith("host=")][0]
sock=[p for p in glob.glob(os.path.join(host,".s.PGSQL.*")) if not p.endswith(".lock")][0]
s=Connection(user="postgres",database="postgres",unix_sock=sock)
now=dt.datetime.now(dt.timezone.utc)
s.run("create table app_data (key text primary key, data jsonb)")
s.run("create table person_identity (id uuid primary key default gen_random_uuid())")
s.run("create table person_relationship (id bigserial, person_id uuid, client_person_id uuid, active boolean default true)")
s.run("create table person_source_id (id bigserial, person_id uuid, system text, entity_type text, source_id text)")
s.run("create table phone_index (id bigserial, phone text, person_id uuid)")
s.run("create table care_circles (id bigserial primary key, client_name text, active boolean, axiscare_client_id text)")
s.run("create table circle_contacts (id bigserial primary key, circle_id text, name text, phone text, axiscare_removed_at timestamptz, stopped_at timestamptz)")
C=s.run("insert into person_identity default values returning id")[0][0]; G=s.run("insert into person_identity default values returning id")[0][0]
s.run("insert into person_source_id (person_id,system,entity_type,source_id) values (:c,'axiscare','client','501'),(:g,'axiscare','caregiver','9')", c=C, g=G)
s.run("insert into phone_index (phone,person_id) values ('+14175550001',:c),('+14175550002',:g)", c=C, g=G)
s.run("insert into care_circles (client_name,active,axiscare_client_id) values ('A',true,'501'),('B',true,null),('C',false,'503')")
s.run("""insert into circle_contacts (circle_id,name,phone,axiscare_removed_at) values
 ('1','SECRETNAME','(417) 555-0001',null),('1','x','4175550002',null),('1','x','4175550010',null),('1','x','4175550010',null),('1','x','4175550011',null),
 ('1','x','',null),('2','x','4175550012',null),('1','x','4175550013',now()),('3','x','4175550014',null)""")
s.run("insert into app_data values ('axiscare_call_note_log', :a)", a=json.dumps([
  {"at":now.isoformat(),"outcome":"skipped","detail":"caller not recognised — no person on this number","phone_digits":"4175550011"},
  {"at":now.isoformat(),"outcome":"skipped","detail":"caller not recognised — no person on this number","phone_digits":"4175559999"},
  {"at":now.isoformat(),"outcome":"posted","phone_digits":"4175550001"}]))
rep=tempfile.mktemp(); p=subprocess.run([sys.executable,"/Users/samantha/Claude/Projects/Staffing-Coordinator-Hub/family_callers_check.py"],env=dict(os.environ,SB_REPORT=rep,SB_LOCAL_SOCK=sock),capture_output=True,text=True)
out=open(rep).read(); print(out)
ok=[p.returncode==0,"client–family links: 0 (active 0) · family source records: 0" in out,"members: 7 · with a usable phone: 6 · in a circle linked to an AxisCare client: 6" in out,
    "(a usable phone AND a linked circle, so they could be recognised): 5" in out,"already a client's number (a shared home line): 1 · a caregiver's: 1 · someone else's: 0" in out,
    "shared between two family members: 2 · free to link: 2" in out,"unrecognised calls: 2 · from a Family Circle member's number: 1" in out,"SECRETNAME" not in out and "555" not in out]
print(ok,f"{sum(ok)}/{len(ok)}")
