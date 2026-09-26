#!/usr/bin/env python3
# Step 3 · "Who is this?" for a new client with no lead · disposable-Postgres proof. Never touches production.
import os, json, hashlib, threading, datetime as dt
from zoneinfo import ZoneInfo
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_connect_proof.py")).read()
exec(compile(src[:src.index('c,P,s=fixture("jc")')], "defs", "exec"))   # fixture(): production-like, Stage 2/3 + Start Contract
AN=open(os.path.join(H,"admission-newclients.sql")).read()
ANRB=open(os.path.join(H,"admission-newclients-rollback.sql")).read()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[:800]))
TODAY=dt.datetime.now(ZoneInfo("America/Chicago")).date()

c,P,s=fixture("an")
assert c.psql(open(os.path.join(H,"journey-connect.sql")).read())[0]==0     # Step 2 is live in production
svc=c.conn("service_role")
leads=[{"id":"L1","status":"New","client_first_name":"Ruth","client_last_name":"Jones","created_at":"2026-09-10T15:00:00Z"},
       {"id":"L2","status":"New","first_name":"Tom","last_name":"Ray","created_at":"2026-09-12T15:00:00Z"}]
s.run("update app_data set data=:d where key='leads'",d=json.dumps(leads))
svc.run("select count(*) from public.lead_journey_mirror(true)")
EP={r[0]:r[1] for r in s.run("select source_ref, episode_id::text from episode_source where system='lead' and role='origin'")}
BASE5=door(svc,"episode_open_for_person",p_person_id=P[5],p_state="established",p_began_basis="before_observation",p_began_not_after="2026-08-01",p_began_evidence="x",p_prior_history="unobserved",p_prior_evidence="x")["episode_id"]
old6=door(svc,"episode_open_for_person",p_person_id=P[6],p_state="established",p_began_basis="documented",p_began_on="2025-01-10",p_began_evidence="x",p_prior_history="unobserved",p_prior_evidence="x")["episode_id"]
door(svc,"episode_set_state",p_episode_id=old6,p_state="ended",p_end_basis="documented",p_end_on="2025-06-30",p_end_evidence="x")
def OPEN(ax,name):
    r=svc.run("select public.client_admission_open(:a,'New Clients',now(),:n,'{}')",a=ax,n=name)[0][0]
    return (r if isinstance(r,dict) else json.loads(r))["case_id"]
C1=OPEN("600","Walk In"); C2=OPEN("700","Existing Five"); C3=OPEN("800","Former Six"); C4=OPEN("900","Race Case"); C5=OPEN("950","Ruth Jones")
JF0=journey_fp(c)

rc,out=c.psql(AN.replace("do $verify$","select 1/0;\ndo $verify$",1))
ck("install · an injected failure leaves nothing behind", rc!=0 and not has_obj(c,"client_admission_journey") and not has_obj(c,"client_admission_lead_options"), out[-200:])
rc,out=c.psql(AN); rc2,out2=c.psql(AN)
ck("install · installs, and a rerun while unused succeeds; self-check passes", rc==0 and rc2==0, (out+out2)[-300:])
ck("install · the lead mirror is not touched by Step 3", "belongs to a confirmed client" in s.run("select prosrc from pg_proc where proname='lead_journey_mirror'")[0][0])

def ADMIT(case,decision="new",person=None,name=None,reason="Referred straight to AxisCare by the hospital",staff="kat@cc.test",seat="client_intake",conn=None):
    r=(conn or svc).run("select public.client_admission_admit(cast(:c as uuid), :d, cast(:p as uuid), :n, :r, :s, :t, null)",
                        c=case,d=decision,p=person,n=name,r=reason,s=staff,t=seat)[0][0]
    return r if isinstance(r,dict) else json.loads(r)
O=lambda r:r.get("outcome")
snap=lambda: [s.run(f"select count(*) from {t}")[0][0] for t in ("person_identity","person_source_id","person_role","journey_episode","client_admission_journey","episode_review")]+[s.run("select count(*) from client_admission_case where status='open'")[0][0]]

opts=s.run("select lead_id, label, match from client_admission_lead_options where case_id=cast(:c as uuid) order by lead_id",c=C5)
ck("options · a case lists the unconnected inquiries it might have come from, with the lead id and a name hint only",
   [o[0] for o in opts]==["L1","L2"] and [o for o in opts if o[0]=="L1"][0][2]=="name", opts)

S0=snap()
refs=[ADMIT(C1,name="Walk In",seat="system"),ADMIT(C1,name="Walk In",staff=" "),ADMIT(C1,name="Walk In",reason="  ")]
ck("refusals · bad seat, no person, and no reason for having no inquiry are refused; nothing changes",
   [O(r) for r in refs]==["invalid_seat","staff_required","no_lead_reason_required"] and snap()==S0, [O(r) for r in refs])

r=ADMIT(C1,name="Walk In")
rg=s.run("select state, began_basis, began_hi::text, prior_history_status from episode_range where episode_id=cast(:e as uuid)",e=r.get("episode_id"))
ck("new client, no inquiry · one honest Journey: converted, began on or before the day AxisCare showed them, earlier history not observed",
   O(r)=="admitted" and r["journey"]=="new_journey" and rg==[["converted","before_observation",TODAY.isoformat(),"unobserved"]], (r,rg))
ck("new client, no inquiry · the case is confirmed and the decision is kept with the reason",
   s.run("select status from client_admission_case where case_id=cast(:c as uuid)",c=C1)[0][0]=="confirmed_new"
   and s.run("select decision, no_lead_reason, decided_by from client_admission_journey where case_id=cast(:c as uuid)",c=C1)
       ==[["new_journey","Referred straight to AxisCare by the hospital","kat@cc.test"]])
r=ADMIT(C2,decision="existing",person=P[5],reason="Already a client under a new AxisCare record")
ck("existing person with an active Journey · it is kept; nothing new is opened",
   O(r)=="admitted" and r["journey"]=="existing_journey" and r["episode_id"]==BASE5
   and s.run("select count(*) from journey_episode where person_id=cast(:p as uuid)",p=P[5])[0][0]==1, r)
r=ADMIT(C3,decision="existing",person=P[6],reason="Returning client, called AxisCare directly")
ck("former client (earlier Journey ended) · a new Journey opens for the same person; the old one is untouched",
   O(r)=="admitted" and r["journey"]=="new_journey" and s.run("select count(*) from journey_episode where person_id=cast(:p as uuid)",p=P[6])[0][0]==2
   and s.run("select state from journey_episode where episode_id=cast(:e as uuid)",e=old6)[0][0]=="ended", r)

# atomic: an earlier Journey with no recorded end blocks a new one, and the identity step rolls back with it
s.run("insert into journey_episode (person_id, state, created_by) values (cast(:p as uuid),'open','fixture')",p=P[7])
s.run("update journey_episode set state='lost', terminal_at=now() where person_id=cast(:p as uuid)",p=P[7])
C6=OPEN("960","Seven Unclear")
S1=snap(); r=ADMIT(C6,decision="existing",person=P[7],reason="walk-in")
ck("atomic · if the Journey step is refused (an earlier Journey has no recorded end), the identity confirmation is rolled back too",
   O(r)=="journey_refused" and r["detail"]["outcome"]=="boundary_unresolved" and snap()==S1
   and s.run("select status from client_admission_case where case_id=cast(:c as uuid)",c=C6)[0][0]=="open", (r,snap(),S1))

# lead-sourced: Step 2 closes the case, so "Who is this?" cannot admit it a second time
s.run("update app_data set data=:d where key='leads'",d=json.dumps([dict(leads[0],axiscare_client_id="950"),leads[1]]))
rc2=svc.run("select public.lead_journey_connect('L1','950','Ruth Jones','confirmed_match','kat@cc.test','client_intake')")[0][0]
rc2=rc2 if isinstance(rc2,dict) else json.loads(rc2)
r=ADMIT(C5,name="Ruth Jones")
ck("one path for lead-sourced clients · connecting the inquiry (Step 2) closes the case; admitting it again here is refused",
   rc2.get("outcome")=="connected" and rc2.get("admission_case_closed") is True and O(r)=="already_closed", (rc2,r))
ck("options · a closed case offers no inquiries", s.run("select count(*) from client_admission_lead_options where case_id=cast(:c as uuid)",c=C5)[0][0]==0)

C7=OPEN("970","Linked Already"); s.run("insert into person_source_id(person_id,system,entity_type,source_id) values (cast(:p as uuid),'axiscare','client','970')",p=P[8])
r=ADMIT(C7,name="x")
ck("escalation · an AxisCare id already linked to someone escalates exactly as before; no Journey is touched",
   O(r)=="escalated" and s.run("select count(*) from client_admission_journey where case_id=cast(:c as uuid)",c=C7)[0][0]==0, r)

out={}
def race(k,bar):
    cc=c.conn("service_role")
    try: bar.wait(); out[k]=O(ADMIT(C4,name="Race Case",conn=cc))
    except Exception as e: out[k]="ERROR "+str(e)[:160]
    finally: cc.close()
bar=threading.Barrier(2); ts=[threading.Thread(target=race,args=(k,bar)) for k in "ab"]; [t.start() for t in ts]; [t.join() for t in ts]
ck("concurrency · two people admitting the same client at once: one admits, the other is told it is done; one person, one Journey",
   sorted(out.values())==["admitted","already_closed"] and s.run("select count(*) from person_source_id where source_id='900'")[0][0]==1
   and s.run("select count(*) from client_admission_journey where case_id=cast(:c as uuid)",c=C4)[0][0]==1, out)

ck("append-only · admission decisions cannot be edited, deleted or truncated",
   all(err_code(f) is not None for f in [lambda: s.run("update client_admission_journey set decided_by='x'"),
       lambda: s.run("delete from client_admission_journey"), lambda: s.run("truncate client_admission_journey")]))
au=c.conn("authenticated"); an=c.conn("anon")
ck("security · signed-in staff read decisions and options but cannot admit or write; anonymous gets nothing",
   err_code(lambda: au.run("select count(*) from client_admission_journey")) is None
   and err_code(lambda: au.run("select count(*) from client_admission_lead_options")) is None
   and (err_code(lambda: ADMIT(C6,name="x",conn=au)) or "").startswith("42501")
   and (err_code(lambda: an.run("select count(*) from client_admission_lead_options")) or "").startswith("42501")
   and (err_code(lambda: an.run("select count(*) from client_admission_journey")) or "").startswith("42501"))
rc,out=c.psql(AN); ck("guard · once admissions are recorded the migration refuses and changes nothing", rc!=0 and "refused" in out, out[-200:])
rc,out=c.psql(ANRB); ck("rollback · refuses once admissions are recorded", rc!=0 and "refused" in out and has_obj(c,"client_admission_journey"), out[-200:])
ck("journey · Journey foundation definitions unchanged", journey_fp(c)==JF0)
for x in (svc,au,an): x.close()
c.close()
c,P,s=fixture("anrb")
rc,out=c.psql(AN); rc2,out2=c.psql(ANRB)
ck("rollback · on an unused install removes Step 3's admission objects", rc==0 and rc2==0 and not has_obj(c,"client_admission_journey")
   and not has_obj(c,"client_admission_lead_options"), (out+out2)[-300:])
c.close()
print("\nSTEP 3 · WHO IS THIS? (NO-LEAD ADMISSION) · DISPOSABLE PROOF\n"+"="*60)
ok=True
for nm,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+nm+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "%d FAILED"%sum(1 for r in res if not r[1]))
print("admission-newclients migration sha256:", hashlib.sha256(AN.encode()).hexdigest())
