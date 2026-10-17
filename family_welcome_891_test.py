#!/usr/bin/env python3
# Rehearsal of 891 (family_welcome_891.py): FAKE Supabase (management API, the office door) and a FAKE supabase CLI.
# Never touches GitHub or Supabase. Runs from a fresh copy of this folder's committed build.   python3 family_welcome_891_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
TMP = tempfile.mkdtemp(prefix="t891-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN); COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
subprocess.run(["git", "-C", COPY, "checkout", "-q", subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions"); sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in ("_shared/family-app-office.ts", "family-app-office/index.ts")}
M = {}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if re.match(r"/v1/projects/zngsgedlsxinbygwmxwn/functions/family-app-office$", self.path):
            d = os.path.exists(os.path.join(TMP, "deploys")); return self._send(200, {"verify_jwt": True, "version": 10 if d else 9})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        if self.path.startswith("/functions/v1/family-app-office"): return self._send(401 if M.get("office_401", True) else 200, {"error": "not allowed"})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
open(os.path.join(BIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, json, os, shutil
a = sys.argv[1:]
if os.environ.get('SUPABASE_ACCESS_TOKEN') != 'sbp_test': sys.exit(1)
if a[:2] == ['functions', 'deploy']:
    if os.path.exists({os.path.join(TMP, 'fail')!r}): sys.exit(1)
    open({os.path.join(TMP, 'deploys')!r}, 'a').write(json.dumps([a[2], '--no-verify-jwt' not in a]) + '\\n'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree({FNROOT!r}, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(BIN, "supabase"), 0o755)
def run(shas=SHAS, main_ref="HEAD", fail=False, **m):
    M.clear(); M.update(m)
    for f in ("deploys", "fail"):
        if os.path.exists(os.path.join(TMP, f)): os.remove(os.path.join(TMP, f))
    if fail: open(os.path.join(TMP, "fail"), "w").write("1")
    rep = os.path.join(TMP, "r.txt")
    env = dict(os.environ, SB_STEP="891", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_SHAS=json.dumps(shas), SB_MAIN_REF=main_ref, SB_NODE=shutil.which("node") or "")
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "family_welcome_891.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=300)
    d = [json.loads(l) for l in open(os.path.join(TMP, "deploys")).read().splitlines()] if os.path.exists(os.path.join(TMP, "deploys")) else []
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), d
c, out, d = run()
ck("1 good run: the office door only, its gateway check kept on, the proof", c == 0 and "891: DONE" in out and d == [["family-app-office", True]] and "✗" not in out, out)
ck("1b the tests ran, including her approved words", "brands_test.mjs" in out and "family_app_1a_test.mjs" in out, out)
c, out, d = run(shas={**SHAS, "_shared/family-app-office.ts": "0" * 64})
ck("2 not the reviewed build: nothing deployed", c == 2 and not d, out)
c, out, d = run(main_ref="HEAD~1")
ck("3 not merged yet: nothing deployed", c == 2 and "merge the pull request first" in out and not d, out)
c, out, d = run(fail=True)
ck("4 the deploy fails: says so", c == 5, out)
c, out, d = run(office_401=False)
ck("5 the door answering a stranger is reported, not DONE", c == 1 and "NOT COMPLETE" in out, out)
for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  891 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed")
shutil.rmtree(TMP, ignore_errors=True)
raise SystemExit(0 if all(r[1] for r in res) else 1)
