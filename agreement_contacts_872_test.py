#!/usr/bin/env python3
# Rehearsal of 872 (agreement_contacts_872.py): FAKE Supabase (management API, the function doors) and a FAKE supabase CLI.
# Never touches GitHub, Supabase or AxisCare. Runs from a fresh copy of this folder's committed build (her rule).
#   python3 agreement_contacts_872_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t872-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN)
COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
HEAD = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
FN_FILES = ("client-agreement/index.ts", "_shared/agreement-contacts.ts", "_shared/family-change-text.ts", "late-alert/index.ts", "late-watch/index.ts")
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in FN_FILES}
SQL_SHA = sha(os.path.join(COPY, "agreement_contacts_872.sql"))
M = {}; CALLS = []
def reset(**m):
    M.clear(); M.update(dict(installed=False, no_871=False, fail_deploy=None, carry_ok=True, gates={"client-agreement": False, "late-alert": False, "late-watch": True}), **m); CALLS.clear()
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
            return self._send(200, {"verify_jwt": (not d[-1][1]) if d else M["gates"][m.group(1)], "version": 10 + len(d)})
        self._send(404, {})
    def do_PATCH(self): CALLS.append(("PATCH", self.path)); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"null"); CALLS.append(("POST", self.path, b))
        if self.path.startswith("/functions/v1/"): return self._send(401, {"error": "Sign in first."})
        if self.path.endswith("/database/query"):
            q = b["query"]
            if "as late_there" in q: return self._send(200, [{"agreements": not M["no_871"], "late_there": M["installed"], "review_there": M["installed"], "members": 40, "no_changes": 3}])
            if "add column wants_late" in q: M["migrated"] = True; return self._send(200, [])
            if "as late_off" in q: return self._send(200, [{"members": 40, "late_off": 3 if M["carry_ok"] else 0, "differ": 0 if M["carry_ok"] else 3, "nullable": "NO", "browser_can_read": False, "one_per_contact": True}])
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
    env = dict(os.environ, SB_STEP="872", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_MAIN_REF=main,
               SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas), SB_SQL_SHA=sql_sha)
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "agreement_contacts_872.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
changed = lambda: M.get("migrated") or deployed()

c, out = run()
ck("1 good run: database change, three functions, proofs pass, DONE", c == 0 and "RESULT: DONE" in out and "✗" not in out and M.get("migrated"), out)
ck("1b deployed in order: client-agreement, late-alert, late-watch", [d[0] for d in deployed()] == ["client-agreement", "late-alert", "late-watch"], deployed())
ck("1c each keeps its live gateway setting (late-watch stays on, the others stay off)", deployed() == [["client-agreement", True], ["late-alert", True], ["late-watch", False]], deployed())
ck("1d the report says nothing is sent and AxisCare is untouched", "Nothing was sent, and nothing changed in AxisCare" in out and "3 of them" not in out and "40 Family Circle members, 3 of them with caregiver-change texts off" in out, out)
c, out = run(sql_sha="0" * 64); ck("2 the SQL is not the reviewed build: stopped before any change", c != 0 and not changed(), out)
c, out = run(shas=dict(SHAS, **{"late-watch/index.ts": "0" * 64})); ck("3 a function is not the reviewed build: stopped before any change", c != 0 and not changed(), out)
c, out = run(main=HEAD + "~1"); ck("4 not merged to GitHub's main yet: stopped before any change, says merge first", c != 0 and "merge the pull request first" in out and not changed(), out)
c, out = run(installed=True); ck("5 already installed: stopped before any change", c != 0 and "installed already" in out and not changed(), out)
c, out = run(no_871=True); ck("6 step 871 never ran: stopped before any change", c != 0 and "871 first" in out and not changed(), out)
c, out = run(fail_deploy="late-alert")
ck("7 a deploy fails: stopped with a clear line; what is in is named; nothing claimed", c == 6 and "did not deploy cleanly" in out and "client-agreement deployed" in out and "RESULT: DONE" not in out and [d[0] for d in deployed()] == ["client-agreement"], out)
c, out = run(carry_ok=False); ck("8 the switch did not carry everyone's choice over: the proof catches it", c == 9 and "carry-over is not as expected" in out, out)
shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
bad = [r for r in res if not r[1]]
for n, okk, d in res: print(("PASS " if okk else "FAIL ") + n + ("\n     " + d if d else ""))
print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
