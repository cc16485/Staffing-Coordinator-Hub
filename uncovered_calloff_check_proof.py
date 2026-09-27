#!/usr/bin/env python3
# Desktop 254 against a fake Management API whose database is a real disposable Postgres (SELECT-only role).
import os, json, threading, subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
c=Cluster("unc"); s=c.su
s.run("create schema net"); s.run("create table net._http_response (id bigserial primary key, content text, created timestamptz default now())")
s.run("create table app_data (key text primary key, data jsonb)")
det=[{"client":"Ann Held","when":"2026-09-28T09:00:00","visit":"s=119:d=2026-09-28","reason":"Call Off","verdict":"opens a case"},
     {"client":"Bo Open","when":"2026-09-28T13:00:00","visit":"s=50:d=2026-09-28","reason":"Call Off","verdict":"already has an open case"},
     {"client":"Cy Never","when":"2026-09-29T08:00:00","visit":"s=60:d=2026-09-29","reason":"(no modification reason)","verdict":"ignored — no reason recorded"},
     {"client":"Di O'Past","when":"2026-09-27T07:00:00","visit":"s=70:d=2026-09-27","reason":"Call Off","verdict":"ignored — already started"}]
s.run("insert into net._http_response(content,created) values (:a, now()-interval '1 hour'), ('not json at all', now()), (:b, now()-interval '5 minutes')",
      a=json.dumps({"mode":"LIVE","unassigned_detail":[]}), b=json.dumps({"mode":"LIVE","unassigned_detail":det}))
cases=[{"axiscare_visit_id":"s=119:d=2026-09-28","status":"covered","opened_at":"2026-09-20T10:00","opened_by":"axiscare-watch","resolved_at":"2026-09-20T12:00","resolved_how":"covered","covered_by":"Eve"},
       {"axiscare_visit_id":"s=50:d=2026-09-28","status":"open","opened_at":"2026-09-27T05:00","opened_by":"axiscare-watch","resolved_at":None},
       {"axiscare_visit_id":"s=70:d=2026-09-27","status":"closed","opened_at":"2026-09-20T05:00","opened_by":"axiscare-watch","resolved_at":"2026-09-20T06:00","resolved_how":"manual"}]
s.run("insert into app_data values ('coverage_cases', cast(:d as jsonb))", d=json.dumps(cases))
s.run("create role reader nologin"); s.run("grant usage on schema net to reader"); s.run("grant select on net._http_response, app_data to reader")
Q=[]
class Hd(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_POST(self):
        q=json.loads(self.rfile.read(int(self.headers.get("Content-Length"))))["query"]; Q.append(q); cc=c.conn("reader")
        try:
            rows=cc.run(q); cols=[d["name"] for d in cc.columns or []]; out=json.dumps([dict(zip(cols,r)) for r in rows or []],default=str).encode(); code=200
        except Exception as e: out=json.dumps({"message":str(e)}).encode(); code=400
        finally: cc.close()
        self.send_response(code); self.end_headers(); self.wfile.write(out)
srv=HTTPServer(("127.0.0.1",0),Hd); threading.Thread(target=srv.serve_forever,daemon=True).start()
rep=os.path.join(H,"_unc.txt")
p=subprocess.run(["python3","uncovered_calloff_check.py"],cwd=H,capture_output=True,text=True,env=dict(os.environ,SB_REPORT=rep,SB_TOKEN="sbp_x",SB_REF="r",SB_API_BASE=f"http://127.0.0.1:{srv.server_address[1]}"))
t=open(rep).read(); os.remove(rep)
res=[]
def ck(n,g,note=""): res.append((n,bool(g),"" if g else str(note)[-900:]))
ck("uses the watcher's LATEST run (4 shifts), skipping a newer non-JSON answer", p.returncode==0 and "4 unassigned upcoming shift(s)" in t, t+p.stderr)
ck("a called-off shift whose earlier case was closed, with no open case, is flagged HELD", "✗ Ann Held" in t and "HELD:" in t and "covered by Eve" in t, t)
ck("a shift with an open case is not flagged", "• Bo Open" in t)
ck("a shift with no reason, and one already started, are not flagged", "• Cy Never" in t and "case: none ever" in t and "• Di O'Past" in t)
ck("the result line counts exactly the held shifts", "RESULT: 1 CALLED-OFF SHIFT(S) HELD" in t, t[-200:])
ck("read only: every query a SELECT/WITH, run as a role that can only read", all(q.lstrip().lower().startswith(("select","with")) for q in Q) and len(Q)==2, Q)
srv.shutdown(); c.close()
print("\nDESKTOP 254 · UNASSIGNED SHIFTS CHECK · PROOF\n"+"="*60); ok=True
for n,g,note in res: ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED")
