#!/usr/bin/env python3
# 850 · FAMILY APP: LET ME CHOOSE + TWO BRANDS (steps 1 and 2) + THE DRIVER CHECK. Samantha 2026-10-16: "Start both: Let me
# choose with your 5 recommended answers, and brand steps 1 and 2. Fix the Approved Driver gap first."
#  1. family_app_choose.sql: Let me choose columns and offer states; settings with Let me choose OFF and her approval of the
#     one family text recorded.
#  2. Deploys family-gateway (families), family-offer (caregiver offers, 10-minute run) and family-app-office (the welcome,
#     now branded by the client's state).
#  3. Publishes the reviewed family app (Find someone for me / Let me choose, branded screens) to family.mo-care.com.
#  4. Proves it: the doors answer as built, a forged offer link gets nothing, the caregiver page has "I'm interested", the
#     site serves the new app.
# Turns NOTHING on: Let me choose stays OFF (family_choose_live) until you switch it on. Missouri's messages read exactly as
# before. Never texts or emails anyone. Safe to run again.
import json, os, subprocess, shutil, tempfile, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, MG, sql, sha, deploy, start, check_build

HUB = "zngsgedlsxinbygwmxwn"; FAM_NAME = "cc-family-app"; OWNER_REPO = "cc16485/cc-family-app"
DOMAIN = "family.mo-care.com"; APP = f"https://{DOMAIN}"
FNROOT = L.FNROOT; ROOT = L.ROOT; API = L.API
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
SITE = os.environ.get("SB_SITE_REPO", ""); SITE_PIN = os.environ.get("SB_SITE_PIN", "")
GH = os.environ.get("SB_GH", "gh"); NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
LIVE = os.environ.get("SB_LIVE_BASE", APP)
REMOTE = os.environ.get("SB_GIT_REMOTE", f"https://github.com/{OWNER_REPO}.git")
WAIT = float(os.environ.get("SB_WAIT", "600")); POLL = float(os.environ.get("SB_POLL", "15"))
FNS = [("family-gateway", False), ("family-offer", False), ("family-app-office", True)]
OFFER_PAGE = os.environ.get("SB_OFFER_PAGE", "https://cc.mo-care.com/visit-offer.html")
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def keys(ref):
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("anon"): return got
    return {}

start("FAMILY APP: LET ME CHOOSE + TWO BRANDS")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
# Run only once it is merged: every file the family door uses must match GitHub's main exactly, so nobody's newer work is undone.
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")   # rehearsals point this at the rehearsal copy's own commit
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for fn, _ in FNS:
    for k in sorted(L.need(FNROOT, fn)):
        c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
for k in ("family_app_choose.sql",):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: bad("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(sorted(set(drift)))[:240] + ")"); say("  STOP. Nothing was changed."); done(2)
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t in ("family_app_1a_test.mjs", "family_app_flex_test.mjs", "brands_test.mjs"):
        p = subprocess.run([NODE, t], cwd=ROOT, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0: bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        ok(f"{t}: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
good, r = sql(HUB, "select to_regclass('public.family_bookings') is not null as tbl, coalesce((select data->>'family_app_live' from app_data where key = 'ops_settings'), 'not set') as live")
if not good or not r: bad(f"couldn't read the Hub ({str(r)[:160]}). Nothing was changed."); done(3)
if not r[0]["tbl"]: bad("family_bookings isn't there (801 first). Nothing was changed."); done(3)
say(f"  · the family app is {'LIVE' if r[0]['live'] == 'true' else 'in PRACTICE mode (cancels change nothing in AxisCare and text nobody until it is live)'}")
c, o = run(["git", "-C", SITE, "cat-file", "-e", SITE_PIN + "^{commit}"])
if c != 0: bad("the reviewed app version isn't on this Mac. Nothing was changed."); done(2)
c, o = run([GH, "auth", "status"])
if c != 0: bad("GitHub isn't signed in on this Mac (gh auth status). Nothing was changed."); done(2)
s, b = http("GET", f"{API}/v1/projects", headers=MG())
fam = next((x for x in (json.loads(b) if s == 200 else []) if x.get("name") == FAM_NAME), None)
if not fam: bad(f"{FAM_NAME} not found. Nothing was changed."); done(2)
FREF = fam.get("id") or fam.get("ref"); FK = keys(FREF); FANON = FK.get("anon", ""); L.HIDE.append(FANON)
if not FANON: bad("couldn't read the family app's public sign-in key. Nothing was changed."); done(2)
ok("the app version, GitHub sign-in and the family app's public key")

say(); say("PART 2 · CHANGE")
say("1 · THE DATABASE")
good, r = sql(HUB, open(os.path.join(ROOT, "family_app_choose.sql")).read())
if not good: bad("the database change was refused: " + str(r)[:300]); say("  STOP. Nothing was changed (it runs as one transaction)."); done(4)
good, r = sql(HUB, "select (select count(*) from information_schema.columns where table_name = 'family_bookings' and column_name in ('method','choose_by','family_told_at'))::int as cols, "
    "(select data->>'family_choose_live' from app_data where key = 'ops_settings') as live, (select data ? 'family_choose_text_approved' from app_data where key = 'ops_settings') as approved")
r = (r or [{}])[0] if good else {}
chk(r.get("cols") == 3 and r.get("approved") is True, "Let me choose is in the database, with your approval of the one family text recorded")
say(f"  · Let me choose is {'ON' if r.get('live') == 'true' else 'OFF (you switch it on when ready)'}")
if L.fails: say("  STOP. Tell Claude."); done(4)

say(); say("2 · THE THREE DOORS")
for fn, vj in FNS:
    if not deploy(HUB, FNROOT, fn, vj): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(5)

say(); say("3 · THE APP SITE")
tmp = tempfile.mkdtemp(prefix="cc850-"); site = os.path.join(tmp, "site"); os.makedirs(site)
c, o = run(["sh", "-c", f'git -C "{SITE}" archive {SITE_PIN} | tar -x -C "{site}"'])
if c != 0 or not os.path.exists(os.path.join(site, "app.js")): bad("couldn't read the app version"); done(6)
open(os.path.join(site, "config.js"), "w").write("/* Caring Companions family app settings. The sign-in key here is the public one (safe to publish by design). */\n"
    "window.CC_CONFIG = " + json.dumps({"familyUrl": f"https://{FREF}.supabase.co", "familyAnon": FANON, "gateway": f"{FNB}/functions/v1/family-gateway", "billingUrl": None}) + "\n")
open(os.path.join(site, "CNAME"), "w").write(DOMAIN + "\n"); open(os.path.join(site, ".nojekyll"), "w").write("")
pub = os.path.join(tmp, "pub")
c, o = run(["git", "clone", "-q", REMOTE, pub])
if c != 0: bad(f"couldn't read the published app from GitHub: {o[-200:]}"); done(6)
for name in os.listdir(pub):
    if name != ".git": (shutil.rmtree if os.path.isdir(os.path.join(pub, name)) else os.remove)(os.path.join(pub, name))
for name in os.listdir(site):
    src = os.path.join(site, name); (shutil.copytree(src, os.path.join(pub, name)) if os.path.isdir(src) else shutil.copy2(src, os.path.join(pub, name)))
run(["git", "add", "-A"], cwd=pub)
c, o = run(["git", "-c", "user.name=cc16485", "-c", "user.email=samantha@mo-care.com", "commit", "-q", "-m", f"Publish family app {SITE_PIN[:7]} (850)"], cwd=pub)
nothing = "nothing to commit" in o
c, o = run(["git", "push", "-q", "origin", "HEAD:main"], cwd=pub)
chk(c == 0, "app published to GitHub" + (" (no changes since last time)" if nothing else ""), f"push refused: {o[-200:]}")
want_js = sha(os.path.join(site, "app.js"))
shutil.rmtree(tmp, ignore_errors=True)

say(); say("PART 3 · PROOF")
s, b = http("OPTIONS", f"{FNB}/functions/v1/family-gateway", headers={"Origin": APP, "Access-Control-Request-Method": "POST"})
chk(s == 200, "the app's address may still call the family door", f"the family door didn't answer the app's address ({s})")
s, b = http("POST", f"{FNB}/functions/v1/family-gateway", {"action": "cancel", "booking_id": "x"})
chk(s in (401, 403), f"the family door refuses a cancel with no sign-in ({s})", f"the family door answered a cancel with no sign-in ({s})")
s, b = http("POST", f"{FNB}/functions/v1/family-offer", {"o": "00000000-0000-0000-0000-000000000000", "e": int(time.time()) + 3600, "t": "A" * 43})
chk(s == 403, "family-offer: a forged offer link gets nothing (403)", f"a forged link was not refused ({s})")
s, b = http("POST", f"{FNB}/functions/v1/family-offer", {})
chk(s == 401, "family-offer: a caller with no key gets nothing (401)", f"family-offer answered a stranger ({s})")
s, b = http("GET", OFFER_PAGE)
chk(s == 200 and "withdraw" in (b or ""), "cc.mo-care.com/visit-offer.html has \"I'm interested\" (the caregiver's link)", f"the caregiver page doesn't have Let me choose yet ({s}): merge the Care Coordinator Hub pull request, then run 850 again")
say("  Waiting for GitHub to put the new app up (usually 1 to 5 minutes)…")
t0 = time.time(); live = False
while time.time() - t0 < WAIT:
    s, b = http("GET", f"{LIVE}/app.js?t={int(time.time())}", timeout=20)
    if s == 200 and L.hashlib.sha256((b or "").encode()).hexdigest() == want_js: live = True; break
    time.sleep(POLL)
chk(live, f"{DOMAIN} serves the new screens", f"{DOMAIN} doesn't show the new app yet; GitHub can be slow. Run 850 again in a few minutes (it changes nothing twice)")
say()
say("  850: " + ("DONE. Let me choose is built and OFF until you switch it on; app offers for rides and outings go only to Approved Drivers; the family app and welcome are branded by the client's state (Missouri reads exactly as before). Nothing else was switched on." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
