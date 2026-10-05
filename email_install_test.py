#!/usr/bin/env python3
# Rehearsal of 351 (email_install.py): Part 1 reads the REAL public DNS of mo-care.com (read only); Supabase is a FAKE
# local server, so nothing is changed and no email is sent. Also checks the older/newer Resend record styles offline.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
CFG = {}; SEEN = []
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.endswith("/config/auth"): return self._send(200, CFG or {"smtp_host": None, "rate_limit_email_sent": 2})
        if "/api-keys" in self.path: return self._send(200, [{"name": "anon", "api_key": "eyJfakeanon"}])
        if self.path.startswith("/dns"):
            q = dict(x.split("=", 1) for x in self.path.split("?", 1)[1].split("&")); n, t = q["name"], q["type"]
            ans = FAKE_DNS.get((n, t), []); return self._send(200, {"Answer": [{"type": {"TXT": 16, "MX": 15, "CNAME": 5}[t], "data": d} for d in ans]})
        self._send(404, {})
    def do_PATCH(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n)); SEEN.append(("PATCH", b)); CFG.update(b); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); self.rfile.read(n); SEEN.append(("POST", self.path)); self._send(200, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
sha = lambda p: hashlib.sha256(open(os.path.join(HERE, p), "rb").read()).hexdigest()
SH = json.dumps({"email/invite.html": sha("email/invite.html"), "email/recovery.html": sha("email/recovery.html")})
FAKE_DNS = {}
def run(doh=None):
    CFG.clear(); SEEN.clear(); rep = tempfile.mktemp()
    env = dict(os.environ, SB_REPORT=rep, SB_REPO=HERE, SB_FILE_SHAS=SH, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_FN_BASE=URL, SB_ASK="0",
               SB_RESEND_KEY="re_" + "x" * 30, SB_TEST_EMAIL="test@example.test")
    if doh: env["SB_DOH"] = doh
    p = subprocess.run([sys.executable, os.path.join(HERE, "email_install.py")], env=env, capture_output=True, text=True)
    return p.returncode, open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
rc, r = run(); print(r)
ck("against the REAL mo-care.com records: every check passes (Google SPF, Google DKIM, DMARC, Resend's newer records)", "✗" not in r.split("PART 2")[0] and "PART 2" in r, r)
ck("then (fake Supabase) sign-in emails switch to Resend as noreply@mo-care.com, 30 an hour, her wording", any(m == "PATCH" and b.get("smtp_host") == "smtp.resend.com" and b.get("smtp_admin_email") == "noreply@mo-care.com" and b.get("rate_limit_email_sent") == 30 for m, b in SEEN), SEEN)
ck("no key or address in the report", not re.search(r"re_x{6}|test@example|sbp_|eyJ", r), r)
OLD = {("mo-care.com", "TXT"): ['"v=spf1 include:_spf.google.com ~all"'], ("google._domainkey.mo-care.com", "TXT"): ['"v=DKIM1; k=rsa; p=AB"'],
       ("_dmarc.mo-care.com", "TXT"): ['"v=DMARC1; p=none"'], ("resend._domainkey.mo-care.com", "TXT"): ['"p=MIG"'], ("mo-care.com", "MX"): ["1 smtp.google.com."],
       ("send.mo-care.com", "MX"): ["10 feedback-smtp.us-east-1.amazonses.com."], ("send.mo-care.com", "TXT"): ['"v=spf1 include:amazonses.com ~all"']}
FAKE_DNS.clear(); FAKE_DNS.update(OLD); rc, r = run(URL + "/dns")
ck("the older Resend setup (MX + TXT on send) is still accepted", "PART 2" in r and "✗" not in r.split("PART 2")[0], r)
FAKE_DNS.clear(); FAKE_DNS.update({k: v for k, v in OLD.items() if k[0] != "send.mo-care.com"}); rc, r = run(URL + "/dns")
ck("Resend's send record missing: stops before changing anything, and says to add it in GoHighLevel", rc != 0 and "NOT YET" in r and "GoHighLevel" in r and not SEEN, r)
H.shutdown()
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
