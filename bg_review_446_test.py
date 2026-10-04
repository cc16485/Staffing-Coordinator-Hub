#!/usr/bin/env python3
# Rehearsal of 446 against a FAKE Supabase project and a fake supabase CLI, run from a FRESH copy of this repository (as
# the Desktop step runs). Never touches a real project.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
BASE = os.environ.get("HUB_BASE") or "0eac18f1c627303eec0e790d2171cd1f09b24f94"   # the base 446 pins
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
        if "/bg-review" in p: return self._send(401, {"error": "Sign in first."})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t446-"); LOG = os.path.join(tmp, "log"); STATE = os.path.join(tmp, "state"); CLI = os.path.join(tmp, "supabase")
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
HS = {"bg-review": sha(os.path.join(HERE, "supabase/functions/bg-review/index.ts")),
      "_shared/bg-review": sha(os.path.join(HERE, "supabase/functions/_shared/bg-review.ts"))}
def run(keep=False, mode=None, pre=None, **over):
    M.clear(); M.update(mode or {}); SEEN.clear(); CALLS.clear(); open(LOG, "w").close()
    if not keep: open(STATE, "w").write("\n".join(pre or []) + ("\n" if pre else ""))
    rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=WH, SB_BASE=BASE,
               SB_SHAS=json.dumps(HS), SB_SQL_SHA=sha(os.path.join(HERE, "bg_review_446.sql")), SB_FN_BASE=URL, SB_SETTLE="0", SB_POLL="0.01")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(WH, "bg_review_446.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read().split()
rc, r, d = run(); print(r)
ck("DONE: the database change, bg-review created, the hourly due check", rc == 0 and "RESULT: DONE" in r and d == ["bg-review"]
   and any("bg_reviews_one_open" in q for q in SEEN) and any("cron.schedule('bg-review-due', '20 * * * *'" in q and "due_check" in q for q in SEEN) and "✗" not in r, r)
ck("the database change runs as one transaction", any(q.startswith("begin;") and q.rstrip().endswith("commit;") and "bg_reviews" in q for q in SEEN))
ck("the tests ran here, from a fresh copy (fake data only)", "bg_review_test.mjs: 73/73 passed" in r and "applicant_msgs_test.mjs: 42/42 passed" in r, r)
ck("the step never opens a review, sends, or changes an applicant: its only calls are refusal checks", all("/bg-review" in p_ and "svc" not in a for p_, a in CALLS) and not any(re.search(r"insert into public\.bg_reviews|update public\.app_data", q) for q in SEEN), CALLS)
ck("no key or token in the report", not re.search(r"eyJ|sbp_", r), r)
rc, r, d = run(keep=True); ck("run again: already has it, nothing redeployed, still DONE", rc == 0 and "already had it" in r and not d and "RESULT: DONE" in r, r)
rc, r, d = run(pre=["bg-review"], BAD_LIVE="bg-review"); ck("a bg-review already live that isn't this build: NOTHING is changed", rc != 0 and "Nothing was changed" in r and not d and not any("begin;" in q for q in SEEN), r)
rc, r, d = run(mode={"noghl": True}); ck("no GoHighLevel connection: stops before changing anything", rc != 0 and "GoHighLevel connection" in r and not d, r)
rc, r, d = run(SB_SQL_SHA="0" * 64); ck("a database change that isn't the reviewed one: stops", rc != 0 and "not the reviewed build" in r and not d, r)
rc, r, d = run(mode={"public": True}); ck("if the public could read the reviews, it says so (✗)", rc != 0 and "the public can't read the background reviews" in r and "✗" in r, r)
H.shutdown()
subprocess.run(["git", "worktree", "remove", "--force", WH], cwd=HERE)
shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
