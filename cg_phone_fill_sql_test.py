# 921 · caregiver_phone_fill on a real local Postgres, with 421 safe saving and 438 installed.
#   python3 cg_phone_fill_sql_test.py
import os, json, glob, shutil, tempfile
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
D = tempfile.mkdtemp(prefix="cgphpg-"); shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
srv = pgserver.get_server(D)
host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
c = conn()
c.run("drop schema if exists public cascade; create schema public")
for r in ("anon", "authenticated", "service_role"):
    try: c.run(f"create role {r}")
    except DatabaseError: pass
c.run("grant usage on schema public to anon, authenticated, service_role")
c.run("create table app_data(key text primary key, data jsonb, updated_at timestamptz default now())")
c.run("create function can_access_data_key(k text) returns boolean language sql as $$ select true $$")
c.run(open(os.path.join(HERE, "safe_saves_2.sql")).read())
c.run("begin"); c.run(open(os.path.join(HERE, "cg_connect.sql")).read()); c.run("commit")
SQL = open(os.path.join(HERE, "cg_phone_fill.sql")).read()
c.run(SQL); c.run(SQL)   # safe to run again
c.close()
res = []
def ck(n, cond, d=""): res.append((n, bool(cond), "" if cond else str(d)[:900]))
def q(sql, **k):
    cc = conn()
    try: return cc.run(sql, **k)
    finally: cc.close()
J = json.dumps
def fill(p): return q("select caregiver_phone_fill(cast(:j as jsonb))", j=J(p))[0][0]
def rec(id_): return next((x for x in q("select data from app_data where key='caregivers'")[0][0] if str(x.get("id")) == str(id_)), None)
def reset(cgs):
    q("delete from app_data")
    q("insert into app_data(key, data) values ('caregivers', cast(:j as jsonb))", j=J(cgs))

reset([{"id": 31, "first": "Ada", "axiscare_id": "201", "phone": ""}, {"id": 32, "first": "Ben", "axiscare_id": "202", "phone": "417 555 9999"},
       {"id": 33, "first": "Cal", "axiscare_id": "203", "phone": "555-12"}, {"id": 34, "first": "Dee", "phone": ""}])
r31 = rec(31); rv = r31.get("_rev", 0)   # never saved since it was put there: reads as 0, as app_data_rev reads it
out = fill({"caregiver_id": "31", "axiscare_id": "201", "phone": "(417) 555-0201", "field": "homePhone", "base_rev": rv})
a = rec(31)
ck("a blank Hub phone is filled with AxisCare's number, saying where it came from", out.get("ok") and a["phone"] == "(417) 555-0201"
   and a["phone_from"]["source"] == "axiscare" and a["phone_from"]["field"] == "homePhone" and a["phone_from"]["by"] == "caregiver-connect" and "was" not in a["phone_from"], [out, a])
ck("the rest of the record is untouched and it gets a new _rev", a["first"] == "Ada" and a["axiscare_id"] == "201" and a.get("_rev") != rv, a)
out = fill({"caregiver_id": "32", "axiscare_id": "202", "phone": "4175550202", "field": "mobilePhone"})
ck("a usable Hub number is NEVER replaced", out == {"ok": False, "reason": "has_phone"} and rec(32)["phone"] == "417 555 9999", [out, rec(32)])
out = fill({"caregiver_id": "33", "axiscare_id": "203", "phone": "4175550203", "field": "mobilePhone"})
ck("a broken number (under 10 digits) is filled, and what was there is kept on the record", out.get("ok") and rec(33)["phone"] == "4175550203" and rec(33)["phone_from"]["was"] == "555-12", rec(33))
out = fill({"caregiver_id": "34", "axiscare_id": "204", "phone": "4175550204"})
ck("a record not connected to that AxisCare caregiver is refused", out == {"ok": False, "reason": "not_theirs"} and rec(34)["phone"] == "", out)
out = fill({"caregiver_id": "99", "axiscare_id": "299", "phone": "4175550299"})
ck("a record that is gone is refused", out == {"ok": False, "reason": "gone"}, out)
reset([{"id": 41, "first": "Eve", "axiscare_id": "301", "phone": ""}])
old = rec(41).get("_rev", 0)   # a record never saved since reads as 0, as app_data_rev reads it
q("update app_data set data = cast(:d as jsonb) where key = 'caregivers'", d=J([{"id": 41, "first": "Eve", "axiscare_id": "301", "phone": "", "note": "saved by a person"}]))
out = fill({"caregiver_id": "41", "axiscare_id": "301", "phone": "4175550301", "base_rev": old})
ck("someone saved the record a moment ago: nothing changes (the next hour tries again)", out == {"ok": False, "reason": "changed"} and rec(41)["phone"] == "" and rec(41)["note"] == "saved by a person", out)
for bad in ({"caregiver_id": "41", "axiscare_id": "301", "phone": "555-0301"}, {"caregiver_id": "41", "phone": "4175550301"}, {"axiscare_id": "301", "phone": "4175550301"}):
    try: fill(bad); ck("a call without a record, an AxisCare id and a 10-digit phone is an error: " + J(bad), False)
    except DatabaseError: ck("a call without a record, an AxisCare id and a 10-digit phone is an error: " + J(bad), True)
ck("only the server may call it", not q("select has_function_privilege('authenticated', 'public.caregiver_phone_fill(jsonb)', 'execute')")[0][0]
   and not q("select has_function_privilege('anon', 'public.caregiver_phone_fill(jsonb)', 'execute')")[0][0]
   and q("select has_function_privilege('service_role', 'public.caregiver_phone_fill(jsonb)', 'execute')")[0][0])
ck("the run line can record how many phones were filled", q("select count(*) from information_schema.columns where table_name = 'caregiver_connect_runs' and column_name = 'phones_filled'")[0][0] == 1)
for n, ok, note in res: print(("  ✓ " if ok else "  ✗ ") + n + ("" if ok else "\n     " + note))
print(f"\n  921 caregiver_phone_fill: {sum(1 for r in res if r[1])}/{len(res)} passed")
srv.cleanup() if hasattr(srv, "cleanup") else None
shutil.rmtree(D, ignore_errors=True)
raise SystemExit(0 if all(r[1] for r in res) else 1)
