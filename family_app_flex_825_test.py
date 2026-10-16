#!/usr/bin/env python3
# Rehearsal of 825 (family_app_flex_825.py): FAKE Supabase (management API, SQL, the three doors), FAKE supabase CLI, FAKE gh,
# a local bare git repo standing in for GitHub, and a fake live site. Never touches GitHub, Supabase or a real site.
# Runs from a fresh copy of this folder's committed build (her rule: rehearse from a fresh copy).
#   python3 family_app_flex_825_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.expanduser("~/Claude/Projects/cc-family-app")
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t825-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN); BARE = os.path.join(TMP, "remote.git"); GHLOG = os.path.join(TMP, "gh.log")
COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
subprocess.run(["git", "-C", COPY, "checkout", "-q", subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in ("_shared/family-app.ts", "_shared/family-app-office.ts", "_shared/family-offer.ts", "_shared/offer-links.ts", "family-gateway/index.ts", "family-app-office/index.ts", "family-offer/index.ts")}
SITE_PIN = subprocess.run(["git", "-C", SITE, "rev-parse", "flex-booking"], capture_output=True, text=True).stdout.strip()
S = {}; M = {}
def reset(**m):
    S.clear(); S.update(sql=[], calls=[], deployed={}, cron=None, settings={"family_app_live": False})
    M.clear(); M.update(dict(sql_fail=False, gh_auth=True, page_up=True, offer_401=True, offer_403=True), **m)
    subprocess.run(["rm", "-rf", BARE]); subprocess.run(["git", "init", "-q", "--bare", "-b", "main", BARE])
    # GitHub already has the app published once (802)
    seed = os.path.join(TMP, "seed"); shutil.rmtree(seed, ignore_errors=True); os.makedirs(seed)
    subprocess.run(["sh", "-c", f'git -C "{SITE}" archive main | tar -x -C "{seed}"']); subprocess.run(["git", "init", "-q", "-b", "main"], cwd=seed)
    subprocess.run(["git", "add", "-A"], cwd=seed); subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "802"], cwd=seed)
    subprocess.run(["git", "push", "-q", BARE, "HEAD:main"], cwd=seed)
    for f in (GHLOG, os.path.join(TMP, "deploys")):
        if os.path.exists(f): os.remove(f)
    open(os.path.join(TMP, "mode.json"), "w").write(json.dumps(M))
def live_file(name):
    p = subprocess.run(["git", "--git-dir", BARE, "show", f"main:{name}"], capture_output=True, text=True)
    return p.stdout if p.returncode == 0 else None
def deployed():
    out = {}; dp = os.path.join(TMP, "deploys")
    if os.path.exists(dp):
        for ln in open(dp).read().splitlines(): f2, nov = json.loads(ln); out[f2] = not nov
    return out
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj, hdr=None, raw=None):
        b = raw.encode() if raw is not None else json.dumps(obj).encode(); self.send_response(code)
        for k, v in (hdr or {"Content-Type": "application/json"}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)
    def _body(self):
        n = int(self.headers.get("Content-Length") or 0); return json.loads(self.rfile.read(n) or b"null")
    def do_OPTIONS(self): self._send(200, "ok", {"Access-Control-Allow-Origin": self.headers.get("Origin") or "*"})
    def do_GET(self):
        p = self.path; S["calls"].append(("GET", p))
        if p.startswith("/app.js"):
            body = live_file("app.js"); return self._send(200, None, {"Content-Type": "text/javascript"}, body) if body else self._send(404, {})
        if p.startswith("/visit-offer.html"): return self._send(200, None, {"Content-Type": "text/html"}, "<script>fetch('/functions/v1/family-offer')</script>") if M["page_up"] else self._send(404, {})
        if p == "/v1/projects": return self._send(200, [{"id": "zngsgedlsxinbygwmxwn", "name": "hub"}, {"id": "famref", "name": "cc-family-app"}])
        if "/famref/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonFAM"}])
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonHUB"}, {"name": "service_role", "api_key": "eyJsvcHUB"}])
        if m := re.match(r"/v1/projects/zngsgedlsxinbygwmxwn/functions/([\w-]+)$", p):
            d = deployed(); return self._send(200, {"verify_jwt": d[m.group(1)], "version": 7}) if m.group(1) in d else self._send(404, {})
        self._send(404, {})
    def do_POST(self):
        p = self.path; b = self._body(); S["calls"].append(("POST", p, b))
        if p.endswith("/database/query"):
            q = b["query"]; S["sql"].append(q)
            if "to_regclass('public.family_bookings') is not null as tbl" in q: return self._send(200, [{"tbl": True, "live": "false", "offers": "not set", "vault": 1}])
            if "create table if not exists public.family_offers" in q:
                if M["sql_fail"]: return self._send(400, {"message": "syntax error"})
                S["settings"].update(family_app_open_MO="07:00", family_app_days_OK=[1, 2, 3, 4, 5], family_offer_live=False); return self._send(201, [])
            if "information_schema.columns" in q: return self._send(200, [{"cols": 7, "offers": True, "mo_open": S["settings"].get("family_app_open_MO"), "ok_days": json.dumps(S["settings"].get("family_app_days_OK")), "offers_live": "false", "extra": False}])
            if "cron.schedule" in q: S["cron"] = q; return self._send(201, [{"id": 1}])
            if "from cron.job" in q:
                m2 = re.search(r"cron\.schedule\('family-offer', '([^']+)', '(.*)'\) as id", S["cron"] or "", re.S)
                return self._send(200, [{"schedule": m2.group(1), "command": m2.group(2)}] if m2 else [])
            return self._send(201, [])
        if p.startswith("/functions/v1/family-offer"):
            if "o" in (b or {}): return self._send(403 if M["offer_403"] else 200, {"error": "This link has ended"})
            auth = self.headers.get("Authorization") or ""
            if auth == "Bearer eyJsvcHUB" and "dry=1" in p: return self._send(200, {"ok": True, "live": False, "held": "the family app is in practice mode, so nothing is offered"})
            return self._send(401 if M["offer_401"] else 200, {"error": "not allowed"})
        self._send(404, {})
    def do_PATCH(self): self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
# fake supabase CLI: deploy records; download writes the copy's files (the live copy IS the build)
open(os.path.join(BIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, json, os, shutil, re
a = sys.argv[1:]
if os.environ.get('SUPABASE_ACCESS_TOKEN') != 'sbp_test': sys.exit(1)
FN = {FNROOT!r}
if a[:2] == ['functions', 'deploy']:
    open({os.path.join(TMP, 'deploys')!r}, 'a').write(json.dumps([a[2], '--no-verify-jwt' in a]) + '\\n'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    def deps(path, seen):
        if path in seen or not os.path.exists(path): return
        seen.add(path)
        src = open(path).read()
        for m in re.findall(r\"\"\"from\\s+['"](\\.{{1,2}}/[^'"]+)['"]\"\"\", src): deps(os.path.normpath(os.path.join(os.path.dirname(path), m)), seen)
    s = set(); deps(os.path.join(FN, a[2], 'index.ts'), s)
    for x in s:
        rel = os.path.relpath(x, FN); dst = os.path.join(os.getcwd(), 'supabase', 'functions', rel); os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copy2(x, dst)
    sys.exit(0)
sys.exit(1)
""")
open(os.path.join(BIN, "gh"), "w").write(f"""#!/usr/bin/env python3
import sys, json
a = sys.argv[1:]; M = json.load(open({os.path.join(TMP, 'mode.json')!r}))
open({GHLOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['auth', 'status']: sys.exit(0 if M['gh_auth'] else 1)
sys.exit(0)
""")
for f in ("supabase", "gh"): os.chmod(os.path.join(BIN, f), 0o755)
def run(shas=SHAS, site_pin=SITE_PIN, main_ref="HEAD", **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="825", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_LIVE_BASE=URL, SB_OFFER_PAGE=URL + "/visit-offer.html",
               SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_GH=os.path.join(BIN, "gh"), SB_FNROOT=FNROOT, SB_SHAS=json.dumps(shas), SB_SITE_REPO=SITE, SB_SITE_PIN=site_pin,
               SB_GIT_REMOTE=BARE, SB_WAIT="3", SB_POLL="0.2", SB_MAIN_REF=main_ref, SB_NODE=shutil.which("node") or "")
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "family_app_flex_825.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
writes = lambda: [c for c in S["calls"] if c[0] == "POST" and c[1].endswith("/database/query") and not re.match(r"\s*select ", c[2]["query"])]

c, out = run()
ck("1 good run: database, three doors, the 10-minute check, the site, the proofs", c == 0 and "825: DONE" in out and "✗" not in out, out)
d = deployed()
ck("1b doors: family-gateway and family-offer with their own checks (gateway off), the office door signed-in only", d == {"family-gateway": False, "family-app-office": True, "family-offer": False}, d)
ck("1c the database change ran once, as one transaction", sum(1 for q in S["sql"] if "create table if not exists public.family_offers" in q) == 1 and any(q.strip().startswith("--") and "begin;" in q for q in S["sql"]))
ck("1d the check runs every 10 minutes with the vault secret", S["cron"] and "'*/10 * * * *'" in S["cron"] and "x-cron-secret" in S["cron"] and "hub_job_secret" in S["cron"], S["cron"])
cfg = live_file("config.js") or ""; js = live_file("app.js") or ""
ck("1e the published app is the reviewed version with the real settings, no sample data", "When should we come?" in js and "I\\'m flexible" in js and '"familyAnon": "eyJanonFAM"' in cfg and "CC_DEMO" not in cfg and live_file("CNAME") == "family.mo-care.com\n", cfg[:200])
ck("1f nothing is switched on, and it says so", "Nothing is switched on" in out and not any("family_offer_live', true" in q or '"family_offer_live": true' in q for q in S["sql"]), out[-400:])
ck("1g no key or token in the report", not re.search(r"eyJsvcHUB|eyJanon|sbp_test", out), out)
c, out = run(shas={**SHAS, "_shared/family-offer.ts": "0" * 64})
ck("2 not the reviewed build: stops before anything", c == 2 and not writes() and not deployed(), out)
c, out = run(main_ref="origin/main~1000000")
ck("3 not merged yet (or newer work since): stops before anything", c == 2 and "merge the pull request first" in out and not writes() and not deployed(), out)
c, out = run(site_pin="0" * 40)
ck("4 unknown app version: stops before anything", c == 2 and not writes() and not deployed(), out)
c, out = run(gh_auth=False)
ck("5 GitHub not signed in: stops before anything", c == 2 and "GitHub isn't signed in" in out and not writes(), out)
c, out = run(sql_fail=True)
ck("6 database change refused: stops, no door deployed", c == 4 and not deployed() and "refused" in out, out)
c, out = run(offer_403=False)
ck("7 a forged offer link not refused: caught", c == 1 and "forged link was not refused" in out, out)
c, out = run(page_up=False)
ck("8 the caregiver page isn't up yet: said plainly, safe to run again", c == 1 and "merge the Care Coordinator Hub pull request" in out, out)

for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  825 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed")
shutil.rmtree(TMP, ignore_errors=True)
raise SystemExit(0 if all(r[1] for r in res) else 1)
