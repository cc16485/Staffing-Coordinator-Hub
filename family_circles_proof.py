#!/usr/bin/env python3
# Change 6a · Family Circles belong to a client · disposable-Postgres proof. Never touches production.
import os, json, hashlib
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
SQL=open(os.path.join(H,"family-circles-link.sql")).read()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[:800]))
J=lambda r: r if isinstance(r,dict) else json.loads(r)

c=Cluster("fc"); s=c.su
for r in ["anon","authenticated"]: s.run(f"do $$ begin create role {r} nologin; exception when duplicate_object then null; end $$;")
s.run("do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;")
s.run("grant usage on schema public to anon, authenticated, service_role")
s.run("create table person_identity (id uuid primary key default gen_random_uuid(), display_name text)")
s.run("create table person_source_id (person_id uuid, system text, entity_type text, source_id text)")
s.run("create table care_circles (id uuid primary key default gen_random_uuid(), client_name text, active boolean default true, created_at timestamptz default now())")
s.run("create table circle_contacts (id bigserial primary key, circle_id uuid, name text, phone text, source text, sms_consent boolean)")
for t in ("person_identity","person_source_id","care_circles","circle_contacts"):
    s.run(f"grant select on {t} to authenticated"); s.run(f"grant all on {t} to service_role")
s.run("grant all on care_circles to authenticated")   # the hub writes circles today
def person(name,ax):
    p=str(s.run("insert into person_identity(display_name) values (:n) returning id",n=name)[0][0])
    s.run("insert into person_source_id values (cast(:p as uuid),'axiscare','client',:a)",p=p,a=ax); return p
def circle(name,from_sync=True):
    cid=str(s.run("insert into care_circles(client_name) values (:n) returning id",n=name)[0][0])
    if from_sync: s.run("insert into circle_contacts(circle_id,name,source) values (cast(:c as uuid),'Someone','axiscare')",c=cid)
    return cid
person("Ruth Jones","501"); person("Ann Lee","502"); person("Bo Park","503"); person("Charles Thompson","504"); person("Sam Twin","505"); person("Sam Twin","506"); person("Cy Dunn","507")
C_RUTH=circle("Ruth Jones"); C_ANN=circle("ann lee "); C_BO=circle("Bo Park",from_sync=False)
C_CH1=circle("Charles Thompson"); C_CH2=circle("Charles Thompson"); C_SAM=circle("Sam Twin"); C_X=circle("Somebody Else")
ax=lambda cid: s.run("select axiscare_client_id from care_circles where id=cast(:c as uuid)",c=cid)[0][0]

rc,out=c.psql(SQL.replace("do $verify$","select 1/0;\ndo $verify$",1))
ck("install · an injected failure changes nothing (no columns, no links)", rc!=0 and not has_col(c,"care_circles","axiscare_client_id"), out[-200:])
rc,out=c.psql(SQL); rc2,out2=c.psql(SQL)
ck("install · installs; a rerun (only install links so far) succeeds; self-check passes", rc==0 and rc2==0, (out+out2)[-300:])
ck("install links · the sync's own exact matches are linked, spacing and capitals aside (Ruth, Ann)", ax(C_RUTH)=="501" and ax(C_ANN)=="502")
ck("install links · a circle typed by hand is NOT linked, even with an exact name (Bo)", ax(C_BO) is None)
ck("install links · two circles with the same name: neither is linked (Charles)", ax(C_CH1) is None and ax(C_CH2) is None)
ck("install links · two AxisCare clients with the same name: not linked (Sam)", ax(C_SAM) is None)
ck("install links · recorded in the log as the install's", s.run("select count(*) from family_circle_link_log where action='install_link'")[0][0]==2)
svc=c.conn("service_role")
L=lambda cid,a,staff="kat@cc.test",how="person",conn=None: J((conn or svc).run("select public.family_circle_link(:c,:a,:s,:h)",c=cid,a=a,s=staff,h=how)[0][0])
U=lambda cid,reason,staff="kat@cc.test": J(svc.run("select public.family_circle_unlink(:c,:s,:r)",c=cid,s=staff,r=reason)[0][0])
O=lambda r:r.get("outcome")
refs=[L(C_BO,"503",staff=" "),L(C_BO,"abc"),L("00000000-0000-0000-0000-000000000000","503"),L(C_BO,"999"),L(C_BO,"501"),L(C_RUTH,"503")]
ck("link refusals · no person, a non-numeric id, an unknown circle, a client with no hub person, a client who already has a circle, a circle linked elsewhere",
   [O(r) for r in refs]==["staff_required","axiscare_id_required","circle_not_found","not_a_hub_client","client_has_a_circle","linked_elsewhere"], [O(r) for r in refs])
r=L(C_BO,"503")
ck("link · a person links Bo's circle; who, when and how are kept, and logged", O(r)=="linked" and ax(C_BO)=="503"
   and s.run("select linked_by, link_how from care_circles where id=cast(:c as uuid)",c=C_BO)==[["kat@cc.test","person"]]
   and s.run("select count(*) from family_circle_link_log where action='link'")[0][0]==1, r)
ck("link · repeating it is harmless", O(L(C_BO,"503"))=="already_linked")
ck("unlink · needs a reason", O(U(C_RUTH,"no"))=="reason_required" and ax(C_RUTH)=="501")
r=U(C_RUTH,"linked to the wrong Ruth"); r2=L(C_RUTH,"501")
ck("unlink then relink · both recorded with who and why", O(r)=="unlinked" and O(r2)=="linked"
   and s.run("select action, reason from family_circle_link_log where circle_id=:c order by id",c=C_RUTH)[-2:]==[["unlink","linked to the wrong Ruth"],["link","person"]])
ck("one active circle per client · a second active circle on the same client is refused by the database",
   err_code(lambda: s.run("update care_circles set axiscare_client_id='501' where id=cast(:c as uuid)",c=C_X)) is not None)
s.run("update care_circles set active=false where id=cast(:c as uuid)",c=C_CH2)
ck("an inactive old circle doesn't block linking the active one", O(L(C_CH1,"504"))=="linked")
au=c.conn("authenticated"); an=c.conn("anon")
ck("append-only · the link log can't be edited, deleted or truncated", all(err_code(f) is not None for f in [lambda: s.run("update family_circle_link_log set staff='x'"),
   lambda: s.run("delete from family_circle_link_log"), lambda: s.run("truncate family_circle_link_log")]))
ck("security · signed-in staff read the log but cannot link or write it; anonymous gets nothing",
   err_code(lambda: au.run("select count(*) from family_circle_link_log")) is None
   and (err_code(lambda: L(C_X,"507",conn=au)) or "").startswith("42501")
   and (err_code(lambda: au.run("insert into family_circle_link_log(circle_id,action,staff) values ('x','link','x')")) or "").startswith("42501")
   and (err_code(lambda: an.run("select count(*) from family_circle_link_log")) or "").startswith("42501"))
rc,out=c.psql(SQL); ck("guard · once people have linked circles the migration refuses and changes nothing", rc!=0 and "refused" in out, out[-200:])
for x in (svc,au,an): x.close()
c.close()
print("\nCHANGE 6a · FAMILY CIRCLES BELONG TO A CLIENT · DISPOSABLE PROOF\n"+"="*60)
ok=True
for nm,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+nm+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "%d FAILED"%sum(1 for r in res if not r[1]))
print("family-circles-link migration sha256:", hashlib.sha256(SQL.encode()).hexdigest())
