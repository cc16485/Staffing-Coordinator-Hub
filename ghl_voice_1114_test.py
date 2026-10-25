#!/usr/bin/env python3
# Rehearsal of 1114 (ghl_voice_1114.py) from a fresh copy of this commit, against a FAKE Supabase (keys, SQL, the check)
# and a fake supabase CLI. Never touches a real project.  python3 ghl_voice_1114_test.py
import json, os, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANON, SVC = "eyJanon" + "a" * 40, "eyJsvc" + "s" * 40
M = {}
ANSWER = {"read_only": True, "office": "4172348494",
  "location": {"status": 200, "error": None, "name": "Caring Companions", "business_phone": "+14172348494", "business_phone_is_office": True, "timezone": "America/Chicago"},
  "numbers": {"status": 200, "error": None, "count": 1, "office_found": True, "list": [{"phone": "+14172348494", "is_office": True, "name": "Office", "capabilities": {"voice": True}, "type": "local", "default": True}]},
  "agents": {"status": 401, "error": "The token is not authorized for this scope.", "count": 0, "list": []}}
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
        if self.path.startswith("/functions/v1/ghl-voice-probe"):
            if self.headers.get("Authorization") != "Bearer " + SVC: return self._send(403, {"error": "owner script only"})
            M["asked"] = body; return self._send(200, ANSWER)
        if self.path.endswith(f"/v1/projects/{REF}/database/query"):
            M.setdefault("sql", []).append(body["query"])
            return self._send(400, {"message": "unexpected"})
        return self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
T = tempfile.mkdtemp(prefix="reh1114-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
FNROOT = os.path.join(W, "supabase", "functions"); sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
PINS = {"ghl-voice-probe": sha(os.path.join(FNROOT, "ghl-voice-probe", "index.ts"))}
LOG = os.path.join(T, "cli.txt"); CLI = os.path.join(T, "supabase")
open(CLI, "w").write(f"#!/bin/sh\necho \"$@\" >> {LOG}\n[ -f {T}/fail ] && {{ echo boom >&2; exit 1; }}\nexit 0\n"); os.chmod(CLI, 0o755)
def run(**over):
    for f in (LOG,):
        if os.path.exists(f): os.remove(f)
    M.clear(); rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=CLI, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(PINS), SB_SETTLE="0"); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "ghl_voice_1114.py")], env=env, capture_output=True, text=True, timeout=120)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
try:
    code, out = run(SB_FN_SHAS=json.dumps({**PINS, "ghl-voice-probe": "0" * 64}))
    ck("a changed check is refused before anything runs", code == 2 and "not the reviewed build" in out and "deploy" not in cli(), out)
    open(os.path.join(T, "fail"), "w").write("1"); code, out = run(); os.remove(os.path.join(T, "fail"))
    ck("can't put it in place: stops, nothing read", code == 6 and "Nothing was read" in out and "asked" not in M, out)
    code, out = run()
    ck("DONE: in place, public key refused, then removed", code == 0 and "functions deploy ghl-voice-probe" in cli() and "functions delete ghl-voice-probe" in cli() and "refused (403)" in out and "RESULT: DONE" in out, out)
    ck("the report: the office number is on the location with voice", "the office number (417) 234-8494 is ON this location" in out and "+14172348494 (OFFICE)" in out and '"voice": true' in out, out)
    ck("the report: a refused Voice AI read is shown with its status and what it likely means", "not readable (401)" in out and "Voice AI permission" in out, out)
    ck("no SQL at all; keys never printed; says nothing was called", not M.get("sql") and ANON not in out and SVC not in out and "No call was placed" in out, out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
