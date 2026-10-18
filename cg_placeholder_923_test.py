#!/usr/bin/env python3
# Rehearsal of 923 (cg_placeholder_923.py): FAKE Supabase (management API, SQL, the door), a FAKE Hub site (serving the real Hub
# rules files from HUB_ROOT) and a FAKE supabase CLI. Never touches GitHub, Supabase or a real site. Runs from a fresh copy
# of this folder's committed build.
#   HUB_ROOT=<a copy of the Hub> python3 cg_placeholder_923_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
HUBR = os.environ.get("HUB_ROOT") or os.path.join(HERE, "..", "cc-hub-live")
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
TMP = tempfile.mkdtemp(prefix="t923-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN); COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
subprocess.run(["git", "-C", COPY, "checkout", "-q", subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions"); sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in ("_shared/cg-placeholder.ts", "_shared/cg-connect.ts", "family-offer/index.ts", "pilot-readiness/index.ts")}
GATES = {"caregiver-connect": True, "family-offer": False}
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
        if m := re.search(r"/functions/(caregiver-connect|family-offer)$", p):
            d = {}
            if os.path.exists(os.path.join(TMP, "deploys")):
                for ln in open(os.path.join(TMP, "deploys")).read().splitlines(): f, vj = json.loads(ln); d[f] = vj
            return self._send(200, {"verify_jwt": d.get(m.group(1), GATES[m.group(1)]), "version": 4})
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
        if p.startswith("/functions/v1/family-offer"): return self._send(200 if M.get("open") == "family-offer" else 401, {"error": "x"})
        if p.startswith("/functions/v1/caregiver-connect"):
            if (self.headers.get("Authorization") or "") == "Bearer eyJsvcHUB" and "dry=1" in p:
                if M.get("dry_bad"): return self._send(500, {"ok": False, "error": "the run stopped"})
                return self._send(200, {"ok": True, "dry": True, "phones_to_fill": 0, "no_phone": 1, "phones_to_fill_names": [], "no_phone_names": ["Cal Nobody"] + (["Canceled Shift"] if M.get("still") else [])})
            return self._send(200 if M.get("open") == "caregiver-connect" else 401, {"error": "not allowed"})
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
    env = dict(os.environ, SB_STEP="923", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_HUB_SITE=URL, SB_SUPA_CLI=os.path.join(BIN, "supabase"),
               SB_FNROOT=FNROOT, SB_SHAS=json.dumps(shas), SB_MAIN_REF=main_ref, SB_NODE=shutil.which("node") or "")
    env.pop("SUPABASE_ACCESS_TOKEN", None); env.pop("HUB_ROOT", None)
    p = subprocess.run(["python3", os.path.join(COPY, "cg_placeholder_923.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=600)
    d = [json.loads(l) for l in open(os.path.join(TMP, "deploys")).read().splitlines()] if os.path.exists(os.path.join(TMP, "deploys")) else []
    writes = [q for q in S.get("sql", []) if not re.match(r"\s*select ", q)]
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), d, writes
c, out, d, w = run()
ck("1 good run: tests, both doors with their gateway settings kept, proof, DONE; no database change", c == 0 and "923: DONE" in out and "✗" not in out
   and d == [["caregiver-connect", True], ["family-offer", False]] and not w and "cg_placeholder_test.mjs:" in out, (d, out))
ck("1b the dry look's list, without Canceled Shift; no key in the report", "NO NUMBER ANYWHERE (1)" in out and "Cal Nobody" in out and "Canceled Shift is not on the list" in out
   and "eyJsvcHUB" not in out and "sbp_test" not in out, out)
c, out, d, w = run(still=True)
ck("2 Canceled Shift still on the list: reported, not DONE", c == 1 and "Canceled Shift is still on the list" in out, out)
c, out, d, w = run(shas={**SHAS, "_shared/cg-placeholder.ts": "0" * 64})
ck("3 not the reviewed build: stops before anything", c == 2 and not d, out)
base = subprocess.run(["git", "-C", COPY, "log", "-1", "--format=%H", "--", "supabase/functions/_shared/cg-placeholder.ts"], capture_output=True, text=True).stdout.strip() + "^"
c, out, d, w = run(main_ref=base)
ck("4 not merged yet: stops before anything", c == 2 and "merge the pull request first" in out and not d, out)
c, out, d, w = run(fail="family-offer")
ck("5 a door fails: stops there", c == 5 and d == [["caregiver-connect", True]], (d, out))
c, out, d, w = run(open="family-offer")
ck("6 a door answering a stranger is reported, not DONE", c == 1 and "family-offer answered a stranger" in out, out)
for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  923 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed")
shutil.rmtree(TMP, ignore_errors=True)
raise SystemExit(0 if all(r[1] for r in res) else 1)
