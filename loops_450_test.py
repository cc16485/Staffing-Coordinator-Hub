#!/usr/bin/env python3
# Rehearsal of 450 against a FAKE Supabase project and a fake supabase CLI, run from a FRESH copy of this repository (as
# the Desktop step runs). "Live" starts as the GitHub version 450 was built on. Never touches a real project.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
BASE = os.environ.get("HUB_BASE") or "7d36b666bd27e3a8263a557f56672f5dcb9c8fa7"   # the base 450 pins
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANONK, SVCK = "eyJanon" + REF, "eyJsvc" + REF
VJ = {"coverage-watch": False, "timekeeper-watch": False, "coverage-run": True}
M = {}; SEEN = []; CALLS = []
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        m = re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", p)
        if m: return self._send(200, {"verify_jwt": VJ.get(m.group(2), True), "version": 5})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": ANONK}, {"name": "service_role", "api_key": SVCK}])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path; auth = self.headers.get("Authorization", "")
        if p.endswith("/database/query"):
            q = json.loads(raw)["query"]; SEEN.append(q)
            if "loops_close_live" in q: return self._send(201, [{"live": M.get("switch", "not set")}])
            return self._send(201, [])
        CALLS.append((p, auth))
        owner = auth == "Bearer " + SVCK
        if "auth_check=1" in p: return self._send(200, {"ok": True, "caller": "owner"}) if owner else self._send(401, {"error": "not allowed"})
        if "/coverage-watch?dry=1" in p:
            if M.get("cw500"): return self._send(500, {"error": "boom"})
            return self._send(200, {"loops": {"live": False, "cases_closed": [{"case": "c1", "client": "Ruth Adams"}], "asked": [{"case": "c2", "client": "Ted Brown"}, {"case": "c3", "client": "Ann Cole"}],
              "items_closed": 4, "family_calls": [], "errors": []}, "evv_review": {"week": "x", "days_with_data": 0, "below": ["Joyce Kim: 1 of 2 (50%)"], "card": "would make"}})
        if "/timekeeper-watch?dry=1" in p: return self._send(200, {"evv_fix": {"live": False, "became_evv_fix": [{"caregiver": "Maria Lopez", "client": "Ruth"}]}})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t450-"); LOG = os.path.join(tmp, "log"); STATE = os.path.join(tmp, "state"); CLI = os.path.join(tmp, "supabase")
WH = os.path.join(tmp, "wt", "hub"); WB = os.path.join(tmp, "wt", "base")
subprocess.run(["git", "worktree", "add", "-q", "--detach", WH, "HEAD"], cwd=HERE, check=True)
subprocess.run(["git", "worktree", "add", "-q", "--detach", WB, BASE], cwd=HERE, check=True)
open(CLI, "w").write(f"""#!/bin/sh
cmd="$2"; fn="$3"
echo "$*" >> "{LOG}.args"
if [ "$cmd" = "download" ]; then
  SRC="{WB}"; grep -qx "$fn" "{STATE}" 2>/dev/null && SRC="{WH}"
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  cp "$SRC/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$SRC"/supabase/functions/_shared/*.ts supabase/functions/_shared/
  if [ "$BAD_LIVE" = "$fn" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$fn" >> "{LOG}"; echo "$fn" >> "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
HS = {"coverage-watch": sha(os.path.join(HERE, "supabase/functions/coverage-watch/index.ts")),
      "timekeeper-watch": sha(os.path.join(HERE, "supabase/functions/timekeeper-watch/index.ts")),
      "coverage-run": sha(os.path.join(HERE, "supabase/functions/coverage-run/index.ts")),
      "_shared/loops": sha(os.path.join(HERE, "supabase/functions/_shared/loops.ts"))}
def run(keep=False, mode=None, **over):
    M.clear(); M.update(mode or {}); SEEN.clear(); CALLS.clear(); open(LOG, "w").close(); open(LOG + ".args", "w").close()
    if not keep: open(STATE, "w").close()
    rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=WH, SB_BASE=BASE,
               SB_SHAS=json.dumps(HS), SB_FN_BASE=URL, SB_SETTLE="0")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(WH, "loops_450.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read().split(), open(LOG + ".args").read()
rc, r, d, args = run(); print(r)
ck("DONE: the three jobs deployed, in order, from a fresh copy", rc == 0 and "RESULT: DONE" in r and d == ["coverage-watch", "timekeeper-watch", "coverage-run"] and "✗" not in r, r)
ck("each keeps its gateway setting (off for the two watchers, on for coverage-run)", args.count("deploy coverage-watch") == 1 and re.search(r"deploy coverage-watch .*--no-verify-jwt", args)
   and re.search(r"deploy timekeeper-watch .*--no-verify-jwt", args) and re.search(r"deploy coverage-run ", args) and not re.search(r"deploy coverage-run .*--no-verify-jwt", args), args)
ck("the tests ran here, from a fresh copy (fake data only)", all(t in r for t in ("loops_phase2_test.mjs: 38/38", "c1_missed_clockin_test.mjs: 65/65", "j1_job_locks_test.mjs: 105/105", "j2_job_locks_test.mjs: 60/60")), r)
ck("the practice run prints counts: 1 would close, 2 asked, 4 cards, 1 EVV fix, 1 under 90%", all(s in r for s in ("would close: 1", "(\"Was it covered?\"): 2", "close with their case: 4", "1 open alert(s) whose shift is over", "1 caregiver(s) under 90%")), r)
ck("...and no names, emails, keys or tokens", not re.search(r"Ruth|Ted|Ann|Maria|Joyce|eyJ|sbp_|@", r), r)
ck("the only calls to the jobs are who-is-calling checks and the two practice (dry) runs; nothing else is run", all(("auth_check=1" in p_ or "dry=1" in p_) for p_, _ in CALLS)
   and sum("dry=1" in p_ for p_, _ in CALLS) == 2 and not any("coverage-run?dry" in p_ for p_, _ in CALLS), CALLS)
ck("the switch is only read, never written", not any(re.search(r"update|insert|jsonb_set|upsert", q, re.I) for q in SEEN), SEEN)
rc, r, d, _ = run(keep=True); ck("run again: already has it, nothing redeployed, still DONE", rc == 0 and r.count("already had it") == 3 and not d and "RESULT: DONE" in r, r)
rc, r, d, _ = run(BAD_LIVE="coverage-run"); ck("a live job that isn't the GitHub version: NOTHING is deployed", rc != 0 and "isn't the GitHub version" in r and not d, r)
bad = dict(HS); bad["_shared/loops"] = "0" * 64
rc, r, d, _ = run(SB_SHAS=json.dumps(bad)); ck("a rules file that isn't the reviewed one: stops before anything", rc != 0 and "not the reviewed build" in r and not d, r)
rc, r, d, _ = run(mode={"cw500": True}); ck("if the practice run can't answer, it says so (✗) and does not claim DONE", rc != 0 and "coverage practice run didn't answer" in r and "PARTLY DONE" in r, r)
H.shutdown()
for w in (WH, WB): subprocess.run(["git", "worktree", "remove", "--force", w], cwd=HERE)
shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
