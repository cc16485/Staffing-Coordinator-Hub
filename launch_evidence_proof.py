#!/usr/bin/env python3
# Change 1 · launch evidence · disposable-Postgres proof. Never touches production.
# The AxisCare records fed to the Door come from the real launch-evidence.js engine (node).
import os, json, hashlib, threading, subprocess
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
LE=open(os.path.join(H,"launch-evidence.sql")).read()
LERB=open(os.path.join(H,"launch-evidence-rollback.sql")).read()
ENGINE=os.path.join(os.path.dirname(H),"cc-hub-live","launch-evidence.js")
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[:800]))

QCOLS="""id uuid primary key default gen_random_uuid(), client_name text not null, axiscare_client_id text, status text not null default 'pending',
  episode_n int default 1, start_date date, payer text, added_at timestamptz not null default now(),
  caregiver_assigned boolean not null default false, caregiver_assigned_name text, caregiver_assigned_at timestamptz,
  caregiver_called boolean not null default false, caregiver_called_at timestamptz, client_called boolean not null default false, client_called_at timestamptz,
  schedule_added boolean default false, schedule_added_at timestamptz, evv_verified boolean default false, evv_verified_at timestamptz,
  first_shift_done boolean default false, first_shift_done_at timestamptz, caregiver_call_notes text, client_call_notes text,
  completed_at timestamptz, completed_by text"""
def fixture(tag, cols=QCOLS):
    c=Cluster(tag); s=c.su
    for r in ["anon","authenticated"]: s.run(f"do $$ begin create role {r} nologin; exception when duplicate_object then null; end $$;")
    s.run("do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;")
    s.run("grant usage on schema public to anon, authenticated, service_role")
    for k in ("tables","sequences","functions"): s.run(f"alter default privileges in schema public grant all on {k} to anon, authenticated, service_role")
    s.run(f"create table client_queue ({cols})")
    s.run("alter table client_queue enable row level security")
    s.run("create policy q_auth on client_queue for all to authenticated using (true) with check (true)")
    s.run("revoke all on client_queue from anon"); s.run("grant insert on client_queue to anon")
    return c,s
def Q(s,**kw):
    k=dict(client_name="Peggy Thomason",axiscare_client_id="295",added_at="2026-09-15T14:00:00Z",start_date="2026-09-22"); k.update(kw)
    cols=",".join(k); vals=",".join(":"+x for x in k)
    return str(s.run(f"insert into client_queue ({cols}) values ({vals}) returning id",**k)[0][0])
def engine(launch, visits, now="2026-09-26T17:00:00Z", evidence=()):
    js=f"""require({json.dumps(ENGINE)});const r=globalThis.CCLaunchEvidence.evaluate({{launch:{json.dumps(launch)},visits:{json.dumps(visits)},evidence:{json.dumps(list(evidence))},now:new Date({json.dumps(now)})}});
           process.stdout.write(JSON.stringify(r));"""
    return json.loads(subprocess.run(["node","-e",js],capture_output=True,text=True,check=True).stdout)
def V(day,clocked=True,**o):
    v={"id":"v="+day,"client":{"id":295},"caregiver":{"id":77,"firstName":"Jane","lastName":"Doe"},
       "scheduledStartDate":day+"T09:00:00","scheduledEndDate":day+"T12:00:00","removed":False,"verified":True,
       "clockIn":{"time":day+"T09:02:00","method":"Mobile"} if clocked else None,"clockOut":{"time":day+"T12:01:00"} if clocked else None}
    v.update(o); return v
def REC(conn,lid,ax,records,source="axiscare",staff="automation:launch-evidence",reason=None):
    r=conn.run("select public.launch_evidence_record(cast(:l as uuid),:a,cast(:r as jsonb),:s,:t,:why)",l=lid,a=ax,r=json.dumps(records),s=source,t=staff,why=reason)[0][0]
    return r if isinstance(r,dict) else json.loads(r)
O=lambda r:r.get("outcome")
U=lambda x: f"to_char({x} at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS')||'+00'"
ROW=f"select caregiver_assigned, caregiver_assigned_name, {U('caregiver_assigned_at')}, schedule_added, {U('schedule_added_at')}, evv_verified, {U('evv_verified_at')}, first_shift_done, {U('first_shift_done_at')}, status, client_call_notes from client_queue where id=cast(:i as uuid)"

c,s=fixture("le")
svc=c.conn("service_role")
rc,out=c.psql(LE.replace("do $verify$","select 1/0;\ndo $verify$",1))
ck("install · an injected failure leaves nothing behind", rc!=0 and not has_obj(c,"launch_evidence"), out[-200:])
rc,out=c.psql(LE); rc2,out2=c.psql(LE)
ck("install · installs, a rerun while unused succeeds, self-check passes (incl. Springfield time for AxisCare stamps)", rc==0 and rc2==0, (out+out2)[-300:])

A=Q(s, client_call_notes="Confirmed Mon/Wed/Fri 9-12")
L_A=dict(id=A,axiscare_client_id="295",added_at="2026-09-15T14:00:00Z",episode_n=1,status="pending",start_date="2026-09-22")
ev=engine(L_A,[V("2026-09-22"),V("2026-09-29",clocked=False),V("2026-10-01",clocked=False)])
ck("engine · the real engine proposes all four facts for Peggy (first shift Sep 22)", [x["fact"] for x in ev["record"]]==["schedule","caregiver","first_shift","evv"]
   and ev["actual_soc"]["date"]=="2026-09-22", ev)
snap=lambda: [s.run("select count(*) from launch_evidence")[0][0]]+[list(x) for x in s.run("select * from client_queue order by id")]
S0=snap()
refs=[REC(svc,A,"295",ev["record"],source="robot"),REC(svc,A,"295",ev["record"],staff=" "),REC(svc,None,"295",ev["record"]),REC(svc,A,"295",[]),
      REC(svc,A,"295",ev["record"][:1],source="person",staff="kat@cc.test"),REC(svc,A,"295",ev["record"][:2],source="person",staff="kat@cc.test",reason="AxisCare down today"),
      REC(svc,"00000000-0000-0000-0000-000000000000","295",ev["record"]),REC(svc,A,"296",ev["record"]),REC(svc,A,"295",[{"fact":"billing"}])]
ck("refusals · unknown source, no staff, no launch, nothing to record, a hand record without a reason or with two facts, an unknown launch, evidence read for a different AxisCare id, an unknown fact; nothing changes",
   [O(r) for r in refs]==["invalid_source","staff_required","launch_required","nothing_to_record","reason_required","one_fact_at_a_time","launch_not_found","axiscare_id_changed","refused"]
   and snap()==S0, [O(r) for r in refs])

r=REC(svc,A,"295",ev["record"])
row=s.run(ROW,i=A)[0]
ck("record · all four facts recorded and the four empty boxes ticked", O(r)=="recorded" and r["ticked"]==["schedule","caregiver","first_shift","evv"]
   and row[0] and row[3] and row[5] and row[7], (r,row))
ck("record · first shift time is the clock-in (9:02 Springfield = 14:02 UTC), not when the record was made", row[8]=="2026-09-22 14:02:00+00", row[8])
ck("record · the caregiver's name comes from AxisCare because none was typed", row[1]=="Jane Doe", row[1])
ck("record · call notes and every other launch field untouched", row[10]=="Confirmed Mon/Wed/Fri 9-12" and row[9]=="pending")
evr=s.run("select fact, source, ticked, evidence->>'visit_id', evidence->>'clock_out_at', recorded_by from launch_evidence where launch_id=cast(:i as uuid) and fact='first_shift'",i=A)
ck("record · the proof is kept: which visit, clock-in and clock-out, by the automation", evr==[["first_shift","axiscare",True,"v=2026-09-22","2026-09-22T12:01:00","automation:launch-evidence"]], evr)
S1=snap(); r=REC(svc,A,"295",ev["record"])
ck("rerun · the same evidence again is harmless: nothing new, nothing changed", O(r)=="nothing_new" and r["already_recorded"]==["schedule","caregiver","first_shift","evv"] and snap()==S1, r)

# a launch a person already ticked by hand
B=Q(s,client_name="Ann Lee",axiscare_client_id="300",caregiver_assigned=True,caregiver_assigned_name="Jane D",caregiver_assigned_at="2026-09-16T15:00:00Z",
    schedule_added=True,schedule_added_at="2026-09-17T15:00:00Z",evv_verified=True,evv_verified_at="2026-09-18T15:00:00Z",
    first_shift_done=True,first_shift_done_at="2026-09-23T15:00:00Z")
evb=engine(dict(id=B,axiscare_client_id="300",added_at="2026-09-15T14:00:00Z",caregiver_assigned=True,caregiver_assigned_name="Jane D",schedule_added=True,
                evv_verified=True,first_shift_done=True,first_shift_done_at="2026-09-23T15:00:00Z",status="pending"),
           [V("2026-09-22",client={"id":300})])
before=s.run(ROW,i=B)[0]; r=REC(svc,B,"300",evb["record"])
ck("hand ticks · a person's ticks, times and typed name are never replaced; the evidence is still kept (ticked = false)",
   O(r)=="recorded" and r["ticked"]==[] and s.run(ROW,i=B)[0]==before
   and s.run("select count(*) from launch_evidence where launch_id=cast(:i as uuid) and not ticked",i=B)[0][0]==4, (r,before))

# atomic refusals: bad first-shift evidence takes the whole call down
C=Q(s,client_name="Bo Park",axiscare_client_id="310")
good=[{"fact":"schedule","detail":{"visits":3}},{"fact":"caregiver","name":"Jane Doe","detail":{}}]
bad=[{"fact":"first_shift","at":"2026-09-22T09:02:00","detail":{"visit_id":"v=1","clock_out_at":None}}]
S2=snap(); r=REC(svc,C,"310",good+bad)
ck("atomic · a first shift without a clock-out is refused and NOTHING from the same call is saved", O(r)=="refused" and r["detail"]["outcome"]=="evidence_incomplete" and snap()==S2, r)
r1=REC(svc,C,"310",[{"fact":"first_shift","at":"2026-09-22T12:00:00","detail":{"visit_id":"v=1","clock_out_at":"2026-09-22T09:00:00"}}])
r2=REC(svc,C,"310",[{"fact":"first_shift","at":"2099-01-01T09:00:00","detail":{"visit_id":"v=1","clock_out_at":"2099-01-01T12:00:00"}}])
r3=REC(svc,C,"310",[{"fact":"evv","detail":{}}])
ck("atomic · clock-out before clock-in, a clock-in in the future, and EVV without a visit are refused; nothing saved",
   [r1["detail"]["outcome"],r2["detail"]["outcome"],r3["detail"]["outcome"]]==["evidence_inconsistent","evidence_inconsistent","evidence_incomplete"] and snap()==S2, (r1,r2,r3))

# a person records by hand, with a reason
D=Q(s,client_name="Cy Dunn",axiscare_client_id="320")
rf=REC(svc,D,"320",[{"fact":"first_shift","detail":{"date":"2099-01-01"}}],source="person",staff="kat@cc.test",reason="Caregiver forgot to clock in; family confirmed")
rn=REC(svc,D,"320",[{"fact":"first_shift","detail":{}}],source="person",staff="kat@cc.test",reason="Caregiver forgot to clock in; family confirmed")
ck("by hand · a first shift needs the day care began, and not a future day", rf["detail"]["outcome"]=="date_required" and rn["detail"]["outcome"]=="date_required", (rf,rn))
r=REC(svc,D,"320",[{"fact":"first_shift","detail":{"date":"2026-09-20"}}],source="person",staff="kat@cc.test",reason="Caregiver forgot to clock in; family confirmed")
row=s.run(ROW,i=D)[0]; hv=s.run("select source, reason, recorded_by, evidence->>'date' from launch_evidence where launch_id=cast(:i as uuid)",i=D)
ck("by hand · ticks the box on the day care began (noon Springfield), keeping who and why", O(r)=="recorded" and row[7] and row[8]=="2026-09-20 17:00:00+00"
   and hv==[["person","Caregiver forgot to clock in; family confirmed","kat@cc.test","2026-09-20"]], (r,row,hv))
evd=engine(dict(id=D,axiscare_client_id="320",added_at="2026-09-15T14:00:00Z",first_shift_done=True,first_shift_done_at="2026-09-20T17:00:00Z",status="pending"),
           [V("2026-09-21",client={"id":320})],
           evidence=[{"fact":"first_shift","source":x[0],"reason":x[1],"recorded_by":x[2],"evidence":{"date":x[3]}} for x in hv])
r=REC(svc,D,"320",evd["record"])
ck("by hand, then AxisCare · the later AxisCare evidence is kept alongside; the hand record stands", O(r)=="recorded" and "first_shift" in r["recorded"] and "first_shift" not in r["ticked"]
   and s.run(ROW,i=D)[0][8]=="2026-09-20 17:00:00+00", r)

# completed launch, removal
E=Q(s,client_name="Di Ames",axiscare_client_id="330",status="complete")
S3=snap(); r=REC(svc,E,"330",[{"fact":"schedule","detail":{}}])
ck("completed · a finished launch is never written to", O(r)=="launch_complete" and snap()==S3, r)
au=c.conn("authenticated")
au.run("delete from client_queue where id=cast(:i as uuid)",i=A)
ck("remove · the New Clients Remove button still works; the evidence stays as history",
   s.run("select count(*) from client_queue where id=cast(:i as uuid)",i=A)[0][0]==0
   and s.run("select count(*) from launch_evidence where launch_id=cast(:i as uuid)",i=A)[0][0]==4)

# concurrency
F=Q(s,client_name="Ed Moss",axiscare_client_id="340")
evf=engine(dict(id=F,axiscare_client_id="340",added_at="2026-09-15T14:00:00Z",status="pending"),[V("2026-09-22",client={"id":340})])
out2={}
def race(k,bar):
    cc=c.conn("service_role")
    try: bar.wait(); out2[k]=O(REC(cc,F,"340",evf["record"]))
    except Exception as e: out2[k]="ERROR "+str(e)[:160]
    finally: cc.close()
bar=threading.Barrier(2); ts=[threading.Thread(target=race,args=(k,bar)) for k in "ab"]; [t.start() for t in ts]; [t.join() for t in ts]
ck("concurrency · the card and the background run recording at the same moment: one records, the other finds it done",
   sorted(out2.values())==["nothing_new","recorded"] and s.run("select count(*) from launch_evidence where launch_id=cast(:i as uuid)",i=F)[0][0]==4, out2)

ck("append-only · evidence cannot be edited, deleted or truncated",
   all(err_code(f) is not None for f in [lambda: s.run("update launch_evidence set ticked=false"),
       lambda: s.run("delete from launch_evidence"), lambda: s.run("truncate launch_evidence")]))
an=c.conn("anon")
ck("security · signed-in staff read the evidence but cannot record or insert it; anonymous gets nothing",
   err_code(lambda: au.run("select count(*) from launch_evidence")) is None
   and (err_code(lambda: REC(au,F,"340",evf["record"])) or "").startswith("42501")
   and (err_code(lambda: au.run("insert into launch_evidence(launch_id,fact,source,ticked,recorded_by) values (gen_random_uuid(),'evv','axiscare',true,'x')")) or "").startswith("42501")
   and (err_code(lambda: an.run("select count(*) from launch_evidence")) or "").startswith("42501"))
rc,out=c.psql(LE); ck("guard · once evidence exists the migration refuses and changes nothing", rc!=0 and "refused" in out, out[-200:])
rc,out=c.psql(LERB); ck("rollback · refuses once evidence exists", rc!=0 and "refused" in out and has_obj(c,"launch_evidence"), out[-200:])
for x in (svc,au,an): x.close()
c.close()

c,s=fixture("lerb")
rc,out=c.psql(LE); rc2,out2=c.psql(LERB)
ck("rollback · on an unused install removes the table and the Door", rc==0 and rc2==0 and not has_obj(c,"launch_evidence"), (out+out2)[-300:])
c.close()
c,s=fixture("lecol", QCOLS.replace(" evv_verified_at timestamptz,",""))
rc,out=c.psql(LE)
ck("guard · refuses (and names it) if client_queue lacks a column the Door writes", rc!=0 and "evv_verified_at" in out and not has_obj(c,"launch_evidence"), out[-200:])
c.close()

print("\nCHANGE 1 · LAUNCH EVIDENCE · DISPOSABLE PROOF\n"+"="*60)
ok=True
for nm,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+nm+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "%d FAILED"%sum(1 for r in res if not r[1]))
print("launch-evidence migration sha256:", hashlib.sha256(LE.encode()).hexdigest())
