# P1 key swap against a fake Supabase API and a fake Anthropic API. Nothing real is touched.
import os, sys, json, hashlib, tempfile, threading, subprocess
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
NEWK="sk-ant-api03-NEWKEYVALUE-0123456789abcdefghijklmnopqrstuvwxyz"; OLDK="sk-ant-api03-OLDKEY"
S={"secret":hashlib.sha256(OLDK.encode()).hexdigest(),"anth_ok":True,"set_ok":True,"sets":0,"anth_bodies":[]}
class Hd(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def _j(self,c,o): b=json.dumps(o).encode(); self.send_response(c); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.endswith("/secrets"): return self._j(200,[{"name":"GHL_TOKEN","value":"x"},{"name":"ANTHROPIC_API_KEY","value":S["secret"]}])
        self._j(404,{})
    def do_POST(self):
        n=int(self.headers.get("Content-Length") or 0); b=json.loads(self.rfile.read(n) or b"null")
        if self.path=="/v1/messages":
            S["anth_bodies"].append(b)
            ok=S["anth_ok"] and self.headers.get("x-api-key")==NEWK
            return self._j(200,{"type":"message","content":[{"text":"ready"}]}) if ok else self._j(401,{"type":"error"})
        if self.path.endswith("/secrets"):
            if not S["set_ok"]: return self._j(500,{})
            S["sets"]+=1; S["secret"]=hashlib.sha256(b[0]["value"].encode()).hexdigest(); return self._j(201,{})
        self._j(404,{})
srv=ThreadingHTTPServer(("127.0.0.1",0),Hd); threading.Thread(target=srv.serve_forever,daemon=True).start(); base=f"http://127.0.0.1:{srv.server_port}"
def run(key=NEWK, anth_ok=True, set_ok=True):
    S.update(secret=hashlib.sha256(OLDK.encode()).hexdigest(), anth_ok=anth_ok, set_ok=set_ok, sets=0, anth_bodies=[])
    rep=tempfile.mktemp()
    p=subprocess.run([sys.executable,"/Users/samantha/Claude/Projects/Staffing-Coordinator-Hub/set_ai_key.py"],env=dict(os.environ,SB_REPORT=rep,SB_TOKEN="sbp_x",SB_NEW_KEY=key,SB_API_BASE=base,SB_ANTHROPIC_BASE=base),capture_output=True,text=True)
    return p.returncode,(open(rep).read() if os.path.exists(rep) else p.stderr[-300:])
res=[]
def ck(n,c,d=""): res.append((n,bool(c),"" if c else str(d)[-800:]))
rc,r=run(); ck("happy path: tests the key, replaces the setting, reads back the new fingerprint", rc==0 and "RESULT: DONE" in r and S["sets"]==1 and S["secret"]==hashlib.sha256(NEWK.encode()).hexdigest(), r)
ck("the test message carries no client information", all(json.dumps(b).count("Reply with the word ready.")==1 and len(json.dumps(b))<200 for b in S["anth_bodies"]), S["anth_bodies"])
ck("never prints the key", NEWK not in r and "NEWKEYVALUE" not in r)
rc,r=run(key="sbp_notakey"); ck("something that isn't an Anthropic key: stops, nothing changed", rc==2 and S["sets"]==0, r)
rc,r=run(anth_ok=False); ck("a key Anthropic refuses: stops before changing anything", rc==3 and S["sets"]==0 and S["secret"]==hashlib.sha256(OLDK.encode()).hexdigest(), r)
rc,r=run(set_ok=False); ck("if the project refuses the change: says the old key is still in place", rc==5 and "old key is still in place" in r, r)
srv.shutdown()
for n,o,d in res: print(("PASS" if o else "FAIL")+" · "+n+("" if o else "\n"+d))
print(f"{sum(x[1] for x in res)}/{len(res)}")
