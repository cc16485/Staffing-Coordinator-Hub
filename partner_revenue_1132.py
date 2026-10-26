#!/usr/bin/env python3
# 1132 · STAFFING SERVER · PARTNER BILLED REVENUE READER (Referral Partner Program, 2026-10-26).
# Adds one NEW server function, partner-revenue, that the owners' Program view in the CC Hub calls when Samantha or
# Zachary press "Get billed revenue from AxisCare". Owners only. It reads AxisCare visits for referred clients who started
# care and returns an estimate (completed visits × each visit's charge rate). Read only: saves nothing, sends nothing,
# changes nothing in AxisCare. Tracking only, nothing about paying partners.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); whether
#     partner-revenue already exists.
#  2. Deploys partner-revenue with the gateway sign-in check ON (only signed-in Hub users reach it; then owners only).
#  3. Proves it: a caller with no sign-in gets nothing; the auth check with no sign-in gets nothing.
# Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta

REF = HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FN = "partner-revenue"
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None, env=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=env); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)

start("STAFFING SERVER · PARTNER BILLED REVENUE READER (owners only, read only)")
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
if NODE:
    c, o = run([NODE, "partner_revenue_test.mjs"], cwd=ROOT)
    if c != 0 or "12/12" not in o or "✗" in o: stop("the tests failed: " + " ".join(l.strip() for l in o.splitlines() if "✗" in l)[:240])
    ok("the partner revenue tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
s_, m = fmeta(HUB, FN)
if s_ == 200 and m: say(f"  · {FN} already exists (version {m.get('version', '?')}); it will be replaced with the reviewed build")
elif s_ == 404: say(f"  · {FN} is new")
else: stop(f"couldn't read whether {FN} exists ({s_})", 3)

say(); say("PART 2 · CHANGE")
if not deploy(HUB, FNROOT, FN, True): say(f"  STOP at {FN}. Tell Claude."); done(5)

say(); say("PART 3 · PROOF")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s1, _ = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"Content-Type": "application/json"})
chk(s1 is not None and 400 <= s1 < 500, f"a caller with no sign-in gets nothing ({s1})", f"{FN} answered a caller with no sign-in with {s1}")
s2, _ = http("POST", f"{FNB}/functions/v1/{FN}?auth_check=1", {}, {"Content-Type": "application/json"})
chk(s2 is not None and 400 <= s2 < 500, f"the auth check with no sign-in gets nothing ({s2})", f"the auth check answered {s2}")
say()
say("  1132: " + ("DONE. The billed revenue reader is live, owners only. Next: Claude merges the CC Hub pull request that adds the button." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
