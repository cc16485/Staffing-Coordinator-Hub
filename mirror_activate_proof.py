import os, json, subprocess, hashlib
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"legacy_mirror_proof.py")).read()
setup=src[:src.index("def put(cs)")]
exec(compile(setup.replace('assert c.psql(MIG)[0]==0; rc,out=c.psql(open(os.path.join(H,"staffing-foundation.sql")).read()); assert rc==0,out',
                           'assert c.psql(MIG)[0]==0; assert c.psql(open(os.path.join(H,"staffing-foundation.sql")).read())[0]==0'),"setup","exec"))
RLP=os.path.join(H,"legacy-mirror-runlog.sql"); SHA=hashlib.sha256(open(RLP,"rb").read()).hexdigest()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[-1200:]))
def go(step,tag):
    rep=os.path.join(H,f"ma_{tag}.txt")
    env=dict(os.environ,SB_STEP=step,SB_MIGFILE=RLP,SB_EXPECTED_SHA=SHA,SB_REPORT=rep,SB_LOCAL_SOCK=c.sock)
    p=subprocess.run(["python3",os.path.join(H,"mirror_activate.py")],env=env,capture_output=True,text=True)
    out=open(rep).read() if os.path.exists(rep) else p.stdout+p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode,out
clean=[x for x in cases if x["id"] not in ("id_c15","id_c14")]
s.run("insert into app_data values ('coverage_cases',:d)",d=json.dumps(clean))
assert c.psql(LM)[0]==0
svc.run("select * from public.legacy_mirror_coverage(true)")   # production state: already mirrored by 227
rc,rep=go("install","1")
ck("activate · on an already-mirrored healthy shadow: installs, logs a run that wrote nothing, reports HEALTH OK",
   rc==0 and "HEALTH OK" in rep and "needs_written          0" in rep and "parity_mismatches      0" in rep, rep)
rc,rep=go("schedule","2")
ck("activate · scheduling step fails cleanly where pg_cron is absent (nothing half-made)", rc==7 and "could not check" in rep, rep)
c.close()
c2=Cluster("ma2"); P2=setup_supabase_like(c2)
assert c2.psql(MIG)[0]==0 and c2.psql(open(os.path.join(H,"staffing-foundation.sql")).read())[0]==0 and c2.psql(LM)[0]==0
c2.su.run("insert into person_source_id(person_id,system,entity_type,source_id) values (cast(:p as uuid),'axiscare','client','AX2')",p=P2[2])
sv2=c2.conn("service_role"); door(sv2,"episode_open_for_person",p_person_id=P2[2],p_state="established",p_began_basis="before_observation",p_began_not_after="2026-09-12",p_began_evidence="x",p_prior_history="unobserved",p_prior_evidence="x"); sv2.close()
c2.su.run("insert into app_data values ('coverage_cases',:d)",d=json.dumps([x for x in cases if x["id"]=="id_c15"]))
c=c2
rc,rep=go("install","3")
ck("activate · an erroring shadow reports NOT_OK and the script will not offer scheduling", rc==6 and "HEALTH NOT_OK" in rep, rep)
c2.close()
print("\nMIRROR ACTIVATION · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
