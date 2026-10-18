#!/usr/bin/env python3
# Rehearsal of 937 (seat_fallbacks_937.py): FAKE Supabase (management API, the read of who holds a seat, the doors) and a FAKE
# supabase CLI. Never touches GitHub or Supabase. Runs from a fresh copy of this folder's committed build.
#   python3 seat_fallbacks_937_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
TMP = tempfile.mkdtemp(prefix="t937-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN); COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
subprocess.run(["git", "-C", COPY, "checkout", "-q", subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions"); sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in ("_shared/duty.ts", "_shared/notice-to.ts", "_shared/clockin-admins.ts", "work-route/index.ts", "timekeeper-watch/index.ts", "lead-watch/index.ts")}
FNS = ["work-route", "timekeeper-watch", "lead-watch"]
GATES = {"work-route": True, "timekeeper-watch": True, "lead-watch": False}
M = {}; S = {}
WHO = {"areas": {"family_enquiries": "Angiel Test", "scheduling_coverage": "Krystal Land"}, "lead": ["Krystal Land"], "alerts": [], "routing": False, "rungs": True, "in_charge": 2}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if m := re.match(r"/v1/projects/zngsgedlsxinbygwmxwn/functions/([\w-]+)$", self.path):
            if m.group(1) in M.get("gone", ()): return self._send(404, {"message": "Function not found"})
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
    env = dict(os.environ, SB_STEP="937", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=os.path.join(BIN, "supabase"),
               SB_FNROOT=FNROOT, SB_SHAS=json.dumps(shas), SB_MAIN_REF=main_ref, SB_NODE=shutil.which("node") or "")
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "seat_fallbacks_937.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=900)
    d = [json.loads(l) for l in open(os.path.join(TMP, "deploys")).read().splitlines()] if os.path.exists(os.path.join(TMP, "deploys")) else []
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), d
c, out, d = run()
ck("1 good run: tests pass, the report says who holds a seat, all three pieces deploy with their gateway settings kept, proofs, DONE",
   c == 0 and "937: DONE" in out and "✗" not in out and d == [[f, GATES[f]] for f in FNS], (d, out[-1500:]))
ck("1b the report names who holds a seat nobody is scheduled in, from the database, and the switches",
   "missed clock-in texts: Krystal Land" in out and "uncalled new family rungs: Angiel Test" in out and "In charge windows on the duty schedule: 2" in out
   and "routing switch (work-route, missed clock-in ladder): off" in out and "new family rungs switch (lead-watch): ON" in out, out)
ck("1c the only database call is the one read (no writes); no token in the report", len(S.get("sql", [])) == 1 and re.match(r"\s*select ", S["sql"][0]) and not re.search(r"\b(insert|update|delete|alter|drop)\b", S["sql"][0], re.I) and "sbp_test" not in out, S.get("sql"))
c, out, d = run(who={**WHO, "alerts": ["samantha@mo-care.com"]})
ck("1d an alert list set on the Admin page still comes first, and the report says so", c == 0 and "the alert list on the Admin page is set, so its first person: samantha@mo-care.com" in out, out)
c, out, d = run(who={"areas": {}, "lead": [], "alerts": [], "in_charge": 0})
ck("2 no owners, no lead, no In charge windows: says Samantha still holds them, points at 897 and the duty schedule, still deploys",
   c == 0 and "Samantha (nobody else is set)" in out and "run 897 first" in out and "set them in the Hub" in out and len(d) == len(FNS), out)
c, out, d = run(shas={**SHAS, "_shared/duty.ts": "0" * 64})
ck("3 not the reviewed build: stops before anything", c == 2 and not d and not S.get("sql"), out)
# "not merged" = the commit before this change (ADMIN_DEFAULT still in clockin-admins.ts on that main)
BEFORE = subprocess.run(["git", "-C", COPY, "log", "--format=%H", "-n1", "-S", "ADMIN_DEFAULT", "--", "supabase/functions/_shared/clockin-admins.ts"], capture_output=True, text=True).stdout.strip()
c, out, d = run(main_ref=BEFORE + "^")
ck("4 not merged yet: stops before anything", c == 2 and "merge the pull request first" in out and not d, out)
c, out, d = run(sql_fail=True)
ck("5 the read of who holds a seat fails: stops before any deploy", c == 3 and not d, out)
c, out, d = run(fail="timekeeper-watch")
ck("6 a piece fails to deploy: stops there", c == 5 and d == [[f, GATES[f]] for f in FNS[:1]], (d, out[-800:]))
c, out, d = run(open="lead-watch")
ck("7 a piece answering a caller with no key is reported, not DONE", c == 1 and "NOT COMPLETE" in out and "lead-watch answered a caller with no key" in out, out[-800:])
c, out, d = run(gone=("work-route",))
ck("8 a piece that is not live is left off: not deployed, not proved, the rest go in, DONE",
   c == 0 and "937: DONE" in out and "work-route is not live, so it is left off" in out and d == [[f, GATES[f]] for f in FNS if f != "work-route"]
   and "work-route: a caller" not in out, (d, out[-1200:]))
ck("9 no em dash in the step or its report", "\u2014" not in open(os.path.join(COPY, "seat_fallbacks_937.py")).read() and "\u2014" not in out)
for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  937 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed")
shutil.rmtree(TMP, ignore_errors=True)
raise SystemExit(0 if all(r[1] for r in res) else 1)
