#!/usr/bin/env python3
# Desktop 261 against a fake Management API over a real disposable Postgres (SELECT-only role). Never touches production.
import os, json, threading, subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
c=Cluster("ssc"); s=c.su
s.run("create table app_data (key text primary key, data jsonb, updated_at timestamptz default now())")
leads=[{"id":"1","status":"New","soc":{"pathway":"PP","steps":[]}},{"id":"2","status":"Lost","soc":{"pathway":"A1","steps":[],"abandoned":True}},{"id":"3","status":"Converted"},{"id":"4","archived":True,"soc":{"steps":[]}}]
s.run("insert into app_data(key,data) values ('leads',cast(:d as jsonb)),('automation_log',cast(:l as jsonb))",d=json.dumps(leads),
      l=json.dumps([{"automation":"client_start","at":"2026-09-27T16:23:00Z","dry":False,"rows_seen":0,"created":0},{"automation":"promises","at":"x"}]))
s.run("create role reader nologin"); s.run("grant select on app_data to reader")
Q=[]
class Hd(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_POST(self):
        q=json.loads(self.rfile.read(int(self.headers.get("Content-Length"))))["query"]; Q.append(q); cc=c.conn("reader")
        try: rows=cc.run(q); cols=[d["name"] for d in cc.columns or []]; out=json.dumps([dict(zip(cols,r)) for r in rows or []],default=str).encode(); code=200
        except Exception as e: out=json.dumps({"message":str(e)}).encode(); code=400
        finally: cc.close()
        self.send_response(code); self.end_headers(); self.wfile.write(out)
srv=HTTPServer(("127.0.0.1",0),Hd); threading.Thread(target=srv.serve_forever,daemon=True).start()
rep=os.path.join(H,"_ssc.txt")
p=subprocess.run(["python3","client_start_source_check.py"],cwd=H,capture_output=True,text=True,env=dict(os.environ,SB_REPORT=rep,SB_TOKEN="sbp_x",SB_REF="r",SB_API_BASE=f"http://127.0.0.1:{srv.server_address[1]}"))
t=open(rep).read(); os.remove(rep)
res=[]
def ck(n,g,note=""): res.append((n,bool(g),"" if g else str(note)[-600:]))
ck("reads the leads record's shape and size", p.returncode==0 and "stored as array, 4 lead(s)" in t, t+p.stderr)
ck("counts the leads with a Start of Care and splits abandoned / archived / Lost", "leads with a Start of Care: 3" in t and "abandoned 1 · archived 1 · marked Lost 1" in t, t)
ck("lists leads by status and the check's own runs (only client_start)", "leads by status:" in t and "live · starts seen 0 · added 0" in t and t.count("• ")==1, t)
ck("read only: every query a SELECT/WITH, as a role that can only read", all(q.lstrip().lower().startswith(("select","with")) for q in Q) and len(Q)==4, Q)
srv.shutdown(); c.close()
print("\nDESKTOP 261 · PROOF\n"+"="*60); ok=True
for n,g,note in res: ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED")
