#!/usr/bin/env python3
# Rehearsal of 875 (agreement_steps_875.py): FAKE Supabase (management API, the function doors) and a FAKE supabase CLI.
# Never touches GitHub, Supabase or AxisCare. Runs from a fresh copy of this folder's committed build (her rule).
#   python3 agreement_contacts_872_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t875-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN)
COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
HEAD = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
FN_FILES = ("client-agreement/index.ts", "_shared/agreement-steps.ts")
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in FN_FILES}
SQL_SHA = "unused"
M = {}; CALLS = []
def reset(**m):
    M.clear(); M.update(dict(no_874=False, no_safe=False, fail_deploy=None, door_open=False, sign_there=True, gates={"client-agreement": False}), **m); CALLS.clear()
    p = os.path.join(TMP, "deploys")
    if os.path.exists(p): os.remove(p)
    open(os.path.join(TMP, "mode.json"), "w").write(json.dumps(M))
def deployed():
    p = os.path.join(TMP, "deploys")
    return [json.loads(l) for l in open(p).read().splitlines()] if os.path.exists(p) else []
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self): CALLS.append(("OPTIONS", self.path)); self._send(200, {})
    def do_GET(self):
        CALLS.append(("GET", self.path))
        m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", self.path)
        if m:
            d = [x for x in deployed() if x[0] == m.group(1)]
            if not d and m.group(1) not in M["gates"] and not M["sign_there"]: return self._send(404, {})
            return self._send(200, {"verify_jwt": (not d[-1][1]) if d else M["gates"].get(m.group(1), False), "version": 10 + len(d)})
        self._send(404, {})
    def do_PATCH(self): CALLS.append(("PATCH", self.path)); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"null"); CALLS.append(("POST", self.path, b))
        if self.path.startswith("/functions/v1/agreement-sign"):
            if M["door_open"]: return self._send(200, {"ok": True, "state": "need_code"})
            return self._send(404, {"error": "This link does not work.", "outcome": "bad_link"}) if len(str((b or {}).get("t", ""))) >= 40 else self._send(400, {"error": "not complete", "outcome": "bad_link"})
        if self.path.startswith("/functions/v1/"): return self._send(401, {"error": "Sign in first."})
        if self.path.endswith("/database/query"):
            q = b["query"]
            if "as stage3" in q: return self._send(200, [{"stage3": not M["no_874"], "safe_write": not M["no_safe"], "journeys": True}])
            return self._send(400, {"message": "unexpected query: " + q[:80]})
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
def run(shas=SHAS, sql_sha=SQL_SHA, main=HEAD, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="875", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_MAIN_REF=main,
               SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas), SB_SQL_SHA=sql_sha)
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "agreement_steps_875.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
changed = lambda: deployed()

c, out = run()
ck("1 good run: client-agreement deployed (gateway setting kept), no database change, proofs pass, DONE", c == 0 and "RESULT: DONE" in out and "✗" not in out and deployed() == [["client-agreement", True]] and not any(x[0] == "POST" and x[1].endswith("/database/query") and "create" in x[2]["query"] for x in CALLS), out)
ck("1b the report points to the GoHighLevel clean-up list, nothing sent", "GoHighLevel clean-up list" in out and "Nothing was sent by this step" in out)
c, out = run(shas=dict(SHAS, **{"_shared/agreement-steps.ts": "0" * 64})); ck("2 not the reviewed build: stopped before any change", c != 0 and not changed(), out)
BEFORE = subprocess.run(["git", "-C", HERE, "merge-base", "HEAD", "origin/main"], capture_output=True, text=True).stdout.strip()
c, out = run(main=BEFORE); ck("3 not merged to GitHub's main yet: stopped before any change", c != 0 and "merge the pull request first" in out and not changed(), out)
c, out = run(no_874=True); ck("4 step 874 never ran: stopped before any change", c != 0 and "874 first" in out and not changed(), out)
c, out = run(no_safe=True); ck("5 the conflict-safe lead save is missing: stopped before any change", c != 0 and "Tell Claude" in out and not changed(), out)
c, out = run(fail_deploy="client-agreement"); ck("6 the deploy fails: stopped, says nothing changed", c == 6 and "Nothing changed" in out and "RESULT: DONE" not in out, out)
shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
bad = [r for r in res if not r[1]]
for n, okk, d in res: print(("PASS " if okk else "FAIL ") + n + ("\n     " + d if d else ""))
print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
