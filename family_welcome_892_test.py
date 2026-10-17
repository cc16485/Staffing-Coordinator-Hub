#!/usr/bin/env python3
# Rehearsal of 892 (family_welcome_892.py): FAKE Supabase (management API, SQL, the doors), a FAKE Hub site and a FAKE supabase
# CLI. Never touches GitHub, Supabase or a real site. Runs from a fresh copy of this folder's committed build.
#   python3 family_welcome_892_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
TMP = tempfile.mkdtemp(prefix="t892-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN); COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
subprocess.run(["git", "-C", COPY, "checkout", "-q", subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions"); sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in ("_shared/family-app-office.ts", "_shared/family-welcome-alert.ts", "_shared/family-offer-db.ts", "family-app-office/index.ts", "family-offer/index.ts", "client-journey/index.ts")}
M = {}; S = {}
GATES = {"family-app-office": True, "family-offer": False, "client-journey": True}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj, raw=None, ctype="application/json"):
        b = raw.encode() if raw is not None else json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", ctype); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if p.startswith("/family-app-panel.js"): return self._send(200, None, "window.FAMAPP = { welcomeSkip: welcomeSkip }" if M.get("panel", True) else "window.FAMAPP = {}", "application/javascript")
        if "/api-keys" in p: return self._send(200, [{"name": "service_role", "api_key": "eyJsvcHUB"}])
        if m := re.match(r"/v1/projects/zngsgedlsxinbygwmxwn/functions/([\w-]+)$", p):
            d = {}
            if os.path.exists(os.path.join(TMP, "deploys")):
                for ln in open(os.path.join(TMP, "deploys")).read().splitlines(): f, vj = json.loads(ln); d[f] = vj
            return self._send(200, {"verify_jwt": d.get(m.group(1), GATES[m.group(1)]), "version": 3})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        p = self.path; n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"null")
        if p.endswith("/database/query"):
            q = b["query"]; S.setdefault("sql", []).append(q)
            if "begin;" in q and "welcome_ready_at" in q:
                if M.get("sql_fail"): return self._send(400, {"message": "syntax error"})
                S["done"] = True; return self._send(201, [])
            if "information_schema.columns" in q: return self._send(200, [{"cc": 8 if S.get("done") else 0, "k": 3 if S.get("done") else 0, "live": "true" if S.get("done") else None, "skip": ["55", "220"]}])
            return self._send(201, [])
        if p.startswith("/functions/v1/family-app-office"): return self._send(401, {"error": "x"})
        if p.startswith("/functions/v1/client-journey"): return self._send(401 if M.get("cj_401", True) else 200, {"error": "x"})
        if p.startswith("/functions/v1/family-offer"):
            if (self.headers.get("Authorization") or "") == "Bearer eyJsvcHUB" and "dry=1" in p: return self._send(200, {"ok": True, "sync": {"checked": 0}, "welcome": {"error": "boom"} if M.get("wel_err") else {"ready": 21, "waiting": 21}})
            return self._send(401, {"error": "x"})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
open(os.path.join(BIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, json, os, shutil
a = sys.argv[1:]
if os.environ.get('SUPABASE_ACCESS_TOKEN') != 'sbp_test': sys.exit(1)
if a[:2] == ['functions', 'deploy']:
    if os.path.exists({os.path.join(TMP, 'fail')!r}) and open({os.path.join(TMP, 'fail')!r}).read() == a[2]: sys.exit(1)
    open({os.path.join(TMP, 'deploys')!r}, 'a').write(json.dumps([a[2], '--no-verify-jwt' not in a]) + '\\n'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree({FNROOT!r}, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(BIN, "supabase"), 0o755)
def run(shas=SHAS, main_ref="HEAD", fail=None, **m):
    M.clear(); M.update(m); S.clear()
    for f in ("deploys", "fail"):
        if os.path.exists(os.path.join(TMP, f)): os.remove(os.path.join(TMP, f))
    if fail: open(os.path.join(TMP, "fail"), "w").write(fail)
    rep = os.path.join(TMP, "r.txt")
    env = dict(os.environ, SB_STEP="892", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_HUB_SITE=URL, SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_SHAS=json.dumps(shas), SB_MAIN_REF=main_ref, SB_NODE=shutil.which("node") or "",
               PGLITE=os.environ.get("PGLITE", ""))
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "family_welcome_892.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=600)
    d = [json.loads(l) for l in open(os.path.join(TMP, "deploys")).read().splitlines()] if os.path.exists(os.path.join(TMP, "deploys")) else []
    writes = [q for q in S.get("sql", []) if not re.match(r"\s*select ", q)]
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), d, writes
c, out, d, w = run()
ck("1 good run: database, then the three doors with their gateway settings kept, proofs, DONE", c == 0 and "892: DONE" in out and "✗" not in out and d == [["family-app-office", True], ["family-offer", False], ["client-journey", True]] and len(w) == 1, (d, out))
ck("1b the dry run's count is reported; no key in the report", "21 family member(s) ready for a welcome, 21 not sent yet" in out and "eyJsvcHUB" not in out and "sbp_test" not in out, out)
c, out, d, w = run(panel=False)
ck("2 the Hub screen isn't live yet: stops before anything", c == 2 and "isn't live yet" in out and not d and not w, out)
c, out, d, w = run(shas={**SHAS, "_shared/family-app-office.ts": "0" * 64})
ck("3 not the reviewed build: stops before anything", c == 2 and not d and not w, out)
c, out, d, w = run(main_ref="HEAD~2")
ck("4 not merged yet: stops before anything", c == 2 and "merge the pull request first" in out and not d and not w, out)
c, out, d, w = run(sql_fail=True)
ck("5 the database change refused: no door touched", c == 4 and not d, out)
c, out, d, w = run(fail="family-offer")
ck("6 a door fails: stops there", c == 5 and d == [["family-app-office", True]], (d, out))
c, out, d, w = run(cj_401=False)
ck("7 a door answering a stranger is reported, not DONE", c == 1 and "NOT COMPLETE" in out, out)
c, out, d, w = run(wel_err=True)
ck("8 the reminder failing in the dry run is reported, not DONE", c == 1 and "NOT COMPLETE" in out, out)
for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  892 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed")
shutil.rmtree(TMP, ignore_errors=True)
raise SystemExit(0 if all(r[1] for r in res) else 1)
