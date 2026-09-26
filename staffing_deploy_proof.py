import os, json, subprocess, copy
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
SFP=os.path.join(H,"staffing-foundation.sql"); EXPF=os.path.join(H,"staffing-expected.json"); EXPD=json.load(open(EXPF))
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else note))
def fresh(tag):
    c=Cluster(tag); P=setup_supabase_like(c); c.psql("begin;\n"+PHASEA+"\ncommit;\n"); assert c.psql(MIG)[0]==0
    sv=c.conn("service_role")
    for i in (1,2,3):
        door(sv,"episode_open_for_person",p_person_id=P[i],p_state="established",p_began_basis="before_observation",
             p_began_not_after="2026-09-12",p_began_evidence="x",p_prior_history="unobserved",p_prior_evidence="x")
    sv.close(); return c
def run(c, mig=SFP, exp=EXPF, tag="x"):
    rep=os.path.join(H,f"sd_{tag}.txt")
    env=dict(os.environ,SB_MIGFILE=mig,SB_EXPECTED=exp,SB_FPFILE=os.path.join(H,"staffing-foundation-fingerprint.sql"),
             SB_PARTSFILE=os.path.join(H,"staffing-foundation-parts.sql"),SB_JFPFILE=os.path.join(H,"journey-foundation-v2-fingerprint.sql"),
             SB_REPORT=rep,SB_LOCAL_SOCK=c.sock)
    p=subprocess.run(["python3",os.path.join(H,"staffing_deploy.py")],env=env,capture_output=True,text=True)
    out=open(rep).read() if os.path.exists(rep) else p.stdout+p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode,out
c=fresh("sd1"); eps=c.su.run("select count(*) from journey_episode")[0][0]
rc,rep=run(c,tag="1")
ck("deploy · clean run: every verification line passes, fingerprint identical, Journey and its rows unchanged",
   rc==0 and "DEPLOYED AND VERIFIED" in rep and "✓ identical to the proven build" in rep and "Journey foundation ✓" in rep
   and c.su.run("select count(*) from journey_episode")[0][0]==eps, rep[-1800:])
svc=c.conn("service_role"); e=c.su.run("select episode_id::text from journey_episode limit 1")[0][0]
svc.run("select public.staffing_need_open(p_episode_id=>cast(:e as uuid),p_kind=>'dated_shift',p_shift_date=>'2026-10-05',p_start_time=>'09:00',p_end_time=>'10:00',p_acting_staff=>'x',p_acting_seat=>'client_intake')",e=e)
svc.close(); fp=c.su.run(open(os.path.join(H,"staffing-foundation-fingerprint.sql")).read())[0][0]
rc,rep=run(c,tag="2")
ck("deploy · with staffing rows present the guard stops it; nothing repaired; objects unchanged",
   rc==4 and "STOPPED" in rep and "refused" in rep and "UNCHANGED" in rep
   and c.su.run(open(os.path.join(H,"staffing-foundation-fingerprint.sql")).read())[0][0]==fp, rep[-600:])
c.close()
c=fresh("sd3"); bad=os.path.join(H,"sf_tampered.sql"); open(bad,"w").write(open(SFP).read()+"\n-- x\n")
rc,rep=run(c,mig=bad,tag="3"); os.remove(bad)
ck("deploy · a different migration file is refused before anything runs", rc==2 and not has_obj(c,"staffing_need"), rep[-400:])
e5=copy.deepcopy(EXPD); i=next(k for k,p in enumerate(e5["parts"]) if p.startswith("function|staffing_assign("))
f=e5["parts"][i].split("|"); f[2]="0"*32; e5["parts"][i]="|".join(f); e5["fingerprint"]="different"
f5=os.path.join(H,"sexp_bad.json"); json.dump(e5,open(f5,"w"))
rc,rep=run(c,exp=f5,tag="4"); os.remove(f5)
ck("deploy · a substantive difference (a Door's source) fails verification", rc==5 and "SUBSTANTIVE" in rep, rep[-900:])
c.close()
print("\nSTAFFING DEPLOY SCRIPT · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
