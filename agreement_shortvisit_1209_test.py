#!/usr/bin/env python3
# Rehearsal of 1209 (agreement_shortvisit_1209.py, an approved visit under 4 hours is a flat $5.00 more per hour): FAKE Supabase (management API,
# storage, the function doors, the database) and a FAKE supabase CLI. Never touches GitHub, Supabase or AxisCare.
# Runs from a fresh copy of this folder's committed build (her rule).
#   python3 agreement_shortvisit_1209_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t1209-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN)
COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
HEAD = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
BASE = "70b35e9f3834e0e54ccaeb3951fbfd3a1968952f"   # main when 1209 was built (its SB_BASE)
FNROOT = os.path.join(COPY, "supabase", "functions")
# an older version of a shared file that was on main (agreement-prefill.ts before 1726eb7), as a function deployed before that change holds it
open(os.path.join(COPY, "old_prefill.ts"), "w").write(subprocess.run(["git", "-C", HERE, "show", "1726eb7^:supabase/functions/_shared/agreement-prefill.ts"], capture_output=True, text=True).stdout)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
FN_FILES = ("client-agreement/index.ts", "agreement-sign/index.ts", "_shared/agreement-masters.ts", "_shared/client-agreement-map.ts", "_shared/client-agreement-map-2026-10-18b.ts",
            "_shared/client-agreement-map-2026-10-18.ts", "_shared/client-agreement-map-2026-10-17.ts", "_shared/client-agreement-map-2026-10-16.ts", "_shared/agreement-pdf.ts", "_shared/client-agreement.ts")
PDFS = {n: os.path.join(COPY, "client-agreement", f"client-care-agreement-{n}.pdf") for n in ("rev-2026-10-30", "rev-2026-10-18b", "rev-2026-10-18", "rev-2026-10-17", "rev-2026-10")}
PDF_SHA = sha(PDFS["rev-2026-10-30"]); SQL_SHA = "unused"
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in FN_FILES}
STORE = {}; M = {}; CALLS = []; SQLS = []; UPSERTS = []
def reset(**m):
    M.clear(); M.update(dict(fail_deploy=None, old_drafts=0, old_signed=0, no_old=False, bad_store=False, no_key=False, odd_live=None, no_table=False, new_there=False, older_live=None, doc='old', fail_docs=False,
                             gates={"client-agreement": False, "agreement-sign": False}), **m)
    STORE.clear(); CALLS.clear(); SQLS.clear(); UPSERTS.clear()
    for n in ("rev-2026-10-18b", "rev-2026-10-18", "rev-2026-10-17", "rev-2026-10"):
        if not (M["no_old"] and n == "rev-2026-10-18b"): STORE[f"client-agreements/master/client-care-agreement-{n}.pdf"] = open(PDFS[n], "rb").read()
    if M["new_there"]: STORE["client-agreements/master/client-care-agreement-rev-2026-10-30.pdf"] = open(PDFS["rev-2026-10-30"], "rb").read()
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
            if "as agreements" in q: return self._send(200, [{"agreements": not M["no_table"], "upsert": True, "old_drafts": M["old_drafts"], "old_signed": M["old_signed"]}])
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
    if M.get('odd_live') == a[2]: open(os.path.join(dst, '_shared', 'agreement-contacts.ts'), 'a').write('// someone else\\n')
    if M.get('older_live') == a[2] and not (os.path.exists({os.path.join(TMP, 'deploys')!r}) and a[2] in open({os.path.join(TMP, 'deploys')!r}).read()): shutil.copy({os.path.join(COPY, 'old_prefill.ts')!r}, os.path.join(dst, '_shared', 'agreement-prefill.ts'))
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(BIN, "supabase"), 0o755)
def run(shas=SHAS, sql_sha=SQL_SHA, main=HEAD, pdf_sha=None, **mode):
    pdf_sha = PDF_SHA if pdf_sha is None else pdf_sha
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="1209", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_MAIN_REF=main, SB_BASE=BASE,
               SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas), SB_SQL_SHA=sql_sha, SB_PDF_SHA=pdf_sha)
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "agreement_shortvisit_1209.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=900)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
stored = lambda: [x[1] for x in CALLS if x[0] == "STORE"]
writes = lambda: [q for q in SQLS if re.search(r"\\b(update|delete|insert|alter|create|drop)\\b", q, re.I)]
NEWP = "client-agreements/master/client-care-agreement-rev-2026-10-30.pdf"
OLD_DOC, NEW_DOC = "3c7d2e91-4b6a-4f0d-9e25-966b00c18b18", "5a1e0c30-7d2b-4c9e-8f14-1209b0c30a30"; DOCP = f"agency-docs/contract/{NEW_DOC}.pdf"
FNS = ["client-agreement", "agreement-sign"]

c, out = run()
ck("1 good run: the PDF stored and read back, the two agreement functions deployed with their gateway settings kept, proofs pass, DONE",
   c == 0 and "RESULT: DONE" in out and "✗" not in out and stored() == [NEWP, DOCP] and deployed() == [[f, True] for f in FNS], out)
ck("1b no database table changes: the only writes are the two Forms & Templates list saves", not writes() and len(UPSERTS) == 2, SQLS)
ck("1c the earlier PDFs are never written again; the report says nothing was sent", not any(p not in (NEWP, DOCP) for p in stored()) and "Nothing was sent by this step" in out, out)
ck("1d Forms & Templates: the new blank agreement in the same family, then the 10-18b one marked replaced by it (the forms page's own way)", len(UPSERTS) == 2 and NEW_DOC in UPSERTS[0] and f'"family": "{OLD_DOC}"' in UPSERTS[0] and '"replaced"' in UPSERTS[1] and NEW_DOC in UPSERTS[1] and STORE[DOCP] == open(PDFS["rev-2026-10-30"], "rb").read(), UPSERTS)
c, out = run(doc="none"); ck("1e no blank agreement in Forms & Templates: nothing added there, the rest DONE", c == 0 and "RESULT: DONE" in out and not UPSERTS and DOCP not in stored(), out)
c, out = run(doc="replaced"); ck("1f the office already replaced it by hand: left alone, DONE", c == 0 and "RESULT: DONE" in out and not UPSERTS, out)
c, out = run(fail_docs=True); ck("1g the Forms & Templates copy fails: the agreement update is live, the report says only that part failed, no list entry", c == 8 and "only the Forms & Templates copy failed" in out and len(deployed()) == 2 and not UPSERTS, out)
c, out = run(new_there=True, doc="new"); ck("2 run a second time: the PDF is already there and checked, Forms & Templates kept, DONE", c == 0 and "RESULT: DONE" in out and "already stored" in out and not UPSERTS, out)
c, out = run(old_drafts=2, old_signed=1); ck("3 agreements on the 10-18b wording are counted, with what to do", c == 0 and "not signed yet: 2 (after this step, tap Start another" in out and "waiting for the office: 1 (countersign as usual" in out, out)
c, out = run(shas=dict(SHAS, **{"_shared/agreement-masters.ts": "0" * 64})); ck("4 not the reviewed build: stopped before any change", c != 0 and not deployed() and not stored(), out)
c, out = run(pdf_sha="0" * 64); ck("5 the updated PDF is not the reviewed one: stopped before any change", c != 0 and not deployed() and not stored(), out)
c, out = run(main=BASE); ck("6 not merged to GitHub's main yet: stopped before any change", c != 0 and "merge the pull request first" in out and not deployed() and not stored(), out)
c, out = run(odd_live="client-agreement"); ck("7 the live client-agreement has someone else's unreleased code: stopped before any change", c != 0 and "someone else's unreleased change" in out and not deployed() and not stored(), out)
c, out = run(older_live="client-agreement"); ck("7b the live client-agreement holds an OLDER merged agreement-prefill.ts: goes ahead and says it brings that forward", c == 0 and "RESULT: DONE" in out and "brings forward already-merged updates to agreement-prefill.ts" in out and len(deployed()) == 2, out)
c, out = run(no_old=True); ck("8 the 10-18b PDF is not stored live: stopped before any change", c != 0 and "10-18b agreement PDF did not read back" in out and not deployed() and not stored(), out)
c, out = run(no_key=True); ck("9 the server key can't be read: stopped before any change", c != 0 and not deployed() and not stored(), out)
c, out = run(no_table=True); ck("9b the agreement table is missing: stopped before any change", c != 0 and not deployed() and not stored(), out)
c, out = run(bad_store=True); ck("11 the stored PDF reads back different: stopped before the functions change", c == 6 and not deployed(), out)
c, out = run(fail_deploy="agreement-sign"); ck("12 the second deploy fails: stopped, says which is left, Forms & Templates untouched", c == 7 and "still to deploy: agreement-sign" in out and deployed() == [["client-agreement", True]] and not UPSERTS, out)
shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
bad = [r for r in res if not r[1]]
for n, okk, d in res: print(("PASS " if okk else "FAIL ") + n + ("\n     " + d if d else ""))
print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
