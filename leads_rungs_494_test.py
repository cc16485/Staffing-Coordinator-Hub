#!/usr/bin/env python3
# Rehearsal of 494 against a FAKE Supabase project and a fake supabase CLI, run from a FRESH copy of this repository (as
# the Desktop step runs). "Live" starts as the GitHub version 494 was built on. Never touches a real project.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
BASE = os.environ.get("HUB_BASE") or "313aabe"   # the base 494 pins (Staffing main after #251)
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANONK, SVCK = "eyJanon" + REF, "eyJsvc" + REF
VJ = {"lead-watch": True}
M = {}; SEEN = []; CALLS = []
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        m = re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", p)
        if m:
            if m.group(2) == "lead-watch" and "lead-watch" not in open(STATE).read().split(): return self._send(404, {})
            return self._send(200, {"verify_jwt": VJ.get(m.group(2), True), "version": 5})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": ANONK}, {"name": "service_role", "api_key": SVCK}])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path; auth = self.headers.get("Authorization", "")
        if p.endswith("/database/query"):
            q = json.loads(raw)["query"]; SEEN.append(q)
            if "lead_rungs_live" in q and "vault" in q: return self._send(201, [{"live": M.get("switch", "not set"), "vault": 0 if M.get("novault") else 1}])
            if "lead_rungs_live" in q: return self._send(201, [{"live": M.get("switch", "not set")}])
            if "cron.schedule(" in q: return self._send(201, [{"id": 7}])
            if "from cron.job where jobname" in q: return self._send(201, [{"schedule": "*/2 * * * *", "command": "select net.http_post(... 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets ...))"}])
            if "net.http_post" in q and " as id" in q: return self._send(201, [{"id": 9}])
            if "net._http_response" in q: return self._send(201, [{"status_code": 200, "content": json.dumps({"ok": True, "caller": "cron"})}])
            return self._send(201, [])
        CALLS.append((p, auth))
        owner = auth == "Bearer " + SVCK
        if "auth_check=1" in p: return self._send(200, {"ok": True, "caller": "owner"}) if owner else self._send(401, {"error": "not allowed"})
        if "/lead-watch?dry=1" in p:
            if M.get("cw500"): return self._send(500, {"error": "boom"})
            return self._send(200, {"live": False, "quiet": False, "seats": {"operations": "Krystal", "operations_from": "schedule", "backup": "Angiel", "escalation": "Samantha"}, "minutes": {"owner": 5, "backup": 15, "manager": 30}, "filled": 1, "moved": 0, "rungs": {"owner": 2, "backup": 1, "manager": 0}, "texted": 3, "written": 0})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t494-"); LOG = os.path.join(tmp, "log"); STATE = os.path.join(tmp, "state"); CLI = os.path.join(tmp, "supabase")
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
  cp "$SRC/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$SRC"/supabase/functions/_shared/*.ts "$SRC"/supabase/functions/_shared/*.js supabase/functions/_shared/
  if [ "$BAD_LIVE" = "$fn" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$fn" >> "{LOG}"; echo "$fn" >> "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
HS = {"lead-watch": sha(os.path.join(HERE, "supabase/functions/lead-watch/index.ts")),
      "_shared/lead-links": sha(os.path.join(HERE, "supabase/functions/_shared/lead-links.ts")),
      "_shared/lead-rules.js": sha(os.path.join(HERE, "supabase/functions/_shared/lead-rules.js"))}
def run(keep=False, mode=None, **over):
    M.clear(); M.update(mode or {}); SEEN.clear(); CALLS.clear(); open(LOG, "w").close(); open(LOG + ".args", "w").close()
    if not keep: open(STATE, "w").close()
    rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=WH, SB_BASE=BASE,
               SB_SHAS=json.dumps(HS), SB_FN_BASE=URL, SB_SETTLE="0", SB_POLL="0.01")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(WH, "leads_rungs_494.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read().split(), open(LOG + ".args").read()
rc, r, d, args = run(); print(r)
ck("DONE: lead-watch created from a fresh copy", rc == 0 and "RESULT: DONE" in r and d == ["lead-watch"] and "✗" not in r, r)
ck("the gateway sign-in check stays on (the page sends the public key; the schedule its secret)", not re.search(r"deploy lead-watch .*--no-verify-jwt", args), args)
ck("the speed-to-lead check is scheduled every 2 minutes with the jobs' secret", any("cron.schedule('lead-watch', '*/2 * * * *'" in q and "x-cron-secret" in q for q in SEEN), [q for q in SEEN if "cron.schedule" in q])
ck("the test ran here, from a fresh copy (fake data only)", "lead_watch_494_test.mjs: " in r and "/" in r, r)
ck("the practice run prints the seats, the minutes and the counts", all(s_ in r for s_ in ("Operations now: Krystal (schedule)", "backup: Angiel", "Owner Escalation now: Samantha", "minutes: owner 5 · backup 15 · Owner Escalation 30", "owner 2 · backup 1 · Owner Escalation 0", "go to the Operations holder: 1")), r)
ck("...and no family names, emails, keys or tokens", not re.search(r"Diane|Teague|eyJ|sbp_|@", r), r)
ck("the only calls to the job are who-is-calling checks and the one practice (dry) run", all(("auth_check=1" in p_ or "dry=1" in p_) for p_, _ in CALLS) and sum("dry=1" in p_ for p_, _ in CALLS) == 1, CALLS)
ck("the switch is only read, never written", not any(re.search(r"update |insert |jsonb_set|upsert_app_data", q, re.I) for q in SEEN), [q for q in SEEN if re.search(r"update |insert ", q, re.I)])
rc, r, d, _ = run(keep=True); ck("run again: already has it, nothing redeployed, still DONE", rc == 0 and "already had it" in r and not d and "RESULT: DONE" in r, r)
rc, r, d, _ = run(mode={"novault": True}); ck("no jobs' secret: stops before changing anything", rc != 0 and "jobs' secret" in r and not d, r)
bad = dict(HS); bad["_shared/lead-links"] = "0" * 64
rc, r, d, _ = run(SB_SHAS=json.dumps(bad)); ck("a helper that isn't the reviewed one: stops before anything", rc != 0 and "not the reviewed build" in r and not d, r)
rc, r, d, _ = run(mode={"cw500": True}); ck("if the practice run can't answer, it says so (✗) and does not claim DONE", rc != 0 and "practice run didn't answer" in r and "PARTLY DONE" in r, r)
H.shutdown()
for w in (WH, WB): subprocess.run(["git", "worktree", "remove", "--force", w], cwd=HERE)
shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
