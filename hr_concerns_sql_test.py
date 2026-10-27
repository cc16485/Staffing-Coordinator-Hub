#!/usr/bin/env python3
# Rehearsal of hr_concerns.sql (Tell Zach + New coaching talk, 2026-10-27) in a throwaway LOCAL Postgres (pgserver), with
# stand-ins for the Hub's sign-in helpers and the coaching tracker's assign. Never touches Supabase.   python3 hr_concerns_sql_test.py
import os, tempfile, glob, json
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:600]))
D = tempfile.mkdtemp(prefix="thrc-"); srv = pgserver.get_server(D)
host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
db = Connection(user="postgres", database="postgres", unix_sock=SOCK)
db.run("drop database if exists hrc"); db.run("create database hrc"); db = Connection(user="postgres", database="hrc", unix_sock=SOCK)
for r in ("anon", "authenticated", "service_role"): db.run(f"do $$ begin create role {r}; exception when duplicate_object then null; end $$")
for q in """create schema auth
create table auth.users (id uuid primary key, email text)
create table public.me_now (uid uuid)
create function auth.uid() returns uuid language sql stable as 'select uid from public.me_now limit 1'
create table public.persons (person_id uuid primary key, full_name text, primary_email text, active boolean default true)
create table public.staff_roles (person_id uuid, entity text, role text)
create table public.auth_ids (uid uuid, person_id uuid)
create function public.desk_me() returns uuid language sql stable as 'select person_id from public.auth_ids where uid = auth.uid()'
create function public.desk_hub_ok() returns boolean language sql stable as 'select auth.uid() is not null'
create function public.desk_is_owner() returns boolean language sql stable as $$select exists (select 1 from public.staff_roles r where r.person_id = public.desk_me() and r.role = 'owner_admin')$$
create function public.hr_lead_email() returns text language sql stable as $$select 'zach@mo-care.com'$$
create function public.hr_short_name(n text) returns text language sql immutable as $$select split_part(n, ' ', 1) || ' ' || left(split_part(n, ' ', 2), 1) || '.'$$
create table public.cards (item jsonb)
create function public.upsert_app_data_item(target_key text, item jsonb) returns void language sql as $$delete from public.cards where item->>'id' = item->>'id'; insert into public.cards values (item)$$
create table public.assigned (p jsonb)
create table public.hr_cases (id text primary key, axiscare_caregiver_id text not null, caregiver text not null, kind text not null check (kind in ('recognition','coaching','recurring','serious')), rule text not null, title text not null, facts jsonb not null default '[]', handbook text not null default '', source_ids text[] not null default '{}', practice boolean not null default true, status text not null default 'open', review text, review_note text, reviewed_by text, reviewed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now())
grant select on public.hr_cases to authenticated""".split("\n"):
    db.run(q)
db.run("""create function public.hr_coaching_act(p_id uuid, p_action text, p jsonb) returns jsonb language plpgsql as $f$
  declare k public.hr_cases; begin
  if not public.desk_is_owner() then raise exception 'Only Samantha or Zach assigns coaching.'; end if;
  select * into k from public.hr_cases where id = p->>'case_id';
  if k.kind not in ('coaching','recognition') then raise exception 'Only a coaching or recognition case is assigned'; end if;
  if nullif(p->>'due_on', '') is null then raise exception 'Pick a due date'; end if;
  insert into public.assigned values (p); update public.hr_cases set status = 'reviewed' where id = k.id; return jsonb_build_object('assigned', true); end $f$""")
U = {"zach": "11111111-0000-0000-0000-000000000001", "krystal": "11111111-0000-0000-0000-000000000002", "stef": "11111111-0000-0000-0000-000000000003", "nobody": "11111111-0000-0000-0000-000000000004"}
ROLE = {"zach": "owner_admin", "krystal": "care_coordinator", "stef": "staffing_coordinator"}
for n, u in U.items():
    db.run("insert into auth.users values (cast(:u as uuid), :e)", u=u, e=n + "@mo-care.com")
    if n in ROLE:
        db.run("insert into public.persons values (cast(:u as uuid), :f, :e)", u=u, f=n.title() + " Test", e=n + "@mo-care.com")
        db.run("insert into public.auth_ids values (cast(:u as uuid), cast(:u as uuid))", u=u); db.run("insert into public.staff_roles values (cast(:u as uuid), 'cc_ihs', :r)", u=u, r=ROLE[n])
def as_(n): db.run("delete from public.me_now"); db.run("insert into public.me_now values (cast(:u as uuid))", u=U[n])
def tryq(q, **kw):
    try: return db.run(q, **kw), ""
    except DatabaseError as e: return None, str(e)
SQL = open(os.path.join(HERE, "hr_concerns.sql")).read()
ck("it applies", tryq(SQL)[1] == "", tryq(SQL)[1]); ck("it applies again (safe to rerun)", tryq(SQL)[1] == "")
TODAY = db.run("select ((now() at time zone 'America/Chicago')::date)::text")[0][0]
add = lambda p: tryq("select public.hr_case_add(cast(:p as jsonb))", p=json.dumps(p))
C = {"type": "concern", "caregiver": "Ashley  Lloyd", "axiscare_id": "77", "what": "Her incident report says Carol was not hurt; her note says Carol hit her hip.", "happened_on": TODAY}
as_("nobody"); ck("someone not on staff is refused", "Only the office" in add(C)[1])
as_("krystal"); r, e = add({**C, "what": "short"}); ck("Tell Zach needs a sentence", "Say what happened" in e)
r, e = add({**C, "happened_on": "2099-01-01"}); ck("...and a real day", "day it happened" in e)
r, e = add({**C, "caregiver": "Ashley"}); ck("...and a first and last name", "first and last" in e)
r, e = add(C); ck("a care coordinator tells Zach", e == "", e)
k = db.run("select caregiver, kind, rule, practice, status, raised_by, raised_by_name, facts from public.hr_cases where rule = 'office_concern'")[0]
ck("...an open, real (not practice) case for Zach, with who raised it", k[0] == "Ashley Lloyd" and k[1] == "recurring" and k[3] is False and k[4] == "open" and k[5] == "krystal@mo-care.com" and k[6] == "Krystal Test" and "hit her hip" in json.dumps(k[7]), k)
card = db.run("select item from public.cards where item->>'id' like 'ops_hrconcern_%'")[0][0]
ck("...a sensitive card on Zach's My Work that opens his Incidents page, no details on it", card["owner"] == "zach@mo-care.com" and card["sensitive"] is True and card["link"] == "#hr/incidents" and card["status"] == "open" and "hip" not in json.dumps(card) and card["title"] == "From the office: Ashley L.", card)
as_("stef"); r, e = add({**C, "serious": "true"}); ck("a staffing coordinator can tell Zach too; serious makes it urgent", e == "" and db.run("select count(*) from public.hr_cases where kind = 'serious'")[0][0] == 1
  and any(c[0]["urgency"] == "urgent" for c in db.run("select item from public.cards")), e)
r, e = add({**C, "type": "coaching", "topic": "Calling the office", "assigned_to": "krystal@mo-care.com", "due_on": TODAY}); ck("a coordinator cannot add a coaching talk", "Only Samantha or Zach adds" in e)
as_("zach"); r, e = add({**C, "type": "coaching", "topic": "", "assigned_to": "krystal@mo-care.com", "due_on": TODAY}); ck("a coaching talk needs what it is about", "what the talk is about" in e)
r, e = add({**C, "type": "coaching", "topic": "Calling the office after an incident", "assigned_to": "krystal@mo-care.com", "due_on": TODAY, "talking_points": "Ashley, ..."})
ck("Zach adds a coaching talk: a coaching case, assigned the same way as the agent's", e == "" and db.run("select count(*) from public.hr_cases where rule = 'owner_coaching' and kind = 'coaching' and status = 'reviewed'")[0][0] == 1
  and json.loads(json.dumps(db.run("select p from public.assigned")[0][0]))["assigned_to"] == "krystal@mo-care.com", e)
r, e = add({**C, "type": "coaching", "topic": "Calling the office", "assigned_to": "krystal@mo-care.com", "due_on": ""}); ck("...a bad assignment saves nothing (all or nothing)", "due date" in e and db.run("select count(*) from public.hr_cases where rule = 'owner_coaching'")[0][0] == 1)
cid = db.run("select id from public.hr_cases where rule = 'office_concern' and kind = 'recurring'")[0][0]
dec = lambda i, p: tryq("select public.hr_case_decide(:i, cast(:p as jsonb))", i=i, p=json.dumps(p))
as_("krystal"); ck("a coordinator cannot decide", "Only Samantha or Zach decides" in dec(cid, {"decision": "nothing", "note": "fine now"})[1])
as_("zach"); ck("nothing more needs why", "why nothing" in dec(cid, {"decision": "nothing"})[1])
r, e = dec(cid, {"decision": "coaching", "assigned_to": "krystal@mo-care.com", "due_on": TODAY, "talking_points": "x"})
k = db.run("select kind, status, decision, decided_by from public.hr_cases where id = :i", i=cid)[0]
ck("Zach decides coaching: it becomes a coaching case, assigned, decided by him", e == "" and k == ["coaching", "reviewed", "coaching", "zach@mo-care.com"], [e, k])
ck("...his card closes", db.run("select item->>'status' from public.cards where item->>'source_id' = :i", i=cid)[0][0] == "done")
ck("...decided once", "Already decided" in dec(cid, {"decision": "nothing", "note": "changed my mind"})[1])
sid = db.run("select id from public.hr_cases where kind = 'serious'")[0][0]
r, e = dec(sid, {"decision": "formal"}); ck("a formal case decision is saved (the Hub then opens the write-up draft)", e == "" and db.run("select status, decision from public.hr_cases where id = :i", i=sid)[0] == ["reviewed", "formal"], e)
oid = db.run("select id from public.hr_cases where rule = 'owner_coaching'")[0][0]
ck("only office concerns are decided here", "not on file" in dec(oid, {"decision": "nothing", "note": "x x x x"})[1])
ck("the public key and signed-in pages cannot add cases directly", not db.run("select has_function_privilege('anon', 'public.hr_case_add(jsonb)', 'execute') or has_table_privilege('authenticated', 'public.hr_cases', 'insert')")[0][0])
srv.cleanup() if hasattr(srv, "cleanup") else None
for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n      " + note))
print(f"\n{sum(1 for r in res if r[1])}/{len(res)} passed"); raise SystemExit(0 if all(r[1] for r in res) else 1)
