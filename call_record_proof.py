# K1 · call_record on a disposable Postgres. Never touches production.
import os, glob, tempfile, subprocess, json
import pgserver
from pg8000.native import Connection, DatabaseError
HUB="/Users/samantha/Claude/Projects/Staffing-Coordinator-Hub/"
SQL=open(HUB+"call-record.sql").read(); RBK=open(HUB+"call-record-rollback.sql").read()
d=tempfile.mkdtemp(prefix="k1_"); srv=pgserver.get_server(d)
host=[kv[5:] for kv in srv.get_uri().split("?",1)[1].split("&") if kv.startswith("host=")][0]
sock=[p for p in glob.glob(os.path.join(host,".s.PGSQL.*")) if not p.endswith(".lock")][0]; port=sock.rsplit(".",1)[1]
psqlb=os.path.join(os.path.dirname(pgserver.__file__),"pginstall","bin","psql")
def psql(q):
    f=tempfile.mktemp(suffix=".sql"); open(f,"w").write(q)
    p=subprocess.run([psqlb,"-X","-q","-v","ON_ERROR_STOP=1","-h",host,"-p",port,"-U","postgres","-d","postgres","-f",f],capture_output=True,text=True); return p.returncode,p.stdout+p.stderr
s=Connection(user="postgres",database="postgres",unix_sock=sock)
for r in ["anon","authenticated"]: s.run(f"do $$ begin create role {r} nologin; exception when duplicate_object then null; end $$;")
s.run("do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;")
s.run("grant usage on schema public to anon, authenticated, service_role")
for k in ["tables","sequences","functions"]: s.run(f"alter default privileges in schema public grant all on {k} to anon, authenticated, service_role")
s.run("create table app_data (key text primary key, data jsonb)")
s.run("create table app_data_key_hub_map (data_key text, hub_slug text)"); s.run("insert into app_data_key_hub_map values ('leads','care_coordinator')")
s.run("create function jwt_hub_access() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb -> 'app_metadata' -> 'hub_access' $$")
s.run("create function can_access_data_key(k text) returns boolean language sql stable security definer as $$ select public.jwt_hub_access() is null or exists (select 1 from public.app_data_key_hub_map m where m.data_key = k and public.jwt_hub_access() ? m.hub_slug) $$")
s.run("create table person_identity (id uuid primary key default gen_random_uuid(), display_name text)")
s.run("create table phone_index (id bigserial primary key, phone text not null, person_id uuid not null references person_identity(id), unique(phone, person_id))")
P1=s.run("insert into person_identity (display_name) values ('A') returning id")[0][0]; P2=s.run("insert into person_identity (display_name) values ('B') returning id")[0][0]; P3=s.run("insert into person_identity (display_name) values ('C') returning id")[0][0]
s.run("insert into phone_index (phone, person_id) values ('+14175550001',:a),('+14175550002',:b),('+14175550002',:c)", a=P1, b=P2, c=P3)
s.run("insert into app_data values ('leads', :l)", l=json.dumps([
  {"id":"L1","phone":"(417) 555-0010"}, {"id":"L2","phone":"4175550020"}, {"id":"L3","client_phone":"417-555-0020"},
  {"id":"L4","phone":"4175550030","archived":True}, {"id":"L5","phone":"4175550001"}]))
res=[]
def ck(n,c,d=""): res.append((n,bool(c),"" if c else str(d)[:400]))
rc,out=psql(SQL.replace("do $verify$","select 1/0;\ndo $verify$",1)); ck("an injected failure leaves nothing behind", rc!=0 and not s.run("select to_regclass('public.call_record') is not null")[0][0], out[-200:])
rc,out=psql(SQL); ck("installs, and its self-check passes", rc==0 and "call_record installed" in out, out[-300:])
rc,out=psql(SQL); ck("a second run refuses and changes nothing", rc!=0 and "already installed" in out, out[-200:])
svc=Connection(user="postgres",database="postgres",unix_sock=sock); svc.run("set role service_role")
def add(kind="summary", phone="4175550010", outcome=None, summary="Talked about mornings.", source="ghl", ax=None, via="call-disposition", written=None):
    r=svc.run("select public.call_record_add(:k,'inbound',:p,'ghlC1',:o,:s,:src,:ax,null,:w,:v)", k=kind,p=phone,o=outcome,s=summary,src=source,ax=ax,w=written,v=via)[0][0]
    return r if isinstance(r,dict) else json.loads(r)
r=add(); row=s.run("select match, lead_id, person_id, caller_phone from call_record where id=:i", i=r["id"])[0]
ck("a number on exactly one lead (formatting ignored) → that lead", r["outcome"]=="recorded" and row[0]=="one" and row[1]=="L1" and row[2] is None and row[3]=="4175550010", row)
r=add(phone="4175550020"); row=s.run("select match, lead_id from call_record where id=:i", i=r["id"])[0]
ck("two leads share the number (caller's phone on one, client's on the other) → several, nobody chosen", row[0]=="several" and row[1] is None, row)
r=add(phone="4175550030"); ck("an archived lead is not matched", s.run("select match from call_record where id=:i", i=r["id"])[0][0]=="none")
r=add(phone="+1 (417) 555-0002"); ck("two people on one number in the identity layer → several", s.run("select match, person_id from call_record where id=:i", i=r["id"])[0]==["several",None])
r=add(phone="4175550001"); row=s.run("select match, person_id, lead_id from call_record where id=:i", i=r["id"])[0]
ck("one person and one lead on the number → both recorded", row[0]=="one" and str(row[1])==str(P1) and row[2]=="L5", row)
r=add(phone="12"); row=s.run("select match, caller_phone from call_record where id=:i", i=r["id"])[0]
ck("no usable number → none, no number stored", row==["none",None], row)
r=add(kind="outcome", outcome="Booked Visit", summary=None, source=None); ck("an outcome line records", r["outcome"]=="recorded")
bad={"outcome with no outcome":add(kind="outcome", outcome=None, summary=None, source=None),"summary with no text":add(summary=None),
     "unknown source":add(source="guess"),"unknown kind":add(kind="rumor"),"unknown function":add(via="browser"),"unknown AxisCare state":add(ax="maybe")}
ck("wrong lines are refused, with nothing written (6 kinds)", all(v["outcome"]=="refused" for v in bad.values()), {k:v for k,v in bad.items() if v["outcome"]!="refused"})
r=add(summary="x"*5000); ck("a very long summary is kept, capped at 4,000 characters", s.run("select length(summary) from call_record where id=:i", i=r["id"])[0][0]==4000)
def err(f):
    try: f(); return None
    except DatabaseError as e: return str(e)[:80]
ck("nobody can change, delete or empty it", all(err(lambda q=q: s.run(q)) for q in ["update call_record set summary='x'","delete from call_record","truncate call_record"]))
KAT=Connection(user="postgres",database="postgres",unix_sock=sock); KAT.run("select set_config('request.jwt.claims', :c, false)", c=json.dumps({"role":"authenticated","app_metadata":{"hub_access":["care_coordinator"]}})); KAT.run("set role authenticated")
STF=Connection(user="postgres",database="postgres",unix_sock=sock); STF.run("select set_config('request.jwt.claims', :c, false)", c=json.dumps({"role":"authenticated","app_metadata":{"hub_access":["staffing"]}})); STF.run("set role authenticated")
ANON=Connection(user="postgres",database="postgres",unix_sock=sock); ANON.run("set role anon")
n=s.run("select count(*) from call_record")[0][0]
ck("whoever reads leads reads it; others and visitors don't", KAT.run("select count(*) from call_record")[0][0]==n and STF.run("select count(*) from call_record")[0][0]==0 and err(lambda: ANON.run("select count(*) from call_record")))
ck("a browser can't write it or call the door", err(lambda: KAT.run("select public.call_record_add('summary','inbound','4175550010',null,null,'x','ghl',null,null,null,'call-disposition')")) and err(lambda: KAT.run("insert into call_record (kind,match,via,summary,summary_source) values ('summary','none','call-disposition','x','ghl')")))
rc,out=psql(RBK); ck("rollback refuses once it holds calls", rc!=0 and "history" in out, out[-200:])
s.run("drop table call_record"); s.run("drop function call_record_add(text,text,text,text,text,text,text,text,text,text,text)"); s.run("drop function call_record_guard()")
rc,out=psql(SQL); rc2,out2=psql(RBK); ck("rollback removes it while it is empty", rc==0 and rc2==0 and not s.run("select to_regclass('public.call_record') is not null")[0][0], out2[-200:])
for n_,o,dd in res: print(("PASS" if o else "FAIL")+" · "+n_+("" if o else "  :: "+dd))
print(f"{sum(x[1] for x in res)}/{len(res)}")
