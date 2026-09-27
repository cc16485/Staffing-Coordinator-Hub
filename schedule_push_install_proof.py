#!/usr/bin/env python3
# Change 4 · the install script (248) against fake Supabase services. Never touches production.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
H=os.path.dirname(os.path.abspath(__file__))
FNDIR=os.path.join(H,"supabase","functions","schedule-push")
SHA=hashlib.sha256(open(os.path.join(FNDIR,"index.ts"),"rb").read()).hexdigest()
S={"perm":{"ok":True,"status":400,"detail":"AxisCare checked the request and refused it as incomplete (days are required)."},"cors":True,"calls":[]}
class Hd(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def send(self,code,obj,headers=None):
        b=json.dumps(obj).encode(); self.send_response(code)
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self):
        return self.send(200,"ok",{"Access-Control-Allow-Origin":"*"} if S["cors"] else {})
    def do_GET(self):
        if self.path.endswith("/api-keys"): return self.send(200,[{"name":"anon","api_key":"a"},{"name":"service_role","api_key":"svc"}])
        self.send(404,{})
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        S["calls"].append((self.path,self.headers.get("Authorization"),body))
        if self.path.startswith("/functions/v1/schedule-push"): return self.send(200,S["perm"])
        self.send(404,{})
srv=HTTPServer(("127.0.0.1",0),Hd); port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{port}"
res=[]
def ck(n,c,note=""): res.append((n,bool(c),"" if c else str(note)[-700:]))
def go(sha=SHA):
    rep=os.path.join(H,"_spi.txt")
    env=dict(os.environ,SB_FNDIR=FNDIR,SB_FN_SHA=sha,SB_REPORT=rep,SB_TOKEN="sbp_test",SB_REF="REF",SB_SKIP_FUNCTION="1",SB_API_BASE=base,SB_FN_BASE=base)
    p=subprocess.run(["python3",os.path.join(H,"schedule_push_install.py")],env=env,capture_output=True,text=True)
    out=open(rep).read() if os.path.exists(rep) else p.stdout+p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode,out
rc,rep=go("0"*64); ck("a function source that is not the reviewed one stops before anything runs", rc==2 and not S["calls"], rep)
rc,rep=go(); ck("happy path: CORS answered, the permission check runs with the server key and passes, READY",
   rc==0 and "READY · merge the hub update" in rep and "Nothing was created" in rep and S["calls"][-1][1]=="Bearer svc" and S["calls"][-1][2]=={"action":"permission_check"}, rep)
S["perm"]={"ok":False,"status":403,"detail":"AxisCare refused: this connection may not create schedules"}
rc,rep=go(); ck("AxisCare refuses: NOT READY, and it says not to merge the hub update", rc==5 and "do NOT merge the hub update" in rep and "may not create schedules" in rep, rep)
S["perm"]={"ok":True,"status":400,"detail":"x"}; S["cors"]=False
rc,rep=go(); ck("no CORS answer: NOT READY", rc==5 and "CORS preflight" in rep, rep)
srv.shutdown()
print("\nCHANGE 4 · INSTALL SCRIPT · PROOF AGAINST FAKE SERVICES\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
