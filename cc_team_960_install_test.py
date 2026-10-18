#!/usr/bin/env python3
# Rehearsal of 960 (cc_team_960.py, reviews and the overdue log server-only, Care Coordinator Leads and Bonus Stage 5): a FAKE
# management API whose queries run in a throwaway LOCAL Postgres (pgserver) set up like the live app_data rules (hub key
# map, the 576 owners-only lock, My Desk's owner test). Never touches Supabase. Runs from a fresh copy of the committed build.
# The database part only (SB_REHEARSAL_DB_ONLY=1): the function deploy and the schedule are covered by cc_team_960_test.mjs.
#   python3 cc_team_960_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, glob, datetime
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t960-"); COPY = os.path.join(TMP, "hub")
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

def seed(lead=True, lock576=True, definer=False, off=OFF, cc2_team=False, zach_owner=True, wu=WU, forced=False, mapped=False, bonuses=True):
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
    if mapped: c.run("insert into public.app_data_key_hub_map values ('cc_overdue_log', 'care_coordinator')")
    if bonuses:
        c.run("insert into public.app_data(key, data) values ('cc_reviews', cast(:d as jsonb))", d=json.dumps([{"id": "rev_x", "person": "Pat", "status": "open"}]))
        c.run("insert into public.app_data(key, data) values ('cc_overdue_log', cast(:d as jsonb))", d=json.dumps([{"id": "od_x", "person": "Pat", "key": "x"}]))
    c.run("insert into public.app_data(key, data) values ('ops_settings', '{\"bonus_live\": false}'::jsonb)")
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
def run(**seedargs):
    seed(**seedargs)
    rep = os.path.join(TMP, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="960", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_REHEARSAL_DB_ONLY="1")
    p = subprocess.run(["python3", os.path.join(COPY, "cc_team_960.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=300)
    txt = open(rep).read() if os.path.exists(rep) else ""
    return p.returncode, txt + p.stdout + p.stderr

# 1 · the real run
code, out = run()
ck("runs to DONE with no ✗", code == 0 and "RESULT: DONE" in out and "✗" not in out, out)
ck("the report gives a count, never names", "reviews on file now: 1" in out and "Pat" not in out, out)
ck("the proof lines ran for an owner and a Care Coordinator, for both slots", all(f"({w}, undone after): can't read {x}; can't save into it" in out for w in ("an owner", "a Care Coordinator") for x in ("the reviews", "the overdue log")), out)
ck("the records are unchanged", [x["id"] for x in app("cc_reviews")] == ["rev_x"] and [x["id"] for x in app("cc_overdue_log")] == ["od_x"])
# 2 · the rules themselves, as each person
see = "select key from public.app_data where key in ('cc_reviews', 'cc_overdue_log', 'attendance_events') order by key"
for pid, who in ((SAM, "Samantha (owner)"), (ZAC, "Zach (owner)"), (KRY, "Krystal"), (CC2, "another Care Coordinator")):
    ck(f"{who} can't read the reviews or the overdue log (attendance still reads)", as_person(pid, see) == [["attendance_events"]], as_person(pid, see))
probe = lambda pid, key, iid: (lambda r: r[-1:] if isinstance(r, list) else r)(as_person(pid, f"select public.upsert_app_data_item('{key}', '{json.dumps({'id': iid, 'status': 'done'})}'::jsonb); reset role; select count(*) from public.app_data a, jsonb_array_elements(a.data) x where a.key = '{key}' and x->>'id' = '{iid}'"))
ck("Krystal can't save a review", probe(KRY, "cc_reviews", "r1") != [[1]], probe(KRY, "cc_reviews", "r1"))
ck("Zach can't save one from a page either (only the server function does)", probe(ZAC, "cc_reviews", "r2") != [[1]], probe(ZAC, "cc_reviews", "r2"))
ck("Krystal can't add to the overdue log", probe(KRY, "cc_overdue_log", "o1") != [[1]])
ck("...while attendance still saves for Krystal (same kind of test, so it proves the test works)", probe(KRY, "attendance_events", "a9") == [[1]])
ck("nobody signed in can delete either slot", as_person(SAM, "delete from public.app_data where key in ('cc_reviews', 'cc_overdue_log') returning key") in ([],) and q1("select count(*) from public.app_data where key in ('cc_reviews', 'cc_overdue_log')") == [[2]])
ck("the server (no signed-in person) still reads and writes them", q1("select public.upsert_app_data_item('cc_reviews', '{\"id\": \"rev_y\"}'::jsonb)") is not None and len(app("cc_reviews")) == 2)
ck("the 576 owner lock is untouched", q1("select count(*) from pg_policies where policyname like 'app_data_owner_keys_%'") == [[4]])
# 3 · safe to run again, and with nothing on file yet
seed(); env = dict(os.environ, SB_STEP="960", SB_TOKEN="sbp_test", SB_REPORT=os.path.join(TMP, "r2.txt"), SB_API_BASE=URL, SB_REHEARSAL_DB_ONLY="1")
a = subprocess.run(["python3", os.path.join(COPY, "cc_team_960.py")], cwd=COPY, env=env, capture_output=True, text=True)
b = subprocess.run(["python3", os.path.join(COPY, "cc_team_960.py")], cwd=COPY, env=env, capture_output=True, text=True)
ck("run twice: second run DONE, still four rules", a.returncode == 0 and b.returncode == 0 and q1("select count(*) from pg_policies where policyname like 'app_data_cc_team_%'") == [[4]], open(os.path.join(TMP, "r2.txt")).read())
code2, out2 = run(bonuses=False)
ck("with nothing on file yet, it still finishes", code2 == 0 and "RESULT: DONE" in out2 and "reviews on file now: 0" in out2, out2)
# 4 · the undo file puts it back
seed(); run()
c = conn(); c.run(open(os.path.join(COPY, "cc_team_960_rollback.sql")).read()); c.close()
ck("the undo file removes the four rules", q1("select count(*) from pg_policies where policyname like 'app_data_cc_team_%'") == [[0]])
# 5 · it stops before changing anything when the ground is wrong
for name, args, want in (("saves bypass the rules", dict(definer=True), "runs as its owner"),
                         ("row security is forced", dict(forced=True), "not in its usual state"),
                         ("a hub's key map lists a slot", dict(mapped=True), "key map lists")):
    code3, out3 = run(**args)
    ck(f"stops with nothing changed when {name}", code3 == 2 and want in out3 and q1("select count(*) from pg_policies where policyname like 'app_data_cc_team_%'") == [[0]], out3)

for n, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n + ("" if okk else "\n      " + note.replace("\n", "\n      ")))
print(f"{sum(1 for _, o, _ in res if o)}/{len(res)} passed"); raise SystemExit(0 if all(o for _, o, _ in res) else 1)
