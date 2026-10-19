#!/usr/bin/env python3
# Rehearsal of 1004 (open_shift_cards_1004.py) against a FAKE Supabase and a FAKE supabase CLI, from a fresh worktree of this
# commit (as the Desktop step runs it). Never touches a real project.
#   python3 open_shift_cards_1004_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_SHA = subprocess.run(["git", "-C", HERE, "rev-parse", "24703ae"], capture_output=True, text=True).stdout.strip()   # main before 1004
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; M = {}
def reset(**m):
    S.clear(); S.update(sql=[], posts=[]); M.clear()
    M.update(dict(live=None, gate=401, run=200, pcards_after=0, mode="practice", hb="true"), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if re.match(r"/v1/projects/\w+/functions/coverage-watch$", p): return self._send(200, {"version": 22, "verify_jwt": True})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"):
            S["posts"].append((p, self.headers.get("Authorization"), body))
            if "auth_check" in p: return self._send(M["gate"], {"error": "not allowed"})
            if self.headers.get("Authorization") != "Bearer eyJsvcKEY": return self._send(401, {})
            if M["run"] != 200: return self._send(M["run"], {"error": "boom"})
            S["ran"] = True
            return self._send(200, {"ok": True, "open_shift_cards": {"live": False, "would": [{"visit": "s=1:d=2026-10-19", "client": "Ann Able", "when": "2026-10-19T09:00:00", "reason": "(none)"}], "made": 0, "closed": 0, "skipped": {"already started": 2}}})
        q = body["query"]; S["sql"].append(q)
        if q.startswith("select data->>'open_shift_cards_live'"): return self._send(200, [{"live": M["live"], "watch": "true"}])
        if "automation_heartbeats" in q: return self._send(200, [{"ok": M["hb"]}])
        if q.startswith("select count(*) filter (where x->>'id' like"): return self._send(200, [{"open_cards": M["pcards_after"] if S.get("ran") else 0}])
        if q.startswith("select who_name"): return self._send(200, [{"who_name": "Steve Algiere", "caller": "Steve", "what": "Call Steve back about arranging a ride", "due": "2026-10-16", "note": "would make a My Work card for Sam T", "what_now": "would_card"},
            {"who_name": None, "caller": "David K.", "what": "Check back with the household if a clock-out is missing", "due": "2026-10-16", "note": "EVV work is retired; missed clock-ins are Call cards", "what_now": "no_card"}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1004-")
WT = os.path.join(TMP, "wt"); BASEWT = os.path.join(TMP, "base")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", BASEWT, BASE_SHA], check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']: open(os.path.join({TMP!r}, 'deployed'), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    src = {WT!r} if (os.path.exists(os.path.join({TMP!r}, 'deployed')) or os.path.exists(os.path.join({TMP!r}, 'already'))) else {BASEWT!r}
    shutil.copytree(os.path.join(src, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True)
    if os.path.exists(os.path.join({TMP!r}, 'drift')): open(os.path.join(os.getcwd(), 'supabase', 'functions', 'coverage-watch', 'index.ts'), 'a').write('// someone else')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = {"coverage-watch": sha(os.path.join(WT, "supabase/functions/coverage-watch/index.ts")), "_shared/open-shift": sha(os.path.join(WT, "supabase/functions/_shared/open-shift.ts")), "_shared/verbs": sha(os.path.join(WT, "supabase/functions/_shared/verbs.js"))}
def run(env_over=None, already=False, drift=False, sameduty=False, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    for f in (LOG, rep, os.path.join(TMP, "deployed")): os.path.exists(f) and os.remove(f)
    for flag, on in (("already", already), ("drift", drift), ("sameduty", sameduty)):
        fp = os.path.join(TMP, flag); (open(fp, "w").write("x") if on else (os.path.exists(fp) and os.remove(fp)))
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_REPO=WT, SB_BASE=BASE_SHA, SB_SHAS=json.dumps(PIN), SB_SETTLE="0", SB_POLL="0.05")
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "open_shift_cards_1004.py")], env=env, capture_output=True, text=True, timeout=900)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
writes = lambda: [q for q in S["sql"] if not q.lstrip().lower().startswith("select")]
try:
    c, out = run()
    ck("clean run from a fresh copy: exit 0, RESULT: DONE, switch left OFF", c == 0 and "RESULT: DONE" in out and "OFF: practice" in out, out[-1800:])
    ck("both tests run in Part 1", all(re.search(n + r"\.mjs: ", out) for n in ("open_shift_cards_test", "covered_outside_harness")), out[:1500])
    ck("Part 1: live is the build this builds on; the switch is off and not changed", "the live watcher is the build this builds on" in out and "OFF, practice (this step does not change that)" in out, out[:1800])
    ck("deploys coverage-watch keeping the gateway check on", deploys() == ["coverage-watch"] and "--no-verify-jwt" not in cli(), cli())
    ck("no database change and no setting written", not writes(), writes())
    ck("proof: live copy matches, refuses the public key, a DRY run, lists the open shift, no card in practice", "the live copy is exactly the reviewed build" in out and "refuses the public key (401)" in out
       and "one dry watcher run: 1 open shift" in out and "Ann Able, 2026-10-19 09:00, reason: (none)" in out and "practice: no open-shift card was made" in out and any("dry=1" in p[0] for p in S["posts"]), out[-1500:])
    ck("no key, token or email in the report; no em dash", not re.search(r"eyJ\w|sbp_\w|@mo-care", out) and "\u2014" not in out, out)
    c, out = run(already=True)
    ck("run again: nothing deployed again, still DONE", c == 0 and not deploys() and "already this build" in out and "RESULT: DONE" in out, out[-900:])
    c, out = run(drift=True)
    ck("coverage-watch live with a change not from GitHub: STOPS before any change", c == 3 and not deploys(), out[-600:])
    c, out = run(env_over={"SB_SHAS": json.dumps({"coverage-watch": "0" * 64})})
    ck("not the reviewed build: nothing runs", c == 2 and not deploys() and not S["sql"], out[-400:])
    c, out = run(live="true")
    ck("with the switch on: says ON", c == 0 and "open shifts with no case: ON" in out and "(ON)." in out and "practice: no open-shift card" not in out, out[-900:])
    c, out = run(gate=200)
    ck("the watcher answering the public key is caught", c == 8 and "PARTLY DONE" in out, out[-600:])
    c, out = run(pcards_after=1)
    ck("in practice, a card made anyway is caught", c == 8 and "✗ practice: no open-shift card" in out, out[-600:])
    c, out = run(hb="false")
    ck("a heartbeat that is not OK is caught", c == 8 and "✗ the watcher's heartbeat is OK" in out, out[-600:])
    c, out = run(run=500)
    ck("a watcher run that fails is caught", c == 8 and "watcher run didn't answer" in out, out[-600:])
finally:
    for w in (WT, BASEWT): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w])
    shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
