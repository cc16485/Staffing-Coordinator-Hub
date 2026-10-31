#!/usr/bin/env python3
# Rehearsal of 1214 (oncall_caregivers_1214.py, on call for our Level 3 caregivers) against a FAKE Supabase and a FAKE supabase CLI,
# from a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.
#   python3 oncall_caregivers_1214_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_SHA = subprocess.run(["git", "-C", HERE, "rev-parse", "1b0cfe99032a462eae931edf5abaf17293a14967"], capture_output=True, text=True).stdout.strip()   # main after 1212 (#718, #719), as live
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; M = {}
def reset(**m):
    S.clear(); S.update(sql=[], deployed=set()); M.clear()
    M.update(dict(switch=None, readfail=None, sqlfail=False, gate=401, forged=401), **m)
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
            if fn == "oncall-page" and not os.path.exists(os.path.join(TMP, "deployed-oncall-page")): return self._send(404, {})
            return self._send(200, {"version": 7, "verify_jwt": fn != "oncall-page"})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/oncall-page"):
            if body.get("action") == "preview": return self._send(M["gate"], {"error": "no"})
            return self._send(M["forged"], {"expired": True})
        if p.startswith("/functions/v1/"): return self._send(M["gate"], {"error": "not allowed"})
        q = body["query"]; S["sql"].append(q)
        if q.startswith("select data->'prn_oncall_invite_live'"):
            if M["readfail"]: return self._send(*M["readfail"])
            return self._send(200, [{"v": M["switch"]}])
        if q.startswith("begin;"): return self._send(400, {"message": "boom"}) if M["sqlfail"] else self._send(201, [])
        if q.startswith("select (select count(*) from information_schema.columns"): return self._send(200, [{"c": 4, "k": 4, "t": 1, "a": False}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1214-"); WT = os.path.join(TMP, "wt"); BASEWT = os.path.join(TMP, "base")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", BASEWT, BASE_SHA], check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']: open(os.path.join({TMP!r}, 'deployed-' + a[2]), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    fn = a[2]
    src = {WT!r} if (os.path.exists(os.path.join({TMP!r}, 'deployed-' + fn)) or os.path.exists(os.path.join({TMP!r}, 'already'))) else {BASEWT!r}
    shutil.copytree(os.path.join(src, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True)
    if os.path.exists(os.path.join({TMP!r}, 'drift')) and fn == 'coverage-run' and not os.path.exists(os.path.join({TMP!r}, 'deployed-' + fn)):
        open(os.path.join(os.getcwd(), 'supabase', 'functions', 'coverage-run', 'index.ts'), 'a').write('// someone else')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = {k: sha(os.path.join(WT, "supabase/functions", k)) for k in ("_shared/prn-oncall.ts", "prn-week/index.ts", "oncall-page/index.ts", "coverage-run/index.ts", "_shared/oncall-links.ts")}
def run(env_over=None, already=False, drift=False, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    for f in [LOG, rep] + [os.path.join(TMP, x) for x in os.listdir(TMP) if x.startswith("deployed-")]: os.path.exists(f) and os.remove(f)
    for flag, on in (("already", already), ("drift", drift)):
        fp = os.path.join(TMP, flag); (open(fp, "w").write("x") if on else (os.path.exists(fp) and os.remove(fp)))
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_STEP="1214", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(PIN), SB_BASE=BASE_SHA, SB_SETTLE="0", SB_MAIN_REF="HEAD", SB_RETRY_SCALE="0")
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "oncall_caregivers_1214.py")], cwd=WT, env=env, capture_output=True, text=True, timeout=900)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
writes = lambda: [q for q in S["sql"] if q.startswith("begin;")]
try:
    c, out = run()
    ck("clean run from a fresh copy: exit 0, DONE, invites left OFF", c == 0 and "1214: DONE" in out and "invites OFF" in out, out[-1800:])
    ck("Part 1: the reviewed build, the eight tests ran, the switch read, gateway settings (oncall-page new and public), live = the build this builds on", "the reviewed build is what is on GitHub's main" in out
       and "office-line tests pass" in out and "Caregiver on-call invites: OFF" in out and "oncall-page off (new)" in out and "prn-week live is the build this one builds on" in out and "coverage-run live is the build this one builds on" in out, out[:3000])
    ck("Part 2: the SQL in one transaction; prn-week, oncall-page, coverage-run deployed; only oncall-page without the gateway sign-in check", any("create table if not exists public.oncall_invites" in q for q in writes())
       and deploys() == ["prn-week", "oncall-page", "coverage-run"] and re.search(r"deploy oncall-page .*--no-verify-jwt", cli()) and cli().count("--no-verify-jwt") == 1, cli())
    ck("Part 3: refuses outsiders and forged links; the records; the switch as it was", "prn-week refuses anyone not signed in" in out and "refuses a forged link (401)" in out and "needs an office sign-in" in out
       and "coverage-run refuses anyone" in out and "each on-call record names one person" in out and "the invite switch is as it was" in out, out[-1500:])
    ck("no key, token or email in the report; no em dash", not re.search(r"eyJ\w|sbp_\w|@mo-care", out) and "—" not in out, out)
    c, out = run(already=True)
    ck("run again: live is already this build, still DONE", c == 0 and "already this build (an earlier run)" in out and "1214: DONE" in out, out[-900:])
    c, out = run(drift=True)
    ck("coverage-run live with someone else's change: STOPS before any change", c == 3 and not deploys() and not writes() and "someone else's work may be live" in out, out[-600:])
    c, out = run(switch=True)
    ck("invites already on: said so, left on", c == 0 and "Caregiver on-call invites: ON" in out and "invites ON" in out, out[-900:])
    c, out = run(readfail=(401, {"message": "Unauthorized"}))
    ck("a token Supabase won't accept: says so, nothing changed", c == 3 and "didn't accept the access token" in out and not deploys() and not writes(), out[-500:])
    c, out = run(env_over={"SB_SHAS": json.dumps({"prn-week/index.ts": "0" * 64})})
    ck("not the reviewed build: nothing runs", c == 2 and not deploys() and not S["sql"], out[-400:])
    c, out = run(sqlfail=True)
    ck("the SQL fails: undone as a whole, nothing deployed", c == 6 and not deploys() and "undone as a whole" in out, out[-500:])
    c, out = run(gate=200)
    ck("a function answering the public key is caught", c == 1 and "✗ prn-week refuses" in out and "NOT COMPLETE" in out, out[-700:])
    c, out = run(forged=200)
    ck("the page taking a forged link is caught", c == 1 and "✗ the My on-call page refuses a forged link" in out, out[-700:])
finally:
    for w in (WT, BASEWT): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w])
    shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
