#!/usr/bin/env python3
# T0 · disposable-Postgres test of training_key_check.py (read only). Never touches production.
import os, sys, glob, tempfile, subprocess, json, hashlib
import pgserver
from pg8000.native import Connection
H=os.path.dirname(os.path.abspath(__file__)); HUB="/Users/samantha/Claude/Projects/Staffing-Coordinator-Hub/"
d=tempfile.mkdtemp(prefix="t0_"); srv=pgserver.get_server(d)
host=[kv[5:] for kv in srv.get_uri().split("?",1)[1].split("&") if kv.startswith("host=")][0]
sock=[p for p in glob.glob(os.path.join(host,".s.PGSQL.*")) if not p.endswith(".lock")][0]
s=Connection(user="postgres",database="postgres",unix_sock=sock)
for r in ["anon","authenticated","service_role"]: s.run(f"do $$ begin create role {r} nologin; exception when duplicate_object then null; end $$;")
KEY="cchub_TESTKEYVALUE_abcdefghijklmnopqrst"
s.run("create schema if not exists auth"); s.run("create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_app_meta_data jsonb)")
s.run("create table app_settings (key text primary key, value jsonb)"); s.run("insert into app_settings values ('hub_read_key', :v)", v=json.dumps({"key":KEY}))
s.run("create table app_data (key text primary key, data jsonb)")
s.run("insert into app_data values ('cc_hub_config', :a), ('team_hub_settings', :b), ('settings', :c), ('leads', '[]')",
      a=json.dumps({"training_hub_key":KEY}), b=json.dumps({"training_hub_key":"other"}), c=json.dumps({"x":{"y":KEY}}))
s.run("create table app_data_key_hub_map (data_key text, hub_slug text)"); s.run("insert into app_data_key_hub_map values ('cc_hub_config','care_coordinator'),('cc_hub_config','team_hub')")
s.run("create table persons (person_id uuid primary key, full_name text, active boolean)")
s.run("create table auth_identities (auth_user_id uuid, person_id uuid, project_ref text)")
s.run("create table entity_memberships (person_id uuid, entity text, active boolean, ended_at timestamptz)")
s.run("create table staff_roles (person_id uuid, entity text, role text)")
s.run("create function hub_training_status(p_key text) returns jsonb language plpgsql security definer as $$ begin if p_key <> (select value->>'key' from app_settings where key='hub_read_key') then raise exception 'no'; end if; return '{}'::jsonb; end $$")
s.run("grant execute on function hub_training_status(text) to anon, authenticated")
s.run("create function hub_offer_update(p_key text, p_id uuid) returns void language plpgsql security definer as $$ begin if p_key <> '"+KEY+"' then raise exception 'no'; end if; end $$")
s.run("revoke execute on function hub_offer_update(text,uuid) from public")
def user(hubs, role, active=True, member=True):
    uid=s.run("insert into auth.users (email, raw_app_meta_data) values ('x@t', :m) returning id", m=json.dumps({} if hubs is None else {"hub_access":hubs}))[0][0]
    if role:
        pid=s.run("select gen_random_uuid()")[0][0]
        s.run("insert into persons values (:p,'n',:a)",p=pid,a=active); s.run("insert into auth_identities values (:u,:p,'zngsgedlsxinbygwmxwn')",u=uid,p=pid)
        s.run("insert into entity_memberships values (:p,'cc_ihs',:m,null)",p=pid,m=member); s.run("insert into staff_roles values (:p,'cc_ihs',:r)",p=pid,r=role)
user(["care_coordinator","team_hub"],"owner_admin"); user(None,"care_coordinator"); user(["staffing"],"staffing_coordinator")
user(["staffing","team_hub"],"care_coordinator"); user(["care_coordinator"],None); user(["care_coordinator"],"care_coordinator",active=False)
rep=tempfile.mktemp(suffix=".txt"); defs=tempfile.mktemp(suffix=".sql")
p=subprocess.run([sys.executable, HUB+"training_key_check.py"], capture_output=True, text=True,
    env={**os.environ,"SB_REPORT":rep,"SB_LOCAL_SOCK":sock,"SB_DEFS_OUT":defs})
out=open(rep).read() if os.path.exists(rep) else p.stdout+p.stderr
res=[]
def ck(n,c,note=""): res.append((n,bool(c),"" if c else note))
ck("runs to the end", p.returncode==0 and "Nothing was changed" in out, out[-600:])
ck("never prints the key", KEY not in out and KEY[6:20] not in out)
ck("finds where the key is kept, and which copy matches", "cc_hub_config: the key is filled in: yes · it is the one the Training project accepts: yes · readable by: care_coordinator, team_hub" in out
   and "team_hub_settings: the key is filled in: yes · it is the one the Training project accepts: no · readable by: EVERY" in out, out)
ck("finds other records holding the value (names only)", "other shared records holding the same value: settings" in out, out)
ck("finds both key-checking functions, their run rights", "hub_training_status(p_key text) · runs as its owner: yes · anyone can run it: yes" in out
   and "hub_offer_update(p_key text, p_id uuid) · runs as its owner: yes · anyone can run it: no · any signed-in user: no" in out and "hub_job_offers exists: no" in out, out)
dd=open(defs).read() if os.path.exists(defs) else ""
ck("saves the definitions with the key blanked", "hub_offer_update" in dd and "<<the hub read key>>" in dd and KEY not in dd and "hub_training_status(p_key text): anon, authenticated, service_role" in dd, dd[:800])
ck("counts who the sign-in check lets in", "sign-ins in all: 6 · let in (office role, active): 2 · not office staff or not active: 2" in out
   and "turned away because their hub list lacks the Care Coordinator Hub: 2 (with Staffing Hub access: 2)" in out, out)
ck("reads each Training function's check from its source", "ghl-thread: not checked · from its source here it checks: the key only" in out and "ghl-reply: not checked · from its source here it checks: your Hub sign-in" in out
   and "ghl-attach-doc: not checked · from its source here it checks: no source here" in out, out)
ck("flags a key written into a function's code", "hub_offer_update(p_key text, p_id uuid) · runs as its owner: yes · anyone can run it: no · any signed-in user: no · checks the key: HAS THE KEY WRITTEN INTO ITS CODE" in out
   and "hub_training_status(p_key text) · runs as its owner: yes · anyone can run it: yes · any signed-in user: yes · checks the key: reads it from settings" in out, out)
for n,ok,note in res: print(("PASS" if ok else "FAIL")+" · "+n+("" if ok else "  ::  "+str(note)[:1500]))
print(f"{sum(r[1] for r in res)}/{len(res)}")
print("-----\n"+out)
