#!/usr/bin/env python3
# Rehearsal of 870 (ok_offer_hold_870.py): FAKE Supabase (management API, the two doors) and a FAKE supabase CLI. Never touches
# GitHub or Supabase. Runs from fresh copies of this folder's and the Training Platform's committed builds (her rule).
#   python3 ok_offer_hold_870_test.py            (Training copy from ../okh-training, or T_TRAIN=<path>)
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
TRAIN_SRC = os.environ.get("T_TRAIN", os.path.join(os.path.dirname(HERE), "okh-training"))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t870-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN)
def fresh(src, dst):
    subprocess.run(["git", "clone", "-q", src, dst], check=True)
    subprocess.run(["git", "-C", dst, "checkout", "-q", subprocess.run(["git", "-C", src, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()], check=True)
COPY = os.path.join(TMP, "hub"); TCOPY = os.path.join(TMP, "train"); fresh(HERE, COPY); fresh(TRAIN_SRC, TCOPY)
FNROOT = os.path.join(COPY, "supabase", "functions"); TFNROOT = os.path.join(TCOPY, "supabase", "functions")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in ("outreach-check/index.ts", "_shared/applicant-office.ts")}
TSHAS = {k: sha(os.path.join(TFNROOT, k)) for k in ("job-offer/index.ts", "_shared/text-rules.ts")}
M = {}; CALLS = []
GATE = {"zngsgedlsxinbygwmxwn/outreach-check": True, "rdqujxiycycwhskyvrwa/job-offer": False}
def reset(**m):
    M.clear(); M.update(dict(fail_deploy=None, open_door=None), **m); CALLS.clear()
    for f in ("deploys",):
        p = os.path.join(TMP, f)
        if os.path.exists(p): os.remove(p)
    open(os.path.join(TMP, "mode.json"), "w").write(json.dumps(M))
def deployed():
    p = os.path.join(TMP, "deploys")
    return [json.loads(l) for l in open(p).read().splitlines()] if os.path.exists(p) else []
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        CALLS.append(("GET", self.path))
        if m := re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", self.path):
            k = m.group(1) + "/" + m.group(2)
            if k in GATE:
                d = [x for x in deployed() if x[0] == m.group(1) and x[1] == m.group(2)]
                return self._send(200, {"verify_jwt": (not d[-1][2]) if d else GATE[k], "version": 9 + len(d)})
        self._send(404, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"null"); CALLS.append(("POST", self.path, b))
        if self.path.startswith("/functions/v1/outreach-check"): return self._send(200 if M["open_door"] == "hub" else 401, {"error": "Sign in"})
        if self.path.startswith("/functions/v1/job-offer"): return self._send(200 if M["open_door"] == "train" else 401, {"error": "Sign in to the Hub first."})
        if self.path.endswith("/database/query"): return self._send(400, {"message": "870 must not touch the database"})
        self._send(404, {})
    def do_PATCH(self): CALLS.append(("PATCH", self.path)); self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
open(os.path.join(BIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, json, os, shutil
a = sys.argv[1:]; M = json.load(open({os.path.join(TMP, 'mode.json')!r}))
if os.environ.get('SUPABASE_ACCESS_TOKEN') != 'sbp_test': sys.exit(1)
ref = a[a.index('--project-ref') + 1]
FN = {{'zngsgedlsxinbygwmxwn': {FNROOT!r}, 'rdqujxiycycwhskyvrwa': {TFNROOT!r}}}[ref]
if a[:2] == ['functions', 'deploy']:
    if M.get('fail_deploy') == a[2]: print('deploy failed: boom', file=sys.stderr); sys.exit(1)
    if os.path.realpath(os.getcwd()) != os.path.realpath(os.path.dirname(os.path.dirname(FN))): print('wrong folder for this project', file=sys.stderr); sys.exit(1)
    open({os.path.join(TMP, 'deploys')!r}, 'a').write(json.dumps([ref, a[2], '--no-verify-jwt' in a]) + '\\n'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree(FN, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(BIN, "supabase"), 0o755)
def run(shas=SHAS, tshas=TSHAS, main_ref="HEAD", train_main_ref="HEAD", **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="870", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_TRAIN_FN_BASE=URL,
               SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_TRAIN_FNROOT=TFNROOT, SB_SHAS=json.dumps(shas), SB_TRAIN_SHAS=json.dumps(tshas),
               SB_MAIN_REF=main_ref, SB_TRAIN_MAIN_REF=train_main_ref, SB_NODE=shutil.which("node") or "")
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "ok_offer_hold_870.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
names = lambda: [(d[0][:4], d[1]) for d in deployed()]

c, out = run()
ck("1 good run: both deployed, proofs pass, DONE", c == 0 and "870: DONE" in out and "✗" not in out, out)
ck("1b the Hub's answer goes FIRST, then job-offer, each to its own project", names() == [("zngs", "outreach-check"), ("rdqu", "job-offer")], deployed())
ck("1c each gateway setting kept as it was live (outreach-check on, job-offer off)", [d[2] for d in deployed()] == [False, True], deployed())
ck("1d the tests ran inside the step (both repos)", out.count("ok_offer_hold_test.mjs") == 2 and "passed (fake data only)" in out, out)
ck("1e no database touched, no setting patched", not [x for x in CALLS if x[0] == "PATCH" or (x[0] == "POST" and x[1].endswith("/database/query"))], CALLS)
ck("1f no token in the report", "sbp_test" not in out, out)
c, out = run(shas={**SHAS, "_shared/applicant-office.ts": "0" * 64})
ck("2 a Hub file that isn't the reviewed build: stops before anything", c == 2 and not deployed(), out)
c, out = run(tshas={**TSHAS, "job-offer/index.ts": "0" * 64})
ck("3 a Training file that isn't the reviewed build: stops before anything", c == 2 and not deployed(), out)
c, out = run(main_ref="HEAD~1000000")
ck("4 Hub not merged (or newer work since): stops before anything", c == 2 and "merge the pull request first" in out and not deployed(), out)
c, out = run(train_main_ref="HEAD~1000000")
ck("5 Training not merged: stops before anything", c == 2 and "job-offer isn't the same as GitHub's main" in out and not deployed(), out)
c, out = run(fail_deploy="outreach-check")
ck("6 the Hub deploy fails: job-offer is NOT deployed (never live without its answer)", c == 5 and names() == [] and "job-offer is untouched" in out, out)
c, out = run(fail_deploy="job-offer")
ck("7 job-offer fails after the Hub: says the Hub part is in and harmless, job-offer unchanged", c == 5 and names() == [("zngs", "outreach-check")] and "harmless on its own" in out, out)
c, out = run(open_door="train")
ck("8 a door answering a stranger is reported, not DONE", c == 1 and "job-offer answered a stranger" in out and "870: NOT COMPLETE" in out, out)

for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  870 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed")
shutil.rmtree(TMP, ignore_errors=True)
raise SystemExit(0 if all(r[1] for r in res) else 1)
