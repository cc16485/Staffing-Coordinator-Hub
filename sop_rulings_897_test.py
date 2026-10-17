#!/usr/bin/env python3
# Rehearsal of 897 (sop_rulings_897.py, work area owners and the Springfield lead): a FAKE management API whose database
# queries run in a throwaway LOCAL Postgres (pgserver) set up like the live tables, a FAKE supabase CLI and fake function
# doors. Never touches GitHub, Supabase, GoHighLevel or AxisCare. Runs from a fresh copy of this folder's committed build.
#   python3 sop_rulings_897_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, glob, datetime
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t897-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN)
COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
HEAD = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
SHAS = {"hub-access/index.ts": sha(os.path.join(FNROOT, "hub-access/index.ts"))}

D = os.path.join(TMP, "pg"); os.makedirs(D)
srvpg = pgserver.get_server(D)
host = [kv[5:] for kv in srvpg.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
SAM, KRY, ZAC, CIE, ANG, CC2 = ("00000000-0000-0000-0000-00000000000" + str(i) for i in range(1, 7))
U = {SAM: "a0000000-0000-0000-0000-000000000001", KRY: "a0000000-0000-0000-0000-000000000002", ZAC: "a0000000-0000-0000-0000-000000000003",
     CIE: "a0000000-0000-0000-0000-000000000004", CC2: "a0000000-0000-0000-0000-000000000006"}
FDEF_SRC = open(os.path.join(os.path.expanduser("~"), "Claude/Projects/caring-companions-website/supabase/ops-foundation/002_staff_access_view.sql")).read() if os.path.exists(os.path.join(os.path.expanduser("~"), "Claude/Projects/caring-companions-website/supabase/ops-foundation/002_staff_access_view.sql")) else None
FDEF = FDEF_SRC[FDEF_SRC.index("create or replace function public.staff_access_overview()"):FDEF_SRC.index("end $fn$;") + len("end $fn$;")] if FDEF_SRC else None
def seed(role_map=None, cierra_backup=True, lead_already=False, fdef_variant=None, kry_signin=True):
    c = conn()
    c.run("drop schema if exists public cascade; create schema public; drop schema if exists auth cascade; create schema auth")
    c.run("do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if; end $$")
    c.run("grant usage on schema public, auth to authenticated")
    c.run("create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, last_sign_in_at timestamptz, banned_until timestamptz, raw_app_meta_data jsonb default '{}')")
    c.run("""create function auth.uid() returns uuid language sql stable as $$ select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
             (nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'sub'), '')::uuid $$""")
    c.run("create table public.app_data(key text primary key, data jsonb, updated_at timestamptz default now())")
    c.run("""create function public.upsert_app_data_item(target_key text, item jsonb) returns void language plpgsql security invoker as $$
declare d jsonb; begin
  select data into d from app_data where key = target_key for update;
  if d is null then insert into app_data(key, data) values (target_key, jsonb_build_array(item)); return; end if;
  update app_data set data = (select coalesce(jsonb_agg(case when x->>'id' = item->>'id' then item else x end), '[]'::jsonb) from jsonb_array_elements(d) x)
       || case when exists (select 1 from jsonb_array_elements(d) x where x->>'id' = item->>'id') then '[]'::jsonb else jsonb_build_array(item) end
   where key = target_key; end $$""")
    c.run("create table public.entities(code text primary key)"); c.run("insert into public.entities values ('cc_ihs')")
    c.run("create table public.persons(person_id uuid primary key, full_name text, primary_email text, active boolean default true)")
    c.run("create table public.entity_memberships(person_id uuid, entity text, active boolean default true)")
    c.run("create table public.auth_identities(auth_user_id uuid, person_id uuid)")
    c.run("create table public.staff_roles(person_id uuid references public.persons, entity text references public.entities(code), role text, granted_at timestamptz default now(), granted_by text, primary key (person_id, entity, role))")
    c.run("create table public.staff_role_types(role text primary key, label text not null, description text not null default '', sort int not null default 100, active boolean not null default true)")
    c.run("insert into public.staff_role_types(role, label) values ('owner_admin', 'Owner'), ('care_coordinator', 'Care Coordinator')")
    c.run("create table public.staff_role_audit(id bigserial primary key, at timestamptz default now(), actor_email text, subject_email text, person_id uuid, action text check (action in ('grant','revoke')), role text not null, note text)")
    c.run("create table public.domains(entity text, code text, label text, owner_person uuid references public.persons, backup_person uuid references public.persons, escalation_person uuid references public.persons, active boolean default true, sort_order int default 100, primary key (entity, code))")
    for pid, n, e in ((SAM, "Samantha Troutman", "samantha@mo-care.com"), (KRY, "Krystal Land", "krystal@mo-care.com"), (ZAC, "Zach Troutman", "zach@mo-care.com"),
                      (CIE, "Cierra Barber", "cierra@mo-care.com"), (ANG, "Angiel Falig", "angiel@mo-care.com"), (CC2, "Casey Office", "casey@mo-care.com")):
        c.run("insert into public.persons values (cast(:p as uuid), :n, :e, true)", p=pid, n=n, e=e)
        c.run("insert into public.entity_memberships values (cast(:p as uuid), 'cc_ihs', true)", p=pid)
        if pid in U and (pid != KRY or kry_signin):
            c.run("insert into auth.users(id, email, email_confirmed_at, banned_until) values (cast(:u as uuid), :e, now(), case when :p = cast(:cie as text) then now() + interval '100 years' else null end)", u=U[pid], e=e, p=pid, cie=CIE)
            c.run("insert into public.auth_identities values (cast(:u as uuid), cast(:p as uuid))", u=U[pid], p=pid)
    for pid, r in ((SAM, "owner_admin"), (ZAC, "owner_admin"), (KRY, "care_coordinator"), (CIE, "care_coordinator"), (CC2, "care_coordinator")) + (((KRY, "springfield_lead"),) if lead_already else ()):
        c.run("insert into public.staff_roles(person_id, entity, role) values (cast(:p as uuid), 'cc_ihs', :r)", p=pid, r=r)
    if lead_already: c.run("insert into public.staff_role_types(role, label) values ('springfield_lead', 'Springfield lead')")
    doms = [("family_enquiries", "Family enquiries", SAM, KRY, SAM, 10), ("scheduling_coverage", "Scheduling", KRY, None, SAM, 20), ("client_care", "Client care", KRY, SAM, SAM, 30),
            ("caregiver_performance", "Caregiver performance", KRY, None, SAM, 40), ("field_quality", "Field Quality", CIE, KRY if not cierra_backup else None, SAM, 45),
            ("recruiting_orientation", "Recruiting", SAM, CIE if cierra_backup else None, SAM, 50), ("payer_programs", "Payer Programs", ANG, None, SAM, 55),
            ("training_compliance", "Training", KRY, None, SAM, 60), ("program_administration", "Program administration", SAM, None, SAM, 70),
            ("money", "Money", SAM, ZAC, SAM, 80), ("incidents", "Incidents", SAM, ZAC, ZAC, 90)]
    for code, lab, o, b, e, so in doms:
        c.run("insert into public.domains values ('cc_ihs', :c, :l, cast(:o as uuid), cast(:b as uuid), cast(:e as uuid), true, :s)", c=code, l=lab, o=o, b=b, e=e, s=so)
    c.run((fdef_variant or FDEF)); c.run("grant execute on function public.staff_access_overview() to authenticated")
    st = {"coverage_alert_admins": ["samantha@mo-care.com"], "other_setting": 7}
    c.run("insert into public.app_data values ('ops_settings', cast(:d as jsonb))", d=json.dumps(st))
    if role_map is not None: c.run("insert into public.app_data values ('role_permissions', cast(:d as jsonb))", d=json.dumps(role_map))
    c.close()
def q1(sql_, **kw):
    c = conn(); r = c.run(sql_, **kw); c.close(); return r
def app(k):
    r = q1("select data from public.app_data where key = :k", k=k); return r[0][0] if r else None
def dom(code): return q1("select owner_person::text, backup_person::text, escalation_person::text from public.domains where code = :c", c=code)[0]
def as_person(uid):
    c = conn(); c.run("begin"); c.run("select set_config('request.jwt.claim.sub', :u, true)", u=uid); c.run("set local role authenticated")
    n = c.run("select count(*) from public.staff_access_overview()")[0][0]; c.run("rollback"); c.close(); return n

M = {}; CALLS = []
def reset(**m):
    M.clear(); M.update(dict(fail_deploy=None, gate=True), **m); CALLS.clear()
    p = os.path.join(TMP, "deploys")
    if os.path.exists(p): os.remove(p)
    open(os.path.join(TMP, "mode.json"), "w").write(json.dumps(M))
def deployed():
    p = os.path.join(TMP, "deploys")
    return [json.loads(l) for l in open(p).read().splitlines()] if os.path.exists(p) else []
def jsonable(v): return v.isoformat() if isinstance(v, (datetime.date, datetime.datetime)) else (str(v) if v.__class__.__name__ == "UUID" else v)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj, default=str).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self): CALLS.append(("OPTIONS", self.path)); self._send(200, {})
    def do_GET(self):
        CALLS.append(("GET", self.path))
        m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", self.path)
        if m:
            d = [x for x in deployed() if x[0] == m.group(1)]
            return self._send(200, {"verify_jwt": (not d[-1][1]) if d else M["gate"], "version": 10 + len(d)})
        self._send(404, {})
    def do_PATCH(self): CALLS.append(("PATCH", self.path)); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"null"); CALLS.append(("POST", self.path, b))
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
open(os.path.join(BIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, json, os, shutil
a = sys.argv[1:]; M = json.load(open({os.path.join(TMP, 'mode.json')!r}))
if os.environ.get('SUPABASE_ACCESS_TOKEN') != 'sbp_test': sys.exit(1)
if a[:2] == ['functions', 'deploy']:
    if M.get('fail_deploy') == a[2]: print('deploy failed: boom', file=sys.stderr); sys.exit(1)
    open({os.path.join(TMP, 'deploys')!r}, 'a').write(json.dumps([a[2], '--no-verify-jwt' in a]) + '\\n'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree({FNROOT!r}, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(BIN, "supabase"), 0o755)
def run(shas=SHAS, main=HEAD, seedargs=None, reseed=True, **mode):
    if reseed: seed(**(seedargs or {}))
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="897", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_MAIN_REF=main,
               SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas))
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "sop_rulings_897.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
writes = lambda: [x for x in CALLS if x[0] == "POST" and x[1].endswith("/database/query") and re.search(r"\b(update|insert|create or replace)\b", x[2]["query"], re.I)]

if not FDEF: raise SystemExit("needs ~/Claude/Projects/caring-companions-website/supabase/ops-foundation/002_staff_access_view.sql (the Team list function as written)")
seed(); before_lead = as_person(U[KRY])
c, out = run(seedargs=dict(role_map=[{"id": "map", "perms": {"owner_admin": ["manage_access"], "care_coordinator": ["manage_staff"]}}]))
ck("0 before: the Team list shows Krystal nobody", before_lead == 0, before_lead)
ck("1 good run: hub-access deployed with its gateway setting kept, DONE, no ✗", c == 0 and "RESULT: DONE" in out and "✗" not in out and deployed() == [["hub-access", False]], out)
ck("2 Field Quality and Payer Programs now Krystal's", dom("field_quality")[0] == KRY and dom("payer_programs")[0] == KRY, [dom("field_quality"), dom("payer_programs")])
ck("3 a backup with no working sign-in (Cierra, banned) is cleared; a good backup is kept", dom("recruiting_orientation")[1] is None and dom("money")[1] == ZAC and dom("client_care")[1] == SAM, [dom("recruiting_orientation"), dom("money")])
ck("4 escalation: Samantha for Money, Incidents, Program administration and for areas Krystal owns; Krystal for the rest",
   all(dom(x)[2] == SAM for x in ("money", "incidents", "program_administration", "client_care", "field_quality", "payer_programs", "scheduling_coverage", "training_compliance", "caregiver_performance"))
   and all(dom(x)[2] == KRY for x in ("family_enquiries", "recruiting_orientation")), {x: dom(x) for x in ("incidents", "family_enquiries", "recruiting_orientation", "client_care")})
ck("5 the report shows every area before, the changes, and the read-back", "work areas now:" in out and "Field Quality: owner Cierra Barber" in out and "owner Cierra Barber → Krystal Land" in out and "work areas read back:" in out, out)
ck("6 Krystal holds springfield_lead; the role is in the list; the grant is in the role audit", q1("select count(*) from public.staff_roles where person_id = cast(:p as uuid) and role = 'springfield_lead'", p=KRY)[0][0] == 1
   and q1("select label from public.staff_role_types where role = 'springfield_lead'")[0][0] == "Springfield lead"
   and q1("select count(*) from public.staff_role_audit where role = 'springfield_lead' and action = 'grant' and subject_email = 'krystal@mo-care.com'")[0][0] == 1)
ck("7 acting as Krystal the Team list now shows everyone; as a plain Care Coordinator it shows nobody; an owner still sees everyone",
   as_person(U[KRY]) == 6 and as_person(U[CC2]) == 0 and as_person(U[SAM]) == 6, [as_person(U[KRY]), as_person(U[CC2])])
ck("8 the report proves both sides by acting as them", "acting as Krystal Land (undone after): the Team list shows 6 people" in out and "acting as Casey Office" in out and "shows nobody" in out, out)
rp = next(r for r in app("role_permissions") if r["id"] == "map")
ck("9 the Hub's saved role permissions give the Springfield lead Hub access and keep the rest", rp["perms"]["springfield_lead"] == ["manage_access"] and rp["perms"]["owner_admin"] == ["manage_access"] and rp["perms"]["care_coordinator"] == ["manage_staff"], rp)
st = app("ops_settings"); pv = st.get("sop_rulings_897_previous") or {}
ck("10 the old values are kept for an exact undo; other settings untouched", st["other_setting"] == 7 and {d["code"] for d in pv.get("domains", [])} >= {"field_quality", "payer_programs", "recruiting_orientation"}
   and next(d for d in pv["domains"] if d["code"] == "field_quality")["owner"] == CIE and "r.role = 'owner_admin'" in (pv.get("staff_access_overview_def") or "") and pv["role_type_added"] is True, pv)
ck("11 nothing is texted, emailed or called (no calls but the database, the function setup and the browser check)", all(x[1].endswith("/database/query") or "/functions/" in x[1] for x in CALLS), [x[:2] for x in CALLS])

c2, out2 = run(reseed=False)
ck("12 running it again changes nothing and keeps the first old values", c2 == 0 and "work areas that change: 0" in out2 and "already allows the Springfield lead" in out2 and "already holds it" in out2
   and app("ops_settings")["sop_rulings_897_previous"]["domains"] == pv["domains"]
   and q1("select count(*) from public.staff_role_audit where role = 'springfield_lead'")[0][0] == 1, out2)

c, out = run(shas={"hub-access/index.ts": "0" * 64})
ck("13 a build that isn't the reviewed one stops before anything changes", c != 0 and "not the reviewed build" in out and not deployed() and not writes(), out)
c, out = run(main="origin/main")
ck("14 hub-access not yet merged to main: stops before anything changes", c != 0 and "isn't the same as GitHub's main" in out and not deployed() and not writes(), out)
c, out = run(seedargs=dict(fdef_variant=FDEF.replace("and r.role = 'owner_admin'", "and r.role = 'owner_admin' and true and r.role <> 'x'").replace("and r.role = 'owner_admin'", "and r.role = 'owner'")))
ck("15 a Team list function that isn't the one written for stops before anything changes", c != 0 and "not the one this step was written for" in out and not deployed() and not writes() and dom("field_quality")[0] == CIE, out)
c, out = run(seedargs=dict(kry_signin=False))
ck("16 Krystal with no working sign-in: stops before anything changes", c != 0 and "no working sign-in" in out and not deployed() and not writes(), out)
c, out = run(fail_deploy="hub-access")
ck("17 the deploy fails: stops, the database is not changed", c != 0 and "STOPPED at hub-access" in out and dom("field_quality")[0] == CIE
   and q1("select count(*) from public.staff_roles where role = 'springfield_lead'")[0][0] == 0, out)
# a database error part way through undoes the whole change
seed(); q1("create function public.boom() returns trigger language plpgsql as $$ begin raise exception 'refused'; end $$")
q1("create trigger t before insert on public.staff_role_audit for each row execute function public.boom()")
c, out = run(reseed=False)
ck("18 a database error part way: nothing in the database changed (one transaction), said out loud", c != 0 and "nothing in the database changed" in out and dom("field_quality")[0] == CIE
   and q1("select count(*) from public.staff_roles where role = 'springfield_lead'")[0][0] == 0 and q1("select count(*) from public.staff_role_types where role = 'springfield_lead'")[0][0] == 0
   and "sop_rulings_897_previous" not in app("ops_settings"), out)
c, out = run(seedargs=dict(role_map=None))
ck("19 no saved role permissions: says the Hub's built-in list covers it, writes none", c == 0 and "none saved" in out and app("role_permissions") is None, out)
src = open(os.path.join(HERE, "sop_rulings_897.py")).read()
ck("20 no em dash in what the step says", not re.search(r"—", "\n".join(l for l in src.split("\n") if "say(" in l or "bad(" in l or "stop(" in l)))

for n, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n + ("\n      " + note if note else ""))
print(f"{sum(1 for r in res if r[1])}/{len(res)} passed"); raise SystemExit(0 if all(r[1] for r in res) else 1)
