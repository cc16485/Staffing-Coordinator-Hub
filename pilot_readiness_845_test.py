#!/usr/bin/env python3
# Rehearsal of 845 against a FAKE Supabase. Never touches a real project.
import json, os, subprocess, tempfile, threading, http.server, hashlib, re
HERE = os.path.dirname(os.path.abspath(__file__)); sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900])); S = {}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if "/api-keys" in self.path: return self._send(200, [{"name": "service_role", "api_key": "eyJsvc"}])
        if self.path.endswith("/functions/pilot-readiness"): return self._send(404 if S["deleted"] else 200, {})
        self._send(404, {})
    def do_DELETE(self): S["deleted"] = True; self._send(200, {})
    def do_POST(self):
        S["calls"].append(self.headers.get("Authorization"))
        return self._send(200, {"ok": True, "text": "READY FOR THE APP: 1 of 2 active clients\n  ✓ Dorothy Ray (AxisCare #501)"}) if not S["fail"] else self._send(502, {"error": "AxisCare clients: 500"})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"; TMP = tempfile.mkdtemp(); BIN = os.path.join(TMP, "supabase")
FILES = ["supabase/functions/pilot-readiness/index.ts", "supabase/functions/_shared/pilot-readiness.ts"]; PINS = {f: sha(os.path.join(HERE, f)) for f in FILES}
def run(fail=False, dfail=False, pins=PINS):
    S.clear(); S.update(deleted=False, calls=[], fail=fail); rep = os.path.join(TMP, "r.txt")
    open(BIN, "w").write("#!/bin/sh\nexit %d\n" % (1 if dfail else 0)); os.chmod(BIN, 0o755)
    p = subprocess.run(["python3", os.path.join(HERE, "pilot_readiness_845.py")], env=dict(os.environ, SB_TOKEN="sbp_t", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
        SB_SUPA_CLI=BIN, SB_REPO=HERE, SB_PINS=json.dumps(pins), SB_SETTLE="0"), capture_output=True, text=True, timeout=60)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
c, out = run()
ck("1 report printed, reader deleted, key never printed", c == 0 and "READY FOR THE APP: 1 of 2" in out and S["deleted"] and S["calls"] == ["Bearer eyJsvc"] and "eyJsvc" not in out, out)
c, out = run(fail=True)
ck("2 the check fails: says so, reader still deleted", c == 1 and "didn't finish" in out and S["deleted"], out)
c, out = run(dfail=True)
ck("3 reader won't deploy: stops, calls nothing", c == 1 and not S["calls"], out)
c, out = run(pins={f: "0" * 64 for f in FILES})
ck("4 not the reviewed build: nothing run", c == 2 and not S["calls"], out)
for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  845 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed"); raise SystemExit(0 if all(r[1] for r in res) else 1)
