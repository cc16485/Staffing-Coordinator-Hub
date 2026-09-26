import os, json, subprocess, hashlib
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_connect_proof.py")).read()
exec(compile(src[:src.index('c,P,s=fixture("jc")')], "defs", "exec"))
ANP=os.path.join(H,"admission-newclients.sql"); SHA=hashlib.sha256(open(ANP,"rb").read()).hexdigest()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[-900:]))
c,P,s=fixture("ani"); assert c.psql(open(os.path.join(H,"journey-connect.sql")).read())[0]==0
svc=c.conn("service_role")
s.run("alter table client_queue add column client_name text")
s.run("insert into client_queue (axiscare_client_id, client_name, status) values ('600','Walk In','pending'),(null,'No Id','pending')")
svc.run("select public.client_admission_open('600','New Clients',now(),'Walk In','{}')")
def go(sha=SHA):
    rep=os.path.join(H,"ani.txt")
    env=dict(os.environ,SB_MIGFILE=ANP,SB_EXPECTED_SHA=sha,SB_REPORT=rep,SB_LOCAL_SOCK=c.sock,SB_SKIP_FUNCTION="1")
    p=subprocess.run(["python3",os.path.join(H,"admission_newclients_install.py")],env=env,capture_output=True,text=True)
    out=open(rep).read() if os.path.exists(rep) else p.stdout+p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode,out
rc,rep=go("0"*64)
ck("install · a migration that is not the proven build stops before anything runs", rc==2 and not has_obj(c,"client_admission_journey"), rep)
rc,rep=go()
ck("install · installs, verifies security, the untouched mirror and unchanged counts, and reports New Clients (read only)",
   rc==0 and "INSTALLED" in rep and "✓ untouched" in rep and "will ask" in rep and "1 admission case(s) waiting" in rep and "✓ no Journey" in rep, rep)
cid=s.run("select case_id::text from client_admission_case where status='open'")[0][0]
svc.run("select public.client_admission_admit(cast(:c as uuid),'new',null,'Walk In','walk-in','kat@cc.test','client_intake',null)",c=cid)
rc,rep=go()
ck("install · a rerun once an admission is recorded stops at the guard and changes nothing",
   rc==4 and "refused" in rep and s.run("select count(*) from client_admission_journey")[0][0]==1, rep)
svc.close(); c.close()
print("\nSTEP 3 INSTALLER · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
