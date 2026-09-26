import os, json, subprocess, hashlib
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_connect_proof.py")).read()
exec(compile(src[:src.index('c,P,s=fixture("jc")')], "defs", "exec"))
JCP=os.path.join(H,"journey-connect.sql"); SHA=hashlib.sha256(open(JCP,"rb").read()).hexdigest()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[-900:]))
c,P,s=fixture("jci"); svc=c.conn("service_role")
s.run("update app_data set data=:d where key='leads'",d=json.dumps([{"id":"L1","status":"New","client_first_name":"Ruth","client_last_name":"Jones","created_at":"2026-09-10T15:00:00Z","axiscare_client_id":"50"},
    {"id":"L2","status":"New","created_at":"2026-09-11T15:00:00Z"},{"id":"L3","status":"New","axiscare_client_id":"60"}]))
svc.run("select count(*) from public.lead_journey_mirror(true)")
def go(sha=SHA):
    rep=os.path.join(H,"jci.txt")
    env=dict(os.environ,SB_MIGFILE=JCP,SB_EXPECTED_SHA=sha,SB_REPORT=rep,SB_LOCAL_SOCK=c.sock,SB_SKIP_FUNCTION="1")
    p=subprocess.run(["python3",os.path.join(H,"journey_connect_install.py")],env=env,capture_output=True,text=True)
    out=open(rep).read() if os.path.exists(rep) else p.stdout+p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode,out
rc,rep=go("0"*64)
ck("install · a migration that is not the proven build stops before anything runs", rc==2 and not has_obj(c,"lead_journey_connection"), rep)
rc,rep=go()
ck("install · installs, verifies security, the mirror rule and unchanged counts, and reports existing leads with ids (read only)",
   rc==0 and "INSTALLED" in rep and "✓ a Lost lead no longer closes" in rep and "2 with an id · 2 can be checked" in rep and "✓ no Journey" in rep, rep)
svc.run("select public.lead_journey_connect('L1','50','Ruth Jones','typed','kat@cc.test','client_intake')")
rc,rep=go()
ck("install · a rerun once a connection exists stops at the guard and changes nothing",
   rc==4 and "refused" in rep and s.run("select count(*) from lead_journey_connection")[0][0]==1, rep)
svc.close(); c.close()
print("\nSTEP 2 INSTALLER · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
