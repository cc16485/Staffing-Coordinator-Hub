# T2 deploy script (both steps) against a fake Supabase API, fake functions/REST, fake live pages and a fake CLI.
import os, sys, json, hashlib, subprocess, tempfile, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
WT=os.environ.get("TRAINING_REPO", "/Users/samantha/Claude/Projects/Caring Companions Training Platform")+"/supabase"; HUBP="/Users/samantha/Claude/Projects/"
sha=lambda p: hashlib.sha256(open(p,"rb").read()).hexdigest()
GATE=sha(f"{WT}/functions/_shared/hub-gate.ts"); LOCK=f"{WT}/hub-key-functions-lock.sql"
KEY="cchub_SECRETVALUE_should_never_print_123"
S={"deployed":{"ghl-attach-doc":False}, "pages":{}, "seen":[], "sql":[], "locked":False, "accept_key":False, "sql_fail":False}
SRC={"cc":open(HUBP+"cc-hub-live/index.html").read(),"eng":open(HUBP+"cc-hub-live/caregivers-engine.js").read(),"sc":open(HUBP+"Staffing-Coordinator-Hub/index.html").read(),
     "th":open(HUBP+"team-hub/index.html").read(),"of":open(HUBP+"team-hub/offer.html").read()}
class Hd(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def _j(self,code,obj,extra=None):
        b=json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type","application/json")
        for k,v in (extra or {}).items(): self.send_header(k,v)
        self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p=self.path.split("?")[0]
        if p.startswith("/page/"):
            src=S["pages"].get(p[6:]); b=(src or "").encode(); self.send_response(200 if src else 404); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b); return
        if p.endswith("/api-keys"): return self._j(200,[{"name":"anon","api_key":"ANONKEY"}])
        fn=p.rsplit("/",1)[-1]
        if fn in S["deployed"]: return self._j(200,{"slug":fn,"verify_jwt":S["deployed"][fn]})
        self._j(404,{})
    def do_OPTIONS(self):
        self.send_response(200); self.send_header("Access-Control-Allow-Headers","authorization, apikey, content-type, x-hub-token"); self.send_header("Content-Length","0"); self.end_headers()
    def do_POST(self):
        n=int(self.headers.get("Content-Length") or 0); b=self.rfile.read(n) if n else b""; p=self.path.split("?")[0]
        if p.endswith("/database/query"):
            q=json.loads(b)["query"]; S["sql"].append(q[:60])
            if "hub_read_key" in q and "select value" in q: return self._j(201,[{"k":KEY}])
            if "begin;" in q:
                if S["sql_fail"]: return self._j(400,{"message":"T2 lock: something; nothing changed"})
                S["locked"]=True; return self._j(201,[])
            if "has_function_privilege" in q: return self._j(201,[{"ok":S["locked"],"n":3}])
            return self._j(201,[])
        S["seen"].append((p, self.headers.get("x-hub-token"), json.loads(b or b"{}")))
        if p.startswith("/rest/v1/rpc/"): return self._j(200,[]) if not S["locked"] else self._j(401,{"message":"permission denied"})
        if S["accept_key"]: return self._j(200,{})
        return self._j(401,{"error":"Sign in"})
srv=ThreadingHTTPServer(("127.0.0.1",0),Hd); threading.Thread(target=srv.serve_forever,daemon=True).start(); base=f"http://127.0.0.1:{srv.server_port}"
cli=tempfile.mktemp(); open(cli,"w").write("#!/bin/sh\necho \"$@\" >> \"$CLI_LOG\"\nexit ${CLI_FAIL:-0}\n"); os.chmod(cli,0o755)
def run(phase, pages="new", fns=None, accept_key=False, fail=0, lock_sha=None, sql_fail=False, deployed_td=True):
    S["pages"]={k:(v if pages=="new" else v.replace("hub-training-data","rest/v1/rpc/hub_job_offers")) for k,v in SRC.items()}
    S["seen"]=[]; S["sql"]=[]; S["accept_key"]=accept_key; S["sql_fail"]=sql_fail; S["locked"]=False
    S["deployed"]={"ghl-attach-doc":False, **({"hub-training-data":True} if deployed_td else {})}
    fns=fns or ({"hub-training-data":sha(f"{WT}/functions/hub-training-data/index.ts")} if phase=="add" else {"ghl-attach-doc":sha(f"{WT}/functions/ghl-attach-doc/index.ts")})
    rep=tempfile.mktemp(); log=tempfile.mktemp()
    env=dict(os.environ, SB_PHASE=phase, SB_FNROOT=f"{WT}/functions", SB_FN_SHAS=json.dumps(fns), SB_GATE_SHA=GATE, SB_REPORT=rep, SB_TOKEN="sbp_x", SB_SUPA_CLI=cli, CLI_LOG=log, CLI_FAIL=str(fail),
             SB_API_BASE=base, SB_FN_BASE=base, SB_LOCK_SQL=LOCK, SB_LOCK_SHA=lock_sha or sha(LOCK),
             SB_PAGES=json.dumps({k:base+"/page/"+k for k in SRC}))
    p=subprocess.run([sys.executable, HUBP+"Staffing-Coordinator-Hub/training_key_t2_deploy.py"],env=env,capture_output=True,text=True)
    r=open(rep).read() if os.path.exists(rep) else "(no report) "+p.stderr[-400:]
    return p.returncode,r,(open(log).read() if os.path.exists(log) else "")
res=[]
def ck(n,c,d=""): res.append((n,bool(c),"" if c else str(d)[-1200:]))
rc,r,lg=run("add", deployed_td=False)
ck("310: adds hub-training-data (gateway sign-in kept on) and every check passes", rc==0 and "RESULT: ADDED" in r and "deploy hub-training-data --project-ref rdqujxiycycwhskyvrwa --use-api\n" in lg, r+lg)
ck("310: never prints the key, and really sent it in the key-alone check", KEY not in r and any(b.get("p_key")==KEY for _,_,b in S["seen"]), r)
ck("310: touches no database grant and no other function", not any("begin;" in q for q in S["sql"]) and lg.count("deploy")==1, [S["sql"],lg])
rc,r,lg=run("add", accept_key=True); ck("310: if it answered the key, the report says so", rc!=0 and "CHECK THE ✗ LINES" in r, r)
rc,r,lg=run("lock")
ck("311: upload redeployed (no gateway, kept), lock installed, every check passes", rc==0 and "RESULT: LOCKED" in r and "deploy ghl-attach-doc --project-ref rdqujxiycycwhskyvrwa --use-api --no-verify-jwt" in lg and S["locked"], r+lg)
ck("311: the upload check sends nothing a function could act on (no phone, email, file or probe)", all(set(b)=={"key"} for p,_,b in S["seen"] if p.endswith("ghl-attach-doc")), [x for x in S["seen"] if x[0].endswith("ghl-attach-doc")])
ck("311: never prints the key", KEY not in r)
rc,r,lg=run("lock", pages="old"); ck("311: live pages still calling the database functions: stops before any change", rc==3 and not lg and not S["locked"], r)
rc,r,lg=run("lock", deployed_td=False); ck("311: if 310 was not run, stops before any change", rc==4 and not lg and not S["locked"], r)
rc,r,lg=run("lock", lock_sha="0"*64); ck("311: a lock script that is not the reviewed one: stops before anything", rc==2 and not lg, r)
rc,r,lg=run("lock", fail=1); ck("311: a failed upload deploy stops before the lock", rc==5 and not S["locked"] and "database functions still answer" in r, r)
rc,r,lg=run("lock", sql_fail=True); ck("311: a lock that fails its self-check is reported and stops", rc==6 and "undid itself" in r, r)
srv.shutdown()
for n,ok,d in res: print(("PASS" if ok else "FAIL")+" · "+n+("" if ok else "\n"+d))
print(f"{sum(x[1] for x in res)}/{len(res)}")
