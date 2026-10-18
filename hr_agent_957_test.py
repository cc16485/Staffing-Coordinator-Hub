#!/usr/bin/env python3
# Rehearsal of 957 (hr_agent_957.py, the HR agent in practice, HR Agent step 4): a FAKE
# management API whose queries run in a throwaway LOCAL Postgres (pgserver) set up like the live app_data rules (hub key
# map, the 576 owners-only lock, My Desk's owner test). Never touches Supabase. Runs from a fresh copy of the committed build.
#   python3 offboard_lead_918_test.py
import json, os, re, subprocess, tempfile, threading, http.server, glob, datetime
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t957-"); COPY = os.path.join(TMP, "hub")
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

import hashlib, shutil
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def extra_seed(cron=True, vault=1):
    c = conn()
    c.run("do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$")
    c.run("drop schema if exists cron cascade; drop schema if exists vault cascade; drop schema if exists net cascade")
    c.run("create schema if not exists cron; create schema if not exists vault; create schema if not exists net")
    c.run("create table if not exists cron.job(jobid serial, jobname text unique, schedule text, command text)")
    c.run("create or replace function cron.schedule(n text, s text, cmd text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (n, s, cmd) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$")
    c.run("create or replace function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$")
    c.run("create table if not exists vault.decrypted_secrets(name text, decrypted_secret text)")
    if vault: c.run("insert into vault.decrypted_secrets values ('hub_job_secret', 'sekret')")
    c.run("create table if not exists net._http_response(id bigserial primary key, status_code int, content text)")
    ok = '{\"ok\": true, \"caller\": \"cron\"}' if cron else '{\"error\": \"not allowed\"}'
    c.run(f"create or replace function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$ insert into net._http_response(status_code, content) values ({200 if cron else 401}, '{ok}') returning id $$")
    c.run("grant usage on schema net, cron, vault to authenticated")
    c.close()
M = {}
class F(http.server.BaseHTTPRequestHandler):
    """the fake management API (GET/PATCH) and the fake hr-agent function"""
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if "/api-keys" in self.path: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if self.path.endswith("/functions/hr-agent"):
            return self._send(200, {"version": 1, "verify_jwt": True}) if os.path.exists(os.path.join(TMP, "deployed")) else self._send(404, {})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"null")
        if self.path.endswith("/database/query"): return H.do_POST.__get__(self)() if False else self._query(body)
        if self.path.startswith("/functions/v1/hr-agent"):
            auth = self.headers.get("Authorization", "")
            if "auth_check" in self.path: return self._send(401 if "anon" in auth else 200, {"error": "not allowed"} if "anon" in auth else {"ok": True, "caller": "owner"})
            if "svc" not in auth: return self._send(401, {"error": "not allowed"})
            c = conn()
            for i, k in enumerate(("coaching", "serious")):
                c.run("insert into public.hr_cases(id, axiscare_caregiver_id, caregiver, kind, rule, title, practice) values (:i, '1', 'CG 1', :k, 'w06', 't', :p) on conflict do nothing",
                      i="hr_t" + str(i), k=k, p=not M.get("live"))
            c.close()
            return self._send(200, {"ok": True, "live": bool(M.get("live")), "found": 2, "saved": 2, "by_kind": {"coaching": 1, "serious": 1}})
        self._send(404, {})
    def _query(self, b):
        c = conn()
        try:
            rows = c.run(b["query"]); cols = [d_["name"] for d_ in (c.columns or [])]
            return self._send(201, [dict(zip(cols, [jsonable(v) for v in r])) for r in (rows or [])])
        except DatabaseError as e:
            try: c.run("rollback")
            except Exception: pass
            return self._send(400, {"message": str(e)[:600]})
        finally: c.close()
fsrv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), F); threading.Thread(target=fsrv.serve_forever, daemon=True).start()
FURL = f"http://127.0.0.1:{fsrv.server_address[1]}"
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN)
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]
if a[:2] == ['functions', 'deploy']: open(os.path.join({TMP!r}, 'deployed'), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree(os.path.join({COPY!r}, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
FNR = os.path.join(COPY, "supabase", "functions")
SHAS = {k: sha(os.path.join(FNR, k)) for k in ("hr-agent/index.ts", "_shared/hr-agent-rules.ts", "_shared/job-auth.ts")}
def run(cron=True, vault=1, live=False, shas=None, **seedargs):
    seed(**seedargs); extra_seed(cron, vault)
    M.clear(); M["live"] = live
    d = os.path.join(TMP, "deployed")
    if os.path.exists(d): os.remove(d)
    rep = os.path.join(TMP, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="957", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=FURL, SB_FN_BASE=FURL, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"),
               SB_FNROOT=FNR, SB_FN_SHAS=json.dumps(shas or SHAS), SB_SETTLE="0", SB_HR_EMAIL="zach@mo-care.com", SB_CC_EMAIL="krystal@mo-care.com")
    p = subprocess.run(["python3", os.path.join(COPY, "hr_agent_957.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=300)
    txt = open(rep).read() if os.path.exists(rep) else ""
    return p.returncode, txt + p.stdout + p.stderr

# 1 · the real run
code, out = run()
ck("runs to DONE with no ✗", code == 0 and "RESULT: DONE" in out and "✗" not in out, out)
ck("the case table is there with row security on and two rules", q1("select relrowsecurity from pg_class where oid = 'public.hr_cases'::regclass") == [[True]]
   and q1("select count(*) from pg_policies where tablename = 'hr_cases'") == [[2]])
ck("the schedule is in: every morning at 12:00 UTC, carrying the vault secret", q1("select schedule, command like '%x-cron-secret%' and command like '%vault.decrypted_secrets%' from cron.job where jobname = 'hr-agent'") == [["0 12 * * *", True]])
ck("the first practice run saved its cases as practice", q1("select count(*), bool_and(practice) from public.hr_cases") == [[2, True]])
ck("the report prints counts, never names or keys", "CG 1" not in out and "eyJ" not in out and "sbp_test" not in out, out)
# 2 · the rules, as each person
see = "select count(*) from public.hr_cases"
ck("Krystal reads no case", as_person(KRY, see) == [[0]], as_person(KRY, see))
ck("Zach and Samantha read every case", as_person(ZAC, see) == [[2]] and as_person(SAM, see) == [[2]])
mark = "update public.hr_cases set review = 'agree', reviewed_by = 'z' where id = 'hr_t0' returning id"
ck("Zach can mark a case agree", as_person(ZAC, mark) == [["hr_t0"]], as_person(ZAC, mark))
ck("Krystal can't mark one", as_person(KRY, mark) in ([],) or str(as_person(KRY, mark)).startswith("ERR"), as_person(KRY, mark))
ck("Zach can't change what a case says (only the review columns)", str(as_person(ZAC, "update public.hr_cases set kind = 'coaching' where id = 'hr_t1'")).startswith("ERR"))
ck("Zach can't add or delete a case", str(as_person(ZAC, "insert into public.hr_cases(id, axiscare_caregiver_id, caregiver, kind, rule, title) values ('x','1','x','coaching','w06','x')")).startswith("ERR")
   and str(as_person(ZAC, "delete from public.hr_cases where id = 'hr_t0'")).startswith("ERR"))
ck("the public key reads nothing", str(as_person(CC2, "set local role anon; select count(*) from public.hr_cases")).startswith("ERR"))
# 3 · safe to run again
code2, out2 = run()
ck("run twice: DONE again, the table and one schedule", code2 == 0 and q1("select count(*) from cron.job where jobname = 'hr-agent'") == [[1]], out2)
# 4 · it stops before changing anything when the ground is wrong
code3, out3 = run(vault=0)
ck("no jobs' secret: stops, nothing created", code3 == 3 and "secret" in out3 and q1("select to_regclass('public.hr_cases') is null") == [[True]], out3)
code4, out4 = run(shas={"hr-agent/index.ts": "0" * 64})
ck("not the reviewed build: stops before anything", code4 == 2 and "not the reviewed build" in out4 and q1("select to_regclass('public.hr_cases') is null") == [[True]], out4)
code5, out5 = run(live=True)
ck("if the agent ever answers LIVE, the step says so", code5 == 9 and "LIVE" in out5, out5)
code6, out6 = run(cron=False)
ck("if the schedule is refused, the step says so", code6 == 9 and "schedule was not let in" in out6, out6)

for n, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n + ("" if okk else "\n      " + note.replace("\n", "\n      ")))
print(f"{sum(1 for _, o, _ in res if o)}/{len(res)} passed"); raise SystemExit(0 if all(o for _, o, _ in res) else 1)
