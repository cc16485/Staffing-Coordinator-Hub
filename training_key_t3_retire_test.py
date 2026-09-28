# T3 retire script end to end: a fake Management API that runs the REAL SQL on a disposable Postgres (one database per
# project), fake functions, and the real updated pages served as "live". Nothing real is touched.
import os, sys, json, glob, hashlib, tempfile, threading, subprocess, re
import pgserver
from pg8000.native import Connection, DatabaseError
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
HUB="/Users/samantha/Claude/Projects/Staffing-Coordinator-Hub/"; P="/Users/samantha/Claude/Projects/"
sha=lambda p: hashlib.sha256(open(p,"rb").read()).hexdigest()
d=tempfile.mkdtemp(prefix="t3_"); srv=pgserver.get_server(d)
host=[kv[5:] for kv in srv.get_uri().split("?",1)[1].split("&") if kv.startswith("host=")][0]
sock=[p for p in glob.glob(os.path.join(host,".s.PGSQL.*")) if not p.endswith(".lock")][0]
root=Connection(user="postgres",database="postgres",unix_sock=sock)
KEY="cchub_OLDVALUE_abcdefghijklmnopqrstuv12"
def setup():
    for db in ["training","hub"]:
        root.run(f"drop database if exists {db}"); root.run(f"create database {db}")
    t=Connection(user="postgres",database="training",unix_sock=sock); t.run("create table app_settings (key text primary key, value jsonb)"); t.run("insert into app_settings values ('hub_read_key', :v)", v=json.dumps({"key":KEY})); t.close()
    h=Connection(user="postgres",database="hub",unix_sock=sock); h.run("create table app_data (key text primary key, data jsonb, updated_at timestamptz)")
    h.run("insert into app_data (key,data) values ('cc_hub_config',:a),('settings',:b),('team_hub_settings',:c),('leads','[]'),('notes',:n)",
          a=json.dumps({"training_hub_key":KEY,"axiscare_token":"","axiscare_site":"16485","checkin_cadence":30}),
          b=json.dumps({"training_hub_key":KEY,"staff_users":[{"email":"x@cc.test"}]}),
          c=json.dumps([{"id":"hub_config","training_hub_key":KEY,"cc_hub_url":"https://cc.mo-care.com"},{"id":"other","v":1}]),
          n=json.dumps({"text":"pasted "+KEY}))
    h.close()
DB={"rdqujxiycycwhskyvrwa":"training","zngsgedlsxinbygwmxwn":"hub"}
S={"fns":{}, "pages":{}}
def runsql(db,q):
    c=Connection(user="postgres",database=db,unix_sock=sock)
    try:
        if q.strip().lower().startswith("begin"):
            f=tempfile.mktemp(suffix=".sql"); open(f,"w").write(q)
            psql=os.path.join(os.path.dirname(pgserver.__file__),"pginstall","bin","psql"); port=sock.rsplit(".",1)[1]
            p=subprocess.run([psql,"-X","-q","-v","ON_ERROR_STOP=1","-h",host,"-p",port,"-U","postgres","-d",db,"-f",f],capture_output=True,text=True)
            return (201,[]) if p.returncode==0 else (400,{"message":p.stderr[-300:]})
        rows=c.run(q); cols=[x["name"] for x in (c.columns or [])]; return 201,[dict(zip(cols,r)) for r in (rows or [])]
    except DatabaseError as e: return 400,{"message":str(e)[:300]}
    finally: c.close()
class Hd(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def _j(self,code,obj):
        b=json.dumps(obj,default=str).encode(); self.send_response(code); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
    def _body(self): n=int(self.headers.get("Content-Length") or 0); return self.rfile.read(n) if n else b""
    def do_GET(self):
        p=self.path.split("?")[0]
        if p.startswith("/page/"):
            src=S["pages"].get(p[6:]); b=(src or "").encode(); self.send_response(200 if src else 404); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b); return
        m=re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$",p)
        if m: return self._j(200,{"slug":m.group(2)}) if (m.group(1),m.group(2)) in S["fns"] else self._j(404,{})
        self._j(404,{})
    def do_DELETE(self):
        m=re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$",self.path); S["fns"].pop((m.group(1),m.group(2)),None); self._j(200,{})
    def do_POST(self):
        b=self._body(); p=self.path.split("?")[0]
        m=re.match(r"/v1/projects/(\w+)/database/query$",p)
        if m: code,out=runsql(DB[m.group(1)], json.loads(b)["query"]); return self._j(code,out)
        m=re.match(r"/(\w+)/functions/v1/([\w-]+)$",p)
        if m: return self._j(401,{}) if (m.group(1),m.group(2)) in S["fns"] else self._j(404,{})
        self._j(404,{})
srv2=ThreadingHTTPServer(("127.0.0.1",0),Hd); threading.Thread(target=srv2.serve_forever,daemon=True).start(); base=f"http://127.0.0.1:{srv2.server_port}"
SRC={"cc":open(P+"cc-hub-live/index.html").read(),"eng":open(P+"cc-hub-live/caregivers-engine.js").read(),"sc":open(P+"Staffing-Coordinator-Hub/index.html").read(),
     "th":open(P+"team-hub/index.html").read(),"of":open(P+"team-hub/offer.html").read(),"ow":open(P+"team-hub/owners.html").read(),"ad":open(P+"team-hub/admin.html").read()}
def run(old_pages=False, t_sha=None, break_shared=False):
    setup(); S["fns"]={("rdqujxiycycwhskyvrwa","axiscare-config"):1,("zngsgedlsxinbygwmxwn","axiscare-config"):1,("rdqujxiycycwhskyvrwa","hub-training-data"):1}
    S["pages"]={k:(v+("\nPaste the Training Hub read key" if old_pages and k=="cc" else "")) for k,v in SRC.items()}
    ssql=HUB+"training-key-retire-shared.sql"
    if break_shared:
        tmp=tempfile.mktemp(suffix=".sql"); open(tmp,"w").write(open(ssql).read().replace("do $verify$","update public.app_data set data = data || '{\"training_hub_key\":\"x\"}' where key='settings';\ndo $verify$",1)); ssql=tmp
    rep=tempfile.mktemp()
    env=dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_x", SB_API_BASE=base, SB_FN_BASE=base+"/rdqujxiycycwhskyvrwa", SB_HUB_FN_BASE=base+"/zngsgedlsxinbygwmxwn",
             SB_T_SHA=t_sha or sha(HUB+"training-key-retire-training.sql"), SB_S_SQL=ssql, SB_S_SHA=sha(ssql), SB_PAGES=json.dumps({k:base+"/page/"+k for k in SRC}))
    p=subprocess.run([sys.executable,HUB+"training_key_t3_retire.py"],env=env,capture_output=True,text=True)
    return p.returncode,(open(rep).read() if os.path.exists(rep) else p.stderr[-500:])
def q(db,sqlq): c=Connection(user="postgres",database=db,unix_sock=sock); r=c.run(sqlq); c.close(); return r
res=[]
def ck(n,c,dd=""): res.append((n,bool(c),"" if c else str(dd)[-1500:]))
rc,r=run()
ck("full run: every step and every check passes", rc==0 and "RESULT: RETIRED" in r, r)
newk=q("training","select value->>'key' from app_settings where key='hub_read_key'")[0][0]
ck("the Training key is a new long random value", newk!=KEY and newk.startswith("retired_") and len(newk)>=70, newk[:12])
cc=q("hub","select data from app_data where key='cc_hub_config'")[0][0]; st=q("hub","select data from app_data where key='settings'")[0][0]; th=q("hub","select data from app_data where key='team_hub_settings'")[0][0]
ck("the three settings records lose only the key (and the empty token slot); everything else is kept",
   "training_hub_key" not in cc and "axiscare_token" not in cc and cc.get("axiscare_site")=="16485" and cc.get("checkin_cadence")==30
   and "training_hub_key" not in st and st.get("staff_users") and th==[{"id":"hub_config","cc_hub_url":"https://cc.mo-care.com"},{"id":"other","v":1}], [cc,st,th])
ck("names the other record that held the old value (and leaves it for a person to look at)", "other shared records holding the same value (names only): notes" in r, r)
ck("both axiscare-config copies are deleted", ("rdqujxiycycwhskyvrwa","axiscare-config") not in S["fns"] and ("zngsgedlsxinbygwmxwn","axiscare-config") not in S["fns"] and r.count("axiscare-config is gone")==2, r)
ck("never prints the key (old or new)", KEY not in r and newk not in r and "OLDVALUE" not in r)
rc,r=run(old_pages=True); k2=q("training","select value->>'key' from app_settings where key='hub_read_key'")[0][0]
ck("a live page still asking for the key: stops before any change", rc==3 and k2==KEY and ("rdqujxiycycwhskyvrwa","axiscare-config") in S["fns"], r)
rc,r=run(t_sha="0"*64); ck("a script that is not the reviewed one: stops before anything", rc==2, r)
rc,r=run(break_shared=True); st=q("hub","select data from app_data where key='settings'")[0][0]; k3=q("training","select value->>'key' from app_settings where key='hub_read_key'")[0][0]
ck("if the settings cleanup fails its self-check: it undoes itself, says the key is already replaced, and stops", rc==6 and "training_hub_key" in st and k3!=KEY and "already replaced" in r, r)
srv2.shutdown()
for n,o,dd in res: print(("PASS" if o else "FAIL")+" · "+n+("" if o else "\n"+dd))
print(f"{sum(x[1] for x in res)}/{len(res)}")
