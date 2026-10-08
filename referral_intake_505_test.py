#!/usr/bin/env python3
# Rehearsal of 505 (web referrals fixed) from a FRESH copy at the commit being tested, against a FAKE Management API and a
# FAKE supabase CLI. Never touches a real project. (REHEARSE_COMMIT pins a commit; REHEARSE_BASE is what is "live")
import json, os, re, subprocess, sys, tempfile, threading, http.server, shutil, hashlib
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"
COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
M = {"version": 20}; VJ0 = {"lead-intake": False}
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        mm = re.match(f"/v1/projects/{REF}/functions/([\\w-]+)$", self.path)
        if mm and mm.group(1) in VJ0 and self.headers.get("Authorization") == "Bearer sbp_fake": return self._send(200, {"version": M["version"], "verify_jwt": M.setdefault("vj_" + mm.group(1), VJ0[mm.group(1)])})
        self._send(404, {})
    def do_PATCH(self):
        mm = re.match(f"/v1/projects/{REF}/functions/([\\w-]+)$", self.path); raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        if mm: M["vj_" + mm.group(1)] = json.loads(raw).get("verify_jwt"); return self._send(200, {})
        self._send(404, {})
    def do_POST(self):
        if self.path.endswith(f"/v1/projects/{REF}/database/query"):
            raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
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
        if self.path.startswith("/bump"): M["version"] += 1; q = dict(x.split("=") for x in self.path.split("?", 1)[1].split("&")); M["vj_" + q["fn"]] = (q.get("novj") == "0"); return self._send(200, {})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
T = tempfile.mkdtemp(prefix="reh500-"); W = os.path.join(T, "hub"); LIVE = os.path.join(T, "live")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
BASEC = os.environ.get("REHEARSE_BASE") or subprocess.run(["git", "merge-base", COMMIT, "origin/main"], cwd=HERE, capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "worktree", "add", "-q", "--detach", LIVE, BASEC], cwd=HERE, check=True)
FNROOT = os.path.join(W, "supabase", "functions"); sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
BASE = {}
for r_, _, fs_ in os.walk(os.path.join(LIVE, "supabase", "functions")):
    for f_ in fs_: p_ = os.path.join(r_, f_); BASE["supabase/functions/" + os.path.relpath(p_, os.path.join(LIVE, "supabase", "functions")).replace(os.sep, "/")] = sha(p_)
PINS = {"lead-intake/index.ts": sha(os.path.join(FNROOT, "lead-intake", "index.ts")), "_shared/lead-rules.js": sha(os.path.join(FNROOT, "_shared", "lead-rules.js"))}
LOG = os.path.join(T, "cli.txt"); CLI = os.path.join(T, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
echo "$@" >> {LOG}
[ -f {T}/fail ] && [ "$2" = "deploy" ] && {{ echo boom >&2; exit 1; }}
if [ "$2" = "deploy" ]; then touch {T}/deployed_$3; curl -s -o /dev/null -X POST "{URL}/bump?fn=$3&novj=$(echo "$@" | grep -c -- --no-verify-jwt)"; exit 0; fi
if [ "$2" = "download" ]; then SRC={LIVE}/supabase/functions; [ -f {T}/deployed_$3 ] && SRC={FNROOT}
  mkdir -p supabase/functions; cp -R $SRC/$3 supabase/functions/; cp -R $SRC/_shared supabase/functions/; [ -f {T}/drift ] && echo "// hand edit" >> supabase/functions/_shared/lead-rules.js; exit 0; fi
exit 0
"""); os.chmod(CLI, 0o755)
def fresh(vj=True):
    c = conn(); setup(c)
    c.run("create table if not exists public.app_data(key text primary key, data jsonb, version int default 1)"); c.run("delete from public.app_data")
    c.run("""insert into public.app_data values ('leads', '[{"id":"o1","first_name":"Lisa","last_name":"Marsh","source":"Website","created_at":"2026-09-30T10:00:00Z","interest_notes":"PROFESSIONAL REFERRAL, Hospital\\nUrgency: Urgent"},{"id":"o2","first_name":"Mary","source":"Website","created_at":"2026-10-01T10:00:00Z","interest_notes":"help for dad"}]'::jsonb, 1)""")
    c.close(); M.clear(); M.update({"version": 20}); VJ0["lead-intake"] = vj
    for f in [LOG, os.path.join(T, "fail"), os.path.join(T, "drift")] + [os.path.join(T, "deployed_" + x) for x in VJ0]:
        if os.path.exists(f): os.remove(f)
def run(**over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_SUPA_CLI=CLI, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(PINS), SB_BASE_SHAS=json.dumps(BASE)); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "referral_intake_505.py")], env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
log = lambda: open(LOG).read() if os.path.exists(LOG) else ""
def leads():
    c = conn()
    try: return c.run("select data from public.app_data where key = 'leads'")[0][0]
    finally: c.close()
try:
    fresh(vj=False); before = leads(); code, out = run()
    ck("DONE: lead-intake deployed, nothing else", code == 0 and "RESULT: DONE" in out and log().count("functions deploy") == 1 and "✗" not in out, out)
    ck("...its gateway check stays OFF (the public form can't sign in)", M.get("vj_lead-intake") is False and "--no-verify-jwt" in log(), M)
    ck("...older web referrals filed the old way are LISTED (Lisa Marsh), and no record is changed", "older web referrals filed the old way" in out and "Lisa Marsh (actually the referrer)" in out and "Mary" not in out.split("older web referrals")[1].split("PART 2")[0] and leads() == before, out)
    code, out = run()
    ck("run again: safe", code == 0 and "RESULT: DONE" in out, out)
    fresh(vj=False); open(os.path.join(T, "drift"), "w").write("1"); code, out = run()
    ck("a live lead-intake that differs from the reviewed main: stops before anything changes", code == 3 and "differs from the reviewed main" in out and "deploy" not in log(), out)
    fresh(vj=False); open(os.path.join(T, "fail"), "w").write("1"); code, out = run()
    ck("a failed deploy stops and says what stays", code == 6 and "did not deploy cleanly" in out, out)
    fresh(vj=False); code, out = run(SB_FN_SHAS=json.dumps(dict(PINS, **{"lead-intake/index.ts": "0" * 64})))
    ck("a changed build is refused before anything runs", code == 2 and "not the reviewed build" in out and "deploy" not in log(), out)
    fresh(vj=False); code, out = run(SB_TOKEN="nope")
    ck("no token: nothing runs", code == 2 and "deploy" not in log(), out)
finally:
    for w in (W, LIVE): subprocess.run(["git", "worktree", "remove", "--force", w], cwd=HERE)
    shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
