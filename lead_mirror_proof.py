import os, json, hashlib, datetime as dt
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
LJ=open(os.path.join(H,"lead-journey-mirror.sql")).read()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[:900]))
c=Cluster("ljm"); P=setup_supabase_like(c); s=c.su
assert c.psql(MIG)[0]==0
svc=c.conn("service_role")
base=door(svc,"episode_open_for_person",p_person_id=P[1],p_state="established",p_began_basis="before_observation",p_began_not_after="2026-09-12",p_began_evidence="x",p_prior_history="unobserved",p_prior_evidence="x")["episode_id"]
SNAPB=row_snapshot(svc,base)
leads=[{"id":"L1","status":"New","created_at":"2026-09-20T03:00:00Z"},{"id":"L2","status":"Lost","created_at":"2026-09-10T15:00:00Z"},
       {"id":"L3","status":"Converted","created_at":"2026-09-01T15:00:00Z"},{"id":"L4","status":"New"},
       {"status":"New","created_at":"2026-09-02T15:00:00Z"},{"id":"L6","status":"Assessment scheduled","created_at":"2026-09-14T15:00:00Z"},
       {"id":"L1","status":"New","created_at":"2026-09-20T03:00:00Z"}]
s.run("update app_data set data=:d where key='leads'",d=json.dumps(leads))
md=lambda: s.run("select md5(data::text) from app_data where key='leads'")[0][0]
M0=md(); JF0=journey_fp(c)
cnt=lambda: (s.run("select count(*) from journey_episode")[0][0], s.run("select count(*) from episode_fact")[0][0])
rc,out=c.psql(LJ.replace("do $verify$","select 1/0;\ndo $verify$",1))
ck("install · an injected failure leaves nothing behind", rc!=0 and s.run("select count(*) from pg_proc where proname='lead_journey_mirror'")[0][0]==0)
rc,out=c.psql(LJ); ck("install · installs; self-check passes", rc==0, out[-300:])
rc,out=c.psql(LJ); ck("install · rerun while the run log is empty succeeds", rc==0, out[-200:])
def run(commit): return [tuple(r) for r in svc.run("select * from public.lead_journey_mirror(cast(:c as boolean))",c=commit)]
C0=cnt(); d=run(False); dd={}
for r in d: dd.setdefault(r[0],[]).append(r)
ck("dry run · writes nothing, leads untouched", cnt()==C0 and md()==M0)
ck("dry run · says what it would do (lost lead would close); a lead with no id is skipped",
   dd["L2"][0][1]=="would_open" and "closed as lost" in dd["L2"][0][2] and any(r[1]=="skipped" for r in d), d)
r1=run(True); o={}
for r in r1: o.setdefault(r[0],[]).append(r[1])
ck("commit · opens one provisional episode per lead (a repeated lead id is not duplicated)",
   o["L1"]==["opened","unchanged"] and o["L3"]==["opened"] and o["L4"]==["opened"] and o["L6"]==["opened"] and o["L2"]==["opened_lost"], o)
def ep_of(lid): return s.run("select e.episode_id::text, e.state, e.person_id from episode_source x join journey_episode e using (episode_id) where x.system='lead' and x.source_ref=:l",l=lid)[0]
e1=ep_of("L1"); f1=s.run("select basis, on_date::text from episode_fact where episode_id=cast(:e as uuid) and fact_type='began'",e=e1[0])
ck("inquiry date · documented, in Central time (03:00 UTC on the 20th is the 19th in Springfield)", f1==[["documented","2026-09-19"]], f1)
ck("no date · a lead with no created_at gets no begin fact (unknown, not invented)",
   s.run("select count(*) from episode_fact where episode_id=cast(:e as uuid)",e=ep_of("L4")[0])[0][0]==0)
e2=ep_of("L2"); f2=s.run("select basis, not_before::text, not_after::text from episode_fact where episode_id=cast(:e as uuid) and fact_type='ended'",e=e2[0])
today=s.run("select ((now() at time zone 'America/Chicago')::date)::text")[0][0]
ck("lost · closed as lost with an honest window (inquiry day .. the day the mirror saw it)",
   e2[1]=="lost" and f2==[["observed_window","2026-09-10",today]], (e2,f2))
ck("identity · no person is ever set on a lead's episode",
   s.run("select count(*) from episode_source x join journey_episode e using (episode_id) where x.system='lead' and e.person_id is not null")[0][0]==0)
C1=cnt(); r2=run(True)
ck("idempotent · a second run writes nothing", cnt()==C1 and all(r[1] in ("unchanged","skipped") for r in r2), r2)
ck("converted · stays provisional and says it is waiting for a person to confirm who it is",
   any(r[0]=="L3" and "waiting for a person" in r[2] for r in r2))
par=s.run("select lead_id, state_match, began_match from lead_journey_parity")
ck("parity · every lead with an episode matches its state and inquiry date", all(p[1] is not False and p[2] is not False for p in par), par)
# changes
leads2=[x for x in leads if x.get("id")!="L1"]
for x in leads2:
    if x.get("id")=="L6": x["status"]="Lost"
    if x.get("id")=="L2": x["status"]="Contacted"
s.run("update app_data set data=:d where key='leads'",d=json.dumps(leads2))
M2=md(); r3=run(True); o3={r[0]:(r[1],r[2]) for r in r3}
ck("tracks change · a lead that becomes Lost closes its episode", o3["L6"][0]=="closed_lost" and ep_of("L6")[1]=="lost", o3.get("L6"))
ck("divergence · a lost lead that comes back is reported, not reopened", o3["L2"][0]=="diverged" and ep_of("L2")[1]=="lost", o3.get("L2"))
ck("divergence · a lead deleted from the list is reported; its episode is left alone",
   o3["L1"][0]=="diverged" and "no longer" in o3["L1"][1] and ep_of("L1")[1]=="provisional", o3.get("L1"))
ck("safety · leads data never written; the client baseline episode untouched; Journey definitions unchanged",
   md()==M2 and row_snapshot(svc,base)==SNAPB and journey_fp(c)==JF0, (md()==M2, row_snapshot(svc,base)==SNAPB, journey_fp(c)==JF0))
# run log
def W(t="manual"):
    r=svc.run("select public.lead_journey_mirror_scheduled(:t)",t=t)[0][0]; return r if isinstance(r,dict) else json.loads(r)
w1=W()
ck("run log · honest counts on a quiet run (nothing written, parity mismatch = the returned lead L2)",
   w1["outcome"]=="ok" and w1["episodes_written"]==0 and w1["parity_mismatches"]==1 and w1["leads_unchanged"] is True and w1["diverged"]==2, w1)
hold=c.conn("service_role"); hold.run("begin"); hold.run("select pg_advisory_xact_lock(hashtext('lead_journey_mirror'))")
w2=W("schedule"); hold.run("rollback"); hold.close()
s.run("alter function public.lead_journey_mirror(boolean) rename to lead_journey_mirror_off")
w3=W("schedule"); s.run("alter function public.lead_journey_mirror_off(boolean) rename to lead_journey_mirror")
ck("run log · overlap is skipped and logged; a mirror that cannot run is logged as failed",
   w2["outcome"]=="skipped_busy" and w3["outcome"]=="failed" and "does not exist" in (w3["detail"] or ""), (w2,w3))
au=c.conn("authenticated")
ck("security · office staff can read the run log but not run the mirror; the log is append-only",
   err_code(lambda: au.run("select count(*) from lead_journey_mirror_run")) is None
   and (err_code(lambda: au.run("select * from lead_journey_mirror(false)")) or "").startswith("42501")
   and err_code(lambda: svc.run("update lead_journey_mirror_run set detail='x'")) is not None)
rc,out=c.psql(LJ); ck("guard · with run rows present the migration refuses", rc!=0 and "refused" in out)
for x in (svc,au): x.close()
c.close()
print("\nLEAD JOURNEY MIRROR · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "%d FAILED"%sum(1 for r in res if not r[1]))
print("lead mirror migration sha256:", hashlib.sha256(LJ.encode()).hexdigest())
