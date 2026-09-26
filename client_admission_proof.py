import os, json, threading, time, hashlib
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
ADM=open(os.path.join(H,"client-admission.sql")).read()
ELIG=open(os.path.join(H,"baseline-open-eligibility.sql")).read()
res=[]
def ck(n,c,note=""): res.append((n,bool(c),"" if c else note))
c=Cluster("adm"); P=setup_supabase_like(c); s=c.su
# make the identity fixture match production
s.run("alter table person_source_id add column needs_review boolean not null default false, add column created_at timestamptz not null default now(), add column evidence text, add column imported_at timestamptz")
s.run("create unique index person_source_axiscare_uniq on person_source_id (entity_type, source_id) where system = 'axiscare'")
s.run("create unique index person_source_no_dupes on person_source_id (person_id, system, entity_type, source_id)")
s.run("""create table person_role (id bigserial primary key, person_id uuid not null references person_identity(id), role text not null,
         status text not null default 'active', started_at date, ended_at date, end_reason text, updated_at timestamptz not null default now())""")
s.run("create unique index person_role_one_active on person_role (person_id, role) where status = 'active'")
s.run("""create table phone_index (id bigserial primary key, phone text not null, person_id uuid not null references person_identity(id),
         kind text, shared boolean not null default false, confidence text not null default 'confirmed', verification_status text not null default 'unverified')""")
for t in ["person_role","phone_index"]:
    s.run(f"revoke all on {t} from anon"); s.run(f"grant select on {t} to authenticated"); s.run(f"grant all on {t} to service_role")
s.run("alter table app_data add column updated_at timestamptz default now()")
c.psql("begin;\n"+PHASEA+"\ncommit;\n"); rc,out=c.psql(MIG); assert rc==0,out
def link(p,ax): s.run("insert into person_source_id(person_id,system,entity_type,source_id) values (cast(:p as uuid),'axiscare','client',:a)",p=P[p],a=ax)
link(1,'AX1'); link(9,'AX9')
s.run("insert into phone_index(phone,person_id,confidence,verification_status) values ('+14175550101',cast(:p as uuid),'confirmed','verified'),('+14175550102',cast(:q as uuid),'probable','unverified')",p=P[3],q=P[4])
s.run("update app_data set data=:d where key='client_status_log'", d=json.dumps([{"id":"latest","map":{"AX1":"Active","AX25":"Active","AX26":"Active","AX9":"Active"}}]))
OUT0=outside_fp(c); JF0=journey_fp(c)
ident_defs=lambda: s.run("select md5(string_agg(table_name||column_name||data_type, ',' order by table_name, column_name)) from information_schema.columns where table_name in ('person_identity','person_source_id','person_role','phone_index')")[0][0]
IDEF0=ident_defs()
# atomic failure + install
rc,out=c.psql(ADM.replace("do $verify$","select 1/0;\ndo $verify$",1))
ck("migration · an injected failure leaves nothing behind", rc!=0 and not has_obj(c,"client_admission_case"), out[-200:])
rc,out=c.psql(ADM); ck("migration · installs cleanly", rc==0, out[-300:])
fp_adm=lambda: s.run("select md5(string_agg(p.proname||md5(p.prosrc),',' order by p.proname)) from pg_proc p where p.proname like 'client\\_admission\\_%' escape '\\'")[0][0]
F1=fp_adm(); rc,out=c.psql(ADM)
ck("migration · rerun on an empty install is identical", rc==0 and fp_adm()==F1, out[-200:])
svc=c.conn("service_role")
def D(fn,**kw):
    args=[]
    for k in kw:
        if k in ("p_case_id","p_person_id"): args.append(f"{k} => cast(:{k} as uuid)")
        elif k=="p_observed_at": args.append(f"{k} => cast(:{k} as timestamptz)")
        elif k=="p_axiscare_phones": args.append(f"{k} => cast(:{k} as text[])")
        else: args.append(f"{k} => :{k}")
    r=svc.run(f"select public.{fn}({', '.join(args)})",**kw)[0][0]; return r if isinstance(r,dict) else json.loads(r)
persons_before=s.run("select count(*) from person_identity")[0][0]
r1=D("client_admission_open",p_axiscare_client_id="AX25",p_observed_label="Active",p_observed_at="2026-09-26T00:17:00Z",
     p_axiscare_name="Test Client",p_axiscare_phones="{(417) 555-0101,417-555-0102,555}")
case=r1.get("case_id"); sug=s.run("select suggestions from client_admission_case where case_id=cast(:c as uuid)",c=case)[0][0]
sug=sug if isinstance(sug,list) else json.loads(sug)
ck("open · an unlinked Active client gets one case with phone SUGGESTIONS (strong + weak), nothing resolved",
   r1.get("outcome")=="opened" and sorted(x["strength"] for x in sug)==["strong","weak"]
   and s.run("select count(*) from person_identity")[0][0]==persons_before
   and s.run("select count(*) from person_source_id where source_id='AX25'")[0][0]==0, f"{r1} {sug}")
r2=D("client_admission_open",p_axiscare_client_id="AX25",p_observed_label="Active",p_observed_at="2026-09-26T06:17:00Z")
r3=D("client_admission_open",p_axiscare_client_id="AX1",p_observed_label="Active",p_observed_at="2026-09-26T06:17:00Z")
ck("open · idempotent (already open) and never opens a case for an already-linked client",
   r2.get("outcome")=="already_open" and r2.get("case_id")==case and r3.get("outcome")=="already_linked"
   and s.run("select count(*) from client_admission_case")[0][0]==1)
ck("confirm · refuses without a valid seat or a named person",
   D("client_admission_confirm",p_case_id=case,p_decision="existing",p_acting_staff="x",p_acting_seat="system").get("outcome")=="invalid_seat"
   and D("client_admission_confirm",p_case_id=case,p_decision="existing",p_acting_staff="",p_acting_seat="client_intake").get("outcome")=="staff_required")
e_before=[r[0] for r in s.run("select row_to_json(p)::text from person_source_id p order by id")]
rc_=D("client_admission_confirm",p_case_id=case,p_decision="existing",p_person_id=P[3],p_acting_staff="Intake staff",p_acting_seat="client_intake")
lk=s.run("select confidence, needs_review, evidence from person_source_id where source_id='AX25'")
ck("confirm existing · writes ONE confirmed link with evidence naming the case, adds the client role, closes the case",
   rc_.get("outcome")=="confirmed" and len(lk)==1 and lk[0][0]=="confirmed" and lk[0][1] is False and case in lk[0][2]
   and s.run("select count(*) from person_role where person_id=cast(:p as uuid) and role='client' and status='active'",p=P[3])[0][0]==1
   and s.run("select status from client_admission_case where case_id=cast(:c as uuid)",c=case)[0][0]=="confirmed_existing", f"{rc_} {lk}")
e_upd=err_code(lambda: s.run("update client_admission_case set resolution_note='changed' where case_id=cast(:c as uuid)",c=case))
e_del=err_code(lambda: s.run("delete from client_admission_case"))
ck("closed cases cannot be edited or deleted", e_upd is not None and e_del is not None)
# new person
r=D("client_admission_open",p_axiscare_client_id="AX26",p_observed_label="Active",p_observed_at="2026-09-26T00:17:00Z",p_axiscare_name="New Person")
c26=r["case_id"]
ck("confirm new · requires a name", D("client_admission_confirm",p_case_id=c26,p_decision="new",p_acting_staff="Intake staff",p_acting_seat="client_intake").get("outcome")=="name_required")
rn=D("client_admission_confirm",p_case_id=c26,p_decision="new",p_display_name="New Person",p_acting_staff="Intake staff",p_acting_seat="client_intake")
ck("confirm new · creates exactly one person with the link and client role",
   rn.get("outcome")=="confirmed" and s.run("select count(*) from person_identity")[0][0]==persons_before+1
   and s.run("select count(*) from person_source_id where source_id='AX26'")[0][0]==1, str(rn))
# escalation: person already has another AxisCare id
r=D("client_admission_open",p_axiscare_client_id="AX27",p_observed_label="Active",p_observed_at="2026-09-26T00:17:00Z"); c27=r["case_id"]
re1=D("client_admission_confirm",p_case_id=c27,p_decision="existing",p_person_id=P[1],p_acting_staff="Intake staff",p_acting_seat="client_intake")
re2=D("client_admission_confirm",p_case_id=c27,p_decision="existing",p_person_id=P[1],p_acting_staff="Intake staff",p_acting_seat="client_intake")
nolink=s.run("select count(*) from person_source_id where source_id='AX27'")[0][0]==0
re3=D("client_admission_confirm",p_case_id=c27,p_decision="existing",p_person_id=P[1],p_acting_staff="Owner",p_acting_seat="owner_decision",p_note="same person, two AxisCare records")
ck("escalation · a person who already has another AxisCare id goes to Owner / Decision; Client Intake cannot finish it",
   re1.get("outcome")=="escalated" and re2.get("outcome")=="seat_required" and nolink and re3.get("outcome")=="confirmed", f"{re1} {re2} {re3}")
# race: linked elsewhere after the case opened
r=D("client_admission_open",p_axiscare_client_id="AX28",p_observed_label="Active",p_observed_at="2026-09-26T00:17:00Z"); c28=r["case_id"]
link(5,'AX28')
rr=D("client_admission_confirm",p_case_id=c28,p_decision="existing",p_person_id=P[6],p_acting_staff="Intake staff",p_acting_seat="client_intake")
ck("race · an id linked elsewhere after the case opened escalates instead of double-linking",
   rr.get("outcome")=="escalated" and s.run("select count(*) from person_source_id where source_id='AX28'")[0][0]==1, str(rr))
# concurrency: two simultaneous confirms of one case
r=D("client_admission_open",p_axiscare_client_id="AX29",p_observed_label="Active",p_observed_at="2026-09-26T00:17:00Z"); c29=r["case_id"]
out={}
def conf(k,pid,bar):
    cc=c.conn("service_role")
    try:
        bar.wait(); v=cc.run("select public.client_admission_confirm(p_case_id=>cast(:c as uuid),p_decision=>'existing',p_person_id=>cast(:p as uuid),p_acting_staff=>'x',p_acting_seat=>'client_intake')",c=c29,p=pid)[0][0]
        out[k]=(v if isinstance(v,dict) else json.loads(v)).get("outcome")
    except Exception as e: out[k]="error "+str(e)[:60]
    finally: cc.close()
bar=threading.Barrier(2); ts=[threading.Thread(target=conf,args=(k,p,bar)) for k,p in (("a",P[7]),("b",P[8]))]
[t.start() for t in ts]; [t.join() for t in ts]
ck("concurrency · two simultaneous confirmations of one case produce exactly one link",
   sorted(out.values())==["already_closed","confirmed"] and s.run("select count(*) from person_source_id where source_id='AX29'")[0][0]==1, str(out))
# dismiss
r=D("client_admission_open",p_axiscare_client_id="AX30",p_observed_label="Active",p_observed_at="2026-09-26T00:17:00Z"); c30=r["case_id"]
ck("dismiss · needs a reason; with one it closes the case without touching identity",
   D("client_admission_dismiss",p_case_id=c30,p_reason="",p_acting_staff="x",p_acting_seat="client_intake").get("outcome")=="reason_required"
   and D("client_admission_dismiss",p_case_id=c30,p_reason="test record in AxisCare",p_acting_staff="x",p_acting_seat="client_intake").get("outcome")=="dismissed"
   and s.run("select count(*) from person_source_id where source_id='AX30'")[0][0]==0)
# security
au=c.conn("authenticated"); an=c.conn("anon")
ck("security · signed-in users can read cases but not write or run the Doors; events hidden; anonymous gets nothing",
   err_code(lambda: au.run("select count(*) from client_admission_case")) is None
   and (err_code(lambda: au.run("select count(*) from client_admission_event")) or "").startswith("42501")
   and (err_code(lambda: au.run("insert into client_admission_case(axiscare_client_id,observed_label,observed_at,opened_by) values ('x','Active',now(),'x')")) or "").startswith("42501")
   and (err_code(lambda: au.run("select public.client_admission_confirm(cast(null as uuid),'new','x','client_intake')")) or "").startswith("42501")
   and (err_code(lambda: an.run("select count(*) from client_admission_case")) or "").startswith("42501"))
ck("audit · every open / confirm / escalate / dismiss is logged, and the log is append-only",
   set(r[0] for r in s.run("select distinct op from client_admission_event"))=={"open","confirm","escalate","dismiss"}
   and err_code(lambda: svc.run("update client_admission_event set detail='x'")) is not None)
# integration with baseline-open eligibility
el=[dict(zip(["row_kind","ref","labels","decision","reason","began_not_after","evidence_ref","evidence"],r)) for r in s.run(ELIG)]
by={r["ref"]:r["decision"] for r in el}
ck("integration · a confirmed admission becomes baseline-open ELIGIBLE and leaves the ADMISSION list",
   by.get(P[3])=="ELIGIBLE" and "AX25" not in by and by.get("AX26") is None, str(by))
rc,out=c.psql(ADM)
ck("migration · rerun with cases present refuses and changes nothing", rc!=0 and "refused" in out and fp_adm()==F1, out[-200:])
ck("outside · Journey foundation and identity definitions unchanged by the admission migration",
   journey_fp(c)==JF0 and ident_defs()==IDEF0)
for x in (svc,au,an): x.close()
c.close()
print("\nCLIENT ADMISSION · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note[:700]) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
print("admission migration sha256:", hashlib.sha256(ADM.encode()).hexdigest())
