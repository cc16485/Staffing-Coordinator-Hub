#!/usr/bin/env python3
# Rehearsal of 801 (family_app_801.py) against a FAKE Supabase (management API, Hub functions, cc-family-app sign-in) and a
# FAKE supabase CLI. Never touches a real project.   python3 family_app_801_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1200]))
S = {}; M = {}
def reset(**m):
    S.clear(); S.update(auth={}, secrets={}, sql=[], deployed={}, calls=[])
    M.clear(); M.update(dict(fam=True, sqlfail=False, cors=True, gw_open=False, signup_on=False, patch_fail=False), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj, hdr=None):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json")
        for k, v in (hdr or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)
    def _body(self):
        n = int(self.headers.get("Content-Length") or 0); return json.loads(self.rfile.read(n) or b"null")
    def do_OPTIONS(self):
        S["calls"].append(("OPTIONS", self.path))
        return self._send(200, "ok", {"Access-Control-Allow-Origin": self.headers.get("Origin") if M["cors"] else "*"})
    def do_GET(self):
        p = self.path; S["calls"].append(("GET", p))
        if p == "/v1/projects": return self._send(200, [{"id": "zngsgedlsxinbygwmxwn", "name": "hub"}] + ([{"id": "famref", "name": "cc-family-app"}] if M["fam"] else []))
        if "/api-keys" in p:
            ref = p.split("/")[3]; return self._send(200, [{"name": "anon", "api_key": f"eyJanon{ref}"}, {"name": "service_role", "api_key": f"eyJsvc{ref}"}])
        if p == "/v1/projects/famref/config/auth": return self._send(200, S["auth"])
        if p == "/v1/projects/zngsgedlsxinbygwmxwn/secrets": return self._send(200, [{"name": k, "value": "digest"} for k in S["secrets"]])
        if m := re.match(r"/v1/projects/zngsgedlsxinbygwmxwn/functions/([\w-]+)$", p):
            dp = os.path.join(TMP, "deploys")
            if os.path.exists(dp):
                for ln in open(dp).read().splitlines():
                    f2, nov = json.loads(ln); S["deployed"][f2] = not nov
            fn = m.group(1); return self._send(200, {"slug": fn, "verify_jwt": S["deployed"][fn]}) if fn in S["deployed"] else self._send(404, {})
        self._send(404, {})
    def do_PATCH(self):
        b = self._body(); S["calls"].append(("PATCH", self.path))
        if self.path == "/v1/projects/famref/config/auth":
            if M["patch_fail"]: return self._send(400, {"message": "bad field"})
            S["auth"].update(b); return self._send(200, S["auth"])
        self._send(404, {})
    def do_POST(self):
        b = self._body(); p = self.path; S["calls"].append(("POST", p, self.headers.get("Authorization")))
        if p == "/v1/projects/zngsgedlsxinbygwmxwn/secrets":
            for x in b: S["secrets"][x["name"]] = x["value"]
            return self._send(201, {})
        if p == "/v1/projects/zngsgedlsxinbygwmxwn/database/query":
            q = b["query"]; S["sql"].append(q)
            if "family_bookings (" in q: return self._send(400, {"message": "boom"}) if M["sqlfail"] else self._send(201, [])
            if q.startswith("select (select count(*)"): return self._send(200, [{"cols": 5, "tbl": True, "live": "false", "mo": "PP - WC"}])
            return self._send(400, {"message": "unexpected"})
        if p == "/functions/v1/family-gateway": return self._send(200 if M["gw_open"] else 401, {"error": "Please sign in again."})
        if p == "/functions/v1/family-app-office": return self._send(401, {"error": "not signed in"})
        if p == "/auth/v1/signup": return self._send(200, {"id": "x"}) if M["signup_on"] else self._send(422, {"msg": "Signups not allowed for this instance"})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t801-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN)
open(os.path.join(BIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, json, urllib.request
a = sys.argv[1:]
if a[:2] == ['functions', 'deploy']:
    open({os.path.join(TMP, 'deploys')!r}, 'a').write(json.dumps([a[2], '--no-verify-jwt' in a]) + '\\n'); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(BIN, "supabase"), 0o755)
FILES = ["supabase/functions/family-gateway/index.ts", "supabase/functions/family-app-office/index.ts", "supabase/functions/_shared/family-app.ts",
         "supabase/functions/_shared/family-app-office.ts", "family_app_1a.sql", "family-app/email/code.html"]
PINS = {f: sha(os.path.join(HERE, f)) for f in FILES}
def run(pins=PINS, resend="", **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt"); dp = os.path.join(TMP, "deploys")
    if os.path.exists(dp): os.remove(dp)
    env = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_FAM_BASE=URL, SB_SUPA_CLI=os.path.join(BIN, "supabase"),
               SB_REPO=HERE, SB_PINS=json.dumps(pins), SB_RESEND_KEY=resend, SB_SETTLE="0.3")
    p = subprocess.run(["python3", os.path.join(HERE, "family_app_801.py")], env=env, capture_output=True, text=True, timeout=120)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)

c, out = run()
ck("1 good run: sign-in set, Hub connected, records, two doors, proofs", c == 0 and "STEP 1a: DONE" in out and out.count("✓") >= 11 and "✗" not in out, out)
ck("1b sign-in: sign-up off, 6-digit code template, app address, built-in sender kept", S["auth"].get("disable_signup") is True and "{{ .Token }}" in S["auth"]["mailer_templates_magic_link_content"]
   and S["auth"].get("site_url") == "https://family.mo-care.com" and "smtp_host" not in S["auth"] and "built-in sender" in out, S["auth"])
ck("1c Hub secrets: the family app's address and keys", S["secrets"] == {"FAMILY_APP_URL": "https://famref.supabase.co", "FAMILY_APP_ANON_KEY": "eyJanonfamref", "FAMILY_APP_SERVICE_KEY": "eyJsvcfamref"}, S["secrets"])
ck("1d doors: family-gateway checks its own sign-in (gateway check off), office door keeps it on", S["deployed"] == {"family-gateway": False, "family-app-office": True}, S["deployed"])
ck("1e no key or token ever printed", not re.search(r"eyJ\w|sbp_test", out), out)
c, out = run(resend="re_abcdefghijklmnop")
ck("2 with a Resend key: codes from noreply@mo-care.com, key never printed", c == 0 and S["auth"].get("smtp_host") == "smtp.resend.com" and S["auth"].get("smtp_admin_email") == "noreply@mo-care.com" and "re_abcdefghijklmnop" not in out, out)
c, out = run(pins={**PINS, "family_app_1a.sql": "0" * 64})
ck("3 not the reviewed build: stops before anything", c == 2 and not S["calls"], out)
c, out = run(fam=False)
ck("4 no cc-family-app: stops, nothing changed", c == 2 and not S["secrets"] and not S["sql"], out)
c, out = run(patch_fail=True)
ck("5 sign-in settings refused: stops before the Hub is touched", c == 1 and not S["sql"] and not S["deployed"] and "not saved" in out, out)
c, out = run(sqlfail=True)
ck("6 database change refused: reported, no doors deployed", c == 1 and "refused" in out and not S["deployed"], out)
c, out = run(gw_open=True)
ck("7 the family door letting someone in without a family sign-in is caught", c == 1 and "no sign-in: refused (200)" in out, out)
c, out = run(signup_on=True)
ck("8 sign-up left on is caught", c == 1 and "nobody can sign themselves up" in out, out)
c, out = run(cors=False)
ck("9 CORS missing is caught", c == 1 and "CORS" in out, out)

for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  801 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed")
raise SystemExit(0 if all(r[1] for r in res) else 1)
