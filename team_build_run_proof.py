import os, json, subprocess, hashlib
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
TBP=os.path.join(H,"team-build-mirror.sql"); SHA=hashlib.sha256(open(TBP,"rb").read()).hexdigest()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[-1500:]))
c=Cluster("tbr"); P=setup_supabase_like(c); s=c.su
for f in (MIG, open(os.path.join(H,"staffing-foundation.sql")).read(), open(os.path.join(H,"team-build-link.sql")).read()): assert c.psql(f)[0]==0
svc=c.conn("service_role")
E=door(svc,"episode_open_provisional",p_origin_system="lead",p_origin_ref="L1")["episode_id"]
s.run("insert into app_data values ('staffing_plans',:d)",d=json.dumps([{"id":"tb1","days":["mon"],"slots":[{"k":"s1","start":"09:00","end":"13:00"}],"cells":{"mon|s1":{"name":"Ann","status":"yes","by":"K"}}},
                                                                     {"id":"tb2","days":["tue"],"slots":[{"k":"s1","start":"09:00","end":"10:00"}],"cells":{}}]))
s.run("insert into journey_seat_member values ('k@x.test','client_intake')")
svc.run("select public.team_build_link_set('tb1', cast(:e as uuid), 'k@x.test', 'client_intake')",e=E); svc.close()
REP=os.path.join(H,"tbr_report.txt")
def go(step):
    env=dict(os.environ,SB_STEP=step,SB_MIGFILE=TBP,SB_EXPECTED_SHA=SHA,SB_REPORT=REP,SB_LOCAL_SOCK=c.sock)
    p=subprocess.run(["python3",os.path.join(H,"team_build_run.py")],env=env,capture_output=True,text=True)
    return p.returncode,(open(REP).read() if os.path.exists(REP) else p.stdout+p.stderr)
rc,rep=go("dry"); ck("dry · installs, one linked plan would mirror, the unlinked one says so, nothing written",
   rc==0 and "WOULD_OPEN 1" in rep and "not_linked" in rep and s.run("select count(*) from staffing_need")[0][0]==0, rep)
rc,rep=go("commit"); ck("commit · mirrors the linked plan, parity 0, logged run healthy",
   rc==0 and "HEALTH OK" in rep and "0 mismatch" in rep and s.run("select count(*) from staffing_assignment")[0][0]==1, rep)
rc,rep=go("schedule"); ck("schedule · fails cleanly where pg_cron is absent", rc==9 and "could not check" in rep, rep[-300:])
os.remove(REP); c.close()
print("\nTEAM BUILD RUNNER · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
