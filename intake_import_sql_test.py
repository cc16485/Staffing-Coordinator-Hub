# 443 · candidate_import_apply / intake_import_practice on a real local Postgres, set up like production (421 safe saving,
# the 442 lock on whole-list saves, a non-superuser table owner). python3 intake_import_sql_test.py
import os, json, glob, shutil, tempfile, threading
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
D = tempfile.mkdtemp(prefix="iipg-"); shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
srv = pgserver.get_server(D)
host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
c = conn()
c.run("drop schema if exists public cascade; create schema public")
for r in ("anon", "authenticated", "service_role", "tab_owner"):
    try: c.run(f"create role {r}")
    except DatabaseError: pass
c.run("alter role service_role bypassrls")
c.run("grant usage, create on schema public to tab_owner; grant usage on schema public to anon, authenticated, service_role")
c.run("set role tab_owner")
c.run("create table app_data(key text primary key, data jsonb, updated_at timestamptz default now())")
c.run("create function can_access_data_key(k text) returns boolean language sql security definer as $$ select true $$")
c.run("alter table app_data enable row level security")
c.run("create policy hub_rw on app_data for all to authenticated using (true) with check (true)")
c.run("grant select, insert, update, delete on app_data to authenticated; grant all on app_data to service_role")
c.run("""create table hire_intake(id uuid primary key default gen_random_uuid(), first_name text, last_name text, phone text, email text, ssn text,
          lived_outside_mo boolean, refs jsonb, no_employer_history boolean, created_at timestamptz default now(), seen_at timestamptz)""")
c.run("grant select, insert, update on hire_intake to service_role")
c.run(open(os.path.join(HERE, "safe_saves_2.sql")).read())
c.run("begin"); c.run(open(os.path.join(HERE, "people_lock.sql")).read()); c.run("commit")
S = open(os.path.join(HERE, "intake_import.sql")).read()
c.run("begin"); c.run(S); c.run("commit"); c.run("begin"); c.run(S); c.run("commit")
c.run("reset role")
c.close()
res = []
def ck(n, cond, d=""): res.append((n, bool(cond), "" if cond else str(d)[:700]))
def q(sql, role=None, **k):
    cc = conn()
    try:
        if role: cc.run(f"set role {role}")
        return cc.run(sql, **k)
    finally: cc.close()
J = json.dumps
def cands(): return q("select data from app_data where key='candidates'")[0][0]
def reset():
    q("delete from intake_import_log; delete from hire_intake; delete from app_data")
    q("insert into app_data(key, data) values ('candidates', '[{\"id\":10,\"first\":\"Old\"}]'), ('caregivers', '[{\"id\":5,\"intake_id\":\"roster-form\"}]')")
    q("update app_data_id_counter set last_id = 12 where key = 'candidates'")
def form(**kw):
    return q("insert into hire_intake(first_name, last_name, phone, ssn) values (:f, 'A', '4175550199', '123456789') returning id::text", f=kw.get("f", "Ava"))[0][0]
REC = lambda i: {"first": "Ava", "last": "A", "intake_id": i, "notes": "auto", "oig": "Pending"}
def imp(i, rec=None): return q("select candidate_import_apply(:i, cast(:r as jsonb), 'auto', 'r1')", role="service_role", i=i, r=J(rec or REC(i)))[0][0]
reset(); i1 = form()
r = imp(i1)
cs = cands(); row = q("select seen_at is not null, auto_import_result, auto_import_candidate_id from hire_intake where id::text = :i", i=i1)[0]
ck("imports: the candidate is added with the next number (13), never a reused one", r["ok"] and r["candidate_id"] == 13 and cs[-1]["id"] == 13 and cs[-1]["intake_id"] == i1 and cs[0] == {"id": 10, "first": "Old"}, [r, cs])
ck("...and the start form is marked imported in the same step (seen, which candidate)", row == [True, "imported", 13], row)
ck("...and logged, by first name and last initial only", q("select who, action, result, candidate_id from intake_import_log")[0] == ["Ava A", "import", "done", 13])
r = imp(i1)
ck("the same form again: refused as already imported, nothing added", not r["ok"] and r["reason"] == "already" and len(cands()) == 2, r)
reset(); q("insert into hire_intake(id, first_name, phone) values ('00000000-0000-0000-0000-0000000000aa', 'Ro', '1')")
q("update app_data set data = cast(:d as jsonb) where key='caregivers'", d=J([{"id": 5, "intake_id": "00000000-0000-0000-0000-0000000000aa"}]))
r = imp("00000000-0000-0000-0000-0000000000aa")
ck("a form someone already moved to the roster: refused, marked done, nothing added", not r["ok"] and r["reason"] == "already" and len(cands()) == 1
   and q("select auto_import_result from hire_intake where first_name='Ro'")[0][0] == "done", r)
reset(); i2 = form(); q("update hire_intake set seen_at = now() where id::text = :i", i=i2)
r = imp(i2)
ck("a form a person already handled (seen): refused, nothing added", not r["ok"] and r["reason"] == "seen" and len(cands()) == 1, r)
ck("a form that is gone: refused", imp("00000000-0000-0000-0000-00000000ffff")["reason"] == "gone")
try: imp(form(), REC("some-other-form")); bad = False
except DatabaseError: bad = True
ck("a record built from a different form is refused outright", bad and len(cands()) == 1)
reset(); i3 = form(); out = []
def go():
    try: out.append(imp(i3))
    except Exception as e: out.append({"err": str(e)})
ts = [threading.Thread(target=go) for _ in range(4)]; [t.start() for t in ts]; [t.join() for t in ts]
ck("four runs at once on one form: exactly one candidate", sum(1 for o in out if o.get("ok")) == 1 and len([x for x in cands() if x.get("intake_id") == i3]) == 1, out)
ck("the lock from step 5 is on and the import still works (it runs as the table's owner)", q("select count(*) from pg_policies where policyname like 'app_data_people_lock_%'")[0][0] == 3)
n = q("select intake_import_practice('p1', cast(:r as jsonb))", role="service_role", r=J([{"intake_id": "x1", "who": "Ava A", "action": "import", "reason": "new"}, {"intake_id": "x2", "who": "Bo B", "action": "card", "reason": "no_offer"}, {"intake_id": "", "action": "import"}]))[0][0]
n2 = q("select intake_import_practice('p2', cast(:r as jsonb))", role="service_role", r=J([{"intake_id": "x3", "who": "Cy C", "action": "card", "reason": "in_bgr"}]))[0][0]
ck("practice: the newest list replaces the last one", n == 2 and n2 == 1 and q("select run_id, intake_id, result from intake_import_log where result = 'would'") == [["p2", "x3", "would"]])
def can(role, s):
    cc = conn()
    try: cc.run("begin"); cc.run(f"set local role {role}"); cc.run(s); return True
    except DatabaseError: return False
    finally:
        try: cc.run("rollback")
        except Exception: pass
        cc.close()
ck("signed-in staff and the public can't call the writer", not can("authenticated", "select candidate_import_apply('x', '{}'::jsonb)") and not can("anon", "select candidate_import_apply('x', '{}'::jsonb)"))
ck("staff can read what it did; the public can't", can("authenticated", "select * from intake_import_log") and can("authenticated", "select * from intake_import_runs") and not can("anon", "select * from intake_import_log"))
ck("the writer never touches the SSN", "ssn" not in S.lower().replace("never reads or writes the ssn", ""))
for n_, ok, d in res: print(("PASS  " if ok else "FAIL  ") + n_ + ("" if ok else "  " + d))
print(f"\n{sum(1 for r in res if r[1])}/{len(res)} passed")
raise SystemExit(0 if all(r[1] for r in res) else 1)
