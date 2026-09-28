# Z2 end to end: a fake Management API running the REAL SQL on a disposable Postgres, and the real updated pages as "live".
import os, sys, json, glob, hashlib, tempfile, threading, subprocess, re
import pgserver
from pg8000.native import Connection, DatabaseError
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
HUB="/Users/samantha/Claude/Projects/Staffing-Coordinator-Hub/"; P="/Users/samantha/Claude/Projects/"
sha=lambda p: hashlib.sha256(open(p,"rb").read()).hexdigest()
d=tempfile.mkdtemp(prefix="z2_"); srv=pgserver.get_server(d)
host=[kv[5:] for kv in srv.get_uri().split("?",1)[1].split("&") if kv.startswith("host=")][0]
sock=[p for p in glob.glob(os.path.join(host,".s.PGSQL.*")) if not p.endswith(".lock")][0]; port=sock.rsplit(".",1)[1]
psql=os.path.join(os.path.dirname(pgserver.__file__),"pginstall","bin","psql")
Z="https://hooks.zapier.com/hooks/catch/1/SECRETPATH/"
def setup():
    c=Connection(user="postgres",database="postgres",unix_sock=sock); c.run("drop table if exists app_data"); c.run("create table app_data (key text primary key, data jsonb)")
    c.run("insert into app_data values ('settings',:a),('team_hub_settings',:b),('notes',:n),('leads','[]')",
      a=json.dumps({"zapier_cand_webhook":Z,"zapier_attend_webhook":"","ac_orient_webhook":Z,"ac_new_client_webhook":Z,"staff_users":[{"e":1}],"google_client_id":"g"}),
      b=json.dumps([{"id":"hub_config","access_webhook_url":Z,"cc_hub_url":"https://cc.mo-care.com"},{"id":"x"}]), n=json.dumps({"t":Z})); c.close()
def runsql(q):
    if q.strip().startswith("--") or q.strip().lower().startswith("begin"):
        f=tempfile.mktemp(suffix=".sql"); open(f,"w").write(q)
        p=subprocess.run([psql,"-X","-q","-v","ON_ERROR_STOP=1","-h",host,"-p",port,"-U","postgres","-d","postgres","-f",f],capture_output=True,text=True)
        return (201,[]) if p.returncode==0 else (400,{"message":p.stderr[-300:]})
    c=Connection(user="postgres",database="postgres",unix_sock=sock)
    try: rows=c.run(q); cols=[x["name"] for x in (c.columns or [])]; return 201,[dict(zip(cols,r)) for r in (rows or [])]
    except DatabaseError as e: return 400,{"message":str(e)[:300]}
    finally: c.close()
S={"pages":{}}
class Hd(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def _j(self,code,obj): b=json.dumps(obj,default=str).encode(); self.send_response(code); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        src=S["pages"].get(self.path.split("?")[0][6:]); b=(src or "").encode(); self.send_response(200 if src else 404); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n=int(self.headers.get("Content-Length") or 0); code,out=runsql(json.loads(self.rfile.read(n))["query"]); self._j(code,out)
s2=ThreadingHTTPServer(("127.0.0.1",0),Hd); threading.Thread(target=s2.serve_forever,daemon=True).start(); base=f"http://127.0.0.1:{s2.server_port}"
SRC={"cc":open(P+"cc-hub-live/index.html").read(),"eng":open(P+"cc-hub-live/caregivers-engine.js").read(),"sc":open(P+"Staffing-Coordinator-Hub/index.html").read(),"th":open(P+"team-hub/index.html").read()}
def run(stale=False, sqlsha=None):
    setup(); S["pages"]={k:(v+("\nzapFire('x')" if stale and k=="sc" else "")) for k,v in SRC.items()}
    rep=tempfile.mktemp()
    p=subprocess.run([sys.executable,HUB+"zapier_clear.py"],env=dict(os.environ,SB_REPORT=rep,SB_TOKEN="sbp_x",SB_API_BASE=base,SB_SQL_SHA=sqlsha or sha(HUB+"zapier-clear.sql"),SB_PAGES=json.dumps({k:base+"/page/"+k for k in SRC})),capture_output=True,text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stderr[-400:])
def q(x): c=Connection(user="postgres",database="postgres",unix_sock=sock); r=c.run(x); c.close(); return r
res=[]
def ck(n,c,dd=""): res.append((n,bool(c),"" if c else str(dd)[-1200:]))
rc,r=run()
st=q("select data from app_data where key='settings'")[0][0]; th=q("select data from app_data where key='team_hub_settings'")[0][0]
ck("clears and every check passes", rc==0 and "RESULT: CLEARED" in r, r)
ck("only the Zapier fields go; everything else is kept", not any(k.endswith("webhook") for k in st) and st["staff_users"]==[{"e":1}] and st["google_client_id"]=="g"
   and th==[{"id":"hub_config","cc_hub_url":"https://cc.mo-care.com"},{"id":"x"}], [st,th])
ck("names another record that mentions a Zapier address, and leaves it", "left for you to look at): notes" in r and q("select count(*) from app_data where key='notes'")[0][0]==1, r)
ck("never prints an address", "SECRETPATH" not in r)
rc,r=run(stale=True); st=q("select data from app_data where key='settings'")[0][0]
ck("a live page still sending to Zapier: stops before any change", rc==3 and "zapier_cand_webhook" in st, r)
rc,r=run(sqlsha="0"*64); ck("a script that is not the reviewed one: stops before anything", rc==2, r)
s2.shutdown()
for n,o,dd in res: print(("PASS" if o else "FAIL")+" · "+n+("" if o else "\n"+dd))
print(f"{sum(x[1] for x in res)}/{len(res)}")
