import os, json, hashlib, threading
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
TL=open(os.path.join(H,"team-build-link.sql")).read()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[:700]))
c=Cluster("tbl"); P=setup_supabase_like(c); s=c.su
assert c.psql(MIG)[0]==0; assert c.psql(open(os.path.join(H,"staffing-foundation.sql")).read())[0]==0
svc=c.conn("service_role")
s.run("insert into person_source_id(person_id,system,entity_type,source_id) values (cast(:p as uuid),'axiscare','client','AX7')",p=P[1])
s.run("update person_identity set display_name='Linda Smith' where id=cast(:p as uuid)",p=P[1])
EC=door(svc,"episode_open_for_person",p_person_id=P[1],p_state="established",p_began_basis="before_observation",p_began_not_after="2026-09-12",p_began_evidence="x",p_prior_history="unobserved",p_prior_evidence="x")["episode_id"]
s.run("update app_data set data=:d where key='leads'",d=json.dumps([{"id":"L1","status":"New","first_name":"Mary","last_name":"Jones","client_first_name":"Ruth","client_last_name":"Jones","created_at":"2026-09-20T15:00:00Z"},
                                                                  {"id":"L2","status":"New","first_name":"Tom","last_name":"Ray"}]))
EL1=door(svc,"episode_open_provisional",p_origin_system="lead",p_origin_ref="L1",p_began_on="2026-09-20")["episode_id"]
EL2=door(svc,"episode_open_provisional",p_origin_system="lead",p_origin_ref="L2")["episode_id"]
EX=door(svc,"episode_open_provisional",p_origin_system="lead",p_origin_ref="L9")["episode_id"]
door(svc,"episode_set_state",p_episode_id=EX,p_state="lost",p_end_basis="documented",p_end_on="2026-09-21",p_end_evidence="x")
s.run("insert into app_data values ('staffing_plans',:d)",d=json.dumps([{"id":"tb1","client":"Ruth J"},{"id":"tb2","client":"someone"}]))
JF0=journey_fp(c)
rc,out=c.psql(TL.replace("do $verify$","select 1/0;\ndo $verify$",1))
ck("install · an injected failure leaves nothing behind", rc!=0 and not has_obj(c,"team_build_link"))
rc,out=c.psql(TL); ck("install · installs; self-check passes", rc==0, out[-300:])
s.run("insert into journey_seat_member(email,seat) values ('intake@cc.test','client_intake'),('owner@cc.test','owner_decision')")
rc,out=c.psql(TL); ck("install · rerun while no links exist succeeds and KEEPS seat membership (routing config)",
   rc==0 and s.run("select count(*) from journey_seat_member")[0][0]==2, out[-200:])
def L(plan,ep,staff="intake@cc.test",seat="client_intake"):
    r=svc.run("select public.team_build_link_set(:p, cast(:e as uuid), :s, :t)",p=plan,e=ep,s=staff,t=seat)[0][0]; return r if isinstance(r,dict) else json.loads(r)
ck("door · refuses an unknown plan, an inactive (lost) Journey, a non-seat, and a blank person",
   L("nope",EL1)["outcome"]=="plan_not_found" and L("tb1",EX)["outcome"]=="episode_not_active"
   and L("tb1",EL1,seat="system")["outcome"]=="invalid_seat" and L("tb1",EL1,staff=" ")["outcome"]=="staff_required")
r1=L("tb1",EL1); r2=L("tb1",EL1)
ck("door · Client Intake makes the first link; repeating it is a no-op", r1["outcome"]=="linked" and r2["outcome"]=="already_linked", (r1,r2))
r3=L("tb1",EC)
ck("door · moving a plan to a different Journey needs Owner / Decision", r3["outcome"]=="seat_required", r3)
r4=L("tb1",EC,staff="owner@cc.test",seat="owner_decision")
cur=s.run("select episode_id::text, linked_by from team_build_link_current where plan_id='tb1'")
ck("door · Owner / Decision re-links; the old link is kept, superseded", r4["outcome"]=="relinked" and cur==[[EC,"owner@cc.test"]]
   and s.run("select count(*) from team_build_link where plan_id='tb1'")[0][0]==2, cur)
svc.run("select public.staffing_need_open(p_episode_id=>cast(:e as uuid),p_kind=>'recurring_slot',p_weekday=>'mon',p_start_time=>'08:00',p_end_time=>'20:00',p_acting_staff=>'m',p_acting_seat=>'legacy_mirror',p_origin_system=>'team_builder',p_origin_ref=>'tb1|mon|day')",e=EC)
r5=L("tb1",EL1,staff="owner@cc.test",seat="owner_decision")
ck("door · once the plan's needs are on its Journey, it cannot be moved, even by Owner / Decision", r5["outcome"]=="has_needs", r5)
# concurrency: two first links at once for plan tb2
out={}
def race(k,ep,bar):
    cc=c.conn("service_role")
    try:
        bar.wait(); v=cc.run("select public.team_build_link_set('tb2', cast(:e as uuid), 'intake@cc.test', 'client_intake')",e=ep)[0][0]
        out[k]=(v if isinstance(v,dict) else json.loads(v))["outcome"]
    finally: cc.close()
bar=threading.Barrier(2); ts=[threading.Thread(target=race,args=(k,ep,bar)) for k,ep in (("a",EL2),("b",EC))]
[t.start() for t in ts]; [t.join() for t in ts]
ck("concurrency · two simultaneous first links: exactly one wins, the other needs Owner / Decision",
   sorted(out.values())==["linked","seat_required"] and s.run("select count(*) from team_build_link_current where plan_id='tb2'")[0][0]==1, out)
au=c.conn("authenticated"); an=c.conn("anon")
dirr={r[0]:r for r in au.run("select episode_id::text, kind, label, detail from journey_directory")}
ck("directory · shows the client by name with AxisCare id, inquiries by the care recipient's name (or the caller's), never a lost one",
   dirr[EC][1:3]==["client","Linda Smith"] and "AxisCare AX7" in dirr[EC][3] and dirr[EL1][2]=="Ruth Jones" and "2026-09-20" in dirr[EL1][3]
   and dirr[EL2][2]=="inquiry from Tom Ray" and EX not in dirr, dirr)
ck("security · signed-in users read links, seats and the directory but cannot link or change seats; anonymous gets nothing",
   err_code(lambda: au.run("select count(*) from team_build_link_current")) is None
   and (err_code(lambda: au.run("select public.team_build_link_set('tb2', cast(:e as uuid), 'x', 'client_intake')",e=EC)) or "").startswith("42501")
   and (err_code(lambda: au.run("insert into journey_seat_member(email,seat) values ('me@x.test','owner_decision')")) or "").startswith("42501")
   and (err_code(lambda: svc.run("insert into journey_seat_member(email,seat) values ('me@x.test','owner_decision')")) or "").startswith("42501")
   and (err_code(lambda: an.run("select count(*) from team_build_link")) or "").startswith("42501"))
ck("append-only · links cannot be edited or deleted", err_code(lambda: svc.run("update team_build_link set linked_by='x'")) is not None
   and err_code(lambda: s.run("delete from team_build_link")) is not None)
rc,out=c.psql(TL); ck("guard · with links present the migration refuses", rc!=0 and "refused" in out)
ck("journey · Journey foundation unchanged", journey_fp(c)==JF0)
for x in (svc,au,an): x.close()
c.close()
print("\nTEAM BUILD LINK · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "%d FAILED"%sum(1 for r in res if not r[1]))
print("link migration sha256:", hashlib.sha256(TL.encode()).hexdigest())
