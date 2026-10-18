#!/usr/bin/env python3
# Rehearsal of 919 (cards_close_919.py) against a FAKE Supabase (management API, database, functions) and a FAKE supabase
# CLI, from a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.
#   python3 cards_close_919_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, time
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_SHA = subprocess.run(["git", "-C", HERE, "rev-parse", "b6f0147"], capture_output=True, text=True).stdout.strip()   # origin/main before 919
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; M = {}
def reset(**m):
    S.clear(); S.update(sql=[], posts=[]); M.clear()
    M.update(dict(live="true", sched=1, suggest=None, close_=None, gate=401, run=200, touched_after=0, sql_fail=False, mode="practice"), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if re.match(r"/v1/projects/\w+/functions/call-tasks$", p): return self._send(200, {"version": 41, "verify_jwt": False})
        if p.startswith("/rest/v1/call_card_check"): return self._send(401, {"message": "no"})
        self._send(404, {})
    def do_PATCH(self): S.setdefault("patch", []).append(self.path); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"):
            S["posts"].append((p, self.headers.get("Authorization"), body))
            if "auth_check" in p: return self._send(M["gate"], {"error": "not allowed"})
            if self.headers.get("Authorization") != "Bearer eyJsvcKEY": return self._send(401, {})
            if M["run"] != 200: return self._send(M["run"], {"error": "boom"})
            return self._send(200, {"ok": True, "card_check_mode": M["mode"], "cards_open": 43, "cards_checked": 12, "cards_asked": 7, "cards_would_close": 3, "cards_would_suggest": 2, "cards_closed": 0, "cards_suggested": 0, "card_check_errors": 0})
        q = body["query"]; S["sql"].append(q)
        if q.startswith("select data->>'call_tasks_live'"): return self._send(200, [{"live": M["live"], "practice": None, "suggest": M["suggest"], "close_": M["close_"], "sched": M["sched"]}])
        if q.startswith("select count(*) filter"):
            after = any("create table if not exists public.call_card_check" in x for x in S["sql"])
            return self._send(200, [{"open_cards": 43, "touched": M["touched_after"] if after else 0, "sig": "abc"}])
        if "create table if not exists public.call_card_check" in q:
            if M["sql_fail"]: return self._send(400, {"message": "syntax error"})
            return self._send(200, [])
        if q.startswith("update public.app_data set data = data || jsonb_build_object('call_cards_practice', true)"): return self._send(200, [{"p": "true", "s": None, "c": None}])
        if q.startswith("select k.would"): return self._send(200, [{"would": "close", "verdict": "done", "why": "Office texted them Thu 2:10 PM", "proofs": [], "about": "Ann Fake", "title": "Call Ann back"},
                                                                    {"would": "suggest", "verdict": "done", "why": "The office told Tom.", "proofs": [], "about": "Tom Fake", "title": "Tell Angela"}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t919-")
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
    if os.path.exists(os.path.join({TMP!r}, 'drift')): open(os.path.join(os.getcwd(), 'supabase', 'functions', 'call-tasks', 'index.ts'), 'a').write('// someone else')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = {"call-tasks": sha(os.path.join(WT, "supabase/functions/call-tasks/index.ts")), "_shared/call-tasks": sha(os.path.join(WT, "supabase/functions/_shared/call-tasks.ts"))}
SQLSHA = sha(os.path.join(WT, "cards_close_919.sql"))
def run(env_over=None, already=False, drift=False, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    for f in (LOG, rep, os.path.join(TMP, "deployed")): os.path.exists(f) and os.remove(f)
    for flag, on in (("already", already), ("drift", drift)):
        fp = os.path.join(TMP, flag); (open(fp, "w").write("x") if on else (os.path.exists(fp) and os.remove(fp)))
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_REPO=WT, SB_BASE=BASE_SHA, SB_SHAS=json.dumps(PIN), SB_SQL_SHA=SQLSHA, SB_SETTLE="0", SB_POLL="0.05")
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "cards_close_919.py")], env=env, capture_output=True, text=True, timeout=900)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
changes = lambda: [q for q in S["sql"] if not q.lstrip().lower().startswith(("select",))]
try:
    c, out = run()
    ck("clean run from a fresh copy: exit 0, RESULT: DONE", c == 0 and "RESULT: DONE" in out, out[-1800:])
    ck("the test runs in Part 1 (from the fresh copy)", re.search(r"cards_close_919_test\.mjs: \d+/\d+ passed", out), out[:1500])
    ck("Part 1: the live reader is the version this builds on; cards counted", "the live reader is the version this builds on" in out and "43 open AI call card(s)" in out, out[:1500])
    ck("deploys call-tasks keeping its gateway setting (off)", deploys() == ["call-tasks"] and "--no-verify-jwt" in cli(), cli())
    ck("the database change goes in as written (one transaction)", any("create table if not exists public.call_card_check" in q and q.strip().startswith("--") and "commit;" in q for q in S["sql"]))
    ck("practice only: the update sets call_cards_practice and nothing else", any("jsonb_build_object('call_cards_practice', true)" in q and "suggest_live', true" not in q and "close_live', true" not in q for q in S["sql"]) and "PRACTICE is on" in out, out)
    ck("proof: live copy matches, refuses the public key, one run in practice with counts", "the live copy is exactly the reviewed build" in out and "refuses the public key (401)" in out and "it WOULD close 3 on proof and say Looks done on 2" in out, out[-1500:])
    ck("proof: the would-close and Looks done cards are listed", "WOULD CLOSE · Ann Fake: Call Ann back" in out and "LOOKS DONE  · Tom Fake: Tell Angela" in out, out[-1200:])
    ck("proof: no card changed, the public can't read the checks", "NO card was changed by the check" in out and "the public can't read the card checks (401)" in out, out[-900:])
    ck("no key, token or email in the report", not re.search(r"eyJ\w|sbp_\w|@mo-care", out), out)
    c, out = run(already=True)
    ck("run again: nothing deployed again, still DONE", c == 0 and not deploys() and "already this build" in out and "RESULT: DONE" in out, out[-900:])
    c, out = run(drift=True)
    ck("call-tasks live with a change not from GitHub: STOPS before any change", c == 3 and not deploys() and not changes(), out[-600:])
    c, out = run(env_over={"SB_SHAS": json.dumps(dict(PIN, **{"call-tasks": "0" * 64}))})
    ck("not the reviewed build: nothing runs", c == 2 and not deploys() and not S["sql"], out[-400:])
    c, out = run(env_over={"SB_SQL_SHA": "0" * 64})
    ck("database change not the reviewed build: nothing runs", c == 2 and not S["sql"], out[-400:])
    c, out = run(live="false")
    ck("call follow-up cards off: stops before any change", c == 4 and not deploys() and not changes(), out[-400:])
    c, out = run(close_="true")
    ck("close on proof already on: stops before any change", c == 4 and not deploys() and not changes(), out[-400:])
    c, out = run(sql_fail=True)
    ck("the database change fails: stops, nothing deployed, practice not turned on", c == 6 and not deploys() and not any(q.startswith("update") for q in S["sql"]), out[-400:])
    c, out = run(gate=200)
    ck("the reader answering the public key is caught", c == 8 and "PARTLY DONE" in out, out[-600:])
    c, out = run(touched_after=2)
    ck("a card changed by the check is caught", c == 8 and "✗ NO card was changed" in out, out[-600:])
    c, out = run(run=500)
    ck("a reader run that fails is caught", c == 8 and "reader run didn't answer" in out, out[-600:])
finally:
    for w in (WT, BASEWT): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w])
    shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
