#!/usr/bin/env python3
# Desktop 284 against a fake Supabase. Never touches production.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse
H = os.path.dirname(os.path.abspath(__file__)); HOME = os.path.expanduser("~/Claude/Projects"); S = {}
def setup(**k): S.clear(); S.update(dict(secrets={}, mismatch=False), **k)
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, c, o): b = json.dumps(o).encode(); self.send_response(c); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urlparse(self.path); ref = u.path.split("/")[3] if u.path.startswith("/v1/projects/") else ""
        if u.path.endswith("/secrets"):
            v = S["secrets"].get((ref, "OUTREACH_SECRET"), "")
            return self.reply(200, [{"name": "OUTREACH_SECRET", "value": hashlib.sha256((v + ("x" if S["mismatch"] and ref.startswith("lr") else "")).encode()).hexdigest()}] if v else [])
        if "/functions/" in u.path: return self.reply(200, {"verify_jwt": u.path.endswith("outreach-check")})
        if u.path.endswith("/api-keys"): return self.reply(200, [{"name": "anon", "api_key": "eyJanon." + ref}])
        self.reply(404, {})
    def do_POST(self):
        u = urlparse(self.path); body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if u.path.endswith("/secrets"): ref = u.path.split("/")[3]; [S["secrets"].__setitem__((ref, x["name"]), x["value"]) for x in body]; return self.reply(201, {})
        if u.path == "/functions/v1/outreach-check":
            sec = self.headers.get("x-outreach-secret")
            if sec is None: return self.reply(401, {})
            return self.reply(200, {"allowed": True}) if sec == S["secrets"].get(("zngsgedlsxinbygwmxwn", "OUTREACH_SECRET")) else self.reply(401, {})
        self.reply(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start(); BASE = f"http://127.0.0.1:{srv.server_address[1]}"
ROOTS = {"zngsgedlsxinbygwmxwn": H, "rdqujxiycycwhskyvrwa": os.path.join(HOME, "Caring Companions Training Platform"), "lrlczrpehjpncqixubuk": os.path.join(HOME, "HomeTogether")}
FILES = ["zngsgedlsxinbygwmxwn:supabase/functions/outreach-check/index.ts", "zngsgedlsxinbygwmxwn:supabase/functions/_shared/staff-auth.ts", "rdqujxiycycwhskyvrwa:supabase/functions/_shared/optout-gate.ts", "lrlczrpehjpncqixubuk:supabase/functions/_shared/optout-gate.ts"] + \
  [f"rdqujxiycycwhskyvrwa:supabase/functions/{f}/index.ts" for f in ("send-invite", "send-reminder", "send-certificate", "notify-cleared", "sync-axiscare")] + \
  [f"lrlczrpehjpncqixubuk:supabase/functions/{f}/index.ts" for f in ("htl-notify", "htl-apply", "htl-admin", "htl-founding-emails")]
sha = lambda f: hashlib.sha256(open(os.path.join(ROOTS[f.split(':')[0]], f.split(':', 1)[1]), "rb").read()).hexdigest()
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-800:]))
def run(shas=None):
    rep = os.path.join(H, "_ori.txt")
    p = subprocess.run(["python3", "optout_remaining_install.py"], cwd=H, capture_output=True, text=True, env=dict(os.environ, SB_TOKEN="sbp_x", SB_REPORT=rep, SB_API_BASE=BASE, SB_FN_BASE=BASE,
        SB_SKIP_FUNCTION="1", SB_ROOT_HUB=ROOTS["zngsgedlsxinbygwmxwn"], SB_ROOT_TP=ROOTS["rdqujxiycycwhskyvrwa"], SB_ROOT_HT=ROOTS["lrlczrpehjpncqixubuk"], SB_SHAS=json.dumps(shas or {f: sha(f) for f in FILES})))
    t = open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
setup(); rc, t = run()
ck("happy path: DONE; the Hub door deploys first, then 9 senders; the door refuses a wrong secret and no secret, answers with the real one",
   rc == 0 and "RESULT: DONE" in t and t.index("would deploy Hub outreach-check") < t.index("would deploy Training send-invite") and t.count("would deploy") == 10 and t.count("refused, 401") == 2 and "it answers" in t, t)
ck("the same secret went to all three projects; the Hub's public key went to Training and HomeTogether Hire; nothing secret printed",
   len({v for (r, n), v in S["secrets"].items() if n == "OUTREACH_SECRET"}) == 1 and len([1 for (r, n) in S["secrets"] if n == "OUTREACH_SECRET"]) == 3
   and all(S["secrets"].get((r, "HUB_ANON_KEY")) for r in ("rdqujxiycycwhskyvrwa", "lrlczrpehjpncqixubuk")) and "eyJ" not in t and S["secrets"][("zngsgedlsxinbygwmxwn", "OUTREACH_SECRET")] not in t, t)
setup(mismatch=True); rc, t = run()
ck("if the secret did not read back the same everywhere: STOP before any deploy", rc == 4 and "would deploy" not in t, t)
setup(); bad = {f: sha(f) for f in FILES}; bad[FILES[2]] = "0" * 64; rc, t = run(bad)
ck("not the reviewed build: STOP before any secret or deploy", rc == 3 and not S["secrets"] and "would deploy" not in t, t)
srv.shutdown()
print("\nDESKTOP 284 · LAST SENDERS OPT-OUT · INSTALL PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED")
