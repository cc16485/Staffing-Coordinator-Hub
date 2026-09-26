import os, json, subprocess, re
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
res=[]
def ck(n,c,note=""): res.append((n,bool(c),"" if c else note))
c=Cluster("bo"); P=setup_supabase_like(c)
c.su.run("alter table app_data add column updated_at timestamptz default now()")
c.su.run("alter table person_source_id add column needs_review boolean not null default false, add column created_at timestamptz not null default now()")
c.psql("begin;\n"+PHASEA+"\ncommit;\n"); rc,out=c.psql(MIG); assert rc==0, out
s=c.su
def link(p,ax,conf='confirmed',nr='false'):
    s.run(f"insert into person_source_id(person_id,system,entity_type,source_id,confidence) values (cast(:p as uuid),'axiscare','client',:ax,:c)", p=P[p], ax=ax, c=conf)
    if nr=='true': s.run("update person_source_id set needs_review=true where source_id=:ax", ax=ax)
# persons 1 eligible, 2 needs_review, 3 inactive, 4 has active ep, 5 earlier ended ep, 6 two links (one active)
link(1,'A1'); link(2,'A2','confirmed','true'); link(3,'A3'); link(4,'A4'); link(5,'A5'); link(6,'A6a'); link(6,'A6b')
s.run("update app_data set data = :d where key='client_status_log'", d=json.dumps([{"id":"latest","map":
   {"A1":"Active","A2":"Active","A3":"Inactive","A4":"Active","A5":"Active","A6a":"Inactive","A6b":"Active","A99":"Active","A98":"Deceased"}}]))
svc=c.conn("service_role")
door(svc,"episode_open_for_person",p_person_id=P[4],p_state="established",p_began_basis="before_observation",p_began_not_after="2026-09-12",p_began_evidence="x",p_prior_history="unobserved",p_prior_evidence="x")
r=door(svc,"episode_record_historical",p_person_id=P[5],p_began_on="2024-01-01",p_ended_on="2024-02-01",p_evidence="file",p_acting_seat="owner_decision")
def counts_all():
    return tuple(s.run(f"select count(*) from {t}")[0][0] for t in JOURNEY_TABLES)
def run(mode, approved=""):
    rep=os.path.join(H,f"bo_{mode}.txt")
    env=dict(os.environ,SB_MODE=mode,SB_ELIGFILE=os.path.join(H,"baseline-open-eligibility.sql"),SB_REPORT=rep,SB_LOCAL_SOCK=c.sock,SB_APPROVED_HASH=approved)
    p=subprocess.run(["python3",os.path.join(H,"baseline_open.py")],env=env,capture_output=True,text=True)
    return p.returncode,(open(rep).read() if os.path.exists(rep) else p.stdout+p.stderr)
before=counts_all(); snap4=s.run("select row_to_json(e)::text from journey_episode e where person_id=cast(:p as uuid)",p=P[4])[0][0]
rc,rep=run("dry"); h=re.search(r"eligibility hash (\w+)",rep).group(1)
ck("dry run · writes nothing", rc==0 and counts_all()==before, rep)
ck("dry run · eligible = the clean client and the two-link client with one Active link",
   f"ELIGIBLE · 2" in rep and P[1] in rep.split("SKIP")[0] and P[6] in rep.split("SKIP")[0], rep)
ck("dry run · needs-review link, Inactive client and earlier-episode client are EXCLUDED with reasons",
   "EXCLUDED · 3" in rep and "flagged for review" in rep and "not Active" in rep and "would be a return" in rep, rep)
ck("dry run · client with an active episode is SKIP; unlinked Active id goes to ADMISSION; Deceased id ignored",
   "SKIP · 1" in rep and "ADMISSION · 1" in rep and "A99" in rep and "A98" not in rep, rep)
rc,rep2=run("commit","0"*32)
ck("commit · refuses a stale or wrong approval hash and writes nothing", rc==4 and "REFUSED" in rep2 and counts_all()==before, rep2)
# eligibility changes between approval and commit -> refused
s.run("update app_data set data = jsonb_set(data, '{0,map,A1}', '\"Inactive\"') where key='client_status_log'")
rc,rep3=run("commit",h)
ck("commit · refuses if eligibility changed after approval (a client went Inactive), nothing written",
   rc==4 and counts_all()==before, rep3)
s.run("update app_data set data = jsonb_set(data, '{0,map,A1}', '\"Active\"') where key='client_status_log'")
rc,rep4=run("commit",h)
facts=s.run("select f.fact_type, f.basis, f.not_after::text, f.prior_history_status, f.evidence_ref from episode_fact f "
            "join journey_episode e on e.episode_id=f.episode_id where e.person_id=cast(:p as uuid) order by 1",p=P[1])
ck("commit · opens exactly the approved clients and verifies them", rc==0 and "BASELINES OPENED AND VERIFIED" in rep4
   and s.run("select count(*) from journey_episode")[0][0]==before[0]+2, rep4)
ck("commit · each baseline has ONLY a before-observation begin (no later than the link date) and prior history unobserved",
   len(facts)==2 and facts[0][0]=="began" and facts[0][1]=="before_observation" and facts[0][2]==str(s.run("select min(created_at)::date from person_source_id where person_id=cast(:p as uuid)",p=P[1])[0][0])
   and facts[1][0]=="prior_history" and facts[1][3]=="unobserved" and facts[0][4].startswith("person_source_id:"), str(facts))
ck("commit · no ordinal, no sources, no reviews, earlier client untouched",
   s.run("select count(*) from journey_episode_current where lifetime_ordinal is not null")[0][0]==0
   and s.run("select count(*) from episode_source")[0][0]==0 and s.run("select count(*) from episode_review")[0][0]==0
   and s.run("select row_to_json(e)::text from journey_episode e where person_id=cast(:p as uuid)",p=P[4])[0][0]==snap4, "")
after=counts_all(); rc,rep5=run("commit",h)
ck("commit · rerun with the same approval refuses (eligibility is now empty) and writes nothing", rc==4 and counts_all()==after, rep5)
rc,rep6=run("dry")
ck("idempotent · after commit the opened clients show SKIP", "SKIP · 3" in rep6 and "ELIGIBLE · 0" in rep6, rep6)
# all-or-nothing: two newly eligible clients, one forced to fail inside the transaction
link(7,'A7'); link(8,'A8')
s.run("update app_data set data = jsonb_set(jsonb_set(data, '{0,map,A7}', '\"Active\"'), '{0,map,A8}', '\"Active\"') where key='client_status_log'")
rc,rep7=run("dry"); h2=re.search(r"eligibility hash (\w+)",rep7).group(1)
s.run(f"""create function _fail_p8() returns trigger language plpgsql as $$ begin
          if new.person_id = '{P[8]}'::uuid then raise exception 'forced failure for P8'; end if; return new; end $$""")
s.run("create trigger _fail_p8_t before insert on journey_episode for each row execute function _fail_p8()")
before8=counts_all()
rc,rep8=run("commit",h2)
ck("commit · all-or-nothing: one client failing inside the transaction leaves the other unwritten too",
   rc==5 and "STOPPED" in rep8 and counts_all()==before8, rep8)
s.run("drop trigger _fail_p8_t on journey_episode"); s.run("drop function _fail_p8()")
rc,rep9=run("commit",h2)
ck("commit · with the failure removed, both open together", rc==0 and counts_all()[0]==before8[0]+2, rep9)
svc.close(); c.close()
print("\nBASELINE-OPEN · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note[:900]) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
