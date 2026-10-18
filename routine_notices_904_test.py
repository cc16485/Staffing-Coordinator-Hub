#!/usr/bin/env python3
# Rehearsal of 904 (routine_notices_904.py): FAKE Supabase (management API, the read of who gets what, the doors) and a FAKE
# supabase CLI. Never touches GitHub or Supabase. Runs from a fresh copy of this folder's committed build.
#   python3 routine_notices_904_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
TMP = tempfile.mkdtemp(prefix="t904-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN); COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
subprocess.run(["git", "-C", COPY, "checkout", "-q", subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions"); sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in ("_shared/notice-to.ts", "_shared/clockin-admins.ts", "cc-booking/index.ts", "cc-feedback/index.ts", "cc-story/index.ts",
        "cc-corner/index.ts", "cc-417/index.ts", "campaign-auto/index.ts", "lead-intake/index.ts", "care-packet-watch/index.ts", "coverage-watch/index.ts", "coverage-run/index.ts", "staff-contacts-check/index.ts")}
FNS = ["cc-booking", "cc-feedback", "cc-story", "cc-corner", "cc-417", "campaign-auto", "lead-intake", "care-packet-watch", "coverage-watch", "coverage-run", "staff-contacts-check",
       "callin-alert", "care-notes", "clockin-alert", "coverage-assign", "coverage-reply", "late-alert", "late-watch", "lead-watch", "timekeeper-watch"]
GATES = {f: f not in ("cc-booking", "cc-feedback", "cc-story", "cc-corner", "cc-417", "lead-intake", "coverage-reply") for f in FNS}
M = {}; S = {}
WHO = {"areas": {"family_enquiries": "Krystal Land", "client_care": "Krystal Land", "scheduling_coverage": "Krystal Land"}, "lead": ["Krystal Land"], "alerts": ["samantha@mo-care.com", "krystal@mo-care.com"]}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if m := re.match(r"/v1/projects/zngsgedlsxinbygwmxwn/functions/([\w-]+)$", self.path):
            d = {}
            if os.path.exists(os.path.join(TMP, "deploys")):
                for ln in open(os.path.join(TMP, "deploys")).read().splitlines(): f, vj = json.loads(ln); d[f] = vj
            return self._send(200, {"verify_jwt": d.get(m.group(1), GATES[m.group(1)]), "version": 7})
        self._send(404, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"null")
        if self.path == "/v1/projects/zngsgedlsxinbygwmxwn/database/query":
            S.setdefault("sql", []).append(b["query"])
            if M.get("sql_fail"): return self._send(400, {"message": "nope"})
            return self._send(200, [{"who": M.get("who", WHO)}])
        if self.path.startswith("/functions/v1/"):
            fn = self.path.split("/")[3].split("?")[0]
            if M.get("open") == fn: return self._send(200, {"ok": True})
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
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="904", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=os.path.join(BIN, "supabase"),
               SB_FNROOT=FNROOT, SB_SHAS=json.dumps(shas), SB_MAIN_REF=main_ref, SB_NODE=shutil.which("node") or "")
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "routine_notices_904.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=900)
    d = [json.loads(l) for l in open(os.path.join(TMP, "deploys")).read().splitlines()] if os.path.exists(os.path.join(TMP, "deploys")) else []
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), d
c, out, d = run()
ck("1 good run: tests pass, the report says who gets what, all twenty pieces deploy with their gateway settings kept, proofs, DONE",
   c == 0 and "904: DONE" in out and "✗" not in out and d == [[f, GATES[f]] for f in FNS], (d, out[-1500:]))
ck("1b the report names who gets each notice, from the database", "website consult bookings: Krystal Land" in out and "417 Caring Community (with cards): Krystal Land" in out
   and "call-in alerts: samantha@mo-care.com, krystal@mo-care.com" in out, out)
ck("1c the only database call is the one read (no writes); no token in the report", len(S.get("sql", [])) == 1 and re.match(r"\s*select ", S["sql"][0]) and not re.search(r"\b(insert|update|delete|alter|drop)\b", S["sql"][0], re.I) and "sbp_test" not in out, S.get("sql"))
c, out, d = run(who={"areas": {}, "lead": [], "alerts": []})
ck("2 no owners and no lead yet: says Samantha still gets them and points at 897, still deploys", c == 0 and "Samantha (nobody else is set)" in out and "run 897 first" in out and len(d) == len(FNS), out)
c, out, d = run(shas={**SHAS, "_shared/notice-to.ts": "0" * 64})
ck("3 not the reviewed build: stops before anything", c == 2 and not d and not S.get("sql"), out)
# "not merged" = the commit before notice-to.ts arrived (the step commit itself adds no server files)
ADDED = subprocess.run(["git", "-C", COPY, "log", "--format=%H", "-n1", "--diff-filter=A", "--", "supabase/functions/_shared/notice-to.ts"], capture_output=True, text=True).stdout.strip()
c, out, d = run(main_ref=ADDED + "^")
ck("4 not merged yet: stops before anything", c == 2 and "merge the pull request first" in out and not d, out)
c, out, d = run(sql_fail=True)
ck("5 the read of who gets what fails: stops before any deploy", c == 3 and not d, out)
c, out, d = run(fail="cc-417")
ck("6 a piece fails to deploy: stops there", c == 5 and d == [[f, GATES[f]] for f in FNS[:4]], (d, out[-800:]))
c, out, d = run(open="coverage-watch")
ck("7 a piece answering a caller with no key is reported, not DONE", c == 1 and "NOT COMPLETE" in out and "coverage-watch answered a caller with no key" in out, out[-800:])
for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  904 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed")
shutil.rmtree(TMP, ignore_errors=True)
raise SystemExit(0 if all(r[1] for r in res) else 1)
