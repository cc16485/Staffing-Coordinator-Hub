# K3 · call_placement on a disposable Postgres, on top of call_record (K1). Never touches production.
import os, glob, tempfile, subprocess, json
import pgserver
from pg8000.native import Connection, DatabaseError
HUB="/Users/samantha/Claude/Projects/Staffing-Coordinator-Hub/"
K1=open(HUB+"call-record.sql").read(); SQL=open(HUB+"call-place.sql").read(); RBK=open(HUB+"call-place-rollback.sql").read()
d=tempfile.mkdtemp(prefix="k3_"); srv=pgserver.get_server(d)
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
s.run("create table person_identity (id uuid primary key default gen_random_uuid())")
s.run("create table phone_index (id bigserial primary key, phone text, person_id uuid)")
s.run("create table person_source_id (id bigserial primary key, person_id uuid, system text, entity_type text, source_id text)")
PC=s.run("insert into person_identity default values returning id")[0][0]
s.run("insert into person_source_id (person_id, system, entity_type, source_id) values (:p,'axiscare','client','501')", p=PC)
s.run("insert into app_data values ('leads', :l)", l=json.dumps([{"id":"L1","phone":"4175550010"},{"id":"L2","phone":"4175550010"},{"id":"L3","archived":True}]))
res=[]
def ck(n,c,d=""): res.append((n,bool(c),"" if c else str(d)[:400]))
rc,out=psql(SQL); ck("refuses to install before the call record exists", rc!=0 and "not installed" in out, out[-200:])
rc,out=psql(K1); assert rc==0, out
rc,out=psql(SQL.replace("do $verify$","select 1/0;\ndo $verify$",1)); ck("an injected failure leaves nothing behind", rc!=0 and not s.run("select to_regclass('public.call_placement') is not null")[0][0], out[-200:])
rc,out=psql(SQL); ck("installs, and its self-check passes", rc==0 and "call_placement installed" in out, out[-300:])
svc=Connection(user="postgres",database="postgres",unix_sock=sock); svc.run("set role service_role")
J=lambda r: r if isinstance(r,dict) else json.loads(r)
add=lambda phone: J(svc.run("select public.call_record_add('summary','inbound',:p,null,null,'A call.','ghl',null,null,null,'call-disposition')", p=phone)[0][0])["id"]
A=add("4175550010"); B=add("4175550099"); C=add("4175550099"); D=add("4175550077")
s.run("insert into phone_index (phone, person_id) values ('+14175550066', :p)", p=PC); ONE=add("4175550066")
place=lambda ids,dec,lead=None,person=None,ax=None,by="kat@mo-care.com": J(svc.run("select public.call_record_place(:i::bigint[],:d,:l,:p,:a,:b,'note')", i="{"+",".join(map(str,ids))+"}", d=dec, l=lead, p=person, a=ax, b=by)[0][0])
r=place([A],"lead",lead="L1"); ck("a call on a shared number is placed on the lead a person chose", r.get("outcome")=="placed" and s.run("select decision, lead_id, placed_by from call_placement where call_record_id=:i", i=A)[0]==["lead","L1","kat@mo-care.com"], r)
r=place([B,C],"client",person=PC,ax="501"); ck("an unknown caller's call (both lines) is placed on a client", r.get("outcome")=="placed" and r.get("lines")==2, r)
r=place([D],"not_ours"); ck("\"not one of ours\" is recorded too", r.get("outcome")=="placed")
bad={"already placed":place([A],"lead",lead="L2"),"a matched call":place([ONE],"not_ours"),"an archived inquiry":place([add("4175550088")],"lead",lead="L3"),
     "an inquiry not on file":place([add("4175550087")],"lead",lead="NOPE"),"a client not linked to that number":place([add("4175550086")],"client",person=PC,ax="999"),
     "no one said who":place([add("4175550085")],"not_ours",by=" "),"an unknown decision":place([add("4175550084")],"guess")}
ck("wrong placements are refused (7 kinds)", all(v.get("outcome")=="refused" for v in bad.values()), {k:v for k,v in bad.items() if v.get("outcome")!="refused"})
E=add("4175550083"); r=place([E,A],"not_ours"); ck("all or nothing: one bad line in a batch places none", r.get("outcome")=="refused" and not s.run("select count(*) from call_placement where call_record_id=:i", i=E)[0][0], r)
def err(f):
    try: f(); return None
    except DatabaseError as e: return str(e)[:80]
ck("nobody can change, delete or empty it", all(err(lambda q=q: s.run(q)) for q in ["update call_placement set note='x'","delete from call_placement","truncate call_placement"]))
KAT=Connection(user="postgres",database="postgres",unix_sock=sock); KAT.run("select set_config('request.jwt.claims', :c, false)", c=json.dumps({"role":"authenticated","app_metadata":{"hub_access":["care_coordinator"]}})); KAT.run("set role authenticated")
ck("staff read it; a browser can't place a call directly", KAT.run("select count(*) from call_placement")[0][0]==4 and err(lambda: KAT.run("select public.call_record_place('{1}'::bigint[],'not_ours',null,null,null,'x',null)")))
rc,out=psql(RBK); ck("rollback refuses once calls are placed", rc!=0 and "history" in out, out[-200:])
for n_,o,dd in res: print(("PASS" if o else "FAIL")+" · "+n_+("" if o else "  :: "+dd))
print(f"{sum(x[1] for x in res)}/{len(res)}")
