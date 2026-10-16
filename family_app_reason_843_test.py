#!/usr/bin/env python3
# Rehearsal of 843 against a FAKE Supabase. Never touches a real project.
import json, os, subprocess, tempfile, threading, http.server, hashlib, re
HERE = os.path.dirname(os.path.abspath(__file__)); sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900])); S = {}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if "/api-keys" in self.path: return self._send(200, [{"name": "service_role", "api_key": "eyJsvc"}])
        if self.path.endswith("/functions/visit-reasons-probe"): return self._send(404 if S["deleted"] else 200, {})
        self._send(404, {})
    def do_DELETE(self): S["deleted"] = True; self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/functions/v1/visit-reasons-probe": return self._send(200, {"status": 200, "reasons": S["reasons"]})
        if self.path.endswith("/database/query"):
            S["sql"].append(b["query"]); m = re.search(r"'family_app_create_reason', '([^']+)'", b["query"]); return self._send(201, [{"r": m.group(1)}])
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"; TMP = tempfile.mkdtemp(); BIN = os.path.join(TMP, "supabase")
PINS = {"supabase/functions/visit-reasons-probe/index.ts": sha(os.path.join(HERE, "supabase/functions/visit-reasons-probe/index.ts"))}
BASE = [{"id": 1, "name": "Schedule Change - Client Cancellation", "disabled": False}]
def run(reasons, fail=False):
    S.clear(); S.update(deleted=False, sql=[], reasons=reasons); rep = os.path.join(TMP, "r.txt")
    open(BIN, "w").write("#!/bin/sh\nexit %d\n" % (1 if fail else 0)); os.chmod(BIN, 0o755)
    p = subprocess.run(["python3", os.path.join(HERE, "family_app_reason_843.py")], env=dict(os.environ, SB_TOKEN="sbp_t", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
        SB_SUPA_CLI=BIN, SB_REPO=HERE, SB_PINS=json.dumps(PINS), SB_SETTLE="0"), capture_output=True, text=True, timeout=60)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
c, out = run(BASE + [{"id": 9, "name": "Booked by Family in App ", "disabled": False}])
ck("1 reason there (any capitals/spaces): setting saved with AxisCare's exact name, reader deleted", c == 0 and "Booked by Family in App" in S["sql"][0] and S["deleted"] and "843: DONE" in out, out)
c, out = run(BASE)
ck("2 reason missing: lists what AxisCare has, changes nothing", c == 1 and "Schedule Change - Client Cancellation" in out and not S["sql"] and S["deleted"], out)
c, out = run(BASE + [{"id": 9, "name": "Booked by family in app", "disabled": True}])
ck("3 reason switched off: says so, changes nothing", c == 1 and "switched off" in out and not S["sql"], out)
c, out = run(BASE, fail=True)
ck("4 reader won't deploy: stops", c == 1 and not S["sql"], out)
for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  843 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed"); raise SystemExit(0 if all(r[1] for r in res) else 1)
