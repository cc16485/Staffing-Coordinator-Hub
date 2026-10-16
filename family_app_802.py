#!/usr/bin/env python3
# 802 · PUBLISH THE FAMILY APP. Samantha 2026-10-15: "Yes, publish the app" + "Use family.mo-care.com for the family app."
#  1. cc-family-app sign-in now belongs to family.mo-care.com (codes, allowed address).
#  2. Redeploys family-gateway (rate for the estimate; family.mo-care.com may call it) and family-app-office (invite words).
#  3. Builds the site from the reviewed app version, with the real settings (public sign-in key only) and family.mo-care.com.
#  4. GitHub: public repo cc16485/cc-family-app, GitHub Pages on main, custom address family.mo-care.com
#     (*.mo-care.com already points at GitHub, so no DNS change).
#  5. Proves the live site serves the real settings and the family door answers family.mo-care.com.
# Still practice mode (family_app_live off). Nobody can sign in until the office invites them. Never contacts anyone.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, sys, time, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); GH = os.environ.get("SB_GH", "gh"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB = "zngsgedlsxinbygwmxwn"; FAM_NAME = "cc-family-app"; OWNER_REPO = "cc16485/cc-family-app"
REPO = os.environ["SB_REPO"]; PINS = json.loads(os.environ["SB_PINS"])
SITE = os.environ["SB_SITE_REPO"]; SITE_PIN = os.environ["SB_SITE_PIN"]
DOMAIN = "family.mo-care.com"; APP = f"https://{DOMAIN}"
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
LIVE = os.environ.get("SB_LIVE_BASE", f"https://{DOMAIN}")            # tests point these at fakes
REMOTE = os.environ.get("SB_GIT_REMOTE", f"https://github.com/{OWNER_REPO}.git")
WAIT = float(os.environ.get("SB_WAIT", "600")); POLL = float(os.environ.get("SB_POLL", "15"))
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|gho_|ghp_)[A-Za-z0-9._\-]{8,}", "(hidden)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def ok(s): say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-802/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace"), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace"), dict(e.headers or {})
    except Exception as e: return None, type(e).__name__, {}
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def j(b):
    try: return json.loads(b)
    except Exception: return None
def run(args, cwd=None):
    p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
os.environ["SUPABASE_ACCESS_TOKEN"] = TOKEN   # the supabase CLI reads it; never printed

say("802 · PUBLISH THE FAMILY APP"); say(time.strftime("%Y-%m-%d %H:%M")); say()
for rel, want in PINS.items():
    p = os.path.join(REPO, rel)
    if not os.path.exists(p) or sha(p) != want: bad(f"{rel} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
c, _ = run(["git", "-C", SITE, "cat-file", "-e", SITE_PIN + "^{commit}"])
if c != 0: bad("the reviewed app version isn't on this Mac"); say("  STOP. Nothing was run."); done(2)
c, o = run([GH, "auth", "status"])
if c != 0: bad("GitHub isn't signed in on this Mac (gh auth status)"); say("  STOP. Nothing was run."); done(2)
ok("reviewed build, app version and GitHub sign-in")

# ── 1. sign-in address ──────────────────────────────────────────────────────────────────────────────────────────────
say(); say("1 · SIGN-IN BELONGS TO family.mo-care.com")
s, b, _ = http("GET", f"{API}/v1/projects", headers=MG())
if s == 401: bad("Supabase didn't accept that access token"); say("  STOP. Nothing was run."); done(2)
fam = next((x for x in (j(b) or []) if x.get("name") == FAM_NAME), None)
if not fam: bad(f"{FAM_NAME} not found"); say("  STOP. Nothing was run."); done(2)
FREF = fam.get("id") or fam.get("ref")
anon = ""
for q in ("?reveal=true", ""):
    s, b, _ = http("GET", f"{API}/v1/projects/{FREF}/api-keys{q}", headers=MG())
    arr = j(b) if s == 200 else None
    if isinstance(arr, dict): arr = arr.get("keys") or []
    anon = next((k.get("api_key", "") for k in (arr or []) if isinstance(k, dict) and k.get("name") == "anon"), "")
    if anon.startswith("eyJ"): break
if not anon.startswith("eyJ"): bad("couldn't read the family app's public sign-in key"); say("  STOP. Nothing was run."); done(2)
s, b, _ = http("PATCH", f"{API}/v1/projects/{FREF}/config/auth", {"site_url": APP, "uri_allow_list": f"{APP}/**,https://cc16485.github.io/**,http://localhost:8787/**"}, MG())
s2, b2, _ = http("GET", f"{API}/v1/projects/{FREF}/config/auth", headers=MG()); c2 = j(b2) or {}
chk(s in (200, 201) and c2.get("site_url") == APP and c2.get("disable_signup") is True, f"sign-in address {APP}; sign-up still off", f"sign-in address not saved ({s})")
if fails: say("  STOP. Tell Claude."); done(1)

# ── 2. the two doors ────────────────────────────────────────────────────────────────────────────────────────────────
say(); say("2 · THE TWO DOORS")
for fn, extra in (("family-gateway", ["--no-verify-jwt"]), ("family-app-office", [])):
    c, o = run([SUPA, "functions", "deploy", fn, "--project-ref", HUB, "--use-api"] + extra, cwd=REPO)
    s, b, _ = http("GET", f"{API}/v1/projects/{HUB}/functions/{fn}", headers=MG()); m = j(b) or {}
    chk(c == 0 and s == 200 and m.get("verify_jwt") is (fn != "family-gateway"), f"{fn} updated", f"{fn} didn't deploy: {o[-200:]}")
if fails: say("  STOP before publishing. Tell Claude."); done(1)

# ── 3. the site ─────────────────────────────────────────────────────────────────────────────────────────────────────
say(); say("3 · THE APP SITE")
tmp = tempfile.mkdtemp(prefix="cc802-"); site = os.path.join(tmp, "site"); os.makedirs(site)
c, o = run(["sh", "-c", f'git -C "{SITE}" archive {SITE_PIN} | tar -x -C "{site}"'])
if c != 0 or not os.path.exists(os.path.join(site, "app.js")): bad("couldn't read the app version"); done(1)
cfg = ("/* Caring Companions family app settings. The sign-in key here is the public one (safe to publish by design). */\n"
       "window.CC_CONFIG = " + json.dumps({"familyUrl": f"https://{FREF}.supabase.co", "familyAnon": anon, "gateway": f"https://{HUB}.supabase.co/functions/v1/family-gateway", "billingUrl": None}) + "\n")
open(os.path.join(site, "config.js"), "w").write(cfg)
open(os.path.join(site, "CNAME"), "w").write(DOMAIN + "\n")
open(os.path.join(site, ".nojekyll"), "w").write("")
ok("built with the real settings (no sample data) and the address family.mo-care.com")

# ── 4. GitHub ───────────────────────────────────────────────────────────────────────────────────────────────────────
say(); say("4 · GITHUB")
c, o = run([GH, "repo", "view", OWNER_REPO, "--json", "name"])
if c != 0:
    c, o = run([GH, "repo", "create", OWNER_REPO, "--public", "--description", "Caring Companions family app (family.mo-care.com)"])
    chk(c == 0, f"made the GitHub repo {OWNER_REPO}", f"couldn't make the GitHub repo: {o[-200:]}")
    if fails: done(1)
else: ok(f"GitHub repo {OWNER_REPO} already there")
pub = os.path.join(tmp, "pub")
c, o = run(["git", "clone", "-q", REMOTE, pub])
if c != 0 or not os.path.isdir(os.path.join(pub, ".git")): os.makedirs(pub, exist_ok=True); run(["git", "init", "-q", "-b", "main"], cwd=pub); run(["git", "remote", "add", "origin", REMOTE], cwd=pub)
for name in os.listdir(pub):
    if name != ".git": (shutil.rmtree if os.path.isdir(os.path.join(pub, name)) else os.remove)(os.path.join(pub, name))
for name in os.listdir(site):
    src = os.path.join(site, name); (shutil.copytree(src, os.path.join(pub, name)) if os.path.isdir(src) else shutil.copy2(src, os.path.join(pub, name)))
run(["git", "add", "-A"], cwd=pub)
c, o = run(["git", "-c", "user.name=cc16485", "-c", "user.email=samantha@mo-care.com", "commit", "-q", "-m", f"Publish family app {SITE_PIN[:7]} (802)"], cwd=pub)
nothing = "nothing to commit" in o
c, o = run(["git", "push", "-q", "origin", "HEAD:main"], cwd=pub)
chk(c == 0, "app published to GitHub" + (" (no changes since last time)" if nothing else ""), f"push refused: {o[-200:]}")
if fails: done(1)
c, o = run([GH, "api", "-X", "POST", f"repos/{OWNER_REPO}/pages", "-f", "source[branch]=main", "-f", "source[path]=/"])
c2, o2 = run([GH, "api", "-X", "PUT", f"repos/{OWNER_REPO}/pages", "-f", f"cname={DOMAIN}"])
c3, o3 = run([GH, "api", f"repos/{OWNER_REPO}/pages"]); pg = j(o3) or {}
chk(c3 == 0 and pg.get("cname") == DOMAIN, f"GitHub Pages on, address {DOMAIN}", f"GitHub Pages not set up: {(o + o2 + o3)[-250:]}")
if fails: done(1)

# ── 5. live ─────────────────────────────────────────────────────────────────────────────────────────────────────────
say(); say("5 · LIVE")
say("  Waiting for GitHub to put it up (usually 1 to 5 minutes)…")
t0 = time.time(); live = False; via = ""
while time.time() - t0 < WAIT:
    for base in (LIVE, LIVE.replace("https://", "http://")):
        s, b, _ = http("GET", f"{base}/config.js?t={int(time.time())}", timeout=20)
        if s == 200 and FREF in (b or "") and '"demo"' not in (b or ""): live = True; via = base; break
    if live: break
    time.sleep(POLL)
chk(live, f"{via} serves the app with the real settings", "the site isn't answering yet at family.mo-care.com. GitHub can take up to 10 minutes the first time; run 802 again later (it changes nothing twice)")
if live and via.startswith("https"):
    c, o = run([GH, "api", "-X", "PUT", f"repos/{OWNER_REPO}/pages", "-F", "https_enforced=true"])
    say("  ✓ secure address (https) required" if c == 0 else "  · https certificate still being issued by GitHub; it switches on by itself, or run 802 again in an hour")
elif live: say("  · open over http for now; GitHub is still issuing the https certificate (usually under an hour). Run 802 again later to require https.")
s, b, h = http("OPTIONS", f"{FNB}/functions/v1/family-gateway", headers={"Origin": APP, "Access-Control-Request-Method": "POST"})
chk(s == 200 and {k.lower(): v for k, v in h.items()}.get("access-control-allow-origin") == APP, "the app's address may call the family door (CORS)")
say()
say("  802: " + ("DONE. The app is up. Practice mode: bookings don't reach AxisCare yet, and only families the office invites can sign in." if not fails else "NOT COMPLETE. See the ✗ lines above."))
shutil.rmtree(tmp, ignore_errors=True)
done(0 if not fails else 1)
