# K3 installer against a fake Management API running the REAL SQL on a disposable Postgres, fake functions and a fake CLI.
import os, sys, json, glob, hashlib, tempfile, threading, subprocess, re
import pgserver
from pg8000.native import Connection, DatabaseError
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
HUB="/Users/samantha/Claude/Projects/Staffing-Coordinator-Hub/"; FN=HUB+"supabase/functions"
sha=lambda p: hashlib.sha256(open(p,"rb").read()).hexdigest()
d=tempfile.mkdtemp(prefix="k1i_"); srv=pgserver.get_server(d)
host=[kv[5:] for kv in srv.get_uri().split("?",1)[1].split("&") if kv.startswith("host=")][0]
sock=[p for p in glob.glob(os.path.join(host,".s.PGSQL.*")) if not p.endswith(".lock")][0]; port=sock.rsplit(".",1)[1]
psqlb=os.path.join(os.path.dirname(pgserver.__file__),"pginstall","bin","psql")
root=Connection(user="postgres",database="postgres",unix_sock=sock)
for r in ["anon","authenticated"]: root.run(f"do $$ begin create role {r} nologin; exception when duplicate_object then null; end $$;")
root.run("do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;")
root.run("grant usage on schema public to anon, authenticated, service_role")
def setup():
    root.run("drop table if exists call_placement cascade"); root.run("drop function if exists call_record_place(bigint[],text,text,uuid,text,text,text)"); root.run("drop function if exists call_placement_guard()")
    root.run("drop table if exists call_record cascade"); root.run("drop function if exists call_record_add(text,text,text,text,text,text,text,text,text,text,text)"); root.run("drop function if exists call_record_guard()")
    root.run("create table if not exists app_data (key text primary key, data jsonb)")
    root.run("create table if not exists app_data_key_hub_map (data_key text, hub_slug text)")
    root.run("create or replace function can_access_data_key(k text) returns boolean language sql stable as $$ select true $$")
    root.run("create table if not exists person_identity (id uuid primary key default gen_random_uuid())")
    root.run("create table if not exists phone_index (id bigserial primary key, phone text, person_id uuid)")
S={"fns":{"call-place":True},"sqlfail":False}
def runsql(q):
    if "begin;" in q:
        if S["sqlfail"]: return 400,{"message":"forced"}
        f=tempfile.mktemp(suffix=".sql"); open(f,"w").write(q)
        p=subprocess.run([psqlb,"-X","-q","-v","ON_ERROR_STOP=1","-h",host,"-p",port,"-U","postgres","-d","postgres","-f",f],capture_output=True,text=True)
        return (201,[]) if p.returncode==0 else (400,{"message":p.stderr[-200:]})
    c=Connection(user="postgres",database="postgres",unix_sock=sock)
    try: rows=c.run(q); cols=[x["name"] for x in (c.columns or [])]; return 201,[dict(zip(cols,r)) for r in (rows or [])]
    except DatabaseError as e: return 400,{"message":str(e)[:200]}
    finally: c.close()
class Hd(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def _j(self,code,obj): b=json.dumps(obj,default=str).encode(); self.send_response(code); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        m=re.match(r"/v1/projects/\w+/functions/([\w-]+)$",self.path)
        if m and m.group(1) in S["fns"]: return self._j(200,{"verify_jwt":S["fns"][m.group(1)]})
        self._j(404,{})
    def do_OPTIONS(self):
        self.send_response(200); self.send_header("Content-Length","0"); self.end_headers()
    def do_POST(self):
        n=int(self.headers.get("Content-Length") or 0); b=self.rfile.read(n) if n else b""
        if self.path.endswith("/database/query"): c,o=runsql(json.loads(b)["query"]); return self._j(c,o)
        if "/functions/v1/" in self.path: return self._j(401,{"error":"Sign in first."})
        self._j(404,{})
s2=ThreadingHTTPServer(("127.0.0.1",0),Hd); threading.Thread(target=s2.serve_forever,daemon=True).start(); base=f"http://127.0.0.1:{s2.server_port}"
cli=tempfile.mktemp(); open(cli,"w").write("#!/bin/sh\necho \"$@\" >> \"$CLI_LOG\"\nexit ${CLI_FAIL:-0}\n"); os.chmod(cli,0o755)
def k1():
    f=tempfile.mktemp(suffix=".sql"); open(f,"w").write(open(HUB+"call-record.sql").read())
    subprocess.run([psqlb,"-X","-q","-v","ON_ERROR_STOP=1","-h",host,"-p",port,"-U","postgres","-d","postgres","-f",f],capture_output=True,text=True)
def run(sqlsha=None, fail=0, sqlfail=False, fresh=True, withk1=True):
    if fresh:
        setup()
        if withk1: k1()
    S["sqlfail"]=sqlfail; rep=tempfile.mktemp(); log=tempfile.mktemp()
    env=dict(os.environ,SB_FNROOT=FN,SB_FN_SHA=sha(FN+"/call-place/index.ts"),SB_REPORT=rep,SB_SQL=HUB+"call-place.sql",SB_SQL_SHA=sqlsha or sha(HUB+"call-place.sql"),
             SB_TOKEN="sbp_x",SB_SUPA_CLI=cli,CLI_LOG=log,CLI_FAIL=str(fail),SB_API_BASE=base,SB_FN_BASE=base)
    p=subprocess.run([sys.executable,HUB+"call_place_install.py"],env=env,capture_output=True,text=True)
    return p.returncode,(open(rep).read() if os.path.exists(rep) else p.stderr[-400:]),(open(log).read() if os.path.exists(log) else "")
res=[]
def ck(n,c,dd=""): res.append((n,bool(c),"" if c else str(dd)[-900:]))
installed=lambda: root.run("select to_regclass('public.call_placement') is not null")[0][0]
rc,r,lg=run(); ck("installs the record, deploys call-place with the gateway sign-in on, every check passes", rc==0 and "RESULT: INSTALLED" in r and installed() and "deploy call-place" in lg and "--no-verify-jwt" not in lg, r+lg)
rc,r,lg=run(fresh=False); ck("a second run skips the install and still passes", rc==0 and "already installed" in r, r)
rc,r,lg=run(withk1=False); ck("without the call record (K1): stops, nothing changed", rc==4 and not lg and not installed(), r)
rc,r,lg=run(sqlsha="0"*64); ck("a script that is not the reviewed one: stops before anything", rc==2 and not lg and not installed(), r)
rc,r,lg=run(sqlfail=True); ck("an install that fails: nothing changed, function not deployed", rc==5 and not lg, r)
rc,r,lg=run(fail=1); ck("a failed deploy: says the Hub's list stays hidden", rc==6 and "stays hidden" in r and installed(), r)
s2.shutdown()
for n_,o,dd in res: print(("PASS" if o else "FAIL")+" · "+n_+("" if o else "\n"+dd))
print(f"{sum(x[1] for x in res)}/{len(res)}")
