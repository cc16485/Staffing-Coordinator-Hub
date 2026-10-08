#!/usr/bin/env python3
# Rehearsal of 521 (GHE oversight from AxisCare) from a FRESH copy at the commit being tested, against a FAKE Management API and a
# FAKE supabase CLI. Never touches a real project. (REHEARSE_COMMIT pins a commit; REHEARSE_BASE is what is "live")
import json, os, re, subprocess, sys, tempfile, threading, http.server, shutil, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"
COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
M = {"version": 20}; VJ0 = {"ghe-reminders": False}
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.startswith(f"/v1/projects/{REF}/api-keys"): return self._send(200, [{"name": "service_role", "api_key": "svc_fake"}, {"name": "anon", "api_key": "anon_fake"}])
        mm = re.match(f"/v1/projects/{REF}/functions/([\\w-]+)$", self.path)
        if mm and mm.group(1) in VJ0 and self.headers.get("Authorization") == "Bearer sbp_fake": return self._send(200, {"version": M["version"], "verify_jwt": M.setdefault("vj_" + mm.group(1), VJ0[mm.group(1)])})
        self._send(404, {})
    def do_PATCH(self):
        mm = re.match(f"/v1/projects/{REF}/functions/([\\w-]+)$", self.path); raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        if mm: M["vj_" + mm.group(1)] = json.loads(raw).get("verify_jwt"); return self._send(200, {})
        self._send(404, {})
    def do_POST(self):
        if self.path.startswith("/functions/v1/ghe-reminders"):
            self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
            if M.get("fn_down"): return self._send(500, {"error": "down"})
            if self.headers.get("Authorization") != "Bearer svc_fake" or "dry=1" not in self.path: return self._send(401, {"error": "not allowed"})
            return self._send(200, {"ok": True, "dry": True, "live": False, "watched": 2, "axiscare_failed": M.get("axfail", 0), "not_linked": 1, "coordinator": {"email": "krystal@mo-care.com", "why": "owner of Payer Programs"},
                "seen": [{"name": "Pat Sample", "month": "2026-11", "state": "none", "stage": "upcoming", "actions": []}, {"name": "Lou Two", "month": "2026-10", "state": "visited", "stage": "done", "actions": []}]})
        if self.path.startswith("/v1/projects/" + REF + "/database/query"):
            self.rfile.read(int(self.headers.get("Content-Length", 0) or 0)); return self._send(201, [{"data": {"ghe_watch_live": bool(M.get("sw"))}}])
        if self.path.startswith("/bump"): M["version"] += 1; q = dict(x.split("=") for x in self.path.split("?", 1)[1].split("&")); M["vj_" + q["fn"]] = (q.get("novj") == "0"); return self._send(200, {})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
T = tempfile.mkdtemp(prefix="reh521-"); W = os.path.join(T, "hub"); LIVE = os.path.join(T, "live")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
BASEC = os.environ.get("REHEARSE_BASE") or subprocess.run(["git", "merge-base", COMMIT, "origin/main"], cwd=HERE, capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "worktree", "add", "-q", "--detach", LIVE, BASEC], cwd=HERE, check=True)
FNROOT = os.path.join(W, "supabase", "functions"); sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
BASE = {}
for r_, _, fs_ in os.walk(os.path.join(LIVE, "supabase", "functions")):
    for f_ in fs_: p_ = os.path.join(r_, f_); BASE["supabase/functions/" + os.path.relpath(p_, os.path.join(LIVE, "supabase", "functions")).replace(os.sep, "/")] = sha(p_)
PINS = {"ghe-reminders/index.ts": sha(os.path.join(FNROOT, "ghe-reminders", "index.ts")), "_shared/ghe-rules.js": sha(os.path.join(FNROOT, "_shared", "ghe-rules.js"))}
LOG = os.path.join(T, "cli.txt"); CLI = os.path.join(T, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
echo "$@" >> {LOG}
[ -f {T}/fail ] && [ "$2" = "deploy" ] && {{ echo boom >&2; exit 1; }}
if [ "$2" = "deploy" ]; then touch {T}/deployed_$3; curl -s -o /dev/null -X POST "{URL}/bump?fn=$3&novj=$(echo "$@" | grep -c -- --no-verify-jwt)"; exit 0; fi
if [ "$2" = "download" ]; then SRC={LIVE}/supabase/functions; [ -f {T}/deployed_$3 ] && SRC={FNROOT}
  mkdir -p supabase/functions; cp -R $SRC/$3 supabase/functions/; cp -R $SRC/_shared supabase/functions/; [ -f {T}/drift ] && echo "// hand edit" >> supabase/functions/_shared/outreach.ts; exit 0; fi
exit 0
"""); os.chmod(CLI, 0o755)
def fresh(vj=True):
    M.clear(); M.update({"version": 20}); VJ0["client-journey"] = vj
    for f in [LOG, os.path.join(T, "fail"), os.path.join(T, "drift")] + [os.path.join(T, "deployed_" + x) for x in VJ0]:
        if os.path.exists(f): os.remove(f)
def run(**over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_SUPA_CLI=CLI, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(PINS), SB_BASE_SHAS=json.dumps(BASE), SB_FN_BASE=URL); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "ghe_watch_521.py")], env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
log = lambda: open(LOG).read() if os.path.exists(LOG) else ""
try:
    fresh(); code, out = run()
    ck("DONE: ghe-reminders deployed, nothing else", code == 0 and "RESULT: DONE" in out and log().count("functions deploy") == 1 and "✗" not in out, out)
    ck("...it kept its gateway setting (off, as its schedule calls it)", M.get("vj_ghe-reminders") is False and "--no-verify-jwt" in log(), M)
    ck("...the proof is a practice run: what it looked at, the coordinator it would warn, and no writes", "2 GHE month(s) looked at" in out and "krystal@mo-care.com (owner of Payer Programs)" in out and "Pat Sample: 2026-11" in out and "Nothing was texted or emailed" in out, out)
    ck("...the switch stays off and says it is hers", "GHE oversight is OFF (it stays off; it is yours to turn on)" in out and "(OFF, yours to turn on)" in out, out)
    fresh(); M["sw"] = True; code, out = run()
    ck("switch already on: said so", code == 0 and "GHE oversight is ON" in out and "(already ON)" in out, out)
    fresh(); M["axfail"] = 2; code, out = run()
    ck("AxisCare not answering in the practice run: flagged (never assumed missed)", code == 9 and "AxisCare did not answer" in out, out)
    fresh(); M["fn_down"] = True; code, out = run()
    ck("the practice run doesn't answer: said so", code == 9 and "the practice run did not answer" in out, out)
    fresh(); open(os.path.join(T, "drift"), "w").write("1"); code, out = run()
    ck("a live function changed since 398: stops before anything changes", code == 3 and "changed since 398" in out and "deploy" not in log(), out)
    fresh(); open(os.path.join(T, "fail"), "w").write("1"); code, out = run()
    ck("a failed deploy stops and says what stays", code == 6 and "did not deploy cleanly" in out, out)
    fresh(); code, out = run(SB_FN_SHAS=json.dumps(dict(PINS, **{"ghe-reminders/index.ts": "0" * 64})))
    ck("a changed build is refused before anything runs", code == 2 and "not the reviewed build" in out and "deploy" not in log(), out)
    fresh(); code, out = run(SB_TOKEN="nope")
    ck("no token: nothing runs", code == 2 and "deploy" not in log(), out)
finally:
    for w in (W, LIVE): subprocess.run(["git", "worktree", "remove", "--force", w], cwd=HERE)
    shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
