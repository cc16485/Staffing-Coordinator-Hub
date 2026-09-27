#!/usr/bin/env python3
# Change 3 · the install (244) and on/off (245/246) scripts against fake Supabase services whose database is a
# real disposable Postgres (Journey foundation + Change 3 tables). Never touches production.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
MIGF=os.path.join(H,"client-status.sql"); MIG_SHA=hashlib.sha256(open(MIGF,"rb").read()).hexdigest()
FNROOT=os.path.join(H,"supabase","functions")
FNS={"client-status-review":hashlib.sha256(open(os.path.join(FNROOT,"client-status-review","index.ts"),"rb").read()).hexdigest()}

c=Cluster("css"); P=setup_supabase_like(c); s=c.su
s.run("""create table person_role (id bigserial primary key, person_id uuid not null references person_identity(id), role text not null,
         status text not null default 'active', started_at date, ended_at date, end_reason text, updated_at timestamptz not null default now())""")
s.run("grant all on person_role to service_role")
rc,out=c.psql(MIG); assert rc==0,out[-300:]
s.run("insert into person_source_id(person_id,system,entity_type,source_id) values (cast(:p as uuid),'axiscare','client','501')",p=P[1])
s.run("insert into person_role(person_id,role,status) values (cast(:p as uuid),'client','active')",p=P[1])
s.run("alter table app_data add column if not exists updated_at timestamptz")
s.run("delete from app_data where key in ('ops_settings','ops_items','automation_log')")
s.run("""insert into app_data values ('ops_settings','{"promises_live":true,"launch_evidence_live":true}'),('ops_items','[{"id":"other","status":"open"}]'),('automation_log','[]')""")
s.run("create schema cron"); s.run("create table cron.job (jobname text primary key, schedule text, command text, active boolean default true)")
s.run("create function cron.schedule(n text, sc text, cmd text) returns bigint language sql as $$ insert into cron.job values (n, sc, cmd, true) returning 1::bigint $$")
s.run("create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$")
TR={"id":"tr_501_a","axiscare_client_id":"501","old_status_label":"Active","new_status_label":"Inactive","observed_at":"2026-09-30T12:17:00Z"}

S={"page":"<html> csrOpen </html>","calls":[]}
def J(v): return int(v) if isinstance(v,Decimal) else (v if isinstance(v,(int,float,bool,str,dict,list,type(None))) else str(v))
class Hd(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def send(self,code,obj,raw=False,headers=None):
        b=(obj if raw else json.dumps(obj)).encode(); self.send_response(code)
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self):
        if self.path.startswith("/functions/v1/client-status-review"): return self.send(200,"ok",True,{"Access-Control-Allow-Origin":"*"})
        self.send(404,{})
    def do_GET(self):
        if self.path.startswith("/?v="): return self.send(200,S["page"],True)
        if self.path.endswith("/api-keys"): return self.send(200,[{"name":"anon","api_key":"anon-key"},{"name":"service_role","api_key":"svc-key"}])
        self.send(404,{})
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if self.path.endswith("/database/query"):
            q=body["query"]
            if q.lstrip().startswith("-- ====") or q.lstrip().startswith("begin;"):
                rc,out=c.psql(q); return self.send(200,[]) if rc==0 else self.send(400,{"message":out[-400:]})
            cc=c.conn()
            try:
                rows=cc.run(q); cols=[d["name"] for d in (cc.columns or [])]
                return self.send(200,[{k:J(v) for k,v in zip(cols,r)} for r in (rows or [])])
            except Exception as e: return self.send(400,{"message":str(e)[:300]})
            finally: cc.close()
        if self.path.startswith("/functions/v1/client-status-review"):
            S["calls"].append((self.headers.get("Authorization"),body))
            cc=c.conn()
            try:
                live=cc.run("select coalesce((data->>'client_status_live')::boolean,false) from app_data where key='ops_settings'")[0][0]
                opened=0; cur=0
                if live:
                    cc.run("set role service_role")
                    cur=json.loads(json.dumps(cc.run("select public.client_status_current_refresh('{\"501\":\"Inactive\",\"502\":\"Active\"}'::jsonb, now())")[0][0]))
                    cur=(cur if isinstance(cur,dict) else json.loads(cur))["rows"]
                    r=cc.run("select public.client_status_review_open(cast(:t as jsonb),'automation:client-status')",t=json.dumps(TR))[0][0]
                    r=r if isinstance(r,dict) else json.loads(r); opened=1 if r["outcome"]=="opened" else 0
                    cc.run("reset role")
                cc.run("update app_data set data = data || jsonb_build_array(jsonb_build_object('automation','client_status','at',now()::text,'dry',cast(:d as boolean))) where key='automation_log'",d=not live)
            finally: cc.close()
            return self.send(200,{"ok":True,"dry":not live,"census":2,"transitions_seen":1,"would_open":1,"no_hub_person":0,"too_old":0,"already_reviewed":0 if not live else 1-opened,
              "opened":opened,"current_refreshed":cur,"items_created":opened,"admission_scan":{"would_check":1} if not live else {"unlinked":1,"opened":1},
              "preview":[{"axiscare_client_id":"501","change":"Active -> Inactive","seen":"2026-09-30"}]})
        self.send(404,{})
srv=HTTPServer(("127.0.0.1",0),Hd); port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{port}"
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[-900:]))
def run(script,**kw):
    rep=os.path.join(H,"_css_report.txt")
    env=dict(os.environ,SB_REPORT=rep,SB_TOKEN="sbp_test",SB_REF="REF",SB_SKIP_FUNCTION="1",SB_API_BASE=base,SB_FN_BASE=base,SB_HUB_URL=base,
             SB_MIGFILE=MIGF,SB_MIG_SHA=MIG_SHA,SB_FNROOT=FNROOT,SB_FN_SHAS=json.dumps(FNS)); env.update(kw)
    p=subprocess.run(["python3",os.path.join(H,script)],env=env,capture_output=True,text=True)
    out=open(rep).read() if os.path.exists(rep) else p.stdout+p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode,out
n_rev=lambda: s.run("select count(*) from client_status_review")[0][0]
rc,rep=run("client_status_install.py",SB_MIG_SHA="0"*64)
ck("install · a migration that is not the proven build stops before anything runs", rc==2 and not S["calls"], rep)
S["page"]="<html>old</html>"; rc,rep=run("client_status_install.py"); S["page"]="<html> csrOpen </html>"
ck("install · if the hub update is not merged yet it stops", rc==3 and "merge the hub pull request first" in rep and not S["calls"], rep)
s.run("""update app_data set data = data || '{"client_status_live":true}' where key='ops_settings'""")
rc,rep=run("client_status_install.py"); s.run("""update app_data set data = data - 'client_status_live' where key='ops_settings'""")
ck("install · refuses if the switch is already on", rc==4, rep)
rc,rep=run("client_status_install.py")
ck("install · happy path: installed, CORS, dry run with its preview; clients, Journeys and My Work unchanged; logged",
   rc==0 and "INSTALLED AND DRY RUN READ" in rep and "would open 1 review" in rep and "AxisCare #501: Active -> Inactive" in rep
   and "✓ clients, Journeys and My Work unchanged" in rep and n_rev()==0 and S["calls"][-1][0]=="Bearer svc-key", rep)
rc,rep=run("client_status_switch.py",SB_MODE="on")
job=s.run("select schedule, command from cron.job where jobname='client-status-review'")
sett=s.run("select data from app_data where key='ops_settings'")[0][0]; sett=sett if isinstance(sett,dict) else json.loads(sett)
ck("on · switch on (other settings kept), one job 5 minutes after each status check with the public key only, first live run matches",
   rc==0 and "TURNED ON" in rep and len(job)==1 and job[0][0]=="22 */6 * * *" and "anon-key" in job[0][1] and "svc-key" not in job[0][1]
   and sett.get("client_status_live") is True and sett.get("launch_evidence_live") is True and "reviews went from 0 to 1" in rep and n_rev()==1, rep)
rc,rep=run("client_status_switch.py",SB_MODE="on")
ck("on · turning it on twice leaves one job and no second review", rc==0 and s.run("select count(*) from cron.job")[0][0]==1 and n_rev()==1, rep)
rc,rep=run("client_status_switch.py",SB_MODE="off")
sett=s.run("select data from app_data where key='ops_settings'")[0][0]; sett=sett if isinstance(sett,dict) else json.loads(sett)
ck("off · switch off, schedule removed, open reviews left as they are", rc==0 and "TURNED OFF" in rep and not s.run("select 1 from cron.job")
   and sett.get("client_status_live") is False and n_rev()==1, rep)
rc,rep=run("client_status_install.py")
ck("install · once a review exists the migration guard refuses a reinstall; nothing changes", rc==6 and "refused" in rep and n_rev()==1, rep)
srv.shutdown(); c.close()
print("\nCHANGE 3 · INSTALL AND ON/OFF SCRIPTS · PROOF AGAINST FAKE SERVICES + REAL POSTGRES\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
