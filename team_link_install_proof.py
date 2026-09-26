import os, json, subprocess, hashlib
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
TLP=os.path.join(H,"team-build-link.sql"); SHA=hashlib.sha256(open(TLP,"rb").read()).hexdigest()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[-900:]))
c=Cluster("tli"); P=setup_supabase_like(c); assert c.psql(MIG)[0]==0 and c.psql(open(os.path.join(H,"staffing-foundation.sql")).read())[0]==0
def go(intake,owner,mig=TLP):
    rep=os.path.join(H,"tli.txt")
    env=dict(os.environ,SB_MIGFILE=mig,SB_EXPECTED_SHA=SHA,SB_REPORT=rep,SB_LOCAL_SOCK=c.sock,SB_SKIP_FUNCTION="1",SB_INTAKE=intake,SB_OWNER=owner)
    p=subprocess.run(["python3",os.path.join(H,"team_link_install.py")],env=env,capture_output=True,text=True)
    out=open(rep).read() if os.path.exists(rep) else p.stdout+p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode,out
rc,rep=go("","")
ck("install · refuses with no seat holders given", rc==2 and not has_obj(c,"team_build_link"), rep)
rc,rep=go("kat@example.com, not-an-email","")
ck("install · refuses a malformed email (nothing run)", rc==2 and not has_obj(c,"team_build_link"), rep)
rc,rep=go("Kat@example.com, cierra@example.com","owner@example.com")
seats=c.su.run("select email, seat from journey_seat_member order by 1,2")
ck("install · installs, records seat holders exactly as given (lower-cased), browser cannot link, nothing else changed",
   rc==0 and "INSTALLED" in rep and seats==[["cierra@example.com","client_intake"],["kat@example.com","client_intake"],["owner@example.com","owner_decision"]], (seats,rep))
rc,rep=go("kat@example.com","owner@example.com")
ck("install · rerun keeps seat holders and does not duplicate them", rc==0 and c.su.run("select count(*) from journey_seat_member")[0][0]==3, rep)
c.close()
print("\nTEAM LINK INSTALLER · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
