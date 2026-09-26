import os, json, hashlib, copy
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
TBM=open(os.path.join(H,"team-build-mirror.sql")).read()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[:900]))
c=Cluster("tbm"); P=setup_supabase_like(c); s=c.su
for f in (MIG, open(os.path.join(H,"staffing-foundation.sql")).read(), open(os.path.join(H,"team-build-link.sql")).read()):
    rc,out=c.psql(f); assert rc==0, out
svc=c.conn("service_role")
EL=door(svc,"episode_open_provisional",p_origin_system="lead",p_origin_ref="L1",p_began_on="2026-09-20")["episode_id"]
EL2=door(svc,"episode_open_provisional",p_origin_system="lead",p_origin_ref="L2")["episode_id"]
plan={"id":"tb_1","client":"Ruth","level":"2","days":["mon","tue"],"status":"building","created_at":"2026-09-20T15:00:00Z",
      "slots":[{"k":"day","label":"Day","start":"08:00","end":"20:00"},{"k":"night","label":"Night","start":"20:00","end":"08:00"}],
      "cells":{"mon|day":{"name":"Ann Lee","status":"yes","at":"2026-09-21T15:00:00Z","by":"Krystal"},
               "tue|day":{"name":"Bob Roe","status":"asked","at":"2026-09-21T15:01:00Z","by":"Krystal"},
               "mon|night":{"name":"Cal Poe","status":"no","at":"2026-09-21T15:02:00Z","by":"Angiel"},
               "tue|night":{"name":"Dee Fox","status":"penciled","at":"2026-09-21T15:03:00Z","by":"Angiel"}}}
other={"id":"tb2","client":"not linked","days":["mon"],"slots":[{"k":"s1","start":"09:00","end":"10:00"}],"cells":{}}
def put(plans): s.run("delete from app_data where key='staffing_plans'"); s.run("insert into app_data values ('staffing_plans',:d)",d=json.dumps(plans))
put([plan,other])
s.run("insert into journey_seat_member values ('k@x.test','client_intake')")
svc.run("select public.team_build_link_set('tb_1', cast(:e as uuid), 'k@x.test', 'client_intake')",e=EL)
JF0=journey_fp(c)
rc,out=c.psql(TBM.replace("do $verify$","select 1/0;\ndo $verify$",1))
ck("install · an injected failure leaves nothing behind", rc!=0 and s.run("select count(*) from pg_proc where proname='team_build_mirror'")[0][0]==0)
rc,out=c.psql(TBM); ck("install · installs; self-check passes", rc==0, out[-300:])
rc,out=c.psql(TBM); ck("install · rerun while the run log is empty succeeds", rc==0, out[-200:])
def run(commit): return {r[0]:(r[1],r[2]) for r in svc.run("select * from public.team_build_mirror(cast(:c as boolean))",c=commit)}
md=lambda: s.run("select md5(data::text) from app_data where key='staffing_plans'")[0][0]
M0=md(); d=run(False)
ck("dry run · writes nothing; linked plan would mirror; an unlinked plan says to link it",
   s.run("select count(*) from staffing_need")[0][0]==0 and d["tb_1"][0]=="would_mirror" and d["tb2"][0]=="not_linked" and md()==M0, d)
r1=run(True)
needs=s.run("select weekday, start_time::text, end_time::text, min_care_level, state, episode_id::text from staffing_need where origin_system='team_builder' order by 1,2")
ck("commit · one recurring need per day × shift on the linked Journey (inquiry episode), level carried",
   r1["tb_1"][0]=="mirrored" and len(needs)==4 and all(n[4]=="open" and n[5]==EL and n[3]==2 for n in needs), (r1,needs))
asg=s.run("select caregiver_name, decided_by, decided_seat from staffing_assignment where state='active'")
ck("commit · 'confirmed' becomes an assignment decided by the staff member on the cell", asg==[["Ann Lee","Krystal","legacy_mirror"]], asg)
asks=dict(s.run("select caregiver_name, coalesce(current_reply,'-') from staffing_ask_current"))
ck("commit · 'asked' becomes an open ask; 'declined' an ask with a NO; 'penciled' nothing",
   asks=={"Bob Roe":"-","Cal Poe":"no"} , asks)
ck("commit · statuses derive correctly (filled / asked / exhausted / needs ask)",
   sorted(r[0] for r in s.run("select status from staffing_need_status"))==sorted(["filled","asked","exhausted","needs_ask"]))
C1=[s.run(f"select count(*) from {t}")[0][0] for t in ("staffing_need","staffing_ask","staffing_reply","staffing_assignment")]
run(True)
ck("idempotent · a second run writes nothing", [s.run(f"select count(*) from {t}")[0][0] for t in ("staffing_need","staffing_ask","staffing_reply","staffing_assignment")]==C1)
par=s.run("select needs_match, assigned_match from team_build_parity where plan_id='tb_1'")[0]
ck("parity · needs and confirmed seats agree with the plan", par==[True,True], par)
# edits: day shift time changes; Bob declines; Ann replaced by Eve; night shift removed
p2=copy.deepcopy(plan); p2["slots"][0]["start"]="07:00"
p2["cells"]["tue|day"]["status"]="no"; p2["cells"]["mon|day"].update(name="Eve Hart",at="2026-09-22T15:00:00Z")
p2["slots"]=[p2["slots"][0]]; [p2["cells"].pop(k) for k in ("mon|night","tue|night")]
put([p2,other]); r2=run(True)
day=s.run("select state, closed_reason, start_time::text from staffing_need where origin_ref like 'tb\\_1|%|day|%' escape '\\' order by created_at")
ck("edit · a changed shift time supersedes the old need (kept) with a new 07:00 need",
   [x for x in day if x[0]=="closed"] and all(x[1]=="superseded" for x in day if x[0]=="closed") and sorted(x[2] for x in day if x[0]=="open")==["07:00:00","07:00:00"], day)
ck("edit · a removed shift cancels its needs",
   sorted(set(r[0] for r in s.run("select closed_reason from staffing_need where origin_ref like 'tb\\_1|%|night|%' escape '\\'")))==["cancelled"])
active=[r[0] for r in s.run("select caregiver_name from staffing_assignment a join staffing_need n using (need_id) where a.state='active' and n.state='open'")]
ck("edit · the replacement confirmation is assigned on the new need; the earlier one is kept, not deleted",
   active==["Eve Hart"] and s.run("select count(*) from staffing_assignment where caregiver_name='Ann Lee'")[0][0]==1, active)
bob=s.run("select c.current_reply from staffing_ask_current c join staffing_need n using (need_id) where c.caregiver_name='Bob Roe' and n.state='open'")
ck("edit · Bob's decline is recorded as a NO on the new need's ask", bob==[["no"]], bob)
ck("parity · still agrees after the edits", s.run("select needs_match, assigned_match from team_build_parity where plan_id='tb_1'")[0]==[True,True])
p3=copy.deepcopy(p2); p3["status"]="done"; put([p3,other]); M3=md(); run(True)
ck("complete · a completed plan closes its open needs as covered",
   s.run("select count(*) from staffing_need where origin_system='team_builder' and state='open'")[0][0]==0
   and s.run("select count(*) from staffing_need where origin_system='team_builder' and closed_reason='covered'")[0][0]==2)
# relink refused now that needs exist
rl=svc.run("select public.team_build_link_set('tb_1', cast(:e as uuid), 'owner@x', 'owner_decision')",e=EL2)[0][0]
ck("link · the plan can no longer move to another Journey", (rl if isinstance(rl,dict) else json.loads(rl))["outcome"]=="has_needs")
ck("safety · plans data never written by the mirror; Journey definitions unchanged", md()==M3 and journey_fp(c)==JF0, (md()==M3, journey_fp(c)==JF0))
def W(t="manual"):
    r=svc.run("select public.team_build_mirror_scheduled(:t)",t=t)[0][0]; return r if isinstance(r,dict) else json.loads(r)
w=W()
ck("run log · honest counts on a quiet run", w["outcome"]=="ok" and w["needs_written"]==0 and w["not_linked"]==1 and w["plans_unchanged"] is True, w)
hold=c.conn("service_role"); hold.run("begin"); hold.run("select pg_advisory_xact_lock(hashtext('team_build_mirror'))")
w2=W("schedule"); hold.run("rollback"); hold.close()
ck("run log · overlap skipped and logged", w2["outcome"]=="skipped_busy")
au=c.conn("authenticated")
ck("security · browser cannot run the mirror; run log readable, append-only",
   (err_code(lambda: au.run("select * from team_build_mirror(false)")) or "").startswith("42501")
   and err_code(lambda: au.run("select count(*) from team_build_mirror_run")) is None
   and err_code(lambda: svc.run("update team_build_mirror_run set detail='x'")) is not None)
rc,out=c.psql(TBM); ck("guard · with run rows present the migration refuses", rc!=0 and "refused" in out)
for x in (svc,au): x.close()
c.close()
print("\nTEAM BUILD MIRROR · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "%d FAILED"%sum(1 for r in res if not r[1]))
print("team build mirror sha256:", hashlib.sha256(TBM.encode()).hexdigest())
