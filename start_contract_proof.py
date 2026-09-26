#!/usr/bin/env python3
# Start Contract · disposable-Postgres proof. Never touches production.
import os, json, hashlib, threading, datetime as dt
from zoneinfo import ZoneInfo
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
SC=open(os.path.join(H,"start-contract.sql")).read()
SCRB=open(os.path.join(H,"start-contract-rollback.sql")).read()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[:700]))
TODAY=dt.datetime.now(ZoneInfo("America/Chicago")).date()
D=lambda k: (TODAY+dt.timedelta(days=k)).isoformat()

c=Cluster("sc"); P=setup_supabase_like(c); s=c.su
assert c.psql(MIG)[0]==0
svc=c.conn("service_role")
EC=door(svc,"episode_open_for_person",p_person_id=P[1],p_state="established",p_began_basis="before_observation",p_began_not_after="2026-09-12",p_began_evidence="x",p_prior_history="unobserved",p_prior_evidence="x")["episode_id"]
E1=door(svc,"episode_open_provisional",p_origin_system="lead",p_origin_ref="L1",p_began_on="2026-09-20")["episode_id"]
E2=door(svc,"episode_open_provisional",p_origin_system="lead",p_origin_ref="L2")["episode_id"]
E3=door(svc,"episode_open_provisional",p_origin_system="lead",p_origin_ref="L3")["episode_id"]
EX=door(svc,"episode_open_provisional",p_origin_system="lead",p_origin_ref="L9")["episode_id"]
door(svc,"episode_set_state",p_episode_id=EX,p_state="lost",p_end_basis="documented",p_end_on="2026-09-21",p_end_evidence="x")
JF0=journey_fp(c)

# ---------------------------------------------------------------- install
rc,out=c.psql(SC.replace("do $verify$","select 1/0;\ndo $verify$",1))
ck("install · an injected failure leaves nothing behind", rc!=0 and not has_obj(c,"start_contract_version") and not has_obj(c,"start_contract_current"), out[-200:])
rc,out=c.psql(SC); ck("install · installs; self-check passes", rc==0, out[-300:])
rc,out=c.psql(SCRB); ck("rollback · on an empty install removes every object", rc==0 and not has_obj(c,"start_contract_version")
   and not has_obj(c,"start_contract_update") and not has_obj(c,"start_contract_door_audit") and not has_obj(c,"start_contract_current"), out[-200:])
rc,out=c.psql(SC); rc2,out2=c.psql(SC)
ck("install · reinstall, and a rerun while empty, both succeed", rc==0 and rc2==0, (out+out2)[-300:])

CALLS=[0]
def REC(ep, conf="likely", target=None, words=None, to=None, via=None, on=None, owner="kat@cc.test", nxt=None, reason=None, staff="kat@cc.test", seat="client_intake", conn=None):
    CALLS[0]+=1
    r=(conn or svc).run("""select public.start_contract_record(cast(:e as uuid), :c, cast(:t as date), :w, :to, :v, cast(:on as date),
                           :o, cast(:n as date), :r, :s, :seat)""", e=ep,c=conf,t=target,w=words,to=to,v=via,on=on,o=owner,n=nxt,r=reason,s=staff,seat=seat)[0][0]
    return r if isinstance(r,dict) else json.loads(r)
def UPD(ep, at=None, to="Cathy (daughter)", via="call", summary="Still on track for the 5th.", nxt=None, none=None, staff="kat@cc.test", seat="client_intake"):
    CALLS[0]+=1
    r=svc.run("""select public.start_contract_update_record(cast(:e as uuid), cast(:a as timestamptz), :to, :v, :s, cast(:n as date), :no, :st, :seat)""",
              e=ep,a=at or dt.datetime.now(dt.timezone.utc).isoformat(),to=to,v=via,s=summary,n=nxt,no=none,st=staff,seat=seat)[0][0]
    return r if isinstance(r,dict) else json.loads(r)
def cur(ep):
    r=s.run("select row_to_json(x)::text from start_contract_current x where episode_id=cast(:e as uuid)",e=ep)
    return json.loads(r[0][0]) if r else None
def n(t): return s.run(f"select count(*) from {t}")[0][0]
O=lambda r: r.get("outcome")

# ---------------------------------------------------------------- refusals
refusals={
 "invalid_seat": REC(E1,nxt=D(3),target=D(10),seat="system"),
 "staff_required": REC(E1,nxt=D(3),target=D(10),staff="  "),
 "episode_not_active": REC(EX,nxt=D(3),target=D(10)),
 "invalid_confidence": REC(E1,conf="sure",nxt=D(3),target=D(10)),
 "target_date_required": REC(E1,conf="likely",nxt=D(3)),
 "owner_required": REC(E1,nxt=D(3),target=D(10),owner=" "),
 "promise_incomplete": REC(E1,nxt=D(3),target=D(10),words="We'll start the 5th"),
 "committed_needs_wording": REC(E1,conf="committed",nxt=D(3),target=D(10)),
 "promised_in_future": REC(E1,nxt=D(3),target=D(10),words="x",to="Cathy",via="call",on=D(1)),
 "next_update_in_past": REC(E1,nxt=D(-1),target=D(10)),
 "next_update_required": REC(E1,target=D(10)),
}
ck("door · refuses a bad seat, no person, an inactive Journey, an unknown confidence, a missing target date, no owner, a half-recorded promise, a commitment with no words, a promise dated in the future, a next update in the past, and a first contract with no next update owed",
   all(O(v)==k for k,v in refusals.items()) and n("start_contract_version")==0 and n("start_contract_update")==0,
   {k:O(v) for k,v in refusals.items()})

# ---------------------------------------------------------------- record / idempotency / next update
r1=REC(E1,conf="early",nxt=D(3))
c1=cur(E1)
ck("record · an Early contract needs no date; it records version 1 and the next update owed",
   O(r1)=="recorded" and c1["confidence"]=="early" and c1["target_date"] is None and c1["versions"]==1
   and c1["next_update_owed_on"]==D(3) and c1["owed_by"]=="kat@cc.test", (r1,c1))
r2=REC(E1,conf="early",nxt=D(3))
ck("record · repeating the same contract is a no-op (a double-click is harmless)",
   O(r2)=="unchanged" and n("start_contract_version")==1 and n("start_contract_update")==1, r2)
r3=REC(E1,conf="early",nxt=D(5))
ck("record · changing only the next update owed adds no contract version",
   O(r3)=="next_update_set" and cur(E1)["versions"]==1 and cur(E1)["next_update_owed_on"]==D(5), r3)
r4=REC(E1,conf="likely",target=D(14))
c4=cur(E1)
ck("record · a change supersedes the last version and keeps it; the next update owed carries over",
   O(r4)=="changed" and c4["versions"]==2 and c4["confidence"]=="likely" and c4["target_date"]==D(14)
   and c4["next_update_owed_on"]==D(5), (r4,c4))
W="Expect to begin October 5, contingent on authorization and staffing."
r5=REC(E1,conf="committed",target=D(14),words=W,to="Cathy (daughter)",via="call",on=D(0),owner="kat@cc.test")
r6=REC(E1,conf="committed",target=D(16),words=W,to="Cathy (daughter)",via="call",on=D(0))
r7=REC(E1,conf="committed",target=D(16),words=W,to="Cathy (daughter)",via="call",on=D(0),reason="Authorization came back for the 7th")
c7=cur(E1)
ck("record · changing a commitment already made to the family needs a reason; with one, it records and keeps every earlier version",
   O(r5)=="changed" and O(r6)=="reason_required" and O(r7)=="changed" and c7["versions"]==4
   and c7["promised_wording"]==W and c7["change_reason"]=="Authorization came back for the 7th", (r5,r6,r7))
chain=s.run("""with recursive ch as (select version_id, supersedes_version_id, 1 d from start_contract_version
                 where episode_id=cast(:e as uuid) and supersedes_version_id is null
               union all select v.version_id, v.supersedes_version_id, ch.d+1 from start_contract_version v join ch on v.supersedes_version_id=ch.version_id)
               select max(d), count(*) from ch""",e=E1)[0]
ck("history · the versions form one unbroken chain from the first to the current", chain==[4,4], chain)

# ---------------------------------------------------------------- family updates
u0=UPD(E2,nxt=D(2))
ck("update · refused before a contract exists", O(u0)=="no_contract", u0)
uA=UPD(E1,summary=" ",nxt=D(2)); uB=UPD(E1,nxt=D(2),none="started"); uC=UPD(E1)
uD=UPD(E1,nxt=D(-2)); uE=UPD(E1,at=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=2)).isoformat(),nxt=D(2))
ck("update · refuses a blank summary, both or neither of next-date/none-owed, a next update in the past, an update dated in the future",
   [O(uA),O(uB),O(uC),O(uD),O(uE)]==["update_incomplete","next_update_required","next_update_required","next_update_in_past","given_in_future"],
   [O(uA),O(uB),O(uC),O(uD),O(uE)])
AT=dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
u1=UPD(E1,at=AT,nxt=D(7)); u2=UPD(E1,at=AT,nxt=D(7))
c8=cur(E1)
ck("update · logs what we told the family and the next update owed (owed by the commitment owner); a repeat is a no-op",
   O(u1)=="update_logged" and O(u2)=="unchanged" and c8["last_update_to"]=="Cathy (daughter)"
   and c8["last_update_summary"]=="Still on track for the 5th." and c8["next_update_owed_on"]==D(7) and c8["owed_by"]=="kat@cc.test"
   and c8["versions"]==4, (u1,u2,c8))
u3=UPD(E1,summary="Care started today.",none="Care has started")
c9=cur(E1)
ck("update · a final update can say nothing more is owed, and why",
   O(u3)=="update_logged" and c9["next_update_owed_on"] is None and c9["none_owed_reason"]=="Care has started", (u3,c9))
r8=REC(E1,conf="committed",target=D(16),words=W,to="Cathy (daughter)",via="call",on=D(0),reason="x",nxt=D(9))
ck("record · a later contract call can schedule a new next update after 'none owed'",
   O(r8)=="next_update_set" and cur(E1)["next_update_owed_on"]==D(9) and cur(E1)["versions"]==4, r8)

# ---------------------------------------------------------------- client Journey, owner seat
r9=REC(EC,conf="expected",target=D(20),nxt=D(1),staff="owner@cc.test",seat="owner_decision",owner="owner@cc.test")
ck("record · works on a current client's Journey and from the Owner / Decision seat, recording who and which seat",
   O(r9)=="recorded" and s.run("select recorded_by, recorded_seat from start_contract_version where episode_id=cast(:e as uuid)",e=EC)==[["owner@cc.test","owner_decision"]], r9)

# ---------------------------------------------------------------- concurrency
out={}
def race(k,bar):
    cc=c.conn("service_role")
    try:
        bar.wait(); out[k]=O(REC(E3,conf="likely",target=D(12),nxt=D(2),conn=cc))
    except Exception as e: out[k]="ERROR "+str(e)[:120]
    finally: cc.close()
bar=threading.Barrier(2); ts=[threading.Thread(target=race,args=(k,bar)) for k in "ab"]
[t.start() for t in ts]; [t.join() for t in ts]
ck("concurrency · two identical first contracts at once: one records, the other is a no-op, one root",
   sorted(out.values())==["recorded","unchanged"] and s.run("select count(*) from start_contract_version where episode_id=cast(:e as uuid)",e=E3)[0][0]==1, out)
out={}
def race2(k,conf,bar):
    cc=c.conn("service_role")
    try:
        bar.wait(); out[k]=O(REC(E2,conf=conf,target=D(12),nxt=D(2),conn=cc))
    except Exception as e: out[k]="ERROR "+str(e)[:120]
    finally: cc.close()
bar=threading.Barrier(2); ts=[threading.Thread(target=race2,args=(k,cf,bar)) for k,cf in (("a","likely"),("b","expected"))]
[t.start() for t in ts]; [t.join() for t in ts]
ck("concurrency · two different first contracts at once serialize into one chain (recorded, then changed), never two roots",
   sorted(out.values())==["changed","recorded"] and s.run("select count(*) from start_contract_version where episode_id=cast(:e as uuid) and supersedes_version_id is null",e=E2)[0][0]==1, out)

# ---------------------------------------------------------------- audit, append-only, security
ck("audit · every Door call is recorded, refusals included", n("start_contract_door_audit")==CALLS[0], (n("start_contract_door_audit"),CALLS[0]))
ck("append-only · versions, updates and the audit cannot be edited, deleted or truncated (even by the service role or the owner)",
   all(err_code(f) is not None for f in [
     lambda: s.run("update start_contract_version set confidence='early'"), lambda: s.run("delete from start_contract_version"),
     lambda: s.run("truncate start_contract_version cascade"), lambda: s.run("update start_contract_update set summary='x'"),
     lambda: s.run("delete from start_contract_update"), lambda: s.run("truncate start_contract_update"),
     lambda: s.run("delete from start_contract_door_audit"), lambda: svc.run("update start_contract_version set confidence='early'")]))
au=c.conn("authenticated"); an=c.conn("anon")
ck("security · signed-in staff read contracts and updates but cannot write them, call the Doors, or read the audit; anonymous gets nothing",
   err_code(lambda: au.run("select count(*) from start_contract_current")) is None
   and err_code(lambda: au.run("select count(*) from start_contract_version")) is None
   and (err_code(lambda: au.run("insert into start_contract_version(episode_id,confidence,commitment_owner,recorded_by,recorded_seat) values (cast(:e as uuid),'early','x','x','client_intake')",e=E1)) or "").startswith("42501")
   and (err_code(lambda: REC(E1,conf="early",nxt=D(3),conn=au)) or "").startswith("42501")
   and (err_code(lambda: au.run("select count(*) from start_contract_door_audit")) or "").startswith("42501")
   and (err_code(lambda: an.run("select count(*) from start_contract_current")) or "").startswith("42501")
   and (err_code(lambda: an.run("select count(*) from start_contract_version")) or "").startswith("42501"))

# ---------------------------------------------------------------- guard, rollback, Journey untouched
rc,out=c.psql(SC); ck("guard · with contracts present the migration refuses and changes nothing", rc!=0 and "refused" in out and cur(E1)["versions"]==4, out[-200:])
rc,out=c.psql(SCRB); ck("rollback · refuses once any contract exists", rc!=0 and "refused" in out and has_obj(c,"start_contract_version"), out[-200:])
ck("journey · the Journey foundation is unchanged by every step above", journey_fp(c)==JF0)
for x in (svc,au,an): x.close()
c.close()
print("\nSTART CONTRACT · DISPOSABLE PROOF\n"+"="*60)
ok=True
for nm,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+nm+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "%d FAILED"%sum(1 for r in res if not r[1]))
print("start contract migration sha256:", hashlib.sha256(SC.encode()).hexdigest())
