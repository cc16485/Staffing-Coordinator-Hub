#!/usr/bin/env python3
# Rehearsal of 966 (agreement_book_966.py, the Booking App terms + "Can book in the app"): FAKE Supabase (management API,
# storage, the function doors, the database) and a FAKE supabase CLI. Never touches GitHub, Supabase or AxisCare.
# Runs from a fresh copy of this folder's committed build (her rule).
#   python3 agreement_book_966_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t966-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN)
COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
HEAD = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
BASE = subprocess.run(["git", "-C", HERE, "merge-base", "HEAD", "origin/main"], capture_output=True, text=True).stdout.strip()
FNROOT = os.path.join(COPY, "supabase", "functions")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
FN_FILES = ("client-agreement/index.ts", "agreement-sign/index.ts", "family-gateway/index.ts", "family-app-office/index.ts", "_shared/agreement-masters.ts",
            "_shared/client-agreement-map.ts", "_shared/client-agreement-map-2026-10-18.ts", "_shared/agreement-contacts.ts", "_shared/family-signin.ts", "_shared/family-app-office.ts")
PDFS = {n: os.path.join(COPY, "client-agreement", f"client-care-agreement-{n}.pdf") for n in ("rev-2026-10-18b", "rev-2026-10-18", "rev-2026-10-17", "rev-2026-10")}
PDF_SHA = sha(PDFS["rev-2026-10-18b"]); SQL_SHA = sha(os.path.join(COPY, "agreement_book_966.sql"))
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in FN_FILES}
STORE = {}; M = {}; CALLS = []; SQLS = []; UPSERTS = []
def reset(**m):
    M.clear(); M.update(dict(col_there=False, sql_fail=False, col_missing_after=False, fail_deploy=None, old_drafts=0, old_signed=0, no_old=False, bad_store=False, no_key=False, odd_live=None, no_contacts=False, new_there=False, doc='old', fail_docs=False,
                             gates={"client-agreement": False, "agreement-sign": False, "family-app-office": False, "family-gateway": False}), **m)
    STORE.clear(); CALLS.clear(); SQLS.clear(); UPSERTS.clear()
    for n in ("rev-2026-10-18", "rev-2026-10-17", "rev-2026-10"):
        if not (M["no_old"] and n == "rev-2026-10-18"): STORE[f"client-agreements/master/client-care-agreement-{n}.pdf"] = open(PDFS[n], "rb").read()
    if M["new_there"]: STORE["client-agreements/master/client-care-agreement-rev-2026-10-18b.pdf"] = open(PDFS["rev-2026-10-18b"], "rb").read()
    p = os.path.join(TMP, "deploys")
    if os.path.exists(p): os.remove(p)
    open(os.path.join(TMP, "mode.json"), "w").write(json.dumps(M))
def deployed():
    p = os.path.join(TMP, "deploys")
    return [json.loads(l) for l in open(p).read().splitlines()] if os.path.exists(p) else []
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def _raw(self, code, data): self.send_response(code); self.send_header("Content-Type", "application/pdf"); self.end_headers(); self.wfile.write(data)
    def do_OPTIONS(self): CALLS.append(("OPTIONS", self.path)); self._send(200, {})
    def do_GET(self):
        CALLS.append(("GET", self.path))
        if "/api-keys" in self.path: return self._send(200, [] if M["no_key"] else [{"name": "service_role", "api_key": "eyJfake"}])
        m = re.match(r"/storage/v1/object/authenticated/((?:client-agreements|agency-docs)/.+)$", self.path)
        if m: return self._raw(200, STORE[m.group(1)]) if m.group(1) in STORE else self._send(400, {"error": "not found"})
        m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", self.path)
        if m:
            d = [x for x in deployed() if x[0] == m.group(1)]
            return self._send(200, {"verify_jwt": (not d[-1][1]) if d else M["gates"].get(m.group(1), False), "version": 10 + len(d)})
        self._send(404, {})
    def do_PATCH(self): CALLS.append(("PATCH", self.path)); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n)
        m = re.match(r"/storage/v1/object/((?:client-agreements|agency-docs)/.+)$", self.path)
        if m:
            CALLS.append(("STORE", m.group(1)))
            if M["fail_docs"] and m.group(1).startswith("agency-docs/"): return self._send(500, {"error": "boom"})
            if m.group(1) in STORE: return self._send(400, {"error": "Duplicate", "message": "The resource already exists"})
            STORE[m.group(1)] = (raw[:-1] + b"x") if M["bad_store"] else raw; return self._send(200, {"Key": m.group(1)})
        b = json.loads(raw or b"null"); CALLS.append(("POST", self.path, b))
        if self.path.startswith("/functions/v1/agreement-sign"): return self._send(404, {"error": "This link does not work.", "outcome": "bad_link"})
        if self.path.startswith("/functions/v1/"): return self._send(401, {"error": "Sign in first."})
        if self.path.endswith("/database/query"):
            q = b["query"]; SQLS.append(q)
            if "as col_there" in q: return self._send(200, [{"contacts": not M["no_contacts"], "col_there": M["col_there"], "old_drafts": M["old_drafts"], "old_signed": M["old_signed"]}])
            if "add column if not exists app_book_choice" in q:
                if M["sql_fail"]: return self._send(400, {"message": "permission denied"})
                return self._send(200, [])
            if "as chosen" in q: return self._send(200, [{"col": not M["col_missing_after"], "chosen": 0}])
            if "e->>'id' in (" in q:
                old = {"id": OLD_DOC, "name": "Client Care Agreement (blank)", "cat": "Contract", "path": f"contract/{OLD_DOC}.pdf", "family": OLD_DOC}
                rows = {"old": [old], "none": [], "new": [old, {"id": NEW_DOC}], "replaced": [dict(old, replaced={"with": "x"})]}[M["doc"]]
                return self._send(200, [{"item": r} for r in rows])
            if "upsert_app_data_item('agency_docs'" in q: UPSERTS.append(q); return self._send(200, [{"n": 23}])
            if "filter (where" in q: return self._send(200, [{"cur": 1 if UPSERTS else 0, "old": 1 if len(UPSERTS) > 1 else 0}])
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
    dst = os.path.join(os.getcwd(), 'supabase', 'functions')
    shutil.copytree({FNROOT!r}, dst, dirs_exist_ok=True)
    if M.get('odd_live') == a[2]: open(os.path.join(dst, '_shared', 'family-signin.ts'), 'a').write('// someone else\\n')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(BIN, "supabase"), 0o755)
def run(shas=SHAS, sql_sha=SQL_SHA, main=HEAD, pdf_sha=None, **mode):
    pdf_sha = PDF_SHA if pdf_sha is None else pdf_sha
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="966", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_MAIN_REF=main, SB_BASE=BASE,
               SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas), SB_SQL_SHA=sql_sha, SB_PDF_SHA=pdf_sha)
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "agreement_book_966.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=900)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
stored = lambda: [x[1] for x in CALLS if x[0] == "STORE"]
ran_sql = lambda: any("add column if not exists app_book_choice" in q for q in SQLS)
NEWP = "client-agreements/master/client-care-agreement-rev-2026-10-18b.pdf"
OLD_DOC, NEW_DOC = "8e9636b4-5b3f-40f6-82cc-040f713947f8", "3c7d2e91-4b6a-4f0d-9e25-966b00c18b18"; DOCP = f"agency-docs/contract/{NEW_DOC}.pdf"
FNS = ["client-agreement", "agreement-sign", "family-app-office", "family-gateway"]

c, out = run()
ck("1 good run: the column added first, the PDF stored and read back, the four functions deployed with their gateway settings kept, proofs pass, DONE",
   c == 0 and "RESULT: DONE" in out and "✗" not in out and ran_sql() and stored() == [NEWP, DOCP] and deployed() == [[f, True] for f in FNS], out)
ck("1b the database change runs before any function is deployed (family-gateway reads the new column)", SQLS.index(next(q for q in SQLS if "add column" in q)) < len(SQLS) and out.index("booking choice column is there") < out.index("family-gateway deployed"), out)
ck("1c the earlier PDFs are never written again; the report says nothing was sent", not any(p not in (NEWP, DOCP) for p in stored()) and "Nothing was sent by this step" in out, out)
ck("1d Forms & Templates: the new blank agreement in the same family, then the 10-18 one marked replaced by it (the forms page's own way)", len(UPSERTS) == 2 and NEW_DOC in UPSERTS[0] and f'"family": "{OLD_DOC}"' in UPSERTS[0] and '"replaced"' in UPSERTS[1] and f'"with": "{NEW_DOC}"' in UPSERTS[1] and "listed as replaced" in out, UPSERTS)
c, out = run(doc="none"); ck("1e no blank agreement in Forms & Templates: nothing added there, the rest DONE", c == 0 and "RESULT: DONE" in out and not UPSERTS and DOCP not in stored(), out)
c, out = run(doc="replaced"); ck("1f the office already replaced it by hand: left alone, DONE", c == 0 and "RESULT: DONE" in out and not UPSERTS, out)
c, out = run(fail_docs=True); ck("1g the Forms & Templates copy fails: the agreement update is live, the report says only that part failed, no list entry", c == 8 and "only the Forms & Templates copy failed" in out and len(deployed()) == 4 and not UPSERTS, out)
c, out = run(col_there=True, new_there=True, doc="new"); ck("2 run a second time: the column is kept, the PDF is already there and checked, Forms & Templates kept, DONE", c == 0 and "RESULT: DONE" in out and "already there (kept)" in out and "already stored" in out and "already has the new blank agreement" in out and not UPSERTS, out)
c, out = run(old_drafts=2, old_signed=1); ck("3 agreements on the 10-18 wording are counted, with what to do", c == 0 and "not signed yet: 2 (after this step, tap Start another" in out and "waiting for the office: 1 (countersign as usual" in out, out)
c, out = run(shas=dict(SHAS, **{"_shared/family-signin.ts": "0" * 64})); ck("4 not the reviewed build: stopped before any change", c != 0 and not deployed() and not stored() and not ran_sql(), out)
c, out = run(pdf_sha="0" * 64); ck("5 the updated PDF is not the reviewed one: stopped before any change", c != 0 and not deployed() and not stored() and not ran_sql(), out)
c, out = run(sql_sha="0" * 64); ck("5b the database change is not the reviewed one: stopped before any change", c != 0 and not deployed() and not stored() and not ran_sql(), out)
c, out = run(main=BASE); ck("6 not merged to GitHub's main yet: stopped before any change", c != 0 and "merge the pull request first" in out and not deployed() and not stored() and not ran_sql(), out)
c, out = run(odd_live="family-gateway"); ck("7 the live family-gateway has someone else's unreleased code: stopped before any change", c != 0 and "someone else's change" in out and not deployed() and not ran_sql(), out)
c, out = run(no_old=True); ck("8 the 10-18 PDF is not stored live: stopped before any change", c != 0 and "10-18 agreement PDF did not read back" in out and not deployed() and not ran_sql(), out)
c, out = run(no_key=True); ck("9 the server key can't be read: stopped before any change", c != 0 and not deployed() and not stored() and not ran_sql(), out)
c, out = run(no_contacts=True); ck("9b the Family Circle table is missing: stopped before any change", c != 0 and not deployed() and not ran_sql(), out)
c, out = run(sql_fail=True); ck("10 the database refuses the change: stopped, nothing stored or deployed", c == 4 and not deployed() and not stored(), out)
c, out = run(col_missing_after=True); ck("10b the column does not read back: stopped before the PDF and functions", c == 4 and not deployed() and not stored(), out)
c, out = run(bad_store=True); ck("11 the stored PDF reads back different: stopped before the functions change", c == 6 and not deployed(), out)
c, out = run(fail_deploy="family-app-office"); ck("12 the third deploy fails: stopped, says which are left, family-gateway untouched", c == 7 and "still to deploy: family-app-office, family-gateway" in out and deployed() == [["client-agreement", True], ["agreement-sign", True]], out)
shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
bad = [r for r in res if not r[1]]
for n, okk, d in res: print(("PASS " if okk else "FAIL ") + n + ("\n     " + d if d else ""))
print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
