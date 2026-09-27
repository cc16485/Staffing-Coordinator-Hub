#!/usr/bin/env python3
# 5b F · a folded inquiry's empty Journey is voided · disposable-Postgres proof. Never touches production.
import os, json, hashlib, datetime as dt
from zoneinfo import ZoneInfo
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
JC=open(os.path.join(H,"journey-connect.sql")).read()
FOLD=open(os.path.join(H,"lead-journey-fold.sql")).read()
res=[]
def ck(n,c_,note=""): res.append((n,bool(c_),"" if c_ else str(note)[:900]))

def fixture(tag):
    c=Cluster(tag); P=setup_supabase_like(c); s=c.su
    s.run("alter table person_source_id add column needs_review boolean not null default false, add column created_at timestamptz not null default now(), add column evidence text, add column imported_at timestamptz")
    s.run("create unique index person_source_axiscare_uniq on person_source_id (entity_type, source_id) where system = 'axiscare'")
    s.run("""create table person_role (id bigserial primary key, person_id uuid not null references person_identity(id), role text not null,
             status text not null default 'active', started_at date, ended_at date, end_reason text, updated_at timestamptz not null default now())""")
    s.run("create unique index person_role_one_active on person_role (person_id, role) where status = 'active'")
    s.run("""create table phone_index (id bigserial primary key, phone text not null, person_id uuid not null references person_identity(id),
             kind text, shared boolean not null default false, confidence text not null default 'confirmed', verification_status text not null default 'unverified')""")
    for t in ["person_role","phone_index"]:
        s.run(f"revoke all on {t} from anon"); s.run(f"grant select on {t} to authenticated"); s.run(f"grant all on {t} to service_role")
    for f in (MIG,)+tuple(open(os.path.join(H,x)).read() for x in ("staffing-foundation.sql","team-build-link.sql","lead-journey-mirror.sql","client-admission.sql","start-contract.sql","journey-connect.sql")):
        rc,out=c.psql(f); assert rc==0,out[-400:]
    s.run("insert into app_data(key,data) values ('ops_settings','{}'::jsonb) on conflict (key) do nothing")
    return c,P,s

c,P,s=fixture("fold"); svc=c.conn("service_role")
LEADS=[{"id":"K","status":"Contacted","client_first_name":"Ruth","client_last_name":"Adams","created_at":"2026-09-10T15:00:00Z"},
       {"id":"D","status":"New","client_first_name":"Ruth","client_last_name":"Adams","created_at":"2026-09-11T15:00:00Z"},
       {"id":"C1","status":"Contacted","client_first_name":"Earl","client_last_name":"Baker","created_at":"2026-09-01T15:00:00Z","axiscare_client_id":"AX50"},
       {"id":"F2","status":"New","client_first_name":"Earl","client_last_name":"Baker","created_at":"2026-09-12T15:00:00Z"},
       {"id":"X","status":"New","client_first_name":"Ann","client_last_name":"Gray","created_at":"2026-09-13T15:00:00Z","axiscare_client_id":"AX60"},
       {"id":"L","status":"New","client_first_name":"Joe","client_last_name":"Cole","created_at":"2026-09-02T15:00:00Z"}]
setleads=lambda L: s.run("update app_data set data=:d where key='leads'",d=json.dumps(L))
setleads(LEADS)
svc.run("select count(*) from public.lead_journey_mirror(true)")
EP={r[0]:r[1] for r in s.run("select source_ref, episode_id::text from episode_source where system='lead' and role='origin'")}
# C1 becomes a client's Journey (AX50); X too (AX60), so X is NOT empty
for lid,ax,nm in (("C1","AX50","Earl Baker"),("X","AX60","Ann Gray")):
    r=svc.run("select public.lead_journey_connect(:l,:a,:n,'typed','kat@cc.test','client_intake')",l=lid,a=ax,n=nm)[0][0]
    r=r if isinstance(r,dict) else json.loads(r); assert r["outcome"]=="connected", r
OUT=lambda commit: {r[0]:(r[1],r[2]) for r in svc.run("select lead_id, outcome, detail from public.lead_journey_mirror(:c)",c=commit)}
BEFORE=OUT(False)
JF0=journey_fp(c)

rc,out=c.psql(FOLD.replace("do $verify$","select 1/0;\ndo $verify$",1))
ck("install · an injected failure leaves the old mirror in place", rc!=0 and "lead_fold_live" not in s.run("select prosrc from pg_proc where proname='lead_journey_mirror'")[0][0], out[-200:])
rc,out=c.psql(FOLD); rc2,out2=c.psql(FOLD)
ck("install · installs, reruns, self-check passes", rc==0 and rc2==0, (out+out2)[-300:])
ck("switched off · the mirror answers exactly as before for every inquiry", OUT(False)==BEFORE, (OUT(False),BEFORE))

# people fold: D is marked a duplicate of K; F2 is folded into client AX50; X (connected) is folded too; N is folded before it ever had a Journey
L2=[dict(l) for l in LEADS]
for l in L2:
    if l["id"]=="D": l.update(archived=True, archive_reason="Duplicate", duplicate_of="K")
    if l["id"]=="F2": l.update(archived=True, archive_reason="Folded into client", folded_into={"kind":"client","axiscare_client_id":"AX50","by":"kat","at":"x"})
    if l["id"]=="X": l.update(archived=True, archive_reason="Duplicate", duplicate_of="K")
L2.append({"id":"N","status":"New","created_at":"2026-09-20T15:00:00Z","archived":True,"archive_reason":"Folded into client","folded_into":{"kind":"lead","lead_id":"K"}})
setleads(L2)
off=OUT(False)
ck("switched off · marking duplicates changes nothing yet (N would still get a Journey, as today)", off["D"][0]=="unchanged" and off["N"][0]=="would_open", off)
e0=s.run("select count(*) from journey_episode")[0][0]
s.run("update app_data set data = data || '{\"lead_fold_live\": true}'::jsonb where key='ops_settings'")
dry=OUT(False)
ck("preview · lists exactly the empty folded Journeys it would void, and where each points; writes nothing",
   dry["D"][0]=="would_void" and EP["K"] in dry["D"][1] and dry["F2"][0]=="would_void" and EP["C1"] in dry["F2"][1]
   and dry["X"][0]=="diverged" and "not empty" in dry["X"][1] and dry["N"][0]=="fold_skipped" and dry["K"][0]=="unchanged"
   and s.run("select count(*) from journey_episode where state='voided'")[0][0]==0, dry)
r=svc.run("select public.lead_journey_mirror_scheduled('manual')")[0][0]; r=r if isinstance(r,dict) else json.loads(r)
vd={x[0]:x[1:] for x in s.run("select e.episode_id::text, e.state, e.corrected_into_episode_id::text, e.voided_by, e.void_reason from journey_episode e where state='voided'")}
ck("live · D's Journey is voided and points at K's; F2's points at the client's (AX50) Journey; both say a person marked it",
   vd.get(EP["D"],[None])[0]=="voided" and vd[EP["D"]][1]==EP["K"] and vd[EP["F2"]][1]==EP["C1"] and "a person marked it" in vd[EP["D"]][3] and len(vd)==2, vd)
ck("live · a folded inquiry whose Journey belongs to a confirmed client is NOT touched (reported for Owner / Decision)",
   s.run("select state from journey_episode where episode_id=cast(:e as uuid)",e=EP["X"])[0][0]=="converted")
ck("live · no Journey is ever opened for an inquiry folded before it had one", s.run("select count(*) from episode_source where source_ref='N'")[0][0]==0
   and s.run("select count(*) from journey_episode")[0][0]==e0, e0)
ck("live · the kept Journeys and every other inquiry are untouched", s.run("select state from journey_episode where episode_id=cast(:e as uuid)",e=EP["K"])[0][0]=="provisional"
   and s.run("select state from journey_episode where episode_id=cast(:e as uuid)",e=EP["C1"])[0][0]=="converted"
   and s.run("select state from journey_episode where episode_id=cast(:e as uuid)",e=EP["L"])[0][0]=="provisional")
ck("run log · the voids count as closed, the skipped one as skipped, no errors", r["outcome"]=="ok" and r["closed"]==2 and r["errors"]==0 and r["skipped"]>=1 and r["diverged"]>=1, r)
again=OUT(True)
ck("rerun · nothing more happens (voided = unchanged)", again["D"][0]=="unchanged" and again["F2"][0]=="unchanged" and s.run("select count(*) from journey_episode where state='voided'")[0][0]==2, again)
par={x[0]:x[1] for x in s.run("select lead_id, state_match from lead_journey_parity")}
ck("parity · a folded, voided inquiry counts as matching", par["D"] is True and par["F2"] is True, par)
# the original rules still hold
L3=[dict(l) for l in L2]
for l in L3:
    if l["id"]=="L": l["status"]="Lost"
setleads(L3); o=OUT(True)
ck("the Lost rule still works (an empty Journey closes as lost)", o["L"][0]=="closed_lost", o["L"])
ck("security · the browser can't run the mirror or the fold helpers", all((err_code(lambda q=q: c.conn("authenticated").run(q)) or "").startswith("42501")
   for q in ("select public.lead_journey_mirror(false)","select public.lead_fold_intent('{}'::jsonb)","select public.lead_fold_target('{}'::jsonb)")))
ck("journey · Journey foundation definitions unchanged", journey_fp(c)==JF0)
svc.close(); c.close()
print("\n5b F · FOLDED INQUIRIES · DISPOSABLE PROOF\n"+"="*60); ok=True
for nm,g,note in res: ok&=g; print(("PASS  " if g else "FAIL  ")+nm+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "%d FAILED"%sum(1 for r in res if not r[1]))
print("lead-journey-fold sha256:", hashlib.sha256(FOLD.encode()).hexdigest())
