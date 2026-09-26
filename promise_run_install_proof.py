import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
H=os.path.dirname(os.path.abspath(__file__))
FNDIR="/Users/samantha/Claude/Projects/Staffing-Coordinator-Hub/supabase/functions/promise-run"
SHA=hashlib.sha256(open(os.path.join(FNDIR,"index.ts"),"rb").read()).hexdigest()
ENGINE=open("/Users/samantha/Claude/Projects/cc-hub-live/promise-engine.js").read()
S={"engine":ENGINE,"live":False,"ops":5,"logged":False,"fn_changes_ops":False}
class Hd(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def send(self,code,obj,raw=False):
        b=(obj if raw else json.dumps(obj)).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.startswith("/promise-engine.js"): return self.send(200,S["engine"],True)
        if self.path.endswith("/api-keys"): return self.send(200,[{"name":"anon","api_key":"a"},{"name":"service_role","api_key":"svc"}])
        self.send(404,{})
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if self.path.endswith("/database/query"):
            q=body["query"]
            if "ops_items" in q: return self.send(200,[{"n":S["ops"]}])
            if "promises_live" in q: return self.send(200,[{"live":S["live"]}])
            if "automation_log" in q: return self.send(200,[{"at":"x","dry":"true","rows_seen":"3"}] if S["logged"] else [])
        if self.path.startswith("/functions/v1/promise-run"):
            assert self.headers.get("Authorization")=="Bearer svc"
            S["logged"]=True
            if S["fn_changes_ops"]: S["ops"]+=1
            return self.send(200,{"ok":True,"dry":True,"contracts_seen":2,"reviews_seen":1,"would_create":2,"would_close":0,"skipped_existing":0,"too_old":0,"deferred":0,
              "max_age_days":60,"max_per_run":20,"create_preview":[{"title":"Update owed to Cathy (daughter) about Ruth Jones","owner":"kat@cc.test","due":"2026-09-25T04:59:59.999Z","urgency":"normal"}],"close_preview":[]})
        self.send(404,{})
srv=HTTPServer(("127.0.0.1",0),Hd); port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{port}"
res=[]
def ck(n,c,note=""): res.append((n,bool(c),"" if c else str(note)[-700:]))
def go(sha=SHA):
    rep=os.path.join(H,"pri.txt")
    env=dict(os.environ,SB_FNDIR=FNDIR,SB_FN_SHA=sha,SB_REPORT=rep,SB_TOKEN="sbp_test",SB_REF="REF",SB_SKIP_FUNCTION="1",
             SB_API_BASE=base,SB_FN_BASE=base,SB_ENGINE_URL=base+"/promise-engine.js")
    p=subprocess.run(["python3",os.path.join(H,"promise_run_install.py")],env=env,capture_output=True,text=True)
    out=open(rep).read() if os.path.exists(rep) else p.stdout+p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode,out
rc,rep=go("0"*64); ck("a function source that is not the reviewed one stops before anything runs", rc==2 and not S["logged"], rep)
S["engine"]="(function(root){ root.CCPromise={evaluate:function(){}}; })(this)"
rc,rep=go(); ck("if the live hub still serves the old engine (hub update not merged), it stops before deploying or running", rc==3 and "merge the Step 6 hub update first" in rep and not S["logged"], rep)
S["engine"]=ENGINE; S["live"]=True
rc,rep=go(); ck("if the switch is already on, it refuses (this script only dry-runs)", rc==4 and not S["logged"], rep)
S["live"]=False
rc,rep=go(); ck("happy path: dry run read, My Work unchanged, logged, and the report lists what it would create",
   rc==0 and "DRY RUN READ" in rep and "+ Update owed to Cathy (daughter) about Ruth Jones" in rep and "would create 2" in rep and "✓ My Work unchanged" in rep, rep)
S["fn_changes_ops"]=True; S["logged"]=False
rc,rep=go(); ck("if My Work changed during the dry run, it says so and fails", rc==8 and "✗ My Work item count changed" in rep, rep)
srv.shutdown()
print("\nSTEP 6 DRY-RUN INSTALLER · PROOF AGAINST FAKE SERVICES\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
