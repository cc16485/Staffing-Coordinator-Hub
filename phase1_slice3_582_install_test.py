#!/usr/bin/env python3
# Rehearsal of 582 (phase1_slice3_582.py) against a FAKE Supabase (management API, functions, the Hub page) and a FAKE
# supabase CLI. Never touches a real project.   python3 phase1_slice3_582_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, stat
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
ACTIONS = ["client_fact.record", "client_fact.record_person", "client_fact.care_began", "call_place.place"]
OFFICE = ["owner_admin", "care_coordinator", "staffing_coordinator"]
S = {}; M = {}
def reset(**m):
    S.clear(); S.update(sql=[], deployed=[], posts=[]); M.clear()
    M.update(dict(page=True, prereq=True, live=True, install="ok", guard=True, grants="ok", seed="ok", fn_open=False, installed=False), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj, ctype="application/json"):
        b = obj.encode() if isinstance(obj, str) else json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.startswith("/hub/"): return self._send(200, "<script>/* CC_DOOR_582 */</script>" if M["page"] else "<html>old</html>", "text/html")
        if m := re.match(r"/v1/projects/\w+/functions/([\w-]+)$", self.path):
            return self._send(200, {"slug": m.group(1), "version": 7 + len([d for d in S["deployed"] if d == m.group(1)]), "verify_jwt": True}) if M["live"] else self._send(404, {})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if m := re.match(r"/functions/v1/([\w-]+)$", p):
            S["posts"].append(m.group(1)); return self._send(200 if M["fn_open"] else 401, {"error": "Sign in first."})
        if not re.match(r"/v1/projects/\w+/database/query", p): return self._send(404, {})
        q = body["query"]; S["sql"].append(q)
        if q.lstrip().startswith("-- ====") and "582 · PHASE 1 SLICE 3" in q:
            if M["install"] == "fail": return self._send(400, {"message": "ERROR: 582 self-check: x"})
            M["installed"] = True; return self._send(201, [])
        if "to_regprocedure('public.desk_is_owner()')" in q: return self._send(200, [{"owner_fn": M["prereq"], "office_fn": True, "lock_": True, "already": M["installed"]}])
        if "from public.action_authority where action in" in q:
            rows = [{"action": a, "actor_kind": k, "level": "allowed" if k == "person" else "never", "roles": OFFICE if k == "person" else []} for a in ACTIONS for k in ("employee", "job", "person")]
            if M["seed"] == "employee": rows[0]["level"] = "autonomous"
            return self._send(200, rows)
        if re.match(r"\s*(update|insert into|delete from) public\.action_authority", q):
            return self._send(400, {"message": "ERROR: action_authority can only be changed by an owner through authority_set (582)"}) if M["guard"] else self._send(201, [])
        if "role_table_grants" in q:
            g = [{"table_name": t, "grantee": w, "p": "SELECT"} for t in ("action_authority", "action_authority_log", "action_registry") for w in ("authenticated", "service_role")]
            if M["grants"] == "wide": g[0]["p"] = "INSERT,SELECT"
            return self._send(200, g)
        if "public.authority_set(" in q: return self._send(200, [{"r": {"outcome": "refused", "reason": "sign in first"}}])
        if "from public.op_events where action in" in q: return self._send(200, [{"n": 0}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t582-")
FAKEBIN = os.path.join(tmp, "bin"); os.makedirs(FAKEBIN)
open(os.path.join(FAKEBIN, "node"), "w").write("#!/bin/sh\necho 'all passed'\n")
# the fake CLI: 'deploy' records the function; 'download' copies the reviewed files, so the fingerprints match (or, with MISMATCH set, alters one)
LOG = os.path.join(tmp, "cli.log")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']: sys.exit(0)
if a[:2] == ['functions', 'download']:
    src = os.path.join({HERE!r}, 'supabase', 'functions')
    shutil.copytree(src, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True)
    if os.environ.get('MISMATCH') == a[2]:
        open(os.path.join(os.getcwd(), 'supabase', 'functions', a[2], 'index.ts'), 'a').write('// changed')
    sys.exit(0)
sys.exit(1)
""")
for f in ("node", "supabase"): os.chmod(os.path.join(FAKEBIN, f), 0o755)
FN = ["_shared/contract.ts", "_shared/registry.js", "_shared/verbs.js", "_shared/staff-auth.ts", "client-fact/index.ts", "call-place/index.ts"]
FNSHAS = {f: sha(os.path.join(HERE, "supabase/functions", f)) for f in FN}
SQLSHAS = {f: sha(os.path.join(HERE, f)) for f in ("action_authority_582.sql", "action_authority_582_rollback.sql")}
def run(env_over=None, **mode):
    reset(**mode); rep = os.path.join(tmp, "r.txt")
    if os.path.exists(LOG): os.remove(LOG)
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_HUB_URL=URL + "/hub/",
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_FNROOT=os.path.join(HERE, "supabase/functions"), SB_SETTLE="0",
               SB_FN_SHAS=json.dumps(FNSHAS), SB_SQL_SHAS=json.dumps(SQLSHAS), PYTHONPATH=HERE)
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(HERE, "phase1_slice3_582.py")], env=env, capture_output=True, text=True, timeout=120)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
installed = lambda: any(q.lstrip().startswith("-- ====") and "582 · PHASE 1 SLICE 3" in q for q in S["sql"])
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""

c, out = run()
ck("happy path: exit 0, RESULT: DONE", c == 0 and "RESULT: DONE" in out, out)
ck("it checks every reviewed file and the two SQL files", all(f"{f} is the reviewed build" in out for f in FN) and "action_authority_582.sql is the reviewed version" in out, out)
ck("it writes down each function's live version for a rollback, and the rollback line names them", "client-fact is live at version 7" in out and "For a rollback: version 7" in out and "client-fact version 7, call-place version 7" in out, out)
ck("order: the SQL, then client-fact, then call-place deployed (gateway check kept on)", installed() and cli().count("functions deploy client-fact") == 1 and cli().count("functions deploy call-place") == 1
   and cli().index("deploy client-fact") < cli().index("deploy call-place") and "--no-verify-jwt" not in cli(), cli())
ck("the proofs: seed as approved, four direct changes refused, read-only grants, owner function refuses no sign-in, both functions refuse no sign-in",
   "the seed is as approved" in out and out.count("even the project owner cannot") == 4 and "may only read the three tables" in out and "refuses a caller with no signed-in owner" in out
   and "client-fact refuses a caller with no sign-in" in out and "call-place refuses a caller with no sign-in" in out, out)
ck("no token is printed", "sbp_test" not in out, out)

c, out = run(page=False)
ck("the Hub page not yet sending request ids: STOP before anything changes", c == 3 and "Claude merges the CC Hub pull request first" in out and not installed() and "deploy" not in cli(), out)
c, out = run(prereq=False)
ck("the owner test missing: STOP before anything changes", c == 3 and not installed(), out)
c, out = run(live=False)
ck("a function not live: STOP before anything changes", c == 3 and "is not live" in out and not installed(), out)
c, out = run(env_over={"SB_FN_SHAS": json.dumps(dict(FNSHAS, **{"_shared/contract.ts": "0" * 64}))})
ck("a file that is not the reviewed build: STOP, no query at all", c == 2 and "contract.ts is not the reviewed build" in out and not S["sql"], out)
c, out = run(env_over={"SB_SQL_SHAS": json.dumps(dict(SQLSHAS, **{"action_authority_582.sql": "0" * 64}))})
ck("an SQL file that is not the reviewed version: STOP, no query at all", c == 2 and "action_authority_582.sql is not the reviewed version" in out and not S["sql"], out)
c, out = run(install="fail")
ck("the SQL refused by its self-check: STOP, no function deployed", c == 5 and "could not be installed" in out and "deploy" not in cli(), out)
c, out = run(env_over={"MISMATCH": "call-place"})
ck("a deploy whose live copy is not the reviewed build: STOP at that function, with the rollback hint", c == 6 and "call-place did not deploy cleanly" in out and "build before Slice 3" in out, out)
c, out = run(guard=False)
ck("a direct change that gets through: reported, not passed", c == 9 and "could change a row directly" in out, out)
c, out = run(grants="wide")
ck("pages able to write the authority table: reported", c == 9 and "grants are not as designed" in out, out)
c, out = run(seed="employee")
ck("an AI employee with authority after the seed: reported", c == 9 and "the seed is not as approved" in out, out)
c, out = run(fn_open=True)
ck("a function that answers without a sign-in: reported", c == 9 and "answered 200 without a sign-in" in out, out)
c, out = run(installed=True)
ck("already installed: says so, runs safely again", c == 0 and "582 ran before" in out, out)

shutil.rmtree(tmp, ignore_errors=True)
failed = [r for r in res if not r[1]]
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
print(f"\n{len(res) - len(failed)}/{len(res)} passed" + (" · FAIL" if failed else ""))
raise SystemExit(1 if failed else 0)
