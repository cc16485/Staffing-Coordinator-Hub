#!/usr/bin/env python3
# Rehearsal of 443 (start forms import themselves) against a FAKE Supabase, a fake Hub site and a fake supabase CLI, run
# from a FRESH copy of this commit (as the Desktop step runs).
# Never touches a real project. python3 cg_connect_install_test.py
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
git = lambda *a: subprocess.run(["git", *a], cwd=HERE, capture_output=True, text=True).stdout.strip()
BASE = "60a5da853f09c1026e8f512ec742bf81aed90e36"   # the base 443 pins
RULES = os.environ["CG_INTAKE"]
RULES_SHA = sha(RULES)
SHAS = {"intake-import": sha(os.path.join(HERE, "supabase/functions/intake-import/index.ts")),
        "_shared/intake-import": sha(os.path.join(HERE, "supabase/functions/_shared/intake-import.ts"))}
SQL_SHA = sha(os.path.join(HERE, "intake_import.sql"))
res = []; ck = lambda n, cnd, note="": res.append((n, bool(cnd), "" if cnd else str(note)[:1600]))
ANONK, SVCK = "eyJanon" + REF, "eyJsvc" + REF
MODE = {}; SEEN = []
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj, raw=None):
        b = raw if raw is not None else json.dumps(obj, default=str).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if p.startswith("/hub/intake-import-rules.js"):
            return self._send(200, None, raw=(b"// someone else's version\n" if MODE.get("old_rules") else open(RULES, "rb").read()))
        m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p)
        if m:
            deployed = m.group(1) in open(STATE).read().split()
            return self._send(200, {"verify_jwt": True, "version": 1}) if deployed else self._send(404, {})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": ANONK}, {"name": "service_role", "api_key": SVCK}])
        if re.match(r"/v1/projects/\w+/secrets", p): return self._send(200, [{"name": n} for n in MODE.get("secrets", ["HUB_JOB_SECRET", "OFFERS_PROJECT_URL", "OFFERS_SERVICE_ROLE_KEY"])])
        if p.startswith("/fn/rest/v1/"): return self._send(401, {"message": "permission denied"})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path
        if p.endswith("/database/query"):
            q = json.loads(raw)["query"]; SEEN.append(q)
            if "as vault" in q: return self._send(201, [{"vault": 1, "safe": MODE.get("safe", True), "g2": True, "lock": 0 if MODE.get("nolock") else 3}])
            if q.startswith("begin;"): return self._send(201, [])
            if "select sha256 from public.rules_approved" in q: return self._send(201, [{"sha256": RULES_SHA}])
            if "from cron.job where jobname" in q and "select schedule" in q:
                return self._send(201, [{"schedule": "*/5 * * * *", "command": "select net.http_post(... 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets ...))"}])
            if "net.http_post" in q and "as id" in q: return self._send(201, [{"id": 5}])
            if "net._http_response" in q: return self._send(201, [{"status_code": 200, "content": json.dumps({"ok": True, "caller": "cron"})}])
            if "intake_auto_import_live" in q: return self._send(201, [{"live": "true" if MODE.get("live_on") else ""}])
            if "intake_auto_import_from" in q: return self._send(201, [{"f": "2026-10-04T07:00:00Z"}])
            if "from intake_import_log where result = 'done'" in q: return self._send(201, [{"n": 0}])
            if "from intake_import_runs" in q: return self._send(201, [{"ok": True, "mode": "practice"}])
            return self._send(201, [])
        if p.startswith("/fn/functions/v1/intake-import"):
            auth = self.headers.get("Authorization", "")
            if auth == "Bearer " + SVCK and "auth_check" not in p:
                return self._send(200, {"ok": True, "mode": "practice", "seen": 0, "imported": 0, "cards": 0, "done": 0})
            return self._send(401, {"error": "not allowed"})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t443-"); LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "deployed"); open(STATE, "w").close()
WT = os.path.join(tmp, "wt", "hub"); subprocess.run(["git", "worktree", "add", "-q", "--detach", WT, "HEAD"], cwd=HERE, check=True)
CLI = os.path.join(tmp, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
cmd="$2"; fn="$3"; root="{HERE}"
if [ "$cmd" = "download" ]; then
  if grep -qx "$fn" "{STATE}" 2>/dev/null; then
    mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
    cp "$root/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$root"/supabase/functions/_shared/*.ts supabase/functions/_shared/
    if [ "$BAD_LIVE" = "1" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
    exit 0
  fi
  exit 1
fi
if [ "$cmd" = "deploy" ]; then echo "$fn" >> "{LOG}"; echo "$fn" >> "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
def run(keep=False, mode=None, **over):
    MODE.clear(); MODE.update(mode or {}); SEEN.clear()
    open(LOG, "w").close()
    if not keep: open(STATE, "w").close()
    rep = os.path.join(tmp, "report.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=WT, SB_BASE=BASE, SB_SHAS=json.dumps(SHAS),
               SB_SQL_SHA=SQL_SHA, SB_RULES_SHA=RULES_SHA, SB_FN_BASE=URL + "/fn", SB_HUB_BASE=URL + "/hub/", SB_SETTLE="0", SB_POLL="0.05",
               SB_REHEARSAL_SKIP_SQL_TEST="1")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(WT, "intake_import_443.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read().split()
rc, r, d = run(); print(r)
ck("DONE: the database change, the fingerprint approved, the check created and scheduled every 5 minutes, the start date set", rc == 0 and "RESULT: DONE" in r and d == ["intake-import"]
   and any(q.startswith("begin;") and "candidate_import_apply" in q for q in SEEN) and any("insert into public.rules_approved" in q and RULES_SHA in q for q in SEEN)
   and any("cron.schedule('intake-import', '*/5 * * * *'" in q for q in SEEN) and any("intake_auto_import_from" in q and "not (data ? 'intake_auto_import_from')" in q for q in SEEN), r)
ck("the check's tests ran here (from a fresh copy) against the live rules file", "intake_import_test.mjs:" in r and "passed" in r, r)
ck("every proof line passed; the practice pass printed counts only", "✗" not in r and "one practice pass (imports nobody): 0 start form(s)" in r and "nobody was imported or carded" in r, r)
ck("no email, key or token in the report", not re.search(r"eyJ|sbp_|@", r), r)
rc, r, d = run(keep=True); ck("run again: already there, not redeployed; still DONE", rc == 0 and "already there" in r and not d and "RESULT: DONE" in r, r)
rc, r, d = run(mode={"old_rules": True}); ck("the Hub's rules file not live yet: stops before changing anything", rc != 0 and "not the reviewed one yet" in r and not d and not any(q.startswith("begin;") for q in SEEN), r)
rc, r, d = run(mode={"nolock": True}); ck("the 442 lock not on: stops before changing anything", rc != 0 and "lock on whole-list saves (442)" in r and not d, r)
rc, r, d = run(mode={"secrets": ["HUB_JOB_SECRET"]}); ck("no job offers connection: stops before changing anything", rc != 0 and "job offers connection" in r and not d, r)
rc, r, d = run(SB_SQL_SHA="0" * 64); ck("a database change that isn't the reviewed one: stops", rc != 0 and "intake_import.sql is not the reviewed build" in r and not d, r)
rc, r, d = run(mode={"live_on": True}); ck("if the switch were somehow on, it says so as a ✗", "the switch is OFF" in r and "✗" in r, r)
H.shutdown(); subprocess.run(["git", "worktree", "remove", "--force", WT], cwd=HERE); shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED")
sys.exit(0 if all(x[1] for x in res) else 1)
