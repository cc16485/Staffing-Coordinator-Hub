# 438 · caregiver_connect_apply / caregiver_connect_practice on a real local Postgres, with 421 safe saving installed.
import os, json, glob, shutil, threading, tempfile
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
D = tempfile.mkdtemp(prefix="cgcpg-"); shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
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
SQL = open(os.path.join(HERE, "cg_connect.sql")).read()
c.run("begin"); c.run(SQL); c.run("commit"); c.run("begin"); c.run(SQL); c.run("commit")   # safe to run again
c.close()
res = []
def ck(n, cond, d=""): res.append((n, bool(cond), "" if cond else str(d)[:900]))
def q(sql, **k):
    cc = conn()
    try: return cc.run(sql, **k)
    finally: cc.close()
J = lambda x: json.dumps(x)
def apply(op): return q("select caregiver_connect_apply(cast(:j as jsonb))", j=J(op))[0][0]
def lst(key): return q("select data from app_data where key=:k", k=key)[0][0]
def rec(key, id_): return next((x for x in lst(key) if str(x.get("id")) == str(id_)), None)
def logs(): return [dict(zip(["id", "action", "result", "ax", "rec", "cg", "why", "rev_after", "undone"], r))
                    for r in q("select id, action, result, axiscare_id, record_id, caregiver_id, why, rev_after, undone_at is not null from caregiver_connect_log order by id")]
def counter(): return q("select last_id from app_data_id_counter where key='caregivers'")[0][0]
def save(key, data): q("update app_data set data = cast(:d as jsonb) where key = :k", d=J(data), k=key)   # an ordinary save (the trigger stamps _rev)
CASEY = {"id": 50, "first": "Casey", "last": "Moreno", "phone": "4175550103", "r1n": "Ref One"}
def reset():
    q("delete from caregiver_connect_undo"); q("delete from caregiver_connect_log"); q("delete from caregiver_connect_blocked"); q("delete from app_data")
    q("insert into app_data(key, data) values ('caregivers', cast(:j as jsonb))", j=J([
      {"id": 20, "first": "Jo", "last": "Pike", "phone": "4175550101"},
      {"id": 21, "first": "Riley", "last": "Stone", "email": "r@x.com"},
      {"id": 27, "first": "Blake", "last": "Hart", "axiscare_id": "110"}]))
    q("insert into app_data(key, data) values ('candidates', cast(:j as jsonb))", j=J([CASEY, {"id": 51, "first": "Morgan", "last": "Leigh"}]))
    q("update app_data_id_counter set last_id = 30 where key = 'caregivers'")
MOVED = lambda ax="103", cid=50: {"first": "Casey", "last": "Moreno", "candidate_id": cid, "axiscare_id": ax, "connected": {"how": "phone", "by": "auto"}, "prehire": {"refs": [{"name": "Ref One"}]}}
NEW = lambda ax="104": {"first": "Quinn", "last": "Ashby", "axiscare_id": ax, "created_via": "auto from AxisCare"}

# link
reset()
r = apply({"op": "link", "axiscare_id": "101", "caregiver_id": "20", "base_rev": 0, "how": "phone", "ax_name": "Jordan Pike", "run_id": "r1", "connected": {"at": "T", "how": "phone", "by": "auto"}})
g = rec("caregivers", 20)
ck("link: the AxisCare id and how it was connected are written on that record", r["ok"] and g["axiscare_id"] == "101" and g["connected"]["how"] == "phone", [r, g])
ck("link: the record's _rev moved on (stamped by safe saving) and the log says done with it", g.get("_rev") == 1 and logs()[-1]["result"] == "done" and logs()[-1]["rev_after"] == 1, [g, logs()])
ck("link: every other record untouched", rec("caregivers", 21) == {"id": 21, "first": "Riley", "last": "Stone", "email": "r@x.com"})
r = apply({"op": "link", "axiscare_id": "101", "caregiver_id": "21", "base_rev": 0, "how": "email"})
ck("link: an AxisCare caregiver who already has a Hub record is refused (one AxisCare id, one record)", not r["ok"] and r["reason"] == "already_connected" and "axiscare_id" not in rec("caregivers", 21), r)
r = apply({"op": "link", "axiscare_id": "105", "caregiver_id": "27", "base_rev": 0})
ck("link: a record connected to someone else is refused", not r["ok"] and r["reason"] == "taken" and rec("caregivers", 27)["axiscare_id"] == "110", r)
reset(); cg = lst("caregivers"); cg[1]["phone"] = "4170000000"; save("caregivers", cg)    # someone edits Riley: _rev 1
r = apply({"op": "link", "axiscare_id": "102", "caregiver_id": "21", "base_rev": 0, "how": "email"})
ck("link: someone changed the record since the job looked: refused, nothing changed, logged", not r["ok"] and r["reason"] == "changed" and "axiscare_id" not in rec("caregivers", 21)
   and logs()[-1]["result"] == "refused" and "changed" in logs()[-1]["why"], [r, logs()])
r = apply({"op": "link", "axiscare_id": "102", "caregiver_id": "21", "base_rev": 1, "how": "email"})
ck("link: with the current _rev it goes in (next hour's try)", r["ok"] and rec("caregivers", 21)["axiscare_id"] == "102")
ck("link: a missing record is refused", apply({"op": "link", "axiscare_id": "199", "caregiver_id": "999", "base_rev": 0})["reason"] == "gone")

# create
reset()
r = apply({"op": "create", "axiscare_id": "104", "record": NEW(), "ax_name": "Quinn Ashby", "how": "new"})
n = rec("caregivers", r.get("caregiver_id"))
ck("create: a new record with the next number from the counter (31), never a reused one", r["ok"] and r["caregiver_id"] == 31 and n["axiscare_id"] == "104" and counter() == 31, [r, n])
r2 = apply({"op": "create", "axiscare_id": "104", "record": NEW()})
ck("create: a second new record for the same AxisCare caregiver is refused", not r2["ok"] and r2["reason"] == "already_connected" and len([x for x in lst("caregivers") if x.get("axiscare_id") == "104"]) == 1)
save("caregivers", [x for x in lst("caregivers") if x["id"] != 31])
r3 = apply({"op": "create", "axiscare_id": "105", "record": NEW("105")})
ck("create: a removed record's number is never given again (32)", r3["caregiver_id"] == 32, r3)
try:
    apply({"op": "create", "axiscare_id": "106", "record": NEW("999")}); bad = False
except DatabaseError: bad = True
ck("create: a record carrying a different AxisCare id is refused outright", bad)

# move
reset()
r = apply({"op": "move", "axiscare_id": "103", "candidate_id": "50", "cand_base_rev": 0, "record": MOVED(), "how": "phone", "ax_name": "Casey Moreno"})
m = rec("caregivers", r.get("caregiver_id"))
ck("move: added as a caregiver AND taken out of Background & References, together", r["ok"] and m["candidate_id"] == 50 and m["axiscare_id"] == "103" and rec("candidates", 50) is None and rec("candidates", 51) is not None, [r, lst("candidates")])
ck("move: the Background & References record as it was is kept for an undo (server only)", q("select before->>'r1n' from caregiver_connect_undo")[0][0] == "Ref One")
reset(); cd = lst("candidates"); cd[0]["notes"] = "called"; save("candidates", cd)
r = apply({"op": "move", "axiscare_id": "103", "candidate_id": "50", "cand_base_rev": 0, "record": MOVED()})
ck("move: someone changed the candidate since the job looked: refused, nothing changed", not r["ok"] and r["reason"] == "changed" and rec("candidates", 50) is not None and len(lst("caregivers")) == 3, r)
r = apply({"op": "move", "axiscare_id": "103", "candidate_id": "51", "cand_base_rev": 0, "record": MOVED()})
ck("move: a record built from a different candidate is refused", not r["ok"] and rec("candidates", 51) is not None)
# a move that fails halfway changes nothing at all
reset()
q("""create or replace function boom() returns trigger language plpgsql as $$ begin if new.key = 'candidates' then raise exception 'disk full'; end if; return new; end $$""")
q("create trigger boom_t before update on app_data for each row execute function boom()")
try: apply({"op": "move", "axiscare_id": "103", "candidate_id": "50", "cand_base_rev": 0, "record": MOVED()}); failed = False
except DatabaseError: failed = True
q("drop trigger boom_t on app_data")
ck("move: failing halfway (the candidate step) leaves BOTH lists as they were, no log, number not used", failed and len(lst("caregivers")) == 3 and rec("candidates", 50) is not None and not logs() and counter() == 30)

# two at once: one wins
reset()
out = []
def go():
    try: out.append(apply({"op": "create", "axiscare_id": "104", "record": NEW()}))
    except Exception as e: out.append({"err": str(e)})
ts = [threading.Thread(target=go) for _ in range(4)]
[t.start() for t in ts]; [t.join() for t in ts]
ck("two runs at once (4 tries): exactly one new record, the rest refused", sum(1 for o in out if o.get("ok")) == 1 and len([x for x in lst("caregivers") if x.get("axiscare_id") == "104"]) == 1
   and sum(1 for o in out if o.get("reason") == "already_connected") == 3, out)
reset(); out = []
def mv():
    try: out.append(apply({"op": "move", "axiscare_id": "103", "candidate_id": "50", "cand_base_rev": 0, "record": MOVED()}))
    except Exception as e: out.append({"err": str(e)})
ts = [threading.Thread(target=mv) for _ in range(3)]
[t.start() for t in ts]; [t.join() for t in ts]
ck("two moves at once: one caregiver record, the candidate removed once", sum(1 for o in out if o.get("ok")) == 1 and len([x for x in lst("caregivers") if x.get("candidate_id") == 50]) == 1, out)

# Not this person
reset()
L = apply({"op": "link", "axiscare_id": "101", "caregiver_id": "20", "base_rev": 0, "how": "phone"})
u = apply({"op": "unlink", "log_id": L["log_id"], "by": "angiel@mo-care.com"})
g = rec("caregivers", 20)
ck("unlink: the AxisCare id comes off, who undid it is noted, the pair is remembered", u["ok"] and "axiscare_id" not in g and "connected" not in g and g["connect_undone"]["by"] == "angiel@mo-care.com"
   and q("select count(*) from caregiver_connect_blocked where axiscare_id='101' and kind='caregiver' and record_id='20'")[0][0] == 1, [u, g])
ck("unlink: twice is refused (already undone)", apply({"op": "unlink", "log_id": L["log_id"]})["reason"] == "already_undone")
ck("unlink: an undo of the wrong kind is refused", apply({"op": "unmove", "log_id": L["log_id"]})["reason"] == "not_found")
reset()
M = apply({"op": "move", "axiscare_id": "103", "candidate_id": "50", "cand_base_rev": 0, "record": MOVED()})
u = apply({"op": "unmove", "log_id": M["log_id"], "by": "x"})
ck("unmove: back in Background & References under their own number, the caregiver record gone, pair remembered", u["ok"] and rec("candidates", 50)["r1n"] == "Ref One"
   and rec("caregivers", M["caregiver_id"]) is None and q("select count(*) from caregiver_connect_blocked where kind='candidate' and record_id='50'")[0][0] == 1, u)
reset()
M = apply({"op": "move", "axiscare_id": "103", "candidate_id": "50", "cand_base_rev": 0, "record": MOVED()})
cg = lst("caregivers"); [x.update(hire_date="2026-10-01") for x in cg if x["id"] == M["caregiver_id"]]; save("caregivers", cg)
u = apply({"op": "unmove", "log_id": M["log_id"]})
ck("unmove: someone changed the caregiver record since: refused and it says so", not u["ok"] and u["reason"] == "changed_since" and rec("caregivers", M["caregiver_id"]) is not None and rec("candidates", 50) is None, u)
reset()
cg = lst("caregivers"); cg[0]["notes"] = "edited before"; save("caregivers", cg)   # unrelated edit on another record
C1 = apply({"op": "create", "axiscare_id": "104", "record": NEW()})
cg = lst("caregivers"); cg[1]["notes"] = "someone edits Riley"; save("caregivers", cg)   # an edit to ANOTHER record keeps the new record's _rev
u = apply({"op": "uncreate", "log_id": C1["log_id"]})
ck("uncreate: removed (an edit to someone else's record doesn't count as a change), never started again", u["ok"] and rec("caregivers", C1["caregiver_id"]) is None
   and q("select count(*) from caregiver_connect_blocked where axiscare_id='104' and kind='new'")[0][0] == 1, u)

# practice list
reset()
q("select caregiver_connect_practice('p1', cast(:j as jsonb))", j=J([{"action": "link", "axiscare_id": "101", "ax_name": "Jordan Pike", "record_id": "20"}, {"action": "review", "axiscare_id": "105", "why": "the name is similar", "options": [{"id": 22}]}]))
n = q("select caregiver_connect_practice('p2', cast(:j as jsonb))", j=J([{"action": "create", "axiscare_id": "104"}, {"action": "bogus"}]))[0][0]
rows = q("select run_id, action, result from caregiver_connect_log")
ck("practice: the newest list replaces the last one; unknown actions ignored; nothing else changes", n == 1 and rows == [["p2", "create", "would"]] and lst("caregivers")[0] == {"id": 20, "first": "Jo", "last": "Pike", "phone": "4175550101"}, rows)
n = q("select caregiver_connect_practice('L1', cast(:j as jsonb), 'live')", j=J([{"action": "create", "axiscare_id": "104"}, {"action": "review", "axiscare_id": "105", "why": "w"}]))[0][0]
rows = q("select run_id, mode, action, result from caregiver_connect_log")
ck("live: the list holds only who needs a look (and replaces the practice list)", n == 1 and rows == [["L1", "live", "review", "would"]], rows)

# who may call what
def can(role, sql_):
    cc = conn()
    try: cc.run("begin"); cc.run(f"set local role {role}"); cc.run(sql_); return True
    except DatabaseError: return False
    finally:
        try: cc.run("rollback")
        except Exception: pass
        cc.close()
ck("signed-in staff can't call the writer or the list", not can("authenticated", "select caregiver_connect_apply('{\"op\":\"create\"}'::jsonb)") and not can("authenticated", "select caregiver_connect_practice('x', '[]'::jsonb)"))
ck("the public can't call it either", not can("anon", "select caregiver_connect_apply('{\"op\":\"create\"}'::jsonb)"))
ck("staff can read the log, runs and undone pairs, not the undo copies", can("authenticated", "select * from caregiver_connect_log") and can("authenticated", "select * from caregiver_connect_runs")
   and can("authenticated", "select * from caregiver_connect_blocked") and not can("authenticated", "select * from caregiver_connect_undo"))
ck("the public reads none of it", not any(can("anon", f"select * from {t}") for t in ("caregiver_connect_log", "caregiver_connect_runs", "caregiver_connect_blocked", "caregiver_connect_undo")))
ck("the server can call it", can("service_role", "select 1 from caregiver_connect_log") and q("select has_function_privilege('service_role', 'public.caregiver_connect_apply(jsonb)', 'execute')")[0][0])

for n_, ok, d in res: print(("PASS  " if ok else "FAIL  ") + n_ + ("" if ok else "  " + d))
print(f"\n{sum(1 for r in res if r[1])}/{len(res)} passed")
srv.cleanup() if hasattr(srv, "cleanup") else None
raise SystemExit(0 if all(r[1] for r in res) else 1)
