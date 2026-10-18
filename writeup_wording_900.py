#!/usr/bin/env python3
# 900 · WRITE-UP APPROVALS, MISSED-NOTES WORDING (Samantha 2026-10-17, SOP ruling 2: the team approves coaching, verbal
# and first written warnings; leadership approves anything above that). Redeploys missed-notes only, so a draft
# write-up it prepares says who approves it instead of "Only Samantha or Zach". No database change. Nothing is sent.
import json, os, subprocess
os.environ.setdefault("SB_STEP", "900")
import cc_step_lib as L
from cc_step_lib import say, bad, done, deploy, start, check_build, fmeta

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
FN = "missed-notes"
NEW = "A Care Coordinator approves coaching, a verbal warning or a first written warning; leadership approves anything above that."
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True, cwd=ROOT); return p.returncode, (p.stdout or ""), (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)

start("WRITE-UP APPROVALS: MISSED-NOTES WORDING")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted(L.need(FNROOT, FN)) if (lambda c: c[0] != 0 or c[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"]))]
if drift: stop(f"{FN} isn't the same as GitHub's main (someone changed it since): " + ", ".join(drift)[:240])
ok(f"{FN}: the reviewed build is what is on GitHub's main")
if NEW not in open(os.path.join(FNROOT, FN, "index.ts")).read(): stop("the new wording is not in this build")
ok("the new wording is in this build")
s0, m0 = fmeta(REF, FN)
if s0 != 200 or not m0 or "verify_jwt" not in m0: stop(f"couldn't read how {FN} is set up live ({s0})")
GATE = bool(m0["verify_jwt"]); say(f"  · {FN} is live as version {m0.get('version', '?')}, gateway sign-in check {'on' if GATE else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, GATE): say(f"  RESULT: STOPPED at {FN}. Tell Claude. (The database was not changed.)"); done(7)
say(); say("  RESULT: DONE. missed-notes now says who approves its draft write-ups. Nothing was sent and no data changed.")
done(0)
