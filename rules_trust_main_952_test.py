#!/usr/bin/env python3
# Rehearsal of 952 (rules_trust_main_952.py, GitHub main is the approval): FAKE Supabase (management API, the function doors)
# and a FAKE supabase CLI. Never touches GitHub, Supabase or AxisCare. Runs from a fresh copy of this folder's committed build.
#   python3 rules_trust_main_952_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t952-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN)
COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
HEAD = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
FNS = ["caregiver-connect", "client-audit", "client-start-run", "eligibility-sweep", "family-gateway", "family-offer",
       "intake-import", "launch-evidence", "match-dark", "obligations-run", "promise-run", "reference-land"]
SHAS = {"_shared/approved-rules.ts": sha(os.path.join(FNROOT, "_shared/approved-rules.ts"))}
GATES = {fn: fn in ("family-gateway",) for fn in FNS}   # one job keeps its gateway check on, the rest off
M = {}; CALLS = []
def reset(**m):
    M.clear(); M.update(dict(fail_deploy=None, live_extra=None, not_approved=None, q_there=True, no_key=False), **m); CALLS.clear()
    p = os.path.join(TMP, "deploys")
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
        if "/api-keys" in self.path: return self._send(200, [] if M["no_key"] else [{"name": "service_role", "api_key": "eyJfake"}])
        m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", self.path)
        if m:
            d = [x for x in deployed() if x[0] == m.group(1)]
            return self._send(200, {"verify_jwt": (not d[-1][1]) if d else GATES[m.group(1)], "version": 10 + len(d)})
        self._send(404, {})
    def do_PATCH(self): CALLS.append(("PATCH", self.path)); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"null"); CALLS.append(("POST", self.path, b))
        m = re.match(r"/functions/v1/([\w-]+)\?rules_check=1$", self.path)
        if m: return self._send(200, {"ok": True, "all_approved": m.group(1) != M["not_approved"], "rules_check": []})
        if self.path.endswith("/database/query"):
            q = b["query"]
            if "to_regclass('public.rules_approved')" in q: return self._send(200, [{"t": True, "n": 25, "q": M["q_there"]}])
            if "drop function if exists public.rules_fingerprint_approved" in q: M["q_there"] = False; return self._send(201, [])
            if "as gone" in q: return self._send(200, [{"gone": not M["q_there"]}])
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
    dst = os.path.join(os.getcwd(), 'supabase', 'functions'); shutil.copytree({FNROOT!r}, dst, dirs_exist_ok=True)
    if M.get('live_extra') == a[2]: open(os.path.join(dst, a[2], 'index.ts'), 'a').write('// a hotfix nobody put on GitHub\\n')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(BIN, "supabase"), 0o755)
def run(shas=SHAS, main=HEAD, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="952", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_MAIN_REF=main,
               SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas))
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "rules_trust_main_952.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=900)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
writes = lambda: [x for x in CALLS if x[0] == "POST" and x[1].endswith("/database/query") and re.search(r"\b(drop|update|delete|insert|create|grant|revoke)\b", x[2]["query"], re.I)]

c, out = run()
ck("1 good run: all twelve jobs deployed (each gateway setting kept), the PR-check question removed, every rules check passes, DONE",
   c == 0 and "RESULT: DONE" in out and "✗" not in out and sorted(d[0] for d in deployed()) == sorted(FNS)
   and all(d[1] == (not GATES[d[0]]) for d in deployed()) and "the PR-check question is gone" in out, out)
ck("1b the only database write is dropping that one function (the approved list is kept)", len(writes()) == 1 and "drop function if exists public.rules_fingerprint_approved(text, text)" in writes()[0][2]["query"], writes())
ck("1c it never runs a job for real: only ?rules_check=1 calls reach the jobs", all(x[1].endswith("?rules_check=1") for x in CALLS if x[0] == "POST" and x[1].startswith("/functions/v1/")), CALLS)
c, out = run(q_there=False); ck("2 run a second time (question already gone): still DONE", c == 0 and "RESULT: DONE" in out and "already gone" in out, out)
c, out = run(shas={"_shared/approved-rules.ts": "0" * 64}); ck("3 not the reviewed build: stopped before any change", c != 0 and not deployed() and not writes(), out)
BEFORE = subprocess.run(["git", "-C", HERE, "merge-base", "HEAD", "origin/main"], capture_output=True, text=True).stdout.strip()
c, out = run(main=BEFORE); ck("4 not merged to GitHub's main yet: stopped before any change", c != 0 and "merge the pull request first" in out and not deployed() and not writes(), out)
c, out = run(live_extra="match-dark"); ck("5 a job is live with work that is not on GitHub: stopped before any change, names it", c != 0 and "match-dark is live with changes that are not on GitHub" in out and not deployed() and not writes(), out)
c, out = run(fail_deploy="intake-import"); ck("6 a deploy fails: stopped there, says which, the question is not removed", c == 7 and "STOPPED at intake-import" in out and "RESULT: DONE" not in out and not writes(), out)
c, out = run(not_approved="obligations-run"); ck("7 a job's rules check does not pass: reported, not DONE", c == 9 and "obligations-run rules check" in out and "RESULT: DONE" not in out, out)
c, out = run(no_key=True); ck("8 the server key can't be read: the deploys are in, the checks are not claimed, not DONE", c == 9 and "weren't asked" in out and "RESULT: DONE" not in out, out)
ck("9 no em dash in the step", "—" not in open(os.path.join(HERE, "rules_trust_main_952.py")).read())
shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
bad = [r for r in res if not r[1]]
for n, okk, d in res: print(("PASS " if okk else "FAIL ") + n + ("\n     " + d if d else ""))
print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
