#!/usr/bin/env python3
# Rehearsal of 802 (family_app_802.py): FAKE Supabase, FAKE supabase CLI, FAKE gh, a local bare git repo standing in for GitHub,
# and a fake live site that serves whatever was pushed. Never touches GitHub, Supabase or the real site.
#   python3 family_app_802_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.expanduser("~/Claude/Projects/cc-family-app")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1400]))
S = {}; M = {}
TMP = tempfile.mkdtemp(prefix="t802-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN); BARE = os.path.join(TMP, "remote.git"); GHLOG = os.path.join(TMP, "gh.log")
def reset(**m):
    S.clear(); S.update(auth={"disable_signup": True}, calls=[])
    M.clear(); M.update(dict(repo_exists=False, live=True, cors=True, gh_auth=True), **m)
    subprocess.run(["rm", "-rf", BARE]); subprocess.run(["git", "init", "-q", "--bare", "-b", "main", BARE])
    for f in (GHLOG, os.path.join(TMP, "deploys"), os.path.join(TMP, "pages.json")):
        if os.path.exists(f): os.remove(f)
    open(os.path.join(TMP, "mode.json"), "w").write(json.dumps(M))
def live_file(name):
    p = subprocess.run(["git", "--git-dir", BARE, "show", f"main:{name}"], capture_output=True, text=True)
    return p.stdout if p.returncode == 0 else None
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj, hdr=None, raw=None):
        b = raw.encode() if raw is not None else json.dumps(obj).encode(); self.send_response(code)
        for k, v in (hdr or {"Content-Type": "application/json"}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self): self._send(200, "ok", {"Access-Control-Allow-Origin": self.headers.get("Origin") if M["cors"] else "https://app.mo-care.com"})
    def do_GET(self):
        p = self.path; S["calls"].append(("GET", p))
        if p.startswith("/config.js"):
            body = live_file("config.js") if M["live"] else None
            return self._send(200, None, {"Content-Type": "text/javascript"}, body) if body else self._send(404, {})
        if p == "/v1/projects": return self._send(200, [{"id": "zngsgedlsxinbygwmxwn", "name": "hub"}, {"id": "famref", "name": "cc-family-app"}])
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonFAM"}, {"name": "service_role", "api_key": "eyJsvcFAM"}])
        if p == "/v1/projects/famref/config/auth": return self._send(200, S["auth"])
        if m := re.match(r"/v1/projects/zngsgedlsxinbygwmxwn/functions/([\w-]+)$", p):
            dp = os.path.join(TMP, "deploys"); dep = {}
            if os.path.exists(dp):
                for ln in open(dp).read().splitlines(): f2, nov = json.loads(ln); dep[f2] = not nov
            return self._send(200, {"verify_jwt": dep[m.group(1)]}) if m.group(1) in dep else self._send(404, {})
        self._send(404, {})
    def do_PATCH(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"null")
        if self.path == "/v1/projects/famref/config/auth": S["auth"].update(b); return self._send(200, S["auth"])
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
open(os.path.join(BIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, json, os
a = sys.argv[1:]
if a[:2] == ['functions', 'deploy'] and os.environ.get('SUPABASE_ACCESS_TOKEN') == 'sbp_test':
    open({os.path.join(TMP, 'deploys')!r}, 'a').write(json.dumps([a[2], '--no-verify-jwt' in a]) + '\\n'); sys.exit(0)
sys.exit(1)
""")
open(os.path.join(BIN, "gh"), "w").write(f"""#!/usr/bin/env python3
import sys, json, os
a = sys.argv[1:]; M = json.load(open({os.path.join(TMP, 'mode.json')!r})); PJ = {os.path.join(TMP, 'pages.json')!r}
open({GHLOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['auth', 'status']: sys.exit(0 if M['gh_auth'] else 1)
if a[:2] == ['repo', 'view']: sys.exit(0 if M['repo_exists'] else 1)
if a[:2] == ['repo', 'create']: sys.exit(0)
if a[0] == 'api':
    pages = json.load(open(PJ)) if os.path.exists(PJ) else {{}}
    if '-X' in a and a[a.index('-X') + 1] == 'POST': pages.setdefault('source', 'main'); json.dump(pages, open(PJ, 'w')); sys.exit(0)
    if '-X' in a and a[a.index('-X') + 1] == 'PUT':
        for x in a:
            if x.startswith('cname='): pages['cname'] = x[6:]
            if x.startswith('https_enforced='): pages['https'] = True
        json.dump(pages, open(PJ, 'w')); sys.exit(0)
    print(json.dumps(pages)); sys.exit(0)
sys.exit(1)
""")
for f in ("supabase", "gh"): os.chmod(os.path.join(BIN, f), 0o755)
FILES = ["supabase/functions/family-gateway/index.ts", "supabase/functions/family-app-office/index.ts", "supabase/functions/_shared/family-app.ts", "supabase/functions/_shared/family-app-office.ts"]
PINS = {f: sha(os.path.join(HERE, f)) for f in FILES}
SITE_PIN = subprocess.run(["git", "-C", SITE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
def run(pins=PINS, site_pin=SITE_PIN, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    env = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_LIVE_BASE=URL, SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_GH=os.path.join(BIN, "gh"),
               SB_REPO=HERE, SB_PINS=json.dumps(pins), SB_SITE_REPO=SITE, SB_SITE_PIN=site_pin, SB_GIT_REMOTE=BARE, SB_WAIT="2", SB_POLL="0.2")
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(HERE, "family_app_802.py")], env=env, capture_output=True, text=True, timeout=120)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
gh = lambda: open(GHLOG).read() if os.path.exists(GHLOG) else ""
pages = lambda: json.load(open(os.path.join(TMP, "pages.json"))) if os.path.exists(os.path.join(TMP, "pages.json")) else {}

c, out = run()
cfg = live_file("config.js") or ""
ck("1 good run: sign-in address, doors, site, GitHub, Pages, live, CORS", c == 0 and "802: DONE" in out and "✗" not in out, out)
ck("1b sign-in now belongs to family.mo-care.com, sign-up still off", S["auth"].get("site_url") == "https://family.mo-care.com" and "https://family.mo-care.com/**" in S["auth"].get("uri_allow_list", ""), S["auth"])
ck("1c published config: real address + public key + Hub door, NO sample data", '"familyUrl": "https://famref.supabase.co"' in cfg and '"familyAnon": "eyJanonFAM"' in cfg and "family-gateway" in cfg and "CC_DEMO" not in cfg and '"demo"' not in cfg, cfg)
ck("1d the service key never leaves Supabase", "eyJsvcFAM" not in cfg and "eyJsvcFAM" not in out and "sbp_test" not in out, out)
ck("1e CNAME family.mo-care.com, the app files, nothing else", live_file("CNAME") == "family.mo-care.com\n" and live_file("app.js") and live_file("index.html") and live_file(".nojekyll") == "", live_file("CNAME"))
ck("1f repo created public; Pages on with the custom address", "repo create cc16485/cc-family-app --public" in gh() and pages().get("cname") == "family.mo-care.com", gh())
ck("1g doors redeployed with the token (gateway does its own check)", "family-gateway updated" in out and "family-app-office updated" in out, out)
c, out = run(repo_exists=True)
ck("2 repo already there: not created again, publish still works", c == 0 and "repo create" not in gh() and "already there" in out, out)
c, out = run(pins={**PINS, "supabase/functions/_shared/family-app.ts": "0" * 64})
ck("3 not the reviewed build: stops before anything", c == 2 and not S["calls"] and not gh(), out)
c, out = run(site_pin="0" * 40)
ck("4 unknown app version: stops before anything", c == 2 and not S["calls"], out)
c, out = run(gh_auth=False)
ck("5 GitHub not signed in: stops before anything", c == 2 and not S["calls"] and "GitHub isn't signed in" in out, out)
c, out = run(live=False)
ck("6 site not answering yet: said plainly, safe to run again", c == 1 and "run 802 again later" in out, out)
c, out = run(cors=False)
ck("7 family door not allowing the new address: caught", c == 1 and "CORS" in out, out)

for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  802 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed")
raise SystemExit(0 if all(r[1] for r in res) else 1)
