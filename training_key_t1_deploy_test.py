# T1 deploy script against a fake Supabase API, fake functions, fake live pages and a fake CLI. Nothing real is touched.
import os, sys, json, hashlib, subprocess, tempfile, threading, shutil
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
WT=os.environ.get("TRAINING_REPO", "/Users/samantha/Claude/Projects/Caring Companions Training Platform")+"/supabase/functions"; HUBP="/Users/samantha/Claude/Projects/"
FNS=["ghl-replies","ghl-thread","ghl-nurse-assign","axiscare-open-shifts"]
sha=lambda p: hashlib.sha256(open(p,"rb").read()).hexdigest()
SHAS={f:sha(f"{WT}/{f}/index.ts") for f in FNS}; GATE=sha(f"{WT}/_shared/hub-gate.ts")
KEY="cchub_SECRETVALUE_should_never_print_123"
S={"verify":{"ghl-replies":True,"ghl-thread":True,"ghl-nurse-assign":False,"axiscare-open-shifts":False},"pages":{},"seen":[], "accept_key":False}
PAGESRC={"cc":open(HUBP+"cc-hub-live/index.html").read(),"eng":open(HUBP+"cc-hub-live/caregivers-engine.js").read(),
         "sc":open(HUBP+"Staffing-Coordinator-Hub/index.html").read(),"own":open(HUBP+"team-hub/owners.html").read()}
class Hd(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def _b(self):
        n=int(self.headers.get("Content-Length") or 0); return self.rfile.read(n) if n else b""
    def _j(self,code,obj,extra=None):
        b=json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type","application/json")
        for k,v in (extra or {}).items(): self.send_header(k,v)
        self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p=self.path.split("?")[0]
        if p.startswith("/page/"): 
            src=S["pages"].get(p[6:]); 
            if src is None: return self._j(404,{})
            b=src.encode(); self.send_response(200); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b); return
        if p.endswith("/api-keys"): return self._j(200,[{"name":"anon","api_key":"ANONKEY"},{"name":"service_role","api_key":"SVC"}])
        fn=p.rsplit("/",1)[-1]
        if fn in S["verify"]: return self._j(200,{"slug":fn,"verify_jwt":S["verify"][fn]})
        self._j(404,{})
    def do_OPTIONS(self):
        self.send_response(200); self.send_header("Access-Control-Allow-Headers","authorization, x-client-info, apikey, content-type, x-hub-token"); self.send_header("Content-Length","0"); self.end_headers()
    def do_POST(self):
        b=self._b(); p=self.path
        if p.endswith("/database/query"): return self._j(201,[{"k":KEY}])
        fn=p.rsplit("/",1)[-1]; body=json.loads(b or b"{}"); S["seen"].append((fn,self.headers.get("x-hub-token"),"key" in body))
        if S["accept_key"] and body.get("key")==KEY: return self._j(200,{"replies":[]})
        return self._j(401,{"error":"Sign in to the Hub with an office account first."})
srv=ThreadingHTTPServer(("127.0.0.1",0),Hd); threading.Thread(target=srv.serve_forever,daemon=True).start(); base=f"http://127.0.0.1:{srv.server_port}"
cli=tempfile.mktemp(); open(cli,"w").write("#!/bin/sh\necho \"$@\" >> \"$CLI_LOG\"\nif [ \"$1\" = functions ] && [ \"$2\" = download ]; then mkdir -p supabase/functions/ghl-attach-doc && echo x > supabase/functions/ghl-attach-doc/index.ts; fi\nexit ${CLI_FAIL:-0}\n"); os.chmod(cli,0o755)
def run(pages="new", shas=SHAS, accept_key=False, fail=0):
    S["pages"]={k:(v if pages=="new" else v.replace("'x-hub-token':await trainHubTok(),","").replace("'x-hub-token':(session&&session.access_token)||'',","")) for k,v in PAGESRC.items()}
    S["seen"]=[]; S["accept_key"]=accept_key
    rep=tempfile.mktemp(); log=tempfile.mktemp(); out=tempfile.mkdtemp()
    env=dict(os.environ, SB_FNROOT=WT, SB_FN_SHAS=json.dumps(shas), SB_GATE_SHA=GATE, SB_REPORT=rep, SB_TOKEN="sbp_x", SB_SUPA_CLI=cli, CLI_LOG=log, CLI_FAIL=str(fail),
             SB_API_BASE=base, SB_FN_BASE=base, SB_ATTACH_OUT=out, SB_PAGES=json.dumps({"cc":base+"/page/cc","eng":base+"/page/eng","sc":base+"/page/sc","own":base+"/page/own"}))
    p=subprocess.run([sys.executable, HUBP+"Staffing-Coordinator-Hub/training_key_t1_deploy.py"],env=env,capture_output=True,text=True)
    r=open(rep).read() if os.path.exists(rep) else "(no report) "+p.stderr[-400:]
    lg=open(log).read() if os.path.exists(log) else ""
    return p.returncode,r,lg,out
res=[]
def ck(n,c,d=""): res.append((n,bool(c),"" if c else str(d)[-900:]))
rc,r,lg,out=run()
ck("happy path: deploys all four and every check passes", rc==0 and "RESULT: DEPLOYED" in r and r.count("  ✓ ")>=14, r)
ck("keeps each function's gateway setting (only the two without it get --no-verify-jwt)", lg.count("--no-verify-jwt")==2 and "deploy ghl-nurse-assign --project-ref rdqujxiycycwhskyvrwa --use-api --no-verify-jwt" in lg and "deploy ghl-replies --project-ref rdqujxiycycwhskyvrwa --use-api\n" in lg, lg)
ck("saves the deployed ghl-attach-doc source for T3", os.path.exists(os.path.join(out,"ghl-attach-doc","index.ts")) and "saved on this Mac for T3" in r, r)
ck("never prints the key", KEY not in r and "SECRETVALUE" not in r)
ck("proves the old key alone is refused (the key really was sent in that check)", any(f=="ghl-replies" and t is None and k for f,t,k in S["seen"]), S["seen"])
rc,r,lg,out=run(accept_key=True)
ck("if a function still accepted the key, the check says so", rc!=0 and "CHECK THE ✗ LINES" in r, r)
rc,r,lg,out=run(pages="old")
ck("live pages not updated yet: stops before deploying anything", rc==3 and "deploy" not in lg and "Nothing was changed" in r, r+lg)
bad=dict(SHAS); bad["ghl-thread"]="0"*64; rc,r,lg,out=run(shas=bad)
ck("source not the reviewed build: stops before anything", rc==2 and not lg, r)
rc,r,lg,out=run(fail=1)
ck("a failed deploy stops and says what state it left", rc==5 and "the rest are unchanged" in r, r)
srv.shutdown()
for n,ok,d in res: print(("PASS" if ok else "FAIL")+" · "+n+("" if ok else "\n"+d))
print(f"{sum(r[1] for r in res)}/{len(res)}")
