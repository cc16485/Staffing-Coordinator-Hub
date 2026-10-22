#!/usr/bin/env python3
# 1064 · STEP 2 VIDEO LINK (Samantha approved 2026-10-22: "Approved as written"). The Step 2 text and email, and the day 3 and
# day 6 reminders, gain one line: "Need help? Our short video shows every step: mo-care.com/viventium-setup".
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; 1061 has run; the Step 2 tests pass (fake data only).
#  2. Deploys the four services that carry the Step 2 words (step2-handoff, driver-compliance, hepb, nurse-visit-check).
#  3. Proves it: strangers get nothing.
# Sends nothing. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["step2-handoff", "driver-compliance", "hepb", "nurse-visit-check"]
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def drift():
    main = os.environ.get("SB_MAIN_REF", "origin/main")
    if main.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
    out = []
    for k in sorted({k for fn in FNS for k in L.need(FNROOT, fn)}):
        c2, b2 = run(["git", "-C", ROOT, "show", f"{main}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): out.append(k)
    return out

start("STEP 2 VIDEO LINK")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
d1 = drift()
if d1: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(d1)[:260] + ")")
ok("the reviewed build is what is on GitHub's main")
okq, r = sql(HUB, "select count(*)::int as n from public.client_journey_step_def where key = 'cg.checkin.call' and active")
if not okq or not r or r[0]["n"] != 1: stop("1061 (In Training Part B) hasn't been run yet. Run 1061 first, then this one")
ok("1061 has run (the check-in call row is in)")
if NODE:
    for t, must in (("step2_handoff_575_test.mjs", "58/58 passed"), ("lpn_step2_708_test.mjs", "9/9 passed"), ("in_training_part_b_test.mjs", "15/15 passed"), ("nurse_visit_check_test.mjs", "56/56 passed")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l for l in o.splitlines() if "FAIL" in l or "✗" in l)[:240])
    ok("tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
metas = {}
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    metas[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if metas[fn] else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, metas[fn]): say("  STOP. Tell Claude. (Services before this one are deployed.)"); done(5)

say(); say("PART 3 · PROOF")
for fn in FNS:
    s, b = http("POST", f"{FNB}/functions/v1/{fn}", {})
    chk(s in (400, 401, 403), f"{fn}: a caller with no key gets nothing ({s})", f"{fn} answered a stranger ({s})")
say()
if not L.fails: say("  1064: DONE. New Step 2 messages and reminders now include the Viventium video link.")
else: say("  1064: NOT COMPLETE. See the ✗ lines above.")
done(0 if not L.fails else 1)
