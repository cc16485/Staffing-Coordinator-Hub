#!/usr/bin/env python3
# Rehearsal of 725 (runs_check_725.py), read only, against a FAKE management API.   python3 runs_check_725_test.py
import json, os, re, subprocess, tempfile, threading, http.server
HERE = os.path.dirname(os.path.abspath(__file__)); res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
Q = []; M = {}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); q = json.loads(self.rfile.read(n))["query"]; Q.append(q)
        if "avail_checkin_live" in q: return self._send(200, [{"roster": "true", "avail": "off"}])
        if "cron.job_run_details" in q: return self._send(200, [{"status": M.get("cron", "succeeded"), "at": "Thu Oct 15 03:00 am", "msg": "boom"}])
        if "automation_heartbeats" in q: return self._send(200, [{"at": "2026-10-15T08:00:05Z", "ok": M.get("ok", "true"), "note": '{"mode":"live","changes":26}'}])
        if "roster_axis_follow" in q: return self._send(200, [{"mode": "live", "at": "2026-10-15T08:00:05Z", "held": None, "changes": 0, "history": 26, "no_number": 3, "not_in": 0}])
        if "onboarding_goal" in q: return self._send(200, [{"open": 1, "total": 1}])
        if "availability_invites" in q: return self._send(200, [{"day": 24, "total": 24}])
        return self._send(400, {"message": "unexpected"})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"; tmp = tempfile.mkdtemp()
def run(**m):
    Q.clear(); M.clear(); M.update(m); rep = os.path.join(tmp, "r.txt")
    env = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FNROOT=os.path.join(HERE, "supabase/functions"), PYTHONPATH=HERE)
    p = subprocess.run(["python3", os.path.join(HERE, "runs_check_725.py")], env=env, capture_output=True, text=True, timeout=60)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
c, out = run()
ck("clean: exit 0, DONE, every job and the counts reported", c == 0 and "RESULT: DONE" in out and out.count("schedule fired") == 3 and "26 changed so far" in out and "1 open" in out and "24 in the last day" in out and "Caregiver list follows AxisCare = ON" in out, out)
ck("read only: every query is a select (no insert, update, delete, schedule)", Q and all(q.lstrip().lower().startswith("select") for q in Q) and not any(re.search(r"\b(insert|update|delete|cron\.schedule|unschedule)\b", q, re.I) for q in Q), Q)
c, out = run(cron="failed")
ck("a failed scheduled run is flagged", c == 9 and "a scheduled run failed" in out, out[-400:])
c, out = run(ok="false")
ck("a job saying not ok is flagged", c == 9 and "says not ok" in out, out[-400:])
ck("no key or token in the report", not re.search(r"eyJ\w|sbp_\w", out), out)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}"); raise SystemExit(0 if all(r[1] for r in res) else 1)
