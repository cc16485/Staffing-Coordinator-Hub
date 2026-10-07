#!/usr/bin/env python3
# Rehearsal of 489 (lead response hours + the 5-minute clock) from a FRESH copy at the commit being tested, against a FAKE Supabase: a
# throwaway local Postgres, a fake Management API and a fake supabase CLI. Never touches a real project. (python3 leads_stage1_489_test.py)
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
M = {"version": 7, "vj": False, "patched": []}
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer sbp_fake": return self._send(401, {})
        if self.path.startswith(f"/v1/projects/{REF}/functions/lead-"): return self._send(200, {"version": M["version"], "verify_jwt": M["vj"] if self.path.endswith("lead-intake") else True})
        return self._send(404, {})
    def do_PATCH(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0)); M["patched"].append(json.loads(raw or b"{}")); M["vj"] = M["patched"][-1].get("verify_jwt"); self._send(200, {})
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        if self.path == "/bump": M["version"] += 1; M["vj"] = True; return self._send(200, {})   # a deploy without --no-verify-jwt would flip it on
        if not self.path.endswith(f"/v1/projects/{REF}/database/query"): return self._send(404, {})
        if self.headers.get("Authorization") != "Bearer sbp_fake": return self._send(401, {"message": "bad token"})
        cc = conn()
        try:
            rows = cc.run(json.loads(raw)["query"]); cols = [c["name"] for c in (cc.columns or [])]
            return self._send(201, [dict(zip(cols, r)) for r in (rows or [])])
        except DatabaseError as e:
            try: cc.run("rollback")
            except Exception: pass
            return self._send(400, {"message": str(e)[:200]})
        finally: cc.close()
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
T = tempfile.mkdtemp(prefix="reh489-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
FNROOT = os.path.join(W, "supabase", "functions"); sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
PINS = {"lead-followup": sha(os.path.join(FNROOT, "lead-followup", "index.ts")), "_shared/lead-rules.js": sha(os.path.join(FNROOT, "_shared", "lead-rules.js"))}
LOG = os.path.join(T, "deploys.txt"); CLI = os.path.join(T, "supabase")
# the fake CLI: "deploy" logs and bumps; "download" copies the worktree's function files into the cwd (so the live copy = this build)
open(CLI, "w").write(f"""#!/bin/sh
echo "$@" >> {LOG}
[ -f {T}/fail ] && {{ echo boom >&2; exit 1; }}
if [ "$2" = "deploy" ]; then
  echo "$@" | grep -q -- --no-verify-jwt || curl -s -o /dev/null -X POST {URL}/bump
  curl -s -o /dev/null -X POST {URL}/bump; exit 0
fi
if [ "$2" = "download" ]; then mkdir -p supabase/functions/_shared supabase/functions/$3
  cp {FNROOT}/$3/index.ts supabase/functions/$3/index.ts
  for f in $(grep -o "'\\.\\./_shared/[^']*'" {FNROOT}/$3/index.ts | tr -d "'" | sed 's#\\.\\./_shared/##'); do cp {FNROOT}/_shared/$f supabase/functions/_shared/$f 2>/dev/null; done
  cp {FNROOT}/_shared/lead-rules.js supabase/functions/_shared/lead-rules.js
  for f in $(grep -ho "'\\./[^']*'" {FNROOT}/_shared/*.ts | tr -d "'" | sed 's#\\./##' | sort -u); do cp {FNROOT}/_shared/$f supabase/functions/_shared/$f 2>/dev/null; done
  for f in $(grep -ho "'\\.\\./_shared/[^']*'" {FNROOT}/_shared/*.ts | tr -d "'" | sed 's#\\.\\./_shared/##' | sort -u); do cp {FNROOT}/_shared/$f supabase/functions/_shared/$f 2>/dev/null; done
  exit 0
fi
exit 0
"""); os.chmod(CLI, 0o755)
def db(q):
    c = conn()
    try: r = c.run(q); return r[0][0] if r else None
    finally: c.close()
def fresh(ops='{"inquiry_ack_live": true}'):
    c = conn(); setup(c)
    c.run("create table public.app_data(key text primary key, data jsonb, version int default 1)")
    c.run("insert into public.app_data values ('ops_settings', :d::jsonb, 1)", d=ops)
    c.close(); M.update({"version": 7, "vj": False, "patched": []})
    if os.path.exists(LOG): os.remove(LOG)
    if os.path.exists(os.path.join(T, "fail")): os.remove(os.path.join(T, "fail"))
def run(**over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_SUPA_CLI=CLI, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(PINS)); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "leads_followup_489.py")], env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
deployed = lambda: os.path.exists(LOG) and "functions deploy lead-followup" in open(LOG).read()
log = lambda: open(LOG).read() if os.path.exists(LOG) else ""
try:
    fresh(); code, out = run(SB_FN_SHAS=json.dumps(dict(PINS, **{"lead-followup": "0" * 64})))
    ck("a changed build is refused before anything runs", code == 2 and "not the reviewed build" in out and not deployed(), out)
    fresh(); code, out = run()
    ck("DONE: lead-followup deployed, nothing else", code == 0 and "RESULT: DONE" in out and "functions deploy lead-followup" in log() and "functions deploy lead-intake" not in log(), out)
    ck("...the report says the build has no nudge left and the switch stays as it was (ON stays ON)", "no Day 1 / Day 3 nudge left" in out and "the acknowledgment switch is as it was" in out and db("select data->>'inquiry_ack_live' from app_data where key='ops_settings'") == "true", out)
    ck("...no settings were written", db("select data->'lead_response_hours' from app_data where key='ops_settings'") is None, out)
    fresh(); open(os.path.join(T, "fail"), "w").write("1"); code, out = run()
    ck("a failed deploy stops and says so", code == 6 and "did not deploy cleanly" in out, out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
