#!/usr/bin/env python3
# Proof of Desktop 306 against fake pages and a fake Supabase. Never touches production.
import os, sys, json, subprocess, tempfile, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
H = os.path.dirname(os.path.abspath(__file__)); ST = {"old": True, "page_old": False, "deleted": 0}
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj, raw=None):
        b = (raw if raw is not None else json.dumps(obj)).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.startswith("/page"): return self.send(200, None, "<html>" + ("axiscare-convert-lead" if ST["page_old"] else "axiscare-note") + "</html>")
        if self.path.endswith("/functions/axiscare-note"): return self.send(200, {"version": 1})
        if self.path.endswith("/functions/axiscare-convert-lead"): return self.send(200, {"version": 10}) if ST["old"] else self.send(404, {})
        self.send(404, {})
    def do_DELETE(self):
        if self.path.endswith("/functions/axiscare-convert-lead"): ST["old"] = False; ST["deleted"] += 1; return self.send(200, {})
        self.send(404, {})
srv = ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start(); base = f"http://127.0.0.1:{srv.server_port}"
res = []
def ck(n, c, note=""): res.append((n, bool(c), "" if c else str(note)[:500]))
def run():
    rep = tempfile.mktemp()
    p = subprocess.run([sys.executable, os.path.join(H, "retire_training_convert.py")], capture_output=True, text=True,
        env=dict(os.environ, SB_REPORT=rep, SB_TOKEN="t", SB_API_BASE=base, SB_PAGES=json.dumps([base + "/page/a", base + "/page/b"])))
    return p.returncode, open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
ST["page_old"] = True; rc, out = run()
ck("a live page still using the old route: stops, nothing deleted", rc == 4 and ST["deleted"] == 0 and "STILL uses it" in out, out)
ST["page_old"] = False; rc, out = run()
ck("pages clean and the new sender deployed: the old function is deleted and confirmed gone", rc == 0 and ST["deleted"] == 1 and "RESULT: RETIRED" in out and "✗" not in out, out)
rc, out = run(); ck("running it again: says it was already gone, deletes nothing", rc == 0 and ST["deleted"] == 1 and "already gone" in out, out)
srv.shutdown()
for n, ok, note in res: print(("PASS" if ok else "FAIL") + " · " + n + ("" if ok else "  ::  " + note))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
