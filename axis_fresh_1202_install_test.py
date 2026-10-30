#!/usr/bin/env python3
# Rehearsal of 1202 (axis_fresh_1202.py: the AxisCare reader and read cards, both switches off) against a FAKE Supabase and a FAKE
# supabase CLI, from a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.
#   python3 axis_fresh_1202_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_SHA = subprocess.run(["git", "-C", HERE, "rev-parse", "3e42f48"], capture_output=True, text=True).stdout.strip()   # main on 2026-10-30, before A and B
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; M = {}
FNS = ["client-journey", "late-watch", "timekeeper-watch", "coverage-watch", "coverage-run"]
def reset(**m):
    S.clear(); S.update(sql=[], posts=[], wrote_settings=False); M.clear()
    M.update(dict(settings={"loops_close_live": True, "team_work_live": True}, selftest_a=True, selftest_b=True, reads=True, gate=401, dry=200, installed=False), **m)
TMP = tempfile.mkdtemp(prefix="t1202-")
flag = lambda n: os.path.exists(os.path.join(TMP, n))
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p)
        if m:
            fn = m.group(1)
            if fn == "axis-health" and not (flag("dep_axis-health") or flag("already")): return self._send(404, {})
            return self._send(200, {"version": 30, "verify_jwt": fn not in ("axis-health", "client-journey")})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"):
            S["posts"].append((p, self.headers.get("Authorization")))
            if "auth_check" in p: return self._send(M["gate"], {"error": "not allowed"})
            if self.headers.get("Authorization") != "Bearer eyJsvcKEY": return self._send(401, {})
            return self._send(M["dry"], {"ok": True, "mode": "practice", "note": "practice: 0 card(s) would open or update, 0 would close; scheduling current"} if M["dry"] == 200 else {"error": "boom"})
        q = body["query"]; S["sql"].append(q)
        if q.startswith("select data from public.app_data where key = 'ops_settings'"): return self._send(200, [{"data": M["settings"]}])
        if "update public.app_data" in q and "AXISTEST" not in q: S["wrote_settings"] = True
        if q.startswith("select to_regclass('public.axis_read_log')"): return self._send(200, [{"a": M["installed"], "b": M["installed"]}])
        if "has_wait" in q: return self._send(200, [{"jobname": j, "has_wait": flag("sql_b")} for j in ("coverage-run", "coverage-watch", "launch-evidence", "timekeeper-watch")])
        if "AXISTEST_A" in q:
            r = {"ok": True, "failed": [], "checks": 14} if M["selftest_a"] else {"ok": False, "failed": ["second reader does not"], "checks": 14}
            return self._send(400, {"message": "Failed to run sql query: ERROR:  P0001: AXISTEST_A " + json.dumps(r) + "\nCONTEXT:  PL/pgSQL function inline_code_block line 40 at RAISE\n"})
        if "AXISTEST_B" in q:
            r = {"ok": True, "failed": [], "checks": 10} if M["selftest_b"] else {"ok": False, "failed": ["axis-health is scheduled every 5 minutes"], "checks": 10}
            return self._send(400, {"message": "Failed to run sql query: ERROR:  P0001: AXISTEST_B " + json.dumps(r) + "\nCONTEXT:  ..."})
        if "create table if not exists public.axis_read_log" in q: open(os.path.join(TMP, "sql_a"), "w").write("x"); return self._send(200, [])
        if "create or replace function public.axis_connection" in q: open(os.path.join(TMP, "sql_b"), "w").write("x"); return self._send(200, [])
        if "information_schema.tables" in q: return self._send(200, [{"t": 3, "open_grants": 0}])
        if "from public.axis_read_log where at >=" in q:
            return self._send(200, [{"job": "coverage-watch", "n": 4, "r429": 1, "live": False}, {"job": "timekeeper-watch", "n": 3, "r429": 0, "live": False}] if M["reads"] else [])
        if q.startswith("select public.axis_connection(60)"): return self._send(200, [{"c": {"scheduling_current": True, "reader_on": False}}])
        if "count(*) filter (where jobname in" in q: return self._send(200, [{"waits": 4 if flag("sql_b") else 0, "health": 1 if flag("sql_b") else 0, "trim": 1 if flag("sql_a") else 0}])
        return self._send(400, {"message": "unexpected query " + q[:160]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
WT = os.path.join(TMP, "wt"); BASEWT = os.path.join(TMP, "base")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", BASEWT, BASE_SHA], check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
T = {TMP!r}
if a[:2] == ['functions', 'deploy']: open(os.path.join(T, 'dep_' + a[2]), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    fn = a[2]
    src = {WT!r} if (os.path.exists(os.path.join(T, 'dep_' + fn)) or os.path.exists(os.path.join(T, 'already'))) else {BASEWT!r}
    shutil.copytree(os.path.join(src, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True)
    if os.path.exists(os.path.join(T, 'drift')) and fn == 'coverage-run': open(os.path.join(os.getcwd(), 'supabase', 'functions', 'coverage-run', 'index.ts'), 'a').write('// someone else')
    if os.path.exists(os.path.join(T, 'oldprn')) and src == {BASEWT!r}: open(os.path.join(os.getcwd(), 'supabase', 'functions', '_shared', 'prn-page.ts'), 'a').write('// the copy live before PRN step 7')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = {k: sha(os.path.join(WT, f"supabase/functions/{k}/index.ts")) for k in FNS + ["axis-health"]}
PIN["_shared/axis-reader"] = sha(os.path.join(WT, "supabase/functions/_shared/axis-reader.ts"))
SQLP = {f: sha(os.path.join(WT, f)) for f in ["axis_reader_A.sql", "axis_reader_A_selftest.sql", "axis_health_B.sql", "axis_health_B_selftest.sql", "axis_reader_A_rollback.sql", "axis_health_B_rollback.sql"]}
def run(env_over=None, already=False, drift=False, oldprn=False, tests=False, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    for f in [LOG, rep] + [os.path.join(TMP, x) for x in os.listdir(TMP) if x.startswith(("dep_", "sql_"))]: os.path.exists(f) and os.remove(f)
    for fl, on in (("already", already), ("drift", drift), ("oldprn", oldprn)):
        fp = os.path.join(TMP, fl); (open(fp, "w").write("x") if on else (os.path.exists(fp) and os.remove(fp)))
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_REPO=WT, SB_BASE=BASE_SHA, SB_SHAS=json.dumps(PIN), SB_SQL_SHAS=json.dumps(SQLP),
               SB_SETTLE="0", SB_POLL="0.05", SB_POLL_MAX="0.3", SB_NODE="" if tests else "none")
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "axis_fresh_1202.py")], env=env, capture_output=True, text=True, timeout=1200)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
ran = lambda kind: [q for q in S["sql"] if kind in q]
try:
    c, out = run(tests=True)
    ck("clean run from a fresh copy (tests included): exit 0, RESULT: DONE, both switches OFF", c == 0 and "RESULT: DONE" in out and "both AxisCare switches OFF" in out, out[-2000:])
    ck("Part 1 runs the reader, health, SQL and coverage tests", all(re.search(re.escape(t) + r": ", out) for t in ("axis_reader_test.mjs", "axis_health_test.mjs", "axis_sql_test.mjs", "quiet_cards_test.mjs", "loops_phase2_test.mjs", "open_shift_cards_test.mjs", "late_watch_test.mjs")), out[:2500])
    ck("Part 1: each job is the build this builds on; axis-health is new; switches read", "coverage-run: live is the build this builds on" in out and "axis-health: new" in out
       and "Shared AxisCare reader: OFF" in out and "Tell me when AxisCare can't be read: OFF" in out, out[:3000])
    ck("database A, its self-test, database B, its self-test, in that order", [i for i, q in enumerate(S["sql"]) if "create table if not exists public.axis_read_log" in q or "AXISTEST_A" in q or "create or replace function public.axis_connection" in q or "AXISTEST_B" in q]
       == sorted(i for i, q in enumerate(S["sql"]) if "create table if not exists public.axis_read_log" in q or "AXISTEST_A" in q or "create or replace function public.axis_connection" in q or "AXISTEST_B" in q)
       and "14 checks passed" in out and "10 checks passed" in out, out)
    ck("deploys axis-health first, then the five jobs, Cara's last", deploys() == ["axis-health"] + FNS, deploys())
    ck("gateway settings kept: axis-health and client-journey off, the rest on", cli().count("--no-verify-jwt") == 2
       and re.search(r"deploy axis-health .*--no-verify-jwt", cli()) and re.search(r"deploy client-journey .*--no-verify-jwt", cli()) and not re.search(r"deploy coverage-run .*--no-verify-jwt", cli()), cli())
    ck("no setting written, ever (the switches stay off)", not S["wrote_settings"] and not any("ops_settings" in q and ("update" in q.lower() or "insert" in q.lower()) for q in S["sql"] if "AXISTEST" not in q and "axis_reader_A.sql" not in q and "create table" not in q))
    ck("proof: live copies match, public key refused, practice look, reads counted, summary answers, waits in, switches as before",
       "axis-health refuses the public key (401)" in out and "axis-health practice look: answered" in out and "AxisCare reads are being counted: coverage-watch 4 (1 turned away), timekeeper-watch 3" in out
       and "every read went exactly as before" in out and "scheduling information is current" in out and "the scheduler waits 150 s" in out and "every switch is exactly as it was" in out, out[-2500:])
    ck("no key, token or email in the report; no em dash", not re.search(r"eyJ\w|sbp_\w|@mo-care", out) and "—" not in out, out)
    c, out = run(already=True, installed=True)
    ck("run again: nothing deployed again, database put in again safely, still DONE", c == 0 and not deploys() and "already installed" in out and "already this build" in out and "RESULT: DONE" in out, out[-1500:])
    c, out = run(selftest_a=False)
    ck("database A self-test fails: STOPS before any job is deployed, says what failed", c == 4 and not deploys() and "second reader does not" in out and "STOP before any job was deployed" in out and not ran("create or replace function public.axis_connection"), out[-800:])
    c, out = run(selftest_b=False)
    ck("database B self-test fails: STOPS before any job is deployed", c == 4 and not deploys() and "axis-health is scheduled" in out, out[-800:])
    c, out = run(drift=True)
    ck("coverage-run live with a change not from GitHub: STOPS before any change", c == 3 and not deploys() and not ran("create table if not exists public.axis_read_log"), out[-600:])
    c, out = run(env_over={"SB_SHAS": json.dumps(dict(PIN, **{"coverage-run": "0" * 64}))})
    ck("not the reviewed build: nothing runs", c == 2 and not deploys() and not S["sql"], out[-400:])
    c, out = run(env_over={"SB_SQL_SHAS": json.dumps(dict(SQLP, **{"axis_health_B.sql": "0" * 64}))})
    ck("a database file not the reviewed one: nothing runs", c == 2 and not S["sql"], out[-400:])
    c, out = run(gate=200)
    ck("axis-health answering the public key is caught", c == 8 and "CHECK THE" in out, out[-600:])
    c, out = run(dry=500)
    ck("a practice look that fails is caught", c == 8 and "✗ axis-health practice look" in out, out[-600:])
    c, out = run(reads=False)
    ck("no AxisCare reads counted after the deploy is caught", c == 8 and "✗ AxisCare reads are being counted: none yet" in out, out[-600:])
    OLDPRN = hashlib.sha256(open(os.path.join(BASEWT, "supabase/functions/_shared/prn-page.ts"), "rb").read() + b"// the copy live before PRN step 7").hexdigest()
    c, out = run(oldprn=True, env_over={"SB_PRIOR": json.dumps({"supabase/functions/_shared/prn-page.ts": OLDPRN})})
    ck("an earlier copy of a shared file is live (named in the pins): goes ahead and says it brings it up to main", c == 0 and deploys() == ["axis-health"] + FNS
       and "also pick up the newer copy on GitHub's main of: _shared/prn-page.ts" in out, out[-1500:])
    c, out = run(oldprn=True, env_over={"SB_PRIOR": json.dumps({"supabase/functions/_shared/prn-page.ts": ["1" * 64, OLDPRN]})})
    ck("several known earlier copies of one shared file (one per job): any of them is accepted", c == 0 and "_shared/prn-page.ts" in out and "RESULT: DONE" in out, out[-900:])
    c, out = run(oldprn=True)
    ck("an unknown copy of a shared file is live: STOPS before any change", c == 3 and not deploys(), out[-600:])
    c, out = run(env_over={"SB_TOKEN": "nope"})
    ck("no access token: nothing runs", c == 2 and not S["sql"], out[-300:])
finally:
    for w in (WT, BASEWT): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w])
    shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
