#!/usr/bin/env python3
# 908 · a Care Coordinator can answer "Returning client" (Samantha 2026-10-17, SOP 30) · disposable-Postgres proof.
# Runs every client-status + 5b returning proof first (client_status_returning_proof.py), then installs
# client-status-returning-cc.sql over it and proves the one change. Never touches production.
import os, hashlib
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"client_status_returning_proof.py")).read()
exec(compile(src[:src.index("svc.close(); c.close()")], "returning_proof", "exec"))
CC=open(os.path.join(H,"client-status-returning-cc.sql")).read()
base=len(res)
prosrc=lambda: s.run("select prosrc from pg_proc where proname='client_status_decide'")[0][0]

rc,out=c.psql(CC.replace("do $verify$","select 1/0;\ndo $verify$",1))
ck("908 · an injected failure leaves the owner-only function in place", rc!=0 and "Owner / Decision matter" in prosrc(), out[-200:])
rc,out=c.psql(CC); rc2,out2=c.psql(CC)
ck("908 · installs over the live function, reruns, self-check passes", rc==0 and rc2==0 and "Owner / Decision matter" not in prosrc(), (out+out2)[-300:])
priv=s.run("select has_function_privilege('authenticated','public.client_status_decide(uuid,text,date,text,text,text,text)','execute'), has_function_privilege('anon','public.client_status_decide(uuid,text,date,text,text,text,text)','execute'), (select prosecdef from pg_proc where proname='client_status_decide')")[0]
ck("908 · same privileges: not callable by anon or signed-in browsers, not definer", list(priv)==[False,False,False], priv)
Rc=OPEN(TR("tr_601_c","601","Active","Active3"))
r=DEC(Rc["review_id"],"returning",date=D(-1),staff="kat@cc.test",seat="client_intake")
row=s.run("select status, decided_seat, decided_by from client_status_review where review_id=cast(:r as uuid)",r=Rc["review_id"])[0]
ck("908 · a Care Coordinator (Client Intake) answers Returning client: decided, recorded with their seat and name", O(r)=="decided" and list(row)==["decided","client_intake","kat@cc.test"], (r,row))
Rb=OPEN(TR("tr_602_c","602","Active","Active4"))
bad=[DEC(Rb["review_id"],"returning",date=D(-1),seat="system"),DEC(Rb["review_id"],"returning",date=D(-1),staff=" "),DEC(Rb["review_id"],"returning",seat="client_intake")]
ck("908 · still refused: a bad seat, no person, no date", [O(x) for x in bad]==["invalid_seat","staff_required","date_required"], bad)
rc,out=c.psql(RET)
ck("908 · rollback: client-status-returning.sql puts the owner-only rule back", rc==0 and O(DEC(Rb["review_id"],"returning",date=D(-1)))=="seat_required", out[-200:])

svc.close(); c.close()
print("\n908 · RETURNING CLIENT FROM A CARE COORDINATOR · DISPOSABLE PROOF\n"+"="*60)
ok=True
for nm,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+nm+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS (%d new)"%(len(res),len(res)-base)) if ok else "%d FAILED"%sum(1 for r in res if not r[1]))
print("client-status-returning-cc sha256:", hashlib.sha256(CC.encode()).hexdigest())
