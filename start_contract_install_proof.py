import os, json, subprocess, hashlib, datetime as dt
from zoneinfo import ZoneInfo
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
SCP=os.path.join(H,"start-contract.sql"); SHA=hashlib.sha256(open(SCP,"rb").read()).hexdigest()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[-900:]))
c=Cluster("sci"); P=setup_supabase_like(c)
assert c.psql(MIG)[0]==0 and c.psql(open(os.path.join(H,"staffing-foundation.sql")).read())[0]==0 and c.psql(open(os.path.join(H,"team-build-link.sql")).read())[0]==0
c.su.run("insert into journey_seat_member(email,seat) values ('kat@cc.test','client_intake')")
svc=c.conn("service_role")
E=door(svc,"episode_open_provisional",p_origin_system="lead",p_origin_ref="L1")["episode_id"]
def go(sha=SHA):
    rep=os.path.join(H,"sci.txt")
    env=dict(os.environ,SB_MIGFILE=SCP,SB_EXPECTED_SHA=sha,SB_REPORT=rep,SB_LOCAL_SOCK=c.sock,SB_SKIP_FUNCTION="1")
    p=subprocess.run(["python3",os.path.join(H,"start_contract_install.py")],env=env,capture_output=True,text=True)
    out=open(rep).read() if os.path.exists(rep) else p.stdout+p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode,out
rc,rep=go("0"*64)
ck("install · a migration that is not the proven build stops before anything runs", rc==2 and not has_obj(c,"start_contract_version"), rep)
rc,rep=go()
ck("install · installs, verifies security and unchanged Journey counts, names who can record", rc==0 and "INSTALLED" in rep and "kat@cc.test" in rep
   and "✓ signed-in staff can read" in rep and "✓ no Journey" in rep, rep)
today=dt.datetime.now(ZoneInfo("America/Chicago")).date().isoformat()
svc.run("select public.start_contract_record(cast(:e as uuid),'early',null,null,null,null,null,'kat@cc.test',cast(:d as date),null,'kat@cc.test','client_intake')",e=E,d=today)
rc,rep=go()
ck("install · a rerun once a contract exists stops at the guard and changes nothing",
   rc==4 and "refused" in rep and c.su.run("select count(*) from start_contract_version")[0][0]==1, rep)
svc.close(); c.close()
print("\nSTART CONTRACT INSTALLER · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
