#!/usr/bin/env python3
# Rehearsal of 750 (one_step_a_750.py) against a FAKE Supabase (management API, database, functions) and a FAKE supabase
# CLI, from a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.
#   python3 one_step_a_750_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_SHA = "2da75486c5a96ee731e54607f1ac26f4233f3751"   # origin/main before 750
OLDER_RULES = "32bae20"                                  # an earlier lead-rules.js some live functions may still carry
FNS = ["client-journey", "call-disposition", "cc-booking", "lead-intake", "lead-followup", "lead-watch"]
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; M = {}
norm = lambda t: re.sub(r"\s+", " ", t or "").strip()
def body(path):
    t = open(path).read(); a = t.index("$f$", t.index("create or replace function public.care_began_for_episode")) + 3
    return t[a:t.index("end $f$", a)] + "end "
def reset(**m):
    S.clear(); S.update(sql=[], posts=[]); M.clear(); M.update(dict(rule="old", seats=2, gate=401), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if p.endswith("/secrets"): return self._send(200, [])
        if re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p): return self._send(200, {"version": 9, "verify_jwt": not p.endswith("/lead-intake")})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"): S["posts"].append(p); return self._send(M["gate"], {"error": "Sign in first."})
        q = b["query"]; S["sql"].append(q)
        src = {"old": M["OLD"], "new": M["NEW"], "other": M["OLD"] + " -- someone else"}[M["rule"]]
        if q.startswith("-- 750"): M["rule"] = "new"; return self._send(200, [])
        if "has_function_privilege('authenticated'" in q: return self._send(200, [{"prosrc": src, "browser": False}])
        if "select prosrc, prosecdef" in q: return self._send(200, [{"prosrc": src, "prosecdef": True}])
        if "journey_seat_member" in q: return self._send(200, [{"n": M["seats"]}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t750-")
WT = os.path.join(TMP, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
BASE = os.path.join(TMP, "base"); os.makedirs(BASE)
subprocess.run(f"git -C {HERE} archive {BASE_SHA} supabase/functions | tar -x -C {BASE}", shell=True, check=True)
OLDR = os.path.join(TMP, "older-rules.js"); open(OLDR, "wb").write(subprocess.run(["git", "-C", HERE, "show", f"{OLDER_RULES}:supabase/functions/_shared/lead-rules.js"], capture_output=True, check=True).stdout)
LIVEOLD = os.environ.get("LIVEOLD_750", "")   # the six live functions' shared files as downloaded 2026-10-15 (kept outside the repo)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log"); os.makedirs(os.path.join(TMP, "deployed"))
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']: open(os.path.join({TMP!r}, 'deployed', a[2]), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    mine = os.path.exists(os.path.join({TMP!r}, 'deployed', a[2])) or os.path.exists(os.path.join({TMP!r}, 'already'))
    shutil.copytree(os.path.join({WT!r} if mine else {BASE!r}, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True)
    if not mine and os.path.exists(os.path.join({TMP!r}, 'stale')) and a[2] in ('cc-booking', 'lead-watch'):
        shutil.copy({OLDR!r}, os.path.join(os.getcwd(), 'supabase', 'functions', '_shared', 'lead-rules.js'))
    if not mine and os.path.exists(os.path.join({TMP!r}, 'liveold')):
        shutil.copytree(os.path.join({LIVEOLD!r}, a[2], 'supabase', 'functions', '_shared'), os.path.join(os.getcwd(), 'supabase', 'functions', '_shared'), dirs_exist_ok=True)
        if os.path.exists(os.path.join({TMP!r}, 'unseen')) and a[2] == 'lead-watch':
            open(os.path.join(os.getcwd(), 'supabase', 'functions', '_shared', 'optout.ts'), 'a').write('// unseen')
    if not mine and os.path.exists(os.path.join({TMP!r}, 'drift')) and a[2] == 'lead-followup':
        open(os.path.join(os.getcwd(), 'supabase', 'functions', 'lead-followup', 'index.ts'), 'a').write('// someone else')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = {"_shared/lead-rules.js": sha(os.path.join(WT, "supabase/functions/_shared/lead-rules.js")),
       "client-journey": sha(os.path.join(WT, "supabase/functions/client-journey/index.ts")),
       "call-disposition": sha(os.path.join(WT, "supabase/functions/call-disposition/index.ts"))}
SQLSHA = sha(os.path.join(WT, "care-began-one-rule-750.sql"))
OLDB, NEWB = body(os.path.join(WT, "client-fact-care-began-fix.sql")), body(os.path.join(WT, "care-began-one-rule-750.sql"))
def run(env_over=None, drift=False, already=False, stale=False, liveold=False, unseen=False, **mode):
    reset(OLD=OLDB, NEW=NEWB, **mode); rep = os.path.join(TMP, "r.txt")
    os.path.exists(LOG) and os.remove(LOG); os.path.exists(rep) and os.remove(rep)
    shutil.rmtree(os.path.join(TMP, "deployed")); os.makedirs(os.path.join(TMP, "deployed"))
    for flag, on in (("drift", drift), ("already", already), ("stale", stale), ("liveold", liveold), ("unseen", unseen)):
        fp = os.path.join(TMP, flag); (open(fp, "w").write("x") if on else (os.path.exists(fp) and os.remove(fp)))
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_REPO=WT, SB_BASE=BASE_SHA, SB_SHAS=json.dumps(PIN), SB_SQL_SHA=SQLSHA, SB_SETTLE="0")
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "one_step_a_750.py")], env=env, capture_output=True, text=True, timeout=900)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
ran_sql = lambda: any(q.startswith("-- 750") for q in S["sql"])
try:
    c, out = run()
    ck("clean run from a fresh copy: exit 0, RESULT: DONE", c == 0 and "RESULT: DONE" in out, out[-2000:])
    ck("...the six functions that carry lead-rules.js are deployed, each once", sorted(deploys()) == sorted(FNS), deploys())
    ck("...each keeps its own gateway setting (lead-intake stays off)", "functions deploy lead-intake --project-ref zngsgedlsxinbygwmxwn --use-api --no-verify-jwt" in cli() and "functions deploy client-journey --project-ref zngsgedlsxinbygwmxwn --use-api\n" in cli(), cli())
    ck("...the care-began rule is replaced once, after the functions", ran_sql() and S["sql"].index(next(q for q in S["sql"] if q.startswith("-- 750"))) > 0, [q[:40] for q in S["sql"]])
    ck("...the tests ran from the fresh copy first", "✓ client_journey_test.mjs" in out and "✓ care_test.mjs" in out, out[:1500])
    ck("...the proof: every live copy is the reviewed build, the rule is 750's, the public key is refused", out.count("the live copy is exactly the reviewed build") == 6 and "the care-began rule is 750's" in out and "refuses the public key (401)" in out, out[-1500:])
    ck("...it says how many office people can record a Start Contract", "2 office person/people can record a Start Contract" in out, out)
    ck("...the report hides keys and emails", "eyJanonKEY" not in out and "sbp_test" not in out and "@" not in out)
    c, out = run(already=True, rule="new")
    ck("already installed: nothing deployed, the rule not re-run, DONE", c == 0 and not deploys() and not ran_sql() and "RESULT: DONE" in out, out[-1500:])
    c, out = run(stale=True)
    ck("a function still carrying an older lead-rules.js (its own code is main's): counts as main's build and is deployed", c == 0 and "cc-booking" in deploys() and "lead-watch" in deploys() and "RESULT: DONE" in out, out[-1500:])
    if not LIVEOLD: ck("LIVEOLD_750 not set: the real-live-copies rehearsal did not run", False)
    c, out = run(liveold=True)
    ck("the real live copies of 2026-10-15 (older shared helpers, each read by Claude): accepted, all six deployed, and the report names them", c == 0 and sorted(deploys()) == sorted(FNS) and "practice-address guard" in out and "RESULT: DONE" in out, out[-2500:])
    c, out = run(liveold=True, unseen=True)
    ck("a shared file nobody has read (not one of the known older ones): STOP before any change", c == 3 and not deploys() and not ran_sql() and "lead-watch on the server is not what 750 expects" in out, out[-1200:])
    c, out = run(drift=True)
    ck("someone else's code on lead-followup: STOP before any change (nothing deployed, the rule untouched)", c == 3 and not deploys() and not ran_sql() and "lead-followup on the server is not what 750 expects" in out, out[-1200:])
    c, out = run(rule="other")
    ck("the live care-began rule is not the one 750 replaces: STOP before any change", c == 3 and not deploys() and not ran_sql() and "not the one 750 replaces" in out, out[-1200:])
    c, out = run(seats=0)
    ck("nobody can record a Start Contract: STOP before any change (no one could set a start date)", c == 3 and not deploys() and not ran_sql() and "nobody in the office can record a Start Contract" in out, out[-1200:])
    c, out = run(env_over={"SB_SHAS": json.dumps({**PIN, "client-journey": "0" * 64})})
    ck("a build that is not the reviewed one: STOP, nothing run", c == 2 and not deploys() and "is not the reviewed build" in out, out[-800:])
    c, out = run(env_over={"SB_SQL_SHA": "0" * 64})
    ck("a database file that is not the reviewed one: STOP, nothing run", c == 2 and not deploys() and not ran_sql(), out[-800:])
    c, out = run(env_over={"SB_TOKEN": "nope"})
    ck("no access token: nothing run", c == 2 and not deploys() and not S["sql"], out[-400:])
    ck("no em dash anywhere in what she reads", not re.search("—", open(os.path.join(WT, "one_step_a_750.py")).read()))
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
fails = 0
for n, ok, note in res:
    print(("  ✓ " if ok else "  ✗ ") + n + ("" if ok else "\n      " + note)); fails += 0 if ok else 1
print(f"\n{len(res) - fails}/{len(res)} passed"); raise SystemExit(1 if fails else 0)
