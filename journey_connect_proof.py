#!/usr/bin/env python3
# Step 2 · a lead's Journey becomes the client's Journey · disposable-Postgres proof. Never touches production.
import os, json, hashlib, threading, datetime as dt
from zoneinfo import ZoneInfo
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
JC=open(os.path.join(H,"journey-connect.sql")).read()
JCRB=open(os.path.join(H,"journey-connect-rollback.sql")).read()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[:800]))
TODAY=dt.datetime.now(ZoneInfo("America/Chicago")).date()

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
    for f in (MIG,)+tuple(open(os.path.join(H,x)).read() for x in ("staffing-foundation.sql","team-build-link.sql","lead-journey-mirror.sql","client-admission.sql","start-contract.sql")):
        rc,out=c.psql(f); assert rc==0,out[-400:]
    return c,P,s

c,P,s=fixture("jc")
svc=c.conn("service_role")
leads=[{"id":"L1","status":"Contacted","first_name":"Cathy","last_name":"Jones","client_first_name":"Ruth","client_last_name":"Jones","created_at":"2026-09-10T15:00:00Z","axiscare_client_id":"AX50"},
       {"id":"L2","status":"New","client_first_name":"Ann","client_last_name":"Lee","created_at":"2026-09-12T15:00:00Z","axiscare_client_id":"AX60"},
       {"id":"L3","status":"New","client_first_name":"Bo","client_last_name":"Park","created_at":"2026-09-13T15:00:00Z","axiscare_client_id":"AX70"},
       {"id":"L4","status":"New","client_first_name":"Cy","client_last_name":"Dunn","created_at":"2026-09-14T15:00:00Z","axiscare_client_id":"AX80"},
       {"id":"L5","status":"Lost","client_first_name":"Di","client_last_name":"Ames","created_at":"2026-09-01T15:00:00Z","axiscare_client_id":"AX90"},
       {"id":"L6","status":"New","client_first_name":"Ed","client_last_name":"Moss","created_at":"2026-09-15T15:00:00Z","axiscare_client_id":"AX91"},
       {"id":"L7","status":"New","client_first_name":"Flo","client_last_name":"Hart","created_at":"2026-09-16T15:00:00Z"}]
s.run("update app_data set data=:d where key='leads'",d=json.dumps(leads))
svc.run("select count(*) from public.lead_journey_mirror(true)")
EP={r[0]:r[1] for r in s.run("select source_ref, episode_id::text from episode_source where system='lead' and role='origin'")}
svc.run("select public.start_contract_record(cast(:e as uuid),'expected',cast(:t as date),'Expect to begin October 5.','Cathy (daughter)','call',cast(:o as date),'kat@cc.test',cast(:n as date),null,'kat@cc.test','client_intake')",
        e=EP["L1"],t=(TODAY+dt.timedelta(days=9)).isoformat(),o=TODAY.isoformat(),n=(TODAY+dt.timedelta(days=3)).isoformat())
# AX70: a former client (person P3) whose earlier Journey ended in 2025
s.run("insert into person_source_id(person_id,system,entity_type,source_id,confidence) values (cast(:p as uuid),'axiscare','client','AX70','confirmed')",p=P[3])
old=door(svc,"episode_open_for_person",p_person_id=P[3],p_state="established",p_began_basis="documented",p_began_on="2025-01-10",p_began_evidence="x",p_prior_history="unobserved",p_prior_evidence="x")["episode_id"]
door(svc,"episode_set_state",p_episode_id=old,p_state="ended",p_end_basis="documented",p_end_on="2025-06-30",p_end_evidence="x")
# AX80: a current client (person P4) with an active Journey
s.run("insert into person_source_id(person_id,system,entity_type,source_id,confidence) values (cast(:p as uuid),'axiscare','client','AX80','confirmed')",p=P[4])
ACT4=door(svc,"episode_open_for_person",p_person_id=P[4],p_state="established",p_began_basis="before_observation",p_began_not_after="2026-08-01",p_began_evidence="x",p_prior_history="unobserved",p_prior_evidence="x")["episode_id"]
# admission cases: AX60 open (routine), AX91 open and escalated to Owner / Decision
def OPEN(ax,name):
    r=svc.run("select public.client_admission_open(:a,'Active',now(),:n,'{}')",a=ax,n=name)[0][0]
    return (r if isinstance(r,dict) else json.loads(r))["case_id"]
C60=OPEN("AX60","Ann Lee"); C91=OPEN("AX91","Ed Moss")
s.run("update client_admission_case set needs_owner_decision=true, escalation_reason='test escalation' where case_id=cast(:c as uuid)",c=C91)
JF0=journey_fp(c); OLD=s.run("select prosrc from pg_proc where proname='lead_journey_mirror'")[0][0]

rc,out=c.psql(JC.replace("do $verify$","select 1/0;\ndo $verify$",1))
ck("install · an injected failure leaves nothing behind, including the lead mirror", rc!=0 and not has_obj(c,"lead_journey_connection")
   and s.run("select prosrc from pg_proc where proname='lead_journey_mirror'")[0][0]==OLD, out[-200:])
rc,out=c.psql(JC); rc2,out2=c.psql(JC)
ck("install · installs, and a rerun while unused succeeds; self-check passes", rc==0 and rc2==0, (out+out2)[-300:])
NEW=s.run("select prosrc from pg_proc where proname='lead_journey_mirror'")[0][0]
rev=NEW.replace(" v_person uuid;","",1).replace(" v_person := null;","",1).replace("e.state, e.person_id into v_ep, v_state, v_person","e.state into v_ep, v_state",1)
a=rev.index("    -- an episode already exists for this lead. Once admission"); b=rev.index("    elsif st = 'lost' and public.journey_state_is_active(v_state) then")
rev=rev[:a]+"    -- an episode already exists for this lead\n    if st = 'lost' and public.journey_state_is_active(v_state) then"+rev[b+len("    elsif st = 'lost' and public.journey_state_is_active(v_state) then"):]
ck("lead mirror · the replacement differs from the deployed mirror ONLY in the Lost-after-confirmation rule", rev==OLD and NEW!=OLD)

def CON(lead,ax,name=None,how="typed",staff="kat@cc.test",seat="client_intake",conn=None):
    r=(conn or svc).run("select public.lead_journey_connect(:l,:a,:n,:h,:s,:t)",l=lead,a=ax,n=name,h=how,s=staff,t=seat)[0][0]
    return r if isinstance(r,dict) else json.loads(r)
O=lambda r:r.get("outcome")
snap=lambda: [s.run(f"select count(*) from {t}")[0][0] for t in ("person_identity","person_source_id","person_role","lead_journey_connection","episode_review")]+[s.run("select count(*) from client_admission_case where status='open'")[0][0]]

S0=snap()
refs=[CON("L1","AX50",seat="system"),CON("L1","AX50",staff=" "),CON("L1","AX50",how="name_match"),CON("L1",""),CON("L99","AX50"),
      CON("L1","AX51"),CON("L5","AX90")]
ck("refusals · bad seat, no person, an unknown way of confirming (a name match is not one), a missing id, an unknown lead, an id the lead doesn't carry, and a closed (lost) inquiry are refused; nothing changes",
   [O(r) for r in refs]==["invalid_seat","staff_required","invalid_how","lead_and_id_required","lead_not_found","lead_id_mismatch","journey_closed"] and snap()==S0,
   [O(r) for r in refs])
s.run("update app_data set data=:d where key='leads'",d=json.dumps(leads+[{"id":"L8","status":"New","axiscare_client_id":"AX95"}]))
ck("refusals · a lead the mirror hasn't given a Journey yet is told so", O(CON("L8","AX95"))=="no_journey" and snap()==S0)

# ---------------------------------------------------------------- the main path
r=CON("L1","AX50",name="Ruth Jones")
per=s.run("select person_id::text, evidence from person_source_id where source_id='AX50'")
ep=s.run("select person_id::text, state from journey_episode where episode_id=cast(:e as uuid)",e=EP["L1"])[0]
ck("connect · typing Ruth's AxisCare id (after seeing both side by side) makes her inquiry Journey hers: same Journey, new person, converted",
   O(r)=="connected" and r["episode_id"]==EP["L1"] and r["person_created"] is True and per and ep==[per[0][0],"converted"]
   and "human-confirmed" in per[0][1] and "kat@cc.test" in per[0][1], (r,ep,per))
ck("connect · the person is named from AxisCare and has the client role", s.run("select display_name from person_identity where id=cast(:p as uuid)",p=per[0][0])[0][0]=="Ruth Jones"
   and s.run("select count(*) from person_role where person_id=cast(:p as uuid) and role='client' and status='active'",p=per[0][0])[0][0]==1)
ck("connect · the Start Contract recorded while she was an inquiry is on the same Journey, untouched",
   s.run("select promised_wording from start_contract_current where episode_id=cast(:e as uuid)",e=EP["L1"])==[["Expect to begin October 5."]])
ck("connect · the connection is recorded with who, which seat and how",
   s.run("select lead_id, axiscare_client_id, how, confirmed_by, confirmed_seat, person_created from lead_journey_connection where episode_id=cast(:e as uuid)",e=EP["L1"])
   ==[["L1","AX50","typed","kat@cc.test","client_intake",True]])
S1=snap(); r2=CON("L1","AX50")
ck("connect · repeating it is harmless: already connected, nothing new", O(r2)=="already_connected" and snap()==S1, r2)

r=CON("L3","AX70",how="convert")
ck("connect · a former client (earlier Journey ended) is recognised: no new person, the inquiry becomes their new Journey",
   O(r)=="connected" and r["person_created"] is False and r["person_id"]==P[3]
   and s.run("select count(*) from journey_episode where person_id=cast(:p as uuid)",p=P[3])[0][0]==2, r)

S2=snap(); r=CON("L4","AX80")
ck("atomic · an AxisCare client who already has an active Journey is refused (Owner / Decision) and nothing at all is saved",
   O(r)=="refused" and r["detail"]["outcome"]=="person_has_active_journey" and r["detail"]["active_episode_id"]==ACT4 and snap()==S2
   and s.run("select state, person_id from journey_episode where episode_id=cast(:e as uuid)",e=EP["L4"])[0]==["provisional",None], r)

r=CON("L2","AX60",name="Ann Lee")
cs=s.run("select status, resolved_by, resolution_note from client_admission_case where case_id=cast(:c as uuid)",c=C60)[0]
ck("admission · an open admission case for that AxisCare id is closed as confirmed through the lead, and logged",
   O(r)=="connected" and r["admission_case_closed"] is True and cs[0]=="confirmed_new" and cs[1]=="kat@cc.test" and "lead L2" in cs[2]
   and s.run("select count(*) from client_admission_event where case_id=cast(:c as uuid) and op='confirm' and outcome='via_lead'",c=C60)[0][0]==1, (r,cs))
S3=snap(); r=CON("L6","AX91")
ck("admission · a case escalated to Owner / Decision needs that seat; Client Intake changes nothing",
   O(r)=="seat_required" and snap()==S3, r)
r=CON("L6","AX91",staff="owner@cc.test",seat="owner_decision")
ck("admission · Owner / Decision can connect it", O(r)=="connected", r)

# ---------------------------------------------------------------- lead mirror after connection
lk=[dict(x) for x in leads]; lk[0]["status"]="Lost"; lk[6]["status"]="Lost"
s.run("update app_data set data=:d where key='leads'",d=json.dumps(lk))
out={x[0]:(x[1],x[2]) for x in svc.run("select * from public.lead_journey_mirror(true)")}
ck("lead mirror · a Lost mark on Ruth's old lead is reported, never applied; an unconnected inquiry still closes as lost",
   out["L1"][0]=="diverged" and s.run("select state from journey_episode where episode_id=cast(:e as uuid)",e=EP["L1"])[0][0]=="converted"
   and out["L7"][0]=="closed_lost", out)
s.run("update app_data set data=:d where key='leads'",d=json.dumps(leads))

# ---------------------------------------------------------------- concurrency
lk=leads+[{"id":"L9","status":"New","client_first_name":"Gus","client_last_name":"Ray","created_at":"2026-09-17T15:00:00Z","axiscare_client_id":"AX99"}]
s.run("update app_data set data=:d where key='leads'",d=json.dumps(lk)); svc.run("select count(*) from public.lead_journey_mirror(true)")
res2={}
def race(k,bar):
    cc=c.conn("service_role")
    try: bar.wait(); res2[k]=O(CON("L9","AX99",name="Gus Ray",conn=cc))
    except Exception as e: res2[k]="ERROR "+str(e)[:160]
    finally: cc.close()
bar=threading.Barrier(2); ts=[threading.Thread(target=race,args=(k,bar)) for k in "ab"]; [t.start() for t in ts]; [t.join() for t in ts]
ck("concurrency · two people connecting the same lead at once: one connects, the other is told it's done; one person",
   sorted(res2.values())==["already_connected","connected"] and s.run("select count(*) from person_source_id where source_id='AX99'")[0][0]==1, res2)

# ---------------------------------------------------------------- append-only, security, guard, rollback
ck("append-only · connections cannot be edited, deleted or truncated",
   all(err_code(f) is not None for f in [lambda: s.run("update lead_journey_connection set how='typed'"),
       lambda: s.run("delete from lead_journey_connection"), lambda: s.run("truncate lead_journey_connection")]))
au=c.conn("authenticated"); an=c.conn("anon")
ck("security · signed-in staff read connections but cannot connect or write; anonymous gets nothing",
   err_code(lambda: au.run("select count(*) from lead_journey_connection")) is None
   and (err_code(lambda: CON("L7","AX00",conn=au)) or "").startswith("42501")
   and (err_code(lambda: au.run("insert into lead_journey_connection(episode_id,lead_id,axiscare_client_id,person_id,how,person_created,confirmed_by,confirmed_seat) values (cast(:e as uuid),'x','x',cast(:p as uuid),'typed',false,'x','client_intake')",e=EP["L7"],p=P[1])) or "").startswith("42501")
   and (err_code(lambda: an.run("select count(*) from lead_journey_connection")) or "").startswith("42501"))
rc,out=c.psql(JC); ck("guard · once connections exist the migration refuses and changes nothing", rc!=0 and "refused" in out, out[-200:])
rc,out=c.psql(JCRB); ck("rollback · refuses once connections exist", rc!=0 and "refused" in out and has_obj(c,"lead_journey_connection"), out[-200:])
ck("journey · Journey foundation definitions unchanged", journey_fp(c)==JF0)
for x in (svc,au,an): x.close()
c.close()
c,P,s=fixture("jcrb")
O1=s.run("select prosrc from pg_proc where proname='lead_journey_mirror'")[0][0]
rc,out=c.psql(JC); rc2,out2=c.psql(JCRB)
ck("rollback · on an unused install removes Step 2 and restores the original lead mirror exactly",
   rc==0 and rc2==0 and not has_obj(c,"lead_journey_connection") and s.run("select prosrc from pg_proc where proname='lead_journey_mirror'")[0][0]==O1, (out+out2)[-300:])
c.close()
print("\nSTEP 2 · LEAD JOURNEY BECOMES THE CLIENT'S · DISPOSABLE PROOF\n"+"="*60)
ok=True
for nm,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+nm+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "%d FAILED"%sum(1 for r in res if not r[1]))
print("journey-connect migration sha256:", hashlib.sha256(JC.encode()).hexdigest())
