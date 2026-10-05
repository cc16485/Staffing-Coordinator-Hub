# 449 · the Stand-Up move on a real local Postgres set up like production: app_data with row security that lets a
# signed-in person reach a list only if one of their hubs is mapped to it (can_access_data_key, the map table, the hub
# list read from the sign-in), the shared per-item save running as the caller, and the old quick-add function callable
# with the public key. python3 standup_move_sql_test.py
import os, json, glob, shutil, tempfile
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
D = tempfile.mkdtemp(prefix="supg-"); shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
srv = pgserver.get_server(D)
host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)

def setup(c):
    c.run("drop schema if exists public cascade; create schema public")
    for r in ("anon", "authenticated", "service_role", "tab_owner"):
        try: c.run(f"create role {r}")
        except DatabaseError: pass
    c.run("alter role service_role bypassrls")
    c.run("grant usage, create on schema public to tab_owner; grant usage on schema public to anon, authenticated, service_role")
    c.run("set role tab_owner")
    c.run("create table app_data(key text primary key, data jsonb, updated_at timestamptz default now())")
    c.run("create table app_data_key_hub_map(data_key text not null, hub_slug text not null, primary key (data_key, hub_slug))")
    c.run("grant select on app_data_key_hub_map to authenticated")
    c.run("""create function jwt_hub_access() returns jsonb language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'app_metadata' -> 'hub_access' $$""")
    c.run("""create function can_access_data_key(k text) returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
      select public.jwt_hub_access() is null or exists (select 1 from public.app_data_key_hub_map m where m.data_key = k and public.jwt_hub_access() ? m.hub_slug) $$""")
    c.run("alter table app_data enable row level security")
    c.run("create policy hub_rw on app_data for all to authenticated using (can_access_data_key(key)) with check (can_access_data_key(key))")
    c.run("grant select, insert, update, delete on app_data to authenticated; grant all on app_data to service_role")
    c.run("""create function upsert_app_data_item(target_key text, item jsonb) returns void language plpgsql security invoker as $$
    declare d jsonb; begin
      select data into d from app_data where key = target_key for update;
      if d is null then insert into app_data(key, data) values (target_key, jsonb_build_array(item)); return; end if;
      update app_data set data = (select coalesce(jsonb_agg(case when x->>'id' = item->>'id' then item else x end), '[]'::jsonb) from jsonb_array_elements(d) x)
           || case when exists (select 1 from jsonb_array_elements(d) x where x->>'id' = item->>'id') then '[]'::jsonb else jsonb_build_array(item) end
       where key = target_key; end $$""")
    c.run("grant execute on function upsert_app_data_item(text, jsonb) to authenticated")
    c.run("""create function submit_standup_note_public(p_summary text, p_category text, p_related_to text, p_reported_by text, p_assigned_to text)
      returns void language plpgsql security definer set search_path = public as $$
      begin perform 1; end $$""")
    c.run("grant execute on function submit_standup_note_public(text, text, text, text, text) to anon, authenticated")
    c.run("reset role")
    c.run("""insert into app_data_key_hub_map values ('standup_notes','team_hub'),('team_meetings','team_hub'),('team_hub_settings','team_hub'),
      ('ops_settings','care_coordinator'),('leads','care_coordinator'),('candidates','staffing')""")
    c.run("""insert into app_data(key, data) values
      ('standup_notes', '[{"id":"s1","summary":"Night call-out"}]'), ('team_meetings', '[{"id":"m1","meeting_name":"Weekly Team Meeting"}]'),
      ('team_hub_settings', '[{"id":"hub_config","cc_hub_url":"x"},{"id":"video_room","room_name":"CaringCompanions-TeamHub-abc123xyz"}]'),
      ('ops_settings', '{"afternoon_interviews":{"from":"14:00"}}'), ('leads', '[]')""")

c = conn(); setup(c)
MOVE, PROOF, BACK = (open(os.path.join(HERE, f)).read() for f in ("standup_move.sql", "standup_move_proof.sql", "standup_move_rollback.sql"))
res = []
def ck(n, cond, d=""): res.append((n, bool(cond), "" if cond else str(d)[:700]))
def one(q): return c.run(q)[0][0]
def as_user(hubs, sql):
    cc = conn()
    try:
        cc.run("begin"); cc.run("set local role authenticated")
        cc.run("select set_config('request.jwt.claims', :j, true)", j=json.dumps({"role": "authenticated", "email": "proof@mo-care.invalid", "app_metadata": {"hub_access": hubs}}))
        out = cc.run(sql); cc.run("commit"); return ("ok", out)
    except DatabaseError as e:
        try: cc.run("rollback")
        except Exception: pass
        return ("refused", str(e.args[0].get("M") if e.args and isinstance(e.args[0], dict) else e))
    finally: cc.close()
def probe():
    try: c.run(PROOF); return None
    except DatabaseError as e:
        m = e.args[0].get("M") if e.args and isinstance(e.args[0], dict) else str(e)
        return json.JSONDecoder().raw_decode(m[m.index("PROBE_RESULT: ") + 14:])[0] if "PROBE_RESULT: " in m else m
anon_can = lambda: one("select has_function_privilege('anon', 'submit_standup_note_public(text,text,text,text,text)'::regprocedure, 'execute')")
auth_can = lambda: one("select has_function_privilege('authenticated', 'submit_standup_note_public(text,text,text,text,text)'::regprocedure, 'execute')")

ck("before: the quick-add function is callable with the public key", anon_can())
ck("before: a CC Hub-only person can't see the board", as_user(["care_coordinator"], "select count(*) from app_data where key = 'standup_notes'")[1][0][0] == 0)
r = probe()
ck("before: the proof says NOT done (door open, CC can't see the board)", isinstance(r, dict) and r["anon_can_call"] and r["cc_sees_board"] == 0 and r["cc_can_add"] != "went in", r)

c.run("begin"); c.run(MOVE); c.run("commit"); c.run("begin"); c.run(MOVE); c.run("commit")   # safe to run again
ck("after: the public key can't call it", not anon_can())
ck("after: a signed-in page can't call it either", not auth_can())
ck("after: nobody gets it through 'everyone'", not one("select has_function_privilege('public', 'submit_standup_note_public(text,text,text,text,text)'::regprocedure, 'execute')"))
ck("the CC Hub is mapped to the two lists once each (ran twice)", one("select count(*) from app_data_key_hub_map where hub_slug = 'care_coordinator' and data_key in ('standup_notes','team_meetings')") == 2)
ck("the Team Hub keeps them", one("select count(*) from app_data_key_hub_map where hub_slug = 'team_hub' and data_key in ('standup_notes','team_meetings','team_hub_settings')") == 3)
ck("nothing else was opened to the CC Hub", one("select count(*) from app_data_key_hub_map where hub_slug = 'care_coordinator'") == 4)
ops = one("select data from app_data where key = 'ops_settings'")
ck("the video room name is copied into the CC Hub settings, other settings untouched",
   ops.get("team_video_room", {}).get("room_name") == "CaringCompanions-TeamHub-abc123xyz" and ops["team_video_room"].get("copied_from") == "team_hub_settings" and ops.get("afternoon_interviews") == {"from": "14:00"}, ops)
ck("the board and meetings themselves are untouched", one("select data from app_data where key = 'standup_notes'") == [{"id": "s1", "summary": "Night call-out"}] and one("select data from app_data where key = 'team_meetings'") == [{"id": "m1", "meeting_name": "Weekly Team Meeting"}])
st, out = as_user(["care_coordinator"], "select count(*) from app_data where key in ('standup_notes','team_meetings')")
ck("a CC Hub-only person can read the board and meetings", st == "ok" and out[0][0] == 2, out)
st, out = as_user(["care_coordinator"], "select upsert_app_data_item('standup_notes', '{\"id\":\"s2\",\"summary\":\"from the CC Hub\"}'::jsonb)")
ck("...and add to the board one item at a time", st == "ok" and len(one("select data from app_data where key = 'standup_notes'")) == 2, out)
c.run("update app_data set data = '[{\"id\":\"s1\",\"summary\":\"Night call-out\"}]' where key = 'standup_notes'")
ck("a CC Hub-only person still can't see the Team Hub settings", as_user(["care_coordinator"], "select count(*) from app_data where key = 'team_hub_settings'")[1][0][0] == 0)
ck("a Staffing-only person still can't see the board", as_user(["staffing"], "select count(*) from app_data where key = 'standup_notes'")[1][0][0] == 0)
ck("a Team Hub person still can", as_user(["team_hub"], "select count(*) from app_data where key = 'standup_notes'")[1][0][0] == 1)
st, out = as_user(["staffing"], "select upsert_app_data_item('standup_notes', '{\"id\":\"s9\"}'::jsonb)")
ck("a Staffing-only person can't add to it", st == "refused", out)
r = probe()
ck("the proof says DONE, and prints yes/no and counts only", isinstance(r, dict) and r == {"functions": 1, "anon_can_call": False, "signed_in_can_call": False, "everyone_can_call": False, "claim_read": True,
   "board_exists": 1, "meetings_exist": 1, "cc_sees_board": 1, "cc_sees_meetings": 1, "cc_sees_settings": 1, "cc_sees_team_hub_settings": 0, "cc_can_add": "went in",
   "staffing_only_sees_board": 0, "team_room": True, "room_copied_same": True}, r)
ck("the proof left nothing behind", one("select data from app_data where key = 'standup_notes'") == [{"id": "s1", "summary": "Night call-out"}])
c.run("update app_data set data = jsonb_set(data, '{team_video_room,room_name}', '\"CaringCompanions-TeamHub-zzzzzzzzzzzz\"') where key = 'ops_settings'")
c.run("begin"); c.run(MOVE); c.run("commit")
ck("a second run never overwrites the Hub's room", one("select data->'team_video_room'->>'room_name' from app_data where key = 'ops_settings'") == "CaringCompanions-TeamHub-zzzzzzzzzzzz")
c.run("update app_data set data = jsonb_set(data, '{team_video_room,room_name}', '\"CaringCompanions-TeamHub-abc123xyz\"') where key = 'ops_settings'")

c.run(BACK)
ck("undo: the function is callable as before", anon_can() and auth_can())
ck("undo: the two map rows are gone, the Team Hub's stay", one("select count(*) from app_data_key_hub_map where hub_slug = 'care_coordinator'") == 2 and one("select count(*) from app_data_key_hub_map where hub_slug = 'team_hub'") == 3)
ops = one("select data from app_data where key = 'ops_settings'")
ck("undo: the copied room name is gone, the other settings stay", ops == {"afternoon_interviews": {"from": "14:00"}}, ops)
# no team room: nothing is copied, nothing breaks
c.run("update app_data set data = '[{\"id\":\"hub_config\"}]' where key = 'team_hub_settings'")
c.run("begin"); c.run(MOVE); c.run("commit")
ck("with no team room, nothing is copied", "team_video_room" not in one("select data from app_data where key = 'ops_settings'"))
r = probe(); ck("...and the proof says so", isinstance(r, dict) and r["team_room"] is False and r["cc_can_add"] == "went in", r)
c.close()
for n, okk, d in res: print(("PASS" if okk else "FAIL"), "·", n, d)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
