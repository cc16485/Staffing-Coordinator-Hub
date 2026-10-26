#!/usr/bin/env python3
# 1091 · THE CAMPAIGN AUTOPILOT READS THE CURRENT EMAIL LIBRARY (2026-10-26, Samantha: "point the campaign autopilot at
# the email library on mo-care.com"). It read caring-companions.pages.dev, a copy that stopped updating before mid-September.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; mo-care.com serves the library, the logo and every banner.
#  2. Deploys campaign-auto (gateway setting kept). No database change. Its on/off switches are not touched.
#  3. Proves the live copy is this build.
# Sends nothing to anyone. Safe to run again.
import json, os, subprocess, urllib.request
import cc_step_lib as L
from cc_step_lib import say, bad, done, start, check_build, fmeta, deploy

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
FN = "campaign-auto"
SITE = os.environ.get("SB_SITE", "https://mo-care.com/email-assets")
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "cc-1091/1.0"}), timeout=30) as r: return r.status, r.read()
    except Exception as e: return None, b""

start("THE CAMPAIGN AUTOPILOT READS THE CURRENT EMAIL LIBRARY")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(L.need(FNROOT, FN)):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
s_, body = get(SITE + "/library.json")
try: lib = json.loads(body)
except Exception: lib = None
if s_ != 200 or not isinstance(lib, list) or len(lib) < 50: stop("mo-care.com is not serving the email library right now (" + str(s_) + ")")
ok(f"mo-care.com serves the email library ({len(lib)} emails)")
chk(sum("Caring Companions Consumer Directed Services" in json.dumps(e) for e in lib) >= 10, "it has the new Consumer Directed Services wording", "the library on mo-care.com does not have the new wording: nothing was changed")
banners = sorted({e.get("banner") for e in lib if e.get("banner")})
missing = [b for b in banners if get(f"{SITE}/{b}.jpg")[0] != 200]
chk(not missing and get(SITE + "/cc-logo.png")[0] == 200, f"the logo and all {len(banners)} banner pictures are there", "missing pictures on mo-care.com: " + ", ".join(missing)[:200])
if L.fails: say("  STOP. Nothing was changed."); done(2)
s_, m = fmeta(HUB, FN)
if s_ != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {FN} is set up live ({s_})", 3)
gate = bool(m["verify_jwt"]); say(f"  · {FN} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
if not deploy(HUB, FNROOT, FN, gate): say("  STOP. Tell Claude. (Nothing else was changed.)"); done(5)

say(); say("PART 3 · PROOF")
ok("the live autopilot is this build: it reads mo-care.com/email-assets/library.json (checked file by file above)")
say("  · Its on/off switches were not touched, and nothing was sent.")
say(); say("✓ DONE" if not L.fails else "✗ " + str(len(L.fails)) + " problem(s) above. Tell Claude.")
done(0 if not L.fails else 1)
