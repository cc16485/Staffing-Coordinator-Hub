#!/usr/bin/env python3
# Rehearsal of 748 (interview_history_748.py) against a FAKE Supabase (management API, functions) and a FAKE supabase CLI,
# from a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.
#   python3 interview_history_748_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_SHA = "2e485ee"   # origin/main before 748
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
def body_of(path, name):
    m = re.search(r"create\s+or\s+replace\s+function\s+(?:public\.)?" + name + r"\s*\([^)]*\)[\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\1", open(path).read(), re.I)
    return m.group(2)
S = {}; M = {}
def reset(**m):
    S.clear(); S.update(sql=[], posts=[]); M.clear(); M.update(dict(rules="old", gate=401, col=0, dup=False), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if p.endswith("/secrets"): return self._send(200, [])
        if re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p): return self._send(200, {"version": 9, "verify_jwt": True})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"):
            S["posts"].append((p, body)); return self._send(M["gate"], {"error": "Sign in first."})
        q = body["query"]; S["sql"].append(q)
        if "from pg_proc" in q:
            f = os.path.join(WT, "interview_history_748.sql" if M["rules"] == "new" else "interview_history_748_rollback.sql")
            rows = [{"n": x, "src": body_of(f, x) + ("-- someone else" if M["rules"] == "drift" and x == "interview_cancel" else "")} for x in ("interview_cancel", "interview_reschedule")]
            if M["dup"]: rows.append(dict(rows[0]))
            return self._send(200, rows)
        if q.startswith("-- interview_history_748.sql"):
            if M.get("sqlfail"): return self._send(400, {"message": "boom"})
            M["rules"] = "new"; M["col"] = 1; return self._send(201, [])
        if "count(*) filter" in q: return self._send(200, [{"asked": 7, "office": 2, "office_moves": 3, "noshow": 4}])
        if "information_schema.columns" in q: return self._send(200, [{"n": M["col"]}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t748-")
WT = os.path.join(TMP, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
BASE = os.path.join(TMP, "base"); os.makedirs(BASE)
subprocess.run(f"git -C {HERE} archive {BASE_SHA} supabase/functions | tar -x -C {BASE}", shell=True, check=True)
ALT_SHA = "218744b"   # the 712 build: the applicant-text that was live on 2026-10-15
ALT = os.path.join(TMP, "alt"); os.makedirs(ALT)
subprocess.run(f"git -C {HERE} archive {ALT_SHA} supabase/functions | tar -x -C {ALT}", shell=True, check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log"); os.makedirs(os.path.join(TMP, "deployed"))
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']: open(os.path.join({TMP!r}, 'deployed', a[2]), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    src = os.path.join({WT!r}, 'supabase', 'functions') if os.path.exists(os.path.join({TMP!r}, 'deployed', a[2])) or os.path.exists(os.path.join({TMP!r}, 'already')) else os.path.join({ALT!r} if os.path.exists(os.path.join({TMP!r}, 'stale')) else {BASE!r}, 'supabase', 'functions')
    shutil.copytree(src, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True)
    if os.path.exists(os.path.join({TMP!r}, 'drift')) and not os.path.exists(os.path.join({TMP!r}, 'deployed', a[2])):
        open(os.path.join(os.getcwd(), 'supabase', 'functions', a[2], 'index.ts'), 'a').write('// someone else')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = {"applicant-text": sha(os.path.join(WT, "supabase/functions/applicant-text/index.ts"))}
def run(env_over=None, drift=False, already=False, stale=False, yes="yes", **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    os.path.exists(LOG) and os.remove(LOG); os.path.exists(rep) and os.remove(rep)
    shutil.rmtree(os.path.join(TMP, "deployed")); os.makedirs(os.path.join(TMP, "deployed"))
    for flag, on in (("drift", drift), ("already", already), ("stale", stale)):
        fp = os.path.join(TMP, flag); (open(fp, "w").write("x") if on else (os.path.exists(fp) and os.remove(fp)))
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_REPO=WT, SB_BASE=BASE_SHA, SB_SHAS=json.dumps(PIN), SB_SETTLE="0", SB_YES=yes, SB_ALT_BASE=ALT_SHA,
               SB_SQL_SHA=sha(os.path.join(WT, "interview_history_748.sql")), SB_RB_SHA=sha(os.path.join(WT, "interview_history_748_rollback.sql")))
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "interview_history_748.py")], env=env, capture_output=True, text=True, timeout=600, stdin=subprocess.DEVNULL, start_new_session=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
wrote = lambda: [q for q in S["sql"] if q.startswith("-- interview_history_748.sql")]
try:
    c, out = run()
    ck("clean run from a fresh copy: exit 0, RESULT: DONE", c == 0 and "RESULT: DONE" in out, out[-1800:])
    ck("the applicant-text tests run in Part 1 (from the fresh copy)", re.search(r"applicant_text_test\.mjs: \d+/\d+ passed", out), out[:1500])
    ck("rules saved once, then applicant-text deployed (in that order), keeping its gateway setting", len(wrote()) == 1 and deploys() == ["applicant-text"] and "--no-verify-jwt" not in cli(), [cli(), S["sql"]])
    ck("says what is already on record (counts only)", "7 cancel(s) and move(s) by applicants" in out and "4 no-show(s)" in out, out[:1500])
    ck("proof: new rules, the column, the live server, refuses the public key", all(s in out for s in ("the live cancel and move rules are the new ones", "keep who in the office", "applicant-text: the live copy is exactly", "refuses the public key (401)")), out[-1200:])
    ck("no key or token in the report", not re.search(r"eyJ\w|sbp_\w", out), out)
    c, out = run(stale=True)
    ck("the 2026-10-15 case: live applicant-text is the 712 build: counts as the build before, saves the rules, deploys", c == 0 and len(wrote()) == 1 and deploys() == ["applicant-text"] and "build from 712" in out, out[-1200:])
    c, out = run(stale=True, env_over={"SB_ALT_BASE": ""})
    ck("...without that one known older build named, it still stops before any change", c == 3 and not wrote() and not deploys(), out[-400:])
    c, out = run(stale=True, drift=True)
    ck("...and any other change on the live copy still stops", c == 3 and not wrote() and not deploys(), out[-400:])
    c, out = run(yes="no")
    ck("no yes: nothing changed", c == 0 and not wrote() and not deploys() and "didn't type yes" in out, out[-500:])
    c, out = run(rules="new", already=True, col=1)
    ck("run again after it is live: nothing saved or deployed again, still DONE", c == 0 and not wrote() and not deploys() and "already this build" in out and "RESULT: DONE" in out, out[-900:])
    c, out = run(rules="drift")
    ck("live cancel rule changed by someone else: STOPS before any change", c == 3 and not wrote() and not deploys(), out[-600:])
    c, out = run(dup=True)
    ck("two cancel rules live: STOPS", c == 3 and not wrote() and not deploys(), out[-600:])
    c, out = run(drift=True)
    ck("applicant-text live with a change not from GitHub: STOPS before any change", c == 3 and not wrote() and not deploys(), out[-600:])
    c, out = run(sqlfail=True)
    ck("the rules fail to save: nothing deployed", c == 5 and not deploys(), out[-500:])
    c, out = run(env_over={"SB_SQL_SHA": "0" * 64})
    ck("not the reviewed rules file: nothing runs", c == 2 and not S["sql"] and not deploys(), out[-400:])
    c, out = run(env_over={"SB_SHAS": json.dumps({"applicant-text": "0" * 64})})
    ck("not the reviewed server: nothing runs", c == 2 and not deploys(), out[-400:])
    c, out = run(gate=200)
    ck("applicant-text answering the public key is caught", c == 8 and "PARTLY DONE" in out, out[-600:])
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
