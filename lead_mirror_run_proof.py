import os, json, subprocess, hashlib
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
LJP=os.path.join(H,"lead-journey-mirror.sql"); SHA=hashlib.sha256(open(LJP,"rb").read()).hexdigest()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[-1500:]))
c=Cluster("ljr"); P=setup_supabase_like(c); s=c.su; assert c.psql(MIG)[0]==0
leads=[{"id":"L1","status":"New","created_at":"2026-09-20T03:00:00Z"},{"id":"L2","status":"Lost","created_at":"2026-09-10T15:00:00Z"},
       {"id":"L3","status":"Converted","created_at":"2026-09-01T15:00:00Z"},{"id":"L4","status":"New"}]
s.run("update app_data set data=:d where key='leads'",d=json.dumps(leads))
REP=os.path.join(H,"lmr_report.txt")
def go(step):
    env=dict(os.environ,SB_STEP=step,SB_MIGFILE=LJP,SB_EXPECTED_SHA=SHA,SB_REPORT=REP,SB_LOCAL_SOCK=c.sock)
    p=subprocess.run(["python3",os.path.join(H,"lead_mirror_run.py")],env=env,capture_output=True,text=True)
    return p.returncode,(open(REP).read() if os.path.exists(REP) else p.stdout+p.stderr)
n0=s.run("select count(*) from journey_episode")[0][0]
rc,rep=go("dry"); ck("dry · installs, shows would-open for each lead, writes nothing",
   rc==0 and "WOULD_OPEN 4" in rep and s.run("select count(*) from journey_episode")[0][0]==n0, rep)
rc,rep=go("commit"); ck("commit · opens 4 provisional episodes, no person resolved, parity 0, logged run healthy",
   rc==0 and "HEALTH OK" in rep and s.run("select count(*) from journey_episode")[0][0]==n0+4 and "no person resolved" in rep and "0 mismatch" in rep, rep)
rc,rep=go("schedule"); ck("schedule · fails cleanly where pg_cron is absent", rc==9 and "could not check" in rep, rep[-400:])
os.remove(REP); c.close()
print("\nLEAD MIRROR RUNNER · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
