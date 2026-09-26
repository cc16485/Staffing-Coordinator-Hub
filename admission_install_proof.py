import os, json, subprocess, hashlib
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
psrc=open(os.path.join(H,"client_admission_proof.py")).read()
setup_block=psrc[psrc.index("# make the identity fixture match production"):psrc.index("OUT0=outside_fp(c)")]
ADMP=os.path.join(H,"client-admission.sql"); SHA=hashlib.sha256(open(ADMP,"rb").read()).hexdigest()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else note))
c=Cluster("admi"); P=setup_supabase_like(c); s=c.su
exec(setup_block)
def run(mig=ADMP, tag="x"):
    rep=os.path.join(H,f"ai_{tag}.txt")
    env=dict(os.environ,SB_MIGFILE=mig,SB_EXPECTED_SHA=SHA,SB_REPORT=rep,SB_LOCAL_SOCK=c.sock,SB_SKIP_FUNCTION="1")
    p=subprocess.run(["python3",os.path.join(H,"admission_install.py")],env=env,capture_output=True,text=True)
    return p.returncode,(open(rep).read() if os.path.exists(rep) else p.stdout+p.stderr)
bad=os.path.join(H,"adm_tampered.sql"); open(bad,"w").write(open(ADMP).read()+"\n-- x\n")
rc,rep=run(bad,"t"); ck("install · refuses a file that is not the proven migration", rc==2 and "Nothing was run" in rep and not has_obj(c,"client_admission_case"), rep[-300:]); os.remove(bad)
rc,rep=run(tag="1"); ck("install · clean install verifies and creates no person, link, role or Journey row", rc==0 and "INSTALLED" in rep and "✓ no person" in rep, rep[-900:])
rc,rep=run(tag="2"); ck("install · rerun on an empty install succeeds", rc==0, rep[-400:])
os.environ["SB_SKIP_MIGRATION"]="1"; fp_before=s.run("select md5(string_agg(proname||md5(prosrc),',' order by proname)) from pg_proc where proname like 'client\\_admission%' escape '\\'")[0][0]
rc,rep=run(tag="s"); del os.environ["SB_SKIP_MIGRATION"]
ck("scan-only · checks the existing install without rerunning the migration",
   rc==0 and "not rerun" in rep and "INSTALLED" in rep
   and s.run("select md5(string_agg(proname||md5(prosrc),',' order by proname)) from pg_proc where proname like 'client\\_admission%' escape '\\'")[0][0]==fp_before, rep[-500:])
svc=c.conn("service_role")
svc.run("select public.client_admission_open(p_axiscare_client_id=>'AX25', p_observed_label=>'Active', p_observed_at=>now(), p_axiscare_name=>'T', p_axiscare_phones=>'{4175550101}')")
rc,rep=run(tag="3"); ck("install · with a case present the migration refuses, and nothing is repaired", rc==4 and "STOPPED" in rep and "refused" in rep, rep[-400:])
svc.close(); c.close()
for f in os.listdir(H):
    if f.startswith("ai_") and f.endswith(".txt"): os.remove(os.path.join(H,f))
print("\nADMISSION INSTALL SCRIPT · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
