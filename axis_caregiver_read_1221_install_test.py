#!/usr/bin/env python3
# Rehearsal of 1221 (axis_caregiver_read_1221.py, the AxisCare caregiver read fixed everywhere) against a FAKE Supabase and a FAKE supabase CLI,
# from a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.
#   python3 axis_caregiver_read_1221_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_SHA = subprocess.run(["git", "-C", HERE, "rev-parse", "1063d350a7285d47afa49c56e7331b1b4107d2f9"], capture_output=True, text=True).stdout.strip()   # main after 1220 (#725), as live
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; M = {}
def reset(**m):
    S.clear(); S.update(sql=[], deployed=set()); M.clear()
    M.update(dict(switch=None, readfail=None, gate=401, forged=401, notlive=()), **m)
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
            if fn in M["notlive"]: return self._send(404, {"message": "not found"})
            return self._send(200, {"version": 7, "verify_jwt": fn not in ("oncall-page", "prn-page", "family-gateway", "family-offer")})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/oncall-page") or p.startswith("/functions/v1/prn-page"): return self._send(M["forged"], {"expired": True})
        if p.startswith("/functions/v1/"): return self._send(M["gate"], {"error": "not allowed"})
        q = body["query"]; S["sql"].append(q)
        if q.startswith("select data->'prn_oncall_invite_live'"):
            if M["readfail"]: return self._send(*M["readfail"])
            return self._send(200, [{"v": M["switch"]}])

        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1221-"); WT = os.path.join(TMP, "wt"); BASEWT = os.path.join(TMP, "base")
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
    if os.path.exists(os.path.join({TMP!r}, 'drift')) and fn == 'prn-team' and not os.path.exists(os.path.join({TMP!r}, 'deployed-' + fn)):
        open(os.path.join(os.getcwd(), 'supabase', 'functions', 'prn-team', 'index.ts'), 'a').write('// someone else')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = {k: sha(os.path.join(WT, "supabase/functions", k)) for k in ("_shared/axis-caregiver-read.ts", "_shared/axiscare-caregiver.ts", "_shared/axis-setup.ts", "_shared/family-app.ts", "_shared/nurse-hire.ts", "oncall-page/index.ts", "prn-team/index.ts", "axiscare-note/index.ts")}
def run(env_over=None, already=False, drift=False, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    for f in [LOG, rep] + [os.path.join(TMP, x) for x in os.listdir(TMP) if x.startswith("deployed-")]: os.path.exists(f) and os.remove(f)
    for flag, on in (("already", already), ("drift", drift)):
        fp = os.path.join(TMP, flag); (open(fp, "w").write("x") if on else (os.path.exists(fp) and os.remove(fp)))
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_STEP="1221", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(PIN), SB_BASE=BASE_SHA, SB_SETTLE="0", SB_MAIN_REF="HEAD", SB_RETRY_SCALE="0")
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "axis_caregiver_read_1221.py")], cwd=WT, env=env, capture_output=True, text=True, timeout=900)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
writes = lambda: [q for q in S["sql"] if not q.lstrip().lower().startswith("select")]
try:
    ALL = ["oncall-page", "prn-team", "caregiver-journey", "client-audit", "step2-handoff", "team-ask", "axiscare-note", "family-gateway", "family-offer", "family-app-office", "family-fee-check", "pilot-readiness"]
    c, out = run()
    ck("clean run from a fresh copy: exit 0, DONE", c == 0 and "1221: DONE" in out and "Caregiver on-call invites: OFF" in out, out[-1800:])
    ck("Part 1: the reviewed build, the tests ran, every function live = GitHub's main", "the reviewed build is what is on GitHub's main" in out and "family app tests pass" in out
       and all(f"{fn} live is GitHub's main" in out for fn in ALL), out[:4000])
    ck("Part 2: no database change; all twelve deployed, keeping each gateway setting", not writes() and deploys() == ALL
       and all(re.search(rf"deploy {fn} .*--no-verify-jwt", cli()) for fn in ("oncall-page", "family-gateway", "family-offer")) and cli().count("--no-verify-jwt") == 3, cli())
    ck("Part 3: forged link refused; office-only functions refuse outsiders", "the My on-call page refuses a forged link (401)" in out and "prn-team refuses anyone" in out and "axiscare-note refuses anyone" in out, out[-1500:])
    ck("no key, token or email in the report; no em dash", not re.search(r"eyJ\w|sbp_\w|@mo-care", out) and "\u2014" not in out, out)
    c, out = run(notlive=("pilot-readiness", "family-fee-check"))
    ck("a function that isn't live is left alone, the rest deployed", c == 0 and "not live, so left alone: family-fee-check, pilot-readiness" in out and "pilot-readiness" not in deploys() and len(deploys()) == 10, [deploys(), out[-800:]])
    c, out = run(already=True)
    ck("run again: live is already this build, still DONE", c == 0 and "already this build (an earlier run)" in out and "1221: DONE" in out, out[-900:])
    c, out = run(drift=True)
    ck("prn-team live with code never on GitHub's main: STOPS before any change", c == 3 and not deploys() and "never on GitHub's main (prn-team/index.ts)" in out, out[-600:])
    c, out = run(readfail=(401, {"message": "Unauthorized"}))
    ck("a token Supabase won't accept: says so, nothing changed", c == 3 and "didn't accept the access token" in out and not deploys(), out[-500:])
    c, out = run(env_over={"SB_SHAS": json.dumps({"prn-team/index.ts": "0" * 64})})
    ck("not the reviewed build: nothing runs", c == 2 and not deploys() and not S["sql"], out[-400:])
    c, out = run(gate=200)
    ck("a function answering the public key is caught", c == 1 and "✗ prn-team refuses" in out and "NOT COMPLETE" in out, out[-700:])
    c, out = run(forged=200)
    ck("the My on-call page taking a forged link is caught", c == 1 and "✗ the My on-call page refuses a forged link" in out, out[-700:])
finally:
    for w in (WT, BASEWT): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w])
    shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
