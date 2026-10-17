#!/usr/bin/env python3
# Rehearsal of 899 (booking_app_name_899.py): FAKE Supabase (management API, auth settings, the doors), a FAKE Hub site and a FAKE
# supabase CLI. Never touches GitHub, Supabase or a real site. Runs from a fresh copy of this folder's committed build.
#   python3 booking_app_name_899_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
TMP = tempfile.mkdtemp(prefix="t899-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN); COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
subprocess.run(["git", "-C", COPY, "checkout", "-q", subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions"); sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in ("_shared/person-match.ts", "_shared/agreement-contacts.ts", "_shared/family-app.ts", "_shared/family-offer.ts", "circles-sync/index.ts", "client-agreement/index.ts")}
FNS = ["circles-sync", "client-agreement", "family-gateway", "family-offer", "family-app-office", "family-fee-check", "pilot-readiness"]
GATES = {"circles-sync": True, "client-agreement": True, "family-gateway": False, "family-offer": False, "family-app-office": True, "family-fee-check": False, "pilot-readiness": True}
M = {}; S = {}
AUTH0 = {"disable_signup": True, "site_url": "https://family.mo-care.com", "mailer_otp_exp": 900, "mailer_otp_length": 6, "smtp_host": "smtp.resend.com", "smtp_admin_email": "noreply@mo-care.com",
         "mailer_subjects_magic_link": "Your Caring Companions sign-in code", "mailer_templates_magic_link_content": "old {{ .Token }}"}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj, raw=None, ctype="application/json"):
        b = raw.encode() if raw is not None else json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", ctype); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if p.startswith("/family-app-panel.js"): return self._send(200, None, "x = 'Booking App: on'" if M.get("panel", True) else "x = 'Family app: on'", "application/javascript")
        if p == "/v1/projects": return self._send(200, [{"name": "cc-hub", "id": "zngsgedlsxinbygwmxwn"}] + ([] if M.get("no_fam") else [{"name": "cc-family-app", "id": "famref"}]))
        if p == "/v1/projects/famref/config/auth": return self._send(200, S["auth"])
        if m := re.match(r"/v1/projects/zngsgedlsxinbygwmxwn/functions/([\w-]+)$", p):
            d = {}
            if os.path.exists(os.path.join(TMP, "deploys")):
                for ln in open(os.path.join(TMP, "deploys")).read().splitlines(): f, vj = json.loads(ln); d[f] = vj
            return self._send(200, {"verify_jwt": d.get(m.group(1), GATES[m.group(1)]), "version": 3})
        self._send(404, {})
    def do_PATCH(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"null")
        if self.path == "/v1/projects/famref/config/auth":
            S.setdefault("patches", []).append(b)
            if M.get("auth_fail"): return self._send(400, {"message": "nope"})
            S["auth"] = {**S["auth"], **b, **({"smtp_host": "smtp.other"} if M.get("auth_drift") else {})}; return self._send(200, S["auth"])
        self._send(404, {})
    def do_POST(self):
        p = self.path
        if p.startswith("/functions/v1/"):
            fn = p.split("/")[3].split("?")[0]
            if M.get("open") == fn: return self._send(200, {"ok": True})
            return self._send(401 if fn in ("family-gateway", "family-offer", "family-fee-check") else 403, {"error": "x"})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
open(os.path.join(BIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, json, os, shutil
a = sys.argv[1:]
if os.environ.get('SUPABASE_ACCESS_TOKEN') != 'sbp_test': sys.exit(1)
if a[:2] == ['functions', 'deploy']:
    if os.path.exists({os.path.join(TMP, 'fail')!r}) and open({os.path.join(TMP, 'fail')!r}).read() == a[2]: sys.exit(1)
    open({os.path.join(TMP, 'deploys')!r}, 'a').write(json.dumps([a[2], '--no-verify-jwt' not in a]) + '\\n'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree({FNROOT!r}, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(BIN, "supabase"), 0o755)
def run(shas=SHAS, main_ref="HEAD", fail=None, **m):
    M.clear(); M.update(m); S.clear(); S["auth"] = dict(AUTH0)
    for f in ("deploys", "fail"):
        if os.path.exists(os.path.join(TMP, f)): os.remove(os.path.join(TMP, f))
    if fail: open(os.path.join(TMP, "fail"), "w").write(fail)
    rep = os.path.join(TMP, "r.txt")
    env = dict(os.environ, SB_STEP="899", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_HUB_SITE=URL, SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_SHAS=json.dumps(shas), SB_MAIN_REF=main_ref, SB_NODE=shutil.which("node") or "")
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "booking_app_name_899.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=600)
    d = [json.loads(l) for l in open(os.path.join(TMP, "deploys")).read().splitlines()] if os.path.exists(os.path.join(TMP, "deploys")) else []
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), d, S.get("patches", [])
TPL = open(os.path.join(COPY, "family-app/email/code.html")).read()
c, out, d, pt = run()
ck("1 good run: the sign-in email, then all seven doors with their gateway settings kept, proofs, DONE", c == 0 and "899: DONE" in out and "✗" not in out and d == [[f, GATES[f]] for f in FNS], (d, out))
ck("1b only the subject and the email are sent to sign-in settings; the email is the build's", pt == [{"mailer_subjects_magic_link": "Your Caring Companions Booking App sign-in code", "mailer_templates_magic_link_content": TPL}], pt)
ck("1c the build's email has the code and the new name; no token in the report", "{{ .Token }}" in TPL and "Caring Companions Booking App" in TPL and "sbp_test" not in out, out)
c, out, d, pt = run(panel=False)
ck("2 the Hub screen isn't live yet: stops before anything", c == 2 and "isn't live yet" in out and not d and not pt, out)
c, out, d, pt = run(shas={**SHAS, "_shared/person-match.ts": "0" * 64})
ck("3 not the reviewed build: stops before anything", c == 2 and not d and not pt, out)
c, out, d, pt = run(main_ref=subprocess.run(["git", "-C", COPY, "log", "-1", "--format=%H", "--", "supabase/functions/_shared/person-match.ts"], capture_output=True, text=True).stdout.strip() + "^")
ck("4 not merged yet: stops before anything", c == 2 and "merge the pull request first" in out and not d and not pt, out)
c, out, d, pt = run(no_fam=True)
ck("5 the app's sign-in project can't be found: stops before anything", c == 3 and not d and not pt, out)
c, out, d, pt = run(auth_fail=True)
ck("6 the sign-in email refused: no door touched", c == 4 and not d, out)
c, out, d, pt = run(auth_drift=True)
ck("7 another sign-in setting changed: reported, no door touched", c == 4 and "looks different" in out and not d, out)
c, out, d, pt = run(fail="family-offer")
ck("8 a door fails: stops there", c == 5 and d == [[f, GATES[f]] for f in FNS[:3]], (d, out))
c, out, d, pt = run(open="circles-sync")
ck("9 a door answering a stranger is reported, not DONE", c == 1 and "NOT COMPLETE" in out and "circles-sync answered a stranger" in out, out)
for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  899 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed")
shutil.rmtree(TMP, ignore_errors=True)
raise SystemExit(0 if all(r[1] for r in res) else 1)
