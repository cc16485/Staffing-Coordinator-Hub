#!/usr/bin/env python3
# 1072 · THE VIDEO CALL INVITE SAYS THE APP COMES AFTER ORIENTATION (2026-10-22, Samantha approved the Part C wording).
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; welcome_call_test passes (fake data only); how
#     welcome-call is set up live.
#  2. Deploys welcome-call (gateway setting kept). The email now says: "We will also check your ID for your employment paperwork
#     and go over your caregiver profile together. You will set up the AxisCare app after your orientation."
#  3. Proves it: a stranger gets nothing.
# Sends nothing. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta
HUB = "zngsgedlsxinbygwmxwn"; FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}")); NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co"); FN = "welcome-call"
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
start("THE VIDEO CALL INVITE: THE APP COMES AFTER ORIENTATION")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted(L.need(FNROOT, FN)) if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    c, o = run([NODE, "welcome_call_test.mjs"], cwd=ROOT)
    if c != 0 or "ALL 25 CHECKS PASS" not in o: stop("the tests failed: " + " ".join(l for l in o.splitlines() if "FAIL" in l)[:240])
    ok("tests pass (fake data only)")
s, m = fmeta(HUB, FN)
if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {FN} is set up live ({s})", 3)
vj = bool(m["verify_jwt"]); say(f"  · {FN} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if vj else 'off'} (kept)")
say(); say("PART 2 · CHANGE")
if not deploy(HUB, FNROOT, FN, vj): say("  STOP. Tell Claude."); done(5)
say(); say("PART 3 · PROOF")
s, b = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "invite", "candidate_id": "1"})
(ok if s in (400, 401, 403) else bad)(f"{FN}: a caller with no key gets nothing ({s})")
say(); say("  1072: " + ("DONE. New video call invites say the AxisCare app is set up after orientation." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
