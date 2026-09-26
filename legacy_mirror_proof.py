import os, json, hashlib
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
LM=open(os.path.join(H,"legacy-mirror.sql")).read(); PAR=open(os.path.join(H,"legacy-mirror-parity.sql")).read()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[:900]))
c=Cluster("lm"); P=setup_supabase_like(c); s=c.su
assert c.psql(MIG)[0]==0; rc,out=c.psql(open(os.path.join(H,"staffing-foundation.sql")).read()); assert rc==0,out
svc=c.conn("service_role")
def link(p,ax): s.run("insert into person_source_id(person_id,system,entity_type,source_id) values (cast(:p as uuid),'axiscare','client',:a)",p=P[p],a=ax)
for i,ax in ((1,'AX1'),(2,'AX2'),(3,'AX3'),(4,'AX4')): link(i,ax)
def ep(pid): return door(svc,"episode_open_for_person",p_person_id=pid,p_state="established",p_began_basis="before_observation",p_began_not_after="2026-09-12",p_began_evidence="x",p_prior_history="unobserved",p_prior_evidence="x")["episode_id"]
E={i:ep(P[i]) for i in (1,2,3,4)}
door(svc,"episode_set_state",p_episode_id=E[4],p_state="ended",p_end_basis="documented",p_end_on="2026-10-01",p_end_evidence="x")
T="2026-10-01T15:00:00Z"
cases=[
 {"id":"cw_c1","client_axiscare_id":"AX1","shift_date":"2026-10-05","shift_time":"09:00-13:00","axiscare_visit_id":"s=1:d=2026-10-05","status":"done","resolved_how":"covered","covered_by":"Ann Lee","opened_at":"2026-10-01T14:00:00Z",
  "asked":[{"id":"ask_1","name":"Ann Lee","auto":True,"state":"closed_notified","was_yes":True,"replied_at":T,"reply":"Yes I can","at":T,"axiscare_id":"CG1"},
           {"id":"ask_2","name":"Bob Roe","auto":True,"state":"closed_silent","replied_at":T,"reply":"no sorry","at":T},
           {"id":"ask_3","name":"Cal Poe","auto":True,"state":"closed_silent","at":T}],
  "axiscare_assignment":{"status":"verified","caregiver_id":"CG1","visit_id":"s=1:d=2026-10-05","verified":True}},
 {"id":"id_c2","client_axiscare_id":"AX2","shift_date":"2026-10-06","shift_time":"10:00-14:00","axiscare_visit_id":"s=2:d=2026-10-06","status":"open","opened_at":"2026-10-01T14:01:00Z",
  "asked":[{"id":"id_a1","name":"Dee Fox","channel":"text","state":"waiting","at":T},{"id":"id_a2","name":"Eve Hart","channel":"call","state":"inquiry","reply":"which client?","replied_at":T,"at":T}]},
 {"id":"cwf_c3","status":"flagged","client_axiscare_id":"AX1","shift_time":"09:00-10:00","shift_date":"2026-10-07"},
 {"id":"id_c4","kind":"interest","reason":"new","status":"open"},
 {"id":"cph_c5","status":"open","shift_date":"2026-10-07","shift_time":"09:00-10:00"},
 {"id":"id_c6","client_axiscare_id":"AX9","shift_date":"2026-10-07","shift_time":"09:00-10:00","status":"open"},
 {"id":"id_c7","client_axiscare_id":"AX4","shift_date":"2026-10-07","shift_time":"09:00-10:00","status":"open"},
 {"id":"d_c8","client_axiscare_id":"AX2","shift_date":"2026-10-07","shift_time":"9am","status":"open"},
 {"id":"cwo_s9","client_axiscare_id":"AX3","shift_time":"19:00-21:00","status":"open","shift_pattern":{"kind":"open_ongoing","weekday":"Monday"},"opened_at":"2026-10-01T14:02:00Z"},
 {"id":"cwo_s10","client_axiscare_id":"AX3","shift_time":"08:00-09:00","status":"open","shift_pattern":{"kind":"open_ongoing","weekday":"Monday/Wednesday"}},
 {"id":"cw_c11","client_axiscare_id":"AX1","shift_date":"2026-10-05","shift_time":"09:00-13:00","axiscare_visit_id":"s=1:d=2026-10-05","status":"open","opened_at":"2026-10-01T14:03:00Z"},
 {"id":"id_c12","client_axiscare_id":"AX2","shift_date":"2026-10-08","shift_time":"08:00-12:00","status":"dismissed","opened_at":"2026-10-01T14:04:00Z"},
 {"id":"cw_c13","client_axiscare_id":"AX3","shift_date":"2026-10-09","shift_time":"08:00-12:00","status":"resolved","resolved_how":"uncovered","opened_at":"2026-10-01T14:05:00Z"},
 {"id":"id_c14","client_axiscare_id":"AX3","shift_date":"2026-10-10","shift_time":"08:00-12:00","status":"open","opened_at":"2026-10-01T14:06:00Z",
  "asked":[{"id":"id_r1","name":"Fay Gil","channel":"text","state":"noanswer","at":T},{"id":"id_r2","name":"Fay Gil","channel":"text","state":"waiting","at":T}]},
 {"id":"cph_c16","client_axiscare_id":"AX2","shift_date":"2026-10-06","shift_time":"10:00-14:00","axiscare_visit_id":"s=2:d=2026-10-06","status":"open","opened_at":"2026-10-01T14:08:00Z"},
 {"id":"cw_c17","client_axiscare_id":"AX3","shift_date":"2026-10-12","shift_time":"08:00-10:00","axiscare_visit_id":"s=17:d=2026-10-12","status":"open","shift_pattern":{"kind":"open_ongoing","weekday":"Monday"},"opened_at":"2026-10-01T14:09:00Z"},
 {"id":"id_c15","client_axiscare_id":"AX2","shift_date":"2026-10-11","shift_time":"08:00-12:00","status":"open","opened_at":"2026-10-01T14:07:00Z",
  "asked":[{"id":"id_bad","name":"Gus","channel":"text","state":"waiting","at":"not-a-date"}]},
]
def put(cs): s.run("update app_data set data=:d where key='coverage_cases'",d=json.dumps(cs)) if s.run("select count(*) from app_data where key='coverage_cases'")[0][0] else s.run("insert into app_data values ('coverage_cases',:d)",d=json.dumps(cs))
put(cases)
legacy_md5=lambda: s.run("select md5(data::text) from app_data where key='coverage_cases'")[0][0]
counts=lambda: tuple(s.run(f"select count(*) from {t}")[0][0] for t in ("staffing_need","staffing_ask","staffing_reply","staffing_assignment","staffing_assignment_sync"))
L0=legacy_md5(); JF0=journey_fp(c)
rc,out=c.psql(LM.replace("do $verify$","select 1/0;\ndo $verify$",1))
ck("install · an injected failure leaves no mirror function", rc!=0 and s.run("select count(*) from pg_proc where proname='legacy_mirror_coverage'")[0][0]==0)
rc,out=c.psql(LM); ck("install · mirror function installs; runs with caller privileges; browser cannot run it", rc==0
   and (err_code(lambda: c.conn("authenticated").run("select * from legacy_mirror_coverage(false)")) or "").startswith("42501"), out[-300:])
def run(commit): return {r[0]:(r[1],r[2]) for r in svc.run("select * from public.legacy_mirror_coverage(cast(:c as boolean))",c=commit)}
dry=run(False)
ck("dry run · writes nothing and leaves legacy byte-identical", counts()==(0,0,0,0,0) and legacy_md5()==L0)
exp_un={"id_c4":"interest","cph_c5":"no AxisCare client id","id_c6":"not linked","id_c7":"no active Journey","d_c8":"not HH:MM","cwo_s10":"several weekdays"}
ck("dry run · every exclusion carries its reason; the flag is skipped",
   dry["cwf_c3"][0]=="skipped" and all(dry[k][0]=="unmapped" and v in dry[k][1] for k,v in exp_un.items()), dry)
ck("dry run · mappable cases say what they would do",
   all(dry[k][0]=="would_mirror" for k in ("cw_c1","id_c2","cwo_s9","id_c12","cw_c13","id_c14","cw_c11","cph_c16","cw_c17")), dry)
r1=run(True)
ck("commit · mirrors the mappable cases; a second OPEN case for the same visit is left unmapped naming the reason",
   all(r1[k][0]=="mirrored" for k in ("cw_c1","id_c2","cwo_s9","id_c12","cw_c13","id_c14")) and r1["cph_c16"][0]=="unmapped" and "already backs" in r1["cph_c16"][1], r1)
ck("commit · a new call-off for a visit whose earlier need was covered and closed is a legitimate new need",
   r1["cw_c11"][0]=="mirrored" and s.run("select count(*) from staffing_need where axiscare_visit_ref='s=1:d=2026-10-05'")[0][0]==2, r1.get("cw_c11"))
ck("commit · a malformed record fails ONLY its own case (rolled back) and is reported",
   r1["id_c15"][0]=="error" and s.run("select count(*) from staffing_need where origin_ref='id_c15'")[0][0]==0, r1.get("id_c15"))
ck("commit · legacy data is never written", legacy_md5()==L0)
n1=s.run("select need_id::text from staffing_need where origin_ref='cw_c1'")[0][0]
cur=dict((r[0],r[1]) for r in s.run("select caregiver_name, current_reply from staffing_ask_current where need_id=cast(:n as uuid)",n=n1))
ck("call-off c1 · closed as covered; overwritten answers kept honest (yes from was_yes, 'unclear' not guessed, no reply = none)",
   s.run("select state, closed_reason from staffing_need where need_id=cast(:n as uuid)",n=n1)[0]==["closed","covered"]
   and cur=={"Ann Lee":"yes","Bob Roe":"unclear","Cal Poe":None}, cur)
asg=s.run("select caregiver_name, decided_seat, basis_reply_id is not null from staffing_assignment where need_id=cast(:n as uuid) and state='active'",n=n1)
ck("call-off c1 · the legacy covered_by becomes a legacy_mirror assignment based on Ann's yes, with its AxisCare sync fact",
   asg==[["Ann Lee","legacy_mirror",True]] and s.run("select status, verified from staffing_assignment_sync")[0]==["verified",True], asg)
ck("legacy asks carry 'text not retained' honestly (never invented)",
   s.run("select count(*) from staffing_ask where message_status<>'not_retained_legacy' or message_text is not null")[0][0]==0)
n2=s.run("select need_id::text from staffing_need where origin_ref='id_c2'")[0][0]
ck("open case c2 · derived ASKED (Dee waiting) and Eve's question recorded verbatim",
   s.run("select status from staffing_need_status where need_id=cast(:n as uuid)",n=n2)[0][0]=="asked"
   and s.run("select current_reply_text from staffing_ask_current where caregiver_name='Eve Hart'")[0][0]=="which client?")
ck("closures · dismissed -> cancelled; uncovered -> shift_passed; ongoing single weekday -> recurring Monday need",
   s.run("select closed_reason from staffing_need where origin_ref='id_c12'")[0][0]=="cancelled"
   and s.run("select closed_reason from staffing_need where origin_ref='cw_c13'")[0][0]=="shift_passed"
   and s.run("select kind, weekday from staffing_need where origin_ref='cwo_s9'")[0]==["recurring_slot","mon"])
ck("grain · a visit case whose schedule pattern is 'open ongoing' still becomes a DATED need with its visit",
   s.run("select kind, shift_date::text, axiscare_visit_ref from staffing_need where origin_ref='cw_c17'")[0]==["dated_shift","2026-10-12","s=17:d=2026-10-12"])
ck("repeat ask · a second ask to the same caregiver is noted, not duplicated", "repeat ask to Fay Gil" in r1["id_c14"][1], r1["id_c14"])
C1=counts(); r2=run(True)
ck("idempotent · a second run with no legacy change writes nothing", counts()==C1 and all(v[0]!="error" or k=="id_c15" for k,v in r2.items()), (C1,counts()))
# legacy changes
cs=json.loads(s.run("select data::text from app_data where key='coverage_cases'")[0][0])
for x in cs:
    if x["id"]=="id_c2":
        x["asked"][0].update(state="yes",reply="Yes!",replied_at="2026-10-01T16:00:00Z"); x["asked"][1].update(state="no",reply="actually no",replied_at="2026-10-01T16:05:00Z")
put(cs); run(True)
st2=s.run("select status, yes_unassigned from staffing_need_status where need_id=cast(:n as uuid)",n=n2)[0]
eve=s.run("select count(*) from staffing_reply r join staffing_ask a using (ask_id) where a.caregiver_name='Eve Hart'")[0][0]
ck("tracks change · Dee's new YES is recorded (yes pending, NOT assigned); Eve's answer supersedes, original kept",
   st2==["yes_pending",1] and eve==2 and s.run("select count(*) from staffing_assignment where need_id=cast(:n as uuid)",n=n2)[0][0]==0, st2)
for x in cs:
    if x["id"]=="id_c2": x.update(status="done",resolved_how="covered",covered_by="Dee Fox")
    if x["id"]=="cw_c1": x.update(covered_by="Bob Roe")
    if x["id"]=="id_c12": x.update(status="open")
put(cs); r3=run(True)
ck("tracks change · legacy coverage of c2 closes the need and records Dee's assignment on her yes",
   s.run("select state from staffing_need where need_id=cast(:n as uuid)",n=n2)[0][0]=="closed"
   and s.run("select caregiver_name, basis_reply_id is not null from staffing_assignment where need_id=cast(:n as uuid) and state='active'",n=n2)==[["Dee Fox",True]])
ck("tracks change · a changed covered_by releases the old decision (kept) and records the new one",
   s.run("select caregiver_name from staffing_assignment where need_id=cast(:n as uuid) and state='active'",n=n1)==[["Bob Roe"]]
   and s.run("select count(*) from staffing_assignment where need_id=cast(:n as uuid) and state='released'",n=n1)[0][0]==1)
ck("divergence · a legacy case reopened after its need closed is reported, not forced", r3["id_c12"][0]=="diverged", r3.get("id_c12"))
par=s.run(PAR); cols=["case_id","legacy_status","canonical","status_match","asks_match","yes_match","asked_match","covered_match","asks"]
P_={r[0]:dict(zip(cols,r)) for r in par}
mism=[k for k,v in P_.items() if v["canonical"]!="not mirrored" and False in (v["status_match"],v["asks_match"],v["yes_match"],v["asked_match"],v["covered_match"])]
ck("parity · mirrored cases agree with legacy except the ones the report explains (reopened c12, repeat ask c14)",
   sorted(mism)==["id_c12","id_c14"], {k:P_[k] for k in mism})
ck("parity · every legacy case appears (mirrored or 'not mirrored')", len(P_)==len(cases))
ck("journey · Journey foundation fingerprint unchanged", journey_fp(c)==JF0)
svc.close(); c.close()
print("\nLEGACY MIRROR · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "%d FAILED"%sum(1 for r in res if not r[1]))
print("mirror migration sha256:", hashlib.sha256(LM.encode()).hexdigest())
