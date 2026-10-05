#!/usr/bin/env python3
# Rehearsal of 451 against a FAKE Supabase project and a fake supabase CLI, run from a FRESH copy of this repository (as
# the Desktop step runs). "Live" starts as the GitHub version 450 was built on. Never touches a real project.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
BASE = os.environ.get("HUB_BASE") or "00a410f8df2387befb3108c37b95b9f114b25b13"   # the base 451 pins
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANONK, SVCK = "eyJanon" + REF, "eyJsvc" + REF
VJ = {"timekeeper-watch": False, "coverage-run": True, "work-route": True}
M = {}; SEEN = []; CALLS = []
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        m = re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", p)
        if m:
            if m.group(2) == "work-route" and "work-route" not in open(STATE).read().split(): return self._send(404, {})
            return self._send(200, {"verify_jwt": VJ.get(m.group(2), True), "version": 5})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": ANONK}, {"name": "service_role", "api_key": SVCK}])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path; auth = self.headers.get("Authorization", "")
        if p.endswith("/database/query"):
            q = json.loads(raw)["query"]; SEEN.append(q)
            if "routing_live" in q and "vault" in q: return self._send(201, [{"live": M.get("switch", "not set"), "vault": 0 if M.get("novault") else 1}])
            if "routing_live" in q: return self._send(201, [{"live": M.get("switch", "not set")}])
            if "cron.schedule(" in q: return self._send(201, [{"id": 7}])
            if "from cron.job where jobname" in q: return self._send(201, [{"schedule": "*/2 * * * *", "command": "select net.http_post(... 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets ...))"}])
            if "net.http_post" in q and " as id" in q: return self._send(201, [{"id": 9}])
            if "net._http_response" in q: return self._send(201, [{"status_code": 200, "content": json.dumps({"ok": True, "caller": "cron"})}])
            return self._send(201, [])
        CALLS.append((p, auth))
        owner = auth == "Bearer " + SVCK
        if "auth_check=1" in p: return self._send(200, {"ok": True, "caller": "owner"}) if owner else self._send(401, {"error": "not allowed"})
        if "/work-route?dry=1" in p:
            if M.get("cw500"): return self._send(500, {"error": "boom"})
            return self._send(200, {"live": False, "seats": {"staffing": {"first": "Krystal", "from": "schedule"}, "escalation": {"first": "Samantha", "from": "fallback"}}, "routed": 3, "escalated_urgent": 1, "escalated_overdue": 12, "cleared": 0, "written": 0})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t451-"); LOG = os.path.join(tmp, "log"); STATE = os.path.join(tmp, "state"); CLI = os.path.join(tmp, "supabase")
WH = os.path.join(tmp, "wt", "hub"); WB = os.path.join(tmp, "wt", "base")
subprocess.run(["git", "worktree", "add", "-q", "--detach", WH, "HEAD"], cwd=HERE, check=True)
subprocess.run(["git", "worktree", "add", "-q", "--detach", WB, BASE], cwd=HERE, check=True)
open(CLI, "w").write(f"""#!/bin/sh
cmd="$2"; fn="$3"
echo "$*" >> "{LOG}.args"
if [ "$cmd" = "download" ]; then
  SRC="{WB}"; grep -qx "$fn" "{STATE}" 2>/dev/null && SRC="{WH}"
  [ -f "$SRC/supabase/functions/$fn/index.ts" ] || exit 1
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  cp "$SRC/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$SRC"/supabase/functions/_shared/*.ts supabase/functions/_shared/
  if [ "$BAD_LIVE" = "$fn" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$fn" >> "{LOG}"; echo "$fn" >> "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
HS = {"work-route": sha(os.path.join(HERE, "supabase/functions/work-route/index.ts")),
      "timekeeper-watch": sha(os.path.join(HERE, "supabase/functions/timekeeper-watch/index.ts")),
      "coverage-run": sha(os.path.join(HERE, "supabase/functions/coverage-run/index.ts")),
      "_shared/duty": sha(os.path.join(HERE, "supabase/functions/_shared/duty.ts"))}
def run(keep=False, mode=None, **over):
    M.clear(); M.update(mode or {}); SEEN.clear(); CALLS.clear(); open(LOG, "w").close(); open(LOG + ".args", "w").close()
    if not keep: open(STATE, "w").close()
    rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=WH, SB_BASE=BASE,
               SB_SHAS=json.dumps(HS), SB_FN_BASE=URL, SB_SETTLE="0", SB_POLL="0.01")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(WH, "work_route_451.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read().split(), open(LOG + ".args").read()
rc, r, d, args = run(); print(r)
ck("DONE: work-route created, the two jobs updated, in order, from a fresh copy", rc == 0 and "RESULT: DONE" in r and d == ["work-route", "timekeeper-watch", "coverage-run"] and "✗" not in r, r)
ck("each keeps its gateway setting (work-route on; timekeeper off; coverage-run on)", re.search(r"deploy timekeeper-watch .*--no-verify-jwt", args) and not re.search(r"deploy work-route .*--no-verify-jwt", args) and not re.search(r"deploy coverage-run .*--no-verify-jwt", args), args)
ck("the routing check is scheduled every 2 minutes with the jobs' secret", any("cron.schedule('work-route', '*/2 * * * *'" in q and "x-cron-secret" in q for q in SEEN), [q for q in SEEN if "cron.schedule" in q])
ck("the tests ran here, from a fresh copy (fake data only)", all(t_ in r for t_ in ("duty_phase3_test.mjs: 28/28", "loops_phase2_test.mjs: 38/38", "c1_missed_clockin_test.mjs: 65/65", "j1_job_locks_test.mjs: 105/105")), r)
ck("the practice run prints the seats and counts", all(s_ in r for s_ in ("Staffing now: Krystal (schedule)", "Owner Escalation now: Samantha (fallback)", "would be routed: 3", "pull in Owner Escalation now: 1", "\"Escalated to you\" list: 12")), r)
ck("...and no client names, emails, keys or tokens", not re.search(r"Ruth|eyJ|sbp_|@", r), r)
ck("the only calls to the jobs are who-is-calling checks and the one practice (dry) run", all(("auth_check=1" in p_ or "dry=1" in p_) for p_, _ in CALLS) and sum("dry=1" in p_ for p_, _ in CALLS) == 1, CALLS)
ck("the switch is only read, never written", not any(re.search(r"update |insert |jsonb_set|upsert_app_data", q, re.I) for q in SEEN), [q for q in SEEN if re.search(r"update |insert ", q, re.I)])
rc, r, d, _ = run(keep=True); ck("run again: already has it, nothing redeployed, still DONE", rc == 0 and r.count("already had it") == 3 and not d and "RESULT: DONE" in r, r)
rc, r, d, _ = run(BAD_LIVE="coverage-run"); ck("a live job that isn't the GitHub version: NOTHING is deployed or scheduled", rc != 0 and "isn't what this was built on" in r and not d and not any("cron.schedule" in q for q in SEEN), r)
rc, r, d, _ = run(mode={"novault": True}); ck("no jobs' secret: stops before changing anything", rc != 0 and "jobs' secret" in r and not d, r)
bad = dict(HS); bad["_shared/duty"] = "0" * 64
rc, r, d, _ = run(SB_SHAS=json.dumps(bad)); ck("a rules file that isn't the reviewed one: stops before anything", rc != 0 and "not the reviewed build" in r and not d, r)
rc, r, d, _ = run(mode={"cw500": True}); ck("if the practice run can't answer, it says so (✗) and does not claim DONE", rc != 0 and "routing practice run didn't answer" in r and "PARTLY DONE" in r, r)
H.shutdown()
for w in (WH, WB): subprocess.run(["git", "worktree", "remove", "--force", w], cwd=HERE)
shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
