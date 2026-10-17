#!/usr/bin/env python3
# Rehearsal of 871 (client_agreement_871.py): FAKE Supabase (management API, storage, the function's door) and a FAKE supabase
# CLI. Never touches GitHub or Supabase. Runs from a fresh copy of this folder's committed build (her rule).
#   python3 client_agreement_871_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t871-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN)
COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
subprocess.run(["git", "-C", COPY, "checkout", "-q", subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
FN_FILES = ("client-agreement/index.ts", "_shared/client-agreement.ts", "_shared/client-agreement-map.ts", "_shared/agreement-pdf.ts", "_shared/staff-auth.ts", "_shared/doc-log.ts")
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in FN_FILES}
SQL_SHA = sha(os.path.join(COPY, "client_agreement_871.sql"))
PDF = os.path.join(COPY, "client-agreement", "client-care-agreement-rev-2026-10.pdf"); PDF_SHA = sha(PDF)
M = {}; CALLS = []; STORE = {}
def reset(**m):
    M.clear(); M.update(dict(there=False, fail_deploy=False, key=True, store_status=None, preloaded=None), **m); CALLS.clear(); STORE.clear()
    if M["preloaded"] is not None: STORE["master/client-care-agreement-rev-2026-10.pdf"] = M["preloaded"]
    p = os.path.join(TMP, "deploys")
    if os.path.exists(p): os.remove(p)
    open(os.path.join(TMP, "mode.json"), "w").write(json.dumps({k: v for k, v in M.items() if k != "preloaded"}))
def deployed():
    p = os.path.join(TMP, "deploys")
    return [json.loads(l) for l in open(p).read().splitlines()] if os.path.exists(p) else []
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj, raw=None):
        b = raw if raw is not None else json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self): CALLS.append(("OPTIONS", self.path)); self._send(200, {})
    def do_GET(self):
        CALLS.append(("GET", self.path))
        if re.match(r"/v1/projects/\w+/functions/client-agreement$", self.path):
            d = deployed(); return self._send(200, {"verify_jwt": not d[-1][1], "version": len(d)}) if d else self._send(404, {})
        if "/api-keys" in self.path:
            return self._send(200, [{"name": "anon", "api_key": "eyJanon"}] + ([{"name": "service_role", "api_key": "eyJservicefake"}] if M["key"] else []))
        if m := re.match(r"/storage/v1/object/authenticated/client-agreements/(.+)$", self.path):
            if self.headers.get("Authorization") != "Bearer eyJservicefake": return self._send(401, {})
            return self._send(200, None, STORE[m.group(1)]) if m.group(1) in STORE else self._send(404, {})
        self._send(404, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n)
        if m := re.match(r"/storage/v1/object/client-agreements/(.+)$", self.path):
            CALLS.append(("UPLOAD", m.group(1), self.headers.get("x-upsert"), self.headers.get("Authorization")))
            if M["store_status"]: return self._send(M["store_status"], {"message": "boom"})
            if m.group(1) in STORE: return self._send(400, {"statusCode": "409", "error": "Duplicate", "message": "The resource already exists"})
            STORE[m.group(1)] = raw; return self._send(200, {"Key": "client-agreements/" + m.group(1)})
        b = json.loads(raw or b"null"); CALLS.append(("POST", self.path, b))
        if self.path.startswith("/functions/v1/client-agreement"): return self._send(401, {"error": "Sign in first."})
        if self.path.endswith("/database/query"):
            q = b["query"]
            if "to_regclass('public.client_agreements') is not null as there" in q: return self._send(200, [{"there": M["there"]}])
            if "create table if not exists public.client_agreements" in q: M["migrated"] = True; return self._send(200, [])
            if "browser_can_touch" in q: return self._send(200, [{"agreements": 0, "rls": True, "browser_can_touch": False, "bucket_public": False, "keeps_files": True}])
            return self._send(400, {"message": "unexpected query: " + q[:80]})
        self._send(404, {})
    def do_PATCH(self): CALLS.append(("PATCH", self.path)); self._send(200, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
open(os.path.join(BIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, json, os, shutil
a = sys.argv[1:]; M = json.load(open({os.path.join(TMP, 'mode.json')!r}))
if os.environ.get('SUPABASE_ACCESS_TOKEN') != 'sbp_test': sys.exit(1)
if a[:2] == ['functions', 'deploy']:
    if M.get('fail_deploy'): print('deploy failed: boom', file=sys.stderr); sys.exit(1)
    open({os.path.join(TMP, 'deploys')!r}, 'a').write(json.dumps([a[2], '--no-verify-jwt' in a]) + '\\n'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree({FNROOT!r}, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(BIN, "supabase"), 0o755)
def run(shas=SHAS, sql_sha=SQL_SHA, pdf_sha=PDF_SHA, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="871", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas), SB_SQL_SHA=sql_sha, SB_PDF_SHA=pdf_sha)
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "client_agreement_871.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
db_changes = lambda: [x for x in CALLS if x[0] == "POST" and x[1].endswith("/database/query") and "create table" in x[2]["query"]]
uploads = lambda: [x for x in CALLS if x[0] == "UPLOAD"]

c, out = run()
ck("1 good run: table, master PDF and function in, proofs pass, DONE", c == 0 and "871 · " in out and "RESULT: DONE" in out and "✗" not in out, out)
ck("1b the function is deployed once, with the gateway check off (it checks the Hub sign-in itself)", deployed() == [["client-agreement", True]], deployed())
ck("1c the master PDF is uploaded once, never overwriting (x-upsert false), with the server key", len(uploads()) == 1 and uploads()[0][2] == "false" and uploads()[0][3] == "Bearer eyJservicefake", uploads())
ck("1d the stored master is byte for byte the reviewed file", hashlib.sha256(STORE["master/client-care-agreement-rev-2026-10.pdf"]).hexdigest() == PDF_SHA)
ck("1e the server key never appears in the report", "eyJservicefake" not in out, out)
c, out = run(sql_sha="0" * 64)
ck("2 the SQL is not the reviewed build: stopped before any change", c == 3 and not db_changes() and not uploads() and not deployed(), out)
c, out = run(pdf_sha="0" * 64)
ck("3 the master PDF is not the reviewed one: stopped before any change", c == 3 and not db_changes() and not uploads() and not deployed(), out)
c, out = run(shas=dict(SHAS, **{"client-agreement/index.ts": "0" * 64}))
ck("4 the function is not the reviewed build: stopped before any change", c != 0 and not db_changes() and not deployed(), out)
c, out = run(there=True)
ck("5 already installed: stopped before any change", c == 3 and "already there" in out and not db_changes(), out)
c, out = run(key=False)
ck("6 the server key cannot be read: stopped before any change", c == 3 and not db_changes() and not uploads(), out)
c, out = run(store_status=500)
ck("7 the master PDF cannot be stored: stopped, function not deployed", c == 6 and db_changes() and not deployed(), out)
c, out = run(preloaded=open(PDF, "rb").read())
ck("8 the master PDF was stored before (same file): carries on and proves it", c == 0 and "already stored" in out and "reads back byte for byte" in out, out)
c, out = run(preloaded=b"%PDF-not-the-same")
ck("9 a DIFFERENT file already sits where the master goes: the proof catches it", c == 9 and "does not read back" in out, out)
c, out = run(fail_deploy=True)
ck("10 the deploy fails: stopped with a clear line, nothing claimed", c == 7 and "did not deploy cleanly" in out and "RESULT: DONE" not in out, out)
shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
bad = [r for r in res if not r[1]]
for n, ok, d in res: print(("PASS " if ok else "FAIL ") + n + ("\n     " + d if d else ""))
print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
