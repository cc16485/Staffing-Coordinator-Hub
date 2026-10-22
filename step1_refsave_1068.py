#!/usr/bin/env python3
# 1068 · STEP 1 REFERENCES SAVE (2026-10-22, a new hire on the references page: "It keeps telling me that my 2nd reference
# needs to have a yes to contact, but it does"). One phone or email the server could not accept (a word in a phone, an
# email without ".com") threw away that whole list of references, so the Yes tapped after it was never kept, and the page
# never said so. Now only that box is left off, and the page outlines it in red and says how to write it (Hub step1.html).
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the Step 1 tests pass (fake data only); the LIVE
#     step1-sign is exactly the build this change started from (nothing anyone else deployed is undone).
#  2. Deploys step1-sign (gateway setting kept).
#  3. Proves it: a caller with no valid link gets nothing.
# Sends nothing. Changes no answers. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, live_files, sha

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
BASE = os.environ.get("SB_BASE", "")
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FN = "step1-sign"
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)

start("STEP 1 REFERENCES SAVE")
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
    for t, must in (("step1_sign_2b_test.mjs", "174/174 passed"), ("step1_experience_test.mjs", "47/47 passed"), ("practice_scenarios_test.mjs", "48/48 passed"), ("lpn_step1_708_test.mjs", "30/30 passed")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l for l in o.splitlines() if "FAIL" in l or "✗" in l)[:240])
    ok("tests pass: a bad phone on reference 2 keeps the list and its Yes and is named back to the page (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
if not BASE: stop("no starting build was given to compare the live function with", 3)
okl, live = live_files(HUB, FN)
if not okl: stop(f"couldn't download the live {FN} to compare it", 3)
diff = []
for k in sorted(L.need(FNROOT, FN)):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{BASE}:{k}"])
    if c2 != 0:
        if k in live: diff.append(k + " (live has it, the starting build does not)")
        continue
    tmp = os.path.join(ROOT, ".cmp_1068"); open(tmp, "w").write(b2); want = sha(tmp); os.remove(tmp)
    if live.get(k) != want: diff.append(k)
if diff: stop(f"the live {FN} is not the build this change started from, so deploying could undo someone else's work: " + ", ".join(diff)[:240])
ok(f"the live {FN} is exactly the starting build (nothing of anyone else's would be undone)")
s, m = fmeta(HUB, FN)
if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {FN} is set up live ({s})", 3)
jwt = bool(m["verify_jwt"]); say(f"  · {FN} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if jwt else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
if not deploy(HUB, FNROOT, FN, jwt): say("  STOP. Tell Claude. Nothing else was changed."); done(5)

say(); say("PART 3 · PROOF")
s, b = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "save", "o": "x", "e": "1", "t": "y", "answers": {}})
(ok if s in (400, 401, 403, 404) else bad)(f"a caller with no valid link gets nothing ({s})")
s2, m2 = fmeta(HUB, FN)
(ok if s2 == 200 and m2 and bool(m2.get("verify_jwt")) == jwt else bad)(f"{FN} is live as version {(m2 or {}).get('version', '?')}, gateway setting unchanged")
say()
say("  1068: " + ("DONE. A phone or email that doesn't look right no longer throws away the references; the page outlines it in red and says how to write it. Ask the new hire to open her Step 1 link again and tap Yes once more." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
