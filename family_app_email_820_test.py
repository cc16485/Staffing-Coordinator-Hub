#!/usr/bin/env python3
# Rehearsal of 820 (family_app_email_820.py) against a FAKE Supabase (management API + cc-family-app auth). Never touches a real project.
#   python3 family_app_email_820_test.py
import json, os, re, subprocess, tempfile, threading, http.server
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1200]))
S = {}; M = {}
KEY = "re_abcdefghijklmnop1234"
def reset(**m):
    S.clear(); S.update(auth={"disable_signup": True}, otp=[], calls=[], sql=[], ops={"family_app_live": "false", "x": 1})
    M.clear(); M.update(dict(fam=True, patch_fail=False, users=["sam@mo-care.com"], otp_code=200, bad_token=False, sqlfail=False), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def _body(self):
        n = int(self.headers.get("Content-Length") or 0); return json.loads(self.rfile.read(n) or b"null")
    def do_GET(self):
        p = self.path; S["calls"].append(("GET", p))
        if p == "/v1/projects":
            if M["bad_token"]: return self._send(401, {"message": "Unauthorized"})
            return self._send(200, [{"id": "zngsgedlsxinbygwmxwn", "name": "hub"}] + ([{"id": "famref", "name": "cc-family-app"}] if M["fam"] else []))
        if p.startswith("/v1/projects/famref/api-keys"): return self._send(200, [{"name": "anon", "api_key": "eyJanonfam"}, {"name": "service_role", "api_key": "eyJsvcfam"}])
        if p == "/v1/projects/famref/config/auth": return self._send(200, S["auth"])
        if p.startswith("/auth/v1/admin/users"):
            if self.headers.get("Authorization") != "Bearer eyJsvcfam": return self._send(401, {})
            return self._send(200, {"users": [{"id": str(i), "email": e} for i, e in enumerate(M["users"])]})
        self._send(404, {})
    def do_PATCH(self):
        b = self._body(); S["calls"].append(("PATCH", self.path, b))
        if self.path == "/v1/projects/famref/config/auth":
            if M["patch_fail"]: return self._send(400, {"message": "bad field"})
            S["auth"].update(b); return self._send(200, S["auth"])
        self._send(404, {})
    def do_POST(self):
        b = self._body(); S["calls"].append(("POST", self.path, b))
        if self.path == "/v1/projects/zngsgedlsxinbygwmxwn/database/query":
            q = b["query"]; S["sql"].append(q)
            if M["sqlfail"]: return self._send(400, {"message": "boom"})
            m = re.search(r"jsonb_build_object\('family_app_rate_MO', (\d+)\)", q)
            if m and "where key = 'ops_settings'" in q:
                S["ops"]["family_app_rate_MO"] = int(m.group(1))
                return self._send(201, [{"mo": str(S["ops"]["family_app_rate_MO"]), "live": S["ops"]["family_app_live"]}])
            return self._send(400, {"message": "unexpected"})
        if self.path == "/auth/v1/otp":
            S["otp"].append((b, self.headers.get("apikey"))); return self._send(M["otp_code"], {} if M["otp_code"] == 200 else {"msg": "Error sending magic link email"})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"; TMP = tempfile.mkdtemp(prefix="t820-")
def run(key=KEY, test="", **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FAM_BASE=URL, SB_RESEND_KEY=key, SB_TEST_EMAIL=test)
    p = subprocess.run(["python3", os.path.join(HERE, "family_app_email_820.py")], env=env, capture_output=True, text=True, timeout=60)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
writes = lambda: [c for c in S["calls"] if c[0] in ("PATCH", "POST")]

c, out = run()
ck("1 no test address: Resend saved, nothing sent", c == 0 and "820: DONE" in out and not S["otp"] and "✗" not in out, out)
a = S["auth"]
ck("1b settings: smtp.resend.com:465 user resend, noreply@mo-care.com, Caring Companions, 30/hr, key saved", a.get("smtp_host") == "smtp.resend.com" and a.get("smtp_port") == "465"
   and a.get("smtp_user") == "resend" and a.get("smtp_pass") == KEY and a.get("smtp_admin_email") == "noreply@mo-care.com" and a.get("smtp_sender_name") == "Caring Companions" and a.get("rate_limit_email_sent") == 30, a)
ck("1c only the email settings were changed (no sign-up, templates, site address)", set(S["calls"][[x[0] for x in S["calls"]].index("PATCH")][2]) == {"smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_admin_email", "smtp_sender_name", "rate_limit_email_sent"}, S["calls"])
ck("1d no key or token ever printed", KEY not in out and not re.search(r"eyJ\w|sbp_test", out), out)
ck("1e Missouri rate $30 set, other settings kept, practice mode reported", S["ops"] == {"family_app_live": "false", "x": 1, "family_app_rate_MO": 30} and len(S["sql"]) == 1 and "$30 an hour" in out and "OFF (practice)" in out, (S["ops"], out))
c, out = run(sqlfail=True)
ck("1f rate refused: reported as not complete", c == 1 and "rate not saved" in out and "NOT COMPLETE" in out, out)
c, out = run(test="Sam@mo-care.com")
ck("2 her address has a login: ONE code sent to her only, never creating a login", c == 0 and S["otp"] == [({"email": "sam@mo-care.com", "create_user": False}, "eyJanonfam")] and "handed to Resend" in out, (S["otp"], out))
c, out = run(test="someone@example.com")
ck("3 address without a login: nothing sent, tells her how to test", c == 0 and not S["otp"] and "doesn't have a family app login" in out, out)
c, out = run(test="sam@mo-care.com", otp_code=500)
ck("4 Resend refuses the send: reported as not complete with what to do", c == 1 and "NOT sent" in out and "NOT COMPLETE" in out, out)
c, out = run(key="sbp_wrongthingpasted12345")
ck("5 not a Resend key: stops before anything", c == 2 and not S["calls"] and not S["sql"], out)
c, out = run(key="")
ck("5b empty key: stops before anything", c == 2 and not S["calls"], out)
c, out = run(test="not-an-email")
ck("6 bad test address: stops before anything", c == 2 and not S["calls"], out)
c, out = run(bad_token=True)
ck("7 wrong Supabase token: stops, nothing changed", c == 2 and not writes(), out)
c, out = run(fam=False)
ck("8 no cc-family-app: stops, nothing changed", c == 2 and not writes(), out)
c, out = run(test="sam@mo-care.com", patch_fail=True)
ck("9 email settings refused: stops before the rate and any test send", c == 1 and not S["otp"] and not S["sql"] and "not saved" in out, out)
c, out = run(test="sam@mo-care.com", otp_code=429)
ck("10 too many codes just now: reported plainly", c == 1 and "too many codes" in out, out)

for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  820 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed")
raise SystemExit(0 if all(r[1] for r in res) else 1)
