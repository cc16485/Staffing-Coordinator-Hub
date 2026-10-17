#!/usr/bin/env python3
# Rehearsal of 887 (office_line_887.py, every Hub text from (417) 234-8494): FAKE Supabase management API and a FAKE supabase CLI.
# Never touches GitHub, Supabase or GoHighLevel. Runs from a fresh copy of this folder's committed build (her rule).
#   python3 office_line_887_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t887-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN)
COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
HEAD = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
BASE = subprocess.run(["git", "-C", HERE, "merge-base", "HEAD", "origin/main"], capture_output=True, text=True).stdout.strip()
FNROOT = os.path.join(COPY, "supabase", "functions")
LIVE = os.path.join(TMP, "live")   # what is "deployed" before 887: the build just before this change, which is on main
subprocess.run(["git", "-C", COPY, "worktree", "add", "-q", "--detach", LIVE, BASE], check=True)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
CHANGED = ["_shared/office-from.ts", "_shared/send-problems.ts"] + [f"{f}/index.ts" for f in ("ops-escalate", "coverage-run", "team-ask", "kind-tell", "applicant-invite", "send-candidate-message", "reference-send")]
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in CHANGED}
M = {}; CALLS = []
def reset(**m):
    M.clear(); M.update(dict(fail_deploy=None, missing=[], odd=None, gates={"coverage-run": True}), **m); CALLS.clear()
    for p in ("deploys",):
        if os.path.exists(os.path.join(TMP, p)): os.remove(os.path.join(TMP, p))
    shutil.rmtree(os.path.join(TMP, "over"), ignore_errors=True)
    open(os.path.join(TMP, "mode.json"), "w").write(json.dumps(M))
def deployed():
    p = os.path.join(TMP, "deploys")
    return [json.loads(l) for l in open(p).read().splitlines()] if os.path.exists(p) else []
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        CALLS.append(("GET", self.path))
        m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", self.path)
        if m:
            fn = m.group(1)
            if fn in M["missing"]: return self._send(404, {})
            d = [x for x in deployed() if x[0] == fn]
            return self._send(200, {"verify_jwt": (not d[-1][1]) if d else M["gates"].get(fn, False), "version": 10 + len(d)})
        self._send(404, {})
    def do_PATCH(self): CALLS.append(("PATCH", self.path)); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); CALLS.append(("POST", self.path, self.rfile.read(n)[:200]))
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
open(os.path.join(BIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, json, os, shutil
a = sys.argv[1:]; M = json.load(open({os.path.join(TMP, 'mode.json')!r}))
if os.environ.get('SUPABASE_ACCESS_TOKEN') != 'sbp_test': sys.exit(1)
if a[:2] == ['functions', 'deploy']:
    if M.get('fail_deploy') == a[2]: print('deploy failed: boom', file=sys.stderr); sys.exit(1)
    open({os.path.join(TMP, 'deploys')!r}, 'a').write(json.dumps([a[2], '--no-verify-jwt' in a]) + '\\n')
    shutil.copytree({FNROOT!r}, os.path.join({TMP!r}, 'over', a[2]), dirs_exist_ok=True); sys.exit(0)
if a[:2] == ['functions', 'download']:
    fn = a[2]; dst = os.path.join(os.getcwd(), 'supabase', 'functions'); over = os.path.join({TMP!r}, 'over', fn)
    shutil.copytree(over if os.path.exists(over) else {os.path.join(LIVE, 'supabase', 'functions')!r}, dst, dirs_exist_ok=True)
    if M.get('odd') == fn and not os.path.exists(over): open(os.path.join(dst, fn, 'index.ts'), 'a').write('// unmerged work\\n')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(BIN, "supabase"), 0o755)
def run(shas=SHAS, main=HEAD, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="887", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_MAIN_REF=main,
               SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas))
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "office_line_887.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=1800)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
sends = lambda: [x for x in CALLS if x[0] == "POST"]

c, out = run()
d = deployed(); names = [x[0] for x in d]
ck("1 good run: every texting function redeployed from the reviewed build, DONE, nothing sent, no database touched",
   c == 0 and "RESULT: DONE" in out and "✗" not in out and len(d) > 20 and "send-candidate-message" in names and "circle-send" in names and not sends(), out[-1500:])
ck("1b gateway settings kept (coverage-run's check stays on, the rest stay off)", ["coverage-run", False] in d and all(x[1] for x in d if x[0] != "coverage-run"), d)
ck("1c a function that doesn't text is not touched", "ghl-thread" not in names and "calls-feed" not in names, names)
c, out = run(main=BASE); ck("2 not merged to GitHub's main yet: stopped before any change", c == 2 and "merge the pull request first" in out and not deployed(), out[-600:])
c, out = run(shas=dict(SHAS, **{"_shared/office-from.ts": "0" * 64})); ck("3 not the reviewed build: stopped before any change", c == 2 and not deployed(), out[-600:])
c, out = run(odd="kind-tell"); ck("4 a live copy with someone's unmerged work is left alone and listed; the rest go", c == 0 and "kind-tell" not in [x[0] for x in deployed()] and "kind-tell: the live copy is not a build from GitHub" in out and "still let GoHighLevel pick the number" in out and len(deployed()) > 20, out[-1500:])
c, out = run(missing=["ok-from-probe", "reference-send"]); ck("5 a function that isn't deployed is skipped, not created", c == 0 and "reference-send" not in [x[0] for x in deployed()] and "reference-send: not deployed" in out, out[-1500:])
c, out = run(fail_deploy="coverage-run"); ck("6 a deploy fails: stopped there, says which", c == 7 and "STOPPED at coverage-run" in out and "RESULT: DONE" not in out, out[-800:])
shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
bad = [r for r in res if not r[1]]
for n, okk, d_ in res: print(("PASS " if okk else "FAIL ") + n + ("\n     " + d_ if d_ else ""))
print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
