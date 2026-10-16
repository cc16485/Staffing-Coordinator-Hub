#!/usr/bin/env python3
# Rehearsal of 842 against a FAKE Supabase. Never touches a real project.
import json, os, subprocess, tempfile, threading, http.server, hashlib, re
HERE = os.path.dirname(os.path.abspath(__file__)); sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900])); S = {}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        S["calls"].append(("GET", self.path))
        if "/api-keys" in self.path: return self._send(200, [{"name": "service_role", "api_key": "eyJsvc"}])
        if self.path.endswith("/functions/client-address-probe"): return self._send(404 if S["deleted"] else 200, {})
        self._send(404, {})
    def do_DELETE(self): S["calls"].append(("DELETE", self.path)); S["deleted"] = True; self._send(200, {})
    def do_POST(self):
        S["calls"].append(("POST", self.path, self.headers.get("Authorization")))
        if self.path == "/functions/v1/client-address-probe":
            return self._send(200, {"status": 200, "name": "Test Client 5", "address_fields": {"residentialAddress": {"streetAddress1": "1331 N Stewart", "state": S["state"]}}})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"; TMP = tempfile.mkdtemp(); BIN = os.path.join(TMP, "supabase")
PINS = {"supabase/functions/client-address-probe/index.ts": sha(os.path.join(HERE, "supabase/functions/client-address-probe/index.ts"))}
def run(fail=False, pins=PINS, state="Missouri"):
    S.clear(); S.update(calls=[], deleted=False, state=state); rep = os.path.join(TMP, "r.txt")
    open(BIN, "w").write("#!/bin/sh\nexit %d\n" % (1 if fail else 0)); os.chmod(BIN, 0o755)
    p = subprocess.run(["python3", os.path.join(HERE, "family_address_probe_842.py")], env=dict(os.environ, SB_TOKEN="sbp_t", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
        SB_SUPA_CLI=BIN, SB_REPO=HERE, SB_PINS=json.dumps(pins), SB_SETTLE="0"), capture_output=True, text=True, timeout=60)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
c, out = run()
ck("1 reads once with the server key, prints what AxisCare sent, deletes the probe", c == 0 and '"state": "Missouri"' in out and S["deleted"] and "probe deleted again" in out and not re.search(r"eyJ\w|sbp_t\b", out), out)
c, out = run(fail=True)
ck("2 probe won't deploy: stops, calls nothing", c == 1 and not any(x[0] == "POST" for x in S["calls"]), out)
c, out = run(pins={k: "0" * 64 for k in PINS})
ck("3 not the reviewed build: nothing run", c == 2 and not S["calls"], out)
for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  842 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed"); raise SystemExit(0 if all(r[1] for r in res) else 1)
