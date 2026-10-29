#!/usr/bin/env python3
# 1184 · CLIENT CARE AGREEMENT: FILLED IN BEFORE THE TABLET IS HANDED OVER (Samantha 2026-10-29: "the more they only have
# to tap the better"; her answers "Yes, build all of it" and home access "Later, separately").
#  Redeploys client-agreement: starting an agreement fills its typing boxes from AxisCare (the client and the responsible
#  parties, read only), the Family Circle, the lead and the home visit; "prefill" shows the set-up screen what will be filled
#  in plus the home visit's level and rate; "fill_blanks" fills only the empty boxes of a draft. Facts only: every Yes / No,
#  Accept / Decline and permission box stays the family's tap. No database change. Nothing is sent, nothing changes in AxisCare.
import json, os, subprocess
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ("client-agreement",)
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)

start("CLIENT CARE AGREEMENT: FILLED IN BEFORE THE TABLET IS HANDED OVER")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
# every file the function uses must match GitHub's main, so nobody's newer work is undone (run after the PR is merged)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
for fn in FNS:
    drift = []
    for k in sorted(L.need(FNROOT, fn)):
        c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
    if drift: stop(f"{fn} isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
    ok(f"{fn}: the reviewed build is what is on GitHub's main")
gate = {}
for fn in FNS:
    s, m = fmeta(REF, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})")
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")
say("  · what changes: client-agreement redeployed. No database change. Nothing sent, nothing changed in AxisCare (it is only read).")
if L.fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, gate[fn]):
        say("  RESULT: STOPPED. Nothing changed: the live client-agreement is the one from before. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent)")
U = f"{FNB}/functions/v1/client-agreement"
s1, _ = http("OPTIONS", U); ok("the Hub page can reach client-agreement") if s1 == 200 else bad(f"the browser check answered {s1}")
for act, body in (("prefill", {"action": "prefill", "client_ax": "296"}), ("fill_blanks", {"action": "fill_blanks", "id": "00000000-0000-4000-8000-000000000000"})):
    s2, b2 = http("POST", U, body)
    ok(f"{act} refuses anyone not signed in to the Hub (401): client details stay private") if s2 == 401 else bad(f"{act} answered a stranger {s2}: {b2[:120]}")
say("  · tested before deploying: the pre-fill against a fake AxisCare, database and Hub data (25 checks: the client from AxisCare else the lead,")
say("    the primary contact first, one row per person, the POA from the home visit, no choice ever ticked, typed answers never changed,")
say("    AxisCare only read), all earlier agreement checks again (182), and the tablet screens (420).")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Merge the CC Hub pull request next (the tablet page). Nothing was sent by this step."); done(0)
