#!/usr/bin/env python3
# Rehearsal of 1204 (calm_flags_1204.py, calmer shift-note flags) against a FAKE Supabase and a FAKE supabase CLI, from a fresh worktree of this
# commit (as the Desktop step runs it). Never touches a real project.
#   python3 calm_flags_1204_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_SHA = subprocess.run(["git", "-C", HERE, "rev-parse", "5a3c235"], capture_output=True, text=True).stdout.strip()   # main on 2026-10-30, before 1204
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; M = {}
def reset(**m):
    S.clear(); S.update(sql=[], posts=[]); M.clear()
    M.update(dict(calm=None, gate=401, run=200, closed_after=0, slot=1, hubs="care_coordinator", sqlfail=False), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if re.match(r"/v1/projects/\w+/functions/care-notes$", p): return self._send(200, {"version": 22, "verify_jwt": True})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"):
            S["posts"].append((p, self.headers.get("Authorization"), body))
            if self.headers.get("Authorization") == "Bearer eyJanonKEY": return self._send(M["gate"], {"error": "not allowed"})
            if self.headers.get("Authorization") != "Bearer eyJsvcKEY": return self._send(401, {})
            if M["run"] != 200: return self._send(M["run"], {"error": "boom"})
            S["ran"] = True
            return self._send(200, {"ok": True, "practice": True, "open_flags": 53, "open_after": 21, "combined_away": 21, "quiet_closed": 11, "written": 0, "errors": 0})
        q = body["query"]; S["sql"].append(q)
        if q.startswith("select data->>'calm_flags_live'"): return self._send(200, [{"calm": M["calm"], "levels": "true"}])
        if q.startswith("select count(*) filter (where x->>'status' = 'open')"): return self._send(200, [{"open": 53, "calm_closed": M["closed_after"] if S.get("ran") else 0}])
        if q.startswith("select (select count(*) from public.app_data where key = 'client_flag_normals')"): return self._send(200, [{"slot": M["slot"], "hubs": M["hubs"]}])
        if q.startswith("-- 1204"): return self._send(400 if M["sqlfail"] else 201, {"message": "boom"} if M["sqlfail"] else [])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1204-")
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
    if os.path.exists(os.path.join({TMP!r}, 'drift')): open(os.path.join(os.getcwd(), 'supabase', 'functions', 'care-notes', 'index.ts'), 'a').write('// someone else')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = {"care-notes": sha(os.path.join(WT, "supabase/functions/care-notes/index.ts")), "_shared/calm-flags": sha(os.path.join(WT, "supabase/functions/_shared/calm-flags.ts"))}
def run(env_over=None, already=False, drift=False, sameduty=False, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    for f in (LOG, rep, os.path.join(TMP, "deployed")): os.path.exists(f) and os.remove(f)
    for flag, on in (("already", already), ("drift", drift), ("sameduty", sameduty)):
        fp = os.path.join(TMP, flag); (open(fp, "w").write("x") if on else (os.path.exists(fp) and os.remove(fp)))
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_REPO=WT, SB_BASE=BASE_SHA, SB_SHAS=json.dumps(PIN), SB_SQL_SHA=sha(os.path.join(WT, "calm_flags_1204.sql")), SB_SETTLE="0", SB_POLL="0.05")
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "calm_flags_1204.py")], env=env, capture_output=True, text=True, timeout=900)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
writes = lambda: [q for q in S["sql"] if not q.lstrip().lower().startswith("select")]
try:
    c, out = run()
    ck("clean run from a fresh copy: exit 0, RESULT: DONE, switch left OFF", c == 0 and "RESULT: DONE" in out and "(OFF). When you're ready" in out, out[-1800:])
    ck("all five tests run in Part 1", all(re.search(n + r"\.mjs: \d+/\d+", out) for n in ("calm_flags_test", "shift_note_levels_test", "n2_flag_test", "life_notes_test", "my_desk_466_test")), out[:1500])
    ck("Part 1: live is the build this builds on; both switches read", "the live reader is the build this builds on" in out and "Calmer shift-note flags: OFF (this step does not change that); red and yellow flags: on" in out, out[:2000])
    ck("deploys care-notes keeping the gateway check on", deploys() == ["care-notes"] and "--no-verify-jwt" not in cli(), cli())
    ck("the only database change is the 1204 slot SQL, and no setting is written", len(writes()) == 1 and writes()[0].startswith("-- 1204") and "ops_settings" not in writes()[0].split("begin;")[1], writes())
    ck("proof: live copy matches, refuses the public key, slot is the Hub's only, count-only look, nothing combined", "the live copy is exactly the reviewed build" in out and "refuses the public key (401)" in out
       and "belongs to the Care Coordinator Hub only" in out and "53 open flag card(s) could combine" in out and "leave 21 open" in out and "no flag card was combined or closed by this step" in out, out[-1500:])
    ck("no key, token or email in the report; no em dash", not re.search(r"eyJ\w|sbp_\w|@mo-care", out) and "\u2014" not in out, out)
    c, out = run(already=True)
    ck("run again: nothing deployed again, still DONE", c == 0 and not deploys() and "already this build" in out and "RESULT: DONE" in out, out[-900:])
    c, out = run(drift=True)
    ck("care-notes live with a change not from GitHub: STOPS before any change", c == 3 and not deploys() and not writes(), out[-600:])
    c, out = run(env_over={"SB_SHAS": json.dumps({"care-notes": "0" * 64})})
    ck("not the reviewed build: nothing runs", c == 2 and not deploys() and not S["sql"], out[-400:])
    c, out = run(sqlfail=True)
    ck("the slot SQL failing: stops, nothing deployed", c == 5 and not deploys(), out[-600:])
    c, out = run(calm="true")
    ck("with the switch on: ON wording", c == 0 and "Calmer shift-note flags: ON" in out and "(ON)." in out, out[-900:])
    c, out = run(gate=200)
    ck("the reader answering the public key is caught", c == 8 and "CHECK THE" in out, out[-600:])
    c, out = run(hubs="care_coordinator,team_hub")
    ck("a slot open to another hub is caught", c == 8 and "✗ the marks slot exists" in out, out[-600:])
    c, out = run(closed_after=4)
    ck("a card combined or closed during the step is caught", c == 8 and "✗ no flag card was combined" in out, out[-600:])
    c, out = run(run=500)
    ck("the count-only look failing is caught", c == 8 and "count-only look didn't answer" in out, out[-600:])
finally:
    for w in (WT, BASEWT): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w])
    shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
