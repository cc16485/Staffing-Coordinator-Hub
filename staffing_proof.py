#!/usr/bin/env python3
# Stage 3 staffing foundation · disposable-Postgres proof. Never touches production.
import os, json, threading, hashlib
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
SF_PATH=os.path.join(H,"staffing-foundation.sql"); SF=open(SF_PATH).read()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[:700]))
c=Cluster("stf"); P=setup_supabase_like(c); s=c.su
rc,out=c.psql(MIG); assert rc==0, out
svc=c.conn("service_role")
def ep(pid):
    return door(svc,"episode_open_for_person",p_person_id=pid,p_state="established",p_began_basis="before_observation",
                p_began_not_after="2026-09-12",p_began_evidence="x",p_prior_history="unobserved",p_prior_evidence="x")["episode_id"]
E1,E2,E3=ep(P[1]),ep(P[2]),ep(P[3])
Eend=ep(P[4]); door(svc,"episode_set_state",p_episode_id=Eend,p_state="ended",p_end_basis="documented",p_end_on="2026-10-01",p_end_evidence="x")

STAFF_OBJ=["staffing_need","staffing_ask","staffing_reply","staffing_assignment","staffing_assignment_sync","staffing_door_audit",
           "staffing_ask_current","staffing_need_status"]
def outside_nonstaff():
    tabs=[r[0] for r in s.run("select table_name from information_schema.tables where table_schema='public' and table_name <> all(:j) order by 1",
                              j=JOURNEY_TABLES+JOURNEY_VIEWS+STAFF_OBJ)]
    parts=[]
    for tb in tabs:
        cols=s.run("select string_agg(column_name||':'||data_type||':'||coalesce(column_default,''), ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name=:t",t=tb)[0][0]
        data=s.run(f'select md5(coalesce(string_agg(x::text, \'|\' order by x::text), \'\')) from public."{tb}" x')[0][0]
        parts.append(f"{tb}|{cols}|{data}")
    fns=s.run("select string_agg(p.oid::regprocedure::text||':'||md5(p.prosrc), ',' order by 1) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname not like 'episode\\_%' escape '\\' and p.proname not like 'journey\\_%' escape '\\' and p.proname not like 'staffing\\_%' escape '\\'")[0][0]
    return hashlib.md5(("\n".join(parts)+"\n"+(fns or "")).encode()).hexdigest()
OUT0=outside_nonstaff(); JF0=journey_fp(c)
def sfp():
    return s.run("""select md5(coalesce(string_agg(x,',' order by x),'')) from (
       select p.proname||md5(p.prosrc) x from pg_proc p where p.proname like 'staffing\\_%' escape '\\'
       union all select table_name||column_name||data_type from information_schema.columns where table_name like 'staffing\\_%' escape '\\'
       union all select indexdef from pg_indexes where tablename like 'staffing\\_%' escape '\\') q""")[0][0]
# --- migration --------------------------------------------------------------------------
rc,out=c.psql(SF.replace("do $verify$","select 1/0;\ndo $verify$",1))
ck("migration · an injected failure leaves no staffing object and the Journey untouched",
   rc!=0 and not has_obj(c,"staffing_need") and journey_fp(c)==JF0, out[-200:])
rc,out=c.psql(SF); ck("migration · installs, self-check passes", rc==0, out[-400:])
F1=sfp(); rc,out=c.psql(SF)
ck("migration · rerun on an empty install is identical", rc==0 and sfp()==F1, out[-200:])
ck("migration · Journey foundation fingerprint unchanged; nothing outside Journey/staffing changed", journey_fp(c)==JF0 and outside_nonstaff()==OUT0, (journey_fp(c)==JF0, outside_nonstaff()==OUT0))

UUIDK={"p_episode_id","p_need_id","p_ask_id","p_reply_id","p_assignment_id","p_supersedes_need_id","p_caregiver_person_id","p_basis_reply_id","p_supersedes_reply_id"}
TIMEK={"p_start_time":"time","p_end_time":"time","p_shift_date":"date","p_sent_at":"timestamptz","p_received_at":"timestamptz","p_capacity":"int","p_seat_no":"int","p_min_care_level":"smallint","p_verified":"boolean","p_availability_proposal":"jsonb"}
def S(fn,conn=None,**kw):
    conn=conn or svc; a=[]
    for k in kw:
        if k in UUIDK: a.append(f"{k} => cast(:{k} as uuid)")
        elif k in TIMEK: a.append(f"{k} => cast(:{k} as {TIMEK[k]})")
        else: a.append(f"{k} => :{k}")
    r=conn.run(f"select public.{fn}({', '.join(a)})",**kw)[0][0]; return r if isinstance(r,dict) else json.loads(r)
ST=dict(p_acting_staff="Intake staff",p_acting_seat="client_intake")
def need(e,**kw):
    base=dict(p_episode_id=e,p_kind="dated_shift",p_shift_date="2026-10-05",p_start_time="09:00",p_end_time="13:00"); base.update(kw); base.update({k:v for k,v in ST.items() if k not in kw})
    return S("staffing_need_open",**base)
def ask(n,name,**kw):
    base=dict(p_need_id=n,p_caregiver_name=name,p_channel="sms",p_message_status="exact",p_message_text=f"Hi {name}, can you cover Mon 9-1?",
              p_sent_at="2026-10-01T15:00:00Z",p_sender="hub"); base.update(kw); base.update({k:v for k,v in ST.items() if k not in kw})
    return S("staffing_ask_record",**base)
def reply(a,cls,text="ok",**kw):
    base=dict(p_ask_id=a,p_raw_text=text,p_received_at="2026-10-01T15:05:00Z",p_channel="sms",p_classification=cls,p_classified_by="staff"); base.update(kw); base.update({k:v for k,v in ST.items() if k not in kw})
    return S("staffing_reply_record",**base)
def status(n): return s.run("select status, seats_filled, open_asks, yes_unassigned from staffing_need_status where need_id=cast(:n as uuid)",n=n)[0]
# --- needs --------------------------------------------------------------------------------------
r=need(E1,p_axiscare_visit_ref="s=101:d=2026-10-05"); N1=r.get("need_id")
ck("need · opens on an active episode", r.get("outcome")=="opened", r)
ck("need · refused on an ended episode and on an unknown one",
   need(Eend).get("outcome")=="episode_not_active" and need("00000000-0000-0000-0000-000000000000").get("outcome")=="episode_not_active")
ck("need · shape enforced: dated needs a date, recurring a weekday; capacity ≥ 1; visit ref format",
   need(E1,p_shift_date=None).get("outcome")=="invalid" and need(E1,p_kind="recurring_slot").get("outcome")=="invalid"
   and need(E1,p_capacity=0).get("outcome")=="invalid" and need(E1,p_axiscare_visit_ref="101").get("outcome")=="invalid")
r=need(E2,p_axiscare_visit_ref="s=101:d=2026-10-05")
ck("need · one open need per AxisCare visit (conflict names the existing need)", r.get("outcome")=="conflict" and r.get("need_id")==N1, r)
e=err_code(lambda: svc.run("update staffing_need set start_time='10:00' where need_id=cast(:n as uuid)",n=N1))
ck("need · the requirement can never be edited in place", e is not None and "never changes" in e, e)
r1=need(E3,p_origin_system="coverage_case",p_origin_ref="cw_101_g1"); r2=need(E3,p_origin_system="coverage_case",p_origin_ref="cw_101_g1")
ck("need · a source record maps to one need (idempotent)", r2.get("outcome")=="already_recorded" and r2.get("need_id")==r1.get("need_id"))
# --- asks ----------------------------------------------------------------------------------------
r=ask(N1,"Ann",p_message_text=None)
ck("ask · a texted ask must carry its exact text", r.get("outcome")=="invalid", r)
ck("ask · 'verbal' only for calls/in person; 'not retained' only for the legacy mirror",
   ask(N1,"Ann",p_message_status="verbal",p_message_text=None).get("outcome")=="invalid"
   and ask(N1,"Ann",p_message_status="not_retained_legacy",p_message_text=None).get("outcome")=="invalid"
   and ask(N1,"Bea",p_channel="call",p_message_status="verbal",p_message_text=None).get("outcome")=="recorded")
rA=ask(N1,"Ann",p_caregiver_axiscare_id="CG1"); A1=rA.get("ask_id")
ck("ask · recorded with exact text; need shows ASKED (derived from open asks)", rA.get("outcome")=="recorded" and status(N1)[0]=="asked" and status(N1)[2]==2, status(N1))
ck("ask · the same caregiver cannot have two open asks for one need", ask(N1,"Ann",p_caregiver_axiscare_id="CG1").get("outcome")=="already_asked")
e=err_code(lambda: svc.run("update staffing_ask set message_text='edited' where ask_id=cast(:a as uuid)",a=A1))
ck("ask · what was sent can never be edited", e is not None, e)
# --- replies / yes != assigned ---------------------------------------------------------------------
rY=reply(A1,"yes","Yes I can do it!"); Y1=rY.get("reply_id")
st=status(N1); na=s.run("select count(*) from staffing_assignment where need_id=cast(:n as uuid)",n=N1)[0][0]
ck("reply · a YES is recorded verbatim and does NOT assign (status yes_pending, 0 assignments)",
   rY.get("outcome")=="recorded" and st[0]=="yes_pending" and na==0, st)
rR=reply(A1,"question","Wait, which client?",p_supersedes_reply_id=Y1)
cur=s.run("select current_reply, current_reply_text from staffing_ask_current where ask_id=cast(:a as uuid)",a=A1)[0]
both=s.run("select count(*) from staffing_reply where ask_id=cast(:a as uuid)",a=A1)[0][0]
ck("reply · a reclassification supersedes; the original is kept", rR.get("outcome")=="recorded" and cur==["question","Wait, which client?"] and both==2, cur)
ck("reply · a reply can be superseded only once", reply(A1,"no","x",p_supersedes_reply_id=Y1).get("outcome") in ("invalid_supersede","conflict"))
ck("reply · replies are append-only", err_code(lambda: svc.run("update staffing_reply set raw_text='x'")) is not None)
Y2=reply(A1,"yes","Yes, Mrs. Smith, I can do it",p_supersedes_reply_id=rR["reply_id"])["reply_id"]
# --- assignment ----------------------------------------------------------------------------------------
ck("assign · refused for the system seat (an assignment is a human decision)",
   S("staffing_assign",p_need_id=N1,p_caregiver_name="Ann",p_acting_staff="engine",p_acting_seat="system").get("outcome")=="invalid_seat")
rB=ask(N1,"Cal"); rN=reply(rB["ask_id"],"no","can't")
ck("assign · the basis must be a YES for this need",
   S("staffing_assign",p_need_id=N1,p_caregiver_name="Cal",p_basis_reply_id=rN["reply_id"],**ST).get("outcome")=="invalid_basis")
rS=S("staffing_assign",p_need_id=N1,p_caregiver_name="Ann",p_caregiver_axiscare_id="CG1",p_basis_reply_id=Y2,**ST)
ck("assign · a human decision fills seat 1; need shows FILLED", rS.get("outcome")=="assigned" and rS.get("seat_no")==1 and status(N1)[0]=="filled", status(N1))
ck("assign · a full need refuses another assignment", S("staffing_assign",p_need_id=N1,p_caregiver_name="Dee",**ST).get("outcome")=="capacity_full")
# two-person transfer
N2=need(E2,p_kind="recurring_slot",p_weekday="mon",p_shift_date=None,p_start_time="19:00",p_end_time="19:30",p_capacity=2,p_note="2-person transfer")["need_id"]
a1=S("staffing_assign",p_need_id=N2,p_caregiver_name="Eve",**ST); a2=S("staffing_assign",p_need_id=N2,p_caregiver_name="Eve",**ST)
a3=S("staffing_assign",p_need_id=N2,p_caregiver_name="Fay",**ST); a4=S("staffing_assign",p_need_id=N2,p_caregiver_name="Gus",**ST)
ck("capacity · a 2-person transfer is ONE need with 2 seats; same caregiver twice refused; third refused",
   a1.get("seat_no")==1 and a2.get("outcome")=="conflict" and a3.get("seat_no")==2 and a4.get("outcome")=="capacity_full" and status(N2)[0]=="filled")
rel=S("staffing_assignment_release",p_assignment_id=a3["assignment_id"],p_reason="caregiver withdrew",**ST)
a5=S("staffing_assign",p_need_id=N2,p_caregiver_name="Gus",**ST)
ck("release · frees the seat for a new decision; the released decision is kept, not edited",
   rel.get("outcome")=="released" and a5.get("seat_no")==2
   and err_code(lambda: svc.run("update staffing_assignment set caregiver_name='x' where assignment_id=cast(:a as uuid)",a=a3["assignment_id"])) is not None)
# concurrency on seats
N3=need(E3,p_shift_date="2026-10-06")["need_id"]; out={}
def race(k,bar):
    cc=c.conn("service_role")
    try:
        bar.wait(); out[k]=S("staffing_assign",conn=cc,p_need_id=N3,p_caregiver_name=f"CG{k}",**ST).get("outcome")
    except Exception as ex: out[k]="error "+str(ex)[:60]
    finally: cc.close()
bar=threading.Barrier(6); ts=[threading.Thread(target=race,args=(k,bar)) for k in range(6)]
[t.start() for t in ts]; [t.join() for t in ts]
ck("concurrency · six simultaneous assignments to a 1-seat need: exactly one wins",
   sorted(out.values()).count("assigned")==1 and s.run("select count(*) from staffing_assignment where need_id=cast(:n as uuid) and state='active'",n=N3)[0][0]==1, out)
# exhaustion
N4=need(E2,p_shift_date="2026-10-07")["need_id"]
x1=ask(N4,"Hal"); x2=ask(N4,"Ida",p_channel="call",p_message_status="verbal",p_message_text=None)
reply(x1["ask_id"],"no","no sorry"); reply(x2["ask_id"],"no_answer","(no answer, voicemail left)",p_channel="call")
ck("exhausted · every recorded ask ended in no / no answer and none open: derived EXHAUSTED", status(N4)[0]=="exhausted", status(N4))
ask(N4,"Jo")
ck("exhausted · a new open ask moves it back to ASKED", status(N4)[0]=="asked", status(N4))
# supersede: slot changed after asks
N5r=need(E1,p_shift_date="2026-10-08",p_start_time="09:00",p_end_time="13:00",p_axiscare_visit_ref="s=202:d=2026-10-08"); N5=N5r["need_id"]
k1=ask(N5,"Kim")
snapN5=s.run("select start_time::text,end_time::text from staffing_need where need_id=cast(:n as uuid)",n=N5)[0]
r=need(E1,p_shift_date="2026-10-08",p_start_time="07:00",p_end_time="11:00",p_axiscare_visit_ref="s=202:d=2026-10-08",p_supersedes_need_id=N5)
old=s.run("select state, closed_reason, superseded_by_need_id::text, start_time::text, end_time::text from staffing_need where need_id=cast(:n as uuid)",n=N5)[0]
oldask=s.run("select closed_reason, message_text from staffing_ask where ask_id=cast(:a as uuid)",a=k1["ask_id"])[0]
ck("supersede · a changed slot is a NEW need (same visit); the old need keeps its original times and history",
   r.get("outcome")=="opened" and old[0]=="closed" and old[1]=="superseded" and old[2]==r["need_id"] and [old[3],old[4]]==snapN5
   and s.run("select axiscare_visit_ref from staffing_need where need_id=cast(:n as uuid)",n=r["need_id"])[0][0]=="s=202:d=2026-10-08", old)
ck("supersede · the ask made for the old slot stays true (text kept) and is closed as superseded",
   oldask[0]=="superseded" and "9-1" in oldask[1], oldask)
# close
N6=need(E3,p_shift_date="2026-10-09")["need_id"]; y=ask(N6,"Lou"); reply(y["ask_id"],"yes","yes")
cl=S("staffing_need_close",p_need_id=N6,p_reason="covered",**ST)
ck("close · closing a need closes its open asks but keeps replies",
   cl.get("outcome")=="closed" and s.run("select closed_reason from staffing_ask where ask_id=cast(:a as uuid)",a=y["ask_id"])[0][0]=="need_closed"
   and s.run("select count(*) from staffing_reply where ask_id=cast(:a as uuid)",a=y["ask_id"])[0][0]==1)
ck("close · no new asks or assignments on a closed need (outside the legacy mirror)",
   ask(N6,"Max").get("outcome")=="need_closed" and S("staffing_assign",p_need_id=N6,p_caregiver_name="Lou",**ST).get("outcome")=="need_closed")
# legacy mirror
Nl=need(E3,p_shift_date="2026-09-20",p_acting_seat="legacy_mirror",p_acting_staff="mirror",p_origin_system="coverage_case",p_origin_ref="id_legacy1")["need_id"]
S("staffing_need_close",p_need_id=Nl,p_reason="covered",p_acting_staff="mirror",p_acting_seat="legacy_mirror")
la=ask(Nl,"Ned",p_message_status="not_retained_legacy",p_message_text=None,p_acting_seat="legacy_mirror",p_acting_staff="mirror",p_origin_system="coverage_case",p_origin_ref="ask_legacy1")
la2=ask(Nl,"Ned",p_message_status="not_retained_legacy",p_message_text=None,p_acting_seat="legacy_mirror",p_acting_staff="mirror",p_origin_system="coverage_case",p_origin_ref="ask_legacy1")
ls=S("staffing_assign",p_need_id=Nl,p_caregiver_name="Ned",p_acting_seat="legacy_mirror",p_acting_staff="mirror",p_origin_system="coverage_case",p_origin_ref="asg_legacy1")
ck("legacy mirror · history on a closed need is recorded (asks arrive closed, text marked not retained), idempotent by source",
   la.get("outcome")=="recorded" and la2.get("outcome")=="already_recorded" and ls.get("outcome")=="assigned"
   and s.run("select closed_reason from staffing_ask where ask_id=cast(:a as uuid)",a=la["ask_id"])[0][0]=="need_closed")
# sync facts
sy=S("staffing_assignment_sync_record",p_assignment_id=rS["assignment_id"],p_status="verified",p_recorded_by="coverage-assign",p_verified=True,p_axiscare_visit_ref="s=101:d=2026-10-05")
ck("sync · AxisCare write-back results are append-only facts",
   sy.get("outcome")=="recorded" and err_code(lambda: svc.run("update staffing_assignment_sync set detail='x'")) is not None)
# security
au=c.conn("authenticated"); an=c.conn("anon")
tabs=["staffing_need","staffing_ask","staffing_reply","staffing_assignment","staffing_assignment_sync","staffing_ask_current","staffing_need_status"]
ck("security · signed-in users read staffing tables and views; audit hidden",
   all(err_code(lambda t=t: au.run(f"select count(*) from {t}")) is None for t in tabs)
   and (err_code(lambda: au.run("select count(*) from staffing_door_audit")) or "").startswith("42501"))
ck("security · signed-in users cannot write or run any Door; anonymous gets nothing",
   (err_code(lambda: au.run("insert into staffing_need(episode_id,kind,shift_date,start_time,end_time,created_by,created_seat) values (cast(:e as uuid),'dated_shift','2026-10-01','09:00','10:00','x','client_intake')",e=E1)) or "").startswith("42501")
   and (err_code(lambda: au.run("update staffing_assignment set state='released'")) or "").startswith("42501")
   and (err_code(lambda: S("staffing_assign",conn=au,p_need_id=N4,p_caregiver_name="x",**ST)) or "").startswith("42501")
   and all((err_code(lambda t=t: an.run(f"select count(*) from {t}")) or "").startswith("42501") for t in tabs))
ck("security · no staffing function runs as definer; deletes/truncates blocked",
   s.run("select count(*) from pg_proc where proname like 'staffing\\_%' escape '\\' and prosecdef")[0][0]==0
   and err_code(lambda: svc.run("delete from staffing_need")) is not None and err_code(lambda: s.run("truncate staffing_ask cascade")) is not None)
ops=dict(s.run("select op, count(*) from staffing_door_audit group by op"))
ck("audit · every Door type left audit rows; audit append-only",
   all(ops.get(o,0)>0 for o in ("need_open","need_close","ask_record","reply_record","assign","release","sync_record"))
   and err_code(lambda: svc.run("update staffing_door_audit set detail='x'")) is not None, ops)
before=[s.run(f"select count(*) from {t}")[0][0] for t in tabs[:5]]
rc,out=c.psql(SF)
ck("guard · with staffing rows present the migration refuses and nothing changes",
   rc!=0 and "refused" in out and sfp()==F1 and [s.run(f"select count(*) from {t}")[0][0] for t in tabs[:5]]==before, out[-200:])
ck("outside · Journey foundation definitions and everything outside Journey/staffing unchanged after every step",
   journey_fp(c)==JF0 and outside_nonstaff()==OUT0)
for x in (svc,au,an): x.close()
c.close()
print("\nSTAGE 3 STAFFING FOUNDATION · DISPOSABLE PROOF\n"+"="*70)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*70); print(("ALL %d PROOFS PASS"%len(res)) if ok else "%d FAILED"%sum(1 for r in res if not r[1]))
print("staffing migration sha256:", hashlib.sha256(open(SF_PATH,"rb").read()).hexdigest())
