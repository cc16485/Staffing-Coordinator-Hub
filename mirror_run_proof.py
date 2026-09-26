import os, json, subprocess, hashlib, re
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"legacy_mirror_proof.py")).read()
setup=src[:src.index("def put(cs)")]
exec(compile(setup.replace('assert c.psql(MIG)[0]==0; rc,out=c.psql(open(os.path.join(H,"staffing-foundation.sql")).read()); assert rc==0,out',
                           'assert c.psql(MIG)[0]==0; assert c.psql(open(os.path.join(H,"staffing-foundation.sql")).read())[0]==0'),"setup","exec"))
s.run("insert into app_data values ('coverage_cases',:d)",d=json.dumps(cases))
LMP=os.path.join(H,"legacy-mirror.sql"); SHA=hashlib.sha256(open(LMP,"rb").read()).hexdigest()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[-1500:]))
def go(mode,tag):
    rep=os.path.join(H,f"mr_{tag}.txt")
    env=dict(os.environ,SB_MODE=mode,SB_MIGFILE=LMP,SB_EXPECTED_SHA=SHA,SB_PARFILE=os.path.join(H,"legacy-mirror-parity.sql"),SB_REPORT=rep,SB_LOCAL_SOCK=c.sock)
    p=subprocess.run(["python3",os.path.join(H,"mirror_run.py")],env=env,capture_output=True,text=True)
    out=open(rep).read() if os.path.exists(rep) else p.stdout+p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode,out
cnt=lambda: s.run("select count(*) from staffing_need")[0][0]
rc,rep=go("dry","d")
ck("runner · dry run installs the function, lists outcomes by reason, writes no staffing row",
   rc==0 and "DRY RUN COMPLETE" in rep and cnt()==0 and "would_mirror 10" in rep and "several weekdays" in rep, rep)
rc,rep=go("commit","c")
ck("runner · commit mirrors, proves legacy untouched and Journey unchanged, reports parity",
   rc==9 and "MIRRORED WITH ERRORS" in rep and "✓ byte-identical" in rep and "Journey episodes ✓" in rep and "PARITY" in rep and cnt()>0, rep)
n1=cnt(); rc,rep=go("commit","c2")
ck("runner · a second commit is idempotent (no new needs)", cnt()==n1, rep)
svc.close(); c.close()
print("\nMIRROR RUNNER · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
