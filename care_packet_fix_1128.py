#!/usr/bin/env python3
# 1128 · CAREGIVER PACKET SUGGESTIONS, FIXED (2026-10-26). The "Suggest topics" button on a caregiver packet asks the
# stronger AI model, but sent it a "temperature" setting this model refuses, so every suggestion came back "could not be
# made just now" (the same thing 1127b fixed for the running-late reader).
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only).
#  2. Deploys care-packet (gateway setting kept). The deploy itself proves the live copy is this build.
#  3. Proves it: a stranger is refused. The real check is you tapping "Suggest topics" on one client's packet.
# Texts nobody. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["care-packet"]
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)

start("CAREGIVER PACKET SUGGESTIONS, FIXED")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for fn in FNS:
    for k in sorted(L.need(FNROOT, fn)):
        c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(sorted(set(drift)))[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t, must in (("care_packet_test.mjs", "136/136 passed"), ("care_packet_watch_test.mjs", "30/30 passed")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l for l in o.splitlines() if "FAIL" in l)[:240])
    ok("tests pass: suggestions send no temperature, and no other Sonnet 5.5 or Opus 5.5 call in any function does either (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
metas = {}
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    metas[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if metas[fn] else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, metas[fn]): say("  STOP. Tell Claude. (Nothing else was changed.)"); done(5)
say(); say("PART 3 · PROOF")
for fn in FNS:
    s, b = http("POST", f"{FNB}/functions/v1/{fn}", {"action": "suggest", "ax": "1"})
    chk(s in (400, 401, 403), f"{fn}: a caller with no sign-in gets nothing ({s})", f"{fn} answered a stranger ({s})")
say()
say("  1128: " + ("DONE. Caregiver packet suggestions are fixed live." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
if not L.fails: say("  Last check is yours: open one client's caregiver packet in the Hub and tap Suggest topics. It should list topics, not \"could not be made just now\".")
say("  Nobody was texted.")
done(0 if not L.fails else 1)
