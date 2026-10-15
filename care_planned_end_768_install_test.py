#!/usr/bin/env python3
# Rehearsal of 768 (care_planned_end_768.py) against a FAKE Supabase (management API, database rules, functions) and a FAKE
# supabase CLI, from a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.
#   python3 care_planned_end_768_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_SHA = "6e230dcdd390bf5ad4001e614e2f386d6dc66ec9"   # origin/main before 768 (= the live client-journey, checked 2026-10-15)
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
OLD_K = "CHECK ((kind = ANY (ARRAY['pause'::text, 'extend'::text, 'resume'::text, 'end'::text, 'return'::text, 'end_date'::text])))"
OLD_N = "CHECK (((kind <> ALL (ARRAY['pause'::text, 'end'::text])) OR (reason IS NOT NULL)))"
NEW_K = "CHECK ((kind = ANY (ARRAY['pause'::text, 'extend'::text, 'resume'::text, 'end'::text, 'return'::text, 'end_date'::text, 'end_planned'::text, 'end_cancelled'::text])))"
NEW_N = "CHECK (((kind <> ALL (ARRAY['pause'::text, 'end'::text, 'end_planned'::text])) OR (reason IS NOT NULL)))"
S = {}; M = {}
def reset(**m): S.clear(); S.update(sql=[]); M.clear(); M.update(dict(rules="old", fail=False), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p): return self._send(200, {"version": 27, "verify_jwt": True})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        b = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"): return self._send(401, {"error": "Sign in first."})
        q = b["query"]; S["sql"].append(q)
        k, n = {"old": (OLD_K, OLD_N), "new": (NEW_K, NEW_N), "other": (OLD_K.replace("'end_date'::text", "'something'::text"), OLD_N)}[M["rules"]]
        if q.startswith("-- 768"):
            if M["fail"]: return self._send(400, {"message": "ERROR: injected"})
            M["rules"] = "new"; return self._send(200, [])
        if "conname in ('client_care_change_kind_check', 'ccc_end_needs_reason')" in q: return self._send(200, [{"conname": "client_care_change_kind_check", "d": k}, {"conname": "ccc_end_needs_reason", "d": n}])
        if "conname = 'client_care_change_kind_check'" in q: return self._send(200, [{"d": k}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t768-"); WT = os.path.join(TMP, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
BASE = os.path.join(TMP, "base"); os.makedirs(BASE)
subprocess.run(f"git -C {HERE} archive {BASE_SHA} supabase/functions | tar -x -C {BASE}", shell=True, check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log"); os.makedirs(os.path.join(TMP, "deployed"))
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']: open(os.path.join({TMP!r}, 'deployed', a[2]), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    mine = os.path.exists(os.path.join({TMP!r}, 'deployed', a[2])) or os.path.exists(os.path.join({TMP!r}, 'already'))
    src = os.path.join({WT!r} if mine else {BASE!r}, 'supabase', 'functions')
    for fn in ('client-journey', '_shared'): shutil.copytree(os.path.join(src, fn), os.path.join(os.getcwd(), 'supabase', 'functions', fn), dirs_exist_ok=True)
    if not mine and os.path.exists(os.path.join({TMP!r}, 'drift')):
        open(os.path.join(os.getcwd(), 'supabase', 'functions', 'client-journey', 'care.ts'), 'a').write('// someone else')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = {"client-journey": sha(os.path.join(WT, "supabase/functions/client-journey/index.ts")), "client-journey/care.ts": sha(os.path.join(WT, "supabase/functions/client-journey/care.ts"))}
SQLSHA = sha(os.path.join(WT, "client-journey/care-planned-end-768.sql"))
def run(env_over=None, drift=False, already=False, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    os.path.exists(LOG) and os.remove(LOG); os.path.exists(rep) and os.remove(rep)
    shutil.rmtree(os.path.join(TMP, "deployed")); os.makedirs(os.path.join(TMP, "deployed"))
    for flag, on in (("drift", drift), ("already", already)):
        fp = os.path.join(TMP, flag); (open(fp, "w").write("x") if on else (os.path.exists(fp) and os.remove(fp)))
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_REPO=WT, SB_BASE=BASE_SHA, SB_SHAS=json.dumps(PIN), SB_SQL_SHA=SQLSHA, SB_SETTLE="0")
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "care_planned_end_768.py")], env=env, capture_output=True, text=True, timeout=900)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
ran = lambda: any(q.startswith("-- 768") for q in S["sql"])
try:
    c, out = run()
    ck("clean run from a fresh copy: exit 0, RESULT: DONE", c == 0 and "RESULT: DONE" in out, out[-2000:])
    ck("...the rules change first, then client-journey is deployed once", ran() and deploys() == ["client-journey"], [deploys(), [q[:30] for q in S["sql"]]])
    ck("...the tests ran from the fresh copy first", "✓ care_test.mjs" in out and "✓ client_journey_test.mjs" in out, out[:1500])
    ck("...the proof: the live copy is the reviewed build, the rules allow a planned end, the public key is refused", "the live copy is exactly the reviewed build" in out and "allow a planned end" in out and "(401)" in out, out[-1200:])
    ck("...the report hides keys and emails", "eyJanonKEY" not in out and "sbp_test" not in out and "@" not in out)
    c, out = run(already=True, rules="new")
    ck("already installed: nothing deployed, the rules not re-run, DONE", c == 0 and not deploys() and not ran() and "RESULT: DONE" in out, out[-1200:])
    c, out = run(drift=True)
    ck("someone else's change on the live client-journey: STOP before any change", c == 3 and not deploys() and not ran() and "not what 768 expects" in out, out[-1200:])
    c, out = run(rules="other")
    ck("care change rules that are not the ones 768 replaces: STOP before any change", c == 3 and not deploys() and not ran(), out[-1200:])
    c, out = run(fail=True)
    ck("the database refuses the rules change: STOP, client-journey not deployed", c == 6 and not deploys() and "nothing in them was saved" in out, out[-1200:])
    c, out = run(env_over={"SB_SHAS": json.dumps({**PIN, "client-journey/care.ts": "0" * 64})})
    ck("a build that is not the reviewed one: STOP, nothing run", c == 2 and not deploys() and not S["sql"], out[-800:])
    c, out = run(env_over={"SB_SQL_SHA": "0" * 64})
    ck("a database file that is not the reviewed one: STOP, nothing run", c == 2 and not deploys() and not S["sql"], out[-800:])
    c, out = run(env_over={"SB_TOKEN": "x"})
    ck("no token: nothing run", c == 2 and not deploys() and not S["sql"], out[-400:])
    ck("no em dash in what she reads", "—" not in open(os.path.join(WT, "care_planned_end_768.py")).read())
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
f = 0
for n, ok, note in res: print(("  ✓ " if ok else "  ✗ ") + n + ("" if ok else "\n      " + note)); f += 0 if ok else 1
print(f"\n{len(res) - f}/{len(res)} passed"); raise SystemExit(1 if f else 0)
