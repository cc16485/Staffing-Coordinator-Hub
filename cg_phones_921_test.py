#!/usr/bin/env python3
# Rehearsal of 921 (cg_phones_921.py): FAKE Supabase (management API, SQL, the door), a FAKE Hub site (serving the real Hub
# rules files from HUB_ROOT) and a FAKE supabase CLI. Never touches GitHub, Supabase or a real site. Runs from a fresh copy
# of this folder's committed build.
#   HUB_ROOT=<a copy of the Hub> python3 cg_phones_921_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
HUBR = os.environ.get("HUB_ROOT") or os.path.join(HERE, "..", "cc-hub-live")
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
TMP = tempfile.mkdtemp(prefix="t921-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN); COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
subprocess.run(["git", "-C", COPY, "checkout", "-q", subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions"); sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in ("_shared/cg-connect.ts", "_shared/axis-census.ts", "caregiver-connect/index.ts")}
M = {}; S = {}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj, raw=None, ctype="application/json"):
        b = raw.encode() if raw is not None else json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", ctype); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        for f in ("caregiver-connect-rules.js", "eligibility-rules.js"):
            if p.startswith("/" + f): return self._send(200, None, open(os.path.join(HUBR, f)).read(), "application/javascript")
        if "/api-keys" in p: return self._send(200, [{"name": "service_role", "api_key": "eyJsvcHUB"}])
        if p.endswith("/functions/caregiver-connect"):
            vj = True
            if os.path.exists(os.path.join(TMP, "deploys")): vj = json.loads(open(os.path.join(TMP, "deploys")).read().splitlines()[-1])[1]
            return self._send(200, {"verify_jwt": vj, "version": 4})
        self._send(404, {})
    def do_POST(self):
        p = self.path; n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"null")
        if p.endswith("/database/query"):
            q = b["query"]; S.setdefault("sql", []).append(q)
            if "cg_connect_live" in q: return self._send(201, [{"live": "false" if M.get("off") else "true"}])
            if "create or replace function public.caregiver_phone_fill" in q:
                if M.get("sql_fail"): return self._send(400, {"message": "syntax error"})
                S["done"] = True; return self._send(201, [])
            if "pg_proc" in q: return self._send(201, [{"fn": 1 if S.get("done") else 0, "staff": False, "col": 1 if S.get("done") else 0}])
            return self._send(201, [])
        if p.startswith("/functions/v1/caregiver-connect"):
            if (self.headers.get("Authorization") or "") == "Bearer eyJsvcHUB" and "dry=1" in p:
                if M.get("dry_bad"): return self._send(500, {"ok": False, "error": "the run stopped"})
                return self._send(200, {"ok": True, "dry": True, "phones_to_fill": 1, "no_phone": 2, "phones_to_fill_names": ["Ada Fillmore (AxisCare home phone)"], "no_phone_names": ["Cal Nobody", "Fay Newcomb"]})
            return self._send(200 if M.get("open") else 401, {"error": "not allowed"})
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
    M.clear(); M.update(m); S.clear()
    for f in ("deploys", "fail"):
        if os.path.exists(os.path.join(TMP, f)): os.remove(os.path.join(TMP, f))
    if fail: open(os.path.join(TMP, "fail"), "w").write("1")
    rep = os.path.join(TMP, "r.txt")
    env = dict(os.environ, SB_STEP="921", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_HUB_SITE=URL, SB_SUPA_CLI=os.path.join(BIN, "supabase"),
               SB_FNROOT=FNROOT, SB_SHAS=json.dumps(shas), SB_MAIN_REF=main_ref, SB_NODE=shutil.which("node") or "")
    env.pop("SUPABASE_ACCESS_TOKEN", None); env.pop("HUB_ROOT", None)
    p = subprocess.run(["python3", os.path.join(COPY, "cg_phones_921.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=600)
    d = [json.loads(l) for l in open(os.path.join(TMP, "deploys")).read().splitlines()] if os.path.exists(os.path.join(TMP, "deploys")) else []
    writes = [q for q in S.get("sql", []) if not re.match(r"\s*select ", q)]
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), d, writes
c, out, d, w = run()
ck("1 good run: tests with the Hub's live rules, the database, then the door with its gateway setting kept, proof, DONE", c == 0 and "921: DONE. From the next hourly run" in out and "✗" not in out
   and d == [["caregiver-connect", True]] and len(w) == 1 and "cg_connect_test.mjs:" in out, (d, out))
ck("1b the dry look names who gets a number and who has none; no key in the report", "Ada Fillmore (AxisCare home phone)" in out and "NO NUMBER ANYWHERE (2)" in out and "Fay Newcomb" in out
   and "eyJsvcHUB" not in out and "sbp_test" not in out, out)
c, out, d, w = run(off=True)
ck("2 caregiver connect is off: says nothing is filled until it is turned on", c == 0 and "Caregiver connect is OFF" in out, out)
c, out, d, w = run(shas={**SHAS, "_shared/cg-connect.ts": "0" * 64})
ck("3 not the reviewed build: stops before anything", c == 2 and not d and not w, out)
base = subprocess.run(["git", "-C", COPY, "log", "-1", "--format=%H", "--", "cg_phone_fill.sql"], capture_output=True, text=True).stdout.strip() + "^"
c, out, d, w = run(main_ref=base)
ck("4 not merged yet: stops before anything", c == 2 and "merge the pull request first" in out and not d and not w, out)
c, out, d, w = run(sql_fail=True)
ck("5 the database change refused: the door is not touched", c == 4 and not d, out)
c, out, d, w = run(fail=True)
ck("6 the door fails to deploy: stops there and says so", c == 5 and not d and len(w) == 1, (d, out))
c, out, d, w = run(open=True)
ck("7 the door answering a stranger is reported, not DONE", c == 1 and "NOT COMPLETE" in out, out)
c, out, d, w = run(dry_bad=True)
ck("8 the dry look failing is reported, not DONE", c == 1 and "NOT COMPLETE" in out, out)
for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  921 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed")
shutil.rmtree(TMP, ignore_errors=True)
raise SystemExit(0 if all(r[1] for r in res) else 1)
