#!/usr/bin/env python3
# Rehearsal of 898 (retire_areas_898.py, work area owners and the Springfield lead): a FAKE management API whose database
# queries run in a throwaway LOCAL Postgres (pgserver) set up like the live tables, a FAKE supabase CLI and fake function
# doors. Never touches GitHub, Supabase, GoHighLevel or AxisCare. Runs from a fresh copy of this folder's committed build.
#   python3 retire_areas_898_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, glob, datetime
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t898-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN)
COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
HEAD = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
SHAS = {"call-tasks/index.ts": sha(os.path.join(FNROOT, "call-tasks/index.ts")), "_shared/call-tasks.ts": sha(os.path.join(FNROOT, "_shared/call-tasks.ts"))}

D = os.path.join(TMP, "pg"); os.makedirs(D)
srvpg = pgserver.get_server(D)
host = [kv[5:] for kv in srvpg.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
SAM, KRY, ZAC, CIE, ANG, CC2 = ("00000000-0000-0000-0000-00000000000" + str(i) for i in range(1, 7))
U = {SAM: "a0000000-0000-0000-0000-000000000001", KRY: "a0000000-0000-0000-0000-000000000002", ZAC: "a0000000-0000-0000-0000-000000000003",
     CIE: "a0000000-0000-0000-0000-000000000004", CC2: "a0000000-0000-0000-0000-000000000006"}
NEWSHA = "b" * 64; OLDSHA = "a" * 64
def seed(issues=True, zach_owner=True, already=False):
    c = conn()
    c.run("drop schema if exists public cascade; create schema public")
    c.run("create table public.app_data(key text primary key, data jsonb, updated_at timestamptz default now())")
    c.run("insert into public.app_data values ('ops_settings', cast(:d as jsonb))", d=json.dumps({"other_setting": 7}))
    c.run("create table public.persons(person_id uuid primary key, full_name text, primary_email text, active boolean default true)")
    c.run("create table public.staff_roles(person_id uuid, entity text, role text)")
    c.run("create table public.domains(entity text, code text, label text, owner_person uuid, backup_person uuid, escalation_person uuid, active boolean default true, sort_order int, primary key (entity, code))")
    for pid, n, e in ((SAM, "Samantha Troutman", "samantha@mo-care.com"), (KRY, "Krystal Land", "krystal@mo-care.com"), (ZAC, "Zach Troutman", "zach@mo-care.com")):
        c.run("insert into public.persons values (cast(:p as uuid), :n, :e, true)", p=pid, n=n, e=e)
    c.run("insert into public.staff_roles values (cast(:p as uuid), 'cc_ihs', 'owner_admin')", p=SAM)
    if zach_owner: c.run("insert into public.staff_roles values (cast(:p as uuid), 'cc_ihs', 'owner_admin')", p=ZAC)
    for code, lab, o, e, a in (("payer_programs", "Payer Programs", KRY, SAM, not already), ("field_quality", "Field Quality", KRY, SAM, not already), ("incidents", "Incidents", SAM, ZAC if already else SAM, True), ("client_care", "Client care", KRY, SAM, True)):
        c.run("insert into public.domains values ('cc_ihs', :c, :l, cast(:o as uuid), null, cast(:e as uuid), :a, 1)", c=code, l=lab, o=o, e=e, a=a)
    if issues:
        c.run("create table public.issue_category(code text primary key, label text, default_domain text)")
        for code, lab, d in (("caregiver_late_noshow", "Caregiver late or no-show", "field_quality"), ("family_complaint", "Family complaint about a caregiver", "field_quality"),
                             ("caregiver_concern_about_client", "Caregiver concern about client or family", "field_quality"), ("auth_issue", "Authorization problem", "payer_programs"), ("fall", "A fall", "incidents")):
            c.run("insert into public.issue_category values (:c, :l, :d)", c=code, l=lab, d=d)
    c.run("create table public.rules_approved(file text, sha256 text, note text, approved_at timestamptz default now(), primary key (file, sha256))")
    c.run("insert into public.rules_approved(file, sha256, approved_at) values ('client-start.js', :s, now() - interval '2 days'), ('client-start.js', :t, now() - interval '9 days'), ('obligations.js', :s, now())", s=OLDSHA, t="c" * 64)
    c.close()
def q1(sql_, **kw):
    c = conn(); r = c.run(sql_, **kw); c.close(); return r
def app(k):
    r = q1("select data from public.app_data where key = :k", k=k); return r[0][0] if r else None
act = lambda c: q1("select active from public.domains where code = :c", c=c)[0][0]
esc = lambda c: str(q1("select escalation_person from public.domains where code = :c", c=c)[0][0])
iss = lambda c: q1("select default_domain from public.issue_category where code = :c", c=c)[0][0]
rules = lambda: [r[0] for r in q1("select sha256 from public.rules_approved where file = 'client-start.js' order by approved_at desc")]

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
def run(shas=SHAS, main=HEAD, seedargs=None, reseed=True, rules=None, **mode):
    rules = rules if rules is not None else {'client-start.js': NEWSHA}
    if reseed: seed(**(seedargs or {}))
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="898", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_MAIN_REF=main,
               SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas), SB_RULES_APPROVE=json.dumps(rules))
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "retire_areas_898.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
writes = lambda: [x for x in CALLS if x[0] == "POST" and x[1].endswith("/database/query") and re.search(r"\b(update|insert|create or replace)\b", x[2]["query"], re.I)]

c, out = run()
ck("1 good run: call-tasks deployed (gateway kept), DONE, no ✗", c == 0 and "RESULT: DONE" in out and "✗" not in out and deployed() == [["call-tasks", False]], out)
ck("2 Payer Programs and Field Quality are off; their owner stays Krystal; Client Care untouched", act("payer_programs") is False and act("field_quality") is False and act("client_care") is True
   and str(q1("select owner_person from public.domains where code = 'payer_programs'")[0][0]) == KRY)
ck("3 Incidents escalates to Zach again", esc("incidents") == ZAC)
ck("4 issue types: field work to Caregiver Performance, a caregiver's concern about a client to Client Care, payer to Client Care; others untouched",
   iss("caregiver_late_noshow") == "caregiver_performance" and iss("family_complaint") == "caregiver_performance" and iss("caregiver_concern_about_client") == "client_care"
   and iss("auth_issue") == "client_care" and iss("fall") == "incidents")
ck("5 the new client-start.js is approved and newest; the version running now stays approved; only two kept; other files untouched", rules() == [NEWSHA, OLDSHA]
   and q1("select count(*) from public.rules_approved where file = 'obligations.js'")[0][0] == 1, rules())
pv = app("ops_settings").get("sop_rulings_898_previous") or {}
ck("6 old values kept for undo; other settings untouched", app("ops_settings")["other_setting"] == 7 and pv.get("active") == {"payer_programs": True, "field_quality": True}
   and pv.get("incidents_escalation") == SAM and pv.get("issues", {}).get("auth_issue") == "payer_programs", pv)
ck("7 the report names each change and reads back", "Incidents escalates to Samantha Troutman; it will go to Zach Troutman" in out and "Caregiver late or no-show: field_quality → caregiver_performance" in out and "read back: Payer Programs and Field Quality are off" in out, out)
ck("8 nothing is sent (only the database, the function setup and the browser check)", all(x[1].endswith("/database/query") or "/functions/" in x[1] for x in CALLS))
c2, out2 = run(reseed=False)
ck("9 running it again is harmless and keeps the first old values", c2 == 0 and "issue types that move: 0" in out2 and "already off" in out2 and app("ops_settings")["sop_rulings_898_previous"] == pv, out2)
c, out = run(shas={"call-tasks/index.ts": "0" * 64})
ck("10 a build that isn't the reviewed one stops before anything changes", c != 0 and not deployed() and not writes() and act("payer_programs") is True, out)
c, out = run(main="origin/main")
ck("11 call-tasks not merged yet: stops before anything changes", c != 0 and "isn't the same as GitHub's main" in out and not deployed() and not writes(), out)
c, out = run(seedargs=dict(zach_owner=False))
ck("12 Zach not an owner: stops before anything changes", c != 0 and "not an active owner" in out and not deployed() and not writes(), out)
c, out = run(rules={})
ck("13 no Hub file to approve: stops before anything changes", c != 0 and "isn't set right" in out and not deployed(), out)
c, out = run(fail_deploy="call-tasks")
ck("14 the deploy fails: stops, the database is not changed", c != 0 and "STOPPED at call-tasks" in out and act("payer_programs") is True and rules()[0] == OLDSHA, out)
seed(); q1("create function public.boom() returns trigger language plpgsql as $$ begin raise exception 'refused'; end $$")
q1("create trigger t before insert on public.rules_approved for each row execute function public.boom()")
c, out = run(reseed=False)
ck("15 a database error part way: nothing in the database changed, said out loud", c != 0 and "nothing in the database changed" in out and act("payer_programs") is True and esc("incidents") == SAM
   and iss("caregiver_late_noshow") == "field_quality" and "sop_rulings_898_previous" not in app("ops_settings"), out)
c, out = run(seedargs=dict(issues=False))
ck("16 no issue type list: still does the rest", c == 0 and "isn't there" in out and act("field_quality") is False, out)
src = open(os.path.join(HERE, "retire_areas_898.py")).read()
ck("17 no em dash in what the step says", not re.search(r"\u2014", "\n".join(l for l in src.split("\n") if "say(" in l or "bad(" in l or "stop(" in l)))
for n, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n + ("\n      " + note if note else ""))
print(f"{sum(1 for r in res if r[1])}/{len(res)} passed"); raise SystemExit(0 if all(r[1] for r in res) else 1)
