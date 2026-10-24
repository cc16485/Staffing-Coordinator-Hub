#!/usr/bin/env python3
# Rehearsal of 1111 (late_read_1111.py) from a fresh copy of this commit, against a FAKE Supabase (keys, SQL, the check)
# and a fake supabase CLI. Never touches a real project.  python3 late_read_1111_test.py
import json, os, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANON, SVC = "eyJanon" + "a" * 40, "eyJsvc" + "s" * 40
M = {}
ANSWER = {"read_only": True, "shift": "8:00 AM", "results": [
  {"sentence": "I can't make it today.", "before": {"kind": "cant_make_it", "sure": True, "eta": None, "quote": "I can't make it today.", "failed": False}, "reply": {"kind": "cant_make_it", "sure": True, "eta": None, "quote": None, "failed": False}},
  {"sentence": "I'll be 30 minutes late.", "before": {"kind": "late", "sure": True, "eta": "8:30 AM", "quote": None, "failed": False}, "reply": {"kind": "late", "sure": True, "eta": "8:30 AM", "quote": None, "failed": False}},
  {"sentence": "I'm not sure I can make it.", "before": {"kind": "other", "sure": False, "eta": None, "quote": None, "failed": False}, "reply": {"kind": "other", "sure": False, "eta": None, "quote": None, "failed": True}}]}
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer sbp_fake": return self._send(401, {})
        if self.path.startswith(f"/v1/projects/{REF}/api-keys"): return self._send(200, [{"name": "anon", "api_key": ANON}, {"name": "service_role", "api_key": SVC}])
        return self._send(404, {})
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0)); body = json.loads(raw or b"{}")
        if self.path.startswith("/functions/v1/late-read-probe"):
            if self.headers.get("Authorization") != "Bearer " + SVC: return self._send(403, {"error": "owner script only"})
            M["asked"] = body; return self._send(200, ANSWER)
        if self.path.endswith(f"/v1/projects/{REF}/database/query"):
            M.setdefault("sql", []).append(body["query"])
            return self._send(400, {"message": "unexpected"})
        return self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
T = tempfile.mkdtemp(prefix="reh1111-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
FNROOT = os.path.join(W, "supabase", "functions"); sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
PINS = {"late-read-probe": sha(os.path.join(FNROOT, "late-read-probe", "index.ts")), "late-watch": sha(os.path.join(FNROOT, "late-watch", "index.ts"))}
LOG = os.path.join(T, "cli.txt"); CLI = os.path.join(T, "supabase")
open(CLI, "w").write(f"#!/bin/sh\necho \"$@\" >> {LOG}\n[ -f {T}/fail ] && {{ echo boom >&2; exit 1; }}\nexit 0\n"); os.chmod(CLI, 0o755)
def run(**over):
    for f in (LOG,):
        if os.path.exists(f): os.remove(f)
    M.clear(); rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=CLI, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(PINS), SB_SETTLE="0"); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "late_read_1111.py")], env=env, capture_output=True, text=True, timeout=120)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
try:
    code, out = run(SB_FN_SHAS=json.dumps({**PINS, "late-watch": "0" * 64}))
    ck("a changed live reader is refused before anything runs", code == 2 and "not the reviewed build" in out and "deploy" not in cli(), out)
    open(os.path.join(T, "fail"), "w").write("1"); code, out = run(); os.remove(os.path.join(T, "fail"))
    ck("can't put it in place: stops, nothing read", code == 6 and "Nothing was read" in out and "asked" not in M, out)
    code, out = run()
    ck("DONE: in place, public key refused, then removed", code == 0 and "functions deploy late-read-probe" in cli() and "functions delete late-read-probe" in cli() and "refused (403)" in out and "RESULT: DONE" in out, out)
    ck("all nine sentences are sent, for an 8am shift, 30 minutes before and 7 after", len(M.get("asked", {}).get("sentences", [])) == 9 and M["asked"]["shift"] == "08:00" and M["asked"]["before_min"] == 30 and M["asked"]["after_min"] == 7, M.get("asked"))
    ck("the report shows each reading next to what she expects", "1. \"I can't make it today.\"   (you expect: can't make it)" in out and "before the shift: can't make it" in out
       and "before the shift: running late, arriving 8:30 AM" in out and "before the shift: something else, NOT SURE" in out and "as a reply: the reader did not answer" in out, out)
    ck("no SQL at all; keys never printed", not M.get("sql") and ANON not in out and SVC not in out, out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
