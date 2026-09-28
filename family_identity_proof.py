# I1 · family identity on a disposable Postgres shaped like the real identity layer. Never touches production.
import os, glob, tempfile, subprocess, json
import pgserver
from pg8000.native import Connection, DatabaseError
HUB="/Users/samantha/Claude/Projects/Staffing-Coordinator-Hub/"
SQL=open(HUB+"family-identity.sql").read(); RBK=open(HUB+"family-identity-rollback.sql").read()
d=tempfile.mkdtemp(prefix="i1_"); srv=pgserver.get_server(d)
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
for k in ["tables","sequences"]: s.run(f"alter default privileges in schema public grant all on {k} to service_role")
s.run("create table person_identity (id uuid primary key default gen_random_uuid(), display_name text not null, first_name text, last_name text, primary_phone text)")
s.run("""create table person_source_id (id bigserial primary key, person_id uuid not null references person_identity(id) on delete cascade, system text not null,
  entity_type text not null, source_id text not null, confidence text not null default 'confirmed', needs_review boolean not null default false, evidence text)""")
s.run("create unique index person_source_hub_uniq on person_source_id (entity_type, source_id) where system = 'hub'")
s.run("create unique index person_source_axiscare_uniq on person_source_id (entity_type, source_id) where system = 'axiscare'")
s.run("""create table person_relationship (id bigserial primary key, person_id uuid not null references person_identity(id), client_person_id uuid not null references person_identity(id),
  relationship text, responsible_party boolean not null default false, emergency_contact boolean not null default false, billing_contact boolean not null default false,
  rank int not null default 100, active boolean not null default true, ended_at date, source text not null default 'office' check (source in ('axiscare','office')),
  unique (person_id, client_person_id, relationship), check (person_id <> client_person_id))""")
s.run("create table phone_index (id bigserial primary key, phone text not null, person_id uuid not null references person_identity(id), kind text, shared boolean not null default false, unique (phone, person_id))")
s.run("""create table identity_door_audit (id bigserial primary key, at timestamptz default now(), op text not null,
  workflow text not null, acting_staff text not null, system text not null, entity_type text not null, source_id text not null,
  outcome text not null, person_id uuid, evidence text, detail text)""")
# as live: the historical door's lists, and rows already using them
s.run("alter table identity_door_audit add constraint identity_door_audit_op_check check (op in ('resolve_or_create','attach_source','resolve_historical'))")
s.run("alter table identity_door_audit add constraint identity_door_audit_outcome_check check (outcome in ('resolved_existing','created_new','conflict','invalid_source','attached','already_attached','resolved_created','already_resolved','invalid_resolution'))")
s.run("insert into identity_door_audit (op,workflow,acting_staff,system,entity_type,source_id,outcome) values ('resolve_historical','hist','x','axiscare','client','1','resolved_created'),('attach_source','a','x','axiscare','caregiver','9','attached')")
s.run("create table care_circles (id bigserial primary key, client_name text, active boolean, axiscare_client_id text)")
s.run("create table circle_contacts (id bigserial primary key, circle_id bigint, name text, relationship text, phone text, source text, axiscare_removed_at timestamptz)")
CL=s.run("insert into person_identity (display_name) values ('Ruth Client') returning id")[0][0]; CG=s.run("insert into person_identity (display_name) values ('Cara Giver') returning id")[0][0]
s.run("insert into person_source_id (person_id,system,entity_type,source_id) values (:a,'axiscare','client','501'),(:b,'axiscare','caregiver','9')", a=CL, b=CG)
s.run("insert into phone_index (phone, person_id) values ('+14175550001',:a),('+14175550002',:b)", a=CL, b=CG)
s.run("insert into care_circles (client_name,active,axiscare_client_id) values ('Ruth',true,'501'),('Nolink',true,null),('Old',false,'501'),('Ghost',true,'777')")
def mem(name, phone, circle=1, rel='daughter', src='office', removed=False):
    return str(s.run("insert into circle_contacts (circle_id,name,relationship,phone,source,axiscare_removed_at) values (:c,:n,:r,:p,:s,:x) returning id", c=circle,n=name,r=rel,p=phone,s=src,x=('2026-09-01' if removed else None))[0][0])
DANA=mem('Dana Daughter','(417) 555-0010', src='axiscare'); HOME=mem('Sam Spouse','417-555-0001', rel='spouse'); CLASH=mem('Carl','4175550002', rel='son')
TW1=mem('Twin A','4175550020', rel='son'); TW2=mem('Twin B','4175550020', rel='son'); NOPH=mem('No Phone','', rel='niece')
REM=mem('Gone','4175550030', removed=True); NOL=mem('Unlinked','4175550031', circle=2); OLD=mem('Oldc','4175550032', circle=3); GH=mem('Ghostc','4175550033', circle=4)
res=[]
def ck(n,c,d=""): res.append((n,bool(c),"" if c else str(d)[:500]))
rc,out=psql(SQL.replace("do $verify$","select 1/0;\ndo $verify$",1)); ck("an injected failure leaves nothing behind", rc!=0 and not s.run("select to_regprocedure('public.person_link_family_contact(text,text,text,text)') is not null")[0][0], out[-200:])
rc,out=psql(SQL); ck("installs, and its self-check passes", rc==0 and "family identity installed" in out, out[-300:])
rc,out=psql(SQL); ck("a second run refuses and changes nothing", rc!=0 and "already installed" in out, out[-200:])
svc=Connection(user="postgres",database="postgres",unix_sock=sock); svc.run("set role service_role")
J=lambda r: r if isinstance(r,dict) else json.loads(r)
link=lambda cid, ev='joined the circle', who='kat@mo-care.com': J(svc.run("select public.person_link_family_contact(:c,'test',:w,:e)", c=cid, w=who, e=ev)[0][0])
end=lambda cid: J(svc.run("select public.person_end_family_contact(:c,'test','kat@mo-care.com','left the circle')", c=cid)[0][0])
r=link(DANA); P=r.get("person_id")
row=s.run("select r.relationship, r.source, r.responsible_party, r.active from person_relationship r where person_id=:p and client_person_id=:c", p=P, c=CL)
ck("a member with her own number: one person, linked to the client with her relationship, her number recognised",
   r.get("outcome")=="linked" and r.get("phone")=="linked" and row==[["daughter","axiscare",True,True]]
   and s.run("select count(*) from phone_index where phone='+14175550010' and person_id=:p and not shared", p=P)[0][0]==1
   and s.run("select count(*) from person_source_id where system='hub' and entity_type='contact' and source_id=:c", c=DANA)[0][0]==1, [r,row])
r2=link(DANA); ck("linking again changes nothing (no second person, link or number)", r2.get("outcome")=="already_linked"
   and s.run("select count(*) from person_identity")[0][0]==3 and s.run("select count(*) from person_relationship")[0][0]==1, r2)
r=link(HOME)
ck("a member on the client's home line: linked to the client, but the number stays the client's alone", r.get("outcome")=="linked" and "stay with the client" in r.get("phone","")
   and s.run("select array_agg(person_id::text) from phone_index where phone='+14175550001'")[0][0]==[str(CL)], r)
before=s.run("select count(*) from person_identity")[0][0]; r=link(CLASH)
ck("a member whose number is a caregiver's: a clash, nothing created or linked, recorded for the owner",
   r.get("outcome")=="conflict" and s.run("select count(*) from person_identity")[0][0]==before
   and s.run("select count(*) from identity_door_audit where source_id=:c and outcome='conflict'", c=CLASH)[0][0]==1, r)
a=link(TW1); b=link(TW2)
ck("two members sharing a number: both linked, the number marked shared (it identifies neither)", a.get("outcome")=="linked" and "shared" in b.get("phone","")
   and s.run("select count(*) from phone_index where phone='+14175550020' and shared")[0][0]==2, [a,b])
r=link(NOPH); ck("no usable phone: linked to the client, nothing recognised by number", r.get("outcome")=="linked" and r.get("phone")=="no usable phone")
bad={"removed from the circle":link(REM),"circle not linked to AxisCare":link(NOL),"inactive circle":link(OLD),"client not in the identity layer":link(GH),
     "no evidence":link(mem('X','4175550040'),ev=' '),"no such member":link('999999')}
ck("refused and recorded (6 kinds): removed, unlinked circle, inactive circle, client unknown, no evidence, no such member",
   all(v.get("outcome")=="refused" for v in bad.values()) and s.run("select count(*) from identity_door_audit where outcome='refused'")[0][0]==6, {k:v for k,v in bad.items() if v.get("outcome")!="refused"})
r=end(DANA); ck("leaving the circle ends the link; the person and her history stay", r.get("outcome")=="ended" and r.get("links")==1
   and s.run("select active, ended_at is not null from person_relationship where person_id=:p", p=P)[0]==[False,True]
   and s.run("select count(*) from person_identity where id=:p", p=P)[0][0]==1, r)
r=link(DANA); ck("rejoining reopens the same link (no duplicate)", r.get("outcome")=="linked" and s.run("select count(*), bool_and(active) from person_relationship where person_id=:p", p=P)[0]==[1,True], r)
ck("every call is in the audit, including refusals and the clash", s.run("select count(*) from identity_door_audit where op in ('link_family','end_family')")[0][0]>=14)
def err(f):
    try: f(); return None
    except DatabaseError as e: return str(e)[:80]
KAT=Connection(user="postgres",database="postgres",unix_sock=sock); KAT.run("set role authenticated")
ck("a browser can't reach either function", err(lambda: KAT.run("select public.person_link_family_contact('1','x','x','x')")) and err(lambda: KAT.run("select public.person_end_family_contact('1','x','x','x')")))
ck("the live values survive: historical and earlier outcomes still allowed", s.run("select pg_get_constraintdef(oid) from pg_constraint where conname='identity_door_audit_op_check'")[0][0].count("resolve_historical")==1
   and "invalid_resolution" in s.run("select pg_get_constraintdef(oid) from pg_constraint where conname='identity_door_audit_outcome_check'")[0][0])
rc,out=psql(RBK); ck("rollback refuses once links exist", rc!=0 and "history" in out, out[-200:])
s.run("drop function person_link_family_contact(text,text,text,text)"); s.run("drop function person_end_family_contact(text,text,text,text)")
s2=Connection(user="postgres",database="postgres",unix_sock=sock); s2.run("alter table identity_door_audit disable trigger all"); s2.run("delete from identity_door_audit where op in ('link_family','end_family')")
rc,out=psql(SQL); rc2,out2=psql(RBK); d_op=s.run("select pg_get_constraintdef(oid) from pg_constraint where conname='identity_door_audit_op_check'")[0][0]
ck("rollback while nothing is linked restores the live lists exactly (historical kept, family removed)", rc==0 and rc2==0 and "resolve_historical" in d_op and "link_family" not in d_op, [out2[-200:], d_op])
for n_,o,dd in res: print(("PASS" if o else "FAIL")+" · "+n_+("" if o else "  :: "+dd))
print(f"{sum(x[1] for x in res)}/{len(res)}")
