#!/usr/bin/env python3
# Change 6a · the install script (251) against fake Supabase services whose database is a real disposable Postgres.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
MIGF=os.path.join(H,"family-circles-link.sql"); MIG_SHA=hashlib.sha256(open(MIGF,"rb").read()).hexdigest()
FNROOT=os.path.join(H,"supabase","functions")
sh=lambda p: hashlib.sha256(open(p,"rb").read()).hexdigest()
FNS={f:sh(os.path.join(FNROOT,f,"index.ts")) for f in ("family-circles","circle-send","identity-backfill","coverage-run")}
FNS["_shared/family-change-text.ts"]=sh(os.path.join(FNROOT,"_shared","family-change-text.ts"))
c=Cluster("fci"); s=c.su
for r in ["anon","authenticated"]: s.run(f"do $$ begin create role {r} nologin; exception when duplicate_object then null; end $$;")
s.run("do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;")
s.run("grant usage on schema public to anon, authenticated, service_role")
s.run("create table person_identity (id uuid primary key default gen_random_uuid(), display_name text)")
s.run("create table person_source_id (person_id uuid, system text, entity_type text, source_id text)")
s.run("create table care_circles (id uuid primary key default gen_random_uuid(), client_name text, active boolean default true)")
s.run("create table circle_contacts (id bigserial primary key, circle_id uuid, name text, source text, sms_consent boolean)")
s.run("create table app_data (key text primary key, data jsonb, updated_at timestamptz)")
s.run("""insert into app_data values ('ops_settings','{"coverage_send_live":true,"client_status_live":true}',now())""")
p=str(s.run("insert into person_identity(display_name) values ('Ruth Jones') returning id")[0][0]); s.run("insert into person_source_id values (cast(:p as uuid),'axiscare','client','501')",p=p)
cr=str(s.run("insert into care_circles(client_name) values ('Ruth Jones') returning id")[0][0]); s.run("insert into circle_contacts(circle_id,name,source,sms_consent) values (cast(:c as uuid),'Cathy','axiscare',true)",c=cr)
ct=str(s.run("insert into care_circles(client_name) values ('Charles T') returning id")[0][0]); s.run("insert into circle_contacts(circle_id,name,source,sms_consent) values (cast(:c as uuid),'Jo','office',false)",c=ct)
S={"page":"<html> fcLinkPick </html>","calls":[]}
def J(v): return int(v) if isinstance(v,Decimal) else (v if isinstance(v,(int,float,bool,str,dict,list,type(None))) else str(v))
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
        raw=self.rfile.read(int(self.headers.get("Content-Length") or 0)); body=json.loads(raw or b"{}")
        if self.path.endswith("/database/query"):
            q=body["query"]
            if q.lstrip().startswith("-- ====") or q.lstrip().startswith("begin;"):
                rc,out=c.psql(q); return self.send(200,[]) if rc==0 else self.send(400,{"message":out[-400:]})
            cc=c.conn()
            try: rows=cc.run(q); cols=[d["name"] for d in (cc.columns or [])]; return self.send(200,[{k:J(v) for k,v in zip(cols,r)} for r in (rows or [])])
            except Exception as e: return self.send(400,{"message":str(e)[:300]})
            finally: cc.close()
        if "identity-backfill" in self.path:
            S["calls"].append(self.path)
            return self.send(200,{"mode":"DRY RUN" if "commit=1" not in self.path else "COMMIT","clients":1,"circles_linked":0,"circles_created":0,"contacts_updated":1,"contacts_added":0,
                                   "contacts_marked_removed":0,"manual_untouched":0,"waiting_for_person_link":0,"errors":[]})
        self.send(404,{})
srv=HTTPServer(("127.0.0.1",0),Hd); port=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
base=f"http://127.0.0.1:{port}"; res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[-900:]))
def run(**kw):
    rep=os.path.join(H,"_fci.txt")
    env=dict(os.environ,SB_REPORT=rep,SB_TOKEN="sbp_test",SB_REF="REF",SB_SKIP_FUNCTION="1",SB_API_BASE=base,SB_FN_BASE=base,SB_HUB_URL=base,
             SB_MIGFILE=MIGF,SB_MIG_SHA=MIG_SHA,SB_FNROOT=FNROOT,SB_FN_SHAS=json.dumps(FNS)); env.update(kw)
    pr=subprocess.run(["python3",os.path.join(H,"family_circles_install.py")],env=env,capture_output=True,text=True)
    out=open(rep).read() if os.path.exists(rep) else pr.stdout+pr.stderr
    if os.path.exists(rep): os.remove(rep)
    return pr.returncode,out
settings=lambda: (lambda d: d if isinstance(d,dict) else json.loads(d))(s.run("select data from app_data where key='ops_settings'")[0][0])
bad=dict(FNS); bad["_shared/family-change-text.ts"]="0"*64
rc,rep=run(SB_FN_SHAS=json.dumps(bad)); ck("a changed family-text module stops everything before it runs", rc==2 and "family_circle_link" not in str(s.run("select proname from pg_proc where proname='family_circle_link'")), rep)
S["page"]="<html>old</html>"; rc,rep=run(); S["page"]="<html> fcLinkPick </html>"
ck("if the hub update isn't merged yet it stops, nothing changed", rc==3 and "approved" not in json.dumps(settings()), rep)
rc,rep=run()
st=settings()
ck("happy path: migration applied, Ruth's circle (fed by the sync, exact name) linked, Charles's (typed in the office) waiting",
   rc==0 and "INSTALLED" in rep and "1 circle(s) linked" in rep and "• Charles T · 1 member(s), 0 with texting consent" in rep, rep)
ck("your approval is recorded with your words and its scope, and every other setting is kept",
   st.get("family_caregiver_change_text_approved",{}).get("words")=="Approve it as an exception to your rule" and st.get("coverage_send_live") is True and st.get("client_status_live") is True, st)
ck("the family sync is only DRY-RUN here (tonight's run applies it)", S["calls"] and all("commit=1" not in x for x in S["calls"]), S["calls"])
ck("no circle or member added or removed, consent unchanged", "✓ no circle or member added or removed" in rep, rep)
rc,rep=run()
ck("running it again is harmless (only install links so far)", rc==0, rep)
srv.shutdown(); c.close()
print("\nCHANGE 6a · INSTALL SCRIPT · PROOF AGAINST FAKE SERVICES + REAL POSTGRES\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
