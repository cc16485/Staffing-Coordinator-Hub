#!/usr/bin/env python3
# Rehearsal of 958 (no_emdash_958.py) against a FAKE Supabase and a FAKE supabase CLI, from a fresh worktree of this commit (as
# the Desktop step runs it). Never touches a real project. "Live" starts as the server just before the wording change
# (dac63498); a deployed service then reads back as this commit.
#   python3 no_emdash_958_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
BEFORE = "dac63498a91b0eb45fc05057283a81229a84f3c0"     # main just before PR #534
AFTER = "0035397c"                                       # main with PR #536 merged (the reviewed wording)
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
TMP = tempfile.mkdtemp(prefix="t958-"); M = {}; SQL = []; PATCH = []
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", self.path)
        if m:
            fn = m.group(1)
            if fn == M.get("absent"): return self._send(404, {})
            return self._send(200, {"version": 9, "verify_jwt": fn not in M.get("nojwt", ())})
        self._send(404, {})
    def do_PATCH(self): PATCH.append(self.path); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); SQL.append(self.rfile.read(n)); self._send(400, {"message": "no SQL expected"})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
WT = os.path.join(TMP, "wt"); BWT = os.path.join(TMP, "before")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", BWT, BEFORE], check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log"); DEP = os.path.join(TMP, "deployed"); os.makedirs(DEP)
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']:
    if os.path.exists(os.path.join({TMP!r}, 'fail_' + a[2])): sys.exit(1)
    open(os.path.join({DEP!r}, a[2]), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    fn = a[2]; src = {WT!r} if os.path.exists(os.path.join({DEP!r}, fn)) else {BWT!r}
    root = os.path.join(src, 'supabase', 'functions'); dst = os.path.join(os.getcwd(), 'supabase', 'functions')
    shutil.copytree(os.path.join(root, fn), os.path.join(dst, fn), dirs_exist_ok=True)
    shutil.copytree(os.path.join(root, '_shared'), os.path.join(dst, '_shared'), dirs_exist_ok=True)
    if os.path.exists(os.path.join({TMP!r}, 'drift_' + fn)): open(os.path.join(dst, fn, 'index.ts'), 'a').write('// another change, not live yet')
    if os.path.exists(os.path.join({TMP!r}, 'stray_' + fn)): open(os.path.join(dst, fn, 'mystery.ts'), 'w').write('// deployed by hand')
    sys.exit(0)
sys.exit(2)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
MINE = [f for f in subprocess.run(["git", "-C", HERE, "diff", "--name-only", BEFORE, AFTER], capture_output=True, text=True).stdout.split() if f.startswith("supabase/functions/")]
SHAS = {f: sha(os.path.join(WT, f)) for f in MINE}
def run(**env):
    rep = os.path.join(TMP, "report.txt"); open(LOG, "w").close()
    e = dict(os.environ, SB_TOKEN="sbp_fake", SB_REPORT=rep, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_REPO=WT, SB_BEFORE=BEFORE,
             SB_SHAS=json.dumps(SHAS), SB_API_BASE=URL, SB_POLL="0")
    e.update(env)
    p = subprocess.run(["python3", os.path.join(WT, "no_emdash_958.py")], env=e, capture_output=True, text=True, timeout=1800)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read()
def reset(**m):
    M.clear(); M.update(m); SQL.clear(); PATCH.clear(); shutil.rmtree(DEP); os.makedirs(DEP)
    for f in os.listdir(TMP):
        if f.startswith(("drift_", "stray_", "fail_")): os.remove(os.path.join(TMP, f))
deploys = lambda log: re.findall(r"^functions deploy ([\w-]+)", log, re.M)
ck("the step's file list is the 45 reworded server files", len(MINE) == 45, len(MINE))

# 1 · the normal run: every live service that bundles a reworded file is redeployed with its own gateway setting
reset(absent="ai-ltc-policy", nojwt=("lead-intake", "coverage-reply"))
code, rep, log = run()
dep = deploys(log)
ck("normal: DONE, exit 0", code == 0 and "RESULT: DONE." in rep, rep[-1500:])
ck("normal: call-disposition, profile-check, automation-watchdog and lead-watch are among the redeployed", all(f in dep for f in ("call-disposition", "profile-check", "automation-watchdog", "lead-watch")), dep)
ck("normal: a service that is not live is left alone (never created)", "ai-ltc-policy" not in dep and "not live, left alone: 1 (ai-ltc-policy)" in rep, rep[:2500])
ck("normal: gateway setting kept (off stays off, on stays on)", re.search(r"^functions deploy lead-intake .*--no-verify-jwt", log, re.M) and not re.search(r"^functions deploy call-disposition .*--no-verify-jwt", log, re.M), log[:800])
ck("normal: no SQL at all, no setting patched", not SQL and not PATCH, (SQL[:1], PATCH[:3]))
ck("normal: nothing held back", "held back" not in rep, rep[:3000])
n_first = len(dep)

# 2 · run again: everything is already live, nothing redeployed
M.update(absent="ai-ltc-policy")
code, rep, log = run()
ck("again: DONE, nothing redeployed, all already live", code == 0 and not deploys(log) and "nothing to redeploy" in rep and f"already live with the new wording: {n_first}" in rep, rep[:2000])

# 3 · another change merged but not live on one service: that service is held back with the file named, the rest go
reset()
open(os.path.join(TMP, "drift_lead-intake"), "w").write("x")
code, rep, log = run()
dep = deploys(log)
ck("drift: lead-intake held back, naming its own file", "lead-intake" not in dep and re.search(r"held back: lead-intake: deploying it would also ship lead-intake/index\.ts", rep), rep[:3000])
ck("drift: the others still redeploy and the run is DONE", code == 0 and "call-disposition" in dep and "1 held back" in rep, rep[-800:])

# 4 · a live copy with a file main never had: held back
reset()
open(os.path.join(TMP, "stray_coverage-run"), "w").write("x")
code, rep, log = run()
ck("stray: coverage-run held back (a file main never had)", "coverage-run" not in deploys(log) and "coverage-run: its live copy has a file main never had: coverage-run/mystery.ts" in rep, rep[:3000])

# 5 · one deploy fails: the ✗ is reported, the others still go, exit 1
reset()
open(os.path.join(TMP, "fail_profile-check"), "w").write("x")
code, rep, log = run()
ck("deploy fails: profile-check ✗ named, others redeployed, exit 1", code == 1 and "✗ profile-check did not deploy cleanly" in rep and "call-disposition" in deploys(log) and "redeployed; the ✗ lines" in rep, rep[-1500:])

# 6 · not the reviewed build: stops before anything
reset()
bad = dict(SHAS); bad[MINE[0]] = "0" * 64
code, rep, log = run(SB_SHAS=json.dumps(bad))
ck("wrong build: STOP before anything, no deploy", code == 2 and "is not the reviewed build" in rep and "STOP. Nothing was run." in rep and not deploys(log), rep[:800])

# 7 · no token / unknown starting point
reset()
code, rep, log = run(SB_TOKEN="nope")
ck("no token: stops, nothing deployed", code == 2 and "no Supabase access token" in rep and not deploys(log), rep[:400])
code, rep, log = run(SB_BEFORE="f" * 40)
ck("unknown starting point: stops, nothing deployed", code == 2 and "isn't in the server's history" in rep and not deploys(log), rep[:400])

for w in (WT, BWT): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w], capture_output=True)
shutil.rmtree(TMP, ignore_errors=True)
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
f = sum(1 for _, ok, _ in res if not ok); print(f"{len(res) - f}/{len(res)} passed"); raise SystemExit(1 if f else 0)
