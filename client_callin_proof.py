#!/usr/bin/env python3
# Call-in plan · disposable-Postgres proof of client-callin-plan.sql. Never touches production.
import os, json, hashlib, uuid
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
SQL=open(os.path.join(H,"client-callin-plan.sql")).read()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[:800]))
J=lambda r: r if isinstance(r,dict) else json.loads(r)
c=Cluster("cip"); s=c.su
for r in ["anon","authenticated"]: s.run(f"do $$ begin create role {r} nologin; exception when duplicate_object then null; end $$;")
s.run("do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;")
s.run("grant usage on schema public to anon, authenticated, service_role")
rc,out=c.psql(SQL.replace("do $verify$","select 1/0;\ndo $verify$",1))
ck("install · an injected failure leaves nothing behind", rc!=0 and s.run("select to_regclass('public.client_callin_entries')")[0][0] is None, out[-200:])
rc,out=c.psql(SQL); rc2,out2=c.psql(SQL)
ck("install · installs; a rerun on an empty table succeeds; self-check passes", rc==0 and rc2==0, (out+out2)[-300:])
svc=c.conn("service_role"); au=c.conn("authenticated"); an=c.conn("anon")
def add(p, staff="Krystal@mo-care.com", name="Krystal", conn=None):
    base={"request_id":str(uuid.uuid4()),"axiscare_client_id":"501","client_name":"LeeAnn Walker","source_who":"LeeAnn herself"}
    base.update(p); return J((conn or svc).run("select public.client_callin_add(cast(:p as jsonb),:s,:n)",p=json.dumps(base),s=staff,n=name)[0][0])
O=lambda r:r.get("outcome")
bad=[add({},staff=" "),add({"request_id":"nope"}),add({"axiscare_client_id":"LW"}),add({"client_name":" "}),add({"coverage_need":"whenever"}),
     add({"only_ask":[{"axiscare_id":"x","name":"Dixie"}]}),add({"only_ask":"Dixie"}),add({"backup_phone":"555-12"},),add({"backup_phone":"4175551212"}),
     add({"note":"x"*2001}),add({"source_who":"  "}),add({"source_how":"carrier pigeon"}),add({})]
ck("refusals · no staff, no request id, a non-numeric client, no name, an unknown coverage choice, a bad only-ask list (two ways), a bad phone, a phone with no backup name, a note over 2000, no source, an unknown source, and an empty entry",
   [O(x) for x in bad]==["staff_required","request_id_required","axiscare_id_required","client_name_required","unknown_coverage_need","only_ask_invalid","only_ask_invalid",
    "backup_phone_invalid","backup_name_required","note_too_long","source_required","unknown_source_how","nothing_to_record"], [O(x) for x in bad])
ck("refusals · nothing was written", s.run("select count(*) from client_callin_entries")[0][0]==0)
req=str(uuid.uuid4())
r1=add({"request_id":req,"coverage_need":"if_we_can","only_ask":[{"axiscare_id":"11","name":"Dixie Ray"},{"axiscare_id":"12","name":"Autumn Reid"},{"axiscare_id":"11","name":"Dixie Ray"}],
        "backup_name":"Jan Moss","backup_phone":"1 (417) 555-1212","backup_relationship":"friend who covers","note":"Only Dixie or Autumn. If neither, call Jan.","source_how":"phone"})
row=s.run("select only_ask, backup_phone, entered_by, entered_by_name, source_who, source_how from client_callin_entries where id=:i",i=r1["id"])[0]
ck("recorded · the only-ask list is de-duplicated by AxisCare id, the phone is cleaned to 10 digits, the staff email is kept (lowercased) with their name, and who told us and how",
   O(r1)=="recorded" and [x["axiscare_id"] for x in row[0]]==["11","12"] and row[1]=="4175551212" and row[2]=="krystal@mo-care.com" and row[3]=="Krystal" and row[4]=="LeeAnn herself" and row[5]=="phone", row)
r1b=add({"request_id":req,"coverage_need":"must_cover"})
ck("a double click (same request id) records once", O(r1b)=="already_recorded" and r1b["id"]==r1["id"] and s.run("select count(*) from client_callin_entries")[0][0]==1)
import time; time.sleep(0.01)
r2=add({"coverage_need":"must_cover","note":"Daughter says coverage is a must on weekends.","source_who":"daughter Dana","source_how":"in_person"},staff="sam@mo-care.com",name="Samantha")
add({"axiscare_client_id":"502","client_name":"Ann Lee","coverage_need":"family_covers"})
cur=s.run("select axiscare_client_id, coverage_need, entered_by from client_callin_current order by 1")
ck("current plan · the latest entry per client wins; both entries stay in the history", cur==[["501","must_cover","sam@mo-care.com"],["502","family_covers","krystal@mo-care.com"]]
   and s.run("select count(*) from client_callin_entries where axiscare_client_id='501'")[0][0]==2, cur)
ck("append-only · entries can't be edited, deleted or truncated, even by the owner", all(err_code(f) is not None for f in [
   lambda: s.run("update client_callin_entries set note='x'"), lambda: s.run("delete from client_callin_entries"), lambda: s.run("truncate client_callin_entries")]))
ck("security · signed-in staff can read the plan and its history but can't write or use the door; anonymous gets nothing; the service role can't edit",
   err_code(lambda: au.run("select count(*) from client_callin_current")) is None and err_code(lambda: au.run("select count(*) from client_callin_entries")) is None
   and (err_code(lambda: add({"coverage_need":"flexible"},conn=au)) or "").startswith("42501")
   and (err_code(lambda: au.run("insert into client_callin_entries(request_id,axiscare_client_id,client_name,source_who,entered_by) values (gen_random_uuid(),'1','x','x','x')")) or "").startswith("42501")
   and (err_code(lambda: an.run("select count(*) from client_callin_current")) or "").startswith("42501")
   and (err_code(lambda: svc.run("update client_callin_entries set note='x'")) or "").startswith("42501"))
rc,out=c.psql(SQL)
ck("guard · once entries exist, a rerun refuses and changes nothing", rc!=0 and "refused" in out and s.run("select count(*) from client_callin_entries")[0][0]==3, out[-200:])
for x in (svc,au,an): x.close()
c.close()
print("\nCALL-IN PLAN · DISPOSABLE PROOF\n"+"="*60); ok=True
for nm,g,note in res: ok&=g; print(("PASS  " if g else "FAIL  ")+nm+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "%d FAILED"%sum(1 for r in res if not r[1]))
print("client-callin-plan migration sha256:", hashlib.sha256(SQL.encode()).hexdigest())
