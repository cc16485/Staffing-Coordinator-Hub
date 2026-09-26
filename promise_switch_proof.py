import os, json, threading, subprocess, re
from http.server import BaseHTTPRequestHandler, HTTPServer
H=os.path.dirname(os.path.abspath(__file__))
ENGINE=open("/Users/samantha/Claude/Projects/cc-hub-live/promise-engine.js").read()
S={}
def reset(): S.update(engine=ENGINE, deployed=True, settings={"obligations_live":True,"morning_brief_recipients":["a@x"]}, ops=132, jobs={}, runs=0, fn_created=0, fn_adds=0)
class Hd(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def send(self,code,obj,raw=False):
        b=(obj if raw else json.dumps(obj)).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self): self.send(200 if S["deployed"] else 404, "ok", True)
    def do_GET(self):
        if self.path.startswith("/promise-engine.js"): return self.send(200,S["engine"],True)
        if self.path.endswith("/api-keys"): return self.send(200,[{"name":"anon","api_key":"ANONKEY"},{"name":"service_role","api_key":"svc"}])
        self.send(404,{})
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if self.path.endswith("/database/query"):
            q=body["query"]
            if "insert into public.app_data" in q:
                v=("promises_live', true" in q); S["settings"]["promises_live"]=v
                return self.send(200,[{"live":"true" if v else "false","keys":len(S["settings"])}])
            if "jsonb_object_keys" in q: return self.send(200,[{"keys":len(S["settings"])}])
            if "ops_items" in q: return self.send(200,[{"n":S["ops"]}])
            if "cron.unschedule" in q: S["jobs"].pop("promise-run",None); return self.send(200,[])
            if "cron.schedule" in q:
                assert "Bearer ANONKEY" in q and "/functions/v1/promise-run" in q and "'7 * * * *'" in q
                S["jobs"]["promise-run"]={"jobname":"promise-run","schedule":"7 * * * *","active":True}; return self.send(200,[{"schedule":1}])
            if "from cron.job" in q: return self.send(200,list(S["jobs"].values()))
            return self.send(400,{"error":"unexpected "+q[:80]})
        if self.path.startswith("/functions/v1/promise-run"):
            assert self.headers.get("Authorization")=="Bearer svc"; S["runs"]+=1; S["ops"]+=S["fn_adds"]
            return self.send(200,{"ok":True,"dry":not S["settings"].get("promises_live"),"contracts_seen":0,"reviews_seen":0,"created":S["fn_created"],"closed":0,"create_preview":[]})
        self.send(404,{})
srv=HTTPServer(("127.0.0.1",0),Hd); port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{port}"
res=[]
def ck(n,c,note=""): res.append((n,bool(c),"" if c else str(note)[-700:]))
def go(mode):
    rep=os.path.join(H,"psw.txt")
    env=dict(os.environ,SB_MODE=mode,SB_REPORT=rep,SB_TOKEN="sbp_test",SB_REF="REF",SB_API_BASE=base,SB_FN_BASE=base,SB_ENGINE_URL=base+"/promise-engine.js")
    p=subprocess.run(["python3",os.path.join(H,"promise_switch.py")],env=env,capture_output=True,text=True)
    out=open(rep).read() if os.path.exists(rep) else p.stdout+p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode,out
reset(); S["engine"]="old"; rc,rep=go("on")
ck("on · stops and changes nothing if the live engine has no work items", rc==2 and "promises_live" not in S["settings"] and not S["jobs"], rep)
reset(); S["deployed"]=False; rc,rep=go("on")
ck("on · stops and changes nothing if promise-run isn't deployed", rc==2 and "promises_live" not in S["settings"] and not S["jobs"], rep)
reset(); rc,rep=go("on")
ck("on · flips the switch keeping every other setting, schedules exactly one hourly job with the public key, runs live once, counts match",
   rc==0 and S["settings"]=={"obligations_live":True,"morning_brief_recipients":["a@x"],"promises_live":True} and list(S["jobs"])==["promise-run"]
   and S["runs"]==1 and "TURNED ON" in rep and "the other 2 settings kept" in rep, rep)
rc,rep=go("on")
ck("on · running it again leaves one job, not two", rc==0 and len(S["jobs"])==1, S["jobs"])
S["fn_created"]=1; S["fn_adds"]=2; rc,rep=go("on")
ck("on · if My Work changed by more than the run reports, it says so and fails", rc==6 and "does not match" in rep, rep)
reset(); go("on"); rc,rep=go("off")
ck("off · flips the switch off keeping every other setting and removes the schedule", rc==0 and S["settings"].get("promises_live") is False
   and S["settings"]["obligations_live"] is True and not S["jobs"] and "TURNED OFF" in rep, rep)
srv.shutdown()
print("\nSTEP 6 ON/OFF SCRIPTS · PROOF AGAINST FAKE SERVICES\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
