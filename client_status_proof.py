#!/usr/bin/env python3
# Change 3 · AxisCare status reaches the hub · disposable-Postgres proof. Never touches production.
import os, json, hashlib, threading, datetime as dt
from zoneinfo import ZoneInfo
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
CS=open(os.path.join(H,"client-status.sql")).read()
CSRB=open(os.path.join(H,"client-status-rollback.sql")).read()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[:800]))
TODAY=dt.datetime.now(ZoneInfo("America/Chicago")).date()
D=lambda k:(TODAY+dt.timedelta(days=k)).isoformat()

def fixture(tag):
    c=Cluster(tag); P=setup_supabase_like(c); s=c.su
    s.run("""create table person_role (id bigserial primary key, person_id uuid not null references person_identity(id), role text not null,
             status text not null default 'active' check (status in ('active','former','prospective')), started_at date, ended_at date, end_reason text,
             updated_at timestamptz not null default now())""")
    s.run("create unique index person_role_one_active on person_role (person_id, role) where status = 'active'")
    s.run("revoke all on person_role from anon"); s.run("grant select on person_role to authenticated"); s.run("grant all on person_role to service_role")
    rc,out=c.psql(MIG); assert rc==0,out[-400:]
    return c,P,s
J=lambda r: r if isinstance(r,dict) else json.loads(r)
O=lambda r:r.get("outcome")

c,P,s=fixture("cs"); svc=c.conn("service_role")
# Ruth (P1): AxisCare 501, established Journey since 2026-08-20, active client role
for i,ax in ((1,"501"),(2,"502"),(3,"503")):
    s.run("insert into person_source_id(person_id,system,entity_type,source_id,confidence) values (cast(:p as uuid),'axiscare','client',:a,'confirmed')",p=P[i],a=ax)
    s.run("insert into person_role(person_id,role,status,started_at) values (cast(:p as uuid),'client','active','2026-08-20')",p=P[i])
EP1=door(svc,"episode_open_for_person",p_person_id=P[1],p_state="established",p_began_basis="documented",p_began_on="2026-08-20",p_began_evidence="x",p_prior_history="unobserved",p_prior_evidence="x")["episode_id"]
EP3=door(svc,"episode_open_for_person",p_person_id=P[3],p_state="established",p_began_basis="documented",p_began_on=D(-3),p_began_evidence="x",p_prior_history="unobserved",p_prior_evidence="x")["episode_id"]
JF0=journey_fp(c)

rc,out=c.psql(CS.replace("do $verify$","select 1/0;\ndo $verify$",1))
ck("install · an injected failure leaves nothing behind", rc!=0 and not has_obj(c,"client_status_review"), out[-200:])
rc,out=c.psql(CS); rc2,out2=c.psql(CS)
ck("install · installs, a rerun while unused succeeds, self-check passes", rc==0 and rc2==0, (out+out2)[-300:])

r=J(svc.run("select public.client_status_current_refresh(cast(:m as jsonb), now())",m=json.dumps({"501":"Active","502":"Active","900":"Deceased"}))[0][0])
r2=J(svc.run("select public.client_status_current_refresh(cast(:m as jsonb), now())",m=json.dumps({"501":"Inactive"}))[0][0])
cur=dict(s.run("select axiscare_client_id, label from client_status_current"))
ck("current status · the check's map becomes a readable copy; later checks update it; nobody is dropped by a partial read",
   O(r)=="refreshed" and r["rows"]==3 and cur=={"501":"Inactive","502":"Active","900":"Deceased"}, (r,r2,cur))

TR=lambda ref,ax,old,new,at="2026-09-30T12:17:00Z": {"id":ref,"axiscare_client_id":ax,"old_status_label":old,"new_status_label":new,"observed_at":at}
OPEN=lambda t,conn=None: J((conn or svc).run("select public.client_status_review_open(cast(:t as jsonb),'automation:client-status')",t=json.dumps(t))[0][0])
r=OPEN(TR("tr_900_a","900","Inactive","Deceased"))
ck("open · a change for a client the hub has never known is not a review (only logged)", O(r)=="no_hub_person" and s.run("select count(*) from client_status_review")[0][0]==0, r)
bad=[OPEN({"id":"x"}),OPEN(TR("tr_1","501","Active","Inactive",at="not a time"))]
ck("open · malformed changes are refused", [O(x) for x in bad]==["invalid","invalid"], bad)
R1=OPEN(TR("tr_501_a","501","Active","Inactive"))
ck("open · Ruth's change opens one review, tied to her and her active Journey", O(R1)=="opened" and R1["episode_id"]==EP1 and R1["person_id"]==P[1], R1)
ck("open · the same change again never opens a second review", O(OPEN(TR("tr_501_a","501","Active","Inactive")))=="already_open" and s.run("select count(*) from client_status_review")[0][0]==1)

DEC=lambda rid,dec,date=None,reason=None,note=None,staff="kat@cc.test",seat="client_intake",conn=None: J((conn or svc).run(
    "select public.client_status_decide(cast(:r as uuid),:d,cast(:dt as date),:rs,:n,:s,:st)",r=rid,d=dec,dt=date,rs=reason,n=note,s=staff,st=seat)[0][0])
snap=lambda: [s.run(q)[0][0] for q in ("select count(*) from client_status_review where status='open'","select count(*) from person_role where status='active'",
              "select count(*) from journey_episode where state='established'","select count(*) from episode_fact")]
S0=snap(); rid=R1["review_id"]
refs=[DEC(rid,"care_ended",seat="system"),DEC(rid,"care_ended",staff=" "),DEC(rid,"forgot"),DEC(rid,"care_ended",reason="discharged"),
      DEC(rid,"care_ended",date=D(3),reason="discharged"),DEC(rid,"care_ended",date=D(-1)),DEC(rid,"care_ended",date=D(-1),reason="other"),
      DEC(rid,"no_change"),DEC(rid,"returning",date=D(-1))]
ck("refusals · bad seat, no person, unknown answer, no date, a future date, no reason, 'other' without a note, 'mistake' without a note, and 'returning' from Client Intake; nothing changes",
   [O(x) for x in refs]==["invalid_seat","staff_required","invalid_decision","date_required","date_required","reason_required","note_required","note_required","seat_required"]
   and snap()==S0, [O(x) for x in refs])
r=DEC(rid,"care_ended",date="2026-08-01",reason="discharged")
ck("atomic · an end date before care began is refused by the Journey rules and NOTHING is saved (role still active, review still open)",
   O(r)=="refused" and r["detail"]["outcome"]=="invalid_end" and snap()==S0, r)
r=DEC(rid,"care_ended",date=D(-2),reason="facility",note="Moved to Mercy Village")
ep=s.run("select state from journey_episode where episode_id=cast(:e as uuid)",e=EP1)[0][0]
fact=s.run("select basis, on_date::text, evidence from episode_fact where episode_id=cast(:e as uuid) and fact_type='ended'",e=EP1)
role=s.run("select status, ended_at::text, end_reason from person_role where person_id=cast(:p as uuid) and role='client'",p=P[1])
rv=s.run("select status, decision, decided_on::text, reason, note, decided_by, decided_seat from client_status_review where review_id=cast(:r as uuid)",r=rid)[0]
ck("care ended · her Journey ends on the day given, with the AxisCare change and who confirmed it as the evidence",
   O(r)=="decided" and r["journey_ended"]==EP1 and ep=="ended" and fact[0][0]=="documented" and fact[0][1]==D(-2)
   and "Active -> Inactive" in fact[0][2] and "kat@cc.test" in fact[0][2] and "Mercy Village" in fact[0][2], (r,fact))
ck("care ended · her client role becomes former, with the day and the reason", role==[["former",D(-2),"moved to a facility"]], role)
ck("care ended · the answer is recorded once, with who and which seat", rv==["decided","care_ended",D(-2),"facility","Moved to Mercy Village","kat@cc.test","client_intake"], rv)
ck("care ended · answering again is refused", O(DEC(rid,"on_hold"))=="already_decided")

R2=OPEN(TR("tr_502_a","502","Active","Inactive"))
S1=snap(); r=DEC(R2["review_id"],"on_hold",note="Hospital stay, back next week")
ck("on hold · nothing ends; the answer and note are kept", O(r)=="decided" and snap()[1:]==S1[1:]
   and s.run("select decision, note from client_status_review where review_id=cast(:r as uuid)",r=R2["review_id"])==[["on_hold","Hospital stay, back next week"]], r)
R2b=OPEN(TR("tr_502_b","502","Inactive","Active","2026-10-02T12:17:00Z"))
r=DEC(R2b["review_id"],"no_change",note="Back from the hospital")
ck("mistake / nothing changed · recorded, nothing ends", O(r)=="decided" and snap()[1:]==S1[1:], r)

R1b=OPEN(TR("tr_501_b","501","Inactive","Active","2026-10-05T12:17:00Z"))
ck("a change on a client whose care ended still reaches a person (no active Journey to tie it to)", O(R1b)=="opened" and R1b["episode_id"] is None, R1b)
r=DEC(R1b["review_id"],"returning",date=D(-1),staff="owner@cc.test",seat="owner_decision")
eps=s.run("select state from journey_episode where person_id=cast(:p as uuid) order by created_at",p=P[1])
roles=s.run("select status from person_role where person_id=cast(:p as uuid) and role='client' order by id",p=P[1])
ck("returning (Owner / Decision) · a NEW established Journey and a new active client role; the ended one is kept as history",
   O(r)=="decided" and r["journey_opened"] and eps==[["ended"],["established"]] and roles==[["former"],["active"]], (r,eps,roles))
R3=OPEN(TR("tr_503_a","503","Inactive","Active"))
S2=snap(); r=DEC(R3["review_id"],"returning",date=D(-1),staff="owner@cc.test",seat="owner_decision")
ck("returning while a Journey is already active is refused by the Journey rules; nothing saved", O(r)=="refused" and r["detail"]["outcome"]=="conflict" and snap()==S2, r)
R3b=OPEN(TR("tr_503_b","503","Active","Deceased"))
s.run("update person_role set status='former', ended_at=current_date, end_reason='deceased' where person_id=cast(:p as uuid)",p=P[3])
r=DEC(R3b["review_id"],"care_ended",date=D(-1),reason="deceased")
ck("care ended when the role was already ended elsewhere: the Journey still ends, the role is not touched again",
   O(r)=="decided" and r["client_role_ended"] is False and r["journey_ended"]==EP3, r)

res2={}
R4a=OPEN(TR("tr_501_c","501","Active","Inactive","2026-10-09T12:17:00Z"))
def race(k,bar,dec):
    cc=c.conn("service_role")
    try: bar.wait(); res2[k]=O(DEC(R4a["review_id"],dec,note="n",conn=cc))
    except Exception as e: res2[k]="ERROR "+str(e)[:160]
    finally: cc.close()
bar=threading.Barrier(2); ts=[threading.Thread(target=race,args=(k,bar,d)) for k,d in (("a","on_hold"),("b","no_change"))]; [t.start() for t in ts]; [t.join() for t in ts]
ck("concurrency · two people answering at once: one answer stands, the other is told it's done", sorted(res2.values())==["already_decided","decided"], res2)

ck("answer-once · a decided review can't be changed, deleted or truncated; an open one can't be re-pointed",
   all(err_code(f) is not None for f in [lambda: s.run("update client_status_review set decision='on_hold' where status='decided'"),
       lambda: s.run("delete from client_status_review"), lambda: s.run("truncate client_status_review"),
       lambda: s.run("update client_status_review set person_id=cast(:p as uuid) where status='open'",p=P[5])]))
au=c.conn("authenticated"); an=c.conn("anon")
ck("security · signed-in staff read reviews and statuses but cannot answer, open or write; anonymous gets nothing",
   err_code(lambda: au.run("select count(*) from client_status_review")) is None and err_code(lambda: au.run("select count(*) from client_status_current")) is None
   and (err_code(lambda: DEC(R4a["review_id"],"on_hold",note="x",conn=au)) or "").startswith("42501")
   and (err_code(lambda: OPEN(TR("tr_x","501","a","b"),conn=au)) or "").startswith("42501")
   and (err_code(lambda: au.run("insert into client_status_current values ('1','x',now())")) or "").startswith("42501")
   and (err_code(lambda: an.run("select count(*) from client_status_review")) or "").startswith("42501"))
rc,out=c.psql(CS); ck("guard · once a review exists the migration refuses and changes nothing", rc!=0 and "refused" in out, out[-200:])
rc,out=c.psql(CSRB); ck("rollback · refuses once reviews exist", rc!=0 and "refused" in out and has_obj(c,"client_status_review"), out[-200:])
ck("journey · Journey foundation definitions unchanged", journey_fp(c)==JF0)
for x in (svc,au,an): x.close()
c.close()
c,P,s=fixture("csrb"); rc,out=c.psql(CS); rc2,out2=c.psql(CSRB)
ck("rollback · on an unused install removes everything", rc==0 and rc2==0 and not has_obj(c,"client_status_review") and not has_obj(c,"client_status_current"), (out+out2)[-300:])
c.close()
print("\nCHANGE 3 · AXISCARE STATUS REACHES THE HUB · DISPOSABLE PROOF\n"+"="*60)
ok=True
for nm,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+nm+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "%d FAILED"%sum(1 for r in res if not r[1]))
print("client-status migration sha256:", hashlib.sha256(CS.encode()).hexdigest())
