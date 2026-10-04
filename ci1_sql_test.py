# CI1 · the coverage case guard, the one-at-a-time patch and the ask reservation, on a real local Postgres.
import os, json, glob, shutil, threading, time
import pgserver
from pg8000.native import Connection, DatabaseError
import tempfile; D = tempfile.mkdtemp(prefix="ci1pg-"); shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
srv = pgserver.get_server(D)
host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
SQL = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ci1.sql")).read()
c = conn()
c.run("drop schema if exists public cascade; create schema public")
for r in ("anon", "authenticated", "service_role"):
    try: c.run(f"create role {r}")
    except DatabaseError: pass
c.run("grant usage on schema public to anon, authenticated, service_role")
c.run("create table app_data(key text primary key, data jsonb, updated_at timestamptz default now())")
# the shared writer every function uses: replace one item by id, or add it
c.run("""create function upsert_app_data_item(target_key text, item jsonb) returns void language plpgsql security definer as $$
declare d jsonb; begin
  select data into d from app_data where key = target_key for update;
  if d is null then insert into app_data(key, data) values (target_key, jsonb_build_array(item)); return; end if;
  if exists (select 1 from jsonb_array_elements(d) x where x->>'id' = item->>'id') then
    update app_data set data = (select jsonb_agg(case when x->>'id' = item->>'id' then item else x end) from jsonb_array_elements(d) x) where key = target_key;
  else update app_data set data = d || jsonb_build_array(item) where key = target_key; end if; end $$""")
c.run("begin"); c.run(SQL); c.run("commit"); c.run("begin"); c.run(SQL); c.run("commit")   # safe to run again
c.close()
res = []
def ck(n, cond, d=""): res.append((n, bool(cond), "" if cond else str(d)[:900]))
def q(sql, **k):
    cc = conn()
    try: return cc.run(sql, **k)
    finally: cc.close()
J = lambda x: json.dumps(x)
def case(id_): return q("select x from app_data, jsonb_array_elements(data) x where key='coverage_cases' and x->>'id'=:i", i=id_)[0][0]
def put(item): q("select upsert_app_data_item('coverage_cases', cast(:j as jsonb))", j=J(item))
def logs(rule=None): return [r[0] for r in q("select rule from coverage_case_guard_log order by id")] if rule is None else [r[0] for r in q("select rule from coverage_case_guard_log where rule=:r", r=rule)]
def reset():
    q("delete from app_data"); q("delete from coverage_case_guard_log")
    q("insert into app_data values ('coverage_cases', cast(:j as jsonb))", j=J([
      {"id": "c1", "status": "open", "client": "Ruth", "asked": [{"id": "a1", "name": "Joe", "phone": "4175550101", "state": "waiting"}, {"id": "a2", "name": "Ann", "phone": "4175550102", "axiscare_id": "77", "state": "waiting"}]},
      {"id": "c2", "status": "open", "client": "Bea", "asked": []}]))
    q("insert into app_data values ('caregivers', '[]'::jsonb)")

# R3 · a yes is never wiped by an older copy
reset(); stale = case("c1")
fresh = case("c1"); fresh["asked"][0].update(state="yes", replied_at="2026-10-04T12:00:00Z", reply="YES"); put(fresh)
stale["note"] = "called the family"; put(stale)
now = case("c1"); a1 = [a for a in now["asked"] if a["id"] == "a1"][0]
ck("R3: an older copy saved after a YES keeps the YES (and its own change goes in)", a1["state"] == "yes" and a1["reply"] == "YES" and now["note"] == "called the family" and "R3_answers_kept" in logs(), [now, logs()])
reset(); fresh = case("c1"); fresh["asked"].append({"id": "a3", "name": "Bo", "phone": "4175550103", "state": "waiting"}); put(fresh)
stale = case("c1"); stale["asked"] = [a for a in stale["asked"] if a["id"] != "a3"]; put(stale)
ck("R3: an ask missing from an older copy is put back", any(a["id"] == "a3" for a in case("c1")["asked"]), case("c1"))

# R1 · closed stays closed
reset(); stale = case("c1")
r = q("select coverage_case_patch('c1', cast(:p as jsonb), cast(:e as jsonb))", p=J({"status": "done", "resolved_how": "covered", "covered_by": "Joe", "resolved_at": "2026-10-04T12:05:00Z"}), e=J({"status": "open"}))[0][0]
stale["admin_alerted"] = True; put(stale)
now = case("c1")
ck("R1: a copy from before the fill can't put the case back to open", r["outcome"] == "ok" and now["status"] == "done" and now["covered_by"] == "Joe" and "R1_closed_stays_closed" in logs(), [r, now, logs()])
reopen = case("c1"); reopen.update(status="open", covered_by=None, resolved_how=None, reopened_from=reopen["resolved_at"], resolved_at=None); put(reopen)
ck("R1: a deliberate reopen (reopened_from = that close) goes in", case("c1")["status"] == "open", case("c1"))
# R4 · the stale copy of that close can't undo the reopen
old_close = dict(now); put(old_close)
ck("R4: the old closed copy can't undo the reopen", case("c1")["status"] == "open" and "R4_reopen_stays_open" in logs(), [case("c1"), logs()])
# R2 · first close wins
reset(); a = case("c1"); b = case("c1")
a.update(status="done", resolved_how="covered", covered_by="Joe", resolved_at="2026-10-04T12:05:00Z"); put(a)
b.update(status="done", resolved_how="covered", covered_by="Ann", resolved_at="2026-10-04T12:05:30Z"); put(b)
ck("R2: two people confirming different caregivers: the first wins, the second is logged", case("c1")["covered_by"] == "Joe" and "R2_first_close_wins" in logs(), [case("c1"), logs()])
same = case("c1"); same["family_notified"] = "2026-10-04T12:10:00Z"; put(same)
ck("a closed case can still be updated by someone who saw the close (the closure stamps)", case("c1")["family_notified"] == "2026-10-04T12:10:00Z")

# the one-at-a-time patch
reset()
r1 = q("select coverage_case_patch('c1', cast(:p as jsonb), cast(:e as jsonb))", p=J({"status": "done", "covered_by": "Joe", "resolved_at": "t1"}), e=J({"status": "open"}))[0][0]
r2 = q("select coverage_case_patch('c1', cast(:p as jsonb), cast(:e as jsonb))", p=J({"status": "done", "covered_by": "Ann", "resolved_at": "t2"}), e=J({"status": "open"}))[0][0]
ck("patch: the first confirm wins; the second gets 'conflict' and the case as it is (Joe)", r1["outcome"] == "ok" and r2["outcome"] == "conflict" and r2["item"]["covered_by"] == "Joe" and case("c1")["covered_by"] == "Joe", [r1, r2])
ck("patch: only the given fields change (asks and client untouched)", case("c1")["client"] == "Ruth" and len(case("c1")["asked"]) == 2)
ck("patch: a missing case is 'not_found'", q("select coverage_case_patch('nope', '{}'::jsonb, '{}'::jsonb)")[0][0]["outcome"] == "not_found")
# concurrency: 8 confirms at once, exactly one wins
reset(); outs = []
def go(n):
    outs.append(q("select coverage_case_patch('c1', cast(:p as jsonb), cast(:e as jsonb))", p=J({"status": "done", "covered_by": f"P{n}", "resolved_at": f"t{n}"}), e=J({"status": "open"}))[0][0]["outcome"])
ts = [threading.Thread(target=go, args=(n,)) for n in range(8)]; [t.start() for t in ts]; [t.join() for t in ts]
ck("8 confirms at the same moment: exactly one wins", outs.count("ok") == 1 and outs.count("conflict") == 7, outs)

# the ask reservation
reset()
r = [q("select coverage_case_add_ask('c1', cast(:a as jsonb))", a=J(x))[0][0] for x in (
  {"id": "n1", "name": "Joe", "phone": "+1 (417) 555-0101", "at": "t"},      # same number as a1
  {"id": "n2", "name": "Ann B", "phone": "4175559999", "axiscare_id": "77", "at": "t"},   # same AxisCare id as a2
  {"id": "n3", "name": "Cy", "phone": "4175550104", "at": "2026-10-04T12:00:00Z"})]
ck("ask: someone already asked (same number, or same AxisCare id) isn't asked again; a new person is recorded first", r == ["already_asked", "already_asked", "added"] and any(a["id"] == "n3" for a in case("c1")["asked"]) and case("c1")["callout_started_at"] == "2026-10-04T12:00:00Z", r)
outs = []
def ask(n): outs.append(q("select coverage_case_add_ask('c2', cast(:a as jsonb))", a=J({"id": f"z{n}", "name": "Dee", "phone": "4175550105", "at": "t"}))[0][0])
ts = [threading.Thread(target=ask, args=(n,)) for n in range(6)]; [t.start() for t in ts]; [t.join() for t in ts]
ck("ask: two coordinators sending at once: Dee is texted once", outs.count("added") == 1 and outs.count("already_asked") == 5 and len(case("c2")["asked"]) == 1, outs)
ck("ask: removing a reserved ask after a failed text really removes it (the guard lets exactly that one go)", q("select coverage_case_remove_ask('c1', 'n3')")[0][0] is True and not any(a["id"] == "n3" for a in case("c1")["asked"]), case("c1"))
s1 = case("c1"); s1["asked"] = [a for a in s1["asked"] if a["id"] != "a1"]; put(s1)
ck("ask: an older copy without a1 still can't remove a1", any(a["id"] == "a1" for a in case("c1")["asked"]), case("c1"))
q("update app_data set data = (select jsonb_agg(case when x->>'id'='c2' then x || '{\"status\":\"done\",\"resolved_at\":\"t9\"}'::jsonb else x end) from jsonb_array_elements(data) x) where key='coverage_cases'")
ck("ask: a closed case can't be asked from", q("select coverage_case_add_ask('c2', cast(:a as jsonb))", a=J({"id": "w", "phone": "4175550199", "at": "t"}))[0][0] == "not_open")

# who may call them
cc = conn(); cc.run("set role authenticated")
try: cc.run("select coverage_case_patch('c1', '{}'::jsonb, '{}'::jsonb)"); blocked = False
except DatabaseError: blocked = True
cc.close()
ck("a signed-in user (or the public) can't call the patch or ask functions directly: the server only", blocked)
ck("other keys are untouched by the guard", (q("update app_data set data='[{\"id\":\"x\"}]' where key='caregivers'"), q("select data from app_data where key='caregivers'")[0][0])[1] == [{"id": "x"}])

srv.cleanup(); shutil.rmtree(D, ignore_errors=True)
for n, ok, d in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n     " + d))
print(f"{sum(x[1] for x in res)}/{len(res)}")
