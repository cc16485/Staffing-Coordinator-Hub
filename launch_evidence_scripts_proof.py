#!/usr/bin/env python3
# Change 1 · the install (239) and on/off (240/241) scripts, run against fake Supabase services whose
# database is a real disposable Postgres. Never touches production.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
from decimal import Decimal
MIGF=os.path.join(H,"launch-evidence.sql"); MIG_SHA=hashlib.sha256(open(MIGF,"rb").read()).hexdigest()
FNROOT=os.path.join(H,"supabase","functions")
FNS={f:hashlib.sha256(open(os.path.join(FNROOT,f,"index.ts"),"rb").read()).hexdigest() for f in ("launch-evidence","coverage-shifts","timekeeper-watch")}
ENGINE=open(os.path.join(os.path.dirname(H),"cc-hub-live","launch-evidence.js")).read()

c=Cluster("les"); s=c.su
for r in ["anon","authenticated"]: s.run(f"do $$ begin create role {r} nologin; exception when duplicate_object then null; end $$;")
s.run("do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;")
s.run("""create table client_queue (id uuid primary key default gen_random_uuid(), client_name text, axiscare_client_id text, status text not null default 'pending',
  caregiver_assigned boolean not null default false, caregiver_assigned_name text, caregiver_assigned_at timestamptz, schedule_added boolean default false, schedule_added_at timestamptz,
  evv_verified boolean default false, evv_verified_at timestamptz, first_shift_done boolean default false, first_shift_done_at timestamptz, added_at timestamptz default now())""")
s.run("grant usage on schema public to anon, authenticated, service_role"); s.run("grant all on client_queue to service_role")
LID=str(s.run("insert into client_queue (client_name, axiscare_client_id) values ('Peggy Thomason','295') returning id")[0][0])
s.run("create table app_data (key text primary key, data jsonb, updated_at timestamptz)")
s.run("""insert into app_data values ('ops_settings','{"promises_live":true,"coverage_watch_live":false}',now()),('automation_log','[]',now())""")
s.run("create schema cron"); s.run("create table cron.job (jobname text primary key, schedule text, command text, active boolean default true)")
s.run("create function cron.schedule(n text, sc text, cmd text) returns bigint language sql as $$ insert into cron.job values (n, sc, cmd, true) returning 1::bigint $$")
s.run("create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$")

S={"engine":ENGINE,"page":"<html>... leRefresh ...</html>","calls":[]}
def J(v):
    if isinstance(v,Decimal): return int(v)
    return str(v) if not isinstance(v,(int,float,bool,str,dict,list,type(None))) else v
class Hd(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def send(self,code,obj,raw=False,headers=None):
        b=(obj if raw else json.dumps(obj)).encode(); self.send_response(code)
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self):
        if self.path.startswith("/functions/v1/launch-evidence"): return self.send(200,"ok",True,{"Access-Control-Allow-Origin":"*"})
        self.send(404,{})
    def do_GET(self):
        if self.path.startswith("/launch-evidence.js"): return self.send(200,S["engine"],True)
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
        if self.path.startswith("/functions/v1/launch-evidence"):
            S["calls"].append((self.headers.get("Authorization"),body))
            cc=c.conn()
            try:
                live=cc.run("select coalesce((data->>'launch_evidence_live')::boolean,false) from app_data where key='ops_settings'")[0][0]
                rec=0; tick=0
                if live:
                    cc.run("set role service_role")
                    r=cc.run("select public.launch_evidence_record(cast(:l as uuid),'295',cast(:r as jsonb),'axiscare','automation:launch-evidence',null)",l=LID,
                             r=json.dumps([{"fact":"schedule","detail":{"visits":3}},{"fact":"caregiver","name":"Jane Doe","detail":{}}]))[0][0]
                    r=r if isinstance(r,dict) else json.loads(r); rec=len(r.get("recorded",[])); tick=len(r.get("ticked",[]))
                    cc.run("reset role")
                cc.run("""update app_data set data = data || jsonb_build_array(jsonb_build_object('automation','launch_evidence','at',now()::text,'dry',cast(:d as boolean)))
                          where key='automation_log'""",d=not live)
            finally: cc.close()
            return self.send(200,{"ok":True,"dry":not live,"launches_open":1,"read":1,"no_axiscare_id":0,"too_old":0,"deferred":0,"would_record":2,"recorded":rec,"ticked":tick,
              "flagged":1,"errors":0,"preview":[{"client":"Peggy Thomason","axiscare_client_id":"295","first_shift":"none","actual_soc":None,
              "would_record":["schedule (ticks the box)","caregiver (ticks the box)"],"questions":["The start date (Sep 22) has passed and AxisCare shows no clocked visit yet."]}]})
        self.send(404,{})
srv=HTTPServer(("127.0.0.1",0),Hd); port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{port}"
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[-900:]))
def run(script,**kw):
    rep=os.path.join(H,"_les_report.txt")
    env=dict(os.environ,SB_REPORT=rep,SB_TOKEN="sbp_test",SB_REF="REF",SB_SKIP_FUNCTION="1",SB_API_BASE=base,SB_FN_BASE=base,SB_HUB_URL=base,SB_ENGINE_URL=base+"/launch-evidence.js",
             SB_MIGFILE=MIGF,SB_MIG_SHA=MIG_SHA,SB_FNROOT=FNROOT,SB_FN_SHAS=json.dumps(FNS)); env.update(kw)
    p=subprocess.run(["python3",os.path.join(H,script)],env=env,capture_output=True,text=True)
    out=open(rep).read() if os.path.exists(rep) else p.stdout+p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode,out
has=lambda: s.run("select to_regclass('public.launch_evidence') is not null")[0][0]
Q=lambda: s.run("select caregiver_assigned, schedule_added, caregiver_assigned_name from client_queue")[0]

rc,rep=run("launch_evidence_install.py",SB_MIG_SHA="0"*64)
ck("install · a migration that is not the proven build stops before anything runs", rc==2 and not has() and not S["calls"], rep)
bad=dict(FNS); bad["launch-evidence"]="0"*64
rc,rep=run("launch_evidence_install.py",SB_FN_SHAS=json.dumps(bad))
ck("install · a function source that is not the reviewed one stops before anything runs", rc==2 and not has(), rep)
S["page"]="<html>old hub</html>"; rc,rep=run("launch_evidence_install.py"); S["page"]="<html>... leRefresh ...</html>"
ck("install · if the hub update is not merged yet it stops, nothing installed", rc==3 and "merge the hub pull request first" in rep and not has(), rep)
s.run("""update app_data set data = data || '{"launch_evidence_live":true}' where key='ops_settings'""")
rc,rep=run("launch_evidence_install.py")
s.run("""update app_data set data = data - 'launch_evidence_live' where key='ops_settings'""")
ck("install · refuses if the switch is already on", rc==4 and not has(), rep)
rc,rep=run("launch_evidence_install.py")
ck("install · happy path: installed, CORS answered, dry run read with the preview, New Clients unchanged, nothing recorded, logged",
   rc==0 and has() and "INSTALLED AND DRY RUN READ" in rep and "✓ New Clients unchanged" in rep and "Peggy Thomason (AxisCare 295)" in rep
   and "? The start date (Sep 22)" in rep and Q()==[False,False,None] and S["calls"][-1][0]=="Bearer svc-key", rep)
rc,rep=run("launch_evidence_install.py")
ck("install · running it again while nothing is recorded is harmless", rc==0 and has(), rep)

rc,rep=run("launch_evidence_switch.py",SB_MODE="on")
job=s.run("select schedule, command from cron.job where jobname='launch-evidence'")
sett=s.run("select data from app_data where key='ops_settings'")[0][0]; sett=sett if isinstance(sett,dict) else json.loads(sett)
ck("on · switch on (other settings kept), one every-30-minutes job calling the reader with the public key, first live run matches the record count",
   rc==0 and "TURNED ON" in rep and len(job)==1 and job[0][0]=="*/30 * * * *" and "anon-key" in job[0][1] and '"action":"run"' in job[0][1]
   and sett.get("launch_evidence_live") is True and sett.get("promises_live") is True and "coverage_watch_live" in sett
   and "✓ evidence went from 0 to 2 rows" in rep and Q()==[True,True,"Jane Doe"], rep)
rc,rep=run("launch_evidence_switch.py",SB_MODE="on")
ck("on · turning it on twice leaves exactly one job", rc==0 and s.run("select count(*) from cron.job where jobname='launch-evidence'")[0][0]==1, rep)
rc,rep=run("launch_evidence_switch.py",SB_MODE="off")
sett=s.run("select data from app_data where key='ops_settings'")[0][0]; sett=sett if isinstance(sett,dict) else json.loads(sett)
ck("off · switch off, schedule removed, recorded evidence and ticked boxes left as they are",
   rc==0 and "TURNED OFF" in rep and not s.run("select 1 from cron.job where jobname='launch-evidence'") and sett.get("launch_evidence_live") is False
   and s.run("select count(*) from launch_evidence")[0][0]==2 and Q()==[True,True,"Jane Doe"], rep)
S["engine"]="nope"; rc,rep=run("launch_evidence_switch.py",SB_MODE="on"); S["engine"]=ENGINE
ck("on · refuses if the live hub does not serve the rules; nothing changed", rc==2 and not s.run("select 1 from cron.job"), rep)
rc,rep=run("launch_evidence_install.py")
ck("install · once evidence exists the migration guard refuses a reinstall and nothing changes", rc==6 and "refused" in rep, rep)
srv.shutdown(); c.close()
print("\nCHANGE 1 · INSTALL AND ON/OFF SCRIPTS · PROOF AGAINST FAKE SERVICES + REAL POSTGRES\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
