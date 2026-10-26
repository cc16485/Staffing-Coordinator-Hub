#!/usr/bin/env python3
# 1130 · THREE MORE AI HELPERS READ THE ANSWER, NOT THE THINKING (2026-10-26). The running-late reader missed 2 of 20 because
# this AI may think before it answers and the reader only looked at the first block (fixed in 1127d). The same habit was in:
# Suggest topics (caregiver packets), Draft / Redo draft and Help me polish (caregiver profiles), and the Step 1 form look.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only).
#  2. Deploys care-packet, caregiver-profile and step1-look (gateway settings kept).
#  3. Proves it: each is the reviewed build live, and a stranger is refused.
# Texts nobody. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["care-packet", "caregiver-profile", "step1-look"]
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)

start("THREE MORE AI HELPERS READ THE ANSWER")
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
    for t, must in (("care_packet_test.mjs", "139/139 passed"), ("caregiver_profile_test.mjs", "ALL 62 CHECKS PASS"), ("caregiver_profile_2b_test.mjs", "ALL 45 CHECKS PASS"),
                    ("step1_look_457_test.mjs", "ALL 9 CHECKS PASS"), ("beef_457_test.mjs", "ALL 11 CHECKS PASS"), ("profile_catchup_452_test.mjs", "ALL 33 CHECKS PASS")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l for l in o.splitlines() if "FAIL" in l)[:240])
    ok("tests pass: each helper reads the answer after the AI thinks, says how the reply stopped when there is none, and no Sonnet or Opus 5.5 helper reads only the first block (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
metas = {}
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    metas[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if metas[fn] else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, metas[fn]): say("  STOP. Tell Claude. (Functions before this one are deployed; nothing else was changed.)"); done(5)
say(); say("PART 3 · PROOF (deploy above already proved each live copy is the reviewed build)")
for fn in FNS:
    s, b = http("POST", f"{FNB}/functions/v1/{fn}", {})
    chk(s in (400, 401, 403), f"{fn}: a caller with no key gets nothing ({s})", f"{fn} answered a stranger ({s})")
say()
say("  1130: " + ("DONE. Suggest topics, Draft / Help me polish and the Step 1 form look read the AI's answer even when it thinks first, and say how the reply stopped if there is none." if not L.fails else "NOT COMPLETE. See the ✗ lines above (each says why)."))
say("  The real check is the next time someone taps Suggest topics or Redo draft. Nobody was texted.")
done(0 if not L.fails else 1)
