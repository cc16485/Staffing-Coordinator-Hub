#!/usr/bin/env python3
# 861 · THE FAMILY'S "WHO'S COMING" MESSAGE, HER WORDING (2026-10-16, her pick "1. warm and simple"): "Hi Lisa, good news from
# Caring Companions! Sarah will be with Dot on Thursday, October 22, from 1 to 4. You can see the details anytime in the app:
# family.mo-care.com" (the email says the same).
#  1. Deploys family-offer (the 10-minute run sends that message).
#  2. Proves it: the door still refuses strangers and forged links.
# No database change, no site change. Turns NOTHING on. Safe to run again.
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
FNS = [("family-offer", False)]
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

start("THE FAMILY WHO IS COMING MESSAGE, HER WORDING")
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
for k in ():
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

say(); say("PART 2 · CHANGE")
say(); say("1 · THE OFFER DOOR")
for fn, vj in FNS:
    if not deploy(HUB, FNROOT, fn, vj): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(5)

say(); say("PART 3 · PROOF")
s, b = http("POST", f"{FNB}/functions/v1/family-offer", {"o": "00000000-0000-0000-0000-000000000000", "e": int(time.time()) + 3600, "t": "A" * 43})
chk(s == 403, "family-offer: a forged offer link gets nothing (403)", f"a forged link was not refused ({s})")
s, b = http("POST", f"{FNB}/functions/v1/family-offer", {})
chk(s == 401, "family-offer: a caller with no key gets nothing (401)", f"family-offer answered a stranger ({s})")
say()
say("  861: " + ("DONE. When a caregiver is placed, the family now hears: \"Hi Lisa, good news from Caring Companions! Sarah will be with Dot on Thursday, October 22, from 1 to 4.\" Nothing was switched on." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
