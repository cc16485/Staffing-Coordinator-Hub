#!/usr/bin/env python3
# Rehearsal of 441 against a FAKE Supabase and a fake supabase CLI. Never touches a real project.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
git = lambda *a: subprocess.run(["git", *a], cwd=HERE, capture_output=True, text=True).stdout.strip()
BASE = "76d0e9f357d79963e89ee0e650ef4a93174d5ab6"   # the base 441 pins (before the sweep change merged)
SHAS = {"eligibility-sweep": sha(os.path.join(HERE, "supabase/functions/eligibility-sweep/index.ts")), "_shared/sweep-patch": sha(os.path.join(HERE, "supabase/functions/_shared/sweep-patch.ts"))}
SQL_SHA = sha(os.path.join(HERE, "sweep_fields.sql"))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANONK, SVCK = "eyJanon" + REF, "eyJsvc" + REF
M = {}; S = {"backfill": True, "deleted": 0}; SEEN = []
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if re.match(r"/v1/projects/\w+/functions/eligibility-sweep$", p): return self._send(200, {"verify_jwt": True, "version": 4})
        if re.match(r"/v1/projects/\w+/functions/identity-backfill$", p): return self._send(200 if S["backfill"] else 404, {})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": ANONK}, {"name": "service_role", "api_key": SVCK}])
        self._send(404, {})
    def do_DELETE(self):
        if "identity-backfill" in self.path: S["backfill"] = False; S["deleted"] += 1
        self._send(200, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path
        if p.endswith("/database/query"):
            q = json.loads(raw)["query"]; SEEN.append(q)
            if "as bsched" in q: return self._send(201, [{"live": "true" if M.get("on") else "", "sched": 0, "bsched": 1 if M.get("bsched") else 0}])
            if "identity-backfill" in q and "count(*)" in q: return self._send(201, [{"n": 0}])
            return self._send(201, [])
        if p.startswith("/fn/functions/v1/eligibility-sweep"):
            if self.headers.get("Authorization") == "Bearer " + SVCK: return self._send(200, {"mode": "DRY RUN — nothing was written or sent", "would": {"caregiver_records_written": 3}})
            return self._send(401, {"error": "not allowed"})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t441-"); LOG = os.path.join(tmp, "log")
# run the installer from a FRESH copy of this commit, as the Desktop step does (no Hub folder beside it): the first real
# 441 run stopped because a test needed ../cc-hub-live, which the rehearsal never noticed.
WT = os.path.join(tmp, "wt", "hub"); subprocess.run(["git", "worktree", "add", "-q", "--detach", WT, "HEAD"], cwd=HERE, check=True); STATE = os.path.join(tmp, "state"); CLI = os.path.join(tmp, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
cmd="$2"; fn="$3"; root="{HERE}"; base="{BASE}"
if [ "$cmd" = "download" ]; then
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  if grep -qx new "{STATE}" 2>/dev/null; then cp "$root/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$root"/supabase/functions/_shared/*.ts supabase/functions/_shared/
  else git -C "$root" show "$base:supabase/functions/$fn/index.ts" > "supabase/functions/$fn/index.ts"
    for f in $(git -C "$root" ls-tree --name-only "$base" supabase/functions/_shared/); do git -C "$root" show "$base:$f" > "$f"; done
    if [ "$BAD_LIVE" = "1" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  fi; exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$fn" >> "{LOG}"; echo new > "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
def run(keep=False, mode=None, **over):
    M.clear(); M.update(mode or {}); S.update(backfill=True, deleted=0); SEEN.clear(); open(LOG, "w").close()
    if not keep: open(STATE, "w").close()
    rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=WT, SB_BASE=BASE, SB_SHAS=json.dumps(SHAS), SB_SQL_SHA=SQL_SHA,
               SB_FN_BASE=URL + "/fn", SB_SETTLE="0", SB_REHEARSAL_SKIP_SQL_TEST="1")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(WT, "sweep_fields_441.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read().split()
rc, r, d = run(); print(r)
ck("DONE: SQL in, sweep redeployed over GitHub's copy, backfill taken down, practice run reads only", rc == 0 and "RESULT: DONE" in r and d == ["eligibility-sweep"] and S["deleted"] == 1
   and any("caregiver_sweep_patch" in q for q in SEEN) and "exactly GitHub's copy before this change" in r and "3 caregiver record(s) it would update" in r and "✗" not in r, r)
ck("the tests ran here (only ones that work from a fresh copy)", "sweep_patch_test.mjs:" in r and "g1_rule_jobs_test.mjs:" in r and "g2_approved" not in r, r)
ck("no key or token in the report", not re.search(r"eyJ|sbp_", r), r)
rc, r, d = run(keep=True); ck("run again: already had it; backfill already down is fine", rc == 0 and "already had it" in r and not d, r)
rc, r, d = run(mode={"bsched": True}); ck("a backfill schedule is removed", any("cron.unschedule" in q and "identity-backfill" in q for q in SEEN) and "schedule is removed" in r, r)
rc, r, d = run(mode={"on": True}); ck("if the sweep's switch were ON, the proof does not start a run (it would write)", "does not start a run" in r and "switch is ON" in r, r)
rc, r, d = run(BAD_LIVE="1"); ck("a live sweep that is neither GitHub's nor this build is NOT replaced", rc != 0 and "NOT changed" in r and not d and S["deleted"] == 0, r)
rc, r, d = run(SB_SQL_SHA="0" * 64); ck("a database change that isn't the reviewed one: stops", rc != 0 and "not the reviewed build" in r and not d, r)
H.shutdown(); subprocess.run(["git", "worktree", "remove", "--force", WT], cwd=HERE); shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
