#!/usr/bin/env python3
# Rehearsal of 1213 (nurse_jobs_off_1213.py) against a FAKE management API with a pretend cron.job table.
# Never touches a real project.   python3 nurse_jobs_off_1213_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
NURSE = ["daily-ghe-reminders", "rn-review-pass", "nurse-visit-check-pass"]
S = {}
def reset(jobs, fail_alter=False):
    S.clear(); S.update(jobs=dict(jobs), sql=[], fail_alter=fail_alter)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); q = json.loads(self.rfile.read(n) or b"{}")["query"]; S["sql"].append(q)
        J = S["jobs"]; names = re.findall(r"'([\w-]+)'", q)
        if q.startswith("select cron.alter_job"):
            if S["fail_alter"]: return self._send(400, {"message": "permission denied"})
            J[names[0]] = False; return self._send(201, [{"alter_job": None}])
        if "count(*)" in q: return self._send(201, [{"n": sum(1 for k, v in J.items() if v and k not in NURSE)}])
        if q.startswith("select jobname, active"): return self._send(201, [{"jobname": k, "active": v} for k, v in sorted(J.items()) if k in NURSE])
        self._send(400, {"message": "unexpected query"})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
TMP = tempfile.mkdtemp()
def run(token="sbp_fake"):
    rep = os.path.join(TMP, "report.txt")
    env = dict(os.environ, SB_TOKEN=token, SB_REPORT=rep, SB_API_BASE=f"http://127.0.0.1:{srv.server_port}")
    p = subprocess.run(["python3", os.path.join(HERE, "nurse_jobs_off_1213.py")], env=env, capture_output=True, text=True, cwd=HERE)
    return p.returncode, open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
OTHER = {"coverage-run": True, "client-journey-sweep": True, "prn-welcome": True, "old-paused": False}

reset({**OTHER, **{j: True for j in NURSE}}); code, out = run()
ck("normal run: DONE", code == 0 and "RESULT: DONE" in out, out)
ck("...all three paused", not any(S["jobs"][j] for j in NURSE), S["jobs"])
ck("...no other schedule touched", all(S["jobs"][k] == v for k, v in OTHER.items()), S["jobs"])
ck("...pauses, never deletes or unschedules", not any("unschedule" in q or "delete" in q.lower() for q in S["sql"]), S["sql"])
ck("...counts the 3 other schedules that are on", "3 other schedules are on" in out and "the other 3 schedules are as they were" in out, out)
ck("...no secret in the report", "sbp_fake" not in out, out)

code2, out2 = run()
ck("safe to run again: already paused, DONE, nothing altered", code2 == 0 and out2.count("already paused") == 3 and not any(q.startswith("select cron.alter_job") for q in S["sql"][-6:]), out2)

reset({**OTHER, "daily-ghe-reminders": True, "rn-review-pass": True}); code, out = run()
ck("a missing job is said plainly, the others still paused", code == 0 and "not scheduled (nothing to pause)" in out and not S["jobs"]["rn-review-pass"], out)

reset({**OTHER, **{j: True for j in NURSE}}, fail_alter=True); code, out = run()
ck("a failed pause stops with ✗ and the RESULT says check", code == 9 and "could not pause" in out and "CHECK THE ✗ LINES" in out, out)

code, out = run(token="nope")
ck("no token: stops before anything", code == 2 and "no Supabase access token" in out, out)

srv.shutdown()
for n, c, note in res: print(("PASS" if c else "FAIL"), "·", n, ("→ " + note) if note else "")
print(f"{sum(1 for r in res if r[1])}/{len(res)}"); raise SystemExit(0 if all(r[1] for r in res) else 1)
