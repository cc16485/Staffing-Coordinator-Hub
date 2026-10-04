# 441 · caregiver_sweep_patch on a real local Postgres with 421 safe saving installed. python3 sweep_fields_sql_test.py
import os, json, glob, shutil, tempfile
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
D = tempfile.mkdtemp(prefix="swpg-"); shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
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
S = open(os.path.join(HERE, "sweep_fields.sql")).read()
c.run("begin"); c.run(S); c.run("commit"); c.run("begin"); c.run(S); c.run("commit")
c.close()
res = []
def ck(n, cond, d=""): res.append((n, bool(cond), "" if cond else str(d)[:700]))
def q(sql, **k):
    cc = conn()
    try: return cc.run(sql, **k)
    finally: cc.close()
J = json.dumps
def rec(i): return next(x for x in q("select data from app_data where key='caregivers'")[0][0] if str(x["id"]) == str(i))
def patch(i, r, p): return q("select caregiver_sweep_patch(:i, :r, cast(:p as jsonb))", i=str(i), r=r, p=J(p))[0][0]
def reset():
    q("delete from app_data")
    q("insert into app_data(key, data) values ('caregivers', cast(:d as jsonb))", d=J([{"id": 5, "first": "Jo", "phone": "1"}, {"id": 6, "first": "Ann"}]))
reset()
r = patch(5, 0, {"eligibility_state": "eligible", "eligibility_at": "t", "eligibility_history": [{"state": "eligible"}], "axiscare_note_for": None})
g = rec(5)
ck("saves the sweep's fields on the record it read; nothing else touched", r["ok"] and g["eligibility_state"] == "eligible" and g["first"] == "Jo" and g["phone"] == "1" and g["axiscare_note_for"] is None and r["rev"] == 1 and g["_rev"] == 1, [r, g])
ck("the other caregiver is untouched", rec(6) == {"id": 6, "first": "Ann"})
cg = q("select data from app_data where key='caregivers'")[0][0]; cg[0]["phone"] = "2"
q("update app_data set data = cast(:d as jsonb) where key='caregivers'", d=J(cg))    # an office edit: _rev 2
r = patch(5, 1, {"eligibility_state": "lapsed"})
ck("an office edit since the sweep read it: refused, the current record handed back (with the edit)", not r["ok"] and r["reason"] == "changed" and r["current_record"]["phone"] == "2" and rec(5)["eligibility_state"] == "eligible", r)
r = patch(5, 2, {"eligibility_state": "lapsed"})
ck("on the current record it goes in, and the office edit stays", r["ok"] and rec(5)["eligibility_state"] == "lapsed" and rec(5)["phone"] == "2")
try: patch(5, 3, {"phone": "9"}); bad = False
except DatabaseError: bad = True
ck("any field the sweep doesn't own is refused outright", bad and rec(5)["phone"] == "2")
ck("a caregiver who is gone: 'gone'", patch(99, 0, {"eligibility_state": "x"})["reason"] == "gone")
def can(role, s):
    cc = conn()
    try: cc.run("begin"); cc.run(f"set local role {role}"); cc.run(s); return True
    except DatabaseError: return False
    finally:
        try: cc.run("rollback")
        except Exception: pass
        cc.close()
ck("only the server can call it", not can("authenticated", "select caregiver_sweep_patch('5', 0, '{}'::jsonb)") and not can("anon", "select caregiver_sweep_patch('5', 0, '{}'::jsonb)")
   and q("select has_function_privilege('service_role', 'public.caregiver_sweep_patch(text, bigint, jsonb)', 'execute')")[0][0])
for n_, ok, d in res: print(("PASS  " if ok else "FAIL  ") + n_ + ("" if ok else "  " + d))
print(f"\n{sum(1 for r in res if r[1])}/{len(res)} passed")
raise SystemExit(0 if all(r[1] for r in res) else 1)
