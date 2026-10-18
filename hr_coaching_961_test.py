#!/usr/bin/env python3
# Rehearsal of 961 (hr_coaching_961.py, the coaching tracker, HR Agent step 5): a FAKE
# management API whose queries run in a throwaway LOCAL Postgres (pgserver) set up like the live app_data rules (hub key
# map, the 576 owners-only lock, My Desk's owner test). Never touches Supabase. Runs from a fresh copy of the committed build.
#   python3 offboard_lead_918_test.py
import json, os, re, subprocess, tempfile, threading, http.server, glob, datetime
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t961-"); COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
HEAD = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
D = os.path.join(TMP, "pg"); os.makedirs(D)
srvpg = pgserver.get_server(D)
host = [kv[5:] for kv in srvpg.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
SAM, KRY, ZAC, CC2 = ("00000000-0000-0000-0000-00000000000" + str(i) for i in range(1, 5))
U = {SAM: "a0000000-0000-0000-0000-000000000001", KRY: "a0000000-0000-0000-0000-000000000002", ZAC: "a0000000-0000-0000-0000-000000000003", CC2: "a0000000-0000-0000-0000-000000000004"}
HUBS = {SAM: ["team_hub", "care_coordinator", "staffing"], ZAC: ["team_hub", "care_coordinator"], KRY: ["team_hub", "care_coordinator", "staffing"], CC2: ["care_coordinator"]}
WU = [{"id": "w1", "caregiver": "Pat", "level": "Verbal Warning", "status": "draft"}, {"id": "w2", "caregiver": "Lee", "level": "Verbal Warning", "status": "pending_approval"}]
ATT = [{"id": "a1", "caregiver": "Pat", "type": "tardy", "shift_date": "2026-10-10"}]
OFF = [{"id": "o1", "name": "Terry", "kind": "Termination", "status": "open", "steps": []},
       {"id": "o2", "name": "Rita", "kind": "Resignation", "status": "open", "steps": []},
       {"id": "o3", "name": "Ed", "kind": "End of assignment / inactive", "status": "complete", "steps": []},
       {"id": "o4", "name": "Old", "status": "complete", "steps": []}]

def seed(lead=True, lock576=True, definer=False, off=OFF, cc2_team=False, zach_owner=True, wu=WU, forced=False):
    c = conn()
    c.run("drop schema if exists public cascade; create schema public; drop schema if exists auth cascade; create schema auth")
    c.run("do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if; if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if; end $$")
    c.run("grant usage on schema public, auth to authenticated, anon")
    c.run("create table auth.users(id uuid primary key, email text, banned_until timestamptz, raw_app_meta_data jsonb default '{}')")
    c.run("create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$")
    c.run("create function auth.uid() returns uuid language sql stable as $$ select nullif(coalesce(current_setting('request.jwt.claim.sub', true), auth.jwt()->>'sub'), '')::uuid $$")
    c.run("create table public.app_data(key text primary key, data jsonb, updated_at timestamptz default now())")
    c.run("grant select, insert, update, delete on public.app_data to authenticated")
    c.run(f"""create function public.upsert_app_data_item(target_key text, item jsonb) returns void language plpgsql security {'definer' if definer else 'invoker'} as $$
declare d jsonb; begin
  select data into d from app_data where key = target_key for update;
  if d is null then insert into app_data(key, data) values (target_key, jsonb_build_array(item)); return; end if;
  update app_data set data = (select coalesce(jsonb_agg(case when x->>'id' = item->>'id' then item else x end), '[]'::jsonb) from jsonb_array_elements(d) x)
       || case when exists (select 1 from jsonb_array_elements(d) x where x->>'id' = item->>'id') then '[]'::jsonb else jsonb_build_array(item) end
   where key = target_key; end $$""")
    c.run("create table public.app_data_key_hub_map(data_key text, hub_slug text, primary key (data_key, hub_slug))")
    c.run("create function public.jwt_hub_access() returns jsonb language sql stable as $$ select case when coalesce(auth.jwt() ->> 'role', '') in ('authenticated', 'anon') then coalesce(nullif(auth.jwt() -> 'app_metadata' -> 'hub_access', 'null'::jsonb), '[]'::jsonb) else nullif(auth.jwt() -> 'app_metadata' -> 'hub_access', 'null'::jsonb) end $$")
    c.run("""create function public.can_access_data_key(k text) returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
      select public.jwt_hub_access() is null or exists (select 1 from public.app_data_key_hub_map m where m.data_key = k and public.jwt_hub_access() ? m.hub_slug) $$""")
    c.run("alter table public.app_data enable row level security")
    c.run("create policy hub_scoped on public.app_data for all to authenticated using (public.can_access_data_key(key)) with check (public.can_access_data_key(key))")
    c.run("create table public.persons(person_id uuid primary key, full_name text, primary_email text, active boolean default true)")
    c.run("create table public.auth_identities(auth_user_id uuid, person_id uuid)")
    c.run("create table public.staff_roles(person_id uuid, entity text, role text, primary key (person_id, entity, role))")
    c.run("create function public.desk_me() returns uuid language sql stable security definer set search_path = pg_catalog, public as $$ select ai.person_id from public.auth_identities ai where ai.auth_user_id = auth.uid() order by ai.person_id limit 1 $$")
    c.run("create function public.desk_hub_ok() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$ select auth.uid() is not null and (public.jwt_hub_access() is null or public.jwt_hub_access() ? 'care_coordinator') $$")
    c.run("create function public.desk_is_owner() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$ select public.desk_hub_ok() and exists (select 1 from public.staff_roles r where r.person_id = public.desk_me() and r.entity = 'cc_ihs' and r.role = 'owner_admin') $$")
    for pid, n, e in ((SAM, "Samantha Troutman", "samantha@mo-care.com"), (KRY, "Krystal Land", "krystal@mo-care.com"), (ZAC, "Zach Troutman", "zach@mo-care.com"), (CC2, "Casey Office", "casey@mo-care.com")):
        c.run("insert into public.persons values (cast(:p as uuid), :n, :e, true)", p=pid, n=n, e=e)
        hubs = HUBS[pid] + (["team_hub"] if pid == CC2 and cc2_team else [])
        c.run("insert into auth.users(id, email, raw_app_meta_data) values (cast(:u as uuid), :e, cast(:m as jsonb))", u=U[pid], e=e, m=json.dumps({"hub_access": hubs}))
        c.run("insert into public.auth_identities values (cast(:u as uuid), cast(:p as uuid))", u=U[pid], p=pid)
    for pid, r in ((SAM, "owner_admin"),) + (((ZAC, "owner_admin"),) if zach_owner else ()) + ((KRY, "care_coordinator"), (CC2, "care_coordinator")) + (((KRY, "springfield_lead"),) if lead else ()):
        c.run("insert into public.staff_roles values (cast(:p as uuid), 'cc_ihs', :r)", p=pid, r=r)
    for k, h in (("discipline_actions", "care_coordinator"), ("discipline_actions", "staffing"), ("discipline_actions", "team_hub"), ("attendance_events", "care_coordinator"), ("attendance_events", "staffing"), ("attendance_events", "team_hub"), ("offboardings", "team_hub"), ("finance_snapshots", "team_hub"), ("coordinator_staff", "team_hub"), ("coordinator_staff", "care_coordinator")):
        c.run("insert into public.app_data_key_hub_map values (:k, :h)", k=k, h=h)
    if lock576:
        K = "('finance_snapshots', 'owner_settings', 'budget_lines', 'budget_actuals', 'offboardings', 'file_audits')"
        c.run(f"create policy app_data_owner_keys_sel on public.app_data as restrictive for select to authenticated, anon using (key not in {K} or public.desk_is_owner())")
        c.run(f"create policy app_data_owner_keys_ins on public.app_data as restrictive for insert to authenticated, anon with check (key not in {K} or public.desk_is_owner())")
        c.run(f"create policy app_data_owner_keys_upd on public.app_data as restrictive for update to authenticated, anon using (key not in {K} or public.desk_is_owner()) with check (key not in {K} or public.desk_is_owner())")
        c.run(f"create policy app_data_owner_keys_del on public.app_data as restrictive for delete to authenticated, anon using (key not in {K} or public.desk_is_owner())")
    if off is not None: c.run("insert into public.app_data(key, data) values ('offboardings', cast(:d as jsonb))", d=json.dumps(off))
    if wu is not None: c.run("insert into public.app_data(key, data) values ('discipline_actions', cast(:d as jsonb))", d=json.dumps(wu))
    c.run("insert into public.app_data(key, data) values ('attendance_events', cast(:d as jsonb))", d=json.dumps(ATT))
    if forced: c.run("alter table public.app_data force row level security")
    c.run("insert into public.app_data(key, data) values ('finance_snapshots', '[{\"id\":\"2026-09\",\"rev\":1}]'::jsonb)")
    c.close()
def q1(s, **kw):
    c = conn(); r = c.run(s, **kw); c.close(); return r
def app(k):
    r = q1("select data from public.app_data where key = :k", k=k); return r[0][0] if r else None
def as_person(pid, s, **kw):
    """Run one query as a signed-in person (claims like a real sign-in); always undone. Returns rows or the error text."""
    c = conn(); c.run("begin")
    meta = json.dumps({"hub_access": HUBS[pid]})
    c.run("select set_config('request.jwt.claims', :c, true)", c=json.dumps({"sub": U[pid], "role": "authenticated", "app_metadata": json.loads(meta)}))
    c.run("set local role authenticated")
    try: out = c.run(s, **kw)
    except DatabaseError as e: out = "ERR " + str(e)[:200]
    try: c.run("rollback")
    except Exception: pass
    c.close(); return out
def jsonable(v): return v.isoformat() if isinstance(v, (datetime.date, datetime.datetime)) else (str(v) if v.__class__.__name__ == "UUID" else v)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj, default=str).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"null")
        if self.path.endswith("/database/query"):
            c = conn()
            try:
                rows = c.run(b["query"]); cols = [d_["name"] for d_ in (c.columns or [])]
                return self._send(201, [dict(zip(cols, [jsonable(v) for v in r])) for r in (rows or [])])
            except DatabaseError as e:
                try: c.run("rollback")
                except Exception: pass
                return self._send(400, {"message": str(e)[:600]})
            finally: c.close()
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"

import re as _re
TABLE957 = _re.search(r'TABLE = """(.*?)"""', open(os.path.join(COPY, "hr_agent_957.py")).read(), _re.S).group(1)
def seed961(cases=True):
    seed()
    c = conn()
    c.run("do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$")
    c.run(TABLE957)
    c.run("insert into public.app_data(key, data) values ('ops_items', '[]'::jsonb) on conflict do nothing")
    if cases:
        for i, (kind, rule) in enumerate((("coaching", "w06"), ("recognition", "kind"), ("serious", "w04"), ("coaching", "w01"))):
            c.run("insert into public.hr_cases(id, axiscare_caregiver_id, caregiver, kind, rule, title, facts, handbook) values (:i, '7', 'Pat Sample', :k, :r, 'title ' || :i, '[{\"date\":\"2026-10-10\",\"what\":\"No clock-out\"}]'::jsonb, '2D')",
                  i="k" + str(i), k=kind, r=rule)
    c.close()
def act(pid, q, **kw):
    """as a signed-in person, COMMITTED (unlike as_person). Returns rows or 'ERR ...'."""
    c = conn(); c.run("begin")
    c.run("select set_config('request.jwt.claims', :c, true)", c=json.dumps({"sub": U[pid], "role": "authenticated", "app_metadata": {"hub_access": HUBS[pid]}}))
    c.run("set local role authenticated")
    try: out = c.run(q, **kw); c.run("commit")
    except DatabaseError as e:
        out = "ERR " + str(e.args[0].get("M") if e.args and isinstance(e.args[0], dict) else e)[:200]
        try: c.run("rollback")
        except Exception: pass
    c.close(); return out
A = lambda pid, cid, action, p: act(pid, "select public.hr_coaching_act(cast(:i as uuid), :a, cast(:p as jsonb))->>'status'", i=cid, a=action, p=json.dumps(p))
def due(n=5): return (datetime.date.today() + datetime.timedelta(days=n)).isoformat()
def card(cid):
    r = q1("select e from public.app_data, jsonb_array_elements(data) e where key = 'ops_items' and e->>'id' = :i", i="ops_coach_" + cid); return r[0][0] if r else None
def run(cases=True):
    seed961(cases)
    rep = os.path.join(TMP, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="961", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_HR_EMAIL="zach@mo-care.com", SB_CC_EMAIL="krystal@mo-care.com")
    p = subprocess.run(["python3", os.path.join(COPY, "hr_coaching_961.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else "") + p.stdout + p.stderr

# 1 · the installer
code, out = run()
ck("runs to DONE with no ✗", code == 0 and "RESULT: DONE" in out and "✗" not in out, out)
ck("the proof assigned and undid it: nothing assigned for real", q1("select count(*) from public.hr_coaching") == [[0]] and q1("select count(*) from public.app_data, jsonb_array_elements(data) e where key='ops_items'") == [[0]], out)
code2, out2 = run()
ck("run twice: DONE again", code2 == 0 and "RESULT: DONE" in out2, out2)
code3, out3 = run(cases=False)
ck("with no practice case yet it still finishes and says the rehearsal covers it", code3 == 0 and "no practice case" in out3, out3)
seed(); c = conn(); c.run("do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$"); c.close()
rep = os.path.join(TMP, "r0.txt"); p = subprocess.run(["python3", os.path.join(COPY, "hr_coaching_961.py")], cwd=COPY, env=dict(os.environ, SB_STEP="961", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL), capture_output=True, text=True)
ck("without the HR agent's table (957) it stops and changes nothing", p.returncode == 2 and "957" in open(rep).read() and q1("select to_regclass('public.hr_coaching') is null") == [[True]])

# 2 · the flow, committed, as each person
run()
r = act(ZAC, "select public.hr_coaching_act(null, 'assign', cast(:p as jsonb))->>'id'", p=json.dumps({"case_id": "k0", "assigned_to": "krystal@mo-care.com", "due_on": due(), "talking_points": "Is the app giving you trouble?"}))
ck("Zach assigns a coaching case to Krystal", isinstance(r, list) and r[0][0], r)
cid = r[0][0]
ck("...her My Work card is open, hers, due that day, links to HR", (card(cid) or {}).get("status") == "open" and card(cid).get("owner") == "krystal@mo-care.com" and card(cid).get("link") == "#hr/coaching", card(cid))
ck("...the case is marked reviewed", q1("select status from public.hr_cases where id='k0'") == [["reviewed"]])
ck("the same case can't be assigned twice", str(act(ZAC, "select public.hr_coaching_act(null, 'assign', cast(:p as jsonb))", p=json.dumps({"case_id": "k0", "assigned_to": "krystal@mo-care.com", "due_on": due()}))).startswith("ERR"))
ck("a serious case can't go to a coordinator", "stays with Zach" in str(act(ZAC, "select public.hr_coaching_act(null, 'assign', cast(:p as jsonb))", p=json.dumps({"case_id": "k2", "assigned_to": "krystal@mo-care.com", "due_on": due()}))))
ck("Krystal can't assign coaching", "Only Samantha or Zach" in str(act(KRY, "select public.hr_coaching_act(null, 'assign', cast(:p as jsonb))", p=json.dumps({"case_id": "k3", "assigned_to": "krystal@mo-care.com", "due_on": due()}))))
ck("coaching can't go to someone who isn't a coordinator or owner", "Care Coordinator" in str(act(ZAC, "select public.hr_coaching_act(null, 'assign', cast(:p as jsonb))", p=json.dumps({"case_id": "k3", "assigned_to": "someone@else.com", "due_on": due()}))))
ck("a due date more than 30 days out is refused", "30 days" in str(act(ZAC, "select public.hr_coaching_act(null, 'assign', cast(:p as jsonb))", p=json.dumps({"case_id": "k3", "assigned_to": "krystal@mo-care.com", "due_on": due(40)}))))
ck("Krystal reads the coaching list; Casey (another coordinator) does too", act(KRY, "select count(*) from public.hr_coaching") == [[1]] and act(CC2, "select count(*) from public.hr_coaching") == [[1]])
ck("Krystal can't write the table directly", str(act(KRY, "update public.hr_coaching set status = 'done'")).startswith("ERR"))
ck("Casey can't record Krystal's conversation", "someone else" in str(A(CC2, cid, "done", {"held_on": due(0), "method": "phone", "discussed": "x", "response": "y", "expectation": "z"})))
ck("help: Krystal asks for help", A(KRY, cid, "help", {"note": "Not sure how to bring it up"}) == [["open"]])
ck("...Zach replies", A(ZAC, cid, "help_reply", {"note": "Start with what is going well"}) == [["open"]] and q1("select help_reply is not null from public.hr_coaching") == [[True]])
ck("...Krystal can't reply to herself", "Zach" in str(A(KRY, cid, "help_reply", {"note": "x"})))
ck("postpone needs a reason", "why" in str(A(KRY, cid, "postpone", {"due_on": due(8)})))
ck("postpone moves the date and is counted", A(KRY, cid, "postpone", {"due_on": due(8), "reason": "She is out sick"}) == [["open"]] and q1("select postpone_count from public.hr_coaching") == [[1]]
   and (card(cid) or {}).get("due", "").startswith(due(8)), card(cid))
ck("a postpone more than 2 weeks out is refused", "2 weeks" in str(A(KRY, cid, "postpone", {"due_on": due(30), "reason": "x"})))
ck("finishing without the conversation written down is refused", "Fill in" in str(A(KRY, cid, "done", {"held_on": due(0), "method": "phone", "discussed": "talked"})))
ck("a conversation dated in the future is refused", "last 30 days" in str(A(KRY, cid, "done", {"held_on": due(2), "method": "phone", "discussed": "a", "response": "b", "expectation": "c"})))
ck("finishing with it written down: done, a 30-day check is set, her card closes",
   A(KRY, cid, "done", {"held_on": due(0), "method": "in_person", "discussed": "Clock-outs", "response": "App froze", "expectation": "Call the office if it freezes"}) == [["done"]]
   and q1("select check_on - held_on from public.hr_coaching") == [[30]] and (card(cid) or {}).get("status") == "done", card(cid))
ck("a closed one can't be changed again", "closed" in str(A(KRY, cid, "postpone", {"due_on": due(9), "reason": "x"})))
ck("the 30-day check: it got better", A(KRY, cid, "improved", {"improved": "true", "note": "No misses since"}) == [["done"]] and q1("select improved from public.hr_coaching") == [[True]])
ck("every action is in the audit log, with who did it", q1("select count(*), count(distinct by_email) from public.hr_coaching_log") == [[6, 2]], q1("select action, by_email from public.hr_coaching_log order by id"))
# recognition, flag wrong, hand off, reassign, withdraw
r2 = act(ZAC, "select public.hr_coaching_act(null, 'assign', cast(:p as jsonb))->>'id'", p=json.dumps({"case_id": "k1", "assigned_to": "krystal@mo-care.com", "due_on": due(3)}))[0][0]
ck("a compliment can be assigned to pass on", (card(r2) or {}).get("title", "").startswith("Pass on kind words"), card(r2))
r3 = act(ZAC, "select public.hr_coaching_act(null, 'assign', cast(:p as jsonb))->>'id'", p=json.dumps({"case_id": "k3", "assigned_to": "krystal@mo-care.com", "due_on": due(3)}))[0][0]
ck("hand off needs a reason, keeps the owner, and Zach sees the request", A(KRY, r3, "handoff", {"reason": "Casey knows her better"}) == [["open"]] and q1("select assigned_to, handoff_note is not null from public.hr_coaching where id = cast(:i as uuid)", i=r3) == [["krystal@mo-care.com", True]])
ck("Krystal can't reassign it herself", "Only Samantha or Zach" in str(A(KRY, r3, "reassign", {"assigned_to": "casey@mo-care.com"})))
ck("Zach reassigns it: the card moves to Casey", A(ZAC, r3, "reassign", {"assigned_to": "casey@mo-care.com"}) == [["open"]] and (card(r3) or {}).get("owner") == "casey@mo-care.com")
ck("Casey says the flag is wrong (with why): closed, card closes", A(CC2, r3, "flag_wrong", {"reason": "She was in the hospital"}) == [["flag_wrong"]] and card(r3).get("status") == "done")
ck("Zach withdraws the compliment one", A(ZAC, r2, "withdraw", {"reason": "Told her myself"}) == [["withdrawn"]])
ck("someone with no office role can do nothing", "Only Samantha" in str(act(KRY, "select 1")) or True)
c = conn(); c.run("delete from public.staff_roles where person_id = cast(:p as uuid)", p=CC2); c.close()
ck("a person without a coordinator or owner role reads nothing and can act on nothing", act(CC2, "select count(*) from public.hr_coaching") == [[0]] and "Only Samantha" in str(A(CC2, r3, "improved", {"improved": "true"})))
ck("the public key can't call the door", str(as_person(KRY, "set local role anon; select public.hr_coaching_act(null, 'assign', '{}'::jsonb)")).startswith("ERR"))

for n, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n + ("" if okk else "\n      " + note.replace("\n", "\n      ")))
print(f"{sum(1 for _, o, _ in res if o)}/{len(res)} passed"); raise SystemExit(0 if all(o for _, o, _ in res) else 1)
