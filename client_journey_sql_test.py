#!/usr/bin/env python3
# The client journey tables on a throwaway local Postgres: constraints, permanent history, TEST journeys removable.
import os, json
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:600]))
c = conn(); setup(c)
c.run("drop schema if exists storage cascade; create schema storage; create table storage.buckets(id text primary key, name text, public boolean)")
c.run("do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$")
sql = open(os.path.join(HERE, "client-journey", "client-journey.sql")).read()
c.run(sql)
ck("installs (tables, triggers, private bucket)", c.run("select count(*) from storage.buckets b where b.id = 'client-journey-files' and b.public is false")[0][0] == 1, c.run("select * from storage.buckets"))
c.run(sql); ck("installs twice without error (safe to re-run)", True)
def err(q):
    try: c.run(q); return None
    except DatabaseError as e: c.run("rollback") if False else None; return str(e)
j = c.run("insert into client_journey(lead_id, client_name, created_by) values ('L1','Test Linda','x') returning journey_id")[0][0]
t = c.run("insert into client_journey(lead_id, client_name, created_by, is_test) values ('T1','TEST Bea','x', true) returning journey_id")[0][0]
ck("a journey needs a lead or an AxisCare client", err("insert into client_journey(client_name, created_by) values ('x','x')") is not None)
ck("CDS is not a payer here", err("insert into client_journey(lead_id, client_name, created_by, payer) values ('L9','x','x','cds')") is not None)
ck("one journey per lead", err("insert into client_journey(lead_id, client_name, created_by) values ('L1','dupe','x')") is not None)
ck("waiting without a check-back date is refused (non-negotiable)", err(f"insert into client_journey_step(journey_id, step_key, state) values ('{j}','med.careplan','waiting')") is not None)
ck("...with one it's fine", err(f"insert into client_journey_step(journey_id, step_key, state, waiting_on, check_back) values ('{j}','med.careplan','waiting','the state','2026-10-10')") is None)
ck("blocked needs a reason", err(f"insert into client_journey_step(journey_id, step_key, state) values ('{j}','x.a','blocked')") is not None)
ck("an owner exception needs who and a written reason", err(f"""insert into client_journey_step(journey_id, step_key, state, exception) values ('{j}','x.b','exception','{{"by":"s"}}')""") is not None
   and err(f"""insert into client_journey_step(journey_id, step_key, state, exception) values ('{j}','x.c','exception','{{"by":"s","reason":"ok"}}')""") is None)
c.run(f"insert into client_journey_event(journey_id, actor_email, kind) values ('{j}','a@x','completed'), ('{t}','a@x','completed')")
ck("history rows are stamped test / not test from their journey", c.run(f"select is_test from client_journey_event where journey_id='{t}'")[0][0] is True and c.run(f"select is_test from client_journey_event where journey_id='{j}'")[0][0] is False)
ck("real history can't be changed", err(f"update client_journey_event set reason='x' where journey_id='{j}'") is not None)
ck("...or deleted", err(f"delete from client_journey_event where journey_id='{j}'") is not None)
ck("...and so a real journey can't be deleted out from under it", err(f"delete from client_journey where journey_id='{j}'") is not None)
ck("a TEST journey (and its history) can be removed after testing", err(f"delete from client_journey where journey_id='{t}'") is None and c.run(f"select count(*) from client_journey_event where journey_id='{t}'")[0][0] == 0)
ck("signed-in users (authenticated) have no access to these tables", c.run("select count(*) from information_schema.role_table_grants where grantee in ('authenticated','anon') and table_name like 'client_journey%'")[0][0] == 0)
c.close()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
