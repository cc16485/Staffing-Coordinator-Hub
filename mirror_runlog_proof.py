import os, json, hashlib, threading, time
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"legacy_mirror_proof.py")).read()
setup=src[:src.index("def put(cs)")]
exec(compile(setup.replace('assert c.psql(MIG)[0]==0; rc,out=c.psql(open(os.path.join(H,"staffing-foundation.sql")).read()); assert rc==0,out',
                           'assert c.psql(MIG)[0]==0; assert c.psql(open(os.path.join(H,"staffing-foundation.sql")).read())[0]==0'),"setup","exec"))
s.run("insert into app_data values ('coverage_cases',:d)",d=json.dumps(cases))
assert c.psql(LM)[0]==0
JF0=journey_fp(c)
RL=open(os.path.join(H,"legacy-mirror-runlog.sql")).read()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[:900]))
rc,out=c.psql(RL.replace("do $verify$","select 1/0;\ndo $verify$",1))
ck("install · an injected failure leaves nothing behind", rc!=0 and not has_obj(c,"legacy_mirror_run"))
rc,out=c.psql(RL); ck("install · run log, parity view and wrapper install; self-check passes", rc==0, out[-300:])
rc,out=c.psql(RL); ck("install · rerun while the log is empty succeeds", rc==0, out[-200:])
def W(trig="manual"):
    r=svc.run("select public.legacy_mirror_scheduled(:t)",t=trig)[0][0]; return r if isinstance(r,dict) else json.loads(r)
r1=W()
ck("run 1 · honest counts: every case seen; mirrored / unmapped / skipped / errors recorded; rows written; legacy untouched",
   r1["cases_seen"]==len(cases) and r1["mirrored"]>0 and r1["unmapped"]>0 and r1["skipped"]==1 and r1["errors"]==1
   and r1["outcome"]=="errors" and r1["needs_written"]>0 and r1["legacy_unchanged"] is True and "id_c15" in (r1["detail"] or ""), r1)
ck("run 1 · parity measured every run (the repeat-ask case is the one known difference)", r1["parity_mismatches"]==1 and r1["not_mirrored"]>0, r1)
r2=W("schedule")
ck("run 2 · no legacy change: nothing written", r2["needs_written"]==0 and r2["asks_written"]==0 and r2["replies_written"]==0 and r2["assignments_written"]==0, r2)
cs=json.loads(s.run("select data::text from app_data where key='coverage_cases'")[0][0])
for x in cs:
    if x["id"]=="id_c2": x["asked"][0].update(state="yes",reply="Yes!",replied_at="2026-10-01T16:00:00Z")
s.run("update app_data set data=:d where key='coverage_cases'",d=json.dumps(cs))
r3=W("schedule"); ck("run 3 · a legacy change shows up as exactly the rows it caused", r3["replies_written"]==1 and r3["needs_written"]==0, r3)
# overlap
hold=c.conn("service_role"); hold.run("begin"); hold.run("select pg_advisory_xact_lock(hashtext('legacy_mirror_coverage'))")
r4=W("schedule"); hold.run("rollback"); hold.close()
ck("overlap · a run that finds another in progress records skipped_busy and does nothing else", r4["outcome"]=="skipped_busy" and r4["cases_seen"] is None, r4)
# total failure
s.run("alter function public.legacy_mirror_coverage(boolean) rename to legacy_mirror_coverage_off")
r5=W("schedule"); s.run("alter function public.legacy_mirror_coverage_off(boolean) rename to legacy_mirror_coverage")
ck("failure · a mirror that cannot run still leaves a 'failed' row saying why (a dead mirror never looks healthy)",
   r5["outcome"]=="failed" and "does not exist" in (r5["detail"] or ""), r5)
ck("log · one row per attempt, in order", s.run("select string_agg(outcome, ',' order by run_id) from legacy_mirror_run")[0][0]=="errors,errors,errors,skipped_busy,failed")
au=c.conn("authenticated"); an=c.conn("anon")
ck("security · office staff can read the run log but not write it or run the mirror; anonymous gets nothing; log is append-only",
   err_code(lambda: au.run("select count(*) from legacy_mirror_run")) is None
   and (err_code(lambda: au.run("insert into legacy_mirror_run(started_at,trigger_source,outcome) values (now(),'manual','ok')")) or "").startswith("42501")
   and (err_code(lambda: au.run("select public.legacy_mirror_scheduled('manual')")) or "").startswith("42501")
   and (err_code(lambda: an.run("select count(*) from legacy_mirror_run")) or "").startswith("42501")
   and err_code(lambda: svc.run("update legacy_mirror_run set detail='x'")) is not None
   and err_code(lambda: s.run("delete from legacy_mirror_run")) is not None)
rc,out=c.psql(RL); ck("guard · with run rows present the migration refuses and changes nothing", rc!=0 and "refused" in out
   and s.run("select count(*) from legacy_mirror_run")[0][0]==5)
ck("journey · Journey foundation unchanged", journey_fp(c)==JF0)
for x in (svc,au,an): x.close()
c.close()
print("\nMIRROR RUN LOG · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "%d FAILED"%sum(1 for r in res if not r[1]))
print("runlog migration sha256:", hashlib.sha256(RL.encode()).hexdigest())
