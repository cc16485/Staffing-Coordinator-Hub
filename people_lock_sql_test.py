# 442 · the lock on whole-list saves of candidates and caregivers, on a real local Postgres set up like production:
# app_data with row security and a permissive rule for signed-in staff, the table and the safe-save functions owned by
# one (non-superuser) role, the page acting as 'authenticated'. python3 people_lock_sql_test.py
import os, json, glob, shutil, tempfile
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
D = tempfile.mkdtemp(prefix="plpg-"); shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
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
c.run("create policy hub_rw on app_data for all to authenticated using (can_access_data_key(key)) with check (can_access_data_key(key))")
c.run("grant select, insert, update, delete on app_data to authenticated; grant all on app_data to service_role")
# the shared per-item writer every page uses (runs as the caller, like production's)
c.run("""create function upsert_app_data_item(target_key text, item jsonb) returns void language plpgsql security invoker as $$
declare d jsonb; begin
  select data into d from app_data where key = target_key for update;
  if d is null then insert into app_data(key, data) values (target_key, jsonb_build_array(item)); return; end if;
  update app_data set data = (select coalesce(jsonb_agg(case when x->>'id' = item->>'id' then item else x end), '[]'::jsonb) from jsonb_array_elements(d) x)
       || case when exists (select 1 from jsonb_array_elements(d) x where x->>'id' = item->>'id') then '[]'::jsonb else jsonb_build_array(item) end
   where key = target_key; end $$""")
c.run("grant execute on function upsert_app_data_item(text, jsonb) to authenticated")
c.run(open(os.path.join(HERE, "safe_saves_2.sql")).read())
c.run("begin"); c.run(open(os.path.join(HERE, "cg_connect.sql")).read()); c.run("commit")
c.run("begin"); c.run(open(os.path.join(HERE, "sweep_fields.sql")).read()); c.run("commit")
c.run("reset role")
c.run("insert into app_data(key, data) values ('candidates', '[{\"id\":1,\"first\":\"Ava\"}]'), ('caregivers', '[{\"id\":5,\"first\":\"Jo\"}]'), ('ops_items', '[]'), ('settings', '{}')")
LOCK = open(os.path.join(HERE, "people_lock.sql")).read()
c.run("set role tab_owner"); c.run("begin"); c.run(LOCK); c.run("commit"); c.run("begin"); c.run(LOCK); c.run("commit"); c.run("reset role")   # safe to run again
c.close()
res = []
def ck(n, cond, d=""): res.append((n, bool(cond), "" if cond else str(d)[:700]))
def as_user(sql, **k):
    cc = conn()
    try:
        cc.run("begin"); cc.run("set local role authenticated")
        cc.run("""select set_config('request.jwt.claims', '{"role":"authenticated","email":"krystal@mo-care.com"}', true), set_config('request.jwt.claim.role', 'authenticated', true)""")
        out = cc.run(sql, **k); cc.run("commit"); return ("ok", out)
    except DatabaseError as e:
        try: cc.run("rollback")
        except Exception: pass
        return ("refused", str(e.args[0].get("M") if e.args and isinstance(e.args[0], dict) else e))
    finally: cc.close()
def data(k):
    cc = conn()
    try: return cc.run("select data from app_data where key = :k", k=k)[0][0]
    finally: cc.close()
r = as_user("""insert into app_data(key, data) values ('candidates', '[]') on conflict (key) do update set data = excluded.data""")
ck("a whole-list save of candidates (an old page's upsert) is refused, list untouched", r[0] == "refused" and data("candidates") == [{"id": 1, "first": "Ava"}], r)
r = as_user("""insert into app_data(key, data) values ('caregivers', '[]') on conflict (key) do update set data = excluded.data""")
ck("...and of caregivers", r[0] == "refused" and data("caregivers") == [{"id": 5, "first": "Jo"}], r)
r = as_user("update app_data set data = '[]' where key = 'caregivers' returning key")
ck("a plain update of caregivers changes nothing", data("caregivers") == [{"id": 5, "first": "Jo"}] and (r[0] == "refused" or r[1] == []), r)
r = as_user("delete from app_data where key = 'candidates' returning key")
ck("deleting a whole list changes nothing", data("candidates") == [{"id": 1, "first": "Ava"}] and (r[0] == "refused" or r[1] == []), r)
r = as_user("""select upsert_app_data_item('caregivers', '{"id":5,"first":"STALE"}'::jsonb)""")
ck("the old per-item writer (runs as the caller) can't write a caregiver either", r[0] == "refused" and data("caregivers")[0]["first"] == "Jo", r)
r = as_user("""select app_data_items_apply('caregivers', '[{"op":"put","id":"5","record":{"id":5,"first":"Joanne"},"base_rev":0}]'::jsonb)""")
ck("the one-person-at-a-time save still works (runs as its owner)", r[0] == "ok" and r[1][0][0]["ok"] is True and data("caregivers")[0]["first"] == "Joanne", r)
r = as_user("""select app_data_items_apply('candidates', '[{"op":"add","tmp":"-1","record":{"first":"Ben"}}]'::jsonb)""")
ck("...including adding a new candidate (a number from the database)", r[0] == "ok" and r[1][0][0]["ok"] is True and len(data("candidates")) == 2, r)
cc = conn(); cc.run("set role service_role"); cc.run("""select caregiver_sweep_patch('5', 1, '{"eligibility_state":"eligible"}'::jsonb)"""); cc.run("""select caregiver_connect_apply('{"op":"create","axiscare_id":"900","record":{"first":"N","axiscare_id":"900"}}'::jsonb)"""); cc.close()
ck("the server's own steps still work (sweep fields, caregiver connect)", data("caregivers")[0].get("eligibility_state") == "eligible" and any(x.get("axiscare_id") == "900" for x in data("caregivers")))
r = as_user("""select upsert_app_data_item('ops_items', '{"id":"o1","status":"open"}'::jsonb)""")
ck("every other list saves exactly as before (Needs Attention)", r[0] == "ok" and data("ops_items") == [{"id": "o1", "status": "open"}], r)
r = as_user("""select app_data_save('settings', '{"a":1}'::jsonb, 0)""")
ck("...and the settings save", r[0] == "ok" and data("settings") == {"a": 1}, r)
r = as_user("""insert into app_data(key, data) values ('new_key', '[]')""")
ck("...and a brand-new list", r[0] == "ok", r)
cc = conn(); cc.run("set role tab_owner"); cc.run(open(os.path.join(HERE, "people_lock_rollback.sql")).read()); cc.close()
r = as_user("update app_data set data = data where key = 'caregivers' returning key")
ck("the undo takes the lock off", r[0] == "ok" and r[1] == [["caregivers"]], r)
for n_, ok, d in res: print(("PASS  " if ok else "FAIL  ") + n_ + ("" if ok else "  " + d))
print(f"\n{sum(1 for r in res if r[1])}/{len(res)} passed")
raise SystemExit(0 if all(r[1] for r in res) else 1)
