#!/usr/bin/env python3
# Desktop 265 against fake Supabase services whose database is a real disposable Postgres. Never touches production.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
MIGF=os.path.join(H,"lead-journey-fold.sql"); MIG_SHA=hashlib.sha256(open(MIGF,"rb").read()).hexdigest()
def fixture(tag):
    c=Cluster(tag); P=setup_supabase_like(c); s=c.su
    s.run("alter table person_source_id add column needs_review boolean not null default false, add column created_at timestamptz not null default now(), add column evidence text, add column imported_at timestamptz")
    s.run("create unique index person_source_axiscare_uniq on person_source_id (entity_type, source_id) where system = 'axiscare'")
    s.run("""create table person_role (id bigserial primary key, person_id uuid not null references person_identity(id), role text not null,
             status text not null default 'active', started_at date, ended_at date, end_reason text, updated_at timestamptz not null default now())""")
    s.run("create unique index person_role_one_active on person_role (person_id, role) where status = 'active'")
    s.run("""create table phone_index (id bigserial primary key, phone text not null, person_id uuid not null references person_identity(id),
             kind text, shared boolean not null default false, confidence text not null default 'confirmed', verification_status text not null default 'unverified')""")
    for t in ["person_role","phone_index"]:
        s.run(f"revoke all on {t} from anon"); s.run(f"grant select on {t} to authenticated"); s.run(f"grant all on {t} to service_role")
    for f in (MIG,)+tuple(open(os.path.join(H,x)).read() for x in ("staffing-foundation.sql","team-build-link.sql","lead-journey-mirror.sql","client-admission.sql","start-contract.sql","journey-connect.sql")):
        rc,out=c.psql(f); assert rc==0,out[-400:]
    s.run("alter table app_data add column if not exists updated_at timestamptz not null default now()")   # as in production
    s.run("insert into app_data(key,data) values ('ops_settings','{}'::jsonb) on conflict (key) do nothing")
    return c,P,s


c,P,s=fixture("lfi"); svc=c.conn("service_role")
LEADS=[{"id":"K","status":"Contacted","client_first_name":"Ruth","client_last_name":"Adams","created_at":"2026-09-10T15:00:00Z"},
       {"id":"D","status":"New","client_first_name":"Ruth","client_last_name":"Adams","first_name":"Dana","created_at":"2026-09-11T15:00:00Z"},
       {"id":"X","status":"New","client_first_name":"Ann","client_last_name":"Gray","created_at":"2026-09-13T15:00:00Z","axiscare_client_id":"AX60"}]
setleads=lambda L: s.run("update app_data set data=:d where key='leads'",d=json.dumps(L))
setleads(LEADS); svc.run("select count(*) from public.lead_journey_mirror(true)")
r=svc.run("select public.lead_journey_connect('X','AX60','Ann Gray','typed','kat@cc.test','client_intake')")[0][0]
L2=[dict(l) for l in LEADS]
for l in L2:
    if l["id"] in ("D","X"): l.update(archived=True, archive_reason="Duplicate", duplicate_of="K")
L2.append({"id":"N","status":"New","archived":True,"archive_reason":"Duplicate","duplicate_of":"K","created_at":"2026-09-20T15:00:00Z"})
setleads(L2)
S={"page":"<html> ckFold </html>"}
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v,(int,float,bool,str,dict,list,type(None))) else str(v))
class Hd(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def send(self,code,obj,raw=False):
        b=(obj if raw else json.dumps(obj)).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.startswith("/?v="): return self.send(200,S["page"],True)
        self.send(404,{})
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if self.path.endswith("/database/query"):
            q=body["query"]
            if q.lstrip().startswith("-- ===="):
                rc,out=c.psql(q); return self.send(200,[]) if rc==0 else self.send(400,{"message":out[-400:]})
            cc=c.conn("service_role") if "lead_journey_mirror_scheduled" in q or "lead_fold_" in q else c.conn()
            try:
                rows=cc.run(q); cols=[d["name"] for d in (cc.columns or [])]
                return self.send(200,[{k:J(v) for k,v in zip(cols,r)} for r in (rows or [])])
            except Exception as e: return self.send(400,{"message":str(e)[:300]})
            finally: cc.close()
        self.send(404,{})
srv=HTTPServer(("127.0.0.1",0),Hd); threading.Thread(target=srv.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{srv.server_address[1]}"
res=[]
def ck(n,g,note=""): res.append((n,bool(g),"" if g else str(note)[-900:]))
def run(ans="", mig_sha=MIG_SHA, mode="install"):
    rep=os.path.join(H,"_lfi.txt")
    p=subprocess.run(["python3","lead_fold_install.py"],cwd=H,capture_output=True,text=True,input=ans+"\n",
        env=dict(os.environ,SB_MIGFILE=MIGF,SB_MIG_SHA=mig_sha,SB_REPORT=rep,SB_TOKEN="sbp_x",SB_REF="r",SB_API_BASE=base,SB_HUB_URL=base,SB_MODE=mode))
    t=open(rep).read() if os.path.exists(rep) else ""
    if os.path.exists(rep): os.remove(rep)
    return p.returncode,t
voided=lambda: s.run("select count(*) from journey_episode where state='voided'")[0][0]
live=lambda: s.run("select coalesce((data->>'lead_fold_live')::boolean,false) from app_data where key='ops_settings'")[0][0]
installed=lambda: s.run("select count(*) from pg_proc where proname='lead_fold_intent'")[0][0]==1
rc,t=run("yes",mig_sha="0"*64)
ck("a changed migration stops before anything runs", rc==2 and not installed(), t[-200:])
S["page"]="<html>old</html>"; rc,t=run("yes")
ck("a live hub without the fold buttons stops it (merge first); nothing installed", rc==3 and not installed(), t[-200:])
S["page"]="<html> ckFold </html>"; rc,t=run("no")
ck("preview: the duplicate's empty Journey would close; the confirmed client's is left alone; the one without a Journey gets none; 'no' writes nothing",
   rc==0 and installed() and "close the empty Journey of Ruth Adams (caller Dana)" in t and "left alone, a client was confirmed on it: Ann Gray" in t
   and "1 never had a Journey" in t and "RESULT: INSTALLED, LEFT OFF" in t and voided()==0 and not live(), t)
rc,t=run("yes")
ck("'yes': switched on with the approval recorded; the first run closes exactly the one empty Journey, no errors",
   rc==0 and live() and voided()==1 and "FIRST RUN: ok" in t and "RESULT: INSTALLED AND ON" in t
   and s.run("select data->'lead_fold_approved'->>'recorded_by' from app_data where key='ops_settings'")[0][0]=="Desktop 265", t)
ck("the confirmed client's Journey is untouched", s.run("select e.state from episode_source s join journey_episode e using (episode_id) where s.source_ref='X' and s.role='origin'")[0][0]=="converted")
rc,t=run(mode="off")
ck("switch off (Desktop 266): no more are voided; the voided one stays voided", rc==0 and not live() and voided()==1 and "switched off" in t, t)
rc,t=run("yes")
ck("a rerun is harmless (nothing left to close)", rc==0 and voided()==1 and "no empty Journeys to close" in t, t[-400:])
srv.shutdown(); svc.close(); c.close()
print("\nDESKTOP 265 · FOLDED INQUIRIES · INSTALL PROOF\n"+"="*60); ok=True
for n,g,note in res: ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED"); print("migration:",MIG_SHA)
