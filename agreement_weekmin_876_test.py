#!/usr/bin/env python3
# Rehearsal of 876 (agreement_weekmin_876.py, the 8-hour weekly minimum): FAKE Supabase (management API, the function doors) and a FAKE supabase CLI.
# Never touches GitHub, Supabase or AxisCare. Runs from a fresh copy of this folder's committed build (her rule).
#   python3 agreement_weekmin_876_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t876-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN)
COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
# 2026-10-18: 934 made a newer master current, so 876 is rehearsed on the build it shipped (it ran 2026-10-17).
HEAD = "0e8f003e5f425ff52933b1bd5e3417dcdd29d9ac"
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
FN_FILES = ("client-agreement/index.ts", "agreement-sign/index.ts", "_shared/agreement-masters.ts", "_shared/client-agreement-map.ts", "_shared/client-agreement-map-2026-10-16.ts", "_shared/agreement-pdf.ts", "_shared/agreement-family-sign.ts")
NEW_PDF = os.path.join(COPY, "client-agreement", "client-care-agreement-rev-2026-10-17.pdf"); OLD_PDF = os.path.join(COPY, "client-agreement", "client-care-agreement-rev-2026-10.pdf")
PDF_SHA = sha(NEW_PDF); STORE = {}
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in FN_FILES}
SQL_SHA = "unused"
M = {}; CALLS = []
def reset(**m):
    M.clear(); M.update(dict(no_874=False, no_safe=False, fail_deploy=None, door_open=False, sign_there=True, old_drafts=0, old_signed=0, no_old=False, bad_store=False, no_key=False, gates={"client-agreement": False, "agreement-sign": False}), **m); CALLS.clear()
    STORE.clear()
    if not M["no_old"]: STORE["master/client-care-agreement-rev-2026-10.pdf"] = open(OLD_PDF, "rb").read()
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
    def _raw(self, code, data): self.send_response(code); self.send_header("Content-Type", "application/pdf"); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        CALLS.append(("GET", self.path))
        if "/api-keys" in self.path: return self._send(200, [] if M["no_key"] else [{"name": "service_role", "api_key": "eyJfake"}])
        m = re.match(r"/storage/v1/object/authenticated/client-agreements/(.+)$", self.path)
        if m: return self._raw(200, STORE[m.group(1)]) if m.group(1) in STORE else self._send(400, {"error": "not found"})
        m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", self.path)
        if m:
            d = [x for x in deployed() if x[0] == m.group(1)]
            if not d and m.group(1) not in M["gates"] and not M["sign_there"]: return self._send(404, {})
            return self._send(200, {"verify_jwt": (not d[-1][1]) if d else M["gates"].get(m.group(1), False), "version": 10 + len(d)})
        self._send(404, {})
    def do_PATCH(self): CALLS.append(("PATCH", self.path)); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n)
        m = re.match(r"/storage/v1/object/client-agreements/(.+)$", self.path)
        if m:
            CALLS.append(("STORE", m.group(1)))
            if m.group(1) in STORE: return self._send(400, {"error": "Duplicate", "message": "The resource already exists"})
            STORE[m.group(1)] = (raw[:-1] + b"x") if M["bad_store"] else raw; return self._send(200, {"Key": m.group(1)})
        b = json.loads(raw or b"null"); CALLS.append(("POST", self.path, b))
        if self.path.startswith("/functions/v1/agreement-sign"):
            if M["door_open"]: return self._send(200, {"ok": True, "state": "need_code"})
            return self._send(404, {"error": "This link does not work.", "outcome": "bad_link"}) if len(str((b or {}).get("t", ""))) >= 40 else self._send(400, {"error": "not complete", "outcome": "bad_link"})
        if self.path.startswith("/functions/v1/"): return self._send(401, {"error": "Sign in first."})
        if self.path.endswith("/database/query"):
            q = b["query"]
            if "as stage3" in q: return self._send(200, [{"stage3": not M["no_874"], "safe_write": not M["no_safe"], "journeys": True, "old_drafts": M["old_drafts"], "old_signed": M["old_signed"]}])
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
def run(shas=SHAS, sql_sha=SQL_SHA, main=HEAD, pdf_sha=None, **mode):
    pdf_sha = PDF_SHA if pdf_sha is None else pdf_sha
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="876", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_MAIN_REF=main,
               SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas), SB_SQL_SHA=sql_sha, SB_PDF_SHA=pdf_sha)
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "agreement_weekmin_876.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
changed = lambda: deployed()

stored = lambda: [x[1] for x in CALLS if x[0] == "STORE"]
c, out = run()
ck("1 good run: the updated PDF stored and read back, both functions deployed (gateway settings kept), proofs pass, DONE", c == 0 and "RESULT: DONE" in out and "✗" not in out and deployed() == [["client-agreement", True], ["agreement-sign", True]] and stored() == ["master/client-care-agreement-rev-2026-10-17.pdf"] and not any(x[0] == "POST" and x[1].endswith("/database/query") and "update" in x[2]["query"].lower() for x in CALLS), out)
ck("1b the first PDF is never written again; the report says 875 is included and nothing was sent", "master/client-care-agreement-rev-2026-10.pdf" not in stored() and "875 is included here" in out and "Nothing was sent by this step" in out, out)
c, out = run(old_drafts=2, old_signed=1); ck("2 agreements on the first wording are counted, with what to do", c == 0 and "not signed yet: 2 (after this step, tap Start another" in out and "waiting for the office: 1 (countersign as usual" in out, out)
c, out = run(shas=dict(SHAS, **{"_shared/agreement-masters.ts": "0" * 64})); ck("3 not the reviewed build: stopped before any change", c != 0 and not changed() and not stored(), out)
c, out = run(pdf_sha="0" * 64); ck("4 the updated PDF is not the reviewed one: stopped before any change", c != 0 and not changed() and not stored(), out)
BEFORE = subprocess.run(["git", "-C", HERE, "merge-base", "HEAD", "origin/main"], capture_output=True, text=True).stdout.strip()
c, out = run(main=BEFORE); ck("5 not merged to GitHub's main yet: stopped before any change", c != 0 and "merge the pull request first" in out and not changed() and not stored(), out)
c, out = run(no_874=True); ck("6 step 874 never ran: stopped before any change", c != 0 and "874 first" in out and not changed() and not stored(), out)
c, out = run(no_old=True); ck("7 the first PDF is not stored live: stopped before any change", c != 0 and "first agreement PDF did not read back" in out and not changed() and not stored(), out)
c, out = run(no_key=True); ck("8 the server key can't be read: stopped before any change", c != 0 and not changed() and not stored(), out)
c, out = run(bad_store=True); ck("9 the stored PDF reads back different: stopped before the functions change", c == 6 and not changed(), out)
c, out = run(fail_deploy="agreement-sign"); ck("10 the second deploy fails: stopped, says which", c == 7 and "STOPPED at agreement-sign" in out and "RESULT: DONE" not in out, out)
shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
bad = [r for r in res if not r[1]]
for n, okk, d in res: print(("PASS " if okk else "FAIL ") + n + ("\n     " + d if d else ""))
print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
