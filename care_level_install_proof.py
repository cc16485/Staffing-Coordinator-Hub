#!/usr/bin/env python3
# Change 6b · the install script (252) against fake services.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
H=os.path.dirname(os.path.abspath(__file__)); FNROOT=os.path.join(H,"supabase","functions")
sh=lambda p: hashlib.sha256(open(p,"rb").read()).hexdigest()
FNS={f:sh(os.path.join(FNROOT,f,"index.ts")) for f in ("care-level","coverage-run","coverage-shifts","profile-check")}; FNS["_shared/care-level.ts"]=sh(os.path.join(FNROOT,"_shared","care-level.ts"))
S={"page":"<html> ccLevelsLoad </html>","calls":[]}
VOCAB=[{"label":"Level 1 - Wellness Care","reads_as":"level","level":1},{"label":"Level 2 - Personal Care","reads_as":"level","level":2},{"label":"Personal Care","reads_as":"level","level":2},
       {"label":"Medicaid","reads_as":"payer","level":None},{"label":"Medicaid Personal Care","reads_as":"mixed","level":2},{"label":"Dogs","reads_as":"other","level":None}]
LEVELS={"501":{"level":2,"classes":["Level 2 - Personal Care","Medicaid"]},"502":{"level":1,"classes":["Level 1 - Wellness Care"]},"503":{"level":None,"classes":["Dogs"]},"504":{"level":2,"classes":["Medicaid Personal Care"]}}
class Hd(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def send(self,code,obj,raw=False,headers=None):
        b=(obj if raw else json.dumps(obj)).encode(); self.send_response(code)
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self): return self.send(200,"ok",True,{"Access-Control-Allow-Origin":"*"})
    def do_GET(self):
        if self.path.startswith("/?v="): return self.send(200,S["page"],True)
        if self.path.endswith("/api-keys"): return self.send(200,[{"name":"service_role","api_key":"svc-key"}])
        self.send(404,{})
    def do_POST(self):
        b=json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}"); S["calls"].append(b)
        if b.get("action")=="vocab": return self.send(200,{"classes":VOCAB})
        if b.get("action")=="levels": return self.send(200,{"levels":LEVELS})
        self.send(404,{})
srv=HTTPServer(("127.0.0.1",0),Hd); threading.Thread(target=srv.serve_forever,daemon=True).start(); base=f"http://127.0.0.1:{srv.server_address[1]}"
res=[]
def ck(n,c,note=""): res.append((n,bool(c),"" if c else str(note)[-800:]))
def go(**kw):
    rep=os.path.join(H,"_cli.txt"); env=dict(os.environ,SB_REPORT=rep,SB_TOKEN="sbp_t",SB_REF="R",SB_SKIP_FUNCTION="1",SB_API_BASE=base,SB_FN_BASE=base,SB_HUB_URL=base,SB_FNROOT=FNROOT,SB_FN_SHAS=json.dumps(FNS)); env.update(kw)
    p=subprocess.run(["python3",os.path.join(H,"care_level_install.py")],env=env,capture_output=True,text=True); out=open(rep).read() if os.path.exists(rep) else p.stdout+p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode,out
bad=dict(FNS); bad["_shared/care-level.ts"]="0"*64
rc,rep=go(SB_FN_SHAS=json.dumps(bad)); ck("a changed shared rule stops everything", rc==2 and not S["calls"], rep)
S["page"]="old"; rc,rep=go(); S["page"]="<html> ccLevelsLoad </html>"; ck("hub not merged yet: stops", rc==3, rep)
rc,rep=go()
ck("happy path: installed; every class shown with how the rule reads it", rc==0 and "INSTALLED" in rep and "Medicaid                           → payer (never changed by the hub)" in rep
   and "BOTH payer and level" in rep and "Dogs" in rep, rep)
ck("warns when two classes read as the same level (the update will refuse)", "2 classes read as Level 2 · Personal Care" in rep, rep)
ck("counts active clients by level, the ones with no level class, and the payer+level ones", "Level 2 · Personal Care: 2" in rep and "no level class in AxisCare: 1" in rep and "payer+level class" in rep and ": 1" in rep, rep)
ck("the report only READS (vocab and levels), never set", all(c.get("action") in ("vocab","levels") for c in S["calls"]), S["calls"])
srv.shutdown()
print("\nCHANGE 6b · INSTALL SCRIPT · PROOF AGAINST FAKE SERVICES\n"+"="*60); ok=True
for n,g,note in res: ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
