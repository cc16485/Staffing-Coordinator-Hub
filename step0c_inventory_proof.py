#!/usr/bin/env python3
# Desktop 279 (0c production-wide check, read only) against a fake Management API. Never touches production.
import os, json, threading, subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse
H = os.path.dirname(os.path.abspath(__file__)); S = {}
PROJ = [{"id": "zngsgedlsxinbygwmxwn", "name": "CC Hub", "status": "ACTIVE_HEALTHY"}, {"id": "rdqujxiycycwhskyvrwa", "name": "Training Platform", "status": "ACTIVE_HEALTHY"}]
FNS = {"zngsgedlsxinbygwmxwn": [{"slug": "lead-intake", "updated_at": 1790000000000, "verify_jwt": False}, {"slug": "send-candidate-message", "updated_at": 1790000000000, "verify_jwt": True},
                                {"slug": "mystery-sender", "updated_at": 1780000000000, "verify_jwt": False}, {"slug": "calls-feed", "updated_at": 1780000000000, "verify_jwt": True}],
       "rdqujxiycycwhskyvrwa": [{"slug": "send-reminder", "updated_at": 1780000000000, "verify_jwt": False}]}
JOBS = {"zngsgedlsxinbygwmxwn": [{"jobname": "lead-followup", "schedule": "*/15 * * * *", "active": True, "command": "select net.http_post(url := 'https://x.supabase.co/functions/v1/lead-intake', headers := jsonb_build_object('Authorization','Bearer eyJsecretjwt.abc'))"}],
        "rdqujxiycycwhskyvrwa": [{"jobname": "reminders", "schedule": "0 9 * * *", "active": False, "command": "select net.http_post(url := 'https://y/functions/v1/send-reminder?token=htorder_abcdef1234567890abcd')"}]}
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urlparse(self.path)
        if S.get("crash") and u.path.endswith("/functions") and "rdq" in u.path: return self.reply(200, [{"slug": None, "updated_at": "garbage"}]) if False else self.reply(200, "not-a-list-but-a-string")
        if u.path == "/v1/projects": return self.reply(200, PROJ)
        for ref in FNS:
            if u.path == f"/v1/projects/{ref}/functions": return self.reply(200, FNS[ref])
        self.reply(404, {})
    def do_POST(self):
        u = urlparse(self.path); self.rfile.read(int(self.headers.get("Content-Length") or 0))
        for ref in JOBS:
            if u.path == f"/v1/projects/{ref}/database/query": return self.reply(201, JOBS[ref])
        self.reply(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-900:]))
def run(token="sbp_x"):
    rep = os.path.join(H, "_0c.txt")
    p = subprocess.run(["python3", "step0c_inventory.py"], cwd=H, capture_output=True, text=True, env=dict(os.environ, SB_TOKEN=token, SB_REPORT=rep,
        SB_API_BASE=f"http://127.0.0.1:{srv.server_address[1]}", SB_INVENTORY=os.path.join(H, "step0c_known.json")))
    t = open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
rc, t = run()
ck("lists every project, the Hub first, and every deployed function with when it was deployed and its sign-in check", rc == 0 and "CC Hub (zngsgedlsxinbygwmxwn)  ← the Hub" in t and t.index("── CC Hub") < t.index("── Training Platform") and "lead-intake" in t and "sign-in check ON" in t, t)
ck("marks each against the reviewed list: protected sender, reads only, and flags anything unknown", "in the inventory · checks opt-outs" in t and "reads only · sends nothing" in t and "? mystery-sender" in t and "NOT IN THE INVENTORY" in t, t)
ck("functions in OTHER projects are not assumed known (they are flagged for a look)", "? send-reminder" in t and "RESULT: 2 deployed function(s) are not in the reviewed inventory" in t, t)
ck("shows which function each scheduled job calls (and a paused job as PAUSED) without printing job commands, keys or tokens",
   "runs: lead-followup */15 * * * *" in t and "(PAUSED)" in t and "eyJsecret" not in t and "htorder_" not in t and "Bearer" not in t, t)
rc, t = run(token="nope")
ck("a wrong kind of token: nothing is read", rc == 1 and "Nothing was read" in t, t)
S["crash"] = True; rc, t = run(); S["crash"] = False
ck("an unexpected answer never crashes silently: the report is still written", "Training Platform" in t and ("could not list its functions" in t or "stopped unexpectedly" in t), t)
srv.shutdown()
print("\nDESKTOP 279 · 0c PRODUCTION-WIDE CHECK · PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED")
