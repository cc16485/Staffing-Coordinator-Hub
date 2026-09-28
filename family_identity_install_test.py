# I1 installer against a fake Management API running the REAL SQL on a disposable Postgres.
import os, sys, json, glob, hashlib, tempfile, threading, subprocess
import pgserver
from pg8000.native import Connection, DatabaseError
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
HUB="/Users/samantha/Claude/Projects/Staffing-Coordinator-Hub/"
sha=lambda p: hashlib.sha256(open(p,"rb").read()).hexdigest()
d=tempfile.mkdtemp(prefix="i1i_"); srv=pgserver.get_server(d)
host=[kv[5:] for kv in srv.get_uri().split("?",1)[1].split("&") if kv.startswith("host=")][0]
sock=[p for p in glob.glob(os.path.join(host,".s.PGSQL.*")) if not p.endswith(".lock")][0]; port=sock.rsplit(".",1)[1]
psqlb=os.path.join(os.path.dirname(pgserver.__file__),"pginstall","bin","psql")
root=Connection(user="postgres",database="postgres",unix_sock=sock)
for r in ["anon","authenticated"]: root.run(f"do $$ begin create role {r} nologin; exception when duplicate_object then null; end $$;")
root.run("do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;")
def setup(tables=True):
    root.run("drop function if exists person_link_family_contact(text,text,text,text)"); root.run("drop function if exists person_end_family_contact(text,text,text,text)")
    for t in ["identity_door_audit","phone_index","person_relationship","person_source_id","person_identity","circle_contacts","care_circles"]: root.run(f"drop table if exists {t} cascade")
    if not tables: return
    root.run("create table person_identity (id uuid primary key default gen_random_uuid(), display_name text not null, primary_phone text)")
    root.run("create table person_source_id (id bigserial primary key, person_id uuid, system text, entity_type text, source_id text, confidence text, needs_review boolean, evidence text)")
    root.run("create table person_relationship (id bigserial primary key, person_id uuid, client_person_id uuid, relationship text, responsible_party boolean default false, active boolean default true, ended_at date, source text default 'office')")
    root.run("create table phone_index (id bigserial primary key, phone text, person_id uuid, kind text, shared boolean default false, unique(phone, person_id))")
    root.run("create table identity_door_audit (id bigserial primary key, at timestamptz default now(), op text not null check (op in ('resolve_or_create','attach_source')), workflow text, acting_staff text, system text, entity_type text, source_id text, outcome text not null check (outcome in ('resolved_existing','created_new','conflict','invalid_source','attached','already_attached')), person_id uuid, evidence text, detail text)")
    root.run("create table care_circles (id bigserial primary key, active boolean, axiscare_client_id text)")
    root.run("create table circle_contacts (id bigserial primary key, circle_id bigint, name text, phone text)")
def runsql(q):
    if "begin;" in q:
        f=tempfile.mktemp(suffix=".sql"); open(f,"w").write(q)
        p=subprocess.run([psqlb,"-X","-q","-v","ON_ERROR_STOP=1","-h",host,"-p",port,"-U","postgres","-d","postgres","-f",f],capture_output=True,text=True)
        return (201,[]) if p.returncode==0 else (400,{"message":p.stderr[-200:]})
    c=Connection(user="postgres",database="postgres",unix_sock=sock)
    try: rows=c.run(q); cols=[x["name"] for x in (c.columns or [])]; return 201,[dict(zip(cols,r)) for r in (rows or [])]
    except DatabaseError as e: return 400,{"message":str(e)[:200]}
    finally: c.close()
class Hd(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_POST(self):
        n=int(self.headers.get("Content-Length") or 0); c,o=runsql(json.loads(self.rfile.read(n))["query"])
        b=json.dumps(o,default=str).encode(); self.send_response(c); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
s2=ThreadingHTTPServer(("127.0.0.1",0),Hd); threading.Thread(target=s2.serve_forever,daemon=True).start(); base=f"http://127.0.0.1:{s2.server_port}"
def run(sqlsha=None, fresh=True, tables=True):
    if fresh: setup(tables)
    rep=tempfile.mktemp()
    p=subprocess.run([sys.executable,HUB+"family_identity_install.py"],env=dict(os.environ,SB_REPORT=rep,SB_TOKEN="sbp_x",SB_API_BASE=base,SB_SQL=HUB+"family-identity.sql",SB_SQL_SHA=sqlsha or sha(HUB+"family-identity.sql")),capture_output=True,text=True)
    return p.returncode,(open(rep).read() if os.path.exists(rep) else p.stderr[-400:])
res=[]
def ck(n,c,dd=""): res.append((n,bool(c),"" if c else str(dd)[-800:]))
present=lambda: root.run("select to_regprocedure('public.person_link_family_contact(text,text,text,text)') is not null")[0][0]
rc,r=run(); ck("installs the rule, every check passes, nobody linked", rc==0 and "RESULT: INSTALLED" in r and "family linked so far: 0" in r and present(), r)
rc,r=run(fresh=False); ck("a second run changes nothing and still passes", rc==0 and "nothing to install" in r, r)
rc,r=run(sqlsha="0"*64); ck("a script that is not the reviewed one: stops before anything", rc==2 and not present(), r)
rc,r=run(tables=False); ck("identity tables missing: stops, nothing changed", rc==4 and not present(), r)
s2.shutdown()
for n_,o,dd in res: print(("PASS" if o else "FAIL")+" · "+n_+("" if o else "\n"+dd))
print(f"{sum(x[1] for x in res)}/{len(res)}")
