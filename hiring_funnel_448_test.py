#!/usr/bin/env python3
# Rehearsal of 448 against a FAKE Supabase project and a fake supabase CLI, run from a FRESH copy of this repository (as
# the Desktop step runs). Never touches a real project.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
BASE = os.environ.get("HUB_BASE") or "7b3243acfab29714f9a124a02720fcf63425134a"   # the base 448 pins
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANONK, SVCK = "eyJanon" + REF, "eyJsvc" + REF
M = {}; SEEN = []; CALLS = []
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        m = re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", p)
        if m:
            fn = m.group(2)
            if fn not in open(STATE).read().split(): return self._send(404, {})
            return self._send(200, {"verify_jwt": True, "version": 1})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": ANONK}, {"name": "service_role", "api_key": SVCK}])
        if re.match(r"/v1/projects/\w+/secrets", p):
            names = ["HUB_JOB_SECRET", "GHL_TOKEN", "GHL_LOCATION_ID"]
            if M.get("noghl"): names = names[:1]
            return self._send(200, [{"name": n} for n in names])
        if "/rest/v1/bg_reviews" in p: return self._send(401 if not M.get("public") else 200, [{"id": 1}] if M.get("public") else {})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_OPTIONS(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path; auth = self.headers.get("Authorization", "")
        if p.endswith("/database/query"):
            q = json.loads(raw)["query"]; SEEN.append(q)
            if "vault.decrypted_secrets where name" in q and "as vault" in q: return self._send(201, [{"vault": 1}])
            if "cron.schedule(" in q: return self._send(201, [{"id": 7}])
            if "from cron.job where jobname" in q: return self._send(201, [{"schedule": "20 * * * *", "command": "select net.http_post(... 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets ...)), body := '{\"action\": \"due_check\"}'"}])
            if "net.http_post" in q and " as id" in q: return self._send(201, [{"id": 9}])
            if "net._http_response" in q: return self._send(201, [{"status_code": 200, "content": json.dumps({"ok": True, "caller": "cron"})}])
            if "count(*) from bg_reviews" in q: return self._send(201, [{"n": 0}])
            return self._send(201, [])
        CALLS.append((p, auth))
        if "/hiring-funnel" in p: return self._send(403 if "anon" in auth else 200, {"error": "Owners only."})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t448-"); LOG = os.path.join(tmp, "log"); STATE = os.path.join(tmp, "state"); CLI = os.path.join(tmp, "supabase")
WH = os.path.join(tmp, "wt", "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", WH, "HEAD"], cwd=HERE, check=True)
open(CLI, "w").write(f"""#!/bin/sh
cmd="$2"; fn="$3"
if [ "$cmd" = "download" ]; then
  grep -qx "$fn" "{STATE}" 2>/dev/null || exit 1
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  cp "{WH}/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "{WH}"/supabase/functions/_shared/*.ts supabase/functions/_shared/
  if [ "$BAD_LIVE" = "$fn" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$fn" >> "{LOG}"; echo "$fn" >> "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
HS = {"hiring-funnel": sha(os.path.join(HERE, "supabase/functions/hiring-funnel/index.ts")),
      "_shared/hiring-funnel": sha(os.path.join(HERE, "supabase/functions/_shared/hiring-funnel.ts"))}
def run(keep=False, mode=None, pre=None, **over):
    M.clear(); M.update(mode or {}); SEEN.clear(); CALLS.clear(); open(LOG, "w").close()
    if not keep: open(STATE, "w").write("\n".join(pre or []) + ("\n" if pre else ""))
    rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=WH, SB_BASE=BASE,
               SB_SHAS=json.dumps(HS), SB_FN_BASE=URL, SB_SETTLE="0", SB_POLL="0.01")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(WH, "hiring_funnel_448.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read().split()
rc, r, d = run(); print(r)
ck("DONE: hiring-funnel created", rc == 0 and "RESULT: DONE" in r and d == ["hiring-funnel"] and "✗" not in r, r)
ck("its tests ran here, from a fresh copy (made-up people)", "hiring_funnel_test.mjs: 18/18 passed" in r, r)
ck("no database change and no message: the only calls are the refusal check", not any("begin" in q.lower() for q in SEEN) and all("/hiring-funnel" in p_ for p_, a in CALLS), [SEEN, CALLS])
ck("no key or token in the report", not re.search(r"eyJ|sbp_", r), r)
rc, r, d = run(keep=True); ck("run again: already has it, nothing redeployed", rc == 0 and "already had it" in r and not d, r)
rc, r, d = run(pre=["hiring-funnel"], BAD_LIVE="hiring-funnel"); ck("a hiring-funnel already live that isn't this build: nothing changed", rc != 0 and "Nothing was changed" in r and not d, r)
H.shutdown()
subprocess.run(["git", "worktree", "remove", "--force", WH], cwd=HERE)
shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
