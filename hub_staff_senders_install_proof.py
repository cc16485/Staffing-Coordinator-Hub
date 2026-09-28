#!/usr/bin/env python3
# Desktop 283 against a fake Supabase (Management API, Auth, the functions, the live pages). Never touches production.
import os, json, threading, subprocess, hashlib, re
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse
H = os.path.dirname(os.path.abspath(__file__)); HOME = os.path.expanduser("~/Claude/Projects")
S = {}
def setup(**k): S.clear(); S.update(dict(old=False, page_new=True, secrets={}, deployed_hub=False), **k)
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, c, o=None, text=None): b = (text if text is not None else json.dumps(o)).encode(); self.send_response(c); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urlparse(self.path)
        if u.path.endswith("/functions/outreach-check"): return self.reply(404, {})
        if "/functions/" in u.path: return self.reply(200, {"verify_jwt": not u.path.endswith("job-offer")})
        if u.path.endswith("/api-keys"): ref = u.path.split("/")[3]; return self.reply(200, [{"name": "anon", "api_key": "eyJanon." + ref}, {"name": "service_role", "api_key": "eyJsvc." + ref}])
        if u.path.startswith("/page"): return self.reply(200, text="fetch(x,{headers:{'x-hub-token':t}})" if S["page_new"] else "old page")
        self.reply(404, {})
    def do_POST(self):
        u = urlparse(self.path); body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}"); auth = self.headers.get("Authorization", "")
        if u.path.endswith("/secrets"): S["secrets"].update({x["name"]: x["value"] for x in body}); return self.reply(201, {})
        if u.path == "/auth/v1/admin/generate_link": return self.reply(200, {"hashed_token": "th"})
        if u.path == "/auth/v1/verify": return self.reply(200, {"access_token": "eyJhubsession"})
        if u.path.startswith("/auth/v1/logout"): S["out"] = True; return self.reply(204, {})
        if u.path == "/functions/v1/outreach-check": return self.reply(200, {"authorized": True}) if auth == "Bearer eyJhubsession" else self.reply(401, {})
        if u.path.startswith("/functions/v1/"):
            if S["old"]: return self.reply(200, {"status": "sent"})
            return self.reply(502, {"error": "GHL dismiss failed (404)"}) if self.headers.get("x-hub-token") == "eyJhubsession" else self.reply(401, {})
        self.reply(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"
ROOTS = {"zngsgedlsxinbygwmxwn": H, "rdqujxiycycwhskyvrwa": os.path.join(HOME, "Caring Companions Training Platform")}
FILES = ["zngsgedlsxinbygwmxwn:supabase/functions/outreach-check/index.ts", "rdqujxiycycwhskyvrwa:supabase/functions/_shared/hub-gate.ts"] + \
        [f"rdqujxiycycwhskyvrwa:supabase/functions/{f}/index.ts" for f in ("ghl-lead-comms", "ghl-reply", "job-offer")]
sha = lambda f: hashlib.sha256(open(os.path.join(ROOTS[f.split(':')[0]], f.split(':', 1)[1]), "rb").read()).hexdigest()
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-800:]))
def run(shas=None):
    rep = os.path.join(H, "_hsi.txt")
    p = subprocess.run(["python3", "hub_staff_senders_install.py"], cwd=H, capture_output=True, text=True, env=dict(os.environ, SB_TOKEN="sbp_x", SB_REPORT=rep, SB_API_BASE=BASE, SB_FN_BASE=BASE,
        SB_SKIP_FUNCTION="1", SB_ROOT_HUB=ROOTS["zngsgedlsxinbygwmxwn"], SB_ROOT_TP=ROOTS["rdqujxiycycwhskyvrwa"], SB_PROOF_EMAIL="samantha@mo-care.com",
        SB_PAGES=json.dumps({"Care Coordinator Hub": BASE + "/page1"}), SB_SHAS=json.dumps(shas or {f: sha(f) for f in FILES})))
    t = open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
setup(); rc, t = run()
ck("happy path: DONE; the new Hub function deploys with its sign-in check on, the three Training senders keep theirs; every refusal and your sign-in proven",
   rc == 0 and "RESULT: DONE" in t and "would deploy Hub outreach-check\n" in t + "\n" and "would deploy Training job-offer --no-verify-jwt" in t
   and t.count("refused, 401") == 4 and "recognises you" in t and "accepts your Hub sign-in" in t and S.get("out") and "sends your sign-in" in t, t)
ck("the Training project gets only the Hub's PUBLIC key, and no key is printed", list(S["secrets"]) == ["HUB_ANON_KEY"] and S["secrets"]["HUB_ANON_KEY"].startswith("eyJanon.zngsg") and "eyJ" not in t, t)
setup(old=True); rc, t = run()
ck("if a Training sender still accepted the old shared key, the proof fails loudly", rc == 9 and "without a Hub sign-in answered 200" in t, t)
setup(page_new=False); rc, t = run()
ck("a hub page not updated yet is reported plainly, not as a failure", rc == 0 and "has not picked up the update yet" in t, t)
setup(); bad = {f: sha(f) for f in FILES}; bad[FILES[1]] = "0" * 64; rc, t = run(bad)
ck("not the reviewed build: STOP before any secret or deploy", rc == 3 and not S["secrets"] and "would deploy" not in t, t)
srv.shutdown()
print("\nDESKTOP 283 · HUB-SIGN-IN SENDERS · INSTALL PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED")
